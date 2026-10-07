// The switches of a location that change how the gate works (`Location.operations`).
// Anything not set falls back to the defaults below, so existing locations behave exactly as before.

const DEFAULTS = Object.freeze({
  // May a ticket be cancelled and a new one made for the same vehicle (a misread plate, a wrong type)?
  allowReEntry: true,
  // May the person at the exit change the amount to collect (always with a reason, always recorded)?
  exitAmountEdit: false,
  // Close tickets that are still open after this many hours as "closed automatically". 0 = never.
  autoExitHours: 0,
  // How many re-entries one gate operator may make in a day (0 = no limit). Only an admin sets it.
  reEntryLimit: 0,
  // Print the ticket number in words on the ticket (the QR code, if on, is printed either way).
  printTicketNumber: true,
  // Show the entry photo on the ticket and receipt.
  printPhoto: false,
  // Take the entry photo by itself when the ticket is made (needs the camera switched on).
  photoAutoCapture: false,
  // Give a receipt when a pass holder leaves (the amount is 0).
  printPassReceipt: true,
});

const KEYS = Object.freeze(Object.keys(DEFAULTS));
const MAX_AUTO_EXIT_HOURS = 720;
const MAX_RE_ENTRY_LIMIT = 1000;

const resolveOperations = (raw) => {
  const source = (raw && typeof raw.toObject === "function" ? raw.toObject() : raw) || {};
  const out = {};
  for (const key of KEYS) {
    if (typeof DEFAULTS[key] === "boolean") out[key] = typeof source[key] === "boolean" ? source[key] : DEFAULTS[key];
  }
  const hours = Number(source.autoExitHours);
  out.autoExitHours = Number.isFinite(hours) && hours > 0 ? Math.min(MAX_AUTO_EXIT_HOURS, Math.floor(hours)) : 0;
  const limit = Number(source.reEntryLimit);
  out.reEntryLimit = Number.isFinite(limit) && limit > 0 ? Math.min(MAX_RE_ENTRY_LIMIT, Math.floor(limit)) : 0;
  return out;
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// The fee after the person at the exit changed the amount. Tax is worked out again from the new
// total in the same way the tariff does it; the difference is kept (`edited`) so reports can show it.
const editedFee = (fee, amount) => {
  const total = round2(Number(amount));
  if (!Number.isFinite(total) || total < 0) throw new RangeError("The amount must be 0 or more");
  const percent = fee.taxPercent || 0;
  let subtotal;
  let tax;
  if (fee.taxInclusive !== false) {
    tax = round2(total - total / (1 + percent / 100));
    subtotal = round2(total - tax);
  } else {
    // The edited amount is what the customer pays, tax included.
    subtotal = round2(total / (1 + percent / 100));
    tax = round2(total - subtotal);
  }
  return { ...fee, subtotal, tax, total, reason: total === 0 ? "EDITED_FREE" : "EDITED" };
};

module.exports = { DEFAULTS, KEYS, MAX_AUTO_EXIT_HOURS, resolveOperations, editedFee, round2 };
