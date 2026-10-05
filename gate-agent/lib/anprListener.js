// Receives plate events from a camera on the local network and forwards them
// to the cloud with the camera's key. Events are held in memory and retried
// for a few minutes when the internet is down.

const http = require("http");
const { createClient } = require("./api");
const { translate } = require("./translators");
const log = require("./log");

const MAX_QUEUE = 200;
const MAX_AGE_MS = 5 * 60 * 1000;

class AnprListener {
  constructor({ serverUrl, device, client }) {
    this.device = device;
    this.options = { port: 8081, path: "/anpr", vendor: "generic", ...(device.options || {}) };
    this.api = client || createClient({ serverUrl, key: device.key });
    this.log = log.make(device.name);
    this.queue = [];
    this.server = null;
    this.timer = null;
  }

  // Translates and queues one camera event. Returns the standard detection.
  accept(body) {
    const detection = translate(this.options.vendor, body);
    if (this.options.direction && !detection.direction) detection.direction = this.options.direction;
    this.queue.push({ detection, receivedAt: Date.now() });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    return detection;
  }

  async flush() {
    while (this.queue.length) {
      const item = this.queue[0];
      if (Date.now() - item.receivedAt > MAX_AGE_MS) {
        this.queue.shift();
        this.log.warn("dropped an old plate event (could not reach the server for 5 minutes)");
        continue;
      }
      try {
        const result = await this.api.plate(item.detection);
        this.queue.shift();
        this.log.info(
          `plate ${item.detection.plate || "(unread)"} -> ${result.duplicate ? "duplicate" : "new suggestion"}` +
            (result.needsReview ? ` [needs review: ${result.reviewReasons.join("; ")}]` : "")
        );
      } catch (error) {
        // The server refused it (bad data): throw it away. Otherwise keep it for later.
        if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
          this.queue.shift();
          this.log.error(`server rejected a plate event: ${error.message}`);
          continue;
        }
        this.log.warn(`could not send plate event: ${error.message} (kept ${this.queue.length} for retry)`);
        return;
      }
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
      if (size > 1024 * 1024) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const detection = this.accept(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        this.flush().catch(() => {});
        reply(202, { ok: true, plate: detection.plate });
      } catch (error) {
        this.log.warn(`bad camera request: ${error.message}`);
        reply(400, { ok: false, message: error.message });
      }
    });
  }

  start() {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.options.port, () =>
      this.log.info(`listening for camera events on port ${this.options.port}${this.options.path} (vendor: ${this.options.vendor})`)
    );
    this.timer = setInterval(() => this.flush().catch(() => {}), 5000);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    if (this.server) this.server.close();
  }
}

module.exports = { AnprListener };
