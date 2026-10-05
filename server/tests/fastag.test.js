// Unit tests for FASTag charging: the provider contract (against a small local server),
// the simulated partner, and the attempt logic of the service (with the database stubbed).
// No database needed.
process.env.NODE_ENV = "test";
process.env.FASTAG_SIM_DELAY_MS = "0";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const fastag = require("../integrations/fastag");
const FastagCharge = require("../models/FastagCharge");
const Payment = require("../models/Payment");
const service = require("../services/fastagService");

const setEnv = (values) => {
  for (const key of ["FASTAG_PROVIDER", "FASTAG_API_URL", "FASTAG_API_KEY", "FASTAG_TIMEOUT_MS"]) delete process.env[key];
  Object.assign(process.env, values);
};

test("provider choice: off by default, unknown names are caught, simulated is never production", () => {
  setEnv({});
  assert.equal(fastag.providerName(), "none");
  assert.equal(fastag.isConfigured(), false);
  setEnv({ FASTAG_PROVIDER: "nonsense" });
  assert.equal(fastag.isKnownProvider(), false);
  setEnv({ FASTAG_PROVIDER: "simulated" });
  assert.equal(fastag.isConfigured(), true);
  process.env.NODE_ENV = "production";
  assert.equal(fastag.isConfigured(), false);
  process.env.NODE_ENV = "test";
  setEnv({});
});

test("http provider: needs an address and a key, and https in production", () => {
  setEnv({ FASTAG_PROVIDER: "http" });
  assert.equal(fastag.isConfigured(), false);
  assert.equal(fastag.provider().problems().length, 2);
  setEnv({ FASTAG_PROVIDER: "http", FASTAG_API_URL: "http://partner.local", FASTAG_API_KEY: "k" });
  assert.equal(fastag.isConfigured(), true);
  assert.deepEqual(fastag.provider().problems(), []);
  process.env.NODE_ENV = "production";
  assert.equal(fastag.provider().problems().length, 1);
  process.env.NODE_ENV = "test";
  setEnv({});
});

test("partner answers are read strictly", () => {
  assert.deepEqual(fastag.fromPartner({ status: "SUCCESS", providerReference: " R1 " }), { status: "SUCCESS", providerReference: "R1" });
  // Success with no reference of its own cannot be reconciled: not treated as paid.
  assert.equal(fastag.fromPartner({ status: "SUCCESS" }).status, "UNKNOWN");
  assert.equal(fastag.fromPartner({ status: "failed", reason: "No balance" }).status, "FAILED");
  assert.equal(fastag.fromPartner({ status: "PENDING" }).status, "UNKNOWN");
  assert.equal(fastag.fromPartner({}).status, "UNKNOWN");
  assert.equal(fastag.fromPartner(null).status, "UNKNOWN");
});

// A pretend partner on a local port.
const partner = async (handler) => {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      handler(req, res, calls.at(-1));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
};
const reply = (res, status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };

test("http provider: charge sends the contract and maps every kind of answer", async () => {
  const answers = [
    [200, { status: "SUCCESS", providerReference: "BANK-1" }],
    [200, { status: "FAILED", reason: "Insufficient balance" }],
    [200, { status: "PENDING" }],
    [422, { reason: "Tag blacklisted" }],
    [500, {}],
    [429, {}],
  ];
  const p = await partner((req, res) => reply(res, ...answers.shift()));
  setEnv({ FASTAG_PROVIDER: "http", FASTAG_API_URL: `${p.url}/`, FASTAG_API_KEY: "secret-key" });
  const provider = fastag.provider();
  const args = { reference: "FT-1", tagId: "34161FA820", vehicleNumber: "KA01AB1234", amount: 40, description: "Parking T-1" };
  const out = [];
  for (let i = 0; i < 6; i += 1) out.push(await provider.charge(args));
  await p.close();
  assert.deepEqual(out.map((o) => o.status), ["SUCCESS", "FAILED", "UNKNOWN", "FAILED", "UNKNOWN", "UNKNOWN"]);
  assert.equal(out[0].providerReference, "BANK-1");
  assert.match(out[1].reason, /Insufficient/);
  assert.match(out[3].reason, /blacklisted/);
  assert.equal(p.calls[0].method, "POST");
  assert.equal(p.calls[0].url, "/charges");
  assert.equal(p.calls[0].auth, "Bearer secret-key");
  assert.deepEqual(p.calls[0].body, args);
  setEnv({});
});

test("http provider: no answer in time is UNKNOWN (never a failure)", async () => {
  const p = await partner(() => {}); // never answers
  setEnv({ FASTAG_PROVIDER: "http", FASTAG_API_URL: p.url, FASTAG_API_KEY: "k", FASTAG_TIMEOUT_MS: "1000" });
  const out = await fastag.provider().charge({ reference: "FT-2", tagId: "ABCD1234", amount: 10 });
  await p.close();
  assert.equal(out.status, "UNKNOWN");
  setEnv({});
});

test("http provider: status asks by reference; 404 means the partner never saw it", async () => {
  const p = await partner((req, res) => {
    if (req.url.endsWith("FT-A")) reply(res, 200, { status: "SUCCESS", providerReference: "BANK-9" });
    else if (req.url.endsWith("FT-B")) reply(res, 404, {});
    else reply(res, 503, {});
  });
  setEnv({ FASTAG_PROVIDER: "http", FASTAG_API_URL: p.url, FASTAG_API_KEY: "k" });
  const provider = fastag.provider();
  assert.equal((await provider.status({ reference: "FT-A" })).providerReference, "BANK-9");
  assert.equal((await provider.status({ reference: "FT-B" })).status, "NOT_FOUND");
  assert.equal((await provider.status({ reference: "FT-C" })).status, "UNKNOWN");
  assert.equal(p.calls[0].method, "GET");
  await p.close();
  setEnv({});
});

test("simulated partner: F declines, U is unknown first then succeeds, others succeed", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const sim = fastag.provider();
  assert.equal((await sim.charge({ reference: "r1", tagId: "ABCD0001" })).status, "SUCCESS");
  assert.equal((await sim.charge({ reference: "r2", tagId: "ABCD000F" })).status, "FAILED");
  assert.equal((await sim.charge({ reference: "r3", tagId: "ABCD000U" })).status, "UNKNOWN");
  assert.equal((await sim.status({ reference: "r3" })).status, "SUCCESS");
  // With a delay, the answer stays "unknown" until it has passed, however often it is asked.
  process.env.FASTAG_SIM_DELAY_MS = "300";
  await sim.charge({ reference: "r4", tagId: "ABCD000U" });
  assert.equal((await sim.status({ reference: "r4" })).status, "UNKNOWN");
  assert.equal((await sim.status({ reference: "r4" })).status, "UNKNOWN");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal((await sim.status({ reference: "r4" })).status, "SUCCESS");
  process.env.FASTAG_SIM_DELAY_MS = "0";
  assert.equal((await sim.status({ reference: "never" })).status, "NOT_FOUND");
  setEnv({});
});

// ---- the service, with an in-memory stand-in for the two collections ----
const stubDb = () => {
  const charges = [];
  const payments = [];
  let n = 0;
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === "object" && v.$in) return v.$in.includes(doc[k]);
    return String(doc[k]) === String(v);
  });
  const originals = {
    cCreate: FastagCharge.create, cFindOne: FastagCharge.findOne, cFindOneAndUpdate: FastagCharge.findOneAndUpdate,
    cFindById: FastagCharge.findById, cUpdateOne: FastagCharge.updateOne, pCreate: Payment.create, pFindOne: Payment.findOne,
  };
  FastagCharge.create = async (doc) => {
    if (charges.some((c) => c.active && String(c.sessionId) === String(doc.sessionId))) throw Object.assign(new Error("dup"), { code: 11000 });
    n += 1;
    const row = { _id: `c${n}`, status: "PENDING", active: true, createdAt: new Date(), ...doc };
    charges.push(row);
    return row;
  };
  FastagCharge.findOne = async (filter) => charges.find((c) => matches(c, filter)) || null;
  FastagCharge.findById = async (id) => charges.find((c) => c._id === id) || null;
  FastagCharge.findOneAndUpdate = async (filter, update) => {
    const row = charges.find((c) => matches(c, filter));
    if (!row) return null;
    Object.assign(row, update.$set);
    for (const k of Object.keys(update.$unset || {})) delete row[k];
    return row;
  };
  FastagCharge.updateOne = async (filter, update) => {
    const row = charges.find((c) => matches(c, filter));
    if (row) Object.assign(row, update.$set);
  };
  Payment.findOne = async (filter) => payments.find((p) => matches(p, filter)) || null;
  Payment.create = async (doc) => {
    if (payments.some((p) => p.transactionId === doc.transactionId)) throw Object.assign(new Error("dup"), { code: 11000 });
    const row = { _id: `p${payments.length + 1}`, ...doc };
    payments.push(row);
    return row;
  };
  const restore = () => {
    FastagCharge.create = originals.cCreate; FastagCharge.findOne = originals.cFindOne; FastagCharge.findOneAndUpdate = originals.cFindOneAndUpdate;
    FastagCharge.findById = originals.cFindById; FastagCharge.updateOne = originals.cUpdateOne; Payment.create = originals.pCreate; Payment.findOne = originals.pFindOne;
  };
  return { charges, payments, restore };
};
const session = (extra = {}) => ({
  _id: "s1", companyId: "co", locationId: "loc", vehicleNumber: "KA01AB1234", ticketNumber: "T-1", fee: { total: 40 }, ...extra,
});
const req = { headers: {}, ip: "x", user: { _id: "u1" } };

test("service: a good tag is charged once, and asking again returns the same attempt", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const db = stubDb();
  try {
    const first = await service.charge({ session: session(), tagId: "34161fa8 20", amount: 40, by: "u1" });
    assert.equal(first.charge.status, "SUCCESS");
    assert.equal(first.charge.tagId, "34161FA820", "the tag is cleaned up");
    assert.match(first.charge.providerReference, /^SIM-/);
    const again = await service.charge({ session: session(), tagId: "34161FA820", amount: 40, by: "u1" });
    assert.equal(again.charge._id, first.charge._id);
    assert.equal(db.charges.length, 1, "no second attempt, so no second charge");
  } finally { db.restore(); setEnv({}); }
});

test("service: a bad tag number is refused before anything is saved", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const db = stubDb();
  try {
    await assert.rejects(() => service.charge({ session: session(), tagId: "x", amount: 40 }), /FASTag number/);
    assert.equal(db.charges.length, 0);
  } finally { db.restore(); setEnv({}); }
});

test("service: nothing is charged when no partner is set up", async () => {
  setEnv({});
  const db = stubDb();
  try {
    await assert.rejects(() => service.charge({ session: session(), tagId: "ABCD0001", amount: 40 }), /not set up/);
  } finally { db.restore(); }
});

test("service: a decline frees the session for another try", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const db = stubDb();
  try {
    const declined = await service.charge({ session: session(), tagId: "ABCD000F", amount: 40 });
    assert.equal(declined.charge.status, "FAILED");
    assert.equal(declined.charge.active, false);
    assert.match(declined.charge.failureReason, /Insufficient/);
    const retry = await service.charge({ session: session(), tagId: "ABCD0002", amount: 40 });
    assert.equal(retry.charge.status, "SUCCESS");
    assert.equal(db.charges.length, 2);
  } finally { db.restore(); setEnv({}); }
});

test("service: an unconfirmed charge is settled by asking, never by charging again", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const db = stubDb();
  try {
    const first = await service.charge({ session: session(), tagId: "ABCD000U", amount: 40 });
    assert.equal(first.charge.status, "UNKNOWN");
    // Another tag cannot be used while the first attempt is unsettled (the first tag may have been charged).
    await assert.rejects(
      () => service.charge({ session: session(), tagId: "ZZZZ0001", amount: 40 }),
      (error) => error.statusCode === 409 && /ABCD000U/.test(error.message)
    );
    // Asking again with the same tag asks the partner about the first attempt.
    const second = await service.charge({ session: session(), tagId: "ABCD000U", amount: 40 });
    assert.equal(second.charge._id, first.charge._id);
    assert.equal(second.charge.status, "SUCCESS");
    assert.equal(db.charges.length, 1);
    assert.equal(second.charge.failureReason, undefined);
  } finally { db.restore(); setEnv({}); }
});

test("service: a partner that never saw the reference is believed only after a safe wait", async () => {
  setEnv({ FASTAG_PROVIDER: "http", FASTAG_API_URL: "http://127.0.0.1:1", FASTAG_API_KEY: "k", FASTAG_TIMEOUT_MS: "1000" });
  const db = stubDb();
  const provider = fastag.provider();
  const realStatus = provider.status;
  try {
    // The attempt was saved, the call is not known to have finished.
    const row = await FastagCharge.create({ sessionId: "s1", companyId: "co", locationId: "loc", tagId: "ABCD0001", amount: 40 });
    row.status = "UNKNOWN";
    provider.status = async () => ({ status: "NOT_FOUND" });
    assert.equal((await service.unsettled("s1")).status, "UNKNOWN", "a young attempt may still be in flight");
    row.createdAt = new Date(Date.now() - 5 * 60 * 1000);
    const settled = await service.unsettled("s1");
    assert.equal(settled.status, "FAILED");
    assert.equal(settled.active, false);
  } finally { provider.status = realStatus; db.restore(); setEnv({}); }
});

test("service: a charged tag becomes one payment, and only for the amount that was charged", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const db = stubDb();
  try {
    const { charge } = await service.charge({ session: session(), tagId: "ABCD0001", amount: 40 });
    const base = { companyId: "co", locationId: "loc", sessionId: "s1", kind: "FEE", method: "FASTAG", collectedBy: "u1" };
    const one = await service.paymentFor({ charge, session: session(), base, req });
    assert.equal(one.method, "FASTAG");
    assert.equal(one.transactionId, `FASTAG:${charge.providerReference}`);
    assert.equal(one.tagId, "ABCD0001");
    const two = await service.paymentFor({ charge, session: session(), base, req });
    assert.equal(two._id, one._id, "a repeat finds the same payment");
    assert.equal(db.payments.length, 1);
  } finally { db.restore(); setEnv({}); }
});

test("service: if the fee changed after the tag was charged, no payment is made and the attempt is flagged", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const db = stubDb();
  try {
    const { charge } = await service.charge({ session: session(), tagId: "ABCD0001", amount: 40 });
    const base = { companyId: "co", locationId: "loc", sessionId: "s1", kind: "FEE", method: "FASTAG" };
    await assert.rejects(
      () => service.paymentFor({ charge, session: session({ fee: { total: 60 } }), base, req }),
      (error) => error.statusCode === 409 && /tell your admin/.test(error.message)
    );
    assert.equal(db.payments.length, 0);
    assert.equal(db.charges[0].needsReview, true);
  } finally { db.restore(); setEnv({}); }
});

test("service: with the partner switched off an open attempt is left alone, not asked about", async () => {
  setEnv({ FASTAG_PROVIDER: "simulated" });
  const db = stubDb();
  try {
    const first = await service.charge({ session: session(), tagId: "ABCD000U", amount: 40 });
    assert.equal(first.charge.status, "UNKNOWN");
    setEnv({});
    const seen = await service.unsettled("s1");
    assert.equal(seen.status, "UNKNOWN", "no crash, no change");
    assert.deepEqual(await service.sweep(), { checked: 0, settled: 0, flagged: 0 });
  } finally { db.restore(); setEnv({}); }
});

test("the payment record and the permission rules for FASTag", () => {
  assert.ok(Payment.schema.path("fastagChargeId"));
  assert.ok(Payment.schema.path("tagId"));
  assert.deepEqual(FastagCharge.FASTAG_CHARGE_STATUSES, ["PENDING", "UNKNOWN", "SUCCESS", "FAILED"]);
});
