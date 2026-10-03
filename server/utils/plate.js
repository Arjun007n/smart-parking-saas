const AppError = require("./AppError");

// "rj14 ab-1234" -> "RJ14AB1234". Used everywhere a vehicle number is read,
// so searches and duplicate checks always compare the same form.
const normalizePlate = (value) =>
  String(value || "").toUpperCase().replace(/[\s-]/g, "");

const PLATE = /^[A-Z0-9]{4,12}$/;

const parsePlate = (value) => {
  const plate = normalizePlate(value);
  if (!PLATE.test(plate)) {
    throw new AppError("Vehicle number must be 4 to 12 letters and digits", 400);
  }
  return plate;
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { normalizePlate, parsePlate, escapeRegex };
