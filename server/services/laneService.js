// Lane assignment: a company admin can tie an operator (or supervisor) to particular lanes
// (gates) of a location. Someone with no lanes listed for a location may use all of its lanes.

const AppError = require("../utils/AppError");
const User = require("../models/User");
const Hardware = require("../models/Hardware");
const { withStatus } = require("./hardwareService");

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

// Works out what a new list of lanes means for the lanes the location has now.
// - Two lanes cannot share a name (capital letters do not make a name different).
// - A lane in the new list is the same lane as an old one when it carries the old one's _id, or, with no _id,
//   when it has the same name. A different name on the same lane is a rename.
// - An old lane missing from the new list is a removal. It is refused while operators or devices are tied to it.
// Returns the clean list and the renames still to be copied to operators and devices.
const planGateChange = async (location, incoming) => {
  const gates = incoming.map((g) => ({ ...g, name: g.name.trim() }));

  const seen = new Set();
  for (const gate of gates) {
    const key = gate.name.toLowerCase();
    if (seen.has(key)) throw new AppError(`Two lanes are called "${gate.name}". Give each lane its own name.`, 400);
    seen.add(key);
  }

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
  return { gates, renames };
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

  const all = (location.gates || []).map((gate, i) => ({
    _id: gate._id,
    sn: i + 1,
    name: gate.name,
    type: gate.type,
    vehicleType: gate.vehicleType || "",
    laneCode: gate.laneCode || "",
    plazaId: gate.plazaId || "",
    fastagLaneId: gate.fastagLaneId || "",
    cameraSerial: gate.cameraSerial || "",
    isActive: isLaneActive(gate),
    operators: operators
      .filter((u) => (u.lanes || []).some((l) => String(l.locationId) === String(location._id) && l.gate === gate.name))
      .map((u) => ({ _id: u._id, name: u.name, isActive: u.isActive !== false })),
    devices: shownDevices
      .filter((d) => d.gate === gate.name)
      .map((d) => ({ _id: d._id, name: d.name, type: d.type, isOnline: Boolean(d.isOnline), isActive: d.isActive !== false })),
  }));

  const needle = String(q).trim().toLowerCase();
  const matches = needle
    ? all.filter((row) => [row.name, row.laneCode, row.plazaId, row.fastagLaneId, row.cameraSerial, ...row.operators.map((o) => o.name), ...row.devices.map((d) => d.name)]
      .some((text) => String(text || "").toLowerCase().includes(needle)))
    : all;

  const size = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const pages = Math.max(Math.ceil(matches.length / size), 1);
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  return { rows: matches.slice((current - 1) * size, current * size), total: matches.length, page: current, limit: size, pages };
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
  if (!mine) return requested;

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

module.exports = { assignedGates, resolveGate, checkAssignment, isLaneActive, assertLaneActive, planGateChange, applyRenames, laneRows };
