const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const PassCharge = require("../models/PassCharge");
const Location = require("../models/Location");
const { getAccessibleLocation, locationsInScope } = require("../utils/scope");
const { priceFor } = require("../services/passChargeService");
const { VEHICLE_TYPES } = require("../models/constants");

const inScope = (req, locations) => ({ ...req.tenantFilter, locationId: { $in: locations.map((l) => l._id) } });

// GET /api/pass-charges: every rate of the locations this user works with.
const listCharges = async (req, res) => {
  const locations = await locationsInScope(req);
  const names = new Map(locations.map((l) => [String(l._id), l.name]));
  const rows = await PassCharge.find(inScope(req, locations)).lean();
  const charges = rows
    .map((r) => ({ ...r, locationName: names.get(String(r.locationId)) || "" }))
    .sort((a, b) => a.locationName.localeCompare(b.locationName) || a.vehicleType.localeCompare(b.vehicleType));
  res.json({ success: true, data: { charges } });
};

// POST /api/pass-charges { locationId, vehicleType, monthlyRate, dailyRate }: adds the rate, or changes it if it exists.
const saveCharge = async (req, res) => {
  const { locationId, vehicleType, monthlyRate, dailyRate } = req.body;
  const location = await getAccessibleLocation(req, locationId);
  if (!VEHICLE_TYPES.includes(vehicleType)) throw new AppError("Choose a vehicle type", 400);
  const charge = await PassCharge.findOneAndUpdate(
    { companyId: location.companyId, locationId: location._id, vehicleType },
    { $set: { monthlyRate, dailyRate, updatedBy: req.user._id } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  await audit.record(req, "PASS_CHARGE_SAVED", {
    entity: "PassCharge", entityId: charge._id, companyId: location.companyId,
    meta: { location: location.name, vehicleType, monthlyRate, dailyRate },
  });
  res.status(201).json({ success: true, data: charge });
};

// DELETE /api/pass-charges/:id
const removeCharge = async (req, res) => {
  const charge = await PassCharge.findOne({ _id: req.params.id, ...req.tenantFilter });
  if (!charge) throw new AppError("Rate not found", 404);
  await getAccessibleLocation(req, charge.locationId);
  await charge.deleteOne();
  const location = await Location.findById(charge.locationId).select("name");
  await audit.record(req, "PASS_CHARGE_REMOVED", {
    entity: "PassCharge", entityId: charge._id, companyId: charge.companyId,
    meta: { location: location && location.name, vehicleType: charge.vehicleType },
  });
  res.json({ success: true, data: { removed: true } });
};

// GET /api/pass-charges/quote?locationId=&vehicleType=&startDate=&endDate=
// What a pass would cost for those dates. { found: false } when the table has no rate for that location and vehicle.
const quote = async (req, res) => {
  const { locationId, vehicleType, startDate, endDate } = req.query;
  const location = await getAccessibleLocation(req, locationId);
  const rate = await PassCharge.findOne({ companyId: location.companyId, locationId: location._id, vehicleType }).lean();
  if (!rate) return res.json({ success: true, data: { found: false } });
  res.json({ success: true, data: { found: true, ...priceFor(rate, startDate, endDate) } });
};

module.exports = { listCharges, saveCharge, removeCharge, quote };
