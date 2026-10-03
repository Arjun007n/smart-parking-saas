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
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true },
    isActive: { type: Boolean, default: true },
    // Increased to invalidate all existing login tokens of this user.
    tokenVersion: { type: Number, default: 0 },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.index({ companyId: 1, role: 1, isActive: 1 });
userSchema.index({ companyId: 1, locationIds: 1 });

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
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
