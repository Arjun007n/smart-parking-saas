const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const storage = require("../services/photoStorage");
const { MAX_PHOTOS } = require("../services/photoService");
const { locationScopedFilter } = require("../utils/scope");
const ParkingSession = require("../models/ParkingSession");
const { PHOTO_KINDS } = require("../models/ParkingSession");

const findSession = async (req) => {
  const session = await ParkingSession.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!session) throw new AppError("Parking session not found", 404);
  return session;
};

// POST /api/parking/sessions/:id/photos?kind=ENTRY|EXIT|OTHER
// The body is the picture itself (Content-Type image/jpeg, image/png or image/webp).
const addPhoto = async (req, res) => {
  const session = await findSession(req);
  const kind = req.query.kind === undefined ? "OTHER" : req.query.kind;
  if (!PHOTO_KINDS.includes(kind)) throw new AppError(`kind must be one of: ${PHOTO_KINDS.join(", ")}`, 400);

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError("Send the photo as the request body with Content-Type image/jpeg, image/png or image/webp", 415);
  }
  // What the bytes are, not what the sender says they are.
  const type = detectOrFail(body, req.headers["content-type"]);

  const key = await storage.save(session.companyId, body, type.ext);
  const photo = {
    _id: new mongoose.Types.ObjectId(),
    kind, file: key, contentType: type.contentType, bytes: body.length, takenBy: req.user._id,
  };
  // The count is checked in the same step as the insert, so two uploads cannot both slip past the limit.
  const updated = await ParkingSession.findOneAndUpdate(
    { _id: session._id, $expr: { $lt: [{ $size: { $ifNull: ["$photos", []] } }, MAX_PHOTOS] } },
    { $push: { photos: photo } },
    { returnDocument: "after" }
  );
  if (!updated) {
    await storage.remove(key);
    throw new AppError(`This ticket already has the most photos allowed (${MAX_PHOTOS})`, 409);
  }
  res.status(201).json({ success: true, data: { photo: updated.photos.id(photo._id), photos: updated.photos } });
};

const detectOrFail = (body, declared) => {
  const type = storage.detectType(body);
  const said = String(declared || "").split(";")[0].trim().toLowerCase();
  if (!type || type.contentType !== said) {
    throw new AppError("This is not a valid JPEG, PNG or WebP picture", 415);
  }
  return type;
};

// GET /api/parking/sessions/:id/photos/:photoId
// Streams the picture after the same login and location checks as the ticket.
const getPhoto = async (req, res) => {
  const session = await findSession(req);
  const photo = session.photos.id(req.params.photoId);
  if (!photo) throw new AppError("Photo not found", 404);
  const file = await storage.open(photo.file);
  if (!file) throw new AppError("This photo is no longer stored", 404);

  res.set({
    "Content-Type": photo.contentType,
    "Content-Length": String(file.size),
    // Private to this person's browser, and never run as anything but a picture.
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  file.stream.on("error", () => res.destroy());
  file.stream.pipe(res);
};

// DELETE /api/parking/sessions/:id/photos/:photoId   (admins)
const removePhoto = async (req, res) => {
  const session = await findSession(req);
  // Take it off the record first (returning what it was), then delete the file.
  const before = await ParkingSession.findOneAndUpdate(
    { _id: session._id, "photos._id": req.params.photoId },
    { $pull: { photos: { _id: req.params.photoId } } },
    { returnDocument: "before" }
  );
  const photo = before && before.photos.id(req.params.photoId);
  if (!photo) throw new AppError("Photo not found", 404);
  await storage.remove(photo.file);
  await audit.record(req, "PHOTO_DELETED", {
    entity: "ParkingSession", entityId: session._id, companyId: session.companyId,
    meta: { ticketNumber: session.ticketNumber, kind: photo.kind, photoId: photo._id },
  });
  res.json({ success: true, data: { photos: before.photos.filter((p) => String(p._id) !== String(photo._id)) } });
};

module.exports = { addPhoto, getPhoto, removePhoto };
