const mongoose = require("mongoose");

// Append-only record of important actions. Entries are never edited or deleted
// through the application.
const auditLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorEmail: String,
    action: { type: String, required: true }, // e.g. "AUTH_LOGIN", "LOCATION_CREATE"
    entity: String,
    entityId: mongoose.Schema.Types.ObjectId,
    meta: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ companyId: 1, createdAt: -1 });
auditLogSchema.index({ companyId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

const blockChange = function blockChange() {
  throw new Error("Audit logs are append-only");
};
[
  "updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace",
  "deleteOne", "deleteMany", "findOneAndDelete",
].forEach((op) => auditLogSchema.pre(op, blockChange));
// The same for a document's own deleteOne() and for bulk writes, which skip the query hooks above.
auditLogSchema.pre("deleteOne", { document: true, query: false }, blockChange);
auditLogSchema.pre("bulkWrite", blockChange);
auditLogSchema.pre("save", function onlyNew() {
  if (!this.isNew) blockChange();
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
