const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { calculateFee, tariffProblem } = require("../services/tariffService");
const { findTariffFor } = require("../services/tariffLookup");
const { locationScopedFilter, getAccessibleLocation, locationIdFromQuery } = require("../utils/scope");
const Tariff = require("../models/Tariff");
const { VEHICLE_TYPES } = require("../models/constants");

const findInScope = async (req) => {
  const tariff = await Tariff.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!tariff) throw new AppError("Tariff not found", 404);
  return tariff;
};

const checkRules = (tariff) => {
  const problem = tariffProblem(tariff);
  if (problem) throw new AppError(problem, 400);
};

const sortSlabs = (slabs) => [...slabs].sort((a, b) => a.uptoMinutes - b.uptoMinutes);

// GET /api/tariffs?locationId=&vehicleType=
const listTariffs = async (req, res) => {
  const conditions = [locationScopedFilter(req)];
  const locationId = locationIdFromQuery(req);
  if (locationId) conditions.push({ locationId });
  if (VEHICLE_TYPES.includes(req.query.vehicleType)) conditions.push({ vehicleType: req.query.vehicleType });

  const tariffs = await Tariff.find({ $and: conditions }).sort({ isActive: -1, createdAt: -1 }).limit(500);
  res.json({ success: true, data: tariffs });
};

// GET /api/tariffs/:id
const getTariff = async (req, res) => {
  res.json({ success: true, data: await findInScope(req) });
};

// POST /api/tariffs
const createTariff = async (req, res) => {
  const { locationId, slabs = [], ...rest } = req.body;
  const location = await getAccessibleLocation(req, locationId);

  const tariff = new Tariff({
    ...rest,
    slabs: sortSlabs(slabs),
    locationId: location._id,
    companyId: location.companyId,
  });
  checkRules(tariff);
  await tariff.save();
  await audit.record(req, "TARIFF_CREATE", {
    entity: "Tariff", entityId: tariff._id, companyId: tariff.companyId,
  });

  res.status(201).json({ success: true, data: tariff });
};

// Fields that can be cleared by sending null.
const CLEARABLE = [
  "maxDailyFee", "overnightFee", "lostTicketFee", "validFrom", "validTo",
  "startTime", "endTime", "flatFee", "longStayAfterMinutes", "longStayDailyRate", "eventName",
];

// PUT /api/tariffs/:id
const updateTariff = async (req, res) => {
  const tariff = await findInScope(req);
  const { slabs, ...rest } = req.body;
  // What the money fields were before the change, so the audit log shows old and new values.
  const before = {};
  for (const key of [...Object.keys(rest), ...req.cleared]) before[key] = tariff[key] === undefined ? null : tariff[key];
  const beforeSlabs = slabs ? JSON.stringify(tariff.slabs || []).slice(0, 2000) : undefined;

  Object.assign(tariff, rest);
  if (slabs) tariff.slabs = sortSlabs(slabs);
  for (const field of CLEARABLE) {
    if (req.cleared.includes(field)) tariff[field] = undefined;
  }
  checkRules(tariff);
  await tariff.save();
  await audit.record(req, "TARIFF_UPDATE", {
    entity: "Tariff", entityId: tariff._id, companyId: tariff.companyId,
    meta: {
      changed: [...Object.keys(req.body), ...req.cleared],
      before,
      after: Object.fromEntries(Object.keys(before).map((key) => [key, tariff[key] === undefined ? null : tariff[key]])),
      ...(beforeSlabs !== undefined ? { slabsBefore: beforeSlabs, slabsAfter: JSON.stringify(tariff.slabs || []).slice(0, 2000) } : {}),
    },
  });

  res.json({ success: true, data: tariff });
};

// DELETE /api/tariffs/:id
// Tariffs are switched off, not removed: past sessions still refer to them.
const deactivateTariff = async (req, res) => {
  const tariff = await findInScope(req);
  tariff.isActive = false;
  await tariff.save();
  await audit.record(req, "TARIFF_DEACTIVATE", {
    entity: "Tariff", entityId: tariff._id, companyId: tariff.companyId,
  });
  res.json({ success: true, data: tariff });
};

// POST /api/tariffs/preview
// "What would this stay cost?" Uses the same engine as the real exit.
const previewFee = async (req, res) => {
  const { locationId, vehicleType, entryTime, exitTime, lostTicket, hasValidPass, discountPercent } = req.body;
  const location = await getAccessibleLocation(req, locationId);

  const tariff = await findTariffFor({
    companyId: location.companyId, locationId: location._id, vehicleType, entryTime,
  });
  const fee = calculateFee(tariff, { entryTime, exitTime, lostTicket, hasValidPass, discountPercent });

  res.json({ success: true, data: { tariff: { _id: tariff._id, name: tariff.name }, fee } });
};

module.exports = {
  CLEARABLE, listTariffs, getTariff, createTariff, updateTariff, deactivateTariff, previewFee,
};
