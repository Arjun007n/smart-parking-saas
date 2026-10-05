// Writes a one-sheet Excel workbook (.xlsx) without any library: a title, a
// line of details, a header row and the data. Text is stored as plain text,
// so a cell that starts with "=" is never run as a formula.
const { zip } = require("./zip");

// Characters XML 1.0 cannot hold.
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const escapeXml = (text) =>
  String(text)
    .replace(ILLEGAL_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 0 -> A, 25 -> Z, 26 -> AA
const columnName = (index) => {
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
};

const STYLE = { normal: 0, title: 1, header: 2, note: 3 };

const textCell = (ref, text, style = STYLE.normal) =>
  `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
const numberCell = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// columns: [{ key, label }]; rows: objects. Cell values: number, boolean, text.
// Anything else must already be text (the caller formats dates).
const buildXlsx = ({ title, subtitle, columns, rows, sheetName = "Report" }) => {
  const HEADER_ROW = 4; // 1 title, 2 details, 3 blank, 4 header
  const lines = [];
  lines.push(`<row r="1">${textCell("A1", title, STYLE.title)}</row>`);
  if (subtitle) lines.push(`<row r="2">${textCell("A2", subtitle, STYLE.note)}</row>`);
  lines.push(
    `<row r="${HEADER_ROW}">${columns.map((c, i) => textCell(`${columnName(i)}${HEADER_ROW}`, c.label, STYLE.header)).join("")}</row>`
  );

  const widths = columns.map((c) => String(c.label).length);
  rows.forEach((row, r) => {
    const rowNumber = HEADER_ROW + 1 + r;
    const cells = [];
    columns.forEach((c, i) => {
      const value = row[c.key];
      const ref = `${columnName(i)}${rowNumber}`;
      if (value === null || value === undefined || value === "") return;
      if (typeof value === "number" && Number.isFinite(value)) {
        cells.push(numberCell(ref, value));
        widths[i] = Math.max(widths[i], String(value).length);
      } else if (typeof value === "boolean") {
        cells.push(`<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`);
      } else {
        const text = String(value);
        cells.push(textCell(ref, text));
        widths[i] = Math.max(widths[i], Math.min(text.length, 60));
      }
    });
    lines.push(`<row r="${rowNumber}">${cells.join("")}</row>`);
  });

  const lastColumn = columnName(Math.max(columns.length - 1, 0));
  const lastRow = HEADER_ROW + rows.length;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastColumn}${Math.max(lastRow, HEADER_ROW)}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${HEADER_ROW}" topLeftCell="A${HEADER_ROW + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(w + 2, 8), 62)}" customWidth="1"/>`).join("")}</cols>
<sheetData>${lines.join("")}</sheetData>
${rows.length ? `<autoFilter ref="A${HEADER_ROW}:${lastColumn}${lastRow}"/>` : ""}
</worksheet>`;

  const safeSheetName = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report");
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
};

module.exports = { buildXlsx, columnName };
