const crypto = require("crypto");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rejects when `work` takes longer than `ms`.
const withTimeout = (work, ms, label = "Operation") =>
  Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms).unref()),
  ]);

const hexToBuffer = (hex, label = "hex") => {
  const clean = String(hex || "").replace(/[\s:,-]|0x/gi, "");
  if (!clean || clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error(`${label} is not valid hex`);
  return Buffer.from(clean, "hex");
};

// Splits a command line into words. Double quotes keep a path with spaces together, which
// Windows needs ("C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe" -i ...). Backslashes stay as they are.
const splitCommand = (text) => {
  const words = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(text || "")))) words.push(match[1] !== undefined ? match[1] : match[2]);
  return words;
};

// Constant-time string comparison (different lengths are simply "not equal").
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// Local listeners (camera / reader events): they listen on this PC only unless options.bind says otherwise.
const DEFAULT_BIND = "127.0.0.1";
const isLoopback = (host) => {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
};

// Throws a clear message when a listener would be open to the network without a secret.
const checkListenerBind = (options, name) => {
  const bind = options.bind || DEFAULT_BIND;
  if (!isLoopback(bind) && !options.secret) {
    throw new Error(
      `"${name}": options.bind is "${bind}" (reachable from the network) but options.secret is not set. ` +
        'Set a secret ("options": { "secret": "<long random text>" }) and have the camera or reader send it, or remove "bind" to listen on this PC only.'
    );
  }
  return bind;
};

// True when no secret is configured, or the request carries it in the x-agent-secret header or (for
// devices that cannot set headers) in the ?secret= query.
const secretOk = (req, url, secret) => {
  if (!secret) return true;
  const header = req.headers["x-agent-secret"];
  if (typeof header === "string" && header !== "" && safeEqual(header, secret)) return true;
  const query = url.searchParams.get("secret");
  return query !== null && safeEqual(query, secret);
};

module.exports = { sleep, withTimeout, hexToBuffer, splitCommand, safeEqual, isLoopback, checkListenerBind, secretOk, DEFAULT_BIND };
