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
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 20 },
    // True when the number was proven with a text-message code at signup (see services/otpService.js).
    phoneVerified: { type: Boolean, default: false },
    password: { type: String, required: true, minlength: 8, select: false },
    // The built-in role: rank and location scope always come from this one.
    role: { type: String, enum: Object.values(ROLES), required: true },
    // Optional custom role (see models/Role.js). When set, it decides the
    // permissions; `role` then holds the custom role's base role.
    customRoleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role" },
    isActive: { type: Boolean, default: true },
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
