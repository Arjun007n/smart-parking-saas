// Shared setup for API tests that need MongoDB.
require("dotenv").config({ quiet: true });

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret-0123456789abcdef";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.API_RATE_LIMIT_MAX = process.env.API_RATE_LIMIT_MAX || "100000";
process.env.APP_UTC_OFFSET_MINUTES = "330";

const test = require("node:test");
const assert = require("node:assert/strict");
const dns = require("dns");
const mongoose = require("mongoose");

const TEST_URI = process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/smart_parking_test";

const app = require("../app");

const state = { server: null, baseUrl: null, skipReason: null };

const api = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(`${state.baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

// A raw request: any method, headers and body text; returns status, headers and text.
const send = async (method, path, { headers = {}, body } = {}) => {
  const res = await fetch(`${state.baseUrl}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

// Sends and receives raw bytes (photo upload and download); returns status, headers and a Buffer.
const bytes = async (method, path, { token, headers = {}, body } = {}) => {
  const res = await fetch(`${state.baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body,
  });
  return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
};

// For answers that are not JSON (CSV downloads).
const raw = async (path, token) => {
  const res = await fetch(`${state.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, type: res.headers.get("content-type") || "", disposition: res.headers.get("content-disposition") || "", text: await res.text() };
};

// Registers a company and returns { token, user, company, permissions }.
const registerCompany = async (tag) => {
  const res = await api("POST", "/api/auth/register", {
    body: {
      companyName: `Company ${tag}`, name: `Admin ${tag}`,
      email: `admin-${tag}@example.com`, password: "Password123",
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
};

const login = async (email, password = "Password123") => {
  const res = await api("POST", "/api/auth/login", { body: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.token;
};

// Connects to the test database, empties it and starts the API.
const setup = () => {
  test.before(async () => {
    const dbName = new URL(TEST_URI.replace(/^mongodb(\+srv)?:/, "http:")).pathname.slice(1);
    if (!dbName.endsWith("_test")) {
      throw new Error(`Refusing to run: test database "${dbName}" must end with "_test"`);
    }
    if (TEST_URI.startsWith("mongodb+srv")) dns.setServers(["8.8.8.8", "1.1.1.1"]);
    try {
      await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 4000 });
    } catch (error) {
      state.skipReason = `MongoDB not reachable at MONGO_URI_TEST (${error.message})`;
      console.warn(`\n*** API TESTS SKIPPED: ${state.skipReason} ***\n`);
      return;
    }
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    await new Promise((resolve) => { state.server = app.listen(0, resolve); });
    state.baseUrl = `http://127.0.0.1:${state.server.address().port}`;
  });

  test.after(async () => {
    if (state.server) await new Promise((resolve) => state.server.close(resolve));
    await mongoose.disconnect();
  });
};

// A test that is reported as skipped when there is no database.
const it = (name, fn) => test(name, async (t) => (state.skipReason ? t.skip(state.skipReason) : fn(t)));

module.exports = { setup, it, api, raw, send, bytes, registerCompany, login, assert };
