// Draws a one-page GST tax invoice as a PDF, without any library (built-in Helvetica, Latin-1 text only).
// `invoice` is an Invoice document (or plain object). Returns a Buffer.
const zlib = require("zlib");
const { textWidth, clean } = require("./pdf");
const { rupeesInWords } = require("./numberWords");

const W = 595;
const H = 842;
const M = 40;
const num = (n) => (Math.round(n * 100) / 100).toString();
const literal = (text) => `(${text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
const money = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (d, offsetMinutes) => {
  if (!d) return "-";
  const local = new Date(new Date(d).getTime() + offsetMinutes * 60000);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
};

// Breaks text into lines no wider than `width`.
const wrap = (text, width, size, bold = false) => {
  const words = clean(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) <= width || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
};

const buildInvoicePdf = (invoice, { offsetMinutes = 330 } = {}) => {
  const out = [];
  const text = (x, y, value, { size = 9, bold = false, right = false, gray = 0 } = {}) => {
    const shown = clean(value);
    const dx = right ? -textWidth(shown, size, bold) : 0;
    out.push(`${gray} g BT /${bold ? "F2" : "F1"} ${size} Tf ${num(x + dx)} ${num(y)} Td ${literal(shown)} Tj ET`);
  };
  const rect = (x, y, w, h, color) => out.push(`${color} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  const rule = (y, x1 = M, x2 = W - M) => out.push(`0.8 G 0.5 w ${num(x1)} ${num(y)} m ${num(x2)} ${num(y)} l S`);
  const block = (x, y, lines, opts = {}) => {
    let at = y;
    for (const line of lines) { text(x, at, line, opts); at -= (opts.size || 9) + 3; }
    return at;
  };

  const seller = invoice.seller || {};
  const buyer = invoice.buyer || {};

  text(M, H - 52, "TAX INVOICE", { size: 20, bold: true });
  text(W - M, H - 50, `Invoice no. ${invoice.number}`, { size: 10, bold: true, right: true });
  text(W - M, H - 64, `Date: ${dateText(invoice.issuedAt, offsetMinutes)}`, { size: 9, right: true });
  rule(H - 76);

  // Seller (left) and buyer (right).
  const colW = (W - M * 2) / 2 - 10;
  const top = H - 94;
  text(M, top, "Sold by", { size: 8, gray: 0.45 });
  let y = block(M, top - 13, [
    ...wrap(seller.name || "", colW, 11, true).map((l) => l),
  ], { size: 11, bold: true });
  y = block(M, y, [
    ...wrap(seller.address || "", colW, 9),
    seller.gstin ? `GSTIN: ${seller.gstin}` : "",
    seller.state ? `State: ${seller.state}${seller.stateCode ? ` (${seller.stateCode})` : ""}` : "",
    seller.email ? seller.email : "",
  ].filter(Boolean));

  const rx = M + colW + 20;
  text(rx, top, "Billed to", { size: 8, gray: 0.45 });
  let y2 = block(rx, top - 13, wrap(buyer.name || "", colW, 11, true), { size: 11, bold: true });
  y2 = block(rx, y2, [
    ...wrap(buyer.address || "", colW, 9),
    buyer.gstin ? `GSTIN: ${buyer.gstin}` : "GSTIN: not given",
    `Place of supply: ${buyer.state || "-"}${buyer.stateCode ? ` (${buyer.stateCode})` : ""}`,
    buyer.email || "",
  ].filter(Boolean));
  if (invoice.shipTo) {
    text(rx, y2 - 2, "Ship to", { size: 8, gray: 0.45 });
    y2 = block(rx, y2 - 14, wrap(invoice.shipTo, colW, 9), { size: 9 });
  }

  y = Math.min(y, y2) - 12;
  rule(y);

  const shop = invoice.kind === "SHOP" && Array.isArray(invoice.lines) && invoice.lines.length > 0;
  y -= 22;
  rect(M, y - 5, W - M * 2, 18, "0.886 0.91 0.941");
  if (shop) {
    // Goods: one row per item, with its HSN code and GST rate.
    const c = { desc: M + 6, hsn: 232, qty: 305, rate: 365, taxable: 430, pct: 468, amount: W - M - 6 };
    text(c.desc, y, "Item", { bold: true, size: 8 });
    text(c.hsn, y, "HSN/SAC", { bold: true, size: 8 });
    text(c.qty, y, "Qty", { bold: true, size: 8, right: true });
    text(c.rate, y, "Rate", { bold: true, size: 8, right: true });
    text(c.taxable, y, "Taxable", { bold: true, size: 8, right: true });
    text(c.pct, y, "GST", { bold: true, size: 8, right: true });
    text(c.amount, y, "Amount", { bold: true, size: 8, right: true });
    y -= 18;
    for (const line of invoice.lines) {
      let rows = wrap(line.description || "", 172, 8);
      // Long names stop after two rows so that a full order still fits the page.
      if (rows.length > 2) rows = [rows[0], `${rows[1].slice(0, Math.max(0, rows[1].length - 3))}...`];
      rows.forEach((r, i) => text(c.desc, y - i * 11, r, { size: 8 }));
      text(c.hsn, y, line.hsn || "-", { size: 8 });
      text(c.qty, y, String(line.qty ?? ""), { size: 8, right: true });
      text(c.rate, y, money(line.rate).replace("Rs ", ""), { size: 8, right: true });
      text(c.taxable, y, money(line.taxable).replace("Rs ", ""), { size: 8, right: true });
      text(c.pct, y, `${line.gstPercent}%`, { size: 8, right: true });
      text(c.amount, y, money(line.amount).replace("Rs ", ""), { size: 8, right: true });
      y -= Math.max(1, rows.length) * 11 + 3;
    }
    text(M + 6, y, "Amounts in rupees. Rate and Taxable are before GST; Amount includes GST.", { size: 7, gray: 0.4 });
    y -= 14;
    rule(y + 8);
  } else {
    const cols = { desc: M + 6, sac: 330, qty: 395, rate: 470, amount: W - M - 6 };
    text(cols.desc, y, "Description", { bold: true, size: 9 });
    text(cols.sac, y, "SAC", { bold: true, size: 9 });
    text(cols.qty, y, "Users x months", { bold: true, size: 9 });
    text(cols.amount, y, "Amount", { bold: true, size: 9, right: true });

    y -= 20;
    const descLines = wrap(invoice.description || "", 270, 9);
    descLines.forEach((line, i) => text(cols.desc, y - i * 12, line, { size: 9 }));
    text(cols.sac, y, seller.sac || "-", { size: 9 });
    text(cols.qty, y, `${invoice.users || "-"} x ${invoice.months || "-"}`, { size: 9 });
    text(cols.amount, y, money(invoice.subtotal), { size: 9, right: true });
    y -= Math.max(1, descLines.length) * 12;
    text(cols.desc, y, `Service period: ${dateText(invoice.periodStart, offsetMinutes)} to ${dateText(invoice.periodEnd, offsetMinutes)}`, { size: 8, gray: 0.4 });
    y -= 18;
    rule(y + 8);
  }

  // Totals, right aligned.
  const label = W - M - 130;
  const row = (name, value, { bold = false, size = 9 } = {}) => {
    text(label, y, name, { size, bold, right: true });
    text(W - M - 6, y, value, { size, bold, right: true });
    y -= size + 6;
  };
  y -= 4;
  if (!shop) row("Value of service", money(invoice.subtotal));
  if (invoice.discount) row("Discount", `- ${money(invoice.discount)}`);
  row("Taxable value", money(invoice.taxable));
  // Goods can carry several rates: then the tax is shown without one.
  const rates = shop ? [...new Set(invoice.lines.map((l) => l.gstPercent))] : [invoice.gstPercent];
  const rateText = (divisor) => (rates.length === 1 ? ` @ ${rates[0] / divisor}%` : "");
  if (invoice.taxType === "INTER") {
    row(`IGST${rateText(1)}`, money(invoice.igst));
  } else {
    row(`CGST${rateText(2)}`, money(invoice.cgst));
    row(`SGST${rateText(2)}`, money(invoice.sgst));
  }
  rule(y + 10, label - 60, W - M);
  y -= 2;
  row("Total", money(invoice.total), { bold: true, size: 12 });

  y -= 8;
  text(M, y, "Amount in words", { size: 8, gray: 0.45 });
  block(M, y - 12, wrap(rupeesInWords(invoice.total), W - M * 2, 10, true), { size: 10, bold: true });
  y -= 44;
  if (invoice.paymentRef) text(M, y, `Paid online. Payment reference: ${invoice.paymentRef}`, { size: 9 });
  y -= 24;
  block(M, y, [
    "This is a computer generated invoice and needs no signature.",
    "Subject to the terms and conditions of the Smart Parking service.",
  ], { size: 8, gray: 0.45 });

  const stream = zlib.deflateSync(Buffer.from(out.join("\n"), "latin1"));
  const objects = [];
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = Buffer.from("<< /Type /Pages /Count 1 /Kids [6 0 R] >>");
  objects[3] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects[4] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects[5] = Buffer.from(`<< /Title ${literal(clean(`Invoice ${invoice.number}`))} /Producer (Smart Parking) >>`);
  objects[6] = Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 7 0 R >>`);
  objects[7] = Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from("\nendstream")]);

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
  chunks.push(Buffer.from(`${xref.join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${position}\n%%EOF\n`));
  return Buffer.concat(chunks);
};

module.exports = { buildInvoicePdf };
