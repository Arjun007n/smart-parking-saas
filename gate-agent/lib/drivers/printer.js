// Printer drivers. The server sends finished ESC/POS bytes; a driver only
// delivers them to the printer.
//
//   simulated  writes ./printed/<time>.txt (readable) and .bin (raw bytes)
//   tcp        network thermal printer on port 9100
//   file       a printer share or device file. On Windows: share the printer
//              (for example as POS80) and use  path: "\\\\localhost\\POS80".
//              On Linux: path: "/dev/usb/lp0".
//   command    runs a command with {file} replaced by a temp file with the bytes
//              (for example  lp -d MyPrinter -o raw {file} )

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { execFile } = require("child_process");
const { splitCommand } = require("../util");

const tcpSend = (host, port, buffer) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 5000 }, () => socket.end(buffer));
    socket.on("close", () => resolve());
    socket.on("timeout", () => socket.destroy(new Error("Printer connection timed out")));
    socket.on("error", reject);
  });

const drivers = {
  simulated: (options, log) => ({
    print: async (buffer, text) => {
      const dir = path.resolve(options.dir || "printed");
      await fs.promises.mkdir(dir, { recursive: true });
      const name = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.promises.writeFile(path.join(dir, `${name}.bin`), buffer);
      await fs.promises.writeFile(path.join(dir, `${name}.txt`), text || "(no text preview)");
      log.info(`SIMULATED PRINTER: ${buffer.length} bytes saved to ${path.join(dir, name)}.txt\n${text || ""}`);
    },
  }),

  tcp: (options) => ({
    print: (buffer) => tcpSend(options.host, options.port || 9100, buffer),
  }),

  file: (options) => ({
    print: async (buffer) => {
      if (!options.path) throw new Error("file driver needs options.path");
      await fs.promises.writeFile(options.path, buffer);
    },
  }),

  command: (options) => ({
    print: async (buffer) => {
      if (!options.command) throw new Error("command driver needs options.command");
      const file = path.join(os.tmpdir(), `receipt-${Date.now()}-${process.pid}.bin`);
      await fs.promises.writeFile(file, buffer);
      const [program, ...args] = splitCommand(options.command).map((part) => part.replace("{file}", file));
      try {
        await new Promise((resolve, reject) => execFile(program, args, { timeout: 10000 }, (error) => (error ? reject(error) : resolve())));
      } finally {
        fs.promises.unlink(file).catch(() => {});
      }
    },
  }),
};

const createPrinterDriver = (name, options = {}, log) => {
  const factory = drivers[name || "simulated"];
  if (!factory) throw new Error(`Unknown printer driver "${name}". Use one of: ${Object.keys(drivers).join(", ")}`);
  return factory(options, log);
};

module.exports = { createPrinterDriver, drivers };
