const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { isCompanyWide } = require("../config/permissions");
const hub = require("../services/liveHub");
const User = require("../models/User");
const Company = require("../models/Company");

const BLOCKED_SUBSCRIPTIONS = ["SUSPENDED", "CANCELLED"];

// Is this person still allowed to listen, and where? Asked again every few minutes while a stream is open
// (see liveHub.sweepPeople): false closes the stream, { locationIds } narrows or widens what it hears.
const recheckFor = (user, wanted) => async () => {
  const fresh = await User.findById(user._id).select("isActive tokenVersion role companyId locationIds");
  if (!fresh || !fresh.isActive || fresh.tokenVersion !== user.tokenVersion) return false;
  if (fresh.role !== "SUPER_ADMIN") {
    const company = fresh.companyId ? await Company.findById(fresh.companyId).select("isActive subscriptionStatus") : null;
    if (!company || !company.isActive || BLOCKED_SUBSCRIPTIONS.includes(company.subscriptionStatus)) return false;
  }
  let locationIds = isCompanyWide(fresh.role) ? null : Array.from(fresh.locationIds || []).map(String);
  if (wanted) {
    if (locationIds && !locationIds.includes(wanted)) return false;
    locationIds = [wanted];
  }
  return { locationIds };
};

// GET /api/live/stream[?locationId=]
// A stream of "something changed" messages for the screens (see services/liveHub.js).
// It carries ids only; the screen reloads the data through the normal, permission-checked API.
// Browsers' EventSource cannot send the login header, so the client reads this with fetch.
const stream = (req, res, next) => {
  // Company-wide roles hear about every location of their company; the others, only their own.
  let locationIds = isCompanyWide(req.user.role) ? null : Array.from(req.user.locationIds || []).map(String);
  const wanted = req.query.locationId;
  if (wanted !== undefined) {
    if (typeof wanted !== "string" || !mongoose.isValidObjectId(wanted)) return next(new AppError("Invalid locationId", 400));
    if (locationIds && !locationIds.includes(wanted)) return next(new AppError("You do not have access to that location", 403));
    locationIds = [wanted];
  }

  const client = hub.addPerson(req, res, {
    userId: req.user._id, companyId: req.companyId, locationIds, recheck: recheckFor(req.user, wanted),
  });
  if (!client) return next(new AppError("Too many live connections. The page will keep refreshing normally.", 503));
  return undefined;
};

module.exports = { stream, recheckFor };
