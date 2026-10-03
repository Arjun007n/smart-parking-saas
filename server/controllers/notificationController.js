const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { isCompanyWide } = require("../config/permissions");
const Notification = require("../models/Notification");

// Company-wide roles see every alert of the company. A location admin sees
// company-level alerts and those of their own locations.
const visibleFilter = (req) => {
  const filter = { ...req.tenantFilter };
  if (!isCompanyWide(req.user.role)) {
    filter.$or = [{ locationId: null }, { locationId: { $in: Array.from(req.user.locationIds) } }];
  }
  return filter;
};

// GET /api/notifications?unread=true
const listNotifications = async (req, res) => {
  const visible = visibleFilter(req);
  const unreadOnly = { readBy: { $ne: req.user._id } };

  const [items, unreadCount] = await Promise.all([
    Notification.find(req.query.unread === "true" ? { $and: [visible, unreadOnly] } : visible)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    Notification.countDocuments({ $and: [visible, unreadOnly] }),
  ]);

  const me = String(req.user._id);
  const notifications = items.map(({ readBy, ...rest }) => ({
    ...rest,
    read: (readBy || []).some((id) => String(id) === me),
  }));
  res.json({ success: true, data: { notifications, unreadCount } });
};

// POST /api/notifications/read   { ids: [...] }  or  { all: true }
const markRead = async (req, res) => {
  const { ids, all } = req.body;
  if (!all && (!ids || !ids.length)) throw new AppError("Send ids, or all: true", 400);

  const filter = all
    ? visibleFilter(req)
    : { $and: [visibleFilter(req), { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }] };
  const result = await Notification.updateMany(filter, { $addToSet: { readBy: req.user._id } });

  res.json({ success: true, data: { updated: result.modifiedCount } });
};

module.exports = { listNotifications, markRead };
