// Small limits that keep the text messages and emails the platform sends from being abused:
// a per-key counter with expiry (kept in memory, per server process), an optional country
// allow-list for SMS, and a cleaner for names that are written into message text.
//
// Every limit has a generous default, so normal use is not affected, and can be changed with env:
//   PASS_NOTICE_DAILY_CAP          holder notices per company per 24h, per channel (default 500)
//   PASS_NOTICE_RECIPIENT_CAP      notices per phone number / email address per 24h (default 10)
//   BOOKING_SMS_RECIPIENT_CAP      public booking SMS per phone number per 24h (default 3)
//   ALLOWED_SMS_COUNTRIES          comma separated calling codes, e.g. "91,44" (default empty = all)
// A counter is "take"n only when the message would really be sent; when a cap is hit the caller
// skips the message silently (the sale or booking itself always succeeds).

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_KEYS = 50000;

const buckets = new Map(); // key -> { count, resetAt }

const prune = (now) => {
  for (const [key, entry] of buckets) if (entry.resetAt <= now) buckets.delete(key);
  if (buckets.size > MAX_KEYS) {
    // Still too many live counters: drop the oldest tenth (Map keeps insertion order).
    let drop = Math.ceil(buckets.size / 10);
    for (const key of buckets.keys()) {
      if (drop-- <= 0) break;
      buckets.delete(key);
    }
  }
};

// Counts one use of `key`. Returns true when it is still within `max` per `windowMs`, false when the cap is hit
// (a refused use is not counted).
const take = (key, max, windowMs = DAY_MS, now = Date.now()) => {
  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) prune(now);
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
};

const reset = () => buckets.clear();

const numberFromEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

const passDailyCap = () => numberFromEnv("PASS_NOTICE_DAILY_CAP", 500);
const passRecipientCap = () => numberFromEnv("PASS_NOTICE_RECIPIENT_CAP", 10);
const bookingRecipientCap = () => numberFromEnv("BOOKING_SMS_RECIPIENT_CAP", 3);

// Calling codes from ALLOWED_SMS_COUNTRIES ("91, +44"). Empty list = every country allowed.
const allowedCountryCodes = () =>
  String(process.env.ALLOWED_SMS_COUNTRIES || "").split(",").map((c) => c.trim().replace(/\D/g, "")).filter(Boolean);

// `normalized` is a number in +country form (messaging.normalizePhone). True when its country may get an SMS.
const countryAllowed = (normalized) => {
  const codes = allowedCountryCodes();
  if (!codes.length) return true;
  const digits = String(normalized || "").replace(/\D/g, "");
  return codes.some((code) => digits.startsWith(code));
};

// May a holder notice go to this company / recipient now? Counts it when yes.
// channel: "sms" or "email"; recipient: the normalized phone or the lower-cased address.
const allowPassNotice = (companyId, channel, recipient, now = Date.now()) => {
  if (!take(`pass:${channel}:company:${companyId}`, passDailyCap(), DAY_MS, now)) return false;
  return take(`pass:${channel}:to:${String(recipient).toLowerCase()}`, passRecipientCap(), DAY_MS, now);
};

// May a public booking SMS go to this number now? Counts it when yes.
const allowBookingSms = (normalizedPhone, now = Date.now()) =>
  countryAllowed(normalizedPhone) && take(`booking:sms:to:${normalizedPhone}`, bookingRecipientCap(), DAY_MS, now);

// ---- names written into message text ----------------------------------------------------

const URL_LIKE = [
  /\b(?:https?|ftp):\/\/\S*/gi,
  /\bwww\.\S*/gi,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|xyz|top|link|click|shop|site|online|ly|tk|cc)\b(?:\/\S*)?/gi,
];
// Control characters, line/paragraph separators and the invisible direction / zero-width marks.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g; // removed, so "a\u200b.com" cannot hide a link

// A company or location name made safe for a message body: no links, no control characters, one line, short.
const safeName = (value, max = 60) => {
  let text = String(value === undefined || value === null ? "" : value).replace(INVISIBLE, "").replace(CONTROL, " ");
  for (const rx of URL_LIKE) text = text.replace(rx, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trim() : text;
};

module.exports = {
  take, reset, countryAllowed, allowPassNotice, allowBookingSms, safeName,
  passDailyCap, passRecipientCap, bookingRecipientCap, allowedCountryCodes, DAY_MS,
};
