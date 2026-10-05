// Plate reading from photos: provider selection, adapters (with a fake network) and result cleaning.
const test = require("node:test");
const assert = require("node:assert/strict");
const recognition = require("../integrations/recognition");
const { parseDetection } = require("../integrations/anpr");

const KEYS = ["RECOGNITION_PROVIDER", "RECOGNITION_URL", "RECOGNITION_API_KEY", "RECOGNITION_REGIONS", "RECOGNITION_MIN_CONFIDENCE", "RECOGNITION_TIMEOUT_MS", "NODE_ENV"];
const saved = { fetch: globalThis.fetch, errors: console.error };
for (const k of KEYS) saved[k] = process.env[k];
test.afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = saved.fetch;
  console.error = saved.errors;
});

const jpeg = (text = "") => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(text), Buffer.alloc(20, 1)]);
const TYPE = { ext: "jpg", contentType: "image/jpeg" };
const fakeFetch = (answer, { ok = true, status = 200, calls = [] } = {}) => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: async () => (typeof answer === "function" ? answer() : answer) };
  };
  return calls;
};

test("the provider is off unless one is chosen, and unknown names are caught", async () => {
  delete process.env.RECOGNITION_PROVIDER;
  assert.equal(recognition.providerName(), "none");
  assert.equal(recognition.isEnabled(), false);
  await assert.rejects(() => recognition.read(jpeg(), TYPE), { statusCode: 503 });
  process.env.RECOGNITION_PROVIDER = " Simulated ";
  assert.equal(recognition.providerName(), "simulated");
  assert.equal(recognition.isEnabled(), true);
  process.env.RECOGNITION_PROVIDER = "magic";
  assert.equal(recognition.isKnownProvider(), false);
  assert.equal(recognition.isEnabled(), false);
});

test("configuration problems are reported for http and platerecognizer", () => {
  delete process.env.RECOGNITION_URL;
  delete process.env.RECOGNITION_API_KEY;
  assert.equal(recognition.PROVIDERS.http.problems().length, 1);
  process.env.RECOGNITION_URL = "ftp://nope";
  assert.equal(recognition.PROVIDERS.http.isConfigured(), false);
  process.env.RECOGNITION_URL = "https://reader.example.com/read";
  assert.equal(recognition.PROVIDERS.http.isConfigured(), true);
  assert.equal(recognition.PROVIDERS.platerecognizer.isConfigured(), false);
  process.env.RECOGNITION_API_KEY = "k";
  assert.equal(recognition.PROVIDERS.platerecognizer.isConfigured(), true);
});

test("simulated reader finds PLATE: and CONF: markers in the picture", async () => {
  process.env.RECOGNITION_PROVIDER = "simulated";
  assert.deepEqual(await recognition.read(jpeg("PLATE:RJ14AB1234"), TYPE), { plate: "RJ14AB1234", confidence: 0.95 });
  assert.deepEqual(await recognition.read(jpeg("PLATE:MH12-AB-1 CONF:0.5"), TYPE), { plate: "MH12-AB-1", confidence: 0.5 });
  assert.deepEqual(await recognition.read(jpeg("nothing here"), TYPE), { plate: "", confidence: undefined });
  assert.deepEqual(await recognition.read(jpeg("nothing here"), TYPE, { hint: "dl1c ab1" }), { plate: "dl1c", confidence: 0.95 }, "hint stops at a space like the marker");
  assert.deepEqual(await recognition.read(jpeg(), TYPE, { hint: "DL01AB0001" }), { plate: "DL01AB0001", confidence: 0.95 });
});

test("http provider posts the picture and understands both answer shapes", async () => {
  process.env.RECOGNITION_PROVIDER = "http";
  process.env.RECOGNITION_URL = "https://reader.example.com/read";
  process.env.RECOGNITION_API_KEY = "secret-key";
  const calls = fakeFetch({ plate: "rj14ab1234", confidence: 91 });
  assert.deepEqual(await recognition.read(jpeg(), TYPE), { plate: "rj14ab1234", confidence: 91 });
  assert.equal(calls[0].url, "https://reader.example.com/read");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "image/jpeg");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-key");

  fakeFetch({ results: [{ plate: "low1", score: 0.3 }, { plate: "dl01ab0001", score: 0.97 }, { nothing: true }] });
  assert.deepEqual(await recognition.read(jpeg(), TYPE), { plate: "dl01ab0001", confidence: 0.97 });
  fakeFetch({ results: [] });
  assert.deepEqual(await recognition.read(jpeg(), TYPE), { plate: "" });
  fakeFetch("not an object");
  assert.deepEqual(await recognition.read(jpeg(), TYPE), { plate: "" });
});

test("platerecognizer sends a multipart upload with the token and regions", async () => {
  process.env.RECOGNITION_PROVIDER = "platerecognizer";
  process.env.RECOGNITION_API_KEY = "tok123";
  process.env.RECOGNITION_REGIONS = "in, us";
  delete process.env.RECOGNITION_URL;
  const calls = fakeFetch({ results: [{ plate: "rj14ab1234", score: 0.9, dscore: 0.8 }] });
  assert.deepEqual(await recognition.read(jpeg(), TYPE), { plate: "rj14ab1234", confidence: 0.9 });
  assert.equal(calls[0].url, "https://api.platerecognizer.com/v1/plate-reader/");
  assert.equal(calls[0].options.headers.Authorization, "Token tok123");
  const form = calls[0].options.body;
  assert.ok(form instanceof FormData);
  assert.ok(form.get("upload") instanceof Blob);
  assert.deepEqual(form.getAll("regions"), ["in", "us"]);
});

test("service failures become a safe 502 and never leak the key", async () => {
  process.env.RECOGNITION_PROVIDER = "http";
  process.env.RECOGNITION_URL = "https://reader.example.com/read";
  process.env.RECOGNITION_API_KEY = "very-secret";
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));

  fakeFetch({}, { ok: false, status: 500 });
  await assert.rejects(() => recognition.read(jpeg(), TYPE), (e) => e.statusCode === 502 && !/very-secret|500/.test(e.message));

  globalThis.fetch = async () => { throw new Error("connect ECONNREFUSED"); };
  await assert.rejects(() => recognition.read(jpeg(), TYPE), { statusCode: 502 });

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } });
  await assert.rejects(() => recognition.read(jpeg(), TYPE), { statusCode: 502 });
  assert.ok(logged.length >= 3);
  assert.ok(!logged.some((line) => line.includes("very-secret")));
});

test("a slow service is cut off by the timeout", async () => {
  process.env.RECOGNITION_PROVIDER = "http";
  process.env.RECOGNITION_URL = "https://reader.example.com/read";
  process.env.RECOGNITION_TIMEOUT_MS = "1000";
  console.error = () => {};
  globalThis.fetch = (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const started = Date.now();
  await assert.rejects(() => recognition.read(jpeg(), TYPE), { statusCode: 502 });
  assert.ok(Date.now() - started < 5000);
});

test("minimum confidence comes from the environment, with the ANPR default otherwise", () => {
  delete process.env.RECOGNITION_MIN_CONFIDENCE;
  assert.equal(recognition.minConfidence(), undefined);
  process.env.RECOGNITION_MIN_CONFIDENCE = "0.7";
  assert.equal(recognition.minConfidence(), 0.7);
  for (const bad of ["abc", "0", "2", "-1"]) {
    process.env.RECOGNITION_MIN_CONFIDENCE = bad;
    assert.equal(recognition.minConfidence(), undefined);
  }
});

test("readings are cleaned and judged by the same rules as camera readings", () => {
  const good = parseDetection({ plate: "rj14 ab-1234", confidence: 0.93 }, { minConfidence: recognition.minConfidence() });
  assert.equal(good.plate, "RJ14AB1234");
  assert.deepEqual(good.reviewReasons, []);
  const unsure = parseDetection({ plate: "RJ14AB1234", confidence: 0.4 });
  assert.equal(unsure.plate, "RJ14AB1234");
  assert.equal(unsure.reviewReasons.length, 1);
  const noConf = parseDetection({ plate: "RJ14AB1234" });
  assert.match(noConf.reviewReasons[0], /confidence/);
  assert.equal(parseDetection({ plate: "" }).plate, "");
  assert.equal(parseDetection({ plate: "??" }).plate, "");
});

test("startup refuses a bad recognition setup", () => {
  const { validateEnv } = require("../config/env");
  process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://x";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(40);
  delete process.env.PAYMENT_PROVIDER;
  process.env.RECOGNITION_PROVIDER = "magic";
  assert.throws(validateEnv, /RECOGNITION_PROVIDER/);
  process.env.RECOGNITION_PROVIDER = "simulated";
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "y".repeat(40);
  assert.throws(validateEnv, /simulated is for development only/);
  process.env.NODE_ENV = "test";
  process.env.RECOGNITION_PROVIDER = "http";
  delete process.env.RECOGNITION_URL;
  assert.throws(validateEnv, /RECOGNITION_URL/);
  process.env.RECOGNITION_URL = "https://reader.example.com/read";
  assert.doesNotThrow(validateEnv);
  process.env.RECOGNITION_PROVIDER = "none";
  assert.doesNotThrow(validateEnv);
});

test("a reading that is not the shape of an Indian plate is marked for checking, never refused", () => {
  const reasons = (plate) => parseDetection({ plate, confidence: 0.97 }).reviewReasons;
  for (const fine of ["MH12AB1234", "DL1CAB1234", "rj14 ab-1234", "MH12-AB-1", "KA53ND0249", "22BH1234AA"]) {
    assert.deepEqual(reasons(fine), [], fine);
  }
  for (const odd of ["KA53IND02497", "ABCD1234", "12345678", "KA5ND0249X"]) {
    const found = parseDetection({ plate: odd, confidence: 0.97 });
    assert.equal(found.plate, odd.toUpperCase(), "the plate is still kept");
    assert.match(found.reviewReasons.join(" "), /not the usual shape/, odd);
  }
});
