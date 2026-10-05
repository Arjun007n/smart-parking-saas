// ANPR detections: a camera reports a plate, the platform turns it into a
// SUGGESTION for the operator. Nothing is opened or created automatically.

const AppError = require("../utils/AppError");
const audit = require("./auditService");
const { publish, EVENTS } = require("./eventBus");
const { parseDetection, dedupeKey, DUPLICATE_WINDOW_SECONDS } = require("../integrations/anpr");
const AnprDetection = require("../models/AnprDetection");
const ParkingSession = require("../models/ParkingSession");
const Vehicle = require("../models/Vehicle");
const recognition = require("../integrations/recognition");
const Pass = require("../models/Pass");
const passes = require("./passService");
const { cleanTag } = require("../utils/tag");
const { normalizePlate } = require("../utils/plate");

const isDuplicateKey = (error) => error && error.code === 11000;

// What the platform already knows about this plate at this gate.
const enrich = async ({ device, direction, plate, reasons }) => {
  const found = { alreadyInside: false, blocked: false };
  if (!plate) return found;

  // An exit is looked up at this location; an entry is checked company-wide,
  // because a vehicle can only be in one place (the entry rule is the same).
  const open = await ParkingSession.findOne({
    companyId: device.companyId,
    ...(direction === "ENTRY" ? {} : { locationId: device.locationId }),
    vehicleNumber: plate, isOpen: true,
  }).select("ticketNumber");

  if (direction === "ENTRY") {
    if (open) {
      found.alreadyInside = true;
      found.matchedTicketNumber = open.ticketNumber;
      reasons.push(`Already inside (ticket ${open.ticketNumber})`);
    }
    const vehicle = await Vehicle.findOne({ companyId: device.companyId, plateNumber: plate }).select("isBlocked blockedReason");
    if (vehicle && vehicle.isBlocked) {
      found.blocked = true;
      reasons.push(`Vehicle is blocked: ${vehicle.blockedReason || "no reason given"}`);
    }
  } else if (open) {
    found.matchedSessionId = open._id;
    found.matchedTicketNumber = open.ticketNumber;
  } else {
    reasons.push("No vehicle with this number is inside");
  }
  return found;
};

// The same plate seen again inside the duplicate window is ONE detection with one more hit.
const bumpExistingDetection = (filter, parsed, now) =>
  AnprDetection.findOneAndUpdate(
    filter,
    {
      $inc: { hits: 1 },
      $set: { lastSeenAt: now },
      ...(parsed.confidence !== undefined ? { $max: { confidence: parsed.confidence } } : {}),
    },
    { returnDocument: "after" }
  );

// A plate that has an open ticket for at least this long is leaving; anything else is arriving. (A car that
// has just been given a ticket is still in front of a two-way camera, so it must not count as leaving.)
const AUTO_EXIT_AFTER_MINUTES = () => Math.max(1, Number(process.env.AUTO_EXIT_AFTER_MINUTES) || 5);

// For a camera that watches both ways: which way is this plate going?
const inferDirection = async (device, plate) => {
  if (!plate) return "ENTRY";
  const open = await ParkingSession.findOne({
    companyId: device.companyId, locationId: device.locationId, vehicleNumber: plate, isOpen: true,
  }).select("entryTime");
  const inside = open && open.entryTime && Date.now() - open.entryTime.getTime() >= AUTO_EXIT_AFTER_MINUTES() * 60000;
  return inside ? "EXIT" : "ENTRY";
};

// Handles one camera report. Returns { detection, duplicate }.
// `extra` is for readers that make the same kind of suggestion: { source, tagId, passNumber, reasons }.
// A camera set up for both directions says which way in the report, or says "AUTO" and the server decides.
const ingest = async (device, body, extra = {}) => {
  const asked = body.direction === "AUTO" ? "" : body.direction;
  let direction = device.direction === "BOTH" ? asked : device.direction;
  if (!direction && !(device.direction === "BOTH" && body.direction === "AUTO")) {
    throw new AppError("direction (ENTRY or EXIT, or AUTO) is required for a camera set up for both", 400);
  }
  if (asked && asked !== direction && !(device.direction === "BOTH")) {
    throw new AppError(`This camera is set up for ${device.direction.toLowerCase()} only`, 400);
  }

  // The camera sending the same event again (a retry) changes nothing.
  if (body.eventId) {
    const same = await AnprDetection.findOne({ hardwareId: device._id, deviceEventId: body.eventId });
    if (same) return { detection: same, duplicate: true };
  }

  const now = new Date();
  const parsed = parseDetection(body, { vendor: device.vendor, minConfidence: device.config && device.config.minConfidence });
  if (!direction) direction = await inferDirection(device, parsed.plate);

  // The same plate seen again within the window is one detection with more hits.
  const windowStart = new Date(now.getTime() - DUPLICATE_WINDOW_SECONDS * 1000);
  const bumpExisting = (filter) => bumpExistingDetection(filter, parsed, now);
  const repeat = await bumpExisting({
    companyId: device.companyId, locationId: device.locationId, direction, plate: parsed.plate,
    status: "PENDING", lastSeenAt: { $gte: windowStart },
  });
  if (repeat) return { detection: repeat, duplicate: true };

  const reasons = [...parsed.reviewReasons, ...(extra.reasons || [])];
  const known = await enrich({ device, direction, plate: parsed.plate, reasons });
  const key = dedupeKey({ locationId: device.locationId, direction, plate: parsed.plate }, now.getTime());

  let detection;
  try {
    detection = await AnprDetection.create({
      companyId: device.companyId,
      locationId: device.locationId,
      hardwareId: device._id,
      ...(extra.source ? { source: extra.source } : {}),
      ...(extra.tagId ? { tagId: extra.tagId } : {}),
      ...(extra.passNumber ? { passNumber: extra.passNumber } : {}),
      gate: device.gate,
      direction,
      plateRaw: parsed.plateRaw,
      plate: parsed.plate,
      confidence: parsed.confidence,
      capturedAt: parsed.capturedAt && parsed.capturedAt.getTime() <= now.getTime() + 5 * 60000 ? parsed.capturedAt : now,
      imageUrl: parsed.imageUrl,
      deviceEventId: parsed.deviceEventId,
      needsReview: reasons.length > 0,
      reviewReasons: reasons,
      dedupeKey: key,
      lastSeenAt: now,
      ...known,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // Two reports of the same plate arrived at the same moment.
    const winner = await bumpExisting({ companyId: device.companyId, dedupeKey: key, status: "PENDING" });
    if (winner) return { detection: winner, duplicate: true };
    const sameEvent = body.eventId && (await AnprDetection.findOne({ hardwareId: device._id, deviceEventId: body.eventId }));
    if (sameEvent) return { detection: sameEvent, duplicate: true };
    throw error;
  }

  publish(EVENTS.ANPR_DETECTED, { companyId: device.companyId, locationId: device.locationId, detection });
  return { detection, duplicate: false };
};

// A UHF / RFID reader read a tag. A tag of a vehicle on a current pass becomes a
// suggestion for that vehicle (the operator still confirms it). A tag nobody owns
// is only noted in the device's event list. Returns { detection, duplicate } or
// { unknown: true }.
const ingestTag = async (device, body) => {
  const tag = cleanTag(body.tag);
  if (!tag) throw new AppError("The tag number must be 4 to 48 letters and digits", 400);

  const pass = await Pass.findOne({ companyId: device.companyId, isCurrent: true, "vehicles.tag": tag });
  const vehicle = pass && pass.vehicles.find((v) => v.tag === tag);
  if (!pass || !vehicle) {
    const hardware = require("./hardwareService");
    await hardware.recordEvent(device, "UNKNOWN_TAG", { message: `Tag ${tag} is not on any pass`, data: { tag } });
    return { unknown: true, tag };
  }

  const reasons = [];
  const state = passes.passState(pass);
  if (state !== "ACTIVE") reasons.push(`Pass ${pass.passNumber} is ${state.toLowerCase()}: the normal fee applies`);
  else if (!passes.coversLocation(pass, device.locationId)) reasons.push(`Pass ${pass.passNumber} does not cover this location`);

  const result = await ingest(
    device,
    { plate: vehicle.number, confidence: 1, eventId: body.eventId, capturedAt: body.capturedAt, direction: body.direction },
    { source: "RFID", tagId: tag, passNumber: pass.passNumber, reasons }
  );
  return { ...result, pass };
};

// A FASTag reader read a tag. The reader supplies the vehicle number (a FASTag carries
// it); the answer is a suggestion like any other. No money is taken by the platform:
// the operator records the payment as FASTag.
const ingestFastag = async (device, body) => {
  const tagId = cleanTag(body.tagId);
  const plate = normalizePlate(body.plate);
  const reasons = [];
  if (!plate) reasons.push("The FASTag reader gave no vehicle number");
  return ingest(
    device,
    { plate, confidence: body.confidence === undefined ? 1 : body.confidence, eventId: body.eventId, capturedAt: body.capturedAt, direction: body.direction },
    { source: "FASTAG", tagId: tagId || undefined, reasons }
  );
};

// Handles one picture an operator took. `reading` is what the recognition
// provider answered ({ plate, confidence }). A picture that gave no readable
// plate stores nothing (the operator just types the number); a readable one
// becomes the same PENDING suggestion a gate camera makes, so the normal
// entry / exit flow (detectionId) confirms it. Returns { detection, duplicate, parsed, reasons }.
const ingestPhotoReading = async ({ companyId, locationId, direction, userId }, reading) => {
  const now = new Date();
  const parsed = parseDetection(reading, { minConfidence: recognition.minConfidence() });
  if (!parsed.plate) return { detection: null, duplicate: false, parsed, reasons: parsed.reviewReasons };

  const windowStart = new Date(now.getTime() - DUPLICATE_WINDOW_SECONDS * 1000);
  const bump = (filter) => bumpExistingDetection(filter, parsed, now);
  const repeat = await bump({ companyId, locationId, direction, plate: parsed.plate, status: "PENDING", lastSeenAt: { $gte: windowStart } });
  if (repeat) return { detection: repeat, duplicate: true, parsed, reasons: repeat.reviewReasons };

  const reasons = [...parsed.reviewReasons];
  const known = await enrich({ device: { companyId, locationId }, direction, plate: parsed.plate, reasons });
  const key = dedupeKey({ locationId, direction, plate: parsed.plate }, now.getTime());

  let detection;
  try {
    detection = await AnprDetection.create({
      companyId, locationId, direction, source: "PHOTO", readBy: userId,
      plateRaw: parsed.plateRaw, plate: parsed.plate, confidence: parsed.confidence,
      capturedAt: now, lastSeenAt: now, dedupeKey: key,
      needsReview: reasons.length > 0, reviewReasons: reasons,
      ...known,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const winner = await bump({ companyId, dedupeKey: key, status: "PENDING" });
    if (winner) return { detection: winner, duplicate: true, parsed, reasons: winner.reviewReasons };
    throw error;
  }
  return { detection, duplicate: false, parsed, reasons };
};

// Marks a suggestion as used once the operator has made the entry / looked up
// the exit, keeping what the camera read and what the operator used.
// Never throws: the entry or exit itself must not fail because of this.
const linkDetection = async (req, detectionId, { session, plate, direction }) => {
  try {
    const detection = await AnprDetection.findOne({
      _id: detectionId, companyId: session.companyId, locationId: session.locationId, direction, status: "PENDING",
    });
    if (!detection) return null;

    const corrected = detection.plate !== plate;
    const settled = await AnprDetection.findOneAndUpdate(
      { _id: detection._id, status: "PENDING" },
      { $set: { status: "CONFIRMED", sessionId: session._id, finalPlate: plate, corrected, resolvedBy: req.user._id, resolvedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!settled) return null;

    await audit.record(req, "ANPR_CONFIRM", {
      entity: "AnprDetection", entityId: settled._id, companyId: settled.companyId,
      meta: {
        direction, sessionId: session._id, ticketNumber: session.ticketNumber,
        cameraRead: detection.plateRaw, confidence: detection.confidence, usedPlate: plate, corrected,
        imageUrl: detection.imageUrl, source: detection.source,
      },
    });
    return settled;
  } catch (error) {
    console.error("Linking ANPR detection failed:", error.message);
    return null;
  }
};

module.exports = { ingest, ingestTag, ingestFastag, ingestPhotoReading, linkDetection, inferDirection };
