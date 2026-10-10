// Lane assignment: a company admin can tie an operator (or supervisor) to particular lanes
// (gates) of a location. Someone with no lanes listed for a location may use all of its lanes.

const AppError = require("../utils/AppError");
const User = require("../models/User");
const Hardware = require("../models/Hardware");
const { ROLES } = require("../config/permissions");
const { vehicleClassOf } = require("../models/constants");
const Location = require("../models/Location");
const { withStatus } = require("./hardwareService");

// Lanes. A lane is one gate of a location for one direction and one kind of vehicle, listed as
// "Car-Entry", "Bike-Exit" ... with its own Door/Lane No. and Reader No. (the same set-up as the Parking
// Lane page of ismartparking.com). A location whose gates have a vehicle lane is a "lane location": its
// gate staff must be given lanes, a lane has one operator, and a lane takes only its own class of vehicle
// (a bike lane takes two-wheelers, every other lane four-wheelers). Gates with no `lane` (set up before lanes
// existed) keep working as they always did.
const CLASS_LABEL = { TWO_WHEELER: "two-wheeler", FOUR_WHEELER: "four-wheeler" };
const LANE_STAFF = [ROLES.GATE_OPERATOR, ROLES.ENTRY_OPERATOR, ROLES.EXIT_OPERATOR];
// The short vehicle name a lane carries ("Car-Entry").
const LANE_LABEL = { CAR: "Car", BIKE: "Bike", HEAVY: "Heavy", TAXI: "Taxi", TEMPO: "Tempo" };

const isLaneLocation = (location) => (location.gates || []).some((g) => g.lane);

// Refuses a vehicle the lane does not take (a car at the bike lane, a bike at a car lane).
const assertVehicleFits = (location, gate, vehicleType) => {
  if (!gate || !vehicleType) return;
  const found = (location.gates || []).find((g) => g.name === gate);
  if (!found || !found.vehicleClass) return;
  if (vehicleClassOf(vehicleType) !== found.vehicleClass) {
    const other = found.vehicleClass === "TWO_WHEELER" ? "four-wheeler" : "two-wheeler";
    throw new AppError(
      `${found.name} is for ${CLASS_LABEL[found.vehicleClass]}s only. Send this ${vehicleType.toLowerCase()} to a ${other} lane.`,
      400,
    );
  }
};

// A lane is on unless an admin switched it off (lanes saved before the switch existed have no value).
const isLaneActive = (lane) => !lane || lane.isActive !== false;

// Refuses work at a lane that is switched off. A lane the location does not list is left to the callers' own checks.
const assertLaneActive = (location, gate) => {
  if (!gate) return;
  const lane = (location.gates || []).find((g) => g.name === gate);
  if (lane && !isLaneActive(lane)) throw new AppError(`Lane ${gate} is switched off`, 409);
};

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// How many operators and devices are tied to a lane by name.
const usageOf = async (location, name) => {
  const [operators, devices] = await Promise.all([
    User.countDocuments({ lanes: { $elemMatch: { locationId: location._id, gate: name } } }),
    Hardware.countDocuments({ locationId: location._id, gate: name }),
  ]);
  return { operators, devices };
};

const DIRECTION_LABEL = { ENTRY: "Entry", EXIT: "Exit" };

// A lane's name: "Car-Entry"; a second one is "Car-Entry 2". `taken` holds the names already used.
const laneName = (vehicleType, type, taken) => {
  const base = `${LANE_LABEL[vehicleType]}-${DIRECTION_LABEL[type]}`;
  const used = new Set([...taken].map((n) => String(n).toLowerCase()));
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} ${n}`;
  return name;
};

// Sets what follows from a lane's vehicle type.
const fillLane = (gate) => {
  gate.lane = LANE_LABEL[gate.vehicleType];
  gate.vehicleClass = vehicleClassOf(gate.vehicleType);
};

// Which of the four lanes every location needs (entry and exit, for two-wheelers and for four-wheelers) are missing.
const setupGaps = (gates) => {
  const gaps = [];
  for (const [vehicleClass, label] of [["TWO_WHEELER", "2-wheeler"], ["FOUR_WHEELER", "4-wheeler"]]) {
    for (const type of ["ENTRY", "EXIT"]) {
      const there = gates.some((g) => g.vehicleClass === vehicleClass && (g.type === type || g.type === "BOTH"));
      if (!there) gaps.push(`${label} ${type.toLowerCase()}`);
    }
  }
  return gaps;
};

// The rules for a list of gates that has lanes: every gate is a lane for one vehicle type and one direction,
// and the location has an entry lane and an exit lane for two-wheelers and for four-wheelers.
const checkLaneSetup = (gates, hadLanes) => {
  const withLane = gates.filter((g) => g.lane && g.lane.trim());
  if (!withLane.length) {
    if (hadLanes) throw new AppError("This location works with lanes. Keep an entry lane and an exit lane for two-wheelers and for four-wheelers.", 400);
    return;
  }
  if (withLane.length !== gates.length) throw new AppError("Every gate must be a lane with a vehicle type", 400);
  for (const gate of gates) {
    if (!gate.vehicleType) throw new AppError(`Choose the vehicle for lane "${gate.name}"`, 400);
    if (gate.type !== "ENTRY" && gate.type !== "EXIT") throw new AppError(`Lane "${gate.name}" is for entry or for exit`, 400);
    fillLane(gate);
  }
  const gaps = setupGaps(gates);
  if (gaps.length) throw new AppError(`A location needs lanes for two-wheelers and four-wheelers, entry and exit. Missing: ${gaps.join(", ")}`, 400);
};

// The number a location's doors and readers start from: its place among the company's locations (L1, L2 ...).
const locationSerial = async (companyId, location) => {
  const filter = { companyId };
  if (location && location.createdAt) filter.createdAt = { $lte: location.createdAt };
  const count = await Location.countDocuments(filter);
  return location && location.createdAt ? count : count + 1;
};

// Gives each lane that has none its Door/Lane No. ("L1D3") and Reader No. ("L1R3"): the next number free in the location.
const numberLanes = async (companyId, location, gates) => {
  const used = (field, letter) => gates
    .map((g) => String(g[field] || "").match(new RegExp(`${letter}(\\d+)$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const lanes = gates.filter((g) => g.lane && (!g.doorNo || !g.readerNo));
  if (!lanes.length) return;
  const serial = await locationSerial(companyId, location);
  let door = Math.max(0, ...used("doorNo", "D"));
  let reader = Math.max(0, ...used("readerNo", "R"));
  for (const gate of lanes) {
    if (!gate.doorNo) gate.doorNo = `L${serial}D${(door += 1)}`;
    if (!gate.readerNo) gate.readerNo = `L${serial}R${(reader += 1)}`;
  }
};

// Works out what a new list of gates means for the gates the location has now.
// - Two gates cannot share a name (capital letters do not make a name different).
// - A gate in the new list is the same gate as an old one when it carries the old one's _id, or, with no _id,
//   when it has the same name. A different name on the same gate is a rename.
// - An old gate missing from the new list is a removal. It is refused while operators or devices are tied to it.
// Returns the clean list and the renames still to be copied to operators and devices.
const planGateChange = async (location, incoming, { companyId } = {}) => {
  const gates = incoming.map((g) => ({ ...g, name: g.name.trim() }));

  const seen = new Set();
  for (const gate of gates) {
    const key = gate.name.toLowerCase();
    if (seen.has(key)) throw new AppError(`Two lanes are called "${gate.name}". Give each lane its own name.`, 400);
    seen.add(key);
  }

  checkLaneSetup(gates, isLaneLocation(location));

  const old = location.gates || [];
  const taken = new Set();
  const renames = [];
  for (const gate of gates) {
    const before = (gate._id && old.find((o) => String(o._id) === String(gate._id)))
      || old.find((o) => !taken.has(String(o._id)) && sameName(o.name, gate.name));
    if (!before || taken.has(String(before._id))) {
      delete gate._id; // a new lane gets its own id
      continue;
    }
    taken.add(String(before._id));
    gate._id = before._id;
    if (gate.isActive === undefined) gate.isActive = isLaneActive(before);
    // The numbers a lane was given stay with it.
    if (!gate.doorNo && before.doorNo) gate.doorNo = before.doorNo;
    if (!gate.readerNo && before.readerNo) gate.readerNo = before.readerNo;
    if (before.name !== gate.name) renames.push({ from: before.name, to: gate.name });
  }
  // A rename onto the name another lane is leaving would mix the two up when copied. Do it in two saves.
  for (const r of renames) {
    if (renames.some((o) => o !== r && o.from.toLowerCase() === r.to.toLowerCase())) {
      throw new AppError("Rename one lane at a time when two lanes swap names", 400);
    }
  }

  const problems = [];
  for (const lane of old.filter((o) => !taken.has(String(o._id)))) {
    const { operators, devices } = await usageOf(location, lane.name);
    if (operators || devices) {
      const parts = [operators && plural(operators, "operator"), devices && plural(devices, "device")].filter(Boolean);
      problems.push(`${lane.name} (${parts.join(" and ")})`);
    }
  }
  if (problems.length) {
    throw new AppError(
      `Cannot remove ${problems.join(", ")}: still tied to operators or devices. Move them to another lane first, or switch the lane off instead.`,
      409,
    );
  }
  await numberLanes(companyId || location.companyId, location, gates);
  return { gates, renames };
};

// The fields of a lane that an admin fills in (the Create / Edit Parking Lane form).
const LANE_FIELDS = [
  "doorNo", "readerNo", "cameraSerial", "fastag", "fastagLaneId", "gateNo", "floorNo", "direction", "fastagLaneType", "fastagLaneMode",
];

const assertUnique = (gates, gate, field, label) => {
  const value = gate[field];
  if (value && gates.some((g) => g !== gate && String(g[field] || "").toLowerCase() === String(value).toLowerCase())) {
    throw new AppError(`${label} ${value} is already used by another lane`, 409);
  }
};

// Adds one lane (the Create Parking Lane form). Returns the saved lane.
const addLane = async (location, body) => {
  if (!location.vehicleTypes.includes(body.vehicleType)) {
    throw new AppError(`This location does not take ${LANE_LABEL[body.vehicleType].toLowerCase()} vehicles`, 400);
  }
  const lane = {
    type: body.type,
    vehicleType: body.vehicleType,
    isActive: true,
    name: laneName(body.vehicleType, body.type, (location.gates || []).map((g) => g.name)),
  };
  for (const field of LANE_FIELDS) if (body[field] !== undefined) lane[field] = body[field];
  fillLane(lane);
  const gates = [...(location.gates || []).map((g) => (g.toObject ? g.toObject() : g)), lane];
  await numberLanes(location.companyId, location, gates);
  assertUnique(gates, lane, "doorNo", "Door/Lane No.");
  assertUnique(gates, lane, "readerNo", "Reader");
  location.gates.push(lane);
  const saved = location.gates[location.gates.length - 1];
  saved.doorNo = lane.doorNo;
  saved.readerNo = lane.readerNo;
  return saved;
};

// Changes one lane (the Edit Parking Lane form). Its name follows its vehicle and direction. Returns the rename
// to copy to its operators and devices, if any.
const editLane = async (location, laneId, body) => {
  const lane = location.gates.id(laneId);
  if (!lane) throw new AppError("Lane not found", 404);
  const before = { name: lane.name, vehicleType: lane.vehicleType, type: lane.type };
  const gaps = setupGaps(location.gates.map((g) => ({ vehicleClass: g.vehicleClass, type: g.type })));

  const vehicleType = body.vehicleType || lane.vehicleType;
  const type = body.type || lane.type;
  if (body.vehicleType && !location.vehicleTypes.includes(body.vehicleType)) {
    throw new AppError(`This location does not take ${LANE_LABEL[body.vehicleType].toLowerCase()} vehicles`, 400);
  }
  if (vehicleType !== before.vehicleType || type !== before.type) {
    // A device that points one way cannot stay on a lane that now goes the other way.
    if (type !== before.type) {
      const clash = await Hardware.countDocuments({ locationId: location._id, gate: before.name, direction: { $in: ["ENTRY", "EXIT"], $ne: type } });
      if (clash) throw new AppError("A camera or reader set for the other direction is on this lane. Move it first.", 409);
    }
    lane.vehicleType = vehicleType;
    lane.type = type;
    fillLane(lane);
    lane.name = laneName(vehicleType, type, location.gates.filter((g) => g !== lane).map((g) => g.name));
  }
  for (const field of LANE_FIELDS) if (body[field] !== undefined) lane[field] = body[field];
  assertUnique(location.gates, lane, "doorNo", "Door/Lane No.");
  assertUnique(location.gates, lane, "readerNo", "Reader");
  if (!lane.fastag) {
    for (const field of ["fastagLaneId", "gateNo", "floorNo", "direction", "fastagLaneType", "fastagLaneMode"]) lane[field] = undefined;
  }

  // Changing a lane must not take away the last entry or exit lane of a class of vehicle.
  if (!gaps.length && setupGaps(location.gates.map((g) => ({ vehicleClass: g.vehicleClass, type: g.type }))).length) {
    throw new AppError("Keep an entry lane and an exit lane for two-wheelers and for four-wheelers", 400);
  }
  return lane.name !== before.name ? [{ from: before.name, to: lane.name }] : [];
};

// Copies lane renames to the operators and devices that point at the lane by name.
const applyRenames = async (location, renames) => {
  for (const { from, to } of renames) {
    await Promise.all([
      User.updateMany(
        { "lanes.locationId": location._id, "lanes.gate": from },
        { $set: { "lanes.$[l].gate": to } },
        { arrayFilters: [{ "l.locationId": location._id, "l.gate": from }] },
      ),
      Hardware.updateMany({ locationId: location._id, gate: from }, { $set: { gate: to } }),
    ]);
  }
};

// The rows of the Lanes tab: each lane with its operators and devices, filtered by `q` and paged.
const laneRows = async (location, { q = "", page = 1, limit = 10 } = {}) => {
  const [operators, devices] = await Promise.all([
    User.find({ lanes: { $elemMatch: { locationId: location._id } } }).select("name lanes isActive").lean(),
    Hardware.find({ locationId: location._id }).sort({ name: 1 }),
  ]);
  const now = new Date();
  const shownDevices = devices.map((d) => withStatus(d, now));

  const operatorsOf = (names) => operators
    .filter((u) => (u.lanes || []).some((l) => String(l.locationId) === String(location._id) && names.includes(l.gate)))
    .map((u) => ({ _id: u._id, name: u.name, isActive: u.isActive !== false }));
  const devicesOf = (names) => shownDevices
    .filter((d) => names.includes(d.gate))
    .map((d) => ({ _id: d._id, name: d.name, type: d.type, gate: d.gate, direction: d.direction, isOnline: Boolean(d.isOnline), isActive: d.isActive !== false }));

  const all = (location.gates || []).map((gate, i) => ({
    _id: gate._id,
    sn: i + 1,
    name: gate.name,
    type: gate.type,
    vehicleType: gate.vehicleType || "",
    vehicleClass: gate.vehicleClass || "",
    doorNo: gate.doorNo || "",
    readerNo: gate.readerNo || "",
    fastag: Boolean(gate.fastag || gate.fastagLaneId),
    fastagLaneId: gate.fastagLaneId || "",
    gateNo: gate.gateNo || "",
    floorNo: gate.floorNo || "",
    direction: gate.direction || "",
    fastagLaneType: gate.fastagLaneType || "",
    fastagLaneMode: gate.fastagLaneMode || "",
    cameraSerial: gate.cameraSerial || "",
    laneCode: gate.laneCode || "",
    isActive: isLaneActive(gate),
    operators: operatorsOf([gate.name]),
    devices: devicesOf([gate.name]),
  }));

  const needle = String(q).trim().toLowerCase();
  const matches = needle
    ? all.filter((row) => [
      row.name, row.doorNo, row.readerNo, row.fastagLaneId, row.cameraSerial, row.laneCode,
      ...row.operators.map((o) => o.name), ...row.devices.map((d) => d.name),
    ]
      .some((text) => String(text || "").toLowerCase().includes(needle)))
    : all;

  const size = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const pages = Math.max(Math.ceil(matches.length / size), 1);
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  // `setup` lists the lanes a location still needs (an entry and an exit lane for each of the two vehicle classes).
  const setup = { missing: isLaneLocation(location) ? setupGaps(location.gates) : [] };
  return { rows: matches.slice((current - 1) * size, current * size), total: matches.length, page: current, limit: size, pages, setup };
};

// The lane names this user is limited to at the location, or null when they are not limited.
const assignedGates = (user, location) => {
  const mine = (user.lanes || []).filter((l) => String(l.locationId) === String(location._id)).map((l) => l.gate);
  return mine.length ? mine : null;
};

const opposite = (direction) => (direction === "ENTRY" ? "EXIT" : "ENTRY");

// Works out which lane a request is for.
// - Not limited: the lane asked for is used as it is (the caller still checks it is a real lane).
// - Limited: the lane must be one of theirs and suit the direction; if none was named and they have
//   exactly one that suits, that one is used. With `soft`, a lane that is not theirs is replaced by
//   theirs instead of being refused (used by re-entry, which reuses the old ticket's lane).
const resolveGate = (req, location, direction, requested, { soft = false } = {}) => {
  const mine = assignedGates(req.user, location);
  if (!mine) {
    // At a location with lanes, gate staff work only the lane they were given: no lane, no work.
    if (isLaneLocation(location) && LANE_STAFF.includes(req.user.role)) {
      throw new AppError("You are not assigned to a lane at this location. Ask your admin to give you one.", 403);
    }
    return requested;
  }

  // Lanes that are really lanes of the location and suit the direction. A lane that was removed
  // from the location since is ignored.
  const real = mine.filter((name) => {
    const lane = (location.gates || []).find((g) => g.name === name);
    return lane && lane.type !== opposite(direction);
  });
  // Lanes an admin switched off cannot be worked.
  const usable = real.filter((name) => isLaneActive((location.gates || []).find((g) => g.name === name)));
  if (real.length && !usable.length) throw new AppError("Your lane is switched off", 409);
  if (!usable.length) {
    throw new AppError(`You are not assigned to an ${direction.toLowerCase()} lane at this location`, 403);
  }
  if (requested && usable.includes(requested)) return requested;
  if (requested && !soft) throw new AppError(`You are not assigned to lane ${requested}`, 403);
  if (usable.length === 1 || soft) return usable[0];
  throw new AppError("Choose one of your lanes", 400);
};

// Checks a list of lanes a company admin wants to give a user: each must exist at a location the
// user works at. Returns the clean list, without repeats.
const checkAssignment = (lanes, locations, locationIds) => {
  const byId = new Map(locations.map((l) => [String(l._id), l]));
  const allowed = new Set(locationIds.map(String));
  const seen = new Set();
  const clean = [];
  for (const lane of lanes) {
    const location = byId.get(String(lane.locationId));
    if (!location) throw new AppError("A lane belongs to a location that was not found", 400);
    if (!allowed.has(String(location._id))) throw new AppError(`Assign ${location.name} to the user before choosing its lanes`, 400);
    if (!(location.gates || []).some((g) => g.name === lane.gate)) {
      throw new AppError(`${location.name} has no lane called "${lane.gate}"`, 400);
    }
    const key = `${location._id}|${lane.gate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ locationId: location._id, gate: lane.gate });
  }
  return clean;
};

// The lanes a gate-staff user (entry, exit or gate operator) may be given at a lane location: a lane has one
// operator, so a lane another active operator already holds is refused. One operator may hold several lanes
// (for example the Car-Entry and the Car-Exit). Everyone else keeps the lanes exactly as chosen.
const applyLaneRules = async ({ role, userId, clean, locations }) => {
  if (!LANE_STAFF.includes(role)) return clean;
  const byId = new Map(locations.map((l) => [String(l._id), l]));
  for (const item of clean) {
    const location = byId.get(String(item.locationId));
    if (!location || !isLaneLocation(location)) continue;
    const other = await User.findOne({
      _id: { $ne: userId },
      isActive: true,
      lanes: { $elemMatch: { locationId: location._id, gate: item.gate } },
    }).select("name");
    if (other) throw new AppError(`Lane ${item.gate} at ${location.name} already has an operator (${other.name}). A lane has one operator.`, 409);
  }
  return clean;
};

// A gate-staff user must have a lane at every lane location they work at.
const requireLaneForStaff = ({ role, lanes, locations }) => {
  if (!LANE_STAFF.includes(role)) return;
  for (const location of locations) {
    if (!isLaneLocation(location)) continue;
    if (!(lanes || []).some((l) => String(l.locationId) === String(location._id))) {
      throw new AppError(`Choose the lane this operator works at ${location.name}`, 400);
    }
  }
};

module.exports = {
  LANE_LABEL, isLaneLocation, addLane, editLane, assertVehicleFits, applyLaneRules, requireLaneForStaff, LANE_STAFF, assignedGates, resolveGate, checkAssignment, isLaneActive, assertLaneActive, planGateChange, applyRenames, laneRows };
