#!/usr/bin/env node
// Pretends to be a camera so the whole flow can be tried without hardware.
//
//   node simulate.js plate --key hwk_... --plate MH12AB1234 [--confidence 0.93]
//                          [--direction ENTRY|EXIT] [--server http://localhost:5000]
//                          [--repeat 3] [--event-id abc] [--image https://...]
//   node simulate.js plate --device "Gate 1 camera"     (reads key/server from config.json)
//   node simulate.js plate --random                     (a made-up plate)
//   node simulate.js heartbeat --key hwk_...
//   node simulate.js tag --device "Gate 1 RFID" --tag E2006806AB [--direction ENTRY|EXIT] [--repeat N]
//   node simulate.js fastag --device "Gate 1 FASTag" --plate MH12AB1234 [--tag-id 34161FA8...] [--direction ENTRY|EXIT]
//
// Barrier, printer and CCTV need no simulator: give them  "driver": "simulated"  in
// config.json and run agent.js; it logs every barrier pulse, saves every printed slip
// into ./printed/ and files a tiny grey picture as the CCTV snapshot.

const fs = require("fs");
const { createClient } = require("./lib/api");

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const name = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[name] = true;
      else {
        args[name] = next;
        i += 1;
      }
    } else args._.push(argv[i]);
  }
  return args;
};

const randomPlate = () => {
  const letters = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
  return `${["MH", "DL", "KA", "RJ", "GJ", "TN"][Math.floor(Math.random() * 6)]}${digits(2)}${letters()}${letters()}${digits(4)}`;
};

const resolve = (args) => {
  let { key, server } = args;
  if (args.device) {
    const config = JSON.parse(fs.readFileSync(typeof args.config === "string" ? args.config : "config.json", "utf8"));
    const device = config.devices.find((d) => d.name === args.device);
    if (!device) throw new Error(`No device named "${args.device}" in config.json`);
    key = key || device.key;
    server = server || config.serverUrl;
  }
  if (!key) throw new Error("Give --key hwk_... or --device NAME");
  return { client: createClient({ serverUrl: server || "http://localhost:5000", key }) };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const [command] = args._;
  if (!["plate", "heartbeat", "tag", "fastag"].includes(command)) {
    console.log("Usage: node simulate.js plate|heartbeat|tag|fastag --key hwk_... [--plate ABC1234] [--tag E2006806AB] [--confidence 0.93] [--direction ENTRY] [--repeat N]");
    process.exit(command ? 1 : 0);
  }
  const { client } = resolve(args);

  if (command === "heartbeat") {
    console.log(JSON.stringify(await client.heartbeat(), null, 2));
    return;
  }

  if (command === "tag" || command === "fastag") {
    const times = Math.max(1, Number(args.repeat) || 1);
    for (let i = 0; i < times; i += 1) {
      const common = {
        ...(args.direction ? { direction: String(args.direction).toUpperCase() } : {}),
        ...(args["event-id"] ? { eventId: String(args["event-id"]) } : {}),
        capturedAt: new Date().toISOString(),
      };
      let result;
      if (command === "tag") {
        if (args.tag === undefined || args.tag === true) throw new Error("Give --tag E2006806AB");
        result = await client.rfid({ tag: String(args.tag), ...common });
      } else {
        const plate = args.random ? randomPlate() : args.plate === undefined ? "" : String(args.plate);
        result = await client.fastag({
          ...(plate ? { plate } : {}),
          ...(args["tag-id"] ? { tagId: String(args["tag-id"]) } : {}),
          ...common,
        });
      }
      console.log(`#${i + 1}`, JSON.stringify(result));
    }
    return;
  }

  const plate = args.random ? randomPlate() : args.plate === undefined ? "" : String(args.plate);
  const repeat = Math.max(1, Number(args.repeat) || 1);
  for (let i = 0; i < repeat; i += 1) {
    const result = await client.plate({
      plate,
      ...(args.confidence !== undefined ? { confidence: Number(args.confidence) } : { confidence: 0.95 }),
      ...(args.direction ? { direction: String(args.direction).toUpperCase() } : {}),
      ...(args["event-id"] ? { eventId: String(args["event-id"]) } : {}),
      ...(args.image ? { imageUrl: String(args.image) } : {}),
      capturedAt: new Date().toISOString(),
    });
    console.log(`#${i + 1}`, JSON.stringify(result));
  }
};

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
