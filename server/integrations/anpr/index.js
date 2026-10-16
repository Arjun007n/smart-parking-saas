// ANPR (number plate recognition) adapter layer (plan, section 22).
//
// The server speaks ONE format. Whatever a camera or vendor cloud sends is
// translated to it by an adapter, so the rest of the platform never knows
// which brand is installed.
//
//   standard format (what POST /api/device/anpr accepts)
//     plate       text read by the camera ("" or missing if it saw a car but could not read it)
//     confidence  0..1 or 0..100
//     eventId     the camera's own id for this event (retries are then harmless)
//     capturedAt  ISO date-time
//     imageUrl    http(s) address of the photo
//     direction   ENTRY | EXIT (needed when the camera is registered for BOTH)
//     vehicleType what kind of vehicle the camera saw (car, bike, truck, bus, taxi, tempo ...); optional
//
// To support a vendor whose camera sends something else, add an adapter below
// that returns the standard format, then select it with device.vendor. Vendors
// that post XML or multipart pictures are best translated in the gate agent
// (see gate-agent/), which then sends the standard format.

const { normalizePlate } = require("../../utils/plate");

const PLATE_PATTERN = /^[A-Z0-9]{4,12}$/;
// The usual shapes of an Indian number plate: state, district, series letters, number (MH12AB1234, DL1CAB1234,
// RJ14 1234) and the Bharat series (22BH1234AA). A reading of another shape is not refused (foreign and special
// plates exist) but is marked "check this plate", so a camera's misreading never makes a ticket by itself.
const INDIAN_PLATE = /^(?:[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/;
const DEFAULT_MIN_CONFIDENCE = 0.85;

// Accepts 0..1 or 0..100 and returns 0..1 (or undefined when not given).
const normalizeConfidence = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const fraction = value > 1 ? value / 100 : value;
  return Math.min(1, Math.round(fraction * 1000) / 1000);
};

// The words cameras use for the kind of vehicle, turned into our five types. Anything not recognised is left out
// (the operator's choice then stands), never guessed.
const VEHICLE_WORDS = {
  CAR: ["car", "sedan", "suv", "hatchback", "jeep", "van", "minivan", "mpv", "light vehicle", "lmv", "4 wheeler", "four wheeler", "4w"],
  BIKE: ["bike", "motorbike", "motorcycle", "scooter", "scooty", "moped", "two wheeler", "2 wheeler", "2w", "cycle", "bicycle"],
  HEAVY: ["heavy", "truck", "lorry", "bus", "trailer", "hmv", "tanker", "container", "coach"],
  TAXI: ["taxi", "cab", "auto", "rickshaw", "auto rickshaw", "three wheeler", "3 wheeler", "3w"],
  TEMPO: ["tempo", "pickup", "pick up", "mini truck", "minitruck", "lcv", "light truck", "delivery van", "tata ace"],
};
const normalizeVehicleType = (value) => {
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!word) return undefined;
  const upper = word.toUpperCase().replace(/ /g, "");
  if (Object.keys(VEHICLE_WORDS).includes(upper)) return upper;
  return Object.keys(VEHICLE_WORDS).find((type) => VEHICLE_WORDS[type].includes(word));
};

// The address of a detection's picture is shown to operators as a link, so only a plain http(s) address is kept
// (never javascript:, data: and the like). Anything else is dropped, not rejected: the detection itself still counts.
const safeImageUrl = (value) => (typeof value === "string" && /^https?:\/\/\S{1,490}$/i.test(value.trim()) ? value.trim() : undefined);

// A camera's live-picture address is fetched by the browser of every operator at the gate. Accepted: any https
// address, and plain http only for a camera on the local network or the gate PC itself (localhost, 127.x, 10.x,
// 172.16-31.x, 192.168.x, 169.254.x, 100.64-127.x, names without a dot, .local / .lan / .internal / .home names), for
// example the gate agent's http://127.0.0.1:<port>/preview/<hex>. Set
// PREVIEW_ALLOW_PUBLIC_HTTP=true to also accept plain http to public addresses. Returns true / false.
const LOCAL_NAME = /\.(local|lan|internal|home|localdomain)$/i;
const isLocalHost = (host) => {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1" || LOCAL_NAME.test(h)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return /^(fe80|fc|fd)/.test(h); // IPv6 link-local / unique-local
  return !h.includes("."); // a single-word name can only be on the local network
};
const isSafePreviewUrl = (value) => {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text.length > 300 || !/^https?:\/\/\S+$/i.test(text)) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (!url.hostname) return false;
  if (url.protocol === "https:") return true;
  return process.env.PREVIEW_ALLOW_PUBLIC_HTTP === "true" || isLocalHost(url.hostname);
};

const adapters = {
  // Our own standard format: nothing to translate.
  generic: (body) => body,
};

const adapterFor = (vendor) => adapters[String(vendor || "").toLowerCase()] || adapters.generic;

// Returns the cleaned detection fields. Does not touch the database.
const parseDetection = (body, { vendor, minConfidence } = {}) => {
  const input = adapterFor(vendor)(body || {});
  const plateRaw = typeof input.plate === "string" ? input.plate.trim().slice(0, 40) : "";
  const cleaned = normalizePlate(plateRaw);
  const confidence = normalizeConfidence(input.confidence);
  const threshold = typeof minConfidence === "number" ? minConfidence : DEFAULT_MIN_CONFIDENCE;

  const reviewReasons = [];
  let plate = "";
  if (!cleaned) {
    reviewReasons.push("No plate could be read");
  } else if (!PLATE_PATTERN.test(cleaned)) {
    reviewReasons.push(`"${plateRaw}" does not look like a number plate`);
  } else {
    plate = cleaned;
  }
  if (plate && !INDIAN_PLATE.test(plate)) {
    reviewReasons.push(`"${plate}" is not the usual shape of an Indian number plate`);
  }
  // A camera that does not say how sure it is cannot be trusted blindly.
  if (plate && (confidence === undefined || confidence < threshold)) {
    reviewReasons.push(
      confidence === undefined
        ? "The camera did not give a confidence"
        : `Low confidence (${Math.round(confidence * 100)}%, needs ${Math.round(threshold * 100)}%)`
    );
  }

  return {
    plateRaw, plate, confidence,
    capturedAt: input.capturedAt instanceof Date ? input.capturedAt : undefined,
    imageUrl: safeImageUrl(input.imageUrl), deviceEventId: input.eventId, direction: input.direction,
    vehicleType: normalizeVehicleType(input.vehicleType),
    reviewReasons,
  };
};

// One duplicate window = the same plate seen at the same gate direction within
// this many seconds is ONE detection.
const DUPLICATE_WINDOW_SECONDS = 120;

const dedupeKey = ({ locationId, direction, plate }, now = Date.now(), windowSeconds = DUPLICATE_WINDOW_SECONDS) =>
  `${locationId}:${direction}:${plate || "UNREAD"}:${Math.floor(now / (windowSeconds * 1000))}`;

module.exports = {
  DEFAULT_MIN_CONFIDENCE, DUPLICATE_WINDOW_SECONDS, PLATE_PATTERN, INDIAN_PLATE,
  normalizeConfidence, normalizeVehicleType, parseDetection, safeImageUrl, isSafePreviewUrl, dedupeKey, adapters,
};
