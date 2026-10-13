// One DeviceWorker serves one device registered in the platform: it says
// "I am alive", asks for commands, carries them out and reports the result.
//
// Safety rules:
//  * A command already carried out is never carried out twice. If the report
//    to the server is lost, the server offers the command again and we answer
//    with the remembered result instead of lifting the barrier / printing again.
//  * Every driver call has a time limit.
//  * Network problems never stop the loop; it just tries again.

const { createClient } = require("./api");
const { createBarrierDriver } = require("./drivers/barrier");
const { createPrinterDriver } = require("./drivers/printer");
const { createCameraDriver, imageType } = require("./drivers/camera");
const { withTimeout, sleep } = require("./util");
const { WakeStream } = require("./wakeStream");
const log = require("./log");

const REMEMBER = 300;

class DeviceWorker {
  constructor({ serverUrl, device, pollMs = 2000, heartbeatMs = 15000, client, instant, wakeOptions = {}, previewUrl }) {
    this.device = device;
    // Where the live picture of this (ANPR) camera is served by this agent; told to the cloud with every heartbeat.
    this.previewUrl = previewUrl || null;
    this.pollMs = pollMs;
    this.heartbeatMs = heartbeatMs;
    this.log = log.make(device.name);
    this.api = client || createClient({ serverUrl, key: device.key });
    this.done = new Map(); // commandId -> { ok, error }
    this.timers = [];
    this.running = false;
    this.nudges = [];
    // A test client stands in for the server, so there is nothing to open a stream to.
    this.instant = instant === undefined ? !client : instant;
    this.wakeOptions = wakeOptions;
    this.wake = null;
    this.serverUrl = serverUrl;

    if (device.type === "BARRIER") this.driver = createBarrierDriver(device.driver, device.options, this.log);
    else if (device.type === "PRINTER") this.driver = createPrinterDriver(device.driver, device.options, this.log);
    else if (device.type === "CCTV_CAMERA") this.driver = createCameraDriver(device.driver, device.options, this.log);
    else this.driver = null; // ANPR cameras and tag readers report what they read; they take no commands
  }

  remember(id, result) {
    this.done.set(id, result);
    if (this.done.size > REMEMBER) this.done.delete(this.done.keys().next().value);
  }

  // Carries out one command. Throws with a readable message on failure.
  async execute(command) {
    const { id, type, payload = {} } = command;
    if (!this.driver) throw new Error(`${this.device.type} devices do not take commands`);

    if (this.device.type === "BARRIER") {
      if (type === "BARRIER_OPEN") return withTimeout(() => this.driver.open({ pulseMs: payload.pulseMs || 1000 }), 8000, "Barrier open");
      if (type === "BARRIER_CLOSE") return withTimeout(() => this.driver.close(), 8000, "Barrier close");
    }
    if (this.device.type === "PRINTER" && type.startsWith("PRINT_")) {
      if (payload.format !== "escpos" || !payload.dataBase64) throw new Error("Unsupported print format");
      return withTimeout(() => this.driver.print(Buffer.from(payload.dataBase64, "base64"), payload.text), 20000, "Printing");
    }
    if (this.device.type === "CCTV_CAMERA") {
      if (type === "SNAPSHOT_TEST" || type === "CAPTURE_SNAPSHOT") {
        const picture = await withTimeout(() => this.driver.capture(), 15000, "Taking the picture");
        const contentType = imageType(picture);
        if (!contentType) throw new Error("The camera did not give a JPEG, PNG or WebP picture");
        // A test only proves the camera answers; a real command files the picture under the ticket.
        if (type === "CAPTURE_SNAPSHOT") await withTimeout(() => this.api.snapshot(id, picture, contentType), 25000, "Uploading the picture");
        return undefined;
      }
    }
    throw new Error(`${type} is not supported by this ${this.device.type.replace("_", " ").toLowerCase()}`);
  }

  async report(id, result) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.api.ack(id, result.ok, result.error);
        return true;
      } catch (error) {
        // The server said no (404, 409): retrying cannot help.
        if (error.status && error.status >= 400 && error.status < 500) {
          this.log.warn(`Server refused the result of ${id}: ${error.message}`);
          return false;
        }
        this.log.warn(`Could not report ${id} (attempt ${attempt}): ${error.message}`);
        await sleep(500 * attempt);
      }
    }
    return false;
  }

  async pollOnce() {
    const data = await this.api.commands();
    for (const command of data.commands) {
      let result = this.done.get(command.id);
      if (result) {
        this.log.info(`${command.type} ${command.id} was already done, confirming again`);
      } else {
        try {
          await this.execute(command);
          result = { ok: true };
          this.log.info(`${command.type} done (${command.id})`);
        } catch (error) {
          result = { ok: false, error: error.message };
          this.log.error(`${command.type} failed (${command.id}): ${error.message}`);
        }
        this.remember(command.id, result);
      }
      await this.report(command.id, result);
    }
    return data.commands.length;
  }

  async heartbeatOnce() {
    await this.api.heartbeat(this.previewUrl ? { previewUrl: this.previewUrl } : {});
  }

  // Calls `work` again and again until stopped, never faster than `ms`,
  // slowing down while the server cannot be reached.
  // Returns a function that makes the next call happen now (the wake-up from the server).
  // The work never overlaps itself: a nudge during a run causes one more run right after it.
  loop(name, ms, work) {
    let failures = 0;
    let timer = null;
    let busy = false;
    let again = false;

    const schedule = () => {
      if (!this.running) return;
      if (again) {
        again = false;
        return tick();
      }
      timer = setTimeout(tick, Math.min(ms * 2 ** Math.min(failures, 4), 30000));
      timer.unref?.();
      this.timers.push(timer);
    };

    const tick = async () => {
      this.timers = this.timers.filter((t) => t !== timer); // the one that just fired
      if (!this.running || busy) return;
      busy = true;
      try {
        await work();
        if (failures) this.log.info(`${name}: connection restored`);
        failures = 0;
      } catch (error) {
        failures += 1;
        if (failures === 1 || failures % 10 === 0) this.log.warn(`${name}: ${error.message} (will keep trying)`);
      }
      busy = false;
      schedule();
    };

    const nudge = () => {
      if (!this.running) return;
      if (busy) {
        again = true;
        return;
      }
      clearTimeout(timer);
      tick();
    };

    tick();
    return nudge;
  }

  start() {
    this.running = true;
    this.loop("heartbeat", this.heartbeatMs, () => this.heartbeatOnce());
    if (this.driver) {
      const nudge = this.loop("commands", this.pollMs, () => this.pollOnce());
      this.nudges.push(nudge);
      // Only devices that take commands need to be woken.
      if (this.instant) {
        this.wake = new WakeStream({
          serverUrl: this.serverUrl, key: this.device.key, name: this.device.name, onWake: nudge, ...this.wakeOptions,
        });
        this.wake.start();
      }
    }
    this.log.info(`started (${this.device.type}, driver: ${this.device.driver || "simulated"})`);
  }

  stop() {
    this.running = false;
    if (this.wake) this.wake.stop();
    this.wake = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}

module.exports = { DeviceWorker };
