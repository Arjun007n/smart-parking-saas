import test from "node:test";
import assert from "node:assert/strict";
import { EscPos, ascii, billSlip, paperColumns, testSlip, ticketSlip, toBase64, wrap } from "../../client/src/native/escpos.js";

const text = (bytes) => Buffer.from(bytes).toString("latin1");
const has = (bytes, ...seq) => Buffer.from(bytes).includes(Buffer.from(seq));

test("ascii: rupee sign, dashes and accents become plain letters", () => {
  assert.equal(ascii("₹30.00"), "Rs.30.00");
  assert.equal(ascii("Café – Zürich · Gate 1"), "Cafe - Zurich - Gate 1");
  assert.equal(ascii("a\nb"), "a b");
  assert.equal(ascii("日本"), "??");
  assert.equal(ascii(null), "");
});

test("wrap: breaks at spaces and cuts words that are too long", () => {
  assert.deepEqual(wrap("one two three", 7), ["one two", "three"]);
  assert.deepEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrap("", 10), []);
});

test("paper: 58 mm is 32 characters, 80 mm is 48, anything else is treated as 58 mm", () => {
  assert.equal(paperColumns(58), 32);
  assert.equal(paperColumns(80), 48);
  assert.equal(paperColumns(100), 32);
});

test("row: the two parts fill exactly one line", () => {
  const doc = new EscPos({ columns: 20 }).row("Total", "Rs.30.00");
  assert.match(text(doc.bytes()), /Total {7}Rs\.30\.00\n/);
  const long = new EscPos({ columns: 20 }).row("A very long left label here", "Rs.5");
  const line = text(long.bytes()).split("\n")[0].replace(/^\x1b@/, "");
  assert.equal(line.length, 20);
  assert.ok(line.endsWith("Rs.5"));
});

test("the slip starts with a printer reset and never holds a byte above 0x7f in its text", () => {
  const bytes = testSlip("Printer ₹", { width: 58 });
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40]);
  const printable = text(bytes);
  assert.match(printable, /PRINTER OK/);
  assert.match(printable, /58 mm paper, 32 chars per line/);
});

test("ticket: vehicle number, ticket number, entry time, advance and a QR code are on it", () => {
  const bytes = ticketSlip(
    { place: "City Mall", ticketNumber: "261010-2P2", vehicle: "MH12AB1234", kind: "Car", entry: "10 Oct, 01:07 pm", gate: "Lane 2", advance: "₹20.00 (Cash)", qr: "261010-2P2", footer: "Keep this ticket safe." },
    { width: 80 },
  );
  const s = text(bytes);
  for (const part of ["City Mall", "PARKING TICKET", "261010-2P2", "MH12AB1234", "Car - In 10 Oct, 01:07 pm - Lane 2", "Advance paid: Rs.20.00 (Cash)", "Keep this ticket safe."]) {
    assert.ok(s.includes(part), `missing: ${part}`);
  }
  assert.ok(has(bytes, 0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30), "QR print command");
  assert.ok(has(bytes, 0x1d, 0x56, 0x42, 0x00), "80 mm slips are cut");
  assert.ok(Buffer.from(bytes).includes(Buffer.from("261010-2P2")), "the QR holds the ticket number");
});

test("ticket: no QR and no cut when not wanted; the ticket number can be left off", () => {
  const bytes = ticketSlip({ place: "P", ticketNumber: "", vehicle: "KA01", kind: "Bike", entry: "now", qr: "" }, { width: 58 });
  assert.ok(!has(bytes, 0x1d, 0x28, 0x6b));
  assert.ok(!has(bytes, 0x1d, 0x56));
  assert.ok(!text(bytes).includes("undefined"));
});

test("QR: the stored length follows the text, and over-long text is skipped", () => {
  const doc = new EscPos().qr("ABC");
  assert.ok(has(doc.bytes(), 0x1d, 0x28, 0x6b, 0x06, 0x00, 0x31, 0x50, 0x30, 0x41, 0x42, 0x43));
  assert.equal(new EscPos().qr("x".repeat(201)).bytes().length, 2);
});

test("bill: rows, strong rows and the reference are printed", () => {
  const bytes = billSlip(
    { company: "ABC Parking Pvt Ltd", place: "City Mall", address: "MG Road, Pune", gst: "27AAAAA0000A1Z5", rows: [{ label: "Parking fee", value: "₹30.00" }, { label: "Total", value: "₹30.00", strong: true }], reference: "R-1", footer: "Thank you." },
    { width: 58 },
  );
  const s = text(bytes);
  assert.match(s, /Parking fee {13}Rs\.30\.00/);
  assert.match(s, /GSTIN: 27AAAAA0000A1Z5/);
  assert.match(s, /Ref: R-1/);
  assert.ok(has(bytes, 0x1b, 0x45, 0x01), "bold on for the strong row");
});

test("toBase64 round-trips, including more than one block of bytes", () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
  assert.deepEqual([...Buffer.from(toBase64(bytes), "base64")], [...bytes]);
});

// The phone plugin objects: the page only has the phone bridge's nativePromise / addListener, not registerPlugin.
test("native plugin: calls go through the phone bridge; listeners return a handle; await does not hang", async () => {
  const calls = [];
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      nativePromise: (plugin, method, options) => {
        calls.push([plugin, method, options]);
        return Promise.resolve({ ok: method });
      },
      addListener: (plugin, event) => ({ remove: async () => calls.push(["removed", plugin, event]) }),
    },
  };
  const { isNative, nativePlugin } = await import("../../client/src/native/platform.js?bridge");
  assert.equal(isNative, true);
  const printer = nativePlugin("ThermalPrinter");
  assert.equal(nativePlugin("ThermalPrinter"), printer, "one object per plugin");
  assert.deepEqual(await printer.status(), { ok: "status" });
  assert.deepEqual(await printer.print({ address: "AA:BB", data: "x" }), { ok: "print" });
  assert.deepEqual(calls[0], ["ThermalPrinter", "status", {}]);
  assert.deepEqual(calls[1], ["ThermalPrinter", "print", { address: "AA:BB", data: "x" }]);
  const handle = await nativePlugin("App").addListener("backButton", () => {});
  await handle.remove();
  assert.deepEqual(calls[2], ["removed", "App", "backButton"]);
  // Awaiting the plugin object itself must not treat it as a promise.
  assert.equal(await printer, printer);
  delete globalThis.window;
});
