// Unit tests for the Excel and PDF writers and the report export helpers. No database.
process.env.APP_UTC_OFFSET_MINUTES = "330";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { zip, crc32 } = require("../utils/zip");
const { buildXlsx, columnName } = require("../utils/xlsx");
const { buildPdf, textWidth, clean } = require("../utils/pdf");
const exporter = require("../services/reportExport");

// Reads a ZIP back (only what our writer produces) and checks every CRC.
const unzip = (buffer) => {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50, "end of central directory");
  const count = buffer.readUInt16LE(end + 10);
  let p = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(p), 0x02014b50);
    const crc = buffer.readUInt32LE(p + 16);
    const packed = buffer.readUInt32LE(p + 20);
    const size = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString("utf8", p + 46, p + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buffer.subarray(start, start + packed));
    assert.equal(data.length, size, `${name} size`);
    assert.equal(crc32(data), crc, `${name} crc`);
    files[name] = data.toString("utf8");
    p += 46 + nameLength;
  }
  return files;
};

test("crc32 matches the known check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("zip files can be read back, with names and content intact", () => {
  const files = unzip(zip([{ name: "a.txt", data: "hello" }, { name: "dir/ü.txt", data: "x".repeat(5000) }]));
  assert.equal(files["a.txt"], "hello");
  assert.equal(files["dir/ü.txt"].length, 5000);
});

test("spreadsheet columns are named A, B, ... Z, AA", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName), ["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
});

test("an xlsx holds the title, header and rows; text never becomes a formula", () => {
  const file = buildXlsx({
    title: "Revenue & tax",
    subtitle: "Acme · 1 to 3 Oct",
    columns: [{ key: "a", label: "Name" }, { key: "b", label: "Amount" }, { key: "c", label: "Note" }],
    rows: [
      { a: "=HYPERLINK(\"x\")", b: 12.5, c: "a < b & \"c\"" },
      { a: "Plain", b: 0, c: "" },
      { a: "Control\u0001chars", b: null, c: undefined },
    ],
  });
  const parts = unzip(file);
  assert.deepEqual(Object.keys(parts).sort(), [
    "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml",
  ]);
  const sheet = parts["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /Revenue &amp; tax/);
  assert.match(sheet, /<c r="A4"[^>]*t="inlineStr"[^>]*><is><t[^>]*>Name<\/t>/);
  assert.match(sheet, /<c r="B5"><v>12.5<\/v><\/c>/, "numbers stay numbers");
  assert.match(sheet, /<c r="B6"><v>0<\/v><\/c>/, "zero is kept");
  assert.match(sheet, /=HYPERLINK\(&quot;x&quot;\)<\/t>/, "formula text is stored as text");
  assert.doesNotMatch(sheet, /<f>/, "no formulas at all");
  assert.match(sheet, /a &lt; b &amp; &quot;c&quot;/);
  assert.doesNotMatch(sheet, /\u0001/, "control characters are removed");
  assert.match(sheet, /<autoFilter ref="A4:C7"\/>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(parts["xl/workbook.xml"], /<sheet name="Report"/);
});

test("an xlsx with no rows is still a valid sheet, and sheet names are made safe", () => {
  const parts = unzip(buildXlsx({ title: "Empty", columns: [{ key: "a", label: "A" }], rows: [], sheetName: "A/B:C?*[x]" + "y".repeat(40) }));
  assert.doesNotMatch(parts["xl/worksheets/sheet1.xml"], /autoFilter/);
  const name = /<sheet name="([^"]+)"/.exec(parts["xl/workbook.xml"])[1];
  assert.ok(name.length <= 31);
  assert.doesNotMatch(name, /[\\/?*[\]:]/);
});

// Checks that the cross reference table points at the objects.
const checkPdf = (buffer) => {
  const text = buffer.toString("latin1");
  assert.ok(text.startsWith("%PDF-1."));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(start, start + 4), "xref");
  const size = Number(/xref\n0 (\d+)\n/.exec(text.slice(start))[1]);
  const entries = text.slice(start).split("\n").slice(2, 2 + size);
  for (let n = 1; n < size; n += 1) {
    const offset = Number(entries[n].slice(0, 10));
    assert.equal(text.slice(offset, offset + `${n} 0 obj`.length), `${n} 0 obj`, `object ${n} is where the table says`);
  }
  return { text, objects: size - 1 };
};

test("a pdf is well formed, with one page for a short report", () => {
  const { text } = checkPdf(buildPdf({
    title: "Revenue report", subtitle: "Acme", generated: "Generated now",
    columns: [{ key: "a", label: "Name" }, { key: "b", label: "Amount" }],
    rows: [{ a: "x", b: 1 }, { a: "y", b: 2 }],
  }));
  assert.match(text, /\/Count 1 /);
  assert.match(text, /\/Title \(Revenue report\)/);
});

test("a long report is split over pages, and each page has its own stream", () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({ a: `Row ${i}`, b: i }));
  const { text } = checkPdf(buildPdf({ title: "Long", columns: [{ key: "a", label: "A" }, { key: "b", label: "B" }], rows }));
  const pages = Number(/\/Count (\d+) /.exec(text)[1]);
  assert.ok(pages >= 8 && pages <= 12, `pages: ${pages}`);
  assert.equal((text.match(/\/Type \/Page /g) || []).length, pages);
});

test("wide reports turn the page sideways", () => {
  const columns = Array.from({ length: 8 }, (_, i) => ({ key: `c${i}`, label: `Column ${i}` }));
  const { text } = checkPdf(buildPdf({ title: "Wide", columns, rows: [] }));
  assert.match(text, /\/MediaBox \[0 0 842 595\]/);
  const narrow = checkPdf(buildPdf({ title: "Narrow", columns: columns.slice(0, 3), rows: [] }));
  assert.match(narrow.text, /\/MediaBox \[0 0 595 842\]/);
});

test("pdf text is made safe for the fonts and for the file syntax", () => {
  assert.equal(clean("Rs ₹100 – ok…"), "Rs Rs 100 - ok...");
  assert.equal(clean("日本"), "??");
  assert.equal(clean("a\u0000b"), "a b");
  assert.ok(textWidth("WWWW", 10) > textWidth("iiii", 10));
  // Brackets and backslashes in the data cannot break out of the text string.
  const { text } = checkPdf(buildPdf({ title: "T (x) \\", columns: [{ key: "a", label: "A" }], rows: [{ a: ") Tj (evil" }] }));
  assert.match(text, /\/Title \(T \\\(x\\\) \\\\\)/);
});

const columns = [
  { key: "paidAt", label: "Paid at" }, { key: "method", label: "Method" }, { key: "status", label: "Status" },
  { key: "type", label: "Type" }, { key: "amount", label: "Amount" },
];

test("readable rows show local dates and plain words, and leave other values alone", () => {
  const rows = exporter.readableRows(columns, [
    { paidAt: new Date("2026-03-01T20:00:00Z"), method: "GATEWAY", status: "REFUNDED", type: "BIKE", amount: 10.5 },
    { paidAt: "", method: "OTHER", status: "?", type: "", amount: 0 },
  ]);
  assert.equal(rows[0].paidAt, "2026-03-02 01:30", "local time, not UTC");
  assert.equal(rows[0].method, "Online");
  assert.equal(rows[0].status, "Refunded");
  assert.equal(rows[0].type, "Bike");
  assert.equal(rows[0].amount, 10.5);
  assert.equal(rows[1].method, "OTHER");
  assert.equal(rows[1].amount, 0);
});

test("formats: only csv, xlsx and pdf are accepted", () => {
  assert.equal(exporter.formatOf({ query: {} }), null);
  assert.equal(exporter.formatOf({ query: { format: "" } }), null);
  for (const f of ["csv", "xlsx", "pdf"]) assert.equal(exporter.formatOf({ query: { format: f } }), f);
  assert.throws(() => exporter.formatOf({ query: { format: "docx" } }), /Unknown format/);
  assert.throws(() => exporter.formatOf({ query: { format: ["csv", "pdf"] } }), /Unknown format/);
});

test("each format gets the right file name and type, and the codes stay in the CSV", () => {
  const rows = [{ paidAt: new Date("2026-03-01T20:00:00Z"), method: "GATEWAY", status: "SUCCESS", type: "CAR", amount: 5 }];
  const common = { name: "revenue-2026-03-01-to-2026-03-02", report: "revenue", columns, rows, company: "Acme", scope: "All locations", extra: { from: "2026-03-01", to: "2026-03-02" } };
  const csv = exporter.buildReportFile({ ...common, format: "csv" });
  assert.equal(csv.filename, "revenue-2026-03-01-to-2026-03-02.csv");
  assert.match(csv.buffer.toString("utf8"), /GATEWAY/);
  assert.equal(csv.buffer.toString("utf8").charCodeAt(0), 0xfeff, "BOM for Excel");

  const xlsx = exporter.buildReportFile({ ...common, format: "xlsx" });
  assert.match(xlsx.contentType, /spreadsheetml/);
  const sheet = unzip(xlsx.buffer)["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /Revenue report/);
  assert.match(sheet, /Acme · 2026-03-01 to 2026-03-02 · All locations · Generated /);
  assert.match(sheet, />Online</);
  assert.match(sheet, /2026-03-02 01:30/);

  const pdf = exporter.buildReportFile({ ...common, format: "pdf", name: "../../evil name" });
  assert.equal(pdf.contentType, "application/pdf");
  assert.equal(pdf.filename, ".._.._evil_name.pdf", "file names are made safe");
  checkPdf(pdf.buffer);
});

test("a pdf stops at its row limit and says so", () => {
  const many = Array.from({ length: exporter.PDF_ROW_LIMIT + 5 }, (_, i) => ({ a: i }));
  const pdf = exporter.buildReportFile({
    format: "pdf", name: "x", report: "revenue", columns: [{ key: "a", label: "A" }], rows: many, extra: {},
  });
  const inflated = [...pdf.buffer.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map((m) => zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"))
    .join("\n");
  assert.match(inflated, new RegExp(`first ${exporter.PDF_ROW_LIMIT} of ${exporter.PDF_ROW_LIMIT + 5} rows`));
  // The CSV and Excel files are not cut.
  const csv = exporter.buildReportFile({ format: "csv", name: "x", report: "revenue", columns: [{ key: "a", label: "A" }], rows: many, extra: {} });
  assert.equal(csv.buffer.toString("utf8").split("\r\n").length, many.length + 1);
});
