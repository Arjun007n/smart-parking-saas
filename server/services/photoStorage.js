// Where vehicle photos live: plain files in one folder on the server.
//
//   PHOTO_STORAGE_DIR   default: server/uploads/photos
//
// On a host whose disk is wiped on every deploy (many free plans), point this at
// a persistent volume, or the pictures disappear. Only this file knows where
// pictures are kept; to use a cloud bucket later, replace save / open / remove.
//
// Files are named by us (company / month / random), never by the client, and a
// name is checked against a strict pattern before it is touched, so a stored
// value can never point outside the folder.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const root = () => path.resolve(process.env.PHOTO_STORAGE_DIR || path.join(__dirname, "..", "uploads", "photos"));
const KEY_PATTERN = /^[0-9a-f]{24}\/\d{6}\/[0-9a-f]{32}\.(jpg|png|webp)$/;

// What the bytes really are, from their first bytes. The client's own claim
// ("this is a JPEG") is never trusted, because the file is later served back.
const detectType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", contentType: "image/png" };
  }
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
};

const monthStamp = (date = new Date()) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

// Resolves a stored key to a path, or null when the key is not one of ours.
const pathFor = (key) => {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return null;
  const full = path.resolve(root(), key);
  return full.startsWith(root() + path.sep) ? full : null;
};

// Saves the picture and returns its key.
const save = async (companyId, buffer, ext) => {
  const key = `${String(companyId)}/${monthStamp()}/${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const full = pathFor(key);
  if (!full) throw new Error("Invalid photo key");
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buffer, { flag: "wx" }); // never overwrite
  return key;
};

// Opens a picture for sending: { stream, size }, or null when it is gone.
const open = async (key) => {
  const full = pathFor(key);
  if (!full) return null;
  try {
    const { size } = await fsp.stat(full);
    return { stream: fs.createReadStream(full), size };
  } catch {
    return null;
  }
};

// Deletes a picture. Missing files are fine.
const remove = async (key) => {
  const full = pathFor(key);
  if (full) await fsp.rm(full, { force: true });
};

module.exports = { KEY_PATTERN, detectType, save, open, remove, pathFor, root };
