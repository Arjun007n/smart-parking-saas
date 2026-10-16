#!/usr/bin/env node
// Smart Parking gate agent. Run it on a PC or Raspberry Pi at the parking
// location:   node agent.js [path/to/config.json]
//
// It connects OUTWARD to the cloud, so no router ports need opening.

const fs = require("fs");
const path = require("path");
const { DeviceWorker } = require("./lib/worker");
const { AnprListener } = require("./lib/anprListener");
const { ReaderListener } = require("./lib/readerListener");
const { PreviewRelay, normalize: normalizePreview } = require("./lib/previewRelay");
const { checkServerUrl } = require("./lib/api");
const log = require("./lib/log").make("agent");

const loadConfig = (file) => {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    throw new Error(`Config file not found: ${full}\nCopy config.example.json to config.json and fill in your device keys.`);
  }
  const config = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!config.serverUrl) throw new Error("config.json needs serverUrl");
  checkServerUrl(config.serverUrl);
  if (!Array.isArray(config.devices) || !config.devices.length) throw new Error("config.json needs at least one device");
  config.devices.forEach((device, i) => {
    if (!device.name || !device.type) throw new Error(`devices[${i}] needs a name and a type`);
    if (!device.key || !device.key.startsWith("hwk_") || device.key.includes("PASTE")) {
      throw new Error(`devices[${i}] ("${device.name}") has no real key. Use the key shown when the device was added.`);
    }
  });
  config.devices.forEach((device, i) => {
    if (device.preview === undefined) return;
    if (device.type !== "ANPR_CAMERA") throw new Error(`devices[${i}] ("${device.name}"): "preview" is only for an ANPR_CAMERA`);
    normalizePreview(device.preview, `devices[${i}] ("${device.name}") preview`);
  });
  return config;
};

const build = (config) => {
  const parts = [];
  for (const device of config.devices) {
    // A camera with a "preview" block gets its live picture served by this agent (see lib/previewRelay.js).
    const relay = device.type === "ANPR_CAMERA" && device.preview ? new PreviewRelay({ device, options: { previewOrigins: config.previewOrigins, ...device.preview } }) : null;
    parts.push(new DeviceWorker({
      serverUrl: config.serverUrl, device, pollMs: config.pollMs, heartbeatMs: config.heartbeatMs, instant: config.instantWake !== false,
      ...(relay ? { previewUrl: relay.url } : {}),
    }));
    if (relay) parts.push(relay);
    if (device.type === "ANPR_CAMERA" && device.driver === "listener") {
      parts.push(new AnprListener({ serverUrl: config.serverUrl, device }));
    }
    if (device.type === "RFID_READER") parts.push(new ReaderListener({ serverUrl: config.serverUrl, device, kind: "rfid" }));
    if (device.type === "FASTAG_READER") parts.push(new ReaderListener({ serverUrl: config.serverUrl, device, kind: "fastag" }));
  }
  return parts;
};

if (require.main === module) {
  try {
    const config = loadConfig(process.argv[2] || "config.json");
    const parts = build(config);
    parts.forEach((part) => part.start());
    log.info(`running ${config.devices.length} device(s) against ${config.serverUrl}`);

    const stop = () => {
      log.info("stopping");
      parts.forEach((part) => part.stop());
      setTimeout(() => process.exit(0), 200).unref();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { loadConfig, build };
