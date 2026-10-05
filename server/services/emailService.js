// The emails the platform sends, and who gets them.
//
//   password reset     to the person who asked
//   alerts             a copy of each in-app alert, to the company admins and the admins of
//                      the alert's location, according to each person's "email alerts" choice
//                      (OFF, CRITICAL (default), IMPORTANT = warning and critical, ALL)
//
// Sending never makes the request that caused it slower or fail: callers use the
// fire-and-forget helpers, which log problems. Tests wait with flush().

const env = require("../config/env");
const email = require("../integrations/email");
const User = require("../models/User");
const Company = require("../models/Company");
const Location = require("../models/Location");
const { ROLES } = require("../config/permissions");
const { localDateText } = require("../utils/time");

const ALERT_LEVELS = ["OFF", "CRITICAL", "IMPORTANT", "ALL"];
const DEFAULT_ALERT_LEVEL = "CRITICAL";
const SEVERITY_RANK = { info: 1, warning: 2, critical: 3 };
const LEVEL_MIN_RANK = { ALL: 1, IMPORTANT: 2, CRITICAL: 3 };

const escapeHtml = (value) =>
  String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// One shared look. Every value that came from a person or the database is escaped.
const layout = ({ heading, paragraphs, button, footer }) => {
  const text = [heading, "", ...paragraphs, ...(button ? ["", `${button.label}: ${button.url}`] : []), "", "--", footer].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(p)}</p>`).join("\n")}
${button ? `<p style="margin:20px 0 4px"><a href="${escapeHtml(button.url)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block">${escapeHtml(button.label)}</a></p>
<p style="font-size:12px;color:#64748b;margin:8px 0 0;word-break:break-all">${escapeHtml(button.url)}</p>` : ""}
</div>
<p style="font-size:12px;color:#64748b;margin:16px 4px 0">${escapeHtml(footer)}</p>
</div></body></html>`;
  return { text, html };
};

const renderPasswordReset = ({ name, url, minutes }) => ({
  subject: "Reset your Smart Parking password",
  ...layout({
    heading: "Reset your password",
    paragraphs: [
      `Hello ${name || "there"},`,
      `We received a request to reset the password of your account. The link below works for ${minutes} minutes and only once.`,
      "If you did not ask for this, ignore this email: your password stays the same.",
    ],
    button: { label: "Choose a new password", url },
    footer: "Smart Parking. Never share this link with anyone.",
  }),
});

// Long date such as "2 March 2026" for the local day that `instant` falls on.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (instant) => {
  const [year, month, day] = localDateText(instant).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};

// To the pass holder. kind: NEW (pass sold), RENEWED, EXPIRING (reminder). A pass's `endDate` is
// midnight AFTER the last day, so the last valid day is the day before it.
const renderPassNotice = ({ kind, pass, companyName, locationName, daysLeft }) => {
  const lastDay = longDate(new Date(pass.endDate.getTime() - 1));
  const vehicles = (pass.vehicles && pass.vehicles.length ? pass.vehicles.map((v) => v.number) : [pass.vehicleNumber]).join(", ");
  const facts = [
    `Pass number: ${pass.passNumber}`,
    `Vehicle${vehicles.includes(",") ? "s" : ""}: ${vehicles}`,
    `Valid from ${longDate(pass.startDate)} to ${lastDay}`,
  ];
  const where = [companyName, locationName].filter(Boolean).join(" · ");
  const base = { footer: `You get this because this email address was given for parking pass ${pass.passNumber}. Ask the parking office to remove it if it is not yours.` };
  if (kind === "EXPIRING") {
    return {
      subject: `Your parking pass ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      ...layout({
        heading: "Your parking pass ends soon",
        paragraphs: [`Hello ${pass.holderName},`, `Your pass for ${vehicles} is valid until ${lastDay}. Renew it at the parking office to keep free parking.`, ...facts, where].filter(Boolean),
        ...base,
      }),
    };
  }
  const renewed = kind === "RENEWED";
  return {
    subject: renewed ? `Your parking pass ${pass.passNumber} is renewed` : `Your parking pass ${pass.passNumber}`,
    ...layout({
      heading: renewed ? "Your parking pass is renewed" : "Your parking pass is ready",
      paragraphs: [`Hello ${pass.holderName},`, renewed ? "Thank you. Your pass has been extended." : "Thank you. Your pass is active.", ...facts, where].filter(Boolean),
      ...base,
    }),
  };
};

const renderAlert = ({ notification, companyName, locationName, url }) => {
  const urgent = notification.severity === "critical";
  return {
    subject: `${urgent ? "Urgent: " : ""}${notification.title}`,
    ...layout({
      heading: notification.title,
      paragraphs: [
        notification.message,
        [companyName, locationName].filter(Boolean).join(" · "),
      ].filter(Boolean),
      button: { label: "Open alerts", url },
      footer: "You get this because you are an admin. Change which alerts reach your inbox under My account > Email alerts.",
    }),
  };
};

// ---- background sending -------------------------------------------------

const pending = new Set();
const track = (promise) => {
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
};
// Resolves when every email started so far has been handled (used by tests and on shutdown).
const flush = async () => {
  while (pending.size) await Promise.allSettled([...pending]);
};

const background = (work, what) =>
  track(Promise.resolve().then(work).catch((error) => console.error(`${what} failed:`, error.message)));

// ---- alert recipients and the hourly cap ---------------------------------

const alertLevelOf = (user) => (ALERT_LEVELS.includes(user.emailAlerts) ? user.emailAlerts : DEFAULT_ALERT_LEVEL);
const wants = (user, severity) => {
  const level = alertLevelOf(user);
  return level !== "OFF" && (SEVERITY_RANK[severity] || 1) >= LEVEL_MIN_RANK[level];
};

// Company admins, plus location admins of the alert's location (for a company-level
// alert: every location admin, as in the app). People who switched that level off are left out.
const alertRecipients = async ({ companyId, locationId, severity }) => {
  const scope = [{ role: ROLES.COMPANY_ADMIN }];
  scope.push(locationId ? { role: ROLES.LOCATION_ADMIN, locationIds: locationId } : { role: ROLES.LOCATION_ADMIN });
  const users = await User.find({ companyId, isActive: true, $or: scope }).select("email emailAlerts").limit(100).lean();
  return users.filter((u) => wants(u, severity)).map((u) => u.email);
};

const hourly = new Map(); // companyId -> { count, resetAt }
const hourlyCap = () => Math.max(1, Number(process.env.EMAIL_ALERT_HOURLY_CAP) || 30);
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
  if (!email.isEnabled()) return { sent: false, reason: "email is not switched on" };
  const { companyId, locationId, severity } = notification;
  if (!underCap(companyId)) {
    console.error(`Alert email skipped for company ${companyId}: more than ${hourlyCap()} alert emails this hour`);
    return { sent: false, reason: "hourly limit reached" };
  }
  const to = await alertRecipients({ companyId, locationId, severity });
  if (!to.length) return { sent: false, reason: "nobody wants this level of alert by email" };

  const [company, location] = await Promise.all([
    Company.findById(companyId).select("name").lean(),
    locationId ? Location.findById(locationId).select("name").lean() : null,
  ]);
  const message = renderAlert({
    notification, companyName: company && company.name, locationName: location && location.name,
    url: `${env.clientUrl}/dashboard/notifications`,
  });
  return email.send({ to, ...message, key: notification._id ? `alert:${notification._id}` : undefined });
};

// Called for every stored alert. Does its work in the background.
const sendAlert = (notification) => {
  if (!email.isEnabled()) return null;
  return background(() => sendAlertNow(notification), "Alert email");
};

const sendPasswordReset = ({ user, url, minutes }) => {
  if (!email.isEnabled()) return null;
  return background(() => email.send({ to: [user.email], ...renderPasswordReset({ name: user.name, url, minutes }) }), "Password reset email");
};

// Emails the pass holder (only when the pass has an address). kind: NEW, RENEWED or EXPIRING.
// Runs in the background and never fails the request or job that caused it.
const sendPassNotice = ({ pass, kind, daysLeft }) => {
  if (!email.isEnabled() || !pass || !email.isEmail(pass.email)) return null;
  return background(async () => {
    const [company, location] = await Promise.all([
      Company.findById(pass.companyId).select("name").lean(),
      pass.locationIds && pass.locationIds.length === 1 ? Location.findById(pass.locationIds[0]).select("name").lean() : null,
    ]);
    const message = renderPassNotice({ kind, pass, companyName: company && company.name, locationName: location && location.name, daysLeft });
    // The key makes a repeated send of the same notice harmless at the provider.
    await email.send({ to: [pass.email], ...message, key: `pass:${kind}:${pass._id}:${pass.endDate.getTime()}` });
  }, "Pass email");
};

// The invoice for a paid plan, with the PDF attached.
const renderInvoice = ({ invoice, companyName, url }) => {
  const goods = invoice.kind === "SHOP";
  return {
    subject: goods ? `Invoice ${invoice.number} for your hardware order` : `Invoice ${invoice.number} for your Smart Parking plan`,
    ...layout({
      heading: goods ? "Thank you. We received your order." : "Thank you. Your plan is active.",
      paragraphs: [
        `${invoice.description}.`,
        `Invoice ${invoice.number}: total Rs ${Number(invoice.total).toFixed(2)} including GST. The invoice is attached as a PDF.`,
        goods ? "We will tell you when the order ships. You can follow it, and download the invoice again, under My orders." : "You can download it again at any time from Billing.",
      ],
      button: { label: goods ? "Open My orders" : "Open Billing", url },
      footer: `Sent to the billing contact and admins of ${companyName || "your company"}.`,
    }),
  };
};

const sendInvoice = ({ to, invoice, company, pdf }) => {
  if (!email.isEnabled() || !to || !to.length) return null;
  return background(
    () => email.send({
      to, ...renderInvoice({ invoice, companyName: company && company.name, url: `${env.clientUrl}${invoice.kind === "SHOP" ? "/dashboard/orders" : "/dashboard/billing"}` }),
      key: `invoice:${invoice._id}`,
      attachments: [{ filename: `${String(invoice.number).replace(/[^A-Za-z0-9-]/g, "-")}.pdf`, content: pdf }],
    }),
    "Invoice email"
  );
};

// Generic: a ready message to some addresses (used by the end-of-day report). Background.
const sendMessage = ({ to, message, key, attachments }) => {
  if (!email.isEnabled() || !to || !to.length) return null;
  return background(() => email.send({ to, ...message, key, ...(attachments ? { attachments } : {}) }), "Email");
};

module.exports = {
  renderPassNotice, sendPassNotice, renderInvoice, sendInvoice, sendMessage, layout,
  ALERT_LEVELS, DEFAULT_ALERT_LEVEL, escapeHtml, renderPasswordReset, renderAlert, wants, alertRecipients, underCap,
  sendAlertNow, sendAlert, sendPasswordReset, flush,
};
