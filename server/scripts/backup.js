// Saves every collection of the database to files.
//
//   npm run backup
//
// Creates  backups/<date-time>/<collection>.ndjson  plus a manifest with the
// document counts. Copy that folder somewhere safe (not only on this
// computer). The files contain all your data, including password hashes:
// treat them as confidential. The backups folder is ignored by Git.
//
// If your database is on a paid MongoDB Atlas tier, also switch on Atlas
// backups; this script is the fallback for tiers that have none.
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { serialize, databaseName } = require("../utils/backupFormat");

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI in server/.env first");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = path.join(__dirname, "..", "backups", stamp);
  fs.mkdirSync(folder, { recursive: true });

  const manifest = { database: databaseName(process.env.MONGO_URI), createdAt: new Date().toISOString(), collections: {} };
  const collections = await db.listCollections({ type: "collection" }).toArray();

  for (const { name } of collections) {
    if (name.startsWith("system.")) continue;
    const out = fs.createWriteStream(path.join(folder, `${name}.ndjson`), { encoding: "utf8" });
    let count = 0;
    for await (const doc of db.collection(name).find({})) {
      if (!out.write(`${serialize(doc)}\n`)) await new Promise((resolve) => out.once("drain", resolve));
      count += 1;
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    manifest.collections[name] = count;
    console.log(`${name}: ${count}`);
  }

  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nBackup written to ${folder}`);
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
