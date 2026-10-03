const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { locationScopedFilter, getAccessibleLocation, locationIdFromQuery } = require("../utils/scope");
const ParkingSlot = require("../models/ParkingSlot");
const { SLOT_STATUSES } = require("../models/constants");

// Bay-level layout (plan, Day 9). The MVP counts capacity on the Location;
// slots are optional detail for sites that want named bays.

const findInScope = async (req) => {
  const slot = await ParkingSlot.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!slot) throw new AppError("Slot not found", 404);
  return slot;
};

// GET /api/slots?locationId=
const listSlots = async (req, res) => {
  const locationId = locationIdFromQuery(req);
  if (!locationId) throw new AppError("locationId is required", 400);
  const location = await getAccessibleLocation(req, locationId);

  const slots = await ParkingSlot.find({ locationId: location._id }).sort({ code: 1 }).limit(5000);
  const summary = Object.fromEntries(SLOT_STATUSES.map((status) => [status, 0]));
  for (const slot of slots) summary[slot.status] += 1;

  res.json({ success: true, data: { slots, summary: { total: slots.length, ...summary } } });
};

// POST /api/slots
const createSlot = async (req, res) => {
  const { locationId, ...rest } = req.body;
  const location = await getAccessibleLocation(req, locationId, { mustBeActive: true });

  const slot = await ParkingSlot.create({ ...rest, locationId: location._id, companyId: location.companyId });
  await audit.record(req, "SLOT_CREATE", { entity: "ParkingSlot", entityId: slot._id, companyId: slot.companyId });

  res.status(201).json({ success: true, data: slot });
};

// POST /api/slots/bulk
// Creates a run of slots, for example prefix "A" from 1, count 20 -> A01..A20.
// Codes that already exist are skipped.
const createSlotsBulk = async (req, res) => {
  const { locationId, prefix = "", start = 1, count, ...rest } = req.body;
  const location = await getAccessibleLocation(req, locationId, { mustBeActive: true });

  const width = Math.max(2, String(start + count - 1).length);
  const codes = Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(width, "0")}`);

  const existing = await ParkingSlot.find({ locationId: location._id, code: { $in: codes } }).distinct("code");
  const fresh = codes.filter((code) => !existing.includes(code));

  const created = fresh.length
    ? await ParkingSlot.insertMany(
        fresh.map((code) => ({ ...rest, code, locationId: location._id, companyId: location.companyId }))
      )
    : [];
  await audit.record(req, "SLOT_BULK_CREATE", {
    entity: "Location", entityId: location._id, companyId: location.companyId,
    meta: { created: created.length, skipped: existing.length },
  });

  res.status(201).json({ success: true, data: { created: created.length, skipped: existing } });
};

// PUT /api/slots/:id
const updateSlot = async (req, res) => {
  const slot = await findInScope(req);
  const { status, ...rest } = req.body;

  if (status !== undefined && status !== slot.status) {
    // OCCUPIED is set by vehicle entry/exit only, never by hand.
    if (slot.status === "OCCUPIED") throw new AppError("This slot is occupied. It frees up when the vehicle exits.", 409);
    slot.status = status;
  }
  Object.assign(slot, rest);
  await slot.save();
  await audit.record(req, "SLOT_UPDATE", {
    entity: "ParkingSlot", entityId: slot._id, companyId: slot.companyId, meta: { changed: Object.keys(req.body) },
  });

  res.json({ success: true, data: slot });
};

// DELETE /api/slots/:id
const deleteSlot = async (req, res) => {
  const slot = await findInScope(req);
  if (slot.status === "OCCUPIED") throw new AppError("Cannot remove a slot while a vehicle is parked in it", 409);

  await slot.deleteOne();
  await audit.record(req, "SLOT_DELETE", {
    entity: "ParkingSlot", entityId: slot._id, companyId: slot.companyId, meta: { code: slot.code },
  });

  res.json({ success: true, data: { _id: slot._id } });
};

module.exports = { listSlots, createSlot, createSlotsBulk, updateSlot, deleteSlot };
