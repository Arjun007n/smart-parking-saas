// The gate agent download: the zip writer, and what goes in the package (and what never does).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { crc32 } = require("../utils/zip");
const agentPackage = require("../services/agentPackage");
const { createZip } = agentPackage;

// A reader for our own zips: walks the central directory, inflates each file and checks its CRC.
const readZip = (buffer) => {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory");
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(pos), 0x02014b50);
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const packed = buffer.readUInt32LE(pos + 20);
    const size = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const offset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    const localName = buffer.readUInt16LE(offset + 26);
    const start = offset + 30 + localName + buffer.readUInt16LE(offset + 28);
    const body = buffer.subarray(start, start + packed);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.equal(data.length, size, `${name} size`);
    assert.equal(crc32(data), crc, `${name} crc`);
    files[name] = data.toString("utf8");
    pos += 46 + nameLength;
  }
  return files;
};

test("crc32 matches the known check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("a zip round-trips text files, compressed or stored, with names and content intact", () => {
  const big = "line of text\n".repeat(500);
  const zip = createZip([
    { name: "a.txt", data: "hello" },
    { name: "dir/big.js", data: big },
    { name: "dir/ünï.txt", data: "unicode name" },
    { name: "empty.txt", data: "" },
  ]);
  const files = readZip(zip);
  assert.deepEqual(Object.keys(files).sort(), ["a.txt", "dir/big.js", "dir/ünï.txt", "empty.txt"]);
  assert.equal(files["a.txt"], "hello");
  assert.equal(files["dir/big.js"], big);
  assert.equal(files["empty.txt"], "");
  assert.ok(zip.length < big.length, "repeated text is compressed");
  const moment = new Date(2026, 9, 5, 10, 0, 0);
  assert.deepEqual(createZip([{ name: "a.txt", data: "hello" }], moment), createZip([{ name: "a.txt", data: "hello" }], moment), "same input, same bytes");
});

test("a zip refuses names that could write outside the folder", () => {
  for (const name of ["../x", "/etc/passwd", "a/../b", "a\\b", "", "a//b"]) {
    assert.throws(() => createZip([{ name, data: "x" }]), /Unsafe file name/, name);
  }
});

const makeAgentFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-"));
  const put = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  };
  put("agent.js", "console.log('agent')");
  put("package.json", "{\"name\":\"gate-agent\"}");
  put("config.example.json", JSON.stringify({ serverUrl: "http://localhost:5000", devices: [{ name: "Gate 1", key: "hwk_PASTE" }] }));
  put("config.json", JSON.stringify({ devices: [{ key: "hwk_REAL_SECRET_KEY" }] }));
  put("lib/worker.js", "module.exports = 1");
  put("tests/agent.test.js", "test");
  put("printed/slip-1.txt", "a printed ticket");
  put("node_modules/x/index.js", "x");
  put("old.bak", "backup");
  return dir;
};

test("the package has the agent, a ready config with this server's address, and start files", () => {
  const dir = makeAgentFolder();
  process.env.GATE_AGENT_DIR = dir;
  try {
    assert.equal(agentPackage.isAvailable(), true);
    const built = agentPackage.build({ serverUrl: "https://parking.example.com" });
    assert.equal(built.name, "gate-agent.zip");
    const files = readZip(built.data);
    const names = Object.keys(files);
    for (const wanted of ["agent.js", "package.json", "lib/worker.js", "config.example.json", "config.json", "start-agent.bat", "start-agent.sh", "INSTALL.txt"]) {
      assert.ok(names.includes(`gate-agent/${wanted}`), wanted);
    }
    const config = JSON.parse(files["gate-agent/config.json"]);
    assert.equal(config.serverUrl, "https://parking.example.com");
    assert.equal(config.devices[0].key, "hwk_PASTE", "the config has placeholders, never real keys");
    assert.match(files["gate-agent/INSTALL.txt"], /https:\/\/parking\.example\.com/);
    assert.match(files["gate-agent/start-agent.bat"], /node agent\.js/);
    assert.ok(files["gate-agent/start-agent.bat"].includes("\r\n"));
  } finally {
    delete process.env.GATE_AGENT_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the package leaves out tests, printed slips, installed packages, backups and the local config's secrets", () => {
  const dir = makeAgentFolder();
  process.env.GATE_AGENT_DIR = dir;
  try {
    const built = agentPackage.build({ serverUrl: "http://localhost:5000" });
    const files = readZip(built.data);
    const names = Object.keys(files);
    for (const unwanted of ["tests/", "printed/", "node_modules/", "old.bak"]) {
      assert.ok(!names.some((n) => n.includes(unwanted)), unwanted);
    }
    assert.ok(!Object.values(files).some((text) => text.includes("hwk_REAL_SECRET_KEY")), "no real device key leaves the folder");
  } finally {
    delete process.env.GATE_AGENT_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("without the agent folder, the download says so", () => {
  process.env.GATE_AGENT_DIR = path.join(os.tmpdir(), "no-such-agent-folder");
  try {
    assert.equal(agentPackage.isAvailable(), false);
    assert.throws(() => agentPackage.build({ serverUrl: "http://x" }), (error) => error.status === 404 && /gate-agent folder/.test(error.message));
  } finally {
    delete process.env.GATE_AGENT_DIR;
  }
});

test("the real gate-agent folder of this project packages without its tests or a config.json of its own", () => {
  if (!agentPackage.isAvailable()) return;
  const files = readZip(agentPackage.build({ serverUrl: "http://localhost:5000" }).data);
  const names = Object.keys(files);
  assert.ok(names.includes("gate-agent/agent.js"));
  assert.ok(!names.some((n) => n.includes("/tests/")));
  assert.ok(JSON.parse(files["gate-agent/config.json"]).devices.length > 0);
});
