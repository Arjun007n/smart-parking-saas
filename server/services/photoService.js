// Limits and clean-up for vehicle photos.
const ParkingSession = require("../models/ParkingSession");
const storage = require("./photoStorage");

const MAX_PHOTOS = 6; // per ticket
const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024; // the browser shrinks pictures well below this

const maxBytes = () => Math.max(50 * 1024, Math.min(8 * 1024 * 1024, Number(process.env.PHOTO_MAX_BYTES) || DEFAULT_MAX_BYTES));
const retentionDays = () => Math.max(1, Number(process.env.PHOTO_RETENTION_DAYS) || 90);

// Deletes pictures older than the retention period (default 90 days) from
// finished visits, files and records both. Run once a day. A picture whose
// file cannot be removed keeps its record, so it is tried again next time.
const purgeExpired = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - retentionDays() * 86400000);
  const sessions = await ParkingSession.find({ isOpen: false, "photos.takenAt": { $lt: cutoff } }).limit(200);
  let removed = 0;
  for (const session of sessions) {
    const old = session.photos.filter((p) => p.takenAt < cutoff);
    const gone = [];
    for (const photo of old) {
      try {
        await storage.remove(photo.file);
        gone.push(photo._id);
      } catch (error) {
        console.error(`Could not delete photo ${photo._id}:`, error.message);
      }
    }
    if (gone.length) {
      await ParkingSession.updateOne({ _id: session._id }, { $pull: { photos: { _id: { $in: gone } } } });
      removed += gone.length;
    }
  }
  return { removed };
};

// The per-company storage limit lives in photoStorage.save (every upload path goes through it).
const { companyCapBytes, companyUsage, assertCompanyPhotoRoom, clearUsageCache } = storage;

module.exports = {
  MAX_PHOTOS, maxBytes, retentionDays, purgeExpired,
  companyCapBytes, companyUsage, assertCompanyPhotoRoom, clearUsageCache,
};
