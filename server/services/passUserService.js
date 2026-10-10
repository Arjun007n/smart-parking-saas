// Pass users and their vehicles: finding or making the record for a pass holder, and keeping the
// pass records (name, mobile, email, company) in line when the user is edited.

const AppError = require("../utils/AppError");
const mail = require("../integrations/email");
const Pass = require("../models/Pass");
const PassUser = require("../models/PassUser");
const PassVehicle = require("../models/PassVehicle");

const MOBILE = /^\d{10}$/;
const GST = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

// A mobile number as stored: digits only. Throws when it is not 10 digits.
const cleanMobile = (value, { required = true } = {}) => {
  const digits = text(value).replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, "");
  if (!digits && !required) return "";
  if (!MOBILE.test(digits)) throw new AppError("Mobile number must be exactly 10 digits", 400);
  return digits;
};

const cleanGst = (value) => {
  const gst = text(value).toUpperCase();
  if (gst && !GST.test(gst)) throw new AppError("That GST number does not look right (15 letters and digits)", 400);
  return gst;
};

const cleanEmail = (value) => {
  const email = text(value).toLowerCase();
  if (email && !mail.isEmail(email)) throw new AppError("Enter a valid email address", 400);
  return email;
};

// The details of a user as the screens send them, checked. Only the keys that were sent are returned.
const cleanDetails = (body, { creating = false } = {}) => {
  const out = {};
  if (body.name !== undefined || creating) {
    const name = text(body.name);
    if (name.length < 1 || name.length > 100) throw new AppError("Enter the user name (up to 100 letters)", 400);
    out.name = name;
  }
  if (body.mobile !== undefined || creating) out.mobile = cleanMobile(body.mobile);
  if (body.email !== undefined) out.email = cleanEmail(body.email);
  if (body.address !== undefined || creating) {
    const address = text(body.address);
    if (!address) throw new AppError("Enter the address", 400);
    out.address = address.slice(0, 255);
  }
  if (body.gstNumber !== undefined) out.gstNumber = cleanGst(body.gstNumber);
  return out;
};

// Finds the pass user for a mobile number (or, for old passes without one, for a name) or makes one.
// `details` can add what is missing but never overwrites what the user already has.
const ensureUser = async (companyId, details, { createdBy } = {}) => {
  const mobile = text(details.mobile);
  const name = text(details.name);
  let user = mobile
    ? await PassUser.findOne({ companyId, mobile })
    : await PassUser.findOne({ companyId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), mobile: { $in: [null, ""] } });
  if (user) {
    let changed = false;
    for (const key of ["email", "address", "gstNumber"]) {
      if (!user[key] && text(details[key])) { user[key] = text(details[key]); changed = true; }
    }
    if (!user.passCompanyId && details.passCompanyId) { user.passCompanyId = details.passCompanyId; changed = true; }
    if (changed) await user.save();
    return user;
  }
  try {
    return await PassUser.create({
      companyId, name, ...(mobile ? { mobile } : {}), email: text(details.email) || undefined,
      address: text(details.address) || undefined, gstNumber: text(details.gstNumber) || undefined,
      ...(details.passCompanyId ? { passCompanyId: details.passCompanyId } : {}), createdBy,
    });
  } catch (error) {
    if (error.code === 11000) return PassUser.findOne({ companyId, mobile }); // someone made it a moment ago
    throw error;
  }
};

// Records a vehicle against a user. A vehicle that already belongs to another user is left alone
// (returns false): the number is unique in the company.
const ensureVehicle = async (companyId, passUserId, plateNumber, vehicleType) => {
  try {
    const found = await PassVehicle.findOne({ companyId, plateNumber });
    if (found) return String(found.passUserId) === String(passUserId);
    await PassVehicle.create({ companyId, passUserId, plateNumber, vehicleType });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
};

// Makes sure every pass of the company has a pass user, and every vehicle on a pass is in the vehicle list.
// Cheap when there is nothing to do (one existence check), so the Pass Users screens call it on load.
const backfill = async (companyId) => {
  const missing = await Pass.exists({ companyId, passUserId: { $exists: false } });
  if (!missing) return 0;
  const passes = await Pass.find({ companyId, passUserId: { $exists: false } }).limit(2000);
  let done = 0;
  for (const pass of passes) {
    const user = await ensureUser(companyId, {
      name: pass.holderName, mobile: MOBILE.test(text(pass.phone)) ? pass.phone.trim() : "", email: pass.email,
      address: "", passCompanyId: pass.passCompanyId,
    }, { createdBy: pass.createdBy });
    if (!user) continue;
    pass.passUserId = user._id;
    await pass.save();
    for (const vehicle of pass.vehicles.length ? pass.vehicles : [{ number: pass.vehicleNumber, type: pass.vehicleType }]) {
      await ensureVehicle(companyId, user._id, vehicle.number, vehicle.type);
    }
    done += 1;
  }
  return done;
};

// After a user is edited, the passes show the same name, mobile, email and company.
const syncPasses = (user) => {
  const set = { holderName: user.name };
  const unset = {};
  for (const [field, value] of [["phone", user.mobile], ["email", user.email], ["passCompanyId", user.passCompanyId]]) {
    if (value) set[field] = value;
    else unset[field] = "";
  }
  return Pass.updateMany(
    { companyId: user.companyId, passUserId: user._id },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
  );
};

module.exports = { MOBILE, cleanMobile, cleanGst, cleanEmail, cleanDetails, ensureUser, ensureVehicle, backfill, syncPasses };
