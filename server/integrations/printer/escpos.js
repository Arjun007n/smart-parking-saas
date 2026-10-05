// Builds ESC/POS bytes, the language almost every thermal receipt printer
// understands (Epson, TVS, Posiflex, Xprinter, generic 58/80 mm printers).
//
// The server builds the bytes and the gate agent only forwards them to the
// printer (USB, network port 9100 or a Windows shared printer), so printer
// layout lives in one tested place.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Characters printers cannot show are replaced; the rupee sign is spelled out.
const toAscii = (text) =>
  String(text ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");

class EscPos {
  constructor({ columns = 48 } = {}) {
    this.columns = columns;
    this.bytes = [ESC, 0x40]; // initialise
    this.lines = []; // plain-text copy, for previews and logs
    this.pending = "";
  }

  raw(...values) {
    this.bytes.push(...values);
    return this;
  }

  align(where) {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[where] ?? 0);
  }

  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  // size 1 = normal, 2 = double width and height
  size(size) {
    return this.raw(GS, 0x21, size >= 2 ? 0x11 : 0x00);
  }

  text(value) {
    const ascii = toAscii(value);
    for (const ch of ascii) this.bytes.push(ch.charCodeAt(0));
    this.pending += ascii;
    return this;
  }

  line(value = "") {
    this.text(value);
    this.bytes.push(LF);
    this.lines.push(this.pending);
    this.pending = "";
    return this;
  }

  // Splits long text over several lines at word boundaries.
  wrap(value, width = this.columns) {
    const words = toAscii(value).split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      if (current && current.length + 1 + word.length > width) {
        this.line(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) this.line(current);
    return this;
  }

  // "Label ............ value" across the full width.
  pair(label, value, width = this.columns) {
    const left = toAscii(label);
    const right = toAscii(value);
    const gap = Math.max(1, width - left.length - right.length);
    return this.line(`${left}${" ".repeat(gap)}${right}`.slice(0, width));
  }

  rule(char = "-") {
    return this.line(char.repeat(this.columns));
  }

  feed(count = 1) {
    for (let i = 0; i < count; i += 1) this.line("");
    return this;
  }

  // QR code (works on most 80 mm printers; switch off for printers that print garbage).
  qr(data, moduleSize = 6) {
    const bytes = Buffer.from(toAscii(data), "ascii");
    const length = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0); // model 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 67, moduleSize); // size
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 69, 48); // error correction L
    this.raw(GS, 0x28, 0x6b, length & 0xff, length >> 8, 49, 80, 48, ...bytes); // store
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 81, 48); // print
    this.lines.push(`[QR: ${toAscii(data)}]`);
    return this;
  }

  cut() {
    return this.raw(GS, 0x56, 0x42, 0x00); // feed a little, then partial cut
  }

  toBuffer() {
    return Buffer.from(this.bytes);
  }

  toText() {
    return this.lines.join("\n");
  }
}

const columnsFor = (paperWidthMm) => (Number(paperWidthMm) === 58 ? 32 : 48);

module.exports = { EscPos, toAscii, columnsFor };
