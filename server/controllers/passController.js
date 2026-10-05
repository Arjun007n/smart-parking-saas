const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const passes = require("../services/passService");
const { parsePlate, normalizePlate, escapeRegex } = require("../utils/plate");
const { cleanTag } = require("../utils/tag");
const emailService = require("../services/emailService");
const messageService = require("../services/messageService");
const mail = require("../integrations/email");
const { getAccessibleLocation } = require("../utils/scope");
const { isCompanyWide } = require("../config/permissions");
const Pass = require("../models/Pass");
const { PASS_TYPES } = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const { PASS_PAYMENT_METHODS } = require("../models/PassPayment");
const Vehicle = require("../models/Vehicle");
const ParkingSession = require("../models/ParkingSession");
const Shift = require("../models/Shift");
const Location = require("../models/Location");

const PAGE_SIZE = 50;
const toId = (id) => new mongoose.Types.ObjectId(id);

const scopeFilter = passes.scopeFilter;

const findInScope = async (req) => {
  const pass = await Pass.findOne({ $and: [{ _id: req.params.id }, scopeFilter(req)] });
  if (!pass) throw new AppError("Pass not found", 404);
  return pass;
};

const withState = (pass, now = new Date()) => ({ ...pass.toJSON(), state: passes.passState(pass, now) });

// The locations a pass will work at. Empty means all, which only company-wide roles may grant.
const resolveLocationIds = async (req, companyId, requested = []) => {
  const unique = [...new Set(requested.map(String))];
  if (unique.length === 0) {
    if (!isCompanyWide(req.user.role)) {
      throw new AppError("Choose the location(s) this pass works at", 400);
    }
    return [];
  }
  for (const id of unique) {
    if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid location in locationIds", 400);
  }
  if (!isCompanyWide(req.user.role)) {
    const mine = new Set(Array.from(req.user.locationIds).map(String));
    if (unique.some((id) => !mine.has(id))) throw new AppError("You can only choose your own locations", 403);
  }
  const found = await Location.countDocuments({ _id: { $in: unique.map(toId) }, companyId });
  if (found !== unique.length) throw new AppError("One of the locations was not found", 404);
  return unique.map(toId);
};

// Cash needs no reference; a free pass must be marked as such.
const checkPayment = ({ amount, method, transactionId }) => {
  if (!PASS_PAYMENT_METHODS.includes(method)) throw new AppError("Unknown payment method", 400);
  if (amount > 0 && method === "COMPLIMENTARY") throw new AppError("A complimentary pass has no amount", 400);
  if (amount === 0 && method !== "COMPLIMENTARY") {
    throw new AppError("An amount of 0 is a complimentary pass. Choose Complimentary.", 400);
  }
  if (transactionId && method === "CASH") throw new AppError("Cash has no transaction reference", 400);
};

// Records the money for a sale or renewal, in the collecting person's open shift.
const recordPayment = async (req, { pass, location, kind, period, amount, method, transactionId, taxPercent }) => {
  const shift = await Shift.findOne({ operatorId: req.user._id, locationId: location._id, status: "OPEN" });
  try {
    return await PassPayment.create({
      companyId: pass.companyId,
      locationId: location._id,
      passId: pass._id,
      kind,
      amount,
      tax: passes.taxIncluded(amount, taxPercent),
      method,
      ...(transactionId ? { transactionId } : {}),
      periodUnit: period.unit,
      periodCount: period.count,
      periodStart: period.start,
      periodEnd: period.end,
      collectedBy: req.user._id,
      ...(shift ? { shiftId: shift._id } : {}),
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError("This payment reference was already used", 409);
    throw error;
  }
};

// Plates of a sale: the main vehicle first, then the extra ones. Each is
// normalised and none may repeat.
const collectVehicles = (body) => {
  const list = [{ number: parsePlate(body.vehicleNumber), type: body.vehicleType }];
  for (const extra of body.extraVehicles || []) {
    list.push({ number: parsePlate(extra.vehicleNumber), type: extra.vehicleType });
  }
  if (new Set(list.map((v) => v.number)).size !== list.length) {
    throw new AppError("The same vehicle number is listed twice", 400);
  }
  return list;
};

// A vehicle may belong to only one current pass of the company.
const assertFree = async (companyId, plate, exceptPassId) => {
  const other = await passes.findCurrentPass(companyId, plate);
  if (other && String(other._id) !== String(exceptPassId)) {
    throw new AppError(`${plate} already has pass ${other.passNumber}. Renew or change that pass instead.`, 409);
  }
};

// Keeps the vehicle records (Vehicle.passId) in line with the pass.
const linkVehicle = (companyId, plate, passId) =>
  Vehicle.updateOne({ companyId, plateNumber: plate }, { $set: { passId } }).catch(() => {});
const unlinkVehicle = (companyId, plate, passId) =>
  Vehicle.updateOne({ companyId, plateNumber: plate, passId }, { $unset: { passId: "" } }).catch(() => {});

// POST /api/passes
// Sells a pass: creates it and records the payment.
// A holder's email: lower case; empty means none; anything else must look like an address.
const cleanEmail = (value) => {
  const text = String(value || "").trim().toLowerCase();
  if (text && !mail.isEmail(text)) throw new AppError("Enter a valid email address", 400);
  return text;
};

const createPass = async (req, res) => {
  const body = req.body;
  const holderEmail = cleanEmail(body.email);
  const location = await getAccessibleLocation(req, body.locationId, { mustBeActive: true });
  const companyId = location.companyId;
  const locationIds = await resolveLocationIds(req, companyId, body.locationIds);
  const vehicles = collectVehicles(body);
  const maxVehicles = body.maxVehicles ?? Math.max(1, vehicles.length);
  if (vehicles.length > maxVehicles) throw new AppError("More vehicles than the pass allows", 400);
  const amount = body.amount;
  checkPayment({ amount, method: body.method, transactionId: body.transactionId });
  const period = passes.newPeriod({ startText: body.startDate, months: body.months, unit: body.unit, count: body.count });

  for (const vehicle of vehicles) {
    const existing = await passes.findCurrentPass(companyId, vehicle.number);
    if (existing) {
      throw new AppError(`${vehicle.number} already has pass ${existing.passNumber}. Renew that pass instead.`, 409);
    }
  }

  let pass;
  try {
    pass = await passes.createPassWithNumber({
      companyId, locationIds, vehicles: vehicles.map((v) => ({ ...v, addedBy: req.user._id })), maxVehicles,
      passType: body.passType || "REGULAR", holderName: body.holderName,
      phone: body.phone, email: holderEmail || undefined, notes: body.notes, startDate: period.start, endDate: period.end, createdBy: req.user._id,
      vehicleNumber: vehicles[0].number, vehicleType: vehicles[0].type,
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError("One of these vehicles already has a pass. Renew it instead.", 409);
    throw error;
  }

  let payment;
  try {
    payment = await recordPayment(req, {
      pass, location, kind: "NEW", period, amount, method: body.method,
      transactionId: body.transactionId, taxPercent: body.taxPercent,
    });
  } catch (error) {
    await Pass.deleteOne({ _id: pass._id }); // no payment, no pass
    throw error;
  }

  await Promise.all(vehicles.map((v) => linkVehicle(companyId, v.number, pass._id)));
  await audit.record(req, "PASS_CREATE", {
    entity: "Pass", entityId: pass._id, companyId,
    meta: {
      passNumber: pass.passNumber, vehicleNumber: vehicles[0].number, vehicles: vehicles.map((v) => v.number),
      passType: pass.passType, unit: period.unit, count: period.count, amount, method: body.method,
    },
  });

  emailService.sendPassNotice({ pass, kind: "NEW" });
  messageService.sendPassNotice({ pass, kind: "NEW" });
  res.status(201).json({ success: true, data: { pass: withState(pass), payment } });
};

// POST /api/passes/:id/renew
const renewPass = async (req, res) => {
  const pass = await findInScope(req);
  if (pass.status === "CANCELLED") throw new AppError("A cancelled pass cannot be renewed. Sell a new pass.", 409);

  const body = req.body;
  const location = await getAccessibleLocation(req, body.locationId, { mustBeActive: true });
  checkPayment({ amount: body.amount, method: body.method, transactionId: body.transactionId });
  const period = passes.renewalPeriod(pass, passes.resolveTerm({ months: body.months, unit: body.unit, count: body.count }));

  // Guarded on the old end date: two people renewing at once cannot both extend the same period.
  const extended = await Pass.findOneAndUpdate(
    { _id: pass._id, endDate: pass.endDate, status: { $ne: "CANCELLED" } },
    {
      $set: { endDate: period.end, lastRenewedAt: new Date(), ...(period.continues ? {} : { startDate: period.start }) },
      $inc: { renewals: 1 },
    },
    { returnDocument: "after" }
  );
  if (!extended) throw new AppError("This pass was just changed by someone else. Reload and try again.", 409);

  let payment;
  try {
    payment = await recordPayment(req, {
      pass: extended, location, kind: "RENEWAL", period, amount: body.amount, method: body.method,
      transactionId: body.transactionId, taxPercent: body.taxPercent,
    });
  } catch (error) {
    await Pass.updateOne(
      { _id: pass._id, endDate: period.end },
      { $set: { endDate: pass.endDate, startDate: pass.startDate }, $inc: { renewals: -1 } }
    );
    throw error;
  }

  await audit.record(req, "PASS_RENEW", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId,
    meta: { passNumber: pass.passNumber, unit: period.unit, count: period.count, amount: body.amount, method: body.method, until: period.end },
  });
  emailService.sendPassNotice({ pass: extended, kind: "RENEWED" });
  messageService.sendPassNotice({ pass: extended, kind: "RENEWED" });
  res.status(201).json({ success: true, data: { pass: withState(extended), payment } });
};

// Suspend, resume and cancel share the same shape.
const changeStatus = (action, to, from, reasonRequired) => async (req, res) => {
  const pass = await findInScope(req);
  if (!from.includes(pass.status)) throw new AppError(`A ${pass.status.toLowerCase()} pass cannot be ${action}d`, 409);

  pass.status = to;
  pass.statusReason = reasonRequired ? req.body.reason : undefined;
  pass.statusChangedBy = req.user._id;
  pass.statusChangedAt = new Date();
  await pass.save();

  if (to === "CANCELLED") {
    await Promise.all(passes.passVehicles(pass).map((v) => unlinkVehicle(pass.companyId, v.number, pass._id)));
  }
  await audit.record(req, `PASS_${action.toUpperCase()}`, {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId,
    meta: { passNumber: pass.passNumber, reason: req.body.reason },
  });
  res.json({ success: true, data: withState(pass) });
};

const suspendPass = changeStatus("suspend", "SUSPENDED", ["ACTIVE"], true);
const resumePass = changeStatus("resume", "ACTIVE", ["SUSPENDED"], false);
const cancelPass = changeStatus("cancel", "CANCELLED", ["ACTIVE", "SUSPENDED"], true);

// PUT /api/passes/:id   (holder details; the vehicle number cannot change)
const updatePass = async (req, res) => {
  const pass = await findInScope(req);
  const { locationIds, ...details } = req.body;
  if (details.email !== undefined) details.email = cleanEmail(details.email) || undefined;
  if (details.maxVehicles !== undefined && details.maxVehicles < passes.passVehicles(pass).length) {
    throw new AppError("The pass already has more vehicles than that. Remove a vehicle first.", 400);
  }
  Object.assign(pass, details);
  if (locationIds !== undefined) pass.locationIds = await resolveLocationIds(req, pass.companyId, locationIds);
  await pass.save();
  await audit.record(req, "PASS_UPDATE", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId, meta: { changed: Object.keys(req.body) },
  });
  res.json({ success: true, data: withState(pass) });
};

// ---------------------------------------------------------------- vehicles

const findLiveInScope = async (req) => {
  const pass = await findInScope(req);
  if (pass.status === "CANCELLED") throw new AppError("This pass is cancelled. Sell a new pass instead.", 409);
  if (pass.vehicles.length === 0) await pass.save(); // old pass: fills in `vehicles` from vehicleNumber
  return pass;
};

const holdsPlate = (pass, plate) => pass.vehicles.findIndex((v) => v.number === plate);

// A vehicle that is inside the parking right now cannot be taken off the
// pass: it would be charged at the exit for a pass it entered with.
const assertNotParked = async (pass, plate) => {
  if (await ParkingSession.exists({ companyId: pass.companyId, vehicleNumber: plate, isOpen: true })) {
    throw new AppError(`${plate} is parked right now. Let it exit first, then change the pass.`, 409);
  }
};

const recordChange = (req, pass, change) => pass.vehicleChanges.push({ ...change, by: req.user._id, at: new Date() });

const saveVehicles = async (pass) => {
  try {
    await pass.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("That vehicle already has a pass", 409);
    throw error;
  }
};

// POST /api/passes/:id/vehicles    { vehicleNumber, vehicleType }
const addVehicle = async (req, res) => {
  const pass = await findLiveInScope(req);
  const plate = parsePlate(req.body.vehicleNumber);
  if (holdsPlate(pass, plate) >= 0) throw new AppError(`${plate} is already on this pass`, 409);
  if (pass.vehicles.length >= pass.maxVehicles) {
    throw new AppError(`This pass allows ${pass.maxVehicles} vehicle${pass.maxVehicles === 1 ? "" : "s"}. Raise the limit first.`, 409);
  }
  await assertFree(pass.companyId, plate, pass._id);

  pass.vehicles.push({ number: plate, type: req.body.vehicleType, addedBy: req.user._id });
  recordChange(req, pass, { action: "ADDED", to: plate, reason: req.body.reason });
  await saveVehicles(pass);
  await linkVehicle(pass.companyId, plate, pass._id);

  await audit.record(req, "PASS_VEHICLE_ADD", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId, meta: { passNumber: pass.passNumber, vehicleNumber: plate },
  });
  res.status(201).json({ success: true, data: withState(pass) });
};

// POST /api/passes/:id/vehicles/remove    { vehicleNumber, reason }
const removeVehicle = async (req, res) => {
  const pass = await findLiveInScope(req);
  const plate = parsePlate(req.body.vehicleNumber);
  const index = holdsPlate(pass, plate);
  if (index < 0) throw new AppError(`${plate} is not on this pass`, 404);
  if (pass.vehicles.length === 1) {
    throw new AppError("A pass needs at least one vehicle. Replace the vehicle or cancel the pass.", 409);
  }
  await assertNotParked(pass, plate);

  pass.vehicles.splice(index, 1); // the next vehicle becomes the main one if the first was removed
  recordChange(req, pass, { action: "REMOVED", from: plate, reason: req.body.reason });
  await saveVehicles(pass);
  await unlinkVehicle(pass.companyId, plate, pass._id);

  await audit.record(req, "PASS_VEHICLE_REMOVE", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId,
    meta: { passNumber: pass.passNumber, vehicleNumber: plate, reason: req.body.reason },
  });
  res.json({ success: true, data: withState(pass) });
};

// POST /api/passes/:id/vehicles/replace    { from, to, vehicleType?, reason }
// The new vehicle takes the place (and main-vehicle position) of the old one.
const replaceVehicle = async (req, res) => {
  const pass = await findLiveInScope(req);
  const from = parsePlate(req.body.from);
  const to = parsePlate(req.body.to);
  const index = holdsPlate(pass, from);
  if (index < 0) throw new AppError(`${from} is not on this pass`, 404);
  if (from === to) throw new AppError("The new vehicle number is the same as the old one", 400);
  if (holdsPlate(pass, to) >= 0) throw new AppError(`${to} is already on this pass`, 409);
  await assertNotParked(pass, from);
  await assertFree(pass.companyId, to, pass._id);

  pass.vehicles[index] = {
    number: to, type: req.body.vehicleType || pass.vehicles[index].type, addedAt: new Date(), addedBy: req.user._id,
  };
  recordChange(req, pass, { action: "REPLACED", from, to, reason: req.body.reason });
  await saveVehicles(pass);
  await unlinkVehicle(pass.companyId, from, pass._id);
  await linkVehicle(pass.companyId, to, pass._id);

  await audit.record(req, "PASS_VEHICLE_REPLACE", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId,
    meta: { passNumber: pass.passNumber, from, to, reason: req.body.reason },
  });
  res.json({ success: true, data: withState(pass) });
};

// PUT /api/passes/:id/vehicles/tag    { vehicleNumber, tag }
// Gives a vehicle on the pass its UHF / RFID tag (an empty tag removes it). The reader at
// the gate then suggests this vehicle when it sees the tag.
const setVehicleTag = async (req, res) => {
  const pass = await findLiveInScope(req);
  const plate = parsePlate(req.body.vehicleNumber);
  const index = holdsPlate(pass, plate);
  if (index < 0) throw new AppError(`${plate} is not on this pass`, 404);

  const text = String(req.body.tag || "").trim();
  const tag = text ? cleanTag(text) : "";
  if (text && !tag) throw new AppError("The tag number must be 4 to 48 letters and digits", 400);

  const before = pass.vehicles[index].tag || "";
  if (tag === before) return res.json({ success: true, data: withState(pass) });
  pass.vehicles[index].tag = tag || undefined;
  try {
    await pass.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("That tag is already on another vehicle", 409);
    throw error;
  }
  await audit.record(req, tag ? "PASS_TAG_SET" : "PASS_TAG_REMOVED", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId,
    meta: { passNumber: pass.passNumber, vehicleNumber: plate, tag: tag || before },
  });
  res.json({ success: true, data: withState(pass) });
};

// GET /api/passes?q=&state=&type=&page=
const STATES = ["ACTIVE", "UPCOMING", "EXPIRED", "SUSPENDED", "CANCELLED", "EXPIRING"];
const stateFilter = (state, now) => {
  switch (state) {
    case "ACTIVE": return { status: "ACTIVE", startDate: { $lte: now }, endDate: { $gt: now } };
    case "UPCOMING": return { status: "ACTIVE", startDate: { $gt: now } };
    case "EXPIRED": return { status: "ACTIVE", endDate: { $lte: now } };
    case "EXPIRING": return { status: "ACTIVE", startDate: { $lte: now }, endDate: { $gt: now, $lte: new Date(now.getTime() + 7 * 86400000) } };
    case "SUSPENDED": return { status: "SUSPENDED" };
    case "CANCELLED": return { status: "CANCELLED" };
    default: return { isCurrent: true };
  }
};

const listPasses = async (req, res) => {
  const now = new Date();
  if (req.query.state !== undefined && req.query.state !== "" && !STATES.includes(req.query.state)) {
    throw new AppError("Unknown state", 400);
  }
  if (req.query.type !== undefined && req.query.type !== "" && !PASS_TYPES.includes(req.query.type)) {
    throw new AppError("Unknown pass type", 400);
  }
  const conditions = [scopeFilter(req), stateFilter(req.query.state, now)];
  if (req.query.type) conditions.push({ passType: req.query.type });

  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  if (q) {
    conditions.push({
      $or: [
        { vehicleNumber: { $regex: `^${escapeRegex(normalizePlate(q))}` } },
        { "vehicles.number": { $regex: `^${escapeRegex(normalizePlate(q))}` } },
        { passNumber: q.toUpperCase() },
        { holderName: { $regex: escapeRegex(q), $options: "i" } },
        { phone: q },
      ],
    });
  }
  const filter = { $and: conditions };
  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const [list, total] = await Promise.all([
    Pass.find(filter).sort({ endDate: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    Pass.countDocuments(filter),
  ]);
  res.json({ success: true, data: { passes: list.map((p) => withState(p, now)), total, page, pageSize: PAGE_SIZE } });
};

// GET /api/passes/:id
const getPass = async (req, res) => {
  const pass = await findInScope(req);
  const payments = await PassPayment.find({ passId: pass._id }).sort({ paidAt: -1 }).limit(50);
  res.json({ success: true, data: { pass: withState(pass), payments } });
};

// GET /api/passes/lookup?vehicleNumber=&locationId=      (or passNumber= instead of vehicleNumber)
// For gate staff: is this vehicle a pass holder, and is the pass good here?
// A scanned pass card gives a pass number; the answer then names the vehicle.
const lookupPass = async (req, res) => {
  const location = await getAccessibleLocation(req, req.query.locationId);
  let pass;
  if (typeof req.query.passNumber === "string" && req.query.passNumber.trim()) {
    const number = req.query.passNumber.trim().toUpperCase();
    pass = passes.PASS_PATTERN.test(number) ? await Pass.findOne({ companyId: location.companyId, passNumber: number }) : null;
  } else {
    pass = await passes.findCurrentPass(location.companyId, parsePlate(req.query.vehicleNumber));
  }
  const summary = passes.summarize(pass, location._id);
  if (summary) {
    // Which vehicles of the pass are inside right now (a scanned pass card needs this at the exit).
    const open = await ParkingSession.find({
      companyId: location.companyId, vehicleNumber: { $in: summary.vehicles }, isOpen: true,
    }).select("vehicleNumber").lean();
    summary.inside = open.map((s) => s.vehicleNumber);
  }
  res.json({ success: true, data: { pass: summary } });
};

module.exports = {
  createPass, renewPass, suspendPass, resumePass, cancelPass, updatePass, listPasses, getPass, lookupPass,
  addVehicle, removeVehicle, replaceVehicle, setVehicleTag,
};
