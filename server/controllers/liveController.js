const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { isCompanyWide } = require("../config/permissions");
const hub = require("../services/liveHub");

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

  const client = hub.addPerson(req, res, { userId: req.user._id, companyId: req.companyId, locationIds });
  if (!client) return next(new AppError("Too many live connections. The page will keep refreshing normally.", 503));
  return undefined;
};

module.exports = { stream };
