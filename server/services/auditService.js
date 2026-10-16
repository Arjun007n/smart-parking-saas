const AuditLog = require("../models/AuditLog");

// Writes an audit entry. Never throws: a failed audit write must not break
// the user's request, but it is reported in the server log.
const record = async (req, action, details = {}) => {
  const actor = details.actor || req.user;
  const entry = {
    companyId: details.companyId || req.companyId || (actor && actor.companyId) || undefined,
    actorId: actor ? actor._id : undefined,
    actorEmail: actor ? actor.email || actor.loginId : details.email,
    action,
    entity: details.entity,
    entityId: details.entityId,
    meta: details.meta,
    ip: req.ip,
    userAgent: ((req.headers && req.headers["user-agent"]) || "").slice(0, 300),
  };
  // A short database hiccup must not lose the record of a money change: try up to three times.
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await AuditLog.create(entry);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  // Still failing: write what happened to the server log in one line, so it can be recovered from there.
  console.error(`Audit log failed for ${action}:`, lastError && lastError.message, JSON.stringify({
    actorId: entry.actorId, entity: entry.entity, entityId: entry.entityId, companyId: entry.companyId, meta: entry.meta,
  }));
};

module.exports = { record };
