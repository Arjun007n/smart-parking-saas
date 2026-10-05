// A signed-in user edits their own name and mobile number (My profile).
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, assert } = require("./helpers");
const AuditLog = require("../models/AuditLog");

setup();

const s = {};

it("setup: a company with an admin", async () => {
  s.a = await registerCompany("prof");
});

it("the user can change their own name and mobile number", async () => {
  const res = await api("PUT", "/api/auth/profile", { token: s.a.token, body: { name: "  New Name ", phone: "+91 98765-43210" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.user.name, "New Name");
  assert.equal(res.body.data.user.phone, "+91 98765-43210");
  const me = await api("GET", "/api/auth/me", { token: s.a.token });
  assert.equal(me.body.data.user.name, "New Name");
  assert.equal(me.body.data.user.phone, "+91 98765-43210");
  assert.ok((await AuditLog.find({ companyId: s.a.company._id, action: "AUTH_PROFILE_CHANGED" })).length >= 1);
});

it("the mobile number can be cleared; bad values are refused; the email, role and company cannot be set", async () => {
  const cleared = await api("PUT", "/api/auth/profile", { token: s.a.token, body: { name: "New Name", phone: "" } });
  assert.equal(cleared.status, 200);
  assert.ok(!cleared.body.data.user.phone);
  assert.equal((await api("PUT", "/api/auth/profile", { token: s.a.token, body: { name: "N" } })).status, 400);
  assert.equal((await api("PUT", "/api/auth/profile", { token: s.a.token, body: { name: "Fine Name", phone: "abc" } })).status, 400);
  assert.equal((await api("PUT", "/api/auth/profile", { body: { name: "Fine Name" } })).status, 401);

  const before = (await api("GET", "/api/auth/me", { token: s.a.token })).body.data.user;
  const sneaky = await api("PUT", "/api/auth/profile", {
    token: s.a.token, body: { name: "Fine Name", email: "other@example.com", role: "SUPER_ADMIN", companyId: "000000000000000000000000" },
  });
  assert.equal(sneaky.status, 200);
  const after = (await api("GET", "/api/auth/me", { token: s.a.token })).body.data.user;
  assert.equal(after.email, before.email);
  assert.equal(after.role, before.role);
  assert.equal(after.companyId, before.companyId);
});
