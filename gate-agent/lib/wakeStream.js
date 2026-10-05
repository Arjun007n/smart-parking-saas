// A one-way line from the cloud: "a command is waiting for this device".
//
// The agent opens GET /api/device/stream (outward, like everything else it does). The server
// writes a `wake` message the moment a command is queued, and the worker then asks for its
// commands at once instead of waiting for the next poll. Polling never stops: if this line is
// down, commands still arrive, only up to a poll interval later.
//
// This is deliberately NOT a small web server on the gate PC: nothing listens on a port, so
// no website or other program on the network can trigger the barrier through it.

const log = require("./log");

// The server sends something at least every 25 s; silence for this long means a dead line.
const SILENCE_MS = 70 * 1000;

// Splits received text into complete messages. Returns { events: [{event, data}], rest }.
const parseSse = (text) => {
  const events = [];
  const parts = text.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop();
  for (const block of parts) {
    let event = "message";
    let any = false;
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      if (field === "event" || field === "data") any = true;
    }
    if (any) events.push({ event });
  }
  return { events, rest };
};

class WakeStream {
  constructor({ serverUrl, key, onWake, name = "device", fetchFn, minDelay = 1000, maxDelay = 30000, silenceMs = SILENCE_MS, version = "gate-agent/1.0.0" }) {
    this.url = `${serverUrl.replace(/\/+$/, "")}/api/device/stream`;
    this.key = key;
    this.onWake = onWake;
    this.log = log.make(name);
    this.fetchFn = fetchFn || ((...args) => fetch(...args));
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.silenceMs = silenceMs;
    this.version = version;
    this.running = false;
    this.connected = false;
    this.failures = 0;
    this.controller = null;
    this.retryTimer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    this.connected = false;
    clearTimeout(this.retryTimer);
    if (this.controller) this.controller.abort();
  }

  retry() {
    if (!this.running) return;
    this.connected = false;
    const delay = Math.min(this.maxDelay, this.minDelay * 2 ** Math.min(this.failures, 6));
    this.failures += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
    this.retryTimer.unref?.();
  }

  async connect() {
    if (!this.running) return;
    const controller = new AbortController();
    this.controller = controller;
    let silence = null;
    const resetSilence = () => {
      clearTimeout(silence);
      silence = setTimeout(() => controller.abort(), this.silenceMs);
      silence.unref?.();
    };
    try {
      resetSilence();
      const res = await this.fetchFn(this.url, {
        headers: { "x-device-key": this.key, "x-agent-version": this.version, accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        // Wrong key, or a server without this feature: keep polling, ask again only rarely.
        if (this.failures === 0) this.log.warn(`Instant wake-up is not available (HTTP ${res.status}); using normal polling`);
        this.failures = Math.max(this.failures, 6);
        return this.retry();
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetSilence();
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSse(buffer);
        buffer = parsed.rest;
        for (const message of parsed.events) {
          if (message.event === "ready") {
            if (!this.connected) this.log.info("instant wake-up connected");
            this.connected = true;
            this.failures = 0;
          } else if (message.event === "wake") {
            try {
              this.onWake();
            } catch (error) {
              this.log.warn(`wake handler failed: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      if (this.running && error.name !== "AbortError") this.log.warn(`wake stream: ${error.message} (polling continues)`);
    } finally {
      clearTimeout(silence);
    }
    this.retry();
  }
}

module.exports = { WakeStream, parseSse, SILENCE_MS };
