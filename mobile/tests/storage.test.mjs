// The phone app's token storage (client/src/native/storage.js): in a release app a failing secure storage must NOT
// fall back to localStorage; in test mode (http://localhost pages) and in a normal browser it still does.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The client's source imports files without ".js" (Vite style). Let Node find them, and give every test its own copy
// of platform.js and storage.js (the query string of the importing file is passed on).
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\\.\\w+$/.test(specifier)) specifier += '.js';
  const result = await next(specifier, context);
  const query = context.parentURL ? new URL(context.parentURL).search : '';
  return query && result.url.includes('/client/src/native/') ? { ...result, url: result.url.split('?')[0] + query } : result;
}`),
);

const STORAGE = new URL("../../client/src/native/storage.js", import.meta.url).href;
let counter = 0;

// Loads storage.js as the phone app (or a browser) would see it.
//   native  - inside the phone app?   protocol - the page's address scheme   securePlugin - what the secure storage does
const load = async ({ native = true, protocol = "https:", securePlugin = "fails" }) => {
  const local = new Map();
  globalThis.localStorage = {
    getItem: (k) => (local.has(k) ? local.get(k) : null),
    setItem: (k, v) => void local.set(k, String(v)),
    removeItem: (k) => void local.delete(k),
  };
  globalThis.location = { protocol };
  const secureData = new Map();
  const plugin = {
    get: async ({ key }) => {
      if (securePlugin === "fails") throw new Error("keystore down");
      if (!secureData.has(key)) throw new Error("Item with given key does not exist");
      return { value: secureData.get(key) };
    },
    set: async ({ key, value }) => {
      if (securePlugin === "fails") throw new Error("keystore down");
      secureData.set(key, value);
    },
    remove: async ({ key }) => void secureData.delete(key),
  };
  globalThis.window = native
    ? { Capacitor: { isNativePlatform: () => true, registerPlugin: () => plugin } }
    : { Capacitor: undefined };
  const module = await import(`${STORAGE}?t=${++counter}`);
  return { ...module, local, secureData };
};

test("release app: secure storage works -> the token is kept there and not in localStorage", async () => {
  const s = await load({ securePlugin: "works" });
  await s.saveSecret("sp_token", "abc");
  assert.equal(s.secureData.get("sp_token"), "abc");
  assert.equal(s.local.has("sp_token"), false);
  assert.equal(await s.loadSecret("sp_token"), "abc");
});

test("release app: secure storage fails -> the token is never written to localStorage", async () => {
  const s = await load({ securePlugin: "fails", protocol: "https:" });
  await s.saveSecret("sp_token", "abc");
  assert.equal(s.local.size, 0, "nothing was saved in localStorage");
  assert.equal(await s.loadSecret("sp_token"), null, "so the next start is signed out");
});

test("release app: a token left in localStorage by an older version is not used and is removed", async () => {
  const s = await load({ securePlugin: "fails", protocol: "https:" });
  s.local.set("sp_token", "old-token");
  assert.equal(await s.loadSecret("sp_token"), null);
  assert.equal(s.local.has("sp_token"), false);
});

test("test mode (page on http://localhost): the localStorage fallback still works", async () => {
  const s = await load({ securePlugin: "fails", protocol: "http:" });
  await s.saveSecret("sp_token", "abc");
  assert.equal(s.local.get("sp_token"), "abc");
  assert.equal(await s.loadSecret("sp_token"), "abc");
  await s.removeSecret("sp_token");
  assert.equal(s.local.has("sp_token"), false);
});

test("normal browser: not affected (storage.js is only used by the phone app, but it still falls back)", async () => {
  const s = await load({ native: false, protocol: "https:" });
  await s.saveSecret("sp_token", "abc");
  assert.equal(s.local.get("sp_token"), "abc");
  assert.equal(await s.loadSecret("sp_token"), "abc");
});
