// CSV export for reports.

// Cells that start with these characters would be run as formulas by Excel
// and Google Sheets. A leading apostrophe makes them plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

const cell = (value) => {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// columns: [{ key, label }]; rows: objects. Returns CSV text (CRLF line ends).
const toCsv = (columns, rows) =>
  [columns.map((c) => cell(c.label)), ...rows.map((row) => columns.map((c) => cell(row[c.key])))]
    .map((line) => line.join(","))
    .join("\r\n");

const sendCsv = (res, filename, columns, rows) => {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeName}"`,
    "Cache-Control": "no-store",
  });
  // The BOM makes Excel read the file as UTF-8.
  res.send(`﻿${toCsv(columns, rows)}`);
};

module.exports = { toCsv, sendCsv };
