const mongoose = require("mongoose");
const { CUSTOM_BASE_ROLES, GRANTABLE_PERMISSIONS } = require("../config/permissions");

// A role a company defines itself, for example "Shift supervisor" or
// "Accounts (reports only)". It is a named bundle of permissions on top of one
// built-in base role (see config/permissions.js). The base role cannot be
// changed after creation, so the users who hold the role never get out of step.
const roleSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    // Lower-case copy of the name: names are unique per company, ignoring case.
    nameKey: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 300 },
    baseRole: { type: String, enum: CUSTOM_BASE_ROLES, required: true },
    permissions: [{ type: String, enum: GRANTABLE_PERMISSIONS }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

roleSchema.index({ companyId: 1, nameKey: 1 }, { unique: true });

roleSchema.pre("validate", function setNameKey() {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

roleSchema.set("toJSON", {
  transform(doc, ret) {
    delete ret.nameKey;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Role", roleSchema);
