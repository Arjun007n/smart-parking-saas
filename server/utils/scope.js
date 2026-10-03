const mongoose = require("mongoose");
const AppError = require("./AppError");
const { isCompanyWide } = require("../config/permissions");
const Location = require("../models/Location");

// Query filter for records that carry `locationId`: the user's company, and
// for location-level roles only the locations assigned to them.
const locationScopedFilter = (req) => {
  const filter = { ...req.tenantFilter };
  if (!isCompanyWide(req.user.role)) filter.locationId = { $in: Array.from(req.user.locationIds) };
  return filter;
};

// Loads a location the user is allowed to work with, or answers 404.
// Use before creating anything that belongs to a location.
const getAccessibleLocation = async (req, locationId, { mustBeActive = false } = {}) => {
  if (!mongoose.isValidObjectId(locationId)) throw new AppError("Invalid locationId", 400);

  const allowed =
    isCompanyWide(req.user.role) || req.user.locationIds.some((id) => String(id) === String(locationId));
  const location = allowed ? await Location.findOne({ _id: locationId, ...req.tenantFilter }) : null;

  if (!location) throw new AppError("Location not found", 404);
  if (mustBeActive && !location.isActive) throw new AppError("This location is closed", 409);
  return location;
};

// Reads an optional ?locationId= filter from the query string.
const locationIdFromQuery = (req) => {
  const { locationId } = req.query;
  if (locationId === undefined || locationId === "") return null;
  if (typeof locationId !== "string" || !mongoose.isValidObjectId(locationId)) {
    throw new AppError("Invalid locationId", 400);
  }
  return locationId;
};

// The locations a report or dashboard covers: every location the user may
// see, or just the one asked for with ?locationId=.
const locationsInScope = async (req, { activeOnly = false } = {}) => {
  const locationId = locationIdFromQuery(req);
  if (locationId) return [await getAccessibleLocation(req, locationId)];

  const filter = { ...req.tenantFilter };
  if (!isCompanyWide(req.user.role)) filter._id = { $in: Array.from(req.user.locationIds) };
  if (activeOnly) filter.isActive = true;
  return Location.find(filter).sort({ name: 1 }).limit(1000);
};

// Reads an optional ?operatorId= filter.
const operatorIdFromQuery = (req) => {
  const { operatorId } = req.query;
  if (operatorId === undefined || operatorId === "") return null;
  if (typeof operatorId !== "string" || !mongoose.isValidObjectId(operatorId)) {
    throw new AppError("Invalid operatorId", 400);
  }
  return new mongoose.Types.ObjectId(operatorId);
};

module.exports = {
  locationScopedFilter, getAccessibleLocation, locationIdFromQuery, locationsInScope, operatorIdFromQuery,
};
