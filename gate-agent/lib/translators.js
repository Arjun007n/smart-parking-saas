// Turns what a camera (or its software) posts into the platform's standard
// format:  { plate, confidence, eventId, capturedAt, imageUrl, direction }.
//
// `generic` understands the usual field names. To support a specific brand
// add a translator below and select it with  options.vendor  in config.json.
// Cameras that post XML or multipart pictures need a translator that parses
// that body first (see handleRequest in lib/anprListener.js).

const pick = (object, names) => {
  for (const name of names) {
    if (object && object[name] !== undefined && object[name] !== null && object[name] !== "") return object[name];
  }
  return undefined;
};

const asNumber = (value) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

const generic = (body) => {
  const plate = pick(body, ["plate", "plateNumber", "plate_number", "license_plate", "licensePlate", "number", "Plate"]);
  const time = pick(body, ["capturedAt", "timestamp", "time", "dateTime", "captured_at"]);
  const date = time ? new Date(time) : undefined;
  return {
    plate: plate === undefined ? "" : String(plate),
    confidence: asNumber(pick(body, ["confidence", "score", "probability", "Confidence"])),
    eventId: pick(body, ["eventId", "event_id", "id", "uuid"]) === undefined ? undefined : String(pick(body, ["eventId", "event_id", "id", "uuid"])),
    capturedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
    imageUrl: pick(body, ["imageUrl", "image_url", "picture", "image"]),
    direction: pick(body, ["direction"]),
  };
};

const translators = { generic };

const translate = (vendor, body) => {
  const fn = translators[String(vendor || "generic").toLowerCase()];
  if (!fn) throw new Error(`Unknown camera vendor "${vendor}". Use one of: ${Object.keys(translators).join(", ")}`);
  const result = fn(body);
  // The server rejects fields it did not expect, so drop empty ones.
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
};

module.exports = { translate, translators };
