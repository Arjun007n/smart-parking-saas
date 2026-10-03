// Unit tests for the public website helpers. No database needed.
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { slugify, uniqueSlug } = require("../utils/slug");
const { validateData } = require("../middleware/validate");

test("slugify makes safe web addresses", () => {
  assert.equal(slugify("10 Tips for Parking Operators!"), "10-tips-for-parking-operators");
  assert.equal(slugify("  Café & Crème — brûlée  "), "cafe-creme-brulee");
  assert.equal(slugify("../../etc/passwd"), "etc-passwd");
  assert.equal(slugify("<script>alert(1)</script>"), "script-alert-1-script");
  assert.equal(slugify(""), "");
  assert.equal(slugify(null), "");
  assert.equal(slugify({ $gt: "" }), "object-object");
  const long = slugify("word ".repeat(40));
  assert.ok(long.length <= 80 && !long.endsWith("-"));
});

test("uniqueSlug adds a number when the address is taken", async () => {
  const taken = new Set(["my-post", "my-post-2"]);
  const exists = async (slug) => taken.has(slug);
  assert.equal(await uniqueSlug("My Post", exists), "my-post-3");
  assert.equal(await uniqueSlug("Another", exists), "another");
  assert.equal(await uniqueSlug("!!!", exists), "post");
});

test("enquiry form rules: required fields, phone format, unknown fields dropped", () => {
  const rules = {
    name: { type: "string", required: true, min: 2, max: 100 },
    email: { type: "email", required: true },
    phone: { type: "string", max: 20, pattern: /^[0-9+()\-\s]{6,20}$/ },
    message: { type: "string", max: 2000 },
  };
  const good = validateData(rules, { name: "Ravi", email: "Ravi@Example.com", phone: "+91 98765 43210", message: "Hello", status: "CLOSED" });
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.data, { name: "Ravi", email: "ravi@example.com", phone: "+91 98765 43210", message: "Hello" });

  assert.equal(validateData(rules, { name: "R", email: "nope", phone: "call me" }).errors.length, 3);
  assert.equal(validateData(rules, { name: "Ravi", email: "a@b.co", message: "x".repeat(2001) }).errors.length, 1);
});
