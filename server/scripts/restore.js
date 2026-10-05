// Restores a backup made by "npm run backup" into ANOTHER database, so you
// can check that your backups really work without touching live data.
//
//   npm run restore -- backups/2026-10-03T10-00-00-000Z
//
// The target is MONGO_URI_RESTORE in server/.env. To protect live data:
//   - its database name must end with "_restore"
//   - it must be empty, unless you add  --drop  to empty it first
//
// To restore into the live database after a real loss, point MONGO_URI_RESTORE
// at a new, empty "..._restore" database, check it, then switch MONGO_URI to it.
// Indexes are rebuilt automatically the next time the server starts on it.
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const { parse, databaseName } = require("../utils/backupFormat");

const BATCH = 500;

const run = async () => {
  const args = process.argv.slice(2);
  const drop = args.includes("--drop");
  const folderArg = args.find((arg) => !arg.startsWith("--"));
  if (!folderArg) throw new Error("Give the backup folder, for example: npm run restore -- backups/2026-10-03T10-00-00-000Z");

  const folder = path.resolve(folderArg);
  const manifestPath = path.join(folder, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json in ${folder}. Is this a backup folder?`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const target = process.env.MONGO_URI_RESTORE;
  if (!target) throw new Error("Set MONGO_URI_RESTORE in server/.env (a database whose name ends with _restore)");
  const name = databaseName(target);
  if (!name.endsWith("_restore")) {
    throw new Error(`Refusing to restore into "${name}": the database name must end with "_restore"`);
  }

  await mongoose.connect(target);
  const db = mongoose.connection.db;

  const existing = await db.listCollections({ type: "collection" }).toArray();
  if (existing.length && !drop) {
    throw new Error(`Database "${name}" is not empty. Add --drop to empty it first.`);
  }
  if (drop) await db.dropDatabase();

  let problems = 0;
  for (const [collection, expected] of Object.entries(manifest.collections)) {
    const file = path.join(folder, `${collection}.ndjson`);
    const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });

    let batch = [];
    let restored = 0;
    const flush = async () => {
      if (!batch.length) return;
      await db.collection(collection).insertMany(batch, { ordered: true });
      restored += batch.length;
      batch = [];
    };
    for await (const line of lines) {
      if (!line.trim()) continue;
      batch.push(parse(line));
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    const ok = restored === expected;
    if (!ok) problems += 1;
    console.log(`${collection}: ${restored} of ${expected}${ok ? "" : "  <-- MISMATCH"}`);
  }

  if (problems) throw new Error(`${problems} collection(s) did not restore completely`);
  console.log(`\nRestore complete and verified: every collection matches the backup (${manifest.createdAt}).`);
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
