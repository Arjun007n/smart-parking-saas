// Monthly passes: when is a pass valid, what period does a sale or renewal
// buy, and which pass belongs to a vehicle.
//
// Dates: a pass runs from `startDate` (local midnight, included) up to
// `endDate` (local midnight, excluded). "Valid until 31 March" therefore has
// an endDate of 1 April 00:00 local time.

const crypto = require("crypto");
const AppError = require("../utils/AppError");
const { isCompanyWide } = require("../config/permissions");
const Pass = require("../models/Pass");
const { notify } = require("./notificationService");
const emailService = require("./emailService");
const messageService = require("./messageService");
const { dayRange, startOfLocalDay, addMonthsLocal, addDaysLocal, localDateStamp, DAY } = require("../utils/time");

const PASS_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PASS_PATTERN = /^P-\d{6}-[2-9A-HJ-NP-Z]{6}$/;
const MAX_MONTHS = 36;
// How long a pass may be bought for, per unit.
const UNIT_LIMITS = { DAY: 366, WEEK: 156, MONTH: MAX_MONTHS };
const UNIT_WORDS = { DAY: "Days", WEEK: "Weeks", MONTH: "Months" };
const EXPIRY_WARNING_DAYS = 7;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Pass numbers look like P-260302-K7QXMP: date of sale plus 6 random characters.
const generatePassNumber = (date = new Date()) => {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += PASS_ALPHABET[crypto.randomInt(PASS_ALPHABET.length)];
  return `P-${localDateStamp(date)}-${code}`;
};

// ACTIVE, UPCOMING, EXPIRED, SUSPENDED or CANCELLED, as of `now`.
const passState = (pass, now = new Date()) => {
  if (pass.status === "CANCELLED") return "CANCELLED";
  if (pass.status === "SUSPENDED") return "SUSPENDED";
  if (now < pass.startDate) return "UPCOMING";
  if (now >= pass.endDate) return "EXPIRED";
  return "ACTIVE";
};

const coversLocation = (pass, locationId) =>
  !pass.locationIds || pass.locationIds.length === 0 || pass.locationIds.some((id) => String(id) === String(locationId));

// A pass waits for approval when an admin has set it to PENDING (old passes have no such field: approved).
const isApproved = (pass) => !pass || pass.approval !== "PENDING";

// True when this pass lets its vehicle through at this location right now.
const isValidAt = (pass, locationId, now = new Date()) =>
  Boolean(pass) && isApproved(pass) && passState(pass, now) === "ACTIVE" && coversLocation(pass, locationId);

// The vehicles of a pass, also for old passes that only have vehicleNumber.
const passVehicles = (pass) =>
  pass.vehicles && pass.vehicles.length ? pass.vehicles : [{ number: pass.vehicleNumber, type: pass.vehicleType }];

// What the screens show about a pass.
const summarize = (pass, locationId, now = new Date()) => {
  if (!pass) return null;
  const state = passState(pass, now);
  return {
    _id: pass._id,
    passNumber: pass.passNumber,
    vehicleNumber: pass.vehicleNumber,
    vehicles: passVehicles(pass).map((v) => v.number),
    passType: pass.passType || "REGULAR",
    holderName: pass.holderName,
    state,
    approval: isApproved(pass) ? "APPROVED" : "PENDING",
    validHere: isValidAt(pass, locationId, now),
    coversHere: coversLocation(pass, locationId),
    startDate: pass.startDate,
    endDate: pass.endDate,
    daysLeft: state === "ACTIVE" ? Math.ceil((pass.endDate - now) / DAY) : 0,
  };
};

// What a request asks for: `unit` + `count`, or the older `months`. Default 1 month.
const resolveTerm = ({ unit, count, months } = {}) => {
  if (months !== undefined && (unit !== undefined || count !== undefined)) {
    throw new AppError("Send either months, or unit and count, not both", 400);
  }
  const term = months !== undefined ? { unit: "MONTH", count: months } : { unit: unit || "MONTH", count: count ?? 1 };
  if (!UNIT_LIMITS[term.unit]) throw new AppError("Unit must be DAY, WEEK or MONTH", 400);
  const max = UNIT_LIMITS[term.unit];
  if (!Number.isInteger(term.count) || term.count < 1 || term.count > max) {
    throw new AppError(`${UNIT_WORDS[term.unit]} must be a whole number from 1 to ${max}`, 400);
  }
  return term;
};

// The local midnight a purchase of `term` ends at when it starts at `start`.
const endOfTerm = (start, term) => {
  if (term.unit === "DAY") return addDaysLocal(start, term.count);
  if (term.unit === "WEEK") return addDaysLocal(start, term.count * 7);
  return addMonthsLocal(start, term.count);
};

// `months` as a plain number (older callers) or a term object.
const asTerm = (value) => resolveTerm(typeof value === "number" ? { months: value } : value);

// The period a brand-new pass covers. `startText` is "YYYY-MM-DD" (default today).
const newPeriod = ({ startText, months, unit, count, now = new Date() }) => {
  const term = resolveTerm({ months, unit, count });
  const start = startText ? dayRange(startText).start : startOfLocalDay(now);
  return { start, end: endOfTerm(start, term), ...term };
};

// A period given as two calendar days, first and last both included ("Valid From" and "Valid To").
// Counts as days: a pass from 1 to 30 September is 30 days.
const MAX_SPAN_DAYS = 1100;
const datedPeriod = ({ from, to, now = new Date() }) => {
  if (!to) throw new AppError("Enter the date the pass is valid up to", 400);
  const start = from ? dayRange(from).start : startOfLocalDay(now);
  const end = dayRange(to).end; // the pass runs through the whole last day
  if (end <= start) throw new AppError("The last day must not be before the first day", 400);
  const count = Math.round((end - start) / DAY);
  if (count > MAX_SPAN_DAYS) throw new AppError(`A pass can last at most ${MAX_SPAN_DAYS} days`, 400);
  return { start, end, unit: "DAY", count };
};

// The period a renewal buys. A pass that is still running is extended from its
// end date; one that has already ended restarts today (no free gap in between).
// `term` is a number of months or { unit, count }.
const renewalPeriod = (pass, term, now = new Date()) => {
  const resolved = asTerm(term);
  const today = startOfLocalDay(now);
  const continues = pass.endDate > today;
  const start = continues ? pass.endDate : today;
  return { start, end: endOfTerm(start, resolved), continues, ...resolved };
};

// Tax included in an amount that already contains it.
const taxIncluded = (amount, taxPercent = 0) =>
  taxPercent > 0 ? round2(amount - amount / (1 + taxPercent / 100)) : 0;

// ----------------------------------------------------------------- queries

// The current pass a vehicle belongs to (as main or extra vehicle). Passes
// from before multi-vehicle support are found by `vehicleNumber`.
const findCurrentPass = (companyId, vehicleNumber) =>
  Pass.findOne({ companyId, isCurrent: true, $or: [{ "vehicles.number": vehicleNumber }, { vehicleNumber }] });

// Gives passes that have no `vehicles` list one (their main vehicle). Safe to
// run again and again; returns how many were updated.
const backfillVehicles = async () => {
  const result = await Pass.updateMany(
    { "vehicles.0": { $exists: false }, vehicleNumber: { $exists: true } },
    [{ $set: { vehicles: [{ number: "$vehicleNumber", type: "$vehicleType", addedAt: "$createdAt" }] } }],
    { updatePipeline: true }
  );
  return result.modifiedCount || 0;
};

// Creates a pass, retrying in the very unlikely case of a number clash.
const createPassWithNumber = async (data) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Pass.create({ ...data, passNumber: generatePassNumber() });
    } catch (error) {
      const numberClash = error.code === 11000 && error.keyPattern && error.keyPattern.passNumber;
      if (!numberClash) throw error;
    }
  }
  throw new AppError("Could not create a pass number. Please try again.", 503);
};

// Alerts the admins about passes that end within a week. One alert per pass
// and end date. Returns how many were raised.
const checkPassExpiry = async (now = new Date()) => {
  const soon = new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY);
  const passes = await Pass.find({ isCurrent: true, status: "ACTIVE", endDate: { $gt: now, $lte: soon } }).limit(500);

  let raised = 0;
  for (const pass of passes) {
    const daysLeft = Math.ceil((pass.endDate - now) / DAY);
    const created = await notify({
      companyId: pass.companyId,
      locationId: pass.locationIds.length === 1 ? pass.locationIds[0] : undefined,
      type: "PASS_EXPIRY",
      severity: daysLeft <= 2 ? "warning" : "info",
      title: `Pass ${pass.passNumber} ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      message: `${pass.holderName} (${pass.vehicleNumber}). Renew it to keep free parking.`,
      data: { passId: pass._id, vehicleNumber: pass.vehicleNumber },
      dedupeKey: `pass-expiry:${pass._id}:${pass.endDate.getTime()}`,
    });
    if (created) {
      raised += 1;
      // The holder gets one reminder too (same de-duplication as the alert above).
      emailService.sendPassNotice({ pass, kind: "EXPIRING", daysLeft });
      messageService.sendPassNotice({ pass, kind: "EXPIRING", daysLeft });
    }
  }
  return raised;
};

// Passes a user may see and manage. Company-wide roles: every pass of the
// company. A location admin: only passes tied to their own locations (never a
// company-wide pass, and never one that also works at someone else's location).
const scopeFilter = (req) => {
  const filter = { ...req.tenantFilter };
  if (!isCompanyWide(req.user.role)) {
    const mine = Array.from(req.user.locationIds);
    filter["locationIds.0"] = { $exists: true };
    filter.locationIds = { $not: { $elemMatch: { $nin: mine } } };
  }
  return filter;
};

module.exports = {
  scopeFilter,
  isApproved, datedPeriod, MAX_SPAN_DAYS,
  PASS_PATTERN, MAX_MONTHS, UNIT_LIMITS, resolveTerm, endOfTerm, passVehicles, backfillVehicles, generatePassNumber, passState, coversLocation, isValidAt, summarize,
  newPeriod, renewalPeriod, taxIncluded, findCurrentPass, createPassWithNumber, checkPassExpiry,
};
