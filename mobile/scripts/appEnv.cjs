// Reads mobile/app.env (KEY=value lines) and the environment. The environment wins.
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

const parseEnvText = (text) => {
  const values = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
};

const readAppEnv = (root, environment = process.env) => {
  const file = path.join(root, "app.env");
  const fromFile = existsSync(file) ? parseEnvText(readFileSync(file, "utf8")) : {};
  const pick = (key) => (environment[key] !== undefined && environment[key] !== "" ? environment[key] : fromFile[key]);
  return { API_URL: pick("API_URL"), APP_DEV: pick("APP_DEV") };
};

// The server address the app will call, checked. Returns { api, dev } or throws a message for the person.
const checkApiUrl = ({ API_URL, APP_DEV }) => {
  const dev = APP_DEV === "1";
  const api = String(API_URL || "").trim().replace(/\/+$/, "");
  if (!api) throw new Error("API_URL is not set. Copy app.env.example to app.env and put your server address in it.");
  if (/\/api$/i.test(api)) throw new Error("API_URL must not end with /api (the app adds it). Use the server's address only.");
  if (!/^https?:\/\/[^\s/]+$/i.test(api) && !/^https?:\/\/[^\s/]+:\d+$/i.test(api)) throw new Error(`API_URL "${api}" is not a web address like https://api.your-site.example`);
  if (!dev && !api.startsWith("https://")) {
    throw new Error("API_URL must start with https:// for a real app. A plain http address is only for testing: set APP_DEV=1 in app.env.");
  }
  if (!dev && /(^https?:\/\/)(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(api)) {
    throw new Error("API_URL points to a private address. A real app needs your public https server address (or set APP_DEV=1 for testing).");
  }
  return { api, dev };
};

module.exports = { parseEnvText, readAppEnv, checkApiUrl };
