const AppError = require("../utils/AppError");
const Hardware = require("../models/Hardware");
const Company = require("../models/Company");
const { KEY_PREFIX, hashKey, touchDevice } = require("../services/hardwareService");

const BLOCKED_SUBSCRIPTIONS = ["SUSPENDED", "CANCELLED"];

// Authenticates a device (camera, barrier controller, printer or the gate
// agent acting for it) by its own key, sent as:
//
//     x-device-key: hwk_...        (or  Authorization: Device hwk_... )
//
// Devices never use a user login or token. After this, `req.device` is the
// device and the request is locked to the device's company, exactly like a
// normal user's request is locked to theirs.
const deviceAuth = async (req, res, next) => {
  let key = req.headers["x-device-key"];
  const authorization = req.headers.authorization;
  if (!key && typeof authorization === "string" && authorization.startsWith("Device ")) {
    key = authorization.slice(7).trim();
  }
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX) || key.length > 100) {
    return next(new AppError("A device key is required", 401));
  }

  const device = await Hardware.findOne({ keyHash: hashKey(key) });
  if (!device || !device.isActive) return next(new AppError("Invalid device key", 401));

  // Same rule as for people: a suspended or inactive company's devices go quiet.
  const company = await Company.findById(device.companyId).select("isActive subscriptionStatus");
  if (!company || !company.isActive || BLOCKED_SUBSCRIPTIONS.includes(company.subscriptionStatus)) {
    return next(new AppError("Company account is not active", 403));
  }

  req.device = device;
  req.companyId = device.companyId;
  req.tenantFilter = { companyId: device.companyId };

  const agent = req.headers["x-agent-version"];
  await touchDevice(device, { ip: req.ip, agentVersion: typeof agent === "string" ? agent.slice(0, 40) : undefined });
  next();
};

module.exports = { deviceAuth };
