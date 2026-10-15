// Builds the bytes a Bluetooth thermal printer understands (ESC/POS, the language of almost every 58 mm and 80 mm
// receipt printer). Nothing here touches the phone, so it can be tested on its own (mobile/tests/escpos.test.mjs).
//
// Thermal printers have a tiny character set, so every text is first reduced to plain ASCII ("₹" becomes "Rs.").

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

// Characters per line for the two common paper widths (the printer's standard font).
export const PAPER = { 58: 32, 80: 48 }
export const paperColumns = (widthMm) => PAPER[widthMm] || PAPER[58]

const REPLACE = [
  [/₹/g, 'Rs.'],
  [/[−–—]/g, '-'],
  [/[·•]/g, '-'],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
]

// Plain ASCII only: accents are dropped ("é" -> "e"), anything else unknown becomes "?".
export const ascii = (value) => {
  let text = String(value ?? '')
  for (const [pattern, to] of REPLACE) text = text.replace(pattern, to)
  text = text.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return text.replace(/\r\n?|\n/g, ' ').replace(/[^\x20-\x7e]/g, '?')
}

// Breaks a text into lines of at most `columns` characters, at spaces where possible.
export const wrap = (value, columns) => {
  const words = ascii(value).split(' ').filter(Boolean)
  const lines = []
  let line = ''
  for (let word of words) {
    while (word.length > columns) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, columns))
      word = word.slice(columns)
    }
    if (!line) line = word
    else if (line.length + 1 + word.length <= columns) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

export class EscPos {
  constructor({ columns = 32 } = {}) {
    this.columns = columns
    this.parts = []
    this.raw(ESC, 0x40) // reset the printer
  }

  raw(...bytes) {
    this.parts.push(Uint8Array.from(bytes))
    return this
  }

  align(where) {
    return this.raw(ESC, 0x61, where === 'center' ? 1 : where === 'right' ? 2 : 0)
  }

  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0)
  }

  // Character size: 1 = normal, 2 = double width / height.
  size(width = 1, height = 1) {
    const w = Math.min(Math.max(width, 1), 4) - 1
    const h = Math.min(Math.max(height, 1), 4) - 1
    return this.raw(GS, 0x21, (w << 4) | h)
  }

  // One line (or several if long). `bigger` is the size multiplier, which shortens the line to fit.
  line(value = '', { bigger = 1 } = {}) {
    const columns = Math.max(Math.floor(this.columns / bigger), 1)
    const lines = value === '' ? [''] : wrap(value, columns)
    for (const text of lines) this.emit(text)
    return this
  }

  // One finished line, written as it is (no re-wrapping, so the spaces inside it stay).
  emit(text) {
    this.parts.push(Uint8Array.from([...text].map((c) => c.charCodeAt(0) & 0x7f).concat(LF)))
    return this
  }

  // "left ..... right" on one line; the left part is shortened if they do not fit.
  row(left, right) {
    const r = ascii(right)
    const room = Math.max(this.columns - r.length - 1, 1)
    let l = ascii(left)
    if (l.length > room) l = l.slice(0, room)
    const gap = Math.max(this.columns - l.length - r.length, 1)
    return this.emit(`${l}${' '.repeat(gap)}${r}`)
  }

  rule(char = '-') {
    return this.emit(char.repeat(this.columns))
  }

  feed(lines = 1) {
    return this.raw(ESC, 0x64, Math.min(Math.max(lines, 0), 10))
  }

  // A QR code made by the printer itself (works on every printer that has the QR command).
  qr(value, { module = 6 } = {}) {
    const data = [...String(value)].map((c) => c.charCodeAt(0) & 0x7f)
    if (data.length === 0 || data.length > 200) return this
    const length = data.length + 3
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00) // model 2
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.min(Math.max(module, 1), 16)) // size of one dot
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31) // error correction M
    this.raw(GS, 0x28, 0x6b, length & 0xff, length >> 8, 0x31, 0x50, 0x30, ...data) // store the text
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30) // print it
    return this
  }

  cut() {
    return this.raw(GS, 0x56, 0x42, 0x00) // feed to the cutting position and cut (printers without a cutter ignore it)
  }

  bytes() {
    const size = this.parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(size)
    let at = 0
    for (const part of this.parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
}

export const toBase64 = (bytes) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const finish = (doc, { cut }) => {
  doc.feed(cut ? 3 : 5)
  if (cut) doc.cut()
  return doc.bytes()
}

// The entry ticket.
//   t = { place, note, ticketNumber, vehicle, kind, entry, gate, advance, qr, footer }  (every value already formatted as text)
export function ticketSlip(t, { width = 58, cut = width === 80 } = {}) {
  const doc = new EscPos({ columns: paperColumns(width) })
  doc.align('center').bold(true).line(t.place, { bigger: 1 }).bold(false)
  if (t.note) doc.line(t.note)
  doc.line('PARKING TICKET')
  doc.rule()
  if (t.ticketNumber) doc.bold(true).size(2, 2).line(t.ticketNumber, { bigger: 2 }).size(1, 1).bold(false)
  doc.bold(true).size(1, 2).line(t.vehicle).size(1, 1).bold(false)
  doc.line([t.kind, `In ${t.entry}`, t.gate].filter(Boolean).join(' - '))
  if (t.qr) {
    doc.feed(1).qr(t.qr, { module: width === 80 ? 7 : 6 }).feed(1)
  }
  if (t.advance) doc.bold(true).line(`Advance paid: ${t.advance}`).bold(false)
  doc.rule()
  if (t.footer) doc.line(t.footer)
  return finish(doc, { cut })
}

// The exit bill.
//   b = { company, place, address, gst, note, rows: [{ label, value, strong? }], qr, reference, footer }
export function billSlip(b, { width = 58, cut = width === 80 } = {}) {
  const doc = new EscPos({ columns: paperColumns(width) })
  doc.align('center').bold(true).line(b.company).bold(false).line(b.place)
  if (b.address) doc.line(b.address)
  if (b.gst) doc.line(`GSTIN: ${b.gst}`)
  if (b.note) doc.line(b.note)
  doc.line('PARKING RECEIPT')
  doc.align('left').rule()
  for (const row of b.rows) {
    if (row.strong) doc.bold(true)
    doc.row(row.label, row.value)
    if (row.strong) doc.bold(false)
  }
  doc.rule()
  if (b.qr) doc.align('center').feed(1).qr(b.qr, { module: width === 80 ? 7 : 6 }).feed(1)
  doc.align('center')
  if (b.reference) doc.line(`Ref: ${b.reference}`)
  if (b.footer) doc.line(b.footer)
  return finish(doc, { cut })
}

// A short slip to check that the printer works and how wide its paper is.
export function testSlip(name, { width = 58, cut = width === 80 } = {}) {
  const doc = new EscPos({ columns: paperColumns(width) })
  doc.align('center').bold(true).size(2, 2).line('PRINTER OK', { bigger: 2 }).size(1, 1).bold(false)
  doc.line(name || 'Smart Parking')
  doc.rule('=')
  doc.align('left').line('1234567890'.repeat(5).slice(0, paperColumns(width)))
  doc.align('center').line(`${width} mm paper, ${paperColumns(width)} chars per line`)
  return finish(doc, { cut })
}
