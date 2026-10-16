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
const AppError = require("../utils/AppError");

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

// Most picture storage one company may use (default 5000 MB; PHOTO_MAX_PER_COMPANY_MB, 0 = no limit).
const companyCapBytes = () => {
  const raw = process.env.PHOTO_MAX_PER_COMPANY_MB;
  const mb = raw === undefined || raw === "" || Number.isNaN(Number(raw)) ? 5000 : Number(raw);
  return mb > 0 ? mb * 1024 * 1024 : 0;
};

// The folder walk is cached for a minute and topped up as pictures are added, so an upload does not scan the disk.
const USAGE_TTL_MS = 60 * 1000;
const usageCache = new Map(); // companyId -> { bytes, at }

const companyUsage = async (companyId, now = Date.now()) => {
  const id = String(companyId);
  const hit = usageCache.get(id);
  if (hit && now - hit.at < USAGE_TTL_MS) return hit.bytes;
  const bytes = await usageBytes(id);
  usageCache.set(id, { bytes, at: now });
  return bytes;
};

// Throws 413 when saving `incomingBytes` more would pass the company's picture storage limit.
const assertCompanyPhotoRoom = async (companyId, incomingBytes = 0) => {
  const cap = companyCapBytes();
  if (!cap) return;
  const used = await companyUsage(companyId);
  if (used + incomingBytes > cap) {
    throw new AppError(`Your company's vehicle photo storage is full (${Math.round(cap / 1048576)} MB). Old photos are removed automatically; contact support to raise the limit.`, 413);
  }
};

const clearUsageCache = () => usageCache.clear();

// Saves the picture and returns its key.
const save = async (companyId, buffer, ext) => {
  const key = `${String(companyId)}/${monthStamp()}/${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const full = pathFor(key);
  if (!full) throw new Error("Invalid photo key");
  await assertCompanyPhotoRoom(companyId, buffer.length);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buffer, { flag: "wx" }); // never overwrite
  const hit = usageCache.get(String(companyId));
  if (hit) hit.bytes += buffer.length;
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

// Bytes one company's pictures take on disk (0 when it has none). Walks that company's folder only.
const usageBytes = async (companyId) => {
  const base = path.resolve(root(), String(companyId));
  if (!/^[0-9a-f]{24}$/.test(String(companyId)) || !base.startsWith(root() + path.sep)) return 0;
  let total = 0;
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        try {
          total += (await fsp.stat(full)).size;
        } catch {
          // removed meanwhile
        }
      }
    }
  };
  await walk(base);
  return total;
};

module.exports = { usageBytes, companyCapBytes, companyUsage, assertCompanyPhotoRoom, clearUsageCache, KEY_PATTERN, detectType, save, open, remove, pathFor, root };
