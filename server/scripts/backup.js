// Saves every collection of the database to files.
//
//   npm run backup
//
// Creates  backups/<date-time>/<collection>.ndjson  plus a manifest with the
// document counts. Copy that folder somewhere safe (not only on this
// computer). The files contain all your data, including password hashes:
// treat them as confidential. The backups folder is ignored by Git, and the folder and files are created readable
// by the owner only. One-time codes (otps) are not saved, and password-reset tokens are removed from users.
//
// If your database is on a paid MongoDB Atlas tier, also switch on Atlas
// backups; this script is the fallback for tiers that have none.
const dns = require("dns");

// Only when run as a command (so the helpers below can be loaded by tests without reading .env).
if (require.main === module) {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  require("dotenv").config();
}

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { serialize, databaseName } = require("../utils/backupFormat");

// Collections that are not worth keeping (short-lived secrets), and fields removed from a collection's documents.
const SKIP_COLLECTIONS = ["otps"];
const STRIP_FIELDS = { users: ["passwordResetToken", "passwordResetExpires"] };
const scrub = (name, doc) => {
  const fields = STRIP_FIELDS[name];
  if (!fields) return doc;
  const copy = { ...doc };
  for (const field of fields) delete copy[field];
  return copy;
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI in server/.env first");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = path.join(__dirname, "..", "backups", stamp);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(folder), 0o700); // the backups folder itself, if we just made it
  fs.chmodSync(folder, 0o700);

  const manifest = { database: databaseName(process.env.MONGO_URI), createdAt: new Date().toISOString(), collections: {} };
  const collections = await db.listCollections({ type: "collection" }).toArray();

  for (const { name } of collections) {
    if (name.startsWith("system.") || SKIP_COLLECTIONS.includes(name)) continue;
    const out = fs.createWriteStream(path.join(folder, `${name}.ndjson`), { encoding: "utf8", mode: 0o600 });
    let count = 0;
    for await (const doc of db.collection(name).find({})) {
      if (!out.write(`${serialize(scrub(name, doc))}\n`)) await new Promise((resolve) => out.once("drain", resolve));
      count += 1;
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    manifest.collections[name] = count;
    console.log(`${name}: ${count}`);
  }

  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`\nBackup written to ${folder}`);
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { scrub, SKIP_COLLECTIONS, STRIP_FIELDS };
