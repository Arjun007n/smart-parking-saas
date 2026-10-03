const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { dayRange } = require("../utils/time");
const { locationScopedFilter, getAccessibleLocation, locationIdFromQuery } = require("../utils/scope");
const { hasPermission, PERMISSIONS } = require("../config/permissions");
const { shiftTotals, reconcile } = require("../services/collectionService");
const { notify } = require("../services/notificationService");
const Shift = require("../models/Shift");
const User = require("../models/User");
const Location = require("../models/Location");

const isAdmin = (req) => hasPermission(req.user.role, PERMISSIONS.LOCATION_MANAGE);
const isOwn = (req, shift) => String(shift.operatorId) === String(req.user._id);

// A shift is visible to its operator, and to admins of its location.
const findVisible = async (req) => {
  const shift = await Shift.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!shift || (!isOwn(req, shift) && !isAdmin(req))) throw new AppError("Shift not found", 404);
  return shift;
};

// An open shift is shown with live totals; a closed one with its frozen totals.
const present = async (shift) => ({
  ...shift.toJSON(),
  totals: shift.status === "OPEN" ? await shiftTotals(shift) : shift.totals,
});

// POST /api/shifts   (open a shift)
const openShift = async (req, res) => {
  const location = await getAccessibleLocation(req, req.body.locationId, { mustBeActive: true });

  let shift;
  try {
    shift = await Shift.create({
      companyId: location.companyId,
      locationId: location._id,
      operatorId: req.user._id,
      openingCash: req.body.openingCash,
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError("You already have an open shift. Close it first.", 409);
    throw error;
  }
  await audit.record(req, "SHIFT_OPEN", {
    entity: "Shift", entityId: shift._id, companyId: shift.companyId,
    meta: { locationId: location._id, openingCash: shift.openingCash },
  });

  res.status(201).json({ success: true, data: await present(shift) });
};

// GET /api/shifts/current   (my open shift, or null)
const currentShift = async (req, res) => {
  const shift = await Shift.findOne({ operatorId: req.user._id, status: "OPEN" });
  res.json({ success: true, data: shift ? await present(shift) : null });
};

// POST /api/shifts/:id/close
// The operator counts the cash; the system compares it with what it expected.
const closeShift = async (req, res) => {
  const shift = await findVisible(req);
  if (shift.status !== "OPEN") throw new AppError("This shift is already closed", 409);

  const totals = await shiftTotals(shift);
  const { expectedCash, difference } = reconcile({ ...totals, openingCash: shift.openingCash, closingCash: req.body.closingCash });

  // Guarded on status so a shift cannot be closed twice.
  const closed = await Shift.findOneAndUpdate(
    { _id: shift._id, status: "OPEN" },
    {
      $set: {
        status: "CLOSED",
        closedAt: new Date(),
        closedBy: req.user._id,
        closingCash: req.body.closingCash,
        expectedCash,
        difference,
        totals,
        ...(req.body.notes ? { notes: req.body.notes } : {}),
      },
    },
    { returnDocument: "after" }
  );
  if (!closed) throw new AppError("This shift is already closed", 409);

  await audit.record(req, "SHIFT_CLOSE", {
    entity: "Shift", entityId: closed._id, companyId: closed.companyId,
    meta: { expectedCash, closingCash: closed.closingCash, difference },
  });
  if (difference !== 0) {
    const [operator, location] = await Promise.all([
      User.findById(closed.operatorId).select("name"),
      Location.findById(closed.locationId).select("name"),
    ]);
    await notify({
      companyId: closed.companyId,
      locationId: closed.locationId,
      type: "SHIFT_DIFFERENCE",
      severity: "warning",
      title: `Cash ${difference < 0 ? "short" : "over"} by ${Math.abs(difference)} at ${location ? location.name : "a location"}`,
      message: `${operator ? operator.name : "An operator"} closed a shift with ${closed.closingCash} counted against ${expectedCash} expected.`,
      data: { shiftId: closed._id, difference },
      dedupeKey: `shift-difference:${closed._id}`,
    });
  }

  res.json({ success: true, data: await present(closed) });
};

// POST /api/shifts/:id/adjustments   (admins)
// Records cash added to or taken from the drawer for an approved reason.
const addAdjustment = async (req, res) => {
  const shift = await findVisible(req);
  if (shift.status !== "OPEN") throw new AppError("Adjustments can only be made on an open shift", 409);

  shift.adjustments.push({ amount: req.body.amount, reason: req.body.reason, by: req.user._id });
  await shift.save();
  await audit.record(req, "SHIFT_ADJUSTMENT", {
    entity: "Shift", entityId: shift._id, companyId: shift.companyId,
    meta: { amount: req.body.amount, reason: req.body.reason },
  });

  res.status(201).json({ success: true, data: await present(shift) });
};

// GET /api/shifts?date=&locationId=
// Admins and report viewers see every shift in their locations; others see their own.
const listShifts = async (req, res) => {
  const conditions = [locationScopedFilter(req)];
  const seesAll = isAdmin(req) || hasPermission(req.user.role, PERMISSIONS.REPORT_VIEW);
  if (!seesAll) conditions.push({ operatorId: req.user._id });

  const locationId = locationIdFromQuery(req);
  if (locationId) conditions.push({ locationId });
  const { start, end } = dayRange(req.query.date);
  conditions.push({ openedAt: { $gte: start, $lt: end } });

  const shifts = await Shift.find({ $and: conditions }).sort({ openedAt: -1 }).limit(200);
  const operators = await User.find({ _id: { $in: shifts.map((s) => s.operatorId) } }).select("name");
  const names = new Map(operators.map((u) => [String(u._id), u.name]));

  const data = [];
  for (const shift of shifts) {
    data.push({ ...(await present(shift)), operatorName: names.get(String(shift.operatorId)) || "Unknown" });
  }
  res.json({ success: true, data });
};

module.exports = { openShift, currentShift, closeShift, addAdjustment, listShifts };
