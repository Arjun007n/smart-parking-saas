const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const passes = require("../services/passService");
const { parsePlate, normalizePlate, escapeRegex } = require("../utils/plate");
const { cleanTag } = require("../utils/tag");
const emailService = require("../services/emailService");
const messageService = require("../services/messageService");
const mail = require("../integrations/email");
const { getAccessibleLocation, locationScopedFilter } = require("../utils/scope");
const { dayRange, addDaysLocal } = require("../utils/time");
const { round2 } = require("../services/collectionService");
const { respond, wantsExport, pageFrom: reportPage, CSV_LIMIT } = require("./reportController");
const { assertPassCompany } = require("./passCompanyController");
const PassCompany = require("../models/PassCompany");
const PassUser = require("../models/PassUser");
const subscriptions = require("../services/subscriptionService");
const passUsers = require("../services/passUserService");
const Company = require("../models/Company");
const { isCompanyWide } = require("../config/permissions");
const Pass = require("../models/Pass");
const { PASS_TYPES, PASS_APPROVALS } = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const { PASS_PAYMENT_METHODS } = require("../models/PassPayment");
const Vehicle = require("../models/Vehicle");
const ParkingSession = require("../models/ParkingSession");
const Shift = require("../models/Shift");
const Location = require("../models/Location");
const { VEHICLE_TYPES } = require("../models/constants");

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
  // No rate sent: use the company's pass GST rate (Company → Pass GST).
  let rate = taxPercent;
  if (rate === undefined || rate === null) {
    const company = await Company.findById(pass.companyId).select("passGstPercent").lean();
    rate = company && company.passGstPercent ? company.passGstPercent : 0;
  }
  const shift = await Shift.findOne({ operatorId: req.user._id, locationId: location._id, status: "OPEN" });
  try {
    return await PassPayment.create({
      companyId: pass.companyId,
      locationId: location._id,
      passId: pass._id,
      kind,
      amount,
      tax: passes.taxIncluded(amount, rate),
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

// The pass user a sale is for: the one chosen (passUserId), or the one for this mobile number (made
// when new). A holder with no valid 10 digit mobile number is matched by name instead.
const resolvePassUser = async (req, companyId, body) => {
  if (body.passUserId) {
    if (!mongoose.isValidObjectId(body.passUserId)) throw new AppError("Invalid pass user", 400);
    const found = await PassUser.findOne({ _id: body.passUserId, companyId });
    if (!found) throw new AppError("Pass user not found", 404);
    // Same rule as the pass-user screens (passUserController.userScope): a location admin may use only the users who hold
    // a pass in their own locations, or whom they made themselves.
    if (!isCompanyWide(req.user.role) && String(found.createdBy) !== String(req.user._id)
      && !(await Pass.exists({ $and: [scopeFilter(req), { passUserId: found._id }] }))) {
      throw new AppError("Pass user not found", 404);
    }
    return found;
  }
  const digits = String(body.phone || "").replace(/[\s-]/g, "");
  return passUsers.ensureUser(companyId, {
    name: body.holderName, mobile: passUsers.MOBILE.test(digits) ? digits : "", email: body.email,
    address: body.address, gstNumber: body.gstNumber, passCompanyId: body.passCompanyId,
  }, { createdBy: req.user._id });
};

// Sells one pass for the signed-in person: creates it, records the money, links the vehicles.
// Used by the single sale and by the bulk upload. Throws an AppError when the sale cannot be made.
const sellPass = async (req, body) => {
  const holderEmail = cleanEmail(body.email);
  const location = await getAccessibleLocation(req, body.locationId, { mustBeActive: true });
  const companyId = location.companyId;
  await subscriptions.assertAddon(companyId, location._id, "pass");
  const locationIds = await resolveLocationIds(req, companyId, body.locationIds);
  const vehicles = collectVehicles(body);
  const maxVehicles = body.maxVehicles ?? Math.max(1, vehicles.length);
  if (vehicles.length > maxVehicles) throw new AppError("More vehicles than the pass allows", 400);
  const amount = body.amount;
  checkPayment({ amount, method: body.method, transactionId: body.transactionId });
  // Two calendar days (first and last) or a term (unit and count; default one month).
  const period = body.endDate
    ? passes.datedPeriod({ from: body.startDate, to: body.endDate })
    : passes.newPeriod({ startText: body.startDate, months: body.months, unit: body.unit, count: body.count });
  const passUser = await resolvePassUser(req, companyId, body);
  const passCompanyId = await assertPassCompany(companyId, body.passCompanyId || (passUser && passUser.passCompanyId));
  if (body.approval !== undefined && !PASS_APPROVALS.includes(body.approval)) throw new AppError("Approval must be APPROVED or PENDING", 400);

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
      ...(passCompanyId ? { passCompanyId } : {}),
      passType: body.passType || "REGULAR", holderName: passUser ? passUser.name : body.holderName,
      phone: passUser ? passUser.mobile || body.phone : body.phone, email: (passUser && passUser.email) || holderEmail || undefined,
      notes: body.notes, startDate: period.start, endDate: period.end, createdBy: req.user._id,
      vehicleNumber: vehicles[0].number, vehicleType: vehicles[0].type,
      amount, approval: body.approval || "APPROVED", ...(passUser ? { passUserId: passUser._id } : {}),
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
  if (passUser) await Promise.all(vehicles.map((v) => passUsers.ensureVehicle(companyId, passUser._id, v.number, v.type)));
  await audit.record(req, "PASS_CREATE", {
    entity: "Pass", entityId: pass._id, companyId,
    meta: {
      passNumber: pass.passNumber, vehicleNumber: vehicles[0].number, vehicles: vehicles.map((v) => v.number),
      passType: pass.passType, unit: period.unit, count: period.count, amount, method: body.method,
    },
  });

  emailService.sendPassNotice({ pass, kind: "NEW" });
  messageService.sendPassNotice({ pass, kind: "NEW" });
  return { pass, payment };
};

const createPass = async (req, res) => {
  const { pass, payment } = await sellPass(req, req.body);
  res.status(201).json({ success: true, data: { pass: withState(pass), payment } });
};

// Re-dates a pass the vehicle already holds and takes the money: "Create / Renew Pass" on a pass user's
// page. The pass now runs over the two dates given and also works at `location`.
const renewDated = async (req, pass, { location, period, amount, method, transactionId, taxPercent }) => {
  await subscriptions.assertAddon(pass.companyId, location._id, "pass");
  if (pass.status === "CANCELLED") throw new AppError("A cancelled pass cannot be renewed. Sell a new pass.", 409);
  checkPayment({ amount, method, transactionId });
  const before = {
    startDate: pass.startDate, endDate: pass.endDate, amount: pass.amount, renewals: pass.renewals,
    lastRenewedAt: pass.lastRenewedAt, locationIds: [...pass.locationIds], passInvoiceId: pass.passInvoiceId,
  };
  const covered = pass.locationIds.length === 0 || pass.locationIds.some((id) => String(id) === String(location._id));
  pass.startDate = period.start;
  pass.endDate = period.end;
  pass.amount = amount;
  pass.renewals += 1;
  pass.lastRenewedAt = new Date();
  pass.passInvoiceId = undefined;
  if (!covered) pass.locationIds.push(location._id);
  await pass.save();
  let payment;
  try {
    payment = await recordPayment(req, { pass, location, kind: "RENEWAL", period, amount, method, transactionId, taxPercent });
  } catch (error) {
    Object.assign(pass, before);
    await pass.save();
    throw error;
  }
  await audit.record(req, "PASS_RENEW", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId,
    meta: { passNumber: pass.passNumber, unit: period.unit, count: period.count, amount, method, until: period.end },
  });
  emailService.sendPassNotice({ pass, kind: "RENEWED" });
  messageService.sendPassNotice({ pass, kind: "RENEWED" });
  return { pass, payment };
};

// POST /api/passes/:id/renew
const renewPass = async (req, res) => {
  const pass = await findInScope(req);
  if (pass.status === "CANCELLED") throw new AppError("A cancelled pass cannot be renewed. Sell a new pass.", 409);

  const body = req.body;
  const location = await getAccessibleLocation(req, body.locationId, { mustBeActive: true });
  await subscriptions.assertAddon(location.companyId, location._id, "pass");
  checkPayment({ amount: body.amount, method: body.method, transactionId: body.transactionId });
  const period = passes.renewalPeriod(pass, passes.resolveTerm({ months: body.months, unit: body.unit, count: body.count }));

  // Guarded on the old end date: two people renewing at once cannot both extend the same period.
  const extended = await Pass.findOneAndUpdate(
    { _id: pass._id, endDate: pass.endDate, status: { $ne: "CANCELLED" } },
    {
      $set: { endDate: period.end, lastRenewedAt: new Date(), amount: body.amount, ...(period.continues ? {} : { startDate: period.start }) },
      $unset: { passInvoiceId: "" },
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
      {
        $set: { endDate: pass.endDate, startDate: pass.startDate, ...(pass.amount !== undefined ? { amount: pass.amount } : {}) },
        ...(pass.amount === undefined ? { $unset: { amount: "" } } : {}),
        $inc: { renewals: -1 },
      }
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
  const { locationIds, passCompanyId, ...details } = req.body;
  if (passCompanyId !== undefined) pass.passCompanyId = passCompanyId ? await assertPassCompany(pass.companyId, passCompanyId) : undefined;
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
  if (pass.passUserId) await passUsers.ensureVehicle(pass.companyId, pass.passUserId, plate, req.body.vehicleType);

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
  if (pass.passUserId) await passUsers.ensureVehicle(pass.companyId, pass.passUserId, to, pass.vehicles[index].type);

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

// How many rows a screen may ask for in one page.
const LIMITS = [25, 50, 100, 200, 500, 1000, 2000];
const limitFrom = (req) => {
  const wanted = Number.parseInt(req.query.limit, 10);
  return LIMITS.includes(wanted) ? wanted : PAGE_SIZE;
};

// The charge of a pass: what it was last sold or renewed for. Passes from before the amount was kept
// take the amount of their latest payment.
const amountsOf = async (list) => {
  const missing = list.filter((p) => p.amount === undefined || p.amount === null).map((p) => p._id);
  const found = new Map();
  if (missing.length) {
    const rows = await PassPayment.aggregate([
      { $match: { passId: { $in: missing } } },
      { $sort: { paidAt: -1, _id: -1 } },
      { $group: { _id: "$passId", amount: { $first: "$amount" } } },
    ]);
    for (const r of rows) found.set(String(r._id), r.amount);
  }
  return (pass) => round2(pass.amount ?? found.get(String(pass._id)) ?? 0);
};

// The filters shared by the pass list and its downloads.
const passConditions = (req, now) => {
  if (req.query.state !== undefined && req.query.state !== "" && !STATES.includes(req.query.state)) {
    throw new AppError("Unknown state", 400);
  }
  if (req.query.type !== undefined && req.query.type !== "" && !PASS_TYPES.includes(req.query.type)) {
    throw new AppError("Unknown pass type", 400);
  }
  if (req.query.approval !== undefined && req.query.approval !== "" && !PASS_APPROVALS.includes(req.query.approval)) {
    throw new AppError("Approval must be APPROVED or PENDING", 400);
  }
  if (req.query.vehicleType !== undefined && req.query.vehicleType !== "" && !VEHICLE_TYPES.includes(req.query.vehicleType)) {
    throw new AppError("Unknown vehicle type", 400);
  }
  const conditions = [scopeFilter(req), stateFilter(req.query.state, now)];
  if (req.query.type) conditions.push({ passType: req.query.type });
  if (req.query.approval === "PENDING") conditions.push({ approval: "PENDING" });
  else if (req.query.approval === "APPROVED") conditions.push({ approval: { $ne: "PENDING" } });
  if (req.query.vehicleType) conditions.push({ "vehicles.type": req.query.vehicleType });
  if (req.query.vehicleNumber) conditions.push({ "vehicles.number": normalizePlate(String(req.query.vehicleNumber).slice(0, 20)) });
  for (const [param, field] of [["passCompanyId", "passCompanyId"], ["passUserId", "passUserId"]]) {
    if (req.query[param]) {
      if (!mongoose.isValidObjectId(req.query[param])) throw new AppError(`Invalid ${param}`, 400);
      conditions.push({ [field]: toId(req.query[param]) });
    }
  }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(",").filter(Boolean).slice(0, 200);
    if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new AppError("Invalid pass id", 400);
    conditions.push({ _id: { $in: ids.map(toId) } });
  }
  if (req.query.locationId) {
    if (!mongoose.isValidObjectId(req.query.locationId)) throw new AppError("Invalid locationId", 400);
    // A pass that works everywhere also works at this location.
    conditions.push({ $or: [{ locationIds: toId(req.query.locationId) }, { "locationIds.0": { $exists: false } }] });
  }

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
  return conditions;
};

// GET /api/passes?q=&state=&type=&approval=&vehicleType=&vehicleNumber=&passCompanyId=&passUserId=&locationId=&ids=&limit=&page=
// With ?format=csv|xlsx|pdf the same list is a download.
const listPasses = async (req, res) => {
  const now = new Date();
  const filter = { $and: passConditions(req, now) };
  const exporting = wantsExport(req);
  const size = limitFrom(req);
  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const [list, total] = await Promise.all([
    Pass.find(filter).sort({ endDate: 1, _id: 1 }).skip(exporting ? 0 : (page - 1) * size).limit(exporting ? CSV_LIMIT : size),
    Pass.countDocuments(filter),
  ]);

  const [amountOf, companies, locations] = await Promise.all([
    amountsOf(list),
    nameMap(PassCompany, list.map((p) => p.passCompanyId)),
    nameMap(Location, list.flatMap((p) => p.locationIds)),
  ]);
  const rows = list.map((pass) => ({
    ...withState(pass, now),
    approval: passes.isApproved(pass) ? "APPROVED" : "PENDING",
    amount: amountOf(pass),
    company: pass.passCompanyId && companies.get(String(pass.passCompanyId)) ? companies.get(String(pass.passCompanyId)).name : "",
    locationNames: pass.locationIds.length ? pass.locationIds.map((id) => (locations.get(String(id)) || {}).name).filter(Boolean) : [],
  }));

  if (exporting) {
    req.reportKey = "passes-list";
    return respond(req, res, "passes", [
      { key: "holderName", label: "User name" }, { key: "phone", label: "Mobile" }, { key: "email", label: "Email" },
      { key: "vehicles", label: "Vehicle no." }, { key: "vehicleType", label: "Vehicle type" }, { key: "locations", label: "Location" },
      { key: "company", label: "Company" }, { key: "startDate", label: "Start" }, { key: "endDate", label: "Valid until (day after)" },
      { key: "amount", label: "Amount" }, { key: "approval", label: "Status" }, { key: "passNumber", label: "Pass no." },
    ], rows.map((r) => ({
      holderName: r.holderName, phone: r.phone || "", email: r.email || "", vehicles: passes.passVehicles(r).map((v) => v.number).join(", "),
      vehicleType: r.vehicleType, locations: r.locationNames.length ? r.locationNames.join(", ") : "All locations", company: r.company || "N/A",
      startDate: r.startDate, endDate: r.endDate, amount: r.amount, approval: r.approval === "PENDING" ? "Pending" : "Approved", passNumber: r.passNumber,
    })), { total });
  }
  res.json({ success: true, data: { passes: rows, total, page, pageSize: size } });
};

// PATCH /api/passes/:id/approval   { approval: "APPROVED" | "PENDING" }
// Approved passes work at the gate; a pending one is only on the list until somebody approves it.
const setApproval = async (req, res) => {
  const pass = await findInScope(req);
  if (pass.status === "CANCELLED") throw new AppError("A cancelled pass cannot be approved or held", 409);
  const { approval } = req.body;
  if (!PASS_APPROVALS.includes(approval)) throw new AppError("Approval must be APPROVED or PENDING", 400);
  pass.approval = approval;
  await pass.save();
  await audit.record(req, approval === "APPROVED" ? "PASS_APPROVE" : "PASS_HOLD", {
    entity: "Pass", entityId: pass._id, companyId: pass.companyId, meta: { passNumber: pass.passNumber, vehicleNumber: pass.vehicleNumber },
  });
  res.json({ success: true, data: { ...withState(pass), approval } });
};

// POST /api/passes/delete   { ids }       (and DELETE /api/passes/:id)
// Removes passes made by mistake. A pass that a vehicle has already used at a gate, that took money,
// or that is on an invoice stays: cancel it instead, so the history is kept.
const removePasses = async (req, ids) => {
  const found = await Pass.find({ $and: [{ _id: { $in: ids.map(toId) } }, scopeFilter(req)] });
  const deleted = [];
  const skipped = [];
  for (const pass of found) {
    let why = "";
    if (await ParkingSession.exists({ companyId: pass.companyId, passId: pass._id })) why = "A vehicle already used this pass at a gate. Cancel it instead.";
    else if (await PassPayment.exists({ passId: pass._id, amount: { $gt: 0 } })) why = "Money was taken for this pass. Cancel it instead.";
    else if (pass.passInvoiceId) why = "It is on an invoice. Cancel it instead.";
    if (why) { skipped.push({ passNumber: pass.passNumber, vehicleNumber: pass.vehicleNumber, reason: why }); continue; }
    await PassPayment.deleteMany({ passId: pass._id });
    await Pass.deleteOne({ _id: pass._id });
    await Promise.all(passes.passVehicles(pass).map((v) => unlinkVehicle(pass.companyId, v.number, pass._id)));
    deleted.push(pass.passNumber);
  }
  for (const id of ids) {
    if (!found.some((p) => String(p._id) === String(id))) skipped.push({ passNumber: "", vehicleNumber: "", reason: "Not found" });
  }
  if (deleted.length) {
    await audit.record(req, "PASS_DELETE", { entity: "Pass", companyId: req.companyId, meta: { deleted: deleted.length, passNumbers: deleted.slice(0, 50) } });
  }
  return { deleted: deleted.length, skipped };
};

const deletePasses = async (req, res) => {
  const result = await removePasses(req, req.body.ids);
  res.json({ success: true, data: result });
};

const deletePass = async (req, res) => {
  const result = await removePasses(req, [req.params.id]);
  if (result.skipped.length) throw new AppError(result.skipped[0].reason, result.skipped[0].reason === "Not found" ? 404 : 409);
  res.json({ success: true, data: result });
};

// ------------------------------------------------- company-wide views

const nameMap = async (Model, ids, field = "name") => {
  const rows = await Model.find({ _id: { $in: ids.filter(Boolean) } }).select(field).lean();
  return new Map(rows.map((r) => [String(r._id), r]));
};

// GET /api/passes/summary
// The numbers above the pass list: passes by state, vehicles, companies, and what valid passes brought in.
const passSummary = async (req, res) => {
  const now = new Date();
  const scope = scopeFilter(req);
  const [byState, vehicleRows, companies, revenueRows, userRows] = await Promise.all([
    Promise.all(["ACTIVE", "EXPIRING", "EXPIRED", "SUSPENDED", "UPCOMING"].map((state) =>
      Pass.countDocuments({ $and: [scope, stateFilter(state, now)] }).then((count) => [state, count])
    )),
    Pass.aggregate([
      { $match: { ...scope, isCurrent: true } },
      { $group: { _id: null, passes: { $sum: 1 }, vehicles: { $sum: { $size: { $ifNull: ["$vehicles", []] } } } } },
    ]),
    PassCompany.countDocuments({ ...req.tenantFilter, isActive: true }),
    PassPayment.aggregate([
      { $match: { ...locationScopedFilter(req), amount: { $gt: 0 } } },
      { $lookup: { from: Pass.collection.name, localField: "passId", foreignField: "_id", as: "p", pipeline: [{ $project: { status: 1, startDate: 1, endDate: 1 } }] } },
      { $unwind: "$p" },
      { $match: { "p.status": "ACTIVE", "p.startDate": { $lte: now }, "p.endDate": { $gt: now } } },
      { $group: { _id: null, revenue: { $sum: "$amount" } } },
    ]),
    // Pass users: one per phone number (or per name when there is no phone).
    Pass.aggregate([
      { $match: { ...scope, isCurrent: true } },
      { $group: { _id: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$phone", ""] } }, 0] }, "$phone", { $toLower: "$holderName" }] } } },
      { $count: "users" },
    ]),
  ]);
  const states = Object.fromEntries(byState);
  res.json({
    success: true,
    data: {
      passes: vehicleRows[0] ? vehicleRows[0].passes : 0,
      vehicles: vehicleRows[0] ? vehicleRows[0].vehicles : 0,
      companies,
      users: userRows[0] ? userRows[0].users : 0,
      active: states.ACTIVE, expiring: states.EXPIRING, expired: states.EXPIRED, suspended: states.SUSPENDED, upcoming: states.UPCOMING,
      activeRevenue: revenueRows[0] ? round2(revenueRows[0].revenue) : 0,
    },
  });
};

// GET /api/passes/vehicles?q=&state=&passCompanyId=&page=
// Every vehicle on a current pass, one row each (a shared pass lists all its vehicles).
const listPassVehicles = async (req, res) => {
  const now = new Date();
  const conditions = [scopeFilter(req), stateFilter(req.query.state, now)];
  if (req.query.passCompanyId) {
    if (!mongoose.isValidObjectId(req.query.passCompanyId)) throw new AppError("Invalid company", 400);
    conditions.push({ passCompanyId: toId(req.query.passCompanyId) });
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  const plate = q ? normalizePlate(q) : "";
  const match = { $and: conditions };
  const exporting = wantsExport(req);
  const page = reportPage(req);

  const pipeline = [
    { $match: match },
    { $unwind: "$vehicles" },
    ...(q ? [{ $match: { $or: [{ "vehicles.number": { $regex: `^${escapeRegex(plate)}` } }, { holderName: { $regex: escapeRegex(q), $options: "i" } }, { "vehicles.tag": q.toUpperCase() }] } }] : []),
  ];
  const [rows, counted] = await Promise.all([
    Pass.aggregate([...pipeline, { $sort: { endDate: 1, "vehicles.number": 1 } }, { $skip: exporting ? 0 : (page - 1) * PAGE_SIZE }, { $limit: exporting ? CSV_LIMIT : PAGE_SIZE }]),
    Pass.aggregate([...pipeline, { $count: "total" }]),
  ]);
  const companies = await nameMap(PassCompany, rows.map((r) => r.passCompanyId));
  const data = rows.map((r) => ({
    vehicleNumber: r.vehicles.number,
    vehicleType: r.vehicles.type,
    tag: r.vehicles.tag || "",
    passNumber: r.passNumber,
    passId: r._id,
    holderName: r.holderName,
    phone: r.phone || "",
    company: r.passCompanyId && companies.get(String(r.passCompanyId)) ? companies.get(String(r.passCompanyId)).name : "",
    state: passes.passState(r, now),
    startDate: r.startDate,
    endDate: r.endDate,
  }));
  req.reportKey = "pass-vehicles";
  respond(req, res, "pass-vehicles", [
    { key: "vehicleNumber", label: "Vehicle" }, { key: "vehicleType", label: "Type" }, { key: "tag", label: "Tag" },
    { key: "passNumber", label: "Pass" }, { key: "holderName", label: "Holder" }, { key: "phone", label: "Phone" },
    { key: "company", label: "Company" }, { key: "state", label: "State" }, { key: "startDate", label: "From" }, { key: "endDate", label: "Valid until (day after)" },
  ], data, { total: counted[0] ? counted[0].total : 0, page, pageSize: PAGE_SIZE });
};

// GET /api/passes/invoices?from=&to=&locationId=&passCompanyId=&q=&page=
// Pass receipts: one row for every pass sale or renewal with the amount split into taxable value and tax.
const passInvoices = async (req, res) => {
  const filter = { ...locationScopedFilter(req), amount: { $gt: 0 } };
  if (req.query.locationId) {
    if (!mongoose.isValidObjectId(req.query.locationId)) throw new AppError("Invalid locationId", 400);
    filter.locationId = toId(req.query.locationId);
    // Never widen a location admin's view beyond their own locations.
    const scoped = locationScopedFilter(req).locationId;
    if (scoped && !scoped.$in.some((id) => String(id) === req.query.locationId)) throw new AppError("Location not found", 404);
  }
  const from = typeof req.query.from === "string" && req.query.from ? dayRange(req.query.from).start : null;
  const to = typeof req.query.to === "string" && req.query.to ? dayRange(req.query.to).end : null;
  if (from || to) filter.paidAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };

  // Narrowing by company or by who the pass is for means finding those passes first.
  const passConditions = [];
  if (req.query.passCompanyId) {
    if (!mongoose.isValidObjectId(req.query.passCompanyId)) throw new AppError("Invalid company", 400);
    passConditions.push({ passCompanyId: toId(req.query.passCompanyId) });
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  if (q) {
    passConditions.push({ $or: [
      { passNumber: q.toUpperCase() }, { holderName: { $regex: escapeRegex(q), $options: "i" } }, { phone: q },
      { "vehicles.number": { $regex: `^${escapeRegex(normalizePlate(q))}` } },
    ] });
  }
  if (passConditions.length) {
    filter.passId = { $in: await Pass.find({ $and: [{ companyId: req.companyId }, ...passConditions] }).distinct("_id") };
  }

  const exporting = wantsExport(req);
  const page = reportPage(req);
  const [payments, total, sums] = await Promise.all([
    PassPayment.find(filter).sort({ paidAt: -1 }).skip(exporting ? 0 : (page - 1) * PAGE_SIZE).limit(exporting ? CSV_LIMIT : PAGE_SIZE),
    PassPayment.countDocuments(filter),
    PassPayment.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: "$amount" }, tax: { $sum: "$tax" } } }]),
  ]);

  const passList = await Pass.find({ _id: { $in: payments.map((p) => p.passId) } })
    .select("passNumber holderName phone vehicleNumber passCompanyId").lean();
  const passBy = new Map(passList.map((p) => [String(p._id), p]));
  const [companies, locations, history] = await Promise.all([
    nameMap(PassCompany, passList.map((p) => p.passCompanyId), "name gstNumber"),
    nameMap(Location, payments.map((p) => p.locationId)),
    // The receipt's running number on its pass: 1 for the sale, 2 for the first renewal, and so on.
    PassPayment.find({ passId: { $in: passList.map((p) => p._id) }, amount: { $gt: 0 } }).sort({ paidAt: 1, _id: 1 }).select("passId").lean(),
  ]);
  const order = new Map();
  const seen = new Map();
  for (const h of history) {
    const n = (seen.get(String(h.passId)) || 0) + 1;
    seen.set(String(h.passId), n);
    order.set(String(h._id), n);
  }

  const rows = payments.map((pay) => {
    const pass = passBy.get(String(pay.passId)) || {};
    const company = pass.passCompanyId ? companies.get(String(pass.passCompanyId)) : null;
    return {
      receiptNumber: pass.passNumber ? `${pass.passNumber}/${order.get(String(pay._id)) || 1}` : String(pay._id),
      paidAt: pay.paidAt,
      kind: pay.kind,
      passId: pay.passId,
      passNumber: pass.passNumber || "",
      holder: pass.holderName || "",
      phone: pass.phone || "",
      vehicle: pass.vehicleNumber || "",
      company: company ? company.name : "",
      companyGst: company ? company.gstNumber || "" : "",
      location: (locations.get(String(pay.locationId)) || {}).name || "",
      periodStart: pay.periodStart,
      periodEnd: pay.periodEnd,
      method: pay.method,
      taxable: round2(pay.amount - (pay.tax || 0)),
      tax: round2(pay.tax || 0),
      total: round2(pay.amount),
      reference: pay.transactionId || "",
    };
  });

  const totals = sums[0] ? { total: round2(sums[0].amount), tax: round2(sums[0].tax), taxable: round2(sums[0].amount - sums[0].tax) } : { total: 0, tax: 0, taxable: 0 };
  req.reportKey = "pass-receipts";
  respond(req, res, "pass-receipts", [
    { key: "receiptNumber", label: "Receipt" }, { key: "paidAt", label: "Date" }, { key: "kind", label: "For" },
    { key: "holder", label: "Holder" }, { key: "phone", label: "Phone" }, { key: "vehicle", label: "Vehicle" },
    { key: "company", label: "Company" }, { key: "companyGst", label: "Company GST" }, { key: "location", label: "Location" },
    { key: "method", label: "Method" }, { key: "taxable", label: "Taxable" }, { key: "tax", label: "Tax" }, { key: "total", label: "Total" }, { key: "reference", label: "Reference" },
  ], rows, { total, totals, page, pageSize: PAGE_SIZE });
};

// POST /api/passes/bulk   { ids, action, days?, startDate?, endDate?, reason? }
// Changes several passes at once. No money is taken here: use Renew for a paid extension.
// UPDATE_TERM is the Update Pass window of the pass list: a new last day and charge (and, when given,
// a new first day) for every chosen pass. It does not take money: use Renew for a paid extension.
const BULK_ACTIONS = ["EXTEND", "SET_DATES", "UPDATE_TERM", "SUSPEND", "RESUME", "CANCEL"];
const bulkUpdate = async (req, res) => {
  const { ids, action, days, startDate, endDate, reason, amount } = req.body;
  if (!BULK_ACTIONS.includes(action)) throw new AppError("Unknown action", 400);
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError("Choose at least one pass", 400);
  if (action === "EXTEND" && !(days >= 1 && days <= 366)) throw new AppError("Enter the number of days to add (1 to 366)", 400);
  if ((action === "SUSPEND" || action === "CANCEL") && (!reason || String(reason).trim().length < 5)) throw new AppError("Give a reason (at least 5 letters)", 400);
  let newStart;
  let newEnd;
  if (action === "UPDATE_TERM") {
    if (!endDate) throw new AppError("Enter the date the passes are valid up to", 400);
    if (!(typeof amount === "number" && amount >= 0 && amount <= 10000000)) throw new AppError("Enter the amount (0 or more)", 400);
    newEnd = dayRange(endDate).end;
    if (startDate) {
      newStart = dayRange(startDate).start;
      if (newEnd <= newStart) throw new AppError("The last day must not be before the first day", 400);
    }
  }
  if (action === "SET_DATES") {
    if (!startDate || !endDate) throw new AppError("Enter both dates", 400);
    newStart = dayRange(startDate).start;
    newEnd = dayRange(endDate).end; // the pass runs through the whole last day
    if (newEnd <= newStart) throw new AppError("The last day must not be before the first day", 400);
  }

  const found = await Pass.find({ $and: [{ _id: { $in: ids.map(toId) } }, scopeFilter(req)] });
  const done = [];
  const skipped = [];
  for (const pass of found) {
    if (pass.status === "CANCELLED") { skipped.push({ passNumber: pass.passNumber, reason: "Already cancelled" }); continue; }
    if (action === "EXTEND") pass.endDate = addDaysLocal(pass.endDate, days);
    else if (action === "SET_DATES") { pass.startDate = newStart; pass.endDate = newEnd; }
    else if (action === "UPDATE_TERM") {
      if (!newStart && newEnd <= pass.startDate) { skipped.push({ passNumber: pass.passNumber, reason: "The last day is before this pass starts" }); continue; }
      if (newStart) pass.startDate = newStart;
      pass.endDate = newEnd;
      pass.amount = amount;
      pass.passInvoiceId = undefined;
    } else if (action === "SUSPEND") {
      if (pass.status !== "ACTIVE") { skipped.push({ passNumber: pass.passNumber, reason: "Not active" }); continue; }
      Object.assign(pass, { status: "SUSPENDED", statusReason: String(reason).trim(), statusChangedBy: req.user._id, statusChangedAt: new Date() });
    } else if (action === "RESUME") {
      if (pass.status !== "SUSPENDED") { skipped.push({ passNumber: pass.passNumber, reason: "Not suspended" }); continue; }
      Object.assign(pass, { status: "ACTIVE", statusReason: undefined, statusChangedBy: req.user._id, statusChangedAt: new Date() });
    } else if (action === "CANCEL") {
      Object.assign(pass, { status: "CANCELLED", statusReason: String(reason).trim(), statusChangedBy: req.user._id, statusChangedAt: new Date() });
    }
    await pass.save();
    if (action === "CANCEL") await Promise.all(passes.passVehicles(pass).map((v) => unlinkVehicle(pass.companyId, v.number, pass._id)));
    done.push(pass.passNumber);
  }
  skipped.push(...ids.filter((id) => !found.some((p) => String(p._id) === String(id))).map(() => ({ passNumber: "", reason: "Not found" })));

  await audit.record(req, "PASS_BULK_UPDATE", {
    entity: "Pass", companyId: req.companyId,
    meta: { action, changed: done.length, skipped: skipped.length, passNumbers: done.slice(0, 200), ...(days ? { days } : {}), ...(startDate || endDate ? { startDate, endDate } : {}), ...(amount !== undefined ? { amount } : {}), ...(reason ? { reason } : {}) },
  });
  res.json({ success: true, data: { changed: done.length, skipped } });
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

// GET /api/passes/users?q=&passCompanyId=&page=
// Pass users: the people (or firms' staff) who hold passes. Passes with the same phone number (or, with no
// phone, the same name) are one user. Counts are of current passes only.
const listPassUsers = async (req, res) => {
  const now = new Date();
  const conditions = [scopeFilter(req), { isCurrent: true }];
  if (req.query.passCompanyId) {
    if (!mongoose.isValidObjectId(req.query.passCompanyId)) throw new AppError("Invalid company", 400);
    conditions.push({ passCompanyId: toId(req.query.passCompanyId) });
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  if (q) {
    const like = { $regex: escapeRegex(q), $options: "i" };
    conditions.push({ $or: [{ holderName: like }, { phone: like }, { email: like }, { "vehicles.number": { $regex: `^${escapeRegex(normalizePlate(q))}` } }] });
  }
  const exporting = wantsExport(req);
  const page = reportPage(req);
  const live = { $and: [{ $eq: ["$status", "ACTIVE"] }, { $lte: ["$startDate", now] }, { $gt: ["$endDate", now] }] };
  const grouped = [
    { $match: { $and: conditions } },
    {
      $group: {
        _id: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$phone", ""] } }, 0] }, "$phone", { $toLower: "$holderName" }] },
        holderName: { $last: "$holderName" },
        phone: { $last: "$phone" },
        email: { $last: "$email" },
        passCompanyId: { $last: "$passCompanyId" },
        passes: { $sum: 1 },
        active: { $sum: { $cond: [live, 1, 0] } },
        vehicles: { $push: "$vehicles.number" },
        lastEnd: { $max: "$endDate" },
      },
    },
  ];
  const [rows, counted] = await Promise.all([
    Pass.aggregate([...grouped, { $sort: { holderName: 1 } }, { $skip: exporting ? 0 : (page - 1) * PAGE_SIZE }, { $limit: exporting ? CSV_LIMIT : PAGE_SIZE }]),
    Pass.aggregate([...grouped, { $count: "total" }]),
  ]);
  const companies = await nameMap(PassCompany, rows.map((r) => r.passCompanyId), "name gstNumber");
  const data = rows.map((r) => {
    const company = r.passCompanyId ? companies.get(String(r.passCompanyId)) : null;
    return {
      holderName: r.holderName,
      company: company ? company.name : "",
      phone: r.phone || "",
      email: r.email || "",
      gstNumber: company ? company.gstNumber || "" : "",
      vehicles: new Set(r.vehicles.flat()).size,
      passes: r.passes,
      active: r.active,
      lastEnd: r.lastEnd,
    };
  });
  req.reportKey = "pass-users";
  respond(req, res, "pass-users", [
    { key: "holderName", label: "Pass user" }, { key: "company", label: "Company" }, { key: "phone", label: "Mobile" }, { key: "email", label: "Email" },
    { key: "gstNumber", label: "Company GST no." }, { key: "vehicles", label: "Vehicles" }, { key: "passes", label: "Passes" }, { key: "active", label: "Active now" },
    { key: "lastEnd", label: "Latest end (day after)" },
  ], data, { total: counted[0] ? counted[0].total : 0, page, pageSize: PAGE_SIZE });
};

// POST /api/passes/bulk-upload   { locationId, rows: [...] }
// Sells many passes in one go (a company's staff, a society's residents). Each row is a normal sale: it
// takes money in the collecting person's shift and fails alone with a reason if something is wrong.
const MAX_BULK_ROWS = 200;
const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

const rowToBody = async (req, row, locationId) => {
  const vehicleType = text(row.vehicleType).toUpperCase();
  if (!VEHICLE_TYPES.includes(vehicleType)) throw new AppError(`Vehicle type must be one of ${VEHICLE_TYPES.join(", ")}`, 400);
  const amount = Number(text(row.amount) === "" ? 0 : row.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw new AppError("Amount must be a number, 0 or more", 400);
  const method = text(row.method).toUpperCase() || (amount === 0 ? "COMPLIMENTARY" : "CASH");
  const unit = text(row.unit).toUpperCase() || "MONTH";
  const count = text(row.count) === "" ? 1 : Number(row.count);
  if (!Number.isInteger(count) || count < 1 || count > 366) throw new AppError("Count must be a whole number from 1 to 366", 400);
  const passType = text(row.passType).toUpperCase() || "REGULAR";
  if (!PASS_TYPES.includes(passType)) throw new AppError(`Pass type must be one of ${PASS_TYPES.join(", ")}`, 400);
  const holderName = text(row.holderName);
  if (holderName.length < 2 || holderName.length > 100) throw new AppError("Holder name needs 2 to 100 letters", 400);
  const startDate = text(row.startDate);
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new AppError("Start date must look like 2026-03-02", 400);
  let passCompanyId;
  const companyName = text(row.company);
  if (companyName) {
    const company = await PassCompany.findOne({ ...req.tenantFilter, isActive: true, name: { $regex: `^${escapeRegex(companyName)}$`, $options: "i" } }).select("_id");
    if (!company) throw new AppError(`Company "${companyName}" is not in the company master. Add it first.`, 400);
    passCompanyId = String(company._id);
  }
  return {
    locationId, holderName, vehicleNumber: text(row.vehicleNumber), vehicleType, passType, unit, count, amount, method,
    ...(startDate ? { startDate } : {}),
    ...(text(row.phone) ? { phone: text(row.phone).slice(0, 20) } : {}),
    ...(text(row.email) ? { email: text(row.email) } : {}),
    ...(text(row.notes) ? { notes: text(row.notes).slice(0, 300) } : {}),
    ...(text(row.transactionId) ? { transactionId: text(row.transactionId) } : {}),
    ...(passCompanyId ? { passCompanyId } : {}),
  };
};

const bulkUpload = async (req, res) => {
  const { locationId, rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) throw new AppError("Add at least one row", 400);
  if (rows.length > MAX_BULK_ROWS) throw new AppError(`Upload at most ${MAX_BULK_ROWS} passes at a time`, 400);
  const results = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    try {
      const body = await rowToBody(req, row, locationId);
      const { pass } = await sellPass(req, body);
      results.push({ row: i + 1, ok: true, passNumber: pass.passNumber, vehicleNumber: pass.vehicleNumber, holderName: pass.holderName });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      results.push({ row: i + 1, ok: false, error: error.message, vehicleNumber: text(row.vehicleNumber), holderName: text(row.holderName) });
    }
  }
  const created = results.filter((r) => r.ok).length;
  await audit.record(req, "PASS_BULK_UPLOAD", { entity: "Pass", meta: { rows: rows.length, created, failed: rows.length - created, locationId } });
  res.status(created ? 201 : 200).json({ success: true, data: { created, failed: rows.length - created, results } });
};

module.exports = {
  createPass, renewPass, suspendPass, resumePass, cancelPass, updatePass, listPasses, getPass, lookupPass,
  addVehicle, removeVehicle, replaceVehicle, setVehicleTag, passSummary, listPassVehicles, passInvoices, bulkUpdate, listPassUsers, bulkUpload, sellPass, MAX_BULK_ROWS,
  setApproval, deletePasses, deletePass, renewDated, amountsOf, withState, checkPayment, findPassInScope: findInScope,
};
