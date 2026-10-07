// Sign-in details that belong to the account itself: the company code, the Login ID,
// and the one-time clean-up of the database indexes this needed.

const crypto = require("crypto");

// No 0/O or 1/I/L, so a code read out over the phone cannot be mistaken.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

const randomCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
};

// A code no other company has. Collisions are rare (30^6), so a few tries are plenty.
const uniqueCompanyCode = async (Company) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode();
    if (!(await Company.exists({ code }))) return code;
  }
  throw new Error("Could not make a company code");
};

// A company code chosen by the company admin: 4 to 12 letters and digits, always upper case.
const CHOSEN_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
const RESERVED_CODES = new Set(["ADMIN", "PLATFORM", "SUPPORT", "ROOT", "SYSTEM", "TEST", "NULL", "NONE"]);

// Why a code cannot be used, or null when it is fine and free.
const codeProblem = async (Company, code) => {
  if (!CHOSEN_CODE_PATTERN.test(code)) return "A company code has 4 to 12 letters or digits";
  if (RESERVED_CODES.has(code)) return "This company code is not available";
  if (await Company.exists({ code })) return "This company code is already taken";
  return null;
};

// Login IDs: 3 to 30 letters, digits, dots, dashes or underscores. Always lower case.
const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const normalizeLoginId = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const normalizeCompanyCode = (value) => (typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "");

// Gives every company without a code one (safe to repeat). Returns how many were updated.
const backfillCompanyCodes = async () => {
  const Company = require("../models/Company");
  const missing = await Company.find({ $or: [{ code: { $exists: false } }, { code: null }, { code: "" }] }).select("_id").lean();
  for (const { _id } of missing) {
    const code = await uniqueCompanyCode(Company);
    await Company.updateOne({ _id, $or: [{ code: { $exists: false } }, { code: null }, { code: "" }] }, { $set: { code } });
  }
  return missing.length;
};

// Users may now sign in with a Login ID and no email, so the old "every user has a unique email"
// index has to be replaced by one that only looks at users who have an email (safe to repeat).
const migrateUserIndexes = async () => {
  const User = require("../models/User");
  let indexes;
  try {
    indexes = await User.collection.indexes();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) return false;
    throw error;
  }
  const old = indexes.find((index) => index.name === "email_1" && !index.partialFilterExpression);
  if (old) await User.collection.dropIndex("email_1");
  await User.createIndexes();
  return Boolean(old);
};

module.exports = {
  CODE_LENGTH, CHOSEN_CODE_PATTERN, LOGIN_ID_PATTERN, codeProblem, uniqueCompanyCode, normalizeLoginId, normalizeCompanyCode,
  backfillCompanyCodes, migrateUserIndexes,
};
