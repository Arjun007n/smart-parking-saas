// Security unit tests (plan, Day 29). No database needed.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const env = require("../config/env");
const { signToken, verifyToken } = require("../utils/token");
const loginGuard = require("../services/loginGuard");
const { errorHandler } = require("../middleware/errorHandler");
const { reportError } = require("../utils/monitor");
const { serialize, parse, databaseName } = require("../utils/backupFormat");
const User = require("../models/User");

const user = { _id: new mongoose.Types.ObjectId(), tokenVersion: 0 };
const b64 = (object) => Buffer.from(JSON.stringify(object)).toString("base64url");

// Runs fn with NODE_ENV temporarily changed (undefined = not set at all).
const withNodeEnv = (value, fn) => {
  const saved = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = saved;
  }
};

test("tokens: only our own HS256 signature is accepted", () => {
  assert.equal(verifyToken(signToken(user)).sub, String(user._id));

  // "alg: none" (unsigned) token
  const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: String(user._id), tv: 0 })}.`;
  assert.throws(() => verifyToken(unsigned));
  // Right secret, different algorithm
  assert.throws(() => verifyToken(jwt.sign({ sub: "x", tv: 0 }, process.env.JWT_SECRET, { algorithm: "HS512" })));
  // Wrong secret
  assert.throws(() => verifyToken(jwt.sign({ sub: "x", tv: 0 }, "another-secret-another-secret-1234")));
  // Payload changed after signing
  const [header, , signature] = signToken(user).split(".");
  assert.throws(() => verifyToken(`${header}.${b64({ sub: "someone-else", tv: 0 })}.${signature}`));
  // Expired
  const expired = jwt.sign({ sub: String(user._id), tv: 0 }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: -10 });
  assert.throws(() => verifyToken(expired), /expired/);
  // Tokens always carry an expiry
  assert.ok(verifyToken(signToken(user)).exp > Date.now() / 1000);
});

test("login guard: locks after repeated wrong passwords, for a limited time", () => {
  const now = new Date("2026-03-02T10:00:00Z");
  let state = { failedLogins: 0 };
  for (let i = 1; i < loginGuard.MAX_FAILED; i += 1) {
    state = loginGuard.afterFailure(state.failedLogins, now);
    assert.equal(state.failedLogins, i);
    assert.equal(state.lockedUntil, undefined);
  }
  state = loginGuard.afterFailure(state.failedLogins, now); // the 10th
  assert.equal(state.failedLogins, 0);
  assert.equal(state.lockedUntil.toISOString(), "2026-03-02T10:15:00.000Z");

  assert.ok(loginGuard.isLocked(state, new Date("2026-03-02T10:14:59Z")));
  assert.ok(!loginGuard.isLocked(state, new Date("2026-03-02T10:15:01Z")));
  assert.ok(!loginGuard.isLocked({}, now));
  assert.equal(loginGuard.minutesLeft(state, new Date("2026-03-02T10:05:30Z")), 10);
  assert.equal(loginGuard.afterFailure(undefined, now).failedLogins, 1); // accounts created before this feature
});

test("login guard: unknown emails cost the same work as real ones", async () => {
  assert.equal(await loginGuard.burnTime("any password"), false);
  assert.equal(await loginGuard.burnTime(undefined), false);
});

test("developer conveniences are off unless NODE_ENV says development or test", () => {
  assert.equal(withNodeEnv("test", () => env.isDevLike), true);
  assert.equal(withNodeEnv("development", () => env.isDevLike), true);
  assert.equal(withNodeEnv("production", () => env.isDevLike), false);
  assert.equal(withNodeEnv("staging", () => env.isDevLike), false);
  assert.equal(withNodeEnv(undefined, () => env.isDevLike), false); // forgotten NODE_ENV is treated as production
});

test("internal error details never reach the client outside development", () => {
  const respond = (nodeEnv) => {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const original = console.error;
    console.error = () => {};
    try {
      withNodeEnv(nodeEnv, () => errorHandler(new Error("connect ECONNREFUSED mongodb://user:secret@host"), { method: "GET", originalUrl: "/x" }, res, () => {}));
    } finally {
      console.error = original;
    }
    return res;
  };
  for (const nodeEnv of ["production", undefined, "staging"]) {
    const res = respond(nodeEnv);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { success: false, message: "Something went wrong" }, String(nodeEnv));
  }
  assert.match(respond("test").body.debug, /ECONNREFUSED/);
});

test("error reporting never throws and writes one structured line", () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    assert.doesNotThrow(() => reportError(new Error("boom"), { path: "/x" }));
    assert.doesNotThrow(() => reportError("just text"));
    assert.doesNotThrow(() => reportError(undefined));
  } finally {
    console.error = original;
  }
  const first = JSON.parse(lines[0]);
  assert.equal(first.message, "boom");
  assert.equal(first.path, "/x");
  assert.equal(first.level, "error");
});

test("user JSON never contains login-guard or secret fields", () => {
  const doc = new User({
    companyId: new mongoose.Types.ObjectId(), name: "A", email: "a@b.co", password: "12345678",
    role: "ENTRY_OPERATOR", failedLogins: 3, lockedUntil: new Date(),
  });
  const json = JSON.parse(JSON.stringify(doc));
  for (const field of ["password", "failedLogins", "lockedUntil", "tokenVersion", "passwordResetToken"]) {
    assert.equal(json[field], undefined, field);
  }
});

test("backup format keeps ids, dates and number types exactly", () => {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    companyId: new mongoose.Types.ObjectId(),
    entryTime: new Date("2026-03-02T04:30:00.123Z"),
    fee: { total: 40, tax: 6.1 },
    tags: ["a", "b"],
    note: 'quote " and\nnew line',
    empty: null,
  };
  const line = serialize(doc);
  assert.ok(!line.includes("\n"), "one document must stay on one line");
  const back = parse(line);
  assert.ok(back._id.equals(doc._id));
  assert.ok(back.companyId.equals(doc.companyId));
  assert.equal(back.entryTime.getTime(), doc.entryTime.getTime());
  assert.equal(Number(back.fee.total), 40);
  assert.equal(Number(back.fee.tax), 6.1);
  assert.deepEqual(back.tags, ["a", "b"]);
  assert.equal(back.note, doc.note);
  assert.equal(back.empty, null);
});

test("database name is read from a connection string", () => {
  assert.equal(databaseName("mongodb+srv://u:p%40ss@cluster.example.net/smart_parking_restore?appName=x"), "smart_parking_restore");
  assert.equal(databaseName("mongodb://127.0.0.1:27017/smart_parking"), "smart_parking");
  assert.equal(databaseName("mongodb+srv://u:p@cluster.example.net/?appName=x"), "");
});
