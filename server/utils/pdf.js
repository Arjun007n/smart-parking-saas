// Writes a simple table PDF without any library: a title, a line of details,
// a header row repeated on every page, and the data. It uses the built-in
// Helvetica fonts, so only Latin-1 characters can be shown (other characters
// become "?"; the Excel and CSV exports keep every character).
const zlib = require("zlib");

// Helvetica character widths (1/1000 em) for the characters 32 to 126.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

const REPLACEMENTS = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "₹": "Rs ", "•": "-" };

// Text the PDF fonts can show: Latin-1 only.
const clean = (value) =>
  Array.from(String(value))
    .map((ch) => {
      if (REPLACEMENTS[ch]) return REPLACEMENTS[ch];
      const code = ch.codePointAt(0);
      if (code < 32 || code === 127) return " ";
      return code <= 255 ? ch : "?";
    })
    .join("");

const charWidth = (ch) => {
  const code = ch.charCodeAt(0);
  return code >= 32 && code <= 126 ? WIDTHS[code - 32] : 556;
};
// Bold letters are a little wider; 8 percent more is a safe estimate.
const textWidth = (text, size, bold = false) =>
  (Array.from(text).reduce((w, ch) => w + charWidth(ch), 0) / 1000) * size * (bold ? 1.08 : 1);

const fit = (text, width, size, bold = false) => {
  if (textWidth(text, size, bold) <= width) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}...`, size, bold) > width) out = out.slice(0, -1);
  return `${out.trimEnd()}...`;
};

const literal = (text) => `(${text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
const num = (n) => (Math.round(n * 100) / 100).toString();

const MARGIN = 36;
const PAD = 3;
const FONT = 8;
const ROW_HEIGHT = 14;

// columns: [{ key, label }]; rows: objects with number or text values.
const buildPdf = ({ title, subtitle, columns, rows, generated = "" }) => {
  const landscape = columns.length > 5;
  const pageW = landscape ? 842 : 595;
  const pageH = landscape ? 595 : 842;
  const usable = pageW - MARGIN * 2;

  const cellText = (v) => (v === null || v === undefined ? "" : clean(v));
  // Column widths: as wide as the content (looking at the first 300 rows), shrunk to fit the page.
  const wanted = columns.map((c) => {
    let w = textWidth(clean(c.label), FONT, true);
    for (const row of rows.slice(0, 300)) w = Math.max(w, textWidth(cellText(row[c.key]), FONT));
    return Math.min(Math.max(w + PAD * 2, 34), 230);
  });
  const sum = wanted.reduce((t, w) => t + w, 0);
  const widths = sum > usable ? wanted.map((w) => (w * usable) / sum) : wanted;
  const starts = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((t, w) => t + w, 0));
  const tableW = widths.reduce((t, w) => t + w, 0);

  const headTop = pageH - MARGIN;
  const titleBlock = subtitle ? 44 : 30;
  const perPage = Math.max(1, Math.floor((pageH - MARGIN * 2 - titleBlock - ROW_HEIGHT - 16) / ROW_HEIGHT));
  const pages = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += perPage) pages.push(rows.slice(i, i + perPage));

  const streams = pages.map((slice, pageIndex) => {
    const out = [];
    const text = (x, y, value, { bold = false, size = FONT, right = false, width = 0, gray = 0 } = {}) => {
      const shown = fit(value, width || usable, size, bold);
      const dx = right ? Math.max(0, width - textWidth(shown, size, bold)) : 0;
      out.push(`${gray} g BT /${bold ? "F2" : "F1"} ${size} Tf ${num(x + dx)} ${num(y)} Td ${literal(shown)} Tj ET`);
    };

    text(MARGIN, headTop - 14, clean(title), { bold: true, size: 14 });
    if (subtitle) text(MARGIN, headTop - 30, clean(subtitle), { size: 8, gray: 0.35 });

    let y = headTop - titleBlock - ROW_HEIGHT;
    out.push(`0.886 0.91 0.941 rg ${num(MARGIN)} ${num(y)} ${num(tableW)} ${ROW_HEIGHT} re f`);
    columns.forEach((c, i) => {
      const numeric = rows.length > 0 && typeof rows[0][c.key] === "number";
      text(starts[i] + PAD, y + 4, clean(c.label), { bold: true, right: numeric, width: widths[i] - PAD * 2 });
    });

    slice.forEach((row, r) => {
      y -= ROW_HEIGHT;
      if (r % 2 === 1) out.push(`0.965 0.973 0.98 rg ${num(MARGIN)} ${num(y)} ${num(tableW)} ${ROW_HEIGHT} re f`);
      columns.forEach((c, i) => {
        const v = row[c.key];
        text(starts[i] + PAD, y + 4, cellText(v), { right: typeof v === "number", width: widths[i] - PAD * 2 });
      });
    });
    if (rows.length === 0) text(MARGIN, y - 18, "Nothing found for these filters.", { gray: 0.35 });

    text(MARGIN, MARGIN - 14, `${clean(generated)}`, { size: 7, gray: 0.45, width: usable - 80 });
    text(pageW - MARGIN - 80, MARGIN - 14, `Page ${pageIndex + 1} of ${pages.length}`, { size: 7, gray: 0.45, right: true, width: 80 });
    return zlib.deflateSync(Buffer.from(out.join("\n"), "latin1"));
  });

  // Objects: 1 catalog, 2 page list, 3 and 4 fonts, 5 info, then a page and a content stream per page.
  const objects = [];
  const pageObj = (i) => 6 + i * 2;
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = Buffer.from(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`
  );
  objects[3] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects[4] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects[5] = Buffer.from(`<< /Title ${literal(clean(title))} /Producer (Smart Parking) >>`);
  streams.forEach((stream, i) => {
    objects[pageObj(i)] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`
    );
    objects[pageObj(i) + 1] = Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]);
  });

  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [];
  let position = chunks[0].length;
  for (let n = 1; n < objects.length; n += 1) {
    offsets[n] = position;
    const piece = Buffer.concat([Buffer.from(`${n} 0 obj\n`), objects[n], Buffer.from("\nendobj\n")]);
    chunks.push(piece);
    position += piece.length;
  }
  const xref = [`xref\n0 ${objects.length}\n0000000000 65535 f \n`];
  for (let n = 1; n < objects.length; n += 1) xref.push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  chunks.push(
    Buffer.from(
      `${xref.join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${position}\n%%EOF\n`
    )
  );
  return Buffer.concat(chunks);
};

module.exports = { buildPdf, textWidth, clean };
