// The end-of-day report: one email a day to the people a company chooses, with what happened at each
// location that day: vehicles in and out, money collected by method, passes sold, vehicles still inside.
//
// It is off until a company admin switches it on (Company > Daily report email) and needs email set
// up (EMAIL_PROVIDER). It is sent once a day, at the local time the company picks (22:00 by default).
// The same numbers are in the dashboard and the reports; this is just a copy that arrives by itself.

const mongoose = require("mongoose");
const { dayRange, localDateText, startOfLocalDay } = require("../utils/time");
const { round2 } = require("./collectionService");
const email = require("../integrations/email");
const { escapeHtml } = require("./emailService");
const env = require("../config/env");
const Company = require("../models/Company");
const Location = require("../models/Location");
const User = require("../models/User");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const { sumCounts } = require("../models/constants");

const METHODS = ["CASH", "UPI", "CARD", "GATEWAY", "FASTAG", "WALLET"];
const METHOD_LABEL = { CASH: "Cash", UPI: "UPI", CARD: "Card", GATEWAY: "Online", FASTAG: "FASTag", WALLET: "Wallet", COMPLIMENTARY: "Free" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (dateText) => {
  const [year, month, day] = dateText.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};
const rs = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// "HH:MM" <-> minutes after local midnight.
const minutesToText = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const textToMinutes = (text) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

// ---- the numbers ------------------------------------------------------------------------------

// Everything for one local day, per location and in total. `dateText` is "YYYY-MM-DD".
const buildSummary = async ({ companyId, dateText }) => {
  const { start, end } = dayRange(dateText);
  const locations = await Location.find({ companyId, isActive: true }).select("name capacity occupied").sort({ name: 1 }).lean();
  // Aggregations do not convert text ids to ObjectIds the way find() does, so do it here.
  const inScope = { companyId: new mongoose.Types.ObjectId(String(companyId)), locationId: { $in: locations.map((l) => l._id) } };

  const [entries, exits, inside, paid, refunds, passes, failedOnline] = await Promise.all([
    ParkingSession.aggregate([{ $match: { ...inScope, entryTime: { $gte: start, $lt: end } } }, { $group: { _id: "$locationId", count: { $sum: 1 } } }]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, status: { $ne: "CANCELLED" }, exitTime: { $gte: start, $lt: end } } },
      { $group: { _id: "$locationId", count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([{ $match: { ...inScope, isOpen: true } }, { $group: { _id: "$locationId", count: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: start, $lt: end } } },
      { $group: { _id: { l: "$locationId", m: "$method" }, amount: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": { $gte: start, $lt: end } } },
      { $group: { _id: "$locationId", amount: { $sum: "$refund.amount" } } },
    ]),
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: { $gte: start, $lt: end } } },
      { $group: { _id: { l: "$locationId", m: "$method" }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Payment.countDocuments({ ...inScope, method: "GATEWAY", status: "FAILED", createdAt: { $gte: start, $lt: end } }),
  ]);

  const countBy = (rows) => new Map(rows.map((r) => [String(r._id), r.count]));
  const entriesBy = countBy(entries);
  const exitsBy = countBy(exits);
  const insideBy = countBy(inside);
  const refundBy = new Map(refunds.map((r) => [String(r._id), r.amount]));

  const rows = locations.map((location) => {
    const id = String(location._id);
    const byMethod = Object.fromEntries(METHODS.map((m) => [m, 0]));
    let passSales = 0;
    let passCount = 0;
    for (const r of paid) if (String(r._id.l) === id) byMethod[r._id.m] = (byMethod[r._id.m] || 0) + r.amount;
    for (const r of passes) {
      if (String(r._id.l) !== id) continue;
      byMethod[r._id.m] = (byMethod[r._id.m] || 0) + r.amount;
      passSales += r.amount;
      passCount += r.count;
    }
    const gross = Object.values(byMethod).reduce((t, v) => t + v, 0);
    const refunded = refundBy.get(id) || 0;
    return {
      locationId: location._id,
      name: location.name,
      entries: entriesBy.get(id) || 0,
      exits: exitsBy.get(id) || 0,
      inside: insideBy.get(id) || 0,
      capacity: sumCounts(location.capacity),
      byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, round2(v)])),
      passSales: round2(passSales),
      passCount,
      refunded: round2(refunded),
      collected: round2(gross - refunded),
    };
  });

  return { dateText, rows, totals: totalsOf(rows, failedOnline) };
};

// The totals line of a list of location rows.
const totalsOf = (rows, failedOnline = 0) => {
  const total = (pick) => rows.reduce((t, r) => t + pick(r), 0);
  const methodTotals = Object.fromEntries([...METHODS, "COMPLIMENTARY"].map((m) => [m, round2(total((r) => r.byMethod[m] || 0))]));
  return {
    entries: total((r) => r.entries),
    exits: total((r) => r.exits),
    inside: total((r) => r.inside),
    capacity: total((r) => r.capacity),
    collected: round2(total((r) => r.collected)),
    refunded: round2(total((r) => r.refunded)),
    passSales: round2(total((r) => r.passSales)),
    passCount: total((r) => r.passCount),
    byMethod: methodTotals,
    failedOnline,
  };
};

// The same summary reduced to one location.
const summaryForLocation = (summary, locationId) => {
  const rows = summary.rows.filter((r) => String(r.locationId) === String(locationId));
  return { dateText: summary.dateText, rows, totals: totalsOf(rows, 0) };
};

// ---- the message ------------------------------------------------------------------------------

const methodLine = (byMethod) =>
  Object.entries(byMethod).filter(([, v]) => v > 0).map(([m, v]) => `${METHOD_LABEL[m] || m} ${rs(v)}`).join(", ") || "no money collected";

const renderReport = ({ companyName, summary, partial = false, url }) => {
  const { totals, rows, dateText } = summary;
  const subject = `${partial ? "Report so far" : "Daily report"} ${longDate(dateText)}: ${rs(totals.collected)} collected, ${totals.entries} in, ${totals.exits} out`;
  const lines = [
    `${companyName} - ${partial ? "report so far for" : "end-of-day report for"} ${longDate(dateText)}`,
    "",
    `Collected: ${rs(totals.collected)}${totals.refunded ? ` (after refunds of ${rs(totals.refunded)})` : ""}`,
    `By method: ${methodLine(totals.byMethod)}`,
    `Vehicles in: ${totals.entries}    out: ${totals.exits}    inside now: ${totals.inside}${totals.capacity ? ` of ${totals.capacity}` : ""}`,
    ...(totals.passCount ? [`Passes sold or renewed: ${totals.passCount} (${rs(totals.passSales)})`] : []),
    ...(totals.failedOnline ? [`Failed online payments: ${totals.failedOnline}`] : []),
    "",
    ...rows.map((r) => `${r.name}: ${rs(r.collected)} collected, ${r.entries} in, ${r.exits} out, ${r.inside} inside now`),
    "",
    `Open the dashboard: ${url}`,
    "",
    "--",
    "You get this because the daily report is switched on for your company. A company admin can change it in Company > Daily report email.",
  ];

  const cell = (v, extra = "") => `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;${extra}">${escapeHtml(v)}</td>`;
  const head = (v, extra = "") => `<th style="padding:6px 10px;text-align:${extra || "left"};font-size:11px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #cbd5e1">${escapeHtml(v)}</th>`;
  const tile = (label, value) => `<td style="padding:10px 14px;background:#f1f5f9;border-radius:8px"><div style="font-size:11px;color:#64748b;text-transform:uppercase">${escapeHtml(label)}</div><div style="font-size:20px;font-weight:bold;color:#0f172a">${escapeHtml(value)}</div></td>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:640px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
<h1 style="font-size:18px;margin:0 0 4px">${escapeHtml(companyName)}</h1>
<p style="margin:0 0 16px;color:#64748b;font-size:14px">${partial ? "Report so far for" : "End-of-day report for"} ${escapeHtml(longDate(dateText))}</p>
<table role="presentation" cellspacing="6" style="margin:0 -6px 12px"><tr>${tile("Collected", rs(totals.collected))}${tile("In", String(totals.entries))}${tile("Out", String(totals.exits))}${tile("Inside now", String(totals.inside))}</tr></table>
<p style="font-size:13px;margin:0 0 16px;color:#334155">By method: ${escapeHtml(methodLine(totals.byMethod))}${totals.refunded ? `. Refunds: ${escapeHtml(rs(totals.refunded))}` : ""}${totals.passCount ? `. Passes: ${totals.passCount} (${escapeHtml(rs(totals.passSales))})` : ""}${totals.failedOnline ? `. Failed online payments: ${totals.failedOnline}` : ""}</p>
<table style="width:100%;border-collapse:collapse"><tr>${head("Location")}${head("Collected", "right")}${head("In", "right")}${head("Out", "right")}${head("Inside", "right")}</tr>
${rows.map((r) => `<tr>${cell(r.name)}${cell(rs(r.collected), "text-align:right")}${cell(String(r.entries), "text-align:right")}${cell(String(r.exits), "text-align:right")}${cell(String(r.inside), "text-align:right")}</tr>`).join("\n")}
</table>
<p style="margin:20px 0 4px"><a href="${escapeHtml(url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block">Open the dashboard</a></p>
</div><p style="font-size:12px;color:#64748b;margin:16px 4px 0">You get this because the daily report is switched on for your company. A company admin can change it in Company &gt; Daily report email.</p></div></body></html>`;
  return { subject, text: lines.join("\n"), html };
};

// ---- sending ----------------------------------------------------------------------------------

// The addresses chosen, or (when none) every active company admin.
const recipientsOf = async (company) => {
  const chosen = (company.reportEmail && company.reportEmail.recipients) || [];
  if (chosen.length) return chosen;
  const admins = await User.find({ companyId: company._id, role: "COMPANY_ADMIN", isActive: true }).select("email").lean();
  return admins.map((a) => a.email);
};

// Builds and sends the report for `dateText` (default: today). `to` overrides the recipients (the test button).
// Resolves to { sent, sentTo, reason }.
const sendReport = async ({ company, dateText = localDateText(), to, partial = false }) => {
  if (!email.isEnabled()) return { sent: false, reason: "Email is not switched on on the server" };
  const addresses = to || (await recipientsOf(company));
  if (!addresses.length) return { sent: false, reason: "There is nobody to send it to" };
  const summary = await buildSummary({ companyId: company._id, dateText });
  const message = renderReport({ companyName: company.name, summary, partial, url: `${env.clientUrl}/dashboard` });
  const result = await email.send({ to: addresses, ...message, key: partial ? undefined : `daily:${company._id}:${dateText}` });
  return result.sent ? { sent: true, sentTo: result.sentTo } : { sent: false, reason: result.reason || "The email service could not send it" };
};

// Locations can have their own list of addresses (Location.reportRecipients). Each gets the same
// report reduced to that one location. Returns how many location emails went out.
const sendLocationReports = async ({ company, dateText = localDateText(), partial = false, summary } = {}) => {
  if (!email.isEnabled()) return 0;
  const locations = await Location.find({ companyId: company._id, isActive: true, "reportRecipients.0": { $exists: true } })
    .select("name reportRecipients");
  if (!locations.length) return 0;
  const full = summary || (await buildSummary({ companyId: company._id, dateText }));
  let sent = 0;
  for (const location of locations) {
    try {
      const message = renderReport({
        companyName: `${company.name} - ${location.name}`, summary: summaryForLocation(full, location._id), partial, url: `${env.clientUrl}/dashboard`,
      });
      const result = await email.send({
        to: location.reportRecipients, ...message, key: partial ? undefined : `daily:${company._id}:${location._id}:${dateText}`,
      });
      if (result.sent) sent += 1;
    } catch (error) {
      console.error(`Daily report for ${location.name} failed:`, error.message);
    }
  }
  return sent;
};

// Run every few minutes. Sends each company's report once, at its chosen time, for the local day that is ending.
// Returns how many reports went out.
const runDue = async (now = new Date()) => {
  if (!email.isEnabled()) return 0;
  const today = localDateText(now);
  const minutesNow = Math.floor((now.getTime() - startOfLocalDay(now).getTime()) / 60000);
  const companies = await Company.find({
    isActive: true,
    "reportEmail.enabled": true,
    "reportEmail.lastSentFor": { $ne: today },
    subscriptionStatus: { $nin: ["SUSPENDED", "CANCELLED"] },
  }).select("name reportEmail");

  let sent = 0;
  for (const company of companies) {
    if (minutesNow < (company.reportEmail.sendAtMinutes ?? 1320)) continue;
    // Claim today's report first, so two servers (or two ticks) never both send it.
    const claim = await Company.updateOne({ _id: company._id, "reportEmail.lastSentFor": { $ne: today } }, { $set: { "reportEmail.lastSentFor": today } });
    if (!claim.modifiedCount) continue;
    try {
      const result = await sendReport({ company, dateText: today });
      // The location lists get theirs whether or not the company-wide list could be sent.
      await sendLocationReports({ company, dateText: today });
      if (result.sent) sent += 1;
      else {
        console.error(`Daily report for ${company.name} not sent: ${result.reason}`);
        // Try again at the next run (until the day ends).
        await Company.updateOne({ _id: company._id, "reportEmail.lastSentFor": today }, { $unset: { "reportEmail.lastSentFor": "" } });
      }
    } catch (error) {
      console.error(`Daily report for ${company.name} failed:`, error.message);
      await Company.updateOne({ _id: company._id, "reportEmail.lastSentFor": today }, { $unset: { "reportEmail.lastSentFor": "" } });
    }
  }
  return sent;
};

module.exports = { METHODS, minutesToText, textToMinutes, buildSummary, totalsOf, summaryForLocation, renderReport, recipientsOf, sendReport, sendLocationReports, runDue };
