const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { parsePlate, normalizePlate, escapeRegex } = require("../utils/plate");
const Vehicle = require("../models/Vehicle");
const { can } = require("../middleware/permission");
const { PERMISSIONS: P } = require("../config/permissions");

const PAGE_SIZE = 50;

// Phone numbers are shown in full only to people who manage vehicles or see reports; gate staff see the last digits.
const maskPhone = (phone) => {
  if (typeof phone !== "string" || !phone) return phone;
  const keep = phone.length > 6 ? 4 : 2;
  return phone.length <= keep ? phone.replace(/./g, "*") : `${"*".repeat(phone.length - keep)}${phone.slice(-keep)}`;
};
const canSeePhones = (req) => can(req, P.VEHICLE_MANAGE) || can(req, P.REPORT_VIEW);
const shown = (req, vehicle) => {
  if (canSeePhones(req) || !vehicle || !vehicle.phone) return vehicle;
  return { ...vehicle.toJSON(), phone: maskPhone(vehicle.phone) };
};

const findInTenant = async (req) => {
  const vehicle = await Vehicle.findOne({ _id: req.params.id, ...req.tenantFilter });
  if (!vehicle) throw new AppError("Vehicle not found", 404);
  return vehicle;
};

// GET /api/vehicles?q=&blocked=true&page=1
// `q` matches the start of a vehicle number, or a full phone number.
const listVehicles = async (req, res) => {
  const filter = { ...req.tenantFilter };
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 30) : "";
  if (q) {
    filter.$or = [
      { plateNumber: { $regex: `^${escapeRegex(normalizePlate(q))}` } },
      { phone: q },
    ];
  }
  if (req.query.blocked === "true") filter.isBlocked = true;

  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const [vehicles, total] = await Promise.all([
    Vehicle.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    Vehicle.countDocuments(filter),
  ]);

  res.json({ success: true, data: { vehicles: vehicles.map((v) => shown(req, v)), total, page, pageSize: PAGE_SIZE } });
};

// GET /api/vehicles/:id
const getVehicle = async (req, res) => {
  res.json({ success: true, data: shown(req, await findInTenant(req)) });
};

// POST /api/vehicles
const createVehicle = async (req, res) => {
  const plateNumber = parsePlate(req.body.plateNumber);
  if (await Vehicle.exists({ companyId: req.companyId, plateNumber })) {
    throw new AppError(`Vehicle ${plateNumber} is already registered`, 409);
  }

  const vehicle = await Vehicle.create({ ...req.body, plateNumber, companyId: req.companyId });
  await audit.record(req, "VEHICLE_CREATE", { entity: "Vehicle", entityId: vehicle._id });

  res.status(201).json({ success: true, data: vehicle });
};

// PUT /api/vehicles/:id
// The vehicle number itself cannot be changed; register a new vehicle instead.
const updateVehicle = async (req, res) => {
  const vehicle = await findInTenant(req);
  const { isBlocked, blockedReason, ...rest } = req.body;
  Object.assign(vehicle, rest);

  let action = "VEHICLE_UPDATE";
  if (isBlocked === true) {
    const reason = blockedReason || vehicle.blockedReason;
    if (!reason) throw new AppError("Give a reason for blocking this vehicle", 400);
    vehicle.isBlocked = true;
    vehicle.blockedReason = reason;
    action = "VEHICLE_BLOCK";
  } else if (isBlocked === false) {
    vehicle.isBlocked = false;
    vehicle.blockedReason = undefined;
    action = "VEHICLE_UNBLOCK";
  }

  await vehicle.save();
  await audit.record(req, action, {
    entity: "Vehicle", entityId: vehicle._id, companyId: vehicle.companyId,
    meta: { changed: Object.keys(req.body) },
  });

  res.json({ success: true, data: vehicle });
};

module.exports = { maskPhone, listVehicles, getVehicle, createVehicle, updateVehicle };
