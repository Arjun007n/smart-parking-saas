// QR code generator: structure, capacity limits and a known-answer check.
// The codes were also decoded with an independent reader (OpenCV) for every
// version 1-40 at every error level when this was written.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const qr = require("../utils/qr");

const digest = (text, options) =>
  crypto.createHash("sha256").update(qr.toRows(text, options).join("\n")).digest("hex").slice(0, 16);

test("known answers: these exact codes were verified with an independent QR reader", () => {
  assert.equal(digest("T-260302-K7QXMP"), "ebf2e97b689594bf");
  assert.equal(digest("P-260302-K7QXMP"), "a4d61b7c083001f6");
  assert.equal(digest("https://x.test/pay/ORD-1", { level: "Q" }), "ef4bc3485452b71a");
});

test("size follows the version, and the version grows only when the text needs it", () => {
  assert.equal(qr.encode("a".repeat(14)).version, 1, "14 bytes fit version 1 at level M");
  assert.equal(qr.encode("a".repeat(15)).version, 2);
  assert.equal(qr.encode("a".repeat(17), { level: "L" }).version, 1);
  assert.equal(qr.encode("a".repeat(18), { level: "L" }).version, 2);
  for (const text of ["x", "T-260302-K7QXMP", "a".repeat(200)]) {
    const code = qr.encode(text);
    assert.equal(code.size, code.version * 4 + 17);
    assert.equal(code.modules.length, code.size);
    assert.ok(code.modules.every((row) => row.length === code.size));
  }
  assert.equal(qr.encode("a".repeat(14), { minVersion: 5 }).version, 5);
});

test("the fixed patterns are where the standard puts them", () => {
  const { modules, size } = qr.encode("T-260302-K7QXMP");
  // Finder squares: a dark 7x7 ring, a light ring inside, a dark 3x3 centre; at three corners.
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = 0; dy < 7; dy += 1) {
      for (let dx = 0; dx < 7; dx += 1) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        assert.equal(modules[oy + dy][ox + dx], ring !== 2, `finder at ${ox},${oy} (${dx},${dy})`);
      }
    }
  }
  assert.equal(modules[size - 7][8], true, "the always-dark module");
  assert.equal(modules[size - 8][size - 1], false, "no fourth finder");
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(modules[6][i], i % 2 === 0, "horizontal timing");
    assert.equal(modules[i][6], i % 2 === 0, "vertical timing");
  }
});

test("the same text always gives the same code; different text differs", () => {
  assert.equal(digest("T-260302-K7QXMP"), digest("T-260302-K7QXMP"));
  assert.notEqual(digest("T-260302-K7QXMP"), digest("T-260302-K7QXMQ"));
  assert.notEqual(digest("T-260302-K7QXMP", { level: "L" }), digest("T-260302-K7QXMP", { level: "H" }));
});

test("text is read as UTF-8, and impossible requests are refused", () => {
  assert.ok(qr.encode("₹ 100 — pass").size >= 21);
  assert.throws(() => qr.encode("a", { level: "Z" }), /level must be/);
  assert.throws(() => qr.encode("a".repeat(3000)), /too long/);
  assert.equal(qr.encode("a".repeat(2953), { level: "L" }).version, 40, "version 40-L holds 2953 bytes");
  assert.throws(() => qr.encode("a".repeat(2954), { level: "L" }), /too long/);
  assert.equal(qr.encode("a".repeat(2331), { level: "M" }).version, 40, "version 40-M holds 2331 bytes");
  assert.throws(() => qr.encode("a".repeat(2332), { level: "M" }), /too long/);
});

test("SVG output is a closed, self-contained drawing", () => {
  const svg = qr.toSvg("T-260302-K7QXMP");
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 33 33"/);
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(!svg.includes("<script"));
  assert.equal(qr.toSvg("x", { margin: 0 }).match(/viewBox="0 0 (\d+)/)[1], "21");
});

test("the browser copy is identical apart from its export line", () => {
  const server = fs.readFileSync(path.join(__dirname, "../utils/qr.js"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "../../client/src/utils/qr.js"), "utf8");
  assert.equal(client, server.replace("module.exports = { encode, toRows, toSvg };", "export { encode, toRows, toSvg };"));
});
