// Barrier drivers. A driver turns "open" / "close" into whatever the
// controller at the gate understands. Add a new file-less driver by adding a
// function to `drivers` below.
//
//   simulated  only logs (for testing without hardware)
//   http       IP relay boards / controllers with a web API (Shelly, ESP/NodeMCU relays, ...)
//   tcp        network relay boards that take raw bytes on a TCP port
//   serial     USB relay / controller on a COM port (needs:  npm install serialport)

const net = require("net");
const { sleep, hexToBuffer } = require("../util");

const httpCall = async (url, { method = "GET", headers, body } = {}) => {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Controller answered HTTP ${res.status}`);
};

const tcpSend = (host, port, buffer) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 4000 }, () => socket.end(buffer));
    socket.on("close", () => resolve());
    socket.on("timeout", () => socket.destroy(new Error("Controller connection timed out")));
    socket.on("error", reject);
  });

const drivers = {
  simulated: (options, log) => ({
    open: async ({ pulseMs }) => log.info(`SIMULATED BARRIER: OPEN (pulse ${pulseMs} ms)`),
    close: async () => log.info("SIMULATED BARRIER: CLOSE"),
  }),

  // options: onUrl (required), offUrl (sent after the pulse), closeUrl, method, headers, body
  http: (options) => ({
    open: async ({ pulseMs }) => {
      if (!options.onUrl) throw new Error("http driver needs options.onUrl");
      await httpCall(options.onUrl, options);
      if (options.offUrl) {
        await sleep(pulseMs);
        await httpCall(options.offUrl, options);
      }
    },
    close: async () => {
      if (!options.closeUrl) throw new Error("This barrier has no closeUrl, it cannot be closed by command");
      await httpCall(options.closeUrl, options);
    },
  }),

  // options: host, port, openHex (required), offHex (sent after the pulse), closeHex
  tcp: (options) => ({
    open: async ({ pulseMs }) => {
      await tcpSend(options.host, options.port, hexToBuffer(options.openHex, "options.openHex"));
      if (options.offHex) {
        await sleep(pulseMs);
        await tcpSend(options.host, options.port, hexToBuffer(options.offHex, "options.offHex"));
      }
    },
    close: async () => {
      if (!options.closeHex) throw new Error("This barrier has no closeHex, it cannot be closed by command");
      await tcpSend(options.host, options.port, hexToBuffer(options.closeHex, "options.closeHex"));
    },
  }),

  // options: path (COM3 or /dev/ttyUSB0), baudRate, openHex, offHex, closeHex
  serial: (options) => {
    let SerialPort;
    try {
      ({ SerialPort } = require("serialport"));
    } catch {
      throw new Error("The serial driver needs the 'serialport' package: run  npm install serialport  in gate-agent");
    }
    const write = (buffer) =>
      new Promise((resolve, reject) => {
        const port = new SerialPort({ path: options.path, baudRate: options.baudRate || 9600 }, (openError) => {
          if (openError) return reject(openError);
          port.write(buffer, (writeError) => {
            if (writeError) return reject(writeError);
            port.drain(() => port.close(() => resolve()));
          });
        });
      });
    return {
      open: async ({ pulseMs }) => {
        await write(hexToBuffer(options.openHex, "options.openHex"));
        if (options.offHex) {
          await sleep(pulseMs);
          await write(hexToBuffer(options.offHex, "options.offHex"));
        }
      },
      close: async () => {
        if (!options.closeHex) throw new Error("This barrier has no closeHex, it cannot be closed by command");
        await write(hexToBuffer(options.closeHex, "options.closeHex"));
      },
    };
  },
};

const createBarrierDriver = (name, options = {}, log) => {
  const factory = drivers[name || "simulated"];
  if (!factory) throw new Error(`Unknown barrier driver "${name}". Use one of: ${Object.keys(drivers).join(", ")}`);
  return factory(options, log);
};

module.exports = { createBarrierDriver, drivers };
