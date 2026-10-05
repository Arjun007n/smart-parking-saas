// Fee calculation engine (plan, Day 12). Pure functions: no database access,
// so every rule can be unit tested. All money rules live here on the server.
//
// How a fee is worked out:
//  1. Duration = exit - entry, rounded UP to whole minutes.
//  2. Valid pass                       -> nothing to pay.
//  3. Within the grace period          -> nothing to pay (not for lost tickets).
//  4. Base fee from slabs. A slab's rate is the TOTAL fee for a stay up to
//     that many minutes. Past the last slab, each started hour adds
//     `additionalPerHour`. Two special cases come first:
//       - `flatFee`: one fee for the whole stay (events).
//       - long stay: a stay longer than `longStayAfterMinutes` pays
//         `longStayDailyRate` for every started 24 hours (airports).
//  5. `maxDailyFee` caps the base fee for every 24 hours of the stay.
//  6. `minimumFee` is the least a chargeable stay pays.
//  7. `overnightFee` is added once for every midnight the stay crosses.
//  8. `lostTicketFee` is added as a penalty when the ticket is lost.
//  9. Discount percent is taken off, then tax is applied (or extracted when
//     the tariff's prices already include tax).

const AppError = require("../utils/AppError");

const MINUTE = 60 * 1000;
const DAY_MINUTES = 24 * 60;
// Local time of the parking sites, as minutes ahead of UTC. India = 330.
const DEFAULT_UTC_OFFSET = () => Number(process.env.APP_UTC_OFFSET_MINUTES ?? 330);

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const toDate = (value, name) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(`Invalid ${name}`, 400);
  return date;
};

const durationMinutes = (entryTime, exitTime) => {
  const diff = exitTime.getTime() - entryTime.getTime();
  if (diff < 0) throw new AppError("Exit time cannot be before entry time", 400);
  return Math.ceil(diff / MINUTE);
};

// Number of local midnights between entry and exit.
const midnightsCrossed = (entryTime, exitTime, utcOffsetMinutes) => {
  const localDay = (date) => Math.floor((date.getTime() / MINUTE + utcOffsetMinutes) / DAY_MINUTES);
  return Math.max(0, localDay(exitTime) - localDay(entryTime));
};

const sortedSlabs = (tariff) =>
  [...(tariff.slabs || [])].sort((a, b) => a.uptoMinutes - b.uptoMinutes);

// Fee for a stay of `minutes`, from slabs and the hourly rate only.
const slabFee = (tariff, minutes) => {
  if (minutes <= 0) return 0;
  const slabs = sortedSlabs(tariff);
  const perHour = tariff.additionalPerHour || 0;

  if (!slabs.length) return Math.ceil(minutes / 60) * perHour;

  const slab = slabs.find((s) => minutes <= s.uptoMinutes);
  if (slab) return slab.rate;

  const last = slabs[slabs.length - 1];
  return last.rate + Math.ceil((minutes - last.uptoMinutes) / 60) * perHour;
};

const has = (value) => value !== undefined && value !== null;

// Base fee with the daily cap applied to each 24-hour block of the stay.
const baseFee = (tariff, minutes) => {
  if (has(tariff.flatFee)) return tariff.flatFee;
  if (has(tariff.longStayAfterMinutes) && has(tariff.longStayDailyRate) && minutes > tariff.longStayAfterMinutes) {
    return Math.ceil(minutes / DAY_MINUTES) * tariff.longStayDailyRate;
  }
  const cap = tariff.maxDailyFee;
  if (cap === undefined || cap === null) return slabFee(tariff, minutes);

  const fullDays = Math.floor(minutes / DAY_MINUTES);
  const rest = minutes % DAY_MINUTES;
  return fullDays * cap + Math.min(slabFee(tariff, rest), cap);
};

/**
 * Calculates the parking fee.
 * @param {object} tariff  A Tariff document or plain object.
 * @param {object} options entryTime, exitTime, lostTicket, hasValidPass,
 *                         discountPercent, utcOffsetMinutes
 */
const calculateFee = (tariff, options = {}) => {
  if (!tariff) throw new AppError("No tariff is set up for this vehicle type at this location", 409);

  const entryTime = toDate(options.entryTime, "entry time");
  const exitTime = toDate(options.exitTime ?? new Date(), "exit time");
  const utcOffset = options.utcOffsetMinutes ?? DEFAULT_UTC_OFFSET();
  const lostTicket = Boolean(options.lostTicket);
  const discountPercent = Math.min(100, Math.max(0, options.discountPercent || 0));
  const taxPercent = tariff.taxPercent || 0;
  const taxInclusive = tariff.taxInclusive !== false;

  const minutes = durationMinutes(entryTime, exitTime);
  const result = {
    durationMinutes: minutes,
    reason: "CHARGED",
    breakdown: { base: 0, overnight: 0, lostTicket: 0, discount: 0 },
    subtotal: 0,
    tax: 0,
    total: 0,
    taxPercent,
    taxInclusive,
  };

  if (options.hasValidPass) return { ...result, reason: "PASS" };

  const withinGrace = minutes <= (tariff.gracePeriodMinutes || 0);
  if (withinGrace && !lostTicket) return { ...result, reason: "GRACE_PERIOD" };

  let base = withinGrace ? 0 : baseFee(tariff, minutes);
  if (!withinGrace) base = Math.max(base, tariff.minimumFee || 0);

  const nights = withinGrace ? 0 : midnightsCrossed(entryTime, exitTime, utcOffset);
  const overnight = nights * (tariff.overnightFee || 0);
  const lost = lostTicket ? tariff.lostTicketFee || 0 : 0;

  const gross = base + overnight + lost;
  const discount = round2((gross * discountPercent) / 100);
  const amount = gross - discount;

  let subtotal;
  let tax;
  let total;
  if (taxInclusive) {
    total = round2(amount);
    tax = round2(total - total / (1 + taxPercent / 100));
    subtotal = round2(total - tax);
  } else {
    subtotal = round2(amount);
    tax = round2((subtotal * taxPercent) / 100);
    total = round2(subtotal + tax);
  }

  return {
    ...result,
    reason: lostTicket ? "LOST_TICKET" : "CHARGED",
    breakdown: { base: round2(base), overnight: round2(overnight), lostTicket: round2(lost), discount },
    subtotal,
    tax,
    total,
  };
};

// "HH:MM" as minutes since midnight.
const clockMinutes = (text) => {
  const [h, m] = String(text).split(":").map(Number);
  return h * 60 + m;
};

// True when the tariff may be used for a stay that starts at `at`.
const appliesAt = (tariff, at, utcOffsetMinutes = DEFAULT_UTC_OFFSET()) => {
  if (tariff.isActive === false) return false;
  if (tariff.validFrom && at < new Date(tariff.validFrom)) return false;
  if (tariff.validTo && at > new Date(tariff.validTo)) return false;
  const local = new Date(at.getTime() + utcOffsetMinutes * MINUTE);
  const days = tariff.daysOfWeek || [];
  if (days.length && !days.includes(local.getUTCDay())) return false;
  if (tariff.startTime && tariff.endTime) {
    const now = local.getUTCHours() * 60 + local.getUTCMinutes();
    const from = clockMinutes(tariff.startTime);
    const to = clockMinutes(tariff.endTime);
    // A window such as 22:00 to 06:00 crosses midnight.
    const inside = from < to ? now >= from && now < to : now >= from || now < to;
    if (!inside) return false;
  }
  return true;
};

// Picks the tariff for a stay from the candidates of one location and
// vehicle type. Order of preference: higher `priority`; then an EVENT tariff
// over the others (so a match-day rate beats the weekend rate); then one
// limited to days, dates or a time window over a general one; between
// equals, the most recently created wins.
const selectTariff = (tariffs, entryTime, utcOffsetMinutes) => {
  const at = toDate(entryTime, "entry time");
  const specificity = (t) =>
    ((t.daysOfWeek || []).length ? 2 : 0) + (t.validFrom || t.validTo ? 1 : 0) + (t.startTime && t.endTime ? 1 : 0);
  const usable = tariffs.filter((t) => appliesAt(t, at, utcOffsetMinutes));
  usable.sort(
    (a, b) =>
      (b.priority || 0) - (a.priority || 0) ||
      Number(b.kind === "EVENT") - Number(a.kind === "EVENT") ||
      specificity(b) - specificity(a) ||
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
  return usable[0] || null;
};

// Problems that would make a tariff's slabs ambiguous. Returns a message or null.
const slabProblem = (slabs = []) => {
  for (let i = 1; i < slabs.length; i += 1) {
    if (slabs[i].uptoMinutes <= slabs[i - 1].uptoMinutes) {
      return "Each slab must cover a longer duration than the one before it";
    }
    if (slabs[i].rate < slabs[i - 1].rate) {
      return "A longer slab cannot cost less than a shorter one";
    }
  }
  return null;
};

// Rules a tariff must follow before it is saved. Returns a message or null.
const tariffProblem = (t) => {
  const slabs = slabProblem(t.slabs);
  if (slabs) return slabs;
  if (!(t.slabs || []).length && !t.additionalPerHour && !has(t.flatFee)) {
    return "Add at least one slab, an hourly rate or a flat fee";
  }
  if (t.validFrom && t.validTo && new Date(t.validTo) < new Date(t.validFrom)) {
    return "Valid-to date must be after valid-from date";
  }
  if (Boolean(t.startTime) !== Boolean(t.endTime)) return "Set both the start and the end time, or neither";
  if (t.startTime && t.startTime === t.endTime) return "The start and end time cannot be the same";
  if (has(t.longStayAfterMinutes) !== has(t.longStayDailyRate)) {
    return "Long stay needs both the number of minutes and the daily rate";
  }
  if (t.kind === "EVENT") {
    if (!t.eventName) return "Give the event a name";
    if (!t.validFrom || !t.validTo) return "An event needs a start and an end date";
  }
  return null;
};

module.exports = {
  calculateFee, selectTariff, appliesAt, slabProblem,
  durationMinutes, midnightsCrossed, slabFee, baseFee, tariffProblem,
};
