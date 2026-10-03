const AuditLog = require("../models/AuditLog");

// Writes an audit entry. Never throws: a failed audit write must not break
// the user's request, but it is reported in the server log.
const record = async (req, action, details = {}) => {
  try {
    const actor = details.actor || req.user;
    await AuditLog.create({
      companyId: details.companyId || req.companyId || (actor && actor.companyId) || undefined,
      actorId: actor ? actor._id : undefined,
      actorEmail: actor ? actor.email : details.email,
      action,
      entity: details.entity,
      entityId: details.entityId,
      meta: details.meta,
      ip: req.ip,
      userAgent: (req.headers["user-agent"] || "").slice(0, 300),
    });
  } catch (error) {
    console.error(`Audit log failed for ${action}:`, error.message);
  }
};

module.exports = { record };
