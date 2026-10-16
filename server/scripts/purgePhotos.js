// Deletes the vehicle photos of tickets that were closed more than N days ago.
//
//   node scripts/purgePhotos.js                    only COUNTS what would go (nothing is deleted)
//   node scripts/purgePhotos.js --days 60          same, for tickets closed more than 60 days ago
//   node scripts/purgePhotos.js --apply            really deletes (files and records)
//   node scripts/purgePhotos.js --company <id>     only one company
//
// Not run automatically. (The server also removes photos older than PHOTO_RETENTION_DAYS once a day;
// this script is for freeing space on demand.) A photo whose file cannot be removed keeps its record.
const dns = require("dns");

if (require.main === module) {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  require("dotenv").config();
}

const mongoose = require("mongoose");
const ParkingSession = require("../models/ParkingSession");
const storage = require("../services/photoStorage");

const DAY = 86400000;

// { days, apply, company } from the command line; throws on a wrong value.
const parseArgs = (argv) => {
  const out = { days: 90, apply: false, company: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--days") {
      out.days = Number(argv[(i += 1)]);
      if (!Number.isFinite(out.days) || out.days < 1) throw new Error("--days must be a number of at least 1");
    } else if (arg === "--company") {
      out.company = argv[(i += 1)];
      if (!mongoose.isValidObjectId(out.company)) throw new Error("--company must be a company id");
    } else throw new Error(`Unknown option ${arg}`);
  }
  return out;
};

const run = async () => {
  const { days, apply, company } = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI in server/.env first");
  await mongoose.connect(process.env.MONGO_URI);

  const cutoff = new Date(Date.now() - days * DAY);
  const filter = { isOpen: false, exitTime: { $lt: cutoff }, "photos.0": { $exists: true }, ...(company ? { companyId: company } : {}) };
  console.log(`${apply ? "DELETING" : "Dry run (add --apply to delete)"}: photos of tickets closed before ${cutoff.toISOString()}`);

  let tickets = 0;
  let photos = 0;
  let bytes = 0;
  let failed = 0;
  for await (const session of ParkingSession.find(filter).select("photos companyId").cursor()) {
    tickets += 1;
    const gone = [];
    for (const photo of session.photos) {
      photos += 1;
      bytes += photo.bytes || 0;
      if (!apply) continue;
      try {
        await storage.remove(photo.file);
        gone.push(photo._id);
      } catch (error) {
        failed += 1;
        console.error(`Could not delete photo ${photo._id}: ${error.message}`);
      }
    }
    if (apply && gone.length) await ParkingSession.updateOne({ _id: session._id }, { $pull: { photos: { _id: { $in: gone } } } });
  }
  console.log(`${tickets} ticket(s), ${photos} photo(s), ${(bytes / 1048576).toFixed(1)} MB ${apply ? `processed (${failed} could not be deleted)` : "would be deleted"}.`);
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { parseArgs };
