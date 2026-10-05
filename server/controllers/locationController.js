const AppError = require("../utils/AppError");
const { isCompanyWide } = require("../config/permissions");
const audit = require("../services/auditService");
const Company = require("../models/Company");
const Location = require("../models/Location");
const { sumCounts } = require("../models/constants");

// Tenant filter, plus "only my assigned locations" for location-level roles.
const scopeFilter = (req) => {
  const filter = { ...req.tenantFilter };
  if (!isCompanyWide(req.user.role)) filter._id = { $in: req.user.locationIds };
  return filter;
};

const findInScope = async (req) => {
  const scope = scopeFilter(req);
  const location = await Location.findOne({ $and: [{ _id: req.params.id }, scope] });
  if (!location) throw new AppError("Location not found", 404);
  return location;
};

const requireCompanyWide = (req) => {
  if (!isCompanyWide(req.user.role)) {
    throw new AppError("Only a company admin can do this", 403);
  }
};

// GET /api/locations
const listLocations = async (req, res) => {
  const locations = await Location.find(scopeFilter(req)).sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, data: locations });
};

// GET /api/locations/:id
const getLocation = async (req, res) => {
  res.json({ success: true, data: await findInScope(req) });
};

// POST /api/locations
const createLocation = async (req, res) => {
  requireCompanyWide(req);

  const company = await Company.findById(req.companyId);
  if (!company) throw new AppError("Company not found", 404);

  const active = await Location.countDocuments({ companyId: req.companyId, isActive: true });
  if (active >= company.plan.maxLocations) {
    throw new AppError(
      `Your plan allows ${company.plan.maxLocations} parking locations. Upgrade to add more.`,
      403
    );
  }

  // companyId always comes from the logged-in user, never from the request body.
  const location = await Location.create({ ...req.body, companyId: req.companyId });
  await audit.record(req, "LOCATION_CREATE", { entity: "Location", entityId: location._id });

  res.status(201).json({ success: true, data: location });
};

// PUT /api/locations/:id
const updateLocation = async (req, res) => {
  const location = await findInScope(req);
  const { address, coordinates, contact, operatingHours, capacity, isActive, receiptSettings, onlineBooking, ...simple } = req.body;

  if (isActive !== undefined) {
    requireCompanyWide(req);
    location.isActive = isActive;
  }
  Object.assign(location, simple);
  if (address) Object.assign(location.address, address);
  if (coordinates && coordinates.clear) location.set("coordinates", undefined);
  else if (coordinates) {
    const { clear: _clear, ...point } = coordinates;
    Object.assign(location.coordinates, point);
  }
  if (contact) Object.assign(location.contact, contact);
  if (operatingHours) Object.assign(location.operatingHours, operatingHours);
  if (receiptSettings) Object.assign(location.receiptSettings, receiptSettings);
  if (onlineBooking) {
    const { fees, ...rest } = onlineBooking;
    location.onlineBooking = location.onlineBooking || {};
    Object.assign(location.onlineBooking, rest);
    if (fees) for (const [type, fee] of Object.entries(fees)) location.onlineBooking.fees[type] = fee;
  }
  if (capacity) {
    for (const [type, total] of Object.entries(capacity)) {
      if (total < location.occupied[type]) {
        throw new AppError(
          `Capacity for ${type} cannot be lower than the ${location.occupied[type]} vehicles parked now`,
          400
        );
      }
      location.capacity[type] = total;
    }
  }

  await location.save();
  await audit.record(req, "LOCATION_UPDATE", {
    entity: "Location", entityId: location._id, companyId: location.companyId,
    meta: { changed: Object.keys(req.body) },
  });

  res.json({ success: true, data: location });
};

// DELETE /api/locations/:id
// Locations are deactivated, not removed, so parking history stays intact.
const deactivateLocation = async (req, res) => {
  requireCompanyWide(req);
  const location = await findInScope(req);

  const parked = sumCounts(location.occupied);
  if (parked > 0) {
    throw new AppError(`Cannot close this location while ${parked} vehicles are parked`, 409);
  }

  location.isActive = false;
  await location.save();
  await audit.record(req, "LOCATION_DEACTIVATE", {
    entity: "Location", entityId: location._id, companyId: location.companyId,
  });

  res.json({ success: true, data: location });
};

module.exports = { listLocations, getLocation, createLocation, updateLocation, deactivateLocation };
