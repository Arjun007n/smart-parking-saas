// The gate agent as a downloadable zip: the agent's own files plus a ready config.json (with this
// server's address already filled in, but no device keys), a Windows start file that restarts the
// agent if it stops, and a short install note. Built from the gate-agent folder next to the server;
// when the server is deployed without it, the download says so instead of failing oddly.

const fs = require("fs");
const path = require("path");
const { zip } = require("../utils/zip");

// Names inside the zip: plain relative paths only, so nothing can write outside the unzipped folder.
const safeName = (name) => {
  if (typeof name !== "string" || !name || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Unsafe file name in zip: ${name}`);
  }
  return name;
};
const createZip = (files, now) => zip(files.map((f) => ({ name: safeName(f.name), data: f.data })), now);

const AGENT_DIR = () => path.resolve(process.env.GATE_AGENT_DIR || path.join(__dirname, "..", "..", "gate-agent"));

// Never handed out: tests, a local config (it holds device keys), printed slips, installed packages.
const SKIP_DIRS = new Set(["node_modules", "tests", "printed", ".git"]);
const SKIP_FILES = new Set(["config.json", ".DS_Store", "Thumbs.db", "desktop.ini"]);
const MAX_FILES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const walk = (root, dir = "", found = []) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, relative, found);
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name) && !entry.name.endsWith(".bak")) {
      found.push(relative);
    }
    if (found.length > MAX_FILES) throw new Error("The gate agent folder has too many files");
  }
  return found;
};

const isAvailable = () => {
  const dir = AGENT_DIR();
  return fs.existsSync(path.join(dir, "agent.js")) && fs.existsSync(path.join(dir, "package.json"));
};

const START_BAT = [
  "@echo off",
  "rem Starts the gate agent and starts it again if it stops. Close this window to stop it.",
  "cd /d \"%~dp0\"",
  ":again",
  "node agent.js",
  "echo The agent stopped. Starting again in 5 seconds (close this window to stop).",
  "timeout /t 5 /nobreak >nul",
  "goto again",
  "",
].join("\r\n");

const START_SH = [
  "#!/bin/sh",
  "# Starts the gate agent and starts it again if it stops. Press Ctrl+C to stop it.",
  "cd \"$(dirname \"$0\")\"",
  "while true; do",
  "  node agent.js",
  "  echo \"The agent stopped. Starting again in 5 seconds (Ctrl+C to stop).\"",
  "  sleep 5",
  "done",
  "",
].join("\n");

const installNote = (serverUrl) => [
  "SMART PARKING GATE AGENT",
  "========================",
  "",
  "1. Install Node.js 20 or newer on the gate PC (https://nodejs.org). Nothing else is needed",
  "   for the simulated drivers; a serial-port barrier also needs:  npm install serialport",
  "",
  "2. Open config.json in this folder and paste the device key of each device. Add the devices",
  "   first in the dashboard: Hardware > Add device. Each key is shown once when the device is added.",
  "   Set \"driver\" to the real driver of each device (see README.md); \"simulated\" only pretends.",
  "",
  `   This server's address is already filled in:  ${serverUrl}`,
  "",
  "3. Start it:",
  "     Windows:   double-click start-agent.bat",
  "     Linux/Pi:  sh start-agent.sh",
  "   The device then shows as online on the dashboard's Hardware page within a minute.",
  "",
  "4. To start it automatically when the PC starts, put a shortcut to start-agent.bat in the",
  "   Startup folder (press Win+R, type shell:startup).",
  "",
  "5. Live camera picture on the Entry and Exit screens: add a \"preview\" block to the ANPR camera in",
  "   config.json (the camera's stream or still-picture address; see README.md, \"Live camera picture\").",
  "   The agent then shows it on this PC; no address needs to be pasted on the Hardware page.",
  "",
  "The agent only makes outgoing connections. No port needs to be opened on the PC's router.",
  "Do not share config.json: it holds the device keys.",
  "",
].join("\r\n");

// Returns { name, data } for the download. Throws an error with .status 404 when the folder is missing.
const build = ({ serverUrl }) => {
  if (!isAvailable()) {
    throw Object.assign(new Error("The gate agent files are not on this server. Copy the gate-agent folder from the project instead."), { status: 404 });
  }
  const root = AGENT_DIR();
  const files = [];
  for (const relative of walk(root).sort()) {
    const full = path.join(root, relative);
    const stat = fs.statSync(full);
    if (stat.size > MAX_FILE_BYTES) continue;
    let data = fs.readFileSync(full);
    if (relative === "config.example.json") {
      // The example becomes config.json with this server's address; the example stays for reference.
      try {
        const config = JSON.parse(data.toString("utf8"));
        config.serverUrl = serverUrl;
        files.push({ name: "config.json", data: `${JSON.stringify(config, null, 2)}\n` });
      } catch {
        // An unreadable example is still handed out as it is.
      }
    }
    files.push({ name: relative, data });
  }
  files.push({ name: "start-agent.bat", data: START_BAT });
  files.push({ name: "start-agent.sh", data: START_SH, executable: true });
  files.push({ name: "INSTALL.txt", data: installNote(serverUrl) });
  return { name: "gate-agent.zip", data: createZip(files.map((f) => ({ ...f, name: `gate-agent/${f.name}` }))) };
};

module.exports = { AGENT_DIR, isAvailable, build, createZip };
