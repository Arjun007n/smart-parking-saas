// Number plate reading from a PHOTO (plan, days 18-21).
//
// An operator takes or chooses a picture of the vehicle; a recognition
// provider reads the plate. The result is only ever a SUGGESTION (the same
// AnprDetection the gate cameras produce): the operator confirms or corrects
// it, and nothing is opened automatically.
//
// RECOGNITION_PROVIDER chooses the reader:
//   none            (default) reading from photos is switched off
//   simulated       a pretend reader for development and tests: it "reads" the
//                   text PLATE:RJ14AB1234 (and optionally CONF:0.93) when that
//                   text is inside the picture's bytes (or the screen's "test plate"
//                   box is filled in). Never in production.
//   http            any service that accepts the picture as the request body and
//                   answers JSON: { plate, confidence } or { results: [{ plate, score }] }
//   platerecognizer Plate Recognizer cloud (multipart upload). Written from its
//                   public documentation; try it with a free trial key first.
//
// A provider offers: isConfigured(), problems(), read(buffer, type) which
// resolves to { plate, confidence } (confidence 0..1 or 0..100, plate "" when
// nothing could be read). Adding another service means adding one entry below.

const AppError = require("../../utils/AppError");

const DEFAULT_TIMEOUT_MS = 8000;

const env = (key) => String(process.env[key] || "").trim();
const timeoutMs = () => Math.max(1000, Math.min(30000, Number(process.env.RECOGNITION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));

// Looked up at call time so tests can replace it.
const doFetch = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await globalThis.fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const isHttpUrl = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// The best reading out of what a service answered.
const pickBest = (answer) => {
  if (!answer || typeof answer !== "object") return { plate: "" };
  const list = Array.isArray(answer.results) ? answer.results : [answer];
  let best = null;
  for (const item of list) {
    if (!item || typeof item.plate !== "string") continue;
    const score = [item.confidence, item.score, item.dscore].find((n) => typeof n === "number");
    if (!best || (score ?? -1) > (best.confidence ?? -1)) best = { plate: item.plate, confidence: score };
  }
  return best || { plate: "" };
};

const failed = (what, detail) => {
  // The detail (status code, network error) is for the server log. It never
  // reaches the browser, and no key is ever printed.
  console.error(`Plate recognition ${what}:`, detail);
  return new AppError("The plate reading service could not read this picture right now. Type the number instead.", 502);
};

const readJson = async (response, what) => {
  if (!response.ok) throw failed(what, `HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw failed(what, "the answer was not JSON");
  }
};

const callService = async (what, url, options) => {
  try {
    return await readJson(await doFetch(url, options), what);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw failed(what, error.name === "AbortError" ? "timed out" : error.message);
  }
};

const none = {
  isConfigured: () => false,
  problems: () => [],
  read: async () => {
    throw new AppError("Reading plates from photos is not switched on", 503);
  },
};

const simulated = {
  isConfigured: () => true,
  problems: () => [],
  // `hint` lets the screens be tried with a real phone picture (the browser
  // re-encodes pictures, which would erase a marker): the typed test plate is used as the reading.
  read: async (buffer, type, { hint } = {}) => {
    const text = hint ? `PLATE:${hint}` : buffer.toString("latin1");
    const plate = /PLATE:([A-Za-z0-9-]{1,20})/.exec(text);
    const conf = /CONF:(\d+(?:\.\d+)?)/.exec(text);
    return { plate: plate ? plate[1] : "", confidence: conf ? Number(conf[1]) : plate ? 0.95 : undefined };
  },
};

const http = {
  isConfigured: () => isHttpUrl(env("RECOGNITION_URL")),
  problems: () => (isHttpUrl(env("RECOGNITION_URL")) ? [] : ["RECOGNITION_URL must be an http(s) address"]),
  read: async (buffer, type) => {
    const headers = { "Content-Type": type.contentType };
    if (env("RECOGNITION_API_KEY")) headers.Authorization = `Bearer ${env("RECOGNITION_API_KEY")}`;
    const answer = await callService("service", env("RECOGNITION_URL"), { method: "POST", headers, body: buffer });
    return pickBest(answer);
  },
};

const platerecognizer = {
  isConfigured: () => Boolean(env("RECOGNITION_API_KEY")),
  problems: () => (env("RECOGNITION_API_KEY") ? [] : ["RECOGNITION_API_KEY is required"]),
  read: async (buffer, type) => {
    const form = new FormData();
    form.append("upload", new Blob([buffer], { type: type.contentType }), `plate.${type.ext}`);
    if (env("RECOGNITION_REGIONS")) {
      for (const region of env("RECOGNITION_REGIONS").split(",").map((r) => r.trim()).filter(Boolean)) form.append("regions", region);
    }
    const answer = await callService("service", env("RECOGNITION_URL") || "https://api.platerecognizer.com/v1/plate-reader/", {
      method: "POST", headers: { Authorization: `Token ${env("RECOGNITION_API_KEY")}` }, body: form,
    });
    return pickBest(answer);
  },
};

const PROVIDERS = { none, simulated, http, platerecognizer };

const providerName = () => (env("RECOGNITION_PROVIDER") || "none").toLowerCase();
const isKnownProvider = (name = providerName()) => Object.prototype.hasOwnProperty.call(PROVIDERS, name);
const provider = () => PROVIDERS[providerName()] || null;
const isEnabled = () => providerName() !== "none" && Boolean(provider() && provider().isConfigured());

const minConfidence = () => {
  const value = Number(process.env.RECOGNITION_MIN_CONFIDENCE);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined; // undefined -> ANPR default
};

// Reads one picture. Resolves to { plate, confidence }.
// `options.hint` is honoured by the simulated reader only.
const read = async (buffer, type, options = {}) => {
  if (!isEnabled()) throw new AppError("Reading plates from photos is not switched on", 503);
  return provider().read(buffer, type, options);
};

module.exports = { PROVIDERS, providerName, isKnownProvider, provider, isEnabled, minConfidence, read, pickBest };
