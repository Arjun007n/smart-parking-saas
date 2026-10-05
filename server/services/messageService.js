// The text messages (SMS / WhatsApp) the platform sends, and who gets them.
//
//   alerts          a copy of each in-app alert to the company admins and the admins of the alert's
//                   location, to the phone on their profile, by each person's "phone alerts" choice
//                   (OFF, CRITICAL (default), IMPORTANT = warning and critical, ALL)
//   entry / exit    a short note to the vehicle owner: ticket on entry, fee and thanks on exit.
//                   The number comes from the vehicle record, else from a current pass.
//   pass            to the pass holder when a pass is sold or renewed, and a reminder before it ends
//   booking         to the person who booked, when the booking is made
//
// Sending never makes the request that caused it slower or fail: callers use the fire-and-forget
// helpers, which log problems. Tests wait with flush().
// MESSAGING_VISIT_MESSAGES=off stops the entry/exit notes to vehicle owners (alerts and pass notes stay).

const messaging = require("../integrations/messaging");
const User = require("../models/User");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Vehicle = require("../models/Vehicle");
const Pass = require("../models/Pass");
const { ROLES } = require("../config/permissions");
const { localDateText, utcOffsetMinutes, MINUTE } = require("../utils/time");

const ALERT_LEVELS = ["OFF", "CRITICAL", "IMPORTANT", "ALL"];
const DEFAULT_ALERT_LEVEL = "CRITICAL";
const SEVERITY_RANK = { info: 1, warning: 2, critical: 3 };
const LEVEL_MIN_RANK = { ALL: 1, IMPORTANT: 2, CRITICAL: 3 };

// ---- wording --------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (instant) => {
  const [, month, day] = localDateText(instant).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
};
const timeText = (instant) => new Date(instant.getTime() + utcOffsetMinutes() * MINUTE).toISOString().slice(11, 16);
const rupees = (amount) => `Rs ${Number(amount || 0).toFixed(2).replace(/\.00$/, "")}`;
const duration = (minutes) => {
  const total = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};
const where = (companyName, locationName) => [companyName, locationName].filter(Boolean).join(", ");
const clean = (value) => String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();

const renderAlert = ({ notification, companyName, locationName }) =>
  [`${notification.severity === "critical" ? "URGENT: " : ""}${clean(notification.title)}`, clean(notification.message), where(companyName, locationName)]
    .filter(Boolean).join(" - ");

const renderVisit = ({ kind, session, companyName, locationName }) => {
  const place = where(companyName, locationName);
  if (kind === "ENTRY") {
    return `${place}: ${session.vehicleNumber} entered at ${timeText(session.entryTime)} on ${shortDate(session.entryTime)}. Ticket ${session.ticketNumber}.`;
  }
  const total = session.fee && session.fee.total !== undefined ? session.fee.total : 0;
  const due = session.fee && session.fee.due !== undefined ? session.fee.due : total;
  const paid = due > 0 ? `Paid ${rupees(due)}.` : session.passId ? "Covered by your pass." : "No fee.";
  return `${place}: ${session.vehicleNumber} left at ${session.exitTime ? timeText(session.exitTime) : "-"} after ${duration(session.durationMinutes)}. ${paid} Ticket ${session.ticketNumber}. Thank you!`;
};

const renderPass = ({ kind, pass, companyName, locationName, daysLeft }) => {
  const lastDay = shortDate(new Date(pass.endDate.getTime() - 1));
  const vehicles = (pass.vehicles && pass.vehicles.length ? pass.vehicles.map((v) => v.number) : [pass.vehicleNumber]).join(", ");
  const place = where(companyName, locationName);
  if (kind === "EXPIRING") {
    return `${place}: your parking pass ${pass.passNumber} (${vehicles}) ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}, on ${lastDay}. Renew it at the parking office.`;
  }
  return `${place}: your parking pass ${pass.passNumber} (${vehicles}) is ${kind === "RENEWED" ? "renewed" : "active"} until ${lastDay}.`;
};

const renderBooking = ({ booking, companyName, locationName }) =>
  `${where(companyName, locationName)}: booking confirmed for ${booking.vehicleNumber}, expected ${shortDate(booking.expectedAt)} ${timeText(booking.expectedAt)}.`;

// ---- background sending -------------------------------------------------

const pending = new Set();
const track = (promise) => {
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
};
// Resolves when every message started so far has been handled (used by tests and on shutdown).
const flush = async () => {
  while (pending.size) await Promise.allSettled([...pending]);
};
const background = (work, what) =>
  track(Promise.resolve().then(work).catch((error) => console.error(`${what} failed:`, error.message)));

const namesOf = async (companyId, locationId) => {
  const [company, location] = await Promise.all([
    Company.findById(companyId).select("name").lean(),
    locationId ? Location.findById(locationId).select("name").lean() : null,
  ]);
  return { companyName: company && company.name, locationName: location && location.name };
};

// ---- alerts to staff ----------------------------------------------------

const levelOf = (user) => (ALERT_LEVELS.includes(user.phoneAlerts) ? user.phoneAlerts : DEFAULT_ALERT_LEVEL);
const wants = (user, severity) => {
  const level = levelOf(user);
  return level !== "OFF" && (SEVERITY_RANK[severity] || 1) >= LEVEL_MIN_RANK[level];
};

// Company admins, plus location admins of the alert's location (company-level alert: every location
// admin), who have a usable phone number and did not switch this level off.
const alertRecipients = async ({ companyId, locationId, severity }) => {
  const scope = [{ role: ROLES.COMPANY_ADMIN }];
  scope.push(locationId ? { role: ROLES.LOCATION_ADMIN, locationIds: locationId } : { role: ROLES.LOCATION_ADMIN });
  const users = await User.find({ companyId, isActive: true, $or: scope }).select("phone phoneAlerts").limit(100).lean();
  return users.filter((u) => wants(u, severity) && messaging.isPhone(u.phone)).map((u) => messaging.normalizePhone(u.phone));
};

const hourly = new Map(); // companyId -> { count, resetAt }
const hourlyCap = () => Math.max(1, Number(process.env.MESSAGING_ALERT_HOURLY_CAP) || 20);
const underCap = (companyId, now = Date.now()) => {
  const key = String(companyId);
  let entry = hourly.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 60 * 60 * 1000 };
    hourly.set(key, entry);
  }
  if (entry.count >= hourlyCap()) return false;
  entry.count += 1;
  return true;
};

const sendAlertNow = async (notification) => {
  if (!messaging.isEnabled()) return { sent: false, reason: "messages are not switched on" };
  const { companyId, locationId, severity } = notification;
  const to = await alertRecipients({ companyId, locationId, severity });
  if (!to.length) return { sent: false, reason: "nobody with a phone number wants this level of alert" };
  if (!underCap(companyId)) {
    console.error(`Alert message skipped for company ${companyId}: more than ${hourlyCap()} alert messages this hour`);
    return { sent: false, reason: "hourly limit reached" };
  }
  const names = await namesOf(companyId, locationId);
  return messaging.send({ to, body: renderAlert({ notification, ...names }), key: notification._id ? `alert:${notification._id}` : undefined });
};

// Called for every stored alert. Does its work in the background.
const sendAlert = (notification) => {
  if (!messaging.isEnabled()) return null;
  return background(() => sendAlertNow(notification), "Alert message");
};

// ---- the vehicle owner: entry and exit ------------------------------------

// A number for this vehicle: the vehicle record first, then a current pass that lists the plate.
const ownerPhone = async ({ companyId, vehicleNumber }) => {
  const vehicle = await Vehicle.findOne({ companyId, plateNumber: vehicleNumber }).select("phone").lean();
  if (vehicle && messaging.isPhone(vehicle.phone)) return messaging.normalizePhone(vehicle.phone);
  const pass = await Pass.findOne({
    companyId, isCurrent: true, status: "ACTIVE", $or: [{ vehicleNumber }, { "vehicles.number": vehicleNumber }],
  }).select("phone").lean();
  return pass && messaging.isPhone(pass.phone) ? messaging.normalizePhone(pass.phone) : null;
};

const visitMessagesOn = () => String(process.env.MESSAGING_VISIT_MESSAGES || "on").trim().toLowerCase() !== "off";

// kind: ENTRY or EXIT. Background; the ticket number makes a repeat harmless at the provider.
const sendVisitNotice = ({ session, kind }) => {
  if (!messaging.isEnabled() || !visitMessagesOn() || !session) return null;
  return background(async () => {
    const to = await ownerPhone({ companyId: session.companyId, vehicleNumber: session.vehicleNumber });
    if (!to) return;
    const names = await namesOf(session.companyId, session.locationId);
    await messaging.send({ to, body: renderVisit({ kind, session, ...names }), key: `visit:${kind}:${session._id}` });
  }, "Visit message");
};

// ---- pass holders and bookings ---------------------------------------------

// kind: NEW, RENEWED or EXPIRING. Only when the pass has a phone number.
const sendPassNotice = ({ pass, kind, daysLeft }) => {
  if (!messaging.isEnabled() || !pass || !messaging.isPhone(pass.phone)) return null;
  return background(async () => {
    const names = await namesOf(pass.companyId, pass.locationIds && pass.locationIds.length === 1 ? pass.locationIds[0] : null);
    await messaging.send({
      to: pass.phone, body: renderPass({ kind, pass, ...names, daysLeft }),
      key: `pass:${kind}:${pass._id}:${pass.endDate.getTime()}`,
    });
  }, "Pass message");
};

const sendBookingNotice = ({ booking }) => {
  if (!messaging.isEnabled() || !booking || !messaging.isPhone(booking.phone)) return null;
  return background(async () => {
    const names = await namesOf(booking.companyId, booking.locationId);
    await messaging.send({ to: booking.phone, body: renderBooking({ booking, ...names }), key: `booking:${booking._id}` });
  }, "Booking message");
};

module.exports = {
  ALERT_LEVELS, DEFAULT_ALERT_LEVEL, renderAlert, renderVisit, renderPass, renderBooking, wants, alertRecipients, underCap,
  ownerPhone, sendAlertNow, sendAlert, sendVisitNotice, sendPassNotice, sendBookingNotice, flush,
};
