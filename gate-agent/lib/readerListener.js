// Tag readers: UHF / RFID readers and FASTag readers. Reads arrive from the reader
// (or from software that comes with it), are cleaned up here and forwarded to the
// cloud with the device's key. Reads are kept in memory and retried for a few minutes
// when the internet is down.
//
// Where the reads come from (device.driver):
//   listener   the reader or its software POSTs JSON to this PC:  http://<agent-pc>:<port><path>
//              RFID:    { "tag": "E2006806AB" }                    port 8082, path /rfid
//              FASTag:  { "plate": "MH12AB1234", "tagId": "..." }  port 8083, path /fastag
//   tcp        the reader sends one read per line on a TCP port (options: host, port)
//   serial     the reader sends one read per line on a COM port (options: path, baudRate;
//              needs:  npm install serialport)
//   simulated  nothing is read; use  node simulate.js tag|fastag  to try the flow
//
// A UHF reader sees the same tag many times a second. Reads of the same tag within
// options.debounceMs (default 5000) are ignored here; the server also merges repeats.
// Line format: RFID: the tag number. FASTag: "tagId,plate", or a JSON object.

const http = require("http");
const net = require("net");
const { createClient } = require("./api");
const log = require("./log");

const MAX_QUEUE = 200;
const MAX_AGE_MS = 5 * 60 * 1000;

const pick = (object, names) => {
  for (const name of names) {
    if (object && object[name] !== undefined && object[name] !== null && object[name] !== "") return object[name];
  }
  return undefined;
};

const asNumber = (value) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

const common = (body) => {
  const time = pick(body, ["capturedAt", "timestamp", "time", "dateTime"]);
  const date = time ? new Date(time) : undefined;
  const eventId = pick(body, ["eventId", "event_id", "id", "uuid"]);
  return {
    ...(eventId === undefined ? {} : { eventId: String(eventId) }),
    ...(date && !Number.isNaN(date.getTime()) ? { capturedAt: date.toISOString() } : {}),
    ...(pick(body, ["direction"]) ? { direction: String(pick(body, ["direction"])).toUpperCase() } : {}),
  };
};

// What the reader posted -> what the cloud endpoint takes.
const translators = {
  rfid: (body) => {
    const tag = pick(body, ["tag", "tagId", "tag_id", "epc", "EPC", "rfid", "uid", "card", "cardNo"]);
    if (tag === undefined) throw new Error("No tag number in the reader's message");
    return { tag: String(tag), ...common(body) };
  },
  fastag: (body) => {
    const plate = pick(body, ["plate", "vehicleNumber", "vehicle_number", "vehicleNo", "regNo"]);
    const tagId = pick(body, ["tagId", "tag_id", "tid", "TID", "epc", "tag"]);
    if (plate === undefined && tagId === undefined) throw new Error("No vehicle number or tag in the reader's message");
    const confidence = asNumber(pick(body, ["confidence", "score"]));
    return {
      ...(plate === undefined ? {} : { plate: String(plate) }),
      ...(tagId === undefined ? {} : { tagId: String(tagId) }),
      ...(confidence === undefined ? {} : { confidence }),
      ...common(body),
    };
  },
};

// One line from a serial / TCP reader.
const parseLine = (kind, line) => {
  const text = line.trim();
  if (!text) return null;
  if (text.startsWith("{")) return JSON.parse(text);
  if (kind === "rfid") return { tag: text };
  const [tagId, plate] = text.split(",").map((part) => part.trim());
  return plate === undefined ? { plate: tagId } : { tagId, plate };
};

const DEFAULTS = {
  rfid: { port: 8082, path: "/rfid" },
  fastag: { port: 8083, path: "/fastag" },
};

class ReaderListener {
  constructor({ serverUrl, device, kind, client }) {
    if (!translators[kind]) throw new Error(`Unknown reader kind "${kind}"`);
    this.kind = kind;
    this.device = device;
    this.options = { ...DEFAULTS[kind], debounceMs: 5000, ...(device.options || {}) };
    this.api = client || createClient({ serverUrl, key: device.key });
    this.log = log.make(device.name);
    this.queue = [];
    this.seen = new Map(); // read key -> time, for the debounce
    this.server = null;
    this.socket = null;
    this.port = null;
    this.timer = null;
    this.stopped = false;
  }

  // Translates and queues one read. Returns the payload, or null when it was a repeat.
  accept(body, now = Date.now()) {
    const payload = translators[this.kind](body);
    if (this.options.direction && !payload.direction) payload.direction = this.options.direction;

    const key = `${this.kind}:${(payload.tag || payload.tagId || "").toUpperCase()}:${(payload.plate || "").toUpperCase()}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.options.debounceMs) return null;
    this.seen.set(key, now);
    if (this.seen.size > 500) {
      for (const [k, t] of this.seen) if (now - t > this.options.debounceMs) this.seen.delete(k);
    }

    this.queue.push({ payload, receivedAt: now });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    return payload;
  }

  send(payload) {
    return this.kind === "rfid" ? this.api.rfid(payload) : this.api.fastag(payload);
  }

  // Only one flush runs at a time (two quick reads must not both send the first one).
  async flush() {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        await this.drain();
      } while (this.flushAgain);
    } finally {
      this.flushing = false;
    }
  }

  async drain() {
    while (this.queue.length) {
      const item = this.queue[0];
      if (Date.now() - item.receivedAt > MAX_AGE_MS) {
        this.queue.shift();
        this.log.warn("dropped an old tag read (could not reach the server for 5 minutes)");
        continue;
      }
      try {
        const result = await this.send(item.payload);
        this.queue.shift();
        if (result && result.known === false) this.log.warn(`tag ${item.payload.tag} is not on any pass`);
        else {
          this.log.info(
            `${this.kind} ${result.plate || item.payload.tag || "(no number)"} -> ${result.duplicate ? "duplicate" : "new suggestion"}` +
              (result.needsReview ? ` [needs review: ${result.reviewReasons.join("; ")}]` : "")
          );
        }
      } catch (error) {
        // The server refused it (bad data): throw it away. Otherwise keep it for later.
        if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
          this.queue.shift();
          this.log.error(`server rejected a ${this.kind} read: ${error.message}`);
          continue;
        }
        this.log.warn(`could not send a ${this.kind} read: ${error.message} (kept ${this.queue.length} for retry)`);
        return;
      }
    }
  }

  acceptLine(line) {
    try {
      const body = parseLine(this.kind, line);
      if (body && this.accept(body)) this.flush().catch(() => {});
    } catch (error) {
      this.log.warn(`could not read a line from the reader: ${error.message}`);
    }
  }

  handleRequest(req, res) {
    const url = new URL(req.url, "http://localhost");
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || url.pathname !== this.options.path) return reply(404, { ok: false });
    if (this.options.secret && url.searchParams.get("secret") !== this.options.secret) return reply(401, { ok: false });

    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const payload = this.accept(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        if (payload) this.flush().catch(() => {});
        reply(202, { ok: true, repeat: !payload });
      } catch (error) {
        this.log.warn(`bad reader request: ${error.message}`);
        reply(400, { ok: false, message: error.message });
      }
    });
  }

  // Splits a stream of bytes into lines and hands each to acceptLine.
  lineReader() {
    let rest = "";
    return (chunk) => {
      rest += chunk.toString("utf8");
      if (rest.length > 8192) rest = rest.slice(-1024); // a reader that never ends a line
      const lines = rest.split(/\r\n|\n|\r/);
      rest = lines.pop();
      lines.forEach((line) => this.acceptLine(line));
    };
  }

  connectTcp() {
    if (this.stopped) return;
    const { host, port } = this.options;
    if (!host || !port) {
      this.log.error("tcp reader needs options.host and options.port");
      return;
    }
    const onData = this.lineReader();
    const socket = net.createConnection({ host, port }, () => this.log.info(`connected to the reader at ${host}:${port}`));
    this.socket = socket;
    socket.on("data", onData);
    socket.on("error", (error) => this.log.warn(`reader connection: ${error.message}`));
    socket.on("close", () => {
      if (this.stopped) return;
      const retry = setTimeout(() => this.connectTcp(), 5000);
      retry.unref();
      this.retryTimer = retry;
    });
  }

  openSerial() {
    let SerialPort;
    try {
      ({ SerialPort } = require("serialport"));
    } catch {
      this.log.error("The serial driver needs the 'serialport' package: run  npm install serialport  in gate-agent");
      return;
    }
    const port = new SerialPort({ path: this.options.path, baudRate: this.options.baudRate || 9600 }, (error) => {
      if (error) this.log.error(`could not open ${this.options.path}: ${error.message}`);
      else this.log.info(`reading from ${this.options.path}`);
    });
    port.on("data", this.lineReader());
    port.on("error", (error) => this.log.warn(`serial reader: ${error.message}`));
    this.socket = port;
  }

  start() {
    this.stopped = false;
    const driver = this.device.driver || "simulated";
    if (driver === "listener") {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.options.port, () => {
        this.port = this.server.address().port;
        this.log.info(`listening for ${this.kind} reads on port ${this.port}${this.options.path}`);
      });
    } else if (driver === "tcp") this.connectTcp();
    else if (driver === "serial") this.openSerial();
    else if (driver === "simulated") this.log.info(`simulated ${this.kind} reader: use  node simulate.js ${this.kind}  to send a read`);
    else throw new Error(`Unknown reader driver "${driver}". Use one of: listener, tcp, serial, simulated`);
    this.timer = setInterval(() => this.flush().catch(() => {}), 5000);
    this.timer.unref();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    if (this.server) this.server.close();
    if (this.socket) (this.socket.destroy || this.socket.close).call(this.socket);
  }
}

module.exports = { ReaderListener, translators, parseLine };
