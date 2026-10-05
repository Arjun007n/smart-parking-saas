// CCTV camera drivers. A driver returns ONE picture (a Buffer) when asked; the
// worker uploads it. The camera's address and password stay in config.json at the
// site and are never sent to the cloud.
//
//   simulated  returns a tiny grey picture (to try the flow without a camera)
//   http       a snapshot address (most IP cameras have one, for example
//              http://192.168.1.64/ISAPI/Streaming/channels/101/picture). Optional
//              username / password are sent as Basic authentication.
//   file       a picture file another program keeps fresh; refused when older than maxAgeSeconds
//   command    runs a command that writes the picture to {file}, for example for an RTSP stream:
//              ffmpeg -y -rtsp_transport tcp -i rtsp://user:pass@192.168.1.64/stream -frames:v 1 {file}

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { splitCommand } = require("../util");

const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmaKKKAP/Z", "base64");
const MAX_BYTES = 8 * 1024 * 1024;

// What the bytes are (the server checks the same thing and wants the matching Content-Type).
const imageType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
};

const checked = (buffer, where) => {
  if (!imageType(buffer)) throw new Error(`${where} did not give a JPEG, PNG or WebP picture`);
  if (buffer.length > MAX_BYTES) throw new Error(`${where} gave a picture larger than 8 MB`);
  return buffer;
};

const drivers = {
  simulated: (options, log) => ({
    capture: async () => {
      log.info("SIMULATED CCTV: snapshot taken");
      return TINY_JPEG;
    },
  }),

  // options: url (required), username, password, headers
  http: (options) => ({
    capture: async () => {
      if (!options.url) throw new Error("http camera driver needs options.url");
      const headers = { ...(options.headers || {}) };
      if (options.username) {
        headers.authorization = `Basic ${Buffer.from(`${options.username}:${options.password || ""}`).toString("base64")}`;
      }
      const res = await fetch(options.url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Camera answered HTTP ${res.status}`);
      return checked(Buffer.from(await res.arrayBuffer()), "The camera");
    },
  }),

  // options: path (required), maxAgeSeconds (default 30)
  file: (options) => ({
    capture: async () => {
      if (!options.path) throw new Error("file camera driver needs options.path");
      const stat = await fs.promises.stat(options.path);
      const maxAge = (options.maxAgeSeconds || 30) * 1000;
      if (Date.now() - stat.mtimeMs > maxAge) throw new Error("The camera picture file is out of date");
      return checked(await fs.promises.readFile(options.path), "The picture file");
    },
  }),

  // options: command (required, {file} is replaced by a temporary file name), timeoutMs
  command: (options) => ({
    capture: async () => {
      if (!options.command) throw new Error("command camera driver needs options.command");
      const file = path.join(os.tmpdir(), `snapshot-${Date.now()}-${process.pid}.jpg`);
      const [program, ...args] = splitCommand(options.command).map((part) => part.replace("{file}", file));
      try {
        await new Promise((resolve, reject) =>
          execFile(program, args, { timeout: options.timeoutMs || 12000 }, (error) => (error ? reject(error) : resolve()))
        );
        return checked(await fs.promises.readFile(file), "The command");
      } finally {
        fs.promises.unlink(file).catch(() => {});
      }
    },
  }),
};

const createCameraDriver = (name, options = {}, log) => {
  const factory = drivers[name || "simulated"];
  if (!factory) throw new Error(`Unknown CCTV driver "${name}". Use one of: ${Object.keys(drivers).join(", ")}`);
  return factory(options, log);
};

module.exports = { createCameraDriver, drivers, imageType, TINY_JPEG };
