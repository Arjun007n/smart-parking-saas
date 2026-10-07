// Turns a report (columns and rows) into a CSV, Excel or PDF file.
const AppError = require("../utils/AppError");
const { buildXlsx } = require("../utils/xlsx");
const { buildPdf } = require("../utils/pdf");
const { toCsv } = require("../utils/csv");
const { utcOffsetMinutes, MINUTE } = require("../utils/time");

const FORMATS = ["csv", "xlsx", "pdf"];
// A PDF is for reading, not for data: it stops after this many rows (Excel and CSV go further).
const PDF_ROW_LIMIT = 2000;

const FILES = {
  csv: { extension: "csv", contentType: "text/csv; charset=utf-8" },
  xlsx: { extension: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pdf: { extension: "pdf", contentType: "application/pdf" },
};

const TITLES = {
  revenue: "Revenue report",
  collection: "Collection report",
  vehicles: "Vehicle history",
  occupancy: "Occupancy by hour",
  operators: "Operator report",
  "operator-collection": "Collection by operator",
  "day-summary": "Day summary by vehicle type",
  transactions: "FASTag and online transactions",
  "pass-vehicles": "Pass vehicles",
  "pass-receipts": "Pass receipts",
  "peak-hours": "Peak hours",
  "occupancy-trend": "Occupancy trend",
  durations: "Length of stay",
  payments: "Payment methods",
  exceptions: "Exceptions",
  passes: "Passes",
  "entry-list": "Vehicle entry list",
  "exit-list": "Vehicle exit list",
  "collection-by-type": "Collection by vehicle type",
  hardware: "Gate hardware",
  "frequent-vehicles": "Repeat vehicles",
  locations: "Location comparison",
  "location-list": "Parking locations",
  "user-list": "Users",
  "government-movements": "Vehicle entries and exits",
};

// Words people read instead of the codes in the data (CSV keeps the codes).
const LABELS = {
  method: { CASH: "Cash", UPI: "UPI", CARD: "Card", GATEWAY: "Online", FASTAG: "FASTag", WALLET: "Wallet", COMPLIMENTARY: "Free" },
  type: {
    CAR: "Car", BIKE: "Bike", HEAVY: "Coach / Bus / Truck", TAXI: "Taxi", TEMPO: "Tempo / SUV / Mini bus", ANPR_CAMERA: "ANPR camera", BARRIER: "Barrier", PRINTER: "Printer",
  },
  status: {
    ACTIVE: "Inside", PAYMENT_PENDING: "Payment pending", COMPLETED: "Exited", CANCELLED: "Cancelled",
    LOST_TICKET: "Exited (lost ticket)", PASS_EXIT: "Exited (pass)", MANUAL_OVERRIDE: "Exited (override)",
    SUCCESS: "Paid", REFUNDED: "Refunded", PENDING: "Pending", FAILED: "Declined or failed", UNKNOWN: "Being checked",
  },
};

const formatOf = (req) => {
  const format = req.query.format;
  if (format === undefined || format === "") return null;
  if (!FORMATS.includes(format)) throw new AppError(`Unknown format. Use ${FORMATS.join(", ")}.`, 400);
  return format;
};

// "2026-10-03 21:05" in local time.
const localDateTimeText = (date) => {
  const local = new Date(date.getTime() + utcOffsetMinutes() * MINUTE);
  return `${local.toISOString().slice(0, 10)} ${local.toISOString().slice(11, 16)}`;
};

// Rows for Excel and PDF: dates as local text, codes as words.
const readableRows = (columns, rows) =>
  rows.map((row) => {
    const out = {};
    for (const { key } of columns) {
      const value = row[key];
      if (value instanceof Date) out[key] = localDateTimeText(value);
      else if (typeof value === "string" && LABELS[key] && LABELS[key][value]) out[key] = LABELS[key][value];
      else out[key] = value;
    }
    return out;
  });

// A one-line description of what the report covers.
const subtitleOf = ({ company, scope, extra }, generated) => {
  const period = extra.date ? extra.date : extra.from ? (extra.from === extra.to ? extra.from : `${extra.from} to ${extra.to}`) : "";
  return [company, period, scope, generated].filter(Boolean).join(" · ");
};

// { buffer, filename, contentType } for one report in the chosen format.
const buildReportFile = ({ format, name, report, columns, rows, company, scope, extra = {}, now = new Date() }) => {
  const title = TITLES[report] || "Report";
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, "_");
  const { extension, contentType } = FILES[format];
  const filename = `${safeName}.${extension}`;

  if (format === "csv") {
    // The BOM makes Excel read the file as UTF-8.
    return { buffer: Buffer.from(`﻿${toCsv(columns, rows)}`, "utf8"), filename, contentType };
  }
  const generated = `Generated ${localDateTimeText(now)}`;
  if (format === "xlsx") {
    const subtitle = subtitleOf({ company, scope, extra }, generated);
    return { buffer: buildXlsx({ title, subtitle, columns, rows: readableRows(columns, rows), sheetName: title }), filename, contentType };
  }
  const shown = rows.slice(0, PDF_ROW_LIMIT);
  const note = rows.length > shown.length ? ` · first ${shown.length} of ${rows.length} rows` : "";
  return {
    buffer: buildPdf({
      title, subtitle: `${subtitleOf({ company, scope, extra })}${note}`,
      columns, rows: readableRows(columns, shown), generated,
    }),
    filename, contentType,
  };
};

module.exports = { FORMATS, TITLES, PDF_ROW_LIMIT, formatOf, readableRows, buildReportFile };
