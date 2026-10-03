const Notification = require("../models/Notification");
const Company = require("../models/Company");
const { publish, EVENTS } = require("./eventBus");
const { sendExternal } = require("../integrations/notifications");
const { localDateStamp, DAY } = require("../utils/time");

// Creates an in-app notification. With a `dedupeKey`, the same alert is
// stored only once. Never throws: alerts must not break the main action.
const notify = async ({ companyId, locationId, type, severity = "info", title, message, data, dedupeKey }) => {
  try {
    const notification = await Notification.create({
      companyId, locationId, type, severity, title, message, data, dedupeKey,
    });
    publish(EVENTS.NOTIFICATION_NEW, { companyId, locationId, notification });
    // Critical alerts also go out by email/SMS/WhatsApp/push once a provider is set up.
    if (severity === "critical") await sendExternal({ companyId, locationId, title, message });
    return notification;
  } catch (error) {
    if (error.code !== 11000) console.error(`Notification failed (${type}):`, error.message);
    return null;
  }
};

// Capacity level of one vehicle type at a location.
const capacityLevel = (occupied, capacity) => {
  if (!capacity || capacity <= 0) return null;
  if (occupied >= capacity) return "full";
  if (occupied / capacity >= 0.9) return "almost";
  return null;
};

// Raised after an entry. At most one alert per location, type and level per hour.
const notifyCapacity = async (location, vehicleType) => {
  const key = vehicleType.toLowerCase();
  const level = capacityLevel(location.occupied[key], location.capacity[key]);
  if (!level) return null;

  const hour = new Date().toISOString().slice(11, 13);
  const label = vehicleType.toLowerCase();
  return notify({
    companyId: location.companyId,
    locationId: location._id,
    type: "CAPACITY",
    severity: level === "full" ? "critical" : "warning",
    title: level === "full" ? `${location.name} is full for ${label}s` : `${location.name} is almost full for ${label}s`,
    message: `${location.occupied[key]} of ${location.capacity[key]} ${label} spaces are occupied.`,
    data: { vehicleType, occupied: location.occupied[key], capacity: location.capacity[key] },
    dedupeKey: `capacity:${location._id}:${vehicleType}:${level}:${localDateStamp()}${hour}`,
  });
};

const notifyPaymentFailed = (payment, reason) =>
  notify({
    companyId: payment.companyId,
    locationId: payment.locationId,
    type: "PAYMENT_FAILED",
    severity: "warning",
    title: "An online payment failed",
    message: `Payment ${payment.transactionId} of ${payment.amount} failed${reason ? `: ${reason}` : "."}`,
    data: { paymentId: payment._id, sessionId: payment.sessionId },
    dedupeKey: `payment-failed:${payment._id}`,
  });

// Warns companies whose trial ends within 7 days or whose payment is overdue.
// At most one alert per company per day. Returns how many were raised.
const checkSubscriptions = async (now = new Date()) => {
  const soon = new Date(now.getTime() + 7 * DAY);
  const companies = await Company.find({
    isActive: true,
    $or: [{ subscriptionStatus: "TRIAL", trialEndsAt: { $lte: soon } }, { subscriptionStatus: "PAST_DUE" }],
  }).select("name subscriptionStatus trialEndsAt");

  let raised = 0;
  for (const company of companies) {
    const overdue = company.subscriptionStatus === "PAST_DUE";
    const daysLeft = overdue ? 0 : Math.ceil((company.trialEndsAt - now) / DAY);
    const created = await notify({
      companyId: company._id,
      type: "SUBSCRIPTION_EXPIRY",
      severity: overdue || daysLeft <= 0 ? "critical" : "warning",
      title: overdue ? "Subscription payment is overdue" : daysLeft <= 0 ? "Your trial has ended" : `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      message: overdue
        ? "Please pay the subscription to keep using the platform."
        : "Choose a plan to keep using the platform without interruption.",
      dedupeKey: `subscription:${company._id}:${localDateStamp(now)}`,
    });
    if (created) raised += 1;
  }
  return raised;
};

module.exports = { notify, capacityLevel, notifyCapacity, notifyPaymentFailed, checkSubscriptions };
