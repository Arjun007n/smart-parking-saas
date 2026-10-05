const Notification = require("../models/Notification");
const Company = require("../models/Company");
const { publish, EVENTS } = require("./eventBus");
const { sendExternal } = require("../integrations/notifications");
const emailService = require("./emailService");
const messageService = require("./messageService");
const { localDateStamp, DAY } = require("../utils/time");

// Creates an in-app notification. With a `dedupeKey`, the same alert is
// stored only once. Never throws: alerts must not break the main action.
const notify = async ({ companyId, locationId, type, severity = "info", title, message, data, dedupeKey }) => {
  try {
    const notification = await Notification.create({
      companyId, locationId, type, severity, title, message, data, dedupeKey,
    });
    publish(EVENTS.NOTIFICATION_NEW, { companyId, locationId, notification });
    // Email: every admin gets the alerts they chose (in the background, never slows the request).
    emailService.sendAlert(notification);
    // SMS / WhatsApp: the admins who chose it (see services/messageService.js).
    messageService.sendAlert(notification);
    // Critical alerts also go out by push once a provider is set up.
    if (severity === "critical") await sendExternal({ companyId, locationId, title, message }, ["push"]);
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

// Money and records disagree (customer charged twice, charged the wrong
// amount, paid after the vehicle was already released...). Someone must look,
// so it is critical and goes out by email/SMS as well.
const notifyPaymentIssue = (payment, title, message) =>
  notify({
    companyId: payment.companyId,
    locationId: payment.locationId,
    type: "PAYMENT_ISSUE",
    severity: "critical",
    title,
    message,
    data: { paymentId: payment._id, sessionId: payment.sessionId, transactionId: payment.transactionId },
    dedupeKey: `payment-issue:${payment._id}:${title}`,
  });

// A monitored device stopped reporting. One alert per outage; a barrier or
// camera being down stops the gate working, so those are critical.
const notifyHardwareOffline = (device) =>
  notify({
    companyId: device.companyId,
    locationId: device.locationId,
    type: "HARDWARE_OFFLINE",
    severity: device.type === "PRINTER" ? "warning" : "critical",
    title: `${device.name} is offline`,
    message: `${device.name} (${device.type.replace("_", " ").toLowerCase()}) has not reported since ${device.lastSeenAt ? device.lastSeenAt.toISOString() : "it was set up"}. Use the manual process until it is back.`,
    data: { hardwareId: device._id, type: device.type },
    dedupeKey: `hardware-offline:${device._id}:${device.lastSeenAt ? device.lastSeenAt.getTime() : 0}`,
  });

// Warns companies whose trial or paid plan ends within 7 days, or whose payment is overdue. A paid plan
// that has run past its end moves to PAST_DUE (the gates keep working; only an admin can suspend a company).
// At most one alert per company per day. Returns how many were raised.
const checkSubscriptions = async (now = new Date()) => {
  const soon = new Date(now.getTime() + 7 * DAY);
  const companies = await Company.find({
    isActive: true,
    $or: [
      { subscriptionStatus: "TRIAL", trialEndsAt: { $lte: soon } },
      { subscriptionStatus: "PAST_DUE" },
      { subscriptionStatus: "ACTIVE", "subscription.currentPeriodEnd": { $lte: soon } },
    ],
  }).select("name subscriptionStatus trialEndsAt subscription.currentPeriodEnd");

  let raised = 0;
  for (const company of companies) {
    let status = company.subscriptionStatus;
    const periodEnd = company.subscription && company.subscription.currentPeriodEnd;
    if (status === "ACTIVE" && periodEnd && periodEnd <= now) {
      await Company.updateOne({ _id: company._id, subscriptionStatus: "ACTIVE" }, { $set: { subscriptionStatus: "PAST_DUE" } });
      status = "PAST_DUE";
    }
    const overdue = status === "PAST_DUE";
    const paidPlan = status === "ACTIVE";
    const end = paidPlan ? periodEnd : company.trialEndsAt;
    const daysLeft = overdue ? 0 : Math.ceil((end - now) / DAY);
    const what = paidPlan ? "Your plan" : "Your trial";
    const created = await notify({
      companyId: company._id,
      type: "SUBSCRIPTION_EXPIRY",
      severity: overdue || daysLeft <= 0 ? "critical" : "warning",
      title: overdue ? "Subscription payment is overdue" : daysLeft <= 0 ? `${what} has ended` : `${what} ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      message: overdue
        ? "Please renew the plan in Billing to keep using the platform."
        : paidPlan ? "Renew in Billing to continue without a break." : "Choose a plan in Billing to keep using the platform without interruption.",
      dedupeKey: `subscription:${company._id}:${localDateStamp(now)}`,
    });
    if (created) raised += 1;
  }
  return raised;
};

module.exports = {
  notify, capacityLevel, notifyCapacity, notifyPaymentFailed, notifyPaymentIssue, notifyHardwareOffline, checkSubscriptions,
};
