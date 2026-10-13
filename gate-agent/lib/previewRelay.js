// Live picture of an ANPR camera for the Entry and Exit screens.
//
// Why this exists: the screens are served over https, and a browser refuses to show a picture from a plain
// http address such as http://192.168.1.64/video.mjpg on such a page (and most cameras give RTSP, which a browser
// cannot show at all). A browser does allow http://127.0.0.1 on an https page, so the agent, which runs on the gate
// PC, opens a small picture server on that PC and tells the cloud its address (in the heartbeat). The Entry and Exit
// screens then show the picture from the agent; the agent fetches it from the camera on the local network.
//
// Nothing here reaches the internet and nothing is chosen by the browser: the camera's address, user name and
// password stay in config.json, and the web address of the picture carries a secret token made from the device key.
//
//   "preview": {
//     "mode": "mjpeg" | "snapshot",        mjpeg = the camera's own video stream (passed through),
//                                          snapshot = a still picture address, fetched again and again
//     "url": "http://192.168.1.64/video.mjpg",
//     "username": "admin", "password": "...",   optional, sent as Basic authentication
//     "intervalMs": 500,                  snapshot mode only (200 to 5000)
//     "port": 8090, "bind": "127.0.0.1",  where the picture is served (default: this PC only)
//     "advertiseHost": "127.0.0.1"        the host name the screens use (when `bind` is a LAN address)
//   }

const crypto = require("crypto");
const http = require("http");
const { Readable } = require("stream");
const { createCameraDriver } = require("./drivers/camera");
const log = require("./log");

const MODES = ["mjpeg", "snapshot"];
const MAX_VIEWERS = 4; // each viewer opens its own stream to the camera; cameras allow only a few
const BOUNDARY = "frame";
const FAILURES_BEFORE_ENDING = 3;
const CONNECT_MS = 8000;

// The same token every time the agent starts (the cloud keeps the address between restarts), and
// not guessable without the device key.
const tokenFor = (key) => crypto.createHmac("sha256", String(key)).update("preview-v1").digest("hex").slice(0, 32);

// Checks the "preview" block of a device and fills in the defaults. Throws a message for config.json.
const normalize = (raw, where = "preview") => {
  if (!raw || typeof raw !== "object") throw new Error(`${where} must be an object`);
  const mode = raw.mode || "mjpeg";
  if (!MODES.includes(mode)) throw new Error(`${where}.mode must be one of: ${MODES.join(", ")}`);
  if (typeof raw.url !== "string" || !/^https?:\/\/\S+$/.test(raw.url)) throw new Error(`${where}.url must be the camera's http(s) address`);
  const port = raw.port === undefined ? 8090 : Number(raw.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${where}.port must be a number from 1024 to 65535`);
  const intervalMs = raw.intervalMs === undefined ? 500 : Number(raw.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs < 200 || intervalMs > 5000) throw new Error(`${where}.intervalMs must be from 200 to 5000`);
  const bind = raw.bind || "127.0.0.1";
  return {
    mode, url: raw.url, username: raw.username || "", password: raw.password || "", intervalMs, port, bind,
    advertiseHost: raw.advertiseHost || (bind === "0.0.0.0" ? "127.0.0.1" : bind),
  };
};

const sameToken = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

class PreviewRelay {
  constructor({ device, options }) {
    this.device = device;
    this.options = normalize(options, `devices "${device.name}" preview`);
    this.token = tokenFor(device.key);
    this.log = log.make(`${device.name} picture`);
    this.viewers = 0;
    this.server = null;
  }

  // The address the Entry and Exit screens use. Sent to the cloud with the heartbeat.
  get url() {
    return `http://${this.options.advertiseHost}:${this.options.port}/preview/${this.token}`;
  }

  authHeaders() {
    const { username, password } = this.options;
    return username ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` } : {};
  }

  // The answer headers. The picture is shown by an <img> on another website, so it must say that is allowed
  // (and, for browsers that ask before reaching a private address, that this PC agrees).
  headers(extra = {}) {
    return {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-private-network": "true",
      "cross-origin-resource-policy": "cross-origin",
      ...extra,
    };
  }

  handleRequest(req, res) {
    const path = new URL(req.url, "http://localhost").pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, this.headers({ "access-control-allow-methods": "GET", "access-control-max-age": "600" }));
      return res.end();
    }
    const prefix = "/preview/";
    if (req.method !== "GET" || !path.startsWith(prefix) || !sameToken(path.slice(prefix.length), this.token)) {
      res.writeHead(404, this.headers());
      return res.end();
    }
    if (this.viewers >= MAX_VIEWERS) {
      res.writeHead(503, this.headers({ "retry-after": "5" }));
      return res.end();
    }
    this.viewers += 1;
    const controller = new AbortController();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.viewers -= 1;
      controller.abort();
    };
    res.on("close", finish);
    const work = this.options.mode === "snapshot" ? this.streamSnapshots(res, controller) : this.streamThrough(res, controller);
    work.catch((error) => {
      if (!controller.signal.aborted) this.log.warn(`picture stopped: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, this.headers());
        res.end();
      } else {
        res.end();
      }
    });
  }

  // The camera's own video stream, passed through as it comes.
  async streamThrough(res, controller) {
    // Only the wait for the camera to answer is limited; the stream itself may run for hours.
    const giveUp = setTimeout(() => controller.abort(), CONNECT_MS);
    let upstream;
    try {
      upstream = await fetch(this.options.url, { headers: this.authHeaders(), signal: controller.signal });
    } finally {
      clearTimeout(giveUp);
    }
    if (!upstream.ok || !upstream.body) throw new Error(`the camera answered HTTP ${upstream.status}`);
    res.writeHead(200, this.headers({ "content-type": upstream.headers.get("content-type") || `multipart/x-mixed-replace; boundary=${BOUNDARY}` }));
    const body = Readable.fromWeb(upstream.body);
    body.on("error", () => res.end());
    body.pipe(res);
  }

  // A still-picture address, fetched again and again and sent as a video stream.
  async streamSnapshots(res, controller) {
    const camera = createCameraDriver("http", {
      url: this.options.url, username: this.options.username, password: this.options.password,
    }, this.log);
    res.writeHead(200, this.headers({ "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}` }));
    let failures = 0;
    while (!controller.signal.aborted && !res.writableEnded) {
      const started = Date.now();
      try {
        const picture = await camera.capture();
        failures = 0;
        if (controller.signal.aborted) break;
        res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${picture.length}\r\n\r\n`);
        res.write(picture);
        res.write("\r\n");
      } catch (error) {
        failures += 1;
        if (failures >= FAILURES_BEFORE_ENDING) throw error;
      }
      const wait = Math.max(50, this.options.intervalMs - (Date.now() - started));
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, wait);
        controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    res.end();
  }

  start() {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.on("error", (error) => this.log.error(`could not open the picture port ${this.options.port}: ${error.message}`));
    this.server.listen(this.options.port, this.options.bind, () => this.log.info(`live picture at ${this.url}`));
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server.closeAllConnections && this.server.closeAllConnections();
    }
  }
}

module.exports = { PreviewRelay, normalize, tokenFor };
