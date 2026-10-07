const AppError = require("../utils/AppError");
const { isCompanyWide } = require("../config/permissions");
const audit = require("../services/auditService");
const Company = require("../models/Company");
const Location = require("../models/Location");
const { sumCounts, VEHICLE_KEYS } = require("../models/constants");
const { buildReportFile, formatOf } = require("../services/reportExport");
const { runRule } = require("../services/operationsService");
const licences = require("../services/licenceService");
const { resolveOperations } = require("../utils/operations");
const reEntries = require("../services/reEntryService");
const lanes = require("../services/laneService");

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

  if (req.body.gates) req.body.gates = (await lanes.planGateChange({ gates: [] }, req.body.gates)).gates;

  // companyId always comes from the logged-in user, never from the request body.
  const location = await Location.create({ ...req.body, companyId: req.companyId });
  await audit.record(req, "LOCATION_CREATE", { entity: "Location", entityId: location._id });

  res.status(201).json({ success: true, data: location });
};

// PUT /api/locations/:id
const updateLocation = async (req, res) => {
  const location = await findInScope(req);
  const { address, coordinates, contact, operatingHours, capacity, isActive, receiptSettings, onlineBooking, operations, reportRecipients, ...simple } = req.body;

  // Lane names must be unique, and a lane that operators or devices use cannot be dropped.
  let renames = [];
  if (simple.gates) {
    const plan = await lanes.planGateChange(location, simple.gates);
    simple.gates = plan.gates;
    ({ renames } = plan);
  }

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
  if (reportRecipients) location.reportRecipients = [...new Set(reportRecipients.map((e) => e.trim().toLowerCase()))].slice(0, 10);
  if (operations) {
    location.operations = location.operations || {};
    Object.assign(location.operations, operations);
  }
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
  await lanes.applyRenames(location, renames);
  await audit.record(req, "LOCATION_UPDATE", {
    entity: "Location", entityId: location._id, companyId: location.companyId,
    meta: { changed: Object.keys(req.body) },
  });

  res.json({ success: true, data: location });
};

// GET /api/locations/:id/lanes?q=&page=&limit=
const listLanes = async (req, res) => {
  const location = await findInScope(req);
  const { q, page, limit } = req.query;
  const data = await lanes.laneRows(location, {
    q: typeof q === "string" ? q.slice(0, 100) : "",
    page: typeof page === "string" ? page : 1,
    limit: typeof limit === "string" ? limit : 10,
  });
  res.json({ success: true, data });
};

// PATCH /api/locations/:id/lanes/:laneId/status {isActive}: switches one lane on or off.
const setLaneStatus = async (req, res) => {
  const location = await findInScope(req);
  const lane = location.gates.id(req.params.laneId);
  if (!lane) throw new AppError("Lane not found", 404);
  lane.isActive = req.body.isActive;
  await location.save();
  await audit.record(req, req.body.isActive ? "LOCATION_LANE_ON" : "LOCATION_LANE_OFF", {
    entity: "Location", entityId: location._id, companyId: location.companyId, meta: { lane: lane.name },
  });
  res.json({ success: true, data: { _id: lane._id, name: lane.name, isActive: lane.isActive } });
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

const yes = (value) => (value ? "Yes" : "No");

// GET /api/locations/export?format=csv|xlsx|pdf: the table on the Locations page as a file.
const exportLocations = async (req, res) => {
  const format = formatOf(req) || "xlsx";
  const [company, locations] = await Promise.all([
    Company.findById(req.companyId),
    Location.find(scopeFilter(req)).sort({ name: 1 }).limit(500),
  ]);
  const overview = company ? await licences.overview(company, locations) : { locations: [], validUpto: null };
  const byId = Object.fromEntries(overview.locations.map((row) => [String(row.locationId), row]));

  const columns = [
    { key: "sn", label: "SN" }, { key: "name", label: "Location" }, { key: "type", label: "Parking type" },
    { key: "users", label: "Users (in use / licence)" }, { key: "validUpto", label: "Valid upto" },
    { key: "photo", label: "Photo auto capture" }, { key: "printPhoto", label: "Print photo" },
    { key: "exitEdit", label: "Exit amount edit" }, { key: "reEntry", label: "Allow re-entry" },
    { key: "ticketNo", label: "Print ticket no." }, { key: "passReceipt", label: "Print receipt pass vehicle" },
    { key: "autoExit", label: "Auto exit" }, { key: "capacity", label: "Capacity" }, { key: "lanes", label: "Lanes" },
    { key: "status", label: "Status" },
  ];
  const rows = locations.map((location, i) => {
    const ops = resolveOperations(location.operations);
    const licence = byId[String(location._id)] || {};
    const rules = (location.operations && location.operations.autoExitRules) || [];
    return {
      sn: i + 1, name: location.name, type: location.parkingType || "NORMAL",
      users: licence.limit === null || licence.limit === undefined ? `${licence.used || 0}` : `${licence.used || 0} / ${licence.limit}`,
      validUpto: overview.validUpto ? new Date(overview.validUpto).toISOString().slice(0, 10) : "",
      photo: yes(ops.photoAutoCapture), printPhoto: yes(ops.printPhoto), exitEdit: yes(ops.exitAmountEdit),
      reEntry: yes(ops.allowReEntry), ticketNo: yes(ops.printTicketNumber), passReceipt: yes(ops.printPassReceipt),
      autoExit: ops.autoExitHours > 0 || rules.some((r) => r.active) ? "On" : "Off",
      capacity: VEHICLE_KEYS.reduce((sum, key) => sum + ((location.capacity && location.capacity[key]) || 0), 0),
      lanes: (location.gates || []).length, status: location.isActive ? "Active" : "Closed",
    };
  });
  const file = buildReportFile({
    format, name: "parking-locations", report: "location-list", columns, rows, extra: {}, company: company ? company.name : "", scope: "",
  });
  res.set({ "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" });
  res.send(file.buffer);
};

// POST /api/locations/:id/auto-exit/run {vehicleType}: applies one vehicle type's auto exit rule now.
const runAutoExit = async (req, res) => {
  const location = await findInScope(req);
  const rule = ((location.operations && location.operations.autoExitRules) || []).find((r) => r.vehicleType === req.body.vehicleType);
  if (!rule) throw new AppError("Set and save the auto exit rule for this vehicle type first", 404);
  if (!rule.active) throw new AppError("This rule is switched off", 409);
  const closed = await runRule(location, rule);
  await audit.record(req, "LOCATION_AUTO_EXIT_RUN", {
    entity: "Location", entityId: location._id, companyId: location.companyId, meta: { vehicleType: rule.vehicleType, closed },
  });
  res.json({ success: true, data: { closed } });
};

// GET /api/locations/:id/re-entries: the limit and today's re-entries per operator (admins only).
const reEntryCounter = async (req, res) => {
  const location = await findInScope(req);
  res.json({ success: true, data: await reEntries.overview(location) });
};

// POST /api/locations/:id/re-entries/reset: starts the count again from now.
const resetReEntryCounter = async (req, res) => {
  const location = await findInScope(req);
  location.operations = location.operations || {};
  location.operations.reEntryCountFrom = new Date();
  await location.save();
  await audit.record(req, "LOCATION_REENTRY_COUNTER_RESET", {
    entity: "Location", entityId: location._id, companyId: location.companyId,
  });
  res.json({ success: true, data: await reEntries.overview(location) });
};

module.exports = { listLanes, setLaneStatus, reEntryCounter, resetReEntryCounter, exportLocations, runAutoExit, listLocations, getLocation, createLocation, updateLocation, deactivateLocation };
