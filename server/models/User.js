const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { ROLES } = require("../config/permissions");

const userSchema = new mongoose.Schema(
  {
    // Empty only for SUPER_ADMIN (platform level, not tied to a tenant).
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required() {
        return this.role !== ROLES.SUPER_ADMIN;
      },
    },
    // Locations this user may work at. Ignored for company-wide roles.
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // A user signs in with an email, or with a Login ID plus the company code, or both. Needs at least one of them.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      required() {
        return !this.loginId;
      },
    },
    // Chosen by the company admin; unique inside the company only (the company code makes it global).
    loginId: { type: String, lowercase: true, trim: true, minlength: 3, maxlength: 30, match: /^[a-z0-9][a-z0-9._-]*$/ },
    phone: { type: String, trim: true, maxlength: 20 },
    // True when the number was proven with a text-message code at signup (see services/otpService.js).
    phoneVerified: { type: Boolean, default: false },
    password: { type: String, required: true, minlength: 8, select: false },
    // The built-in role: rank and location scope always come from this one.
    role: { type: String, enum: Object.values(ROLES), required: true },
    // Optional custom role (see models/Role.js). When set, it decides the
    // permissions; `role` then holds the custom role's base role.
    customRoleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role" },
    // Lanes (gates) this user may work. A location with no entry here is open to all of its lanes;
    // as soon as there is one, only the listed lanes of that location can be used.
    lanes: [{ _id: false, locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true }, gate: { type: String, required: true, trim: true, maxlength: 50 } }],
    isActive: { type: Boolean, default: true },
    // What this person is allowed to see and do at the gate, chosen by the admin on the Users page.
    // Anything not set is allowed, so users made before these switches existed work as they did.
    access: {
      // May print a ticket or receipt again (every reprint is counted per operator).
      reprint: { type: Boolean },
      // Which money figures the collection screens show them: what was taken at entry (advances),
      // at exit, and the total with the ways of paying.
      showEntryCollection: { type: Boolean },
      showExitCollection: { type: Boolean },
      showTotalCollection: { type: Boolean },
    },
    // Which in-app alerts are also sent to this person's email (admins only; see services/emailService.js).
    emailAlerts: { type: String, enum: ["OFF", "CRITICAL", "IMPORTANT", "ALL"], default: "CRITICAL" },
    // The same choice for text messages (SMS/WhatsApp) to the phone on this profile (see services/messageService.js).
    phoneAlerts: { type: String, enum: ["OFF", "CRITICAL", "IMPORTANT", "ALL"], default: "CRITICAL" },
    // Increased to invalidate all existing login tokens of this user.
    tokenVersion: { type: Number, default: 0 },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    lastLoginAt: Date,
    // Wrong-password counter and temporary lock (see services/loginGuard.js).
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { name: "email_unique", unique: true, partialFilterExpression: { email: { $type: "string" } } });
userSchema.index({ companyId: 1, loginId: 1 }, { name: "login_id_per_company", unique: true, partialFilterExpression: { loginId: { $type: "string" } } });
userSchema.index({ companyId: 1, role: 1, isActive: 1 });
userSchema.index({ companyId: 1, locationIds: 1 });
userSchema.index({ customRoleId: 1 }, { sparse: true });

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.set("toJSON", {
  transform(doc, ret) {
    delete ret.password;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpires;
    delete ret.tokenVersion;
    delete ret.failedLogins;
    delete ret.lockedUntil;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
