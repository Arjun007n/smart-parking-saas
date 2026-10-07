// User licences per location. The company's plan buys a number of users (`plan.maxUsers`); a company
// admin can share those seats out between locations. A location with a licence limit takes no more
// staff than that. Company-wide roles (company admin) work everywhere and use no location's seat.

const AppError = require("../utils/AppError");
const { ROLES, isCompanyWide } = require("../config/permissions");
const User = require("../models/User");
const Location = require("../models/Location");

// Active staff per location: { "<locationId>": count }.
const usedByLocation = async (companyId) => {
  const rows = await User.aggregate([
    { $match: { companyId, isActive: true, role: { $nin: [ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.GOVERNMENT_OFFICER] } } },
    { $unwind: "$locationIds" },
    { $group: { _id: "$locationIds", used: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.used]));
};

// The date the licences run to: the end of the paid period, or of the trial.
const validUpto = (company) => {
  const paid = company.subscriptionStatus === "ACTIVE" && company.subscription && company.subscription.currentPeriodEnd;
  return (paid ? company.subscription.currentPeriodEnd : company.trialEndsAt) || null;
};

// What the Users page shows: for each location the licence limit, seats in use and the valid-upto date.
const overview = async (company, locations) => {
  const used = await usedByLocation(company._id);
  const upto = validUpto(company);
  const rows = locations.map((location) => {
    const limit = location.userLicence && typeof location.userLicence.limit === "number" ? location.userLicence.limit : null;
    const count = used[String(location._id)] || 0;
    return { locationId: location._id, name: location.name, isActive: location.isActive, limit, used: count, left: limit === null ? null : Math.max(0, limit - count) };
  });
  const allotted = rows.reduce((sum, r) => sum + (r.limit || 0), 0);
  const activeUsers = await User.countDocuments({ companyId: company._id, isActive: true, role: { $ne: ROLES.GOVERNMENT_OFFICER } });
  return {
    planUsers: company.plan.maxUsers, activeUsers, allotted, validUpto: upto,
    expired: Boolean(upto && upto < new Date()), locations: rows,
  };
};

// Throws when adding the user to any of these locations would go over its licence.
// `user` is the existing user being changed (their present seats are not counted twice).
const assertRoom = async (companyId, locationIds, { user = null } = {}) => {
  if (user && isCompanyWide(user.role)) return;
  const have = new Set(user && user.isActive ? (user.locationIds || []).map(String) : []);
  const wanted = [...new Set(locationIds.map(String))].filter((id) => !have.has(id));
  if (!wanted.length) return;
  const locations = await Location.find({ _id: { $in: wanted }, companyId, "userLicence.limit": { $type: "number" } })
    .select("name userLicence").lean();
  if (!locations.length) return;
  const used = await usedByLocation(companyId);
  for (const location of locations) {
    const limit = location.userLicence.limit;
    if ((used[String(location._id)] || 0) >= limit) {
      throw new AppError(
        `${location.name} has a licence for ${limit} user${limit === 1 ? "" : "s"} and all are in use. Raise the licence or deactivate someone first.`, 403
      );
    }
  }
};

// Sets or clears (limit = null) a location's licence. The limit may not be below the staff already
// there, and the licences together may not exceed the users the plan includes.
const setLimit = async (company, location, limit) => {
  if (limit === null) {
    await Location.updateOne({ _id: location._id }, { $unset: { "userLicence.limit": 1 } });
    return;
  }
  const used = (await usedByLocation(company._id))[String(location._id)] || 0;
  if (limit < used) throw new AppError(`${location.name} already has ${used} active user${used === 1 ? "" : "s"}. Deactivate some first.`, 400);
  const others = await Location.find({ companyId: company._id, _id: { $ne: location._id }, "userLicence.limit": { $type: "number" } })
    .select("userLicence").lean();
  const total = others.reduce((sum, l) => sum + l.userLicence.limit, 0) + limit;
  if (total > company.plan.maxUsers) {
    throw new AppError(`Your plan includes ${company.plan.maxUsers} users, and the licences would add up to ${total}. Buy more users on the Billing page first.`, 400);
  }
  await Location.updateOne({ _id: location._id }, { $set: { "userLicence.limit": limit } });
};

module.exports = { usedByLocation, validUpto, overview, assertRoom, setLimit };
