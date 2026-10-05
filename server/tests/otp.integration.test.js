// Signing up with a code texted to the mobile number (SIGNUP_OTP=on, simulated messages). Needs MongoDB.
const { setup, it, api, assert } = require("./helpers");
const messaging = require("../integrations/messaging");
const Otp = require("../models/Otp");
const User = require("../models/User");

setup();

const s = {};
const register = (body) => api("POST", "/api/auth/register", { body: { companyName: "Otp Parking", name: "Owner", password: "Password123", ...body } });
const send = (phone) => api("POST", "/api/auth/otp/send", { body: { phone } });
const verify = (phone, code) => api("POST", "/api/auth/otp/verify", { body: { phone, code } });
const codeOf = (message) => /^(\d{6}) is your Smart Parking verification code/.exec(message.body)[1];

it("setup: messages on (simulated), mobile check off, then on", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  process.env.SIGNUP_OTP = "off";
  messaging.outbox.length = 0;
  const off = await api("GET", "/api/auth/signup-options");
  assert.equal(off.status, 200);
  assert.equal(off.body.data.otpRequired, false);
  // With the check off, signup works as before, with or without a phone.
  assert.equal((await register({ email: "otp-off@example.com" })).status, 201);
  assert.equal((await send("98765 43210")).status, 409, "no codes are sent while the check is off");

  process.env.SIGNUP_OTP = "on";
  const on = await api("GET", "/api/auth/signup-options");
  assert.equal(on.body.data.otpRequired, true);
});

it("the check is reported as off when no message service is set up", async () => {
  process.env.MESSAGING_PROVIDER = "none";
  assert.equal((await api("GET", "/api/auth/signup-options")).body.data.otpRequired, false);
  process.env.MESSAGING_PROVIDER = "simulated";
});

it("registering without a verified number is refused", async () => {
  const noPhone = await register({ email: "otp-1@example.com" });
  assert.equal(noPhone.status, 400);
  assert.match(noPhone.body.message, /mobile number/i);
  const noProof = await register({ email: "otp-1@example.com", phone: "9876543210" });
  assert.equal(noProof.status, 400);
  assert.match(noProof.body.message, /Verify your mobile number/);
  const fake = await register({ email: "otp-1@example.com", phone: "9876543210", phoneToken: "not-a-token" });
  assert.equal(fake.status, 400);
  assert.equal(await User.countDocuments({ email: "otp-1@example.com" }), 0);
});

it("a bad number is refused; a good one gets a text with a 6 digit code", async () => {
  assert.equal((await send("abc")).status, 400);
  assert.equal((await send("12")).status, 400);
  messaging.outbox.length = 0;
  const sent = await send("98765 43210");
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.data.phone, "+919876543210");
  assert.equal(sent.body.data.expiresInMinutes, 10);
  assert.match(sent.body.data.devCode, /^\d{6}$/, "the simulator shows the code so the flow can be tried");
  assert.equal(messaging.outbox.length, 1);
  assert.equal(messaging.outbox[0].to, "+919876543210");
  assert.equal(codeOf(messaging.outbox[0]), sent.body.data.devCode);
  s.code = sent.body.data.devCode;

  const stored = await Otp.findOne({ phone: "+919876543210" });
  assert.ok(stored);
  assert.ok(!JSON.stringify(stored.toObject()).includes(s.code), "the code itself is never stored");
});

it("asking again at once is slowed down", async () => {
  const again = await send("9876543210");
  assert.equal(again.status, 429);
  assert.match(again.body.message, /wait/i);
});

it("a wrong code is refused and counted; the right one gives a proof once", async () => {
  const wrong = await verify("9876543210", s.code === "000000" ? "111111" : "000000");
  assert.equal(wrong.status, 400);
  const right = await verify("+91 98765 43210", s.code);
  assert.equal(right.status, 200, JSON.stringify(right.body));
  assert.equal(right.body.data.phone, "+919876543210");
  assert.ok(right.body.data.phoneToken.length > 40);
  s.token = right.body.data.phoneToken;
  const reuse = await verify("9876543210", s.code);
  assert.equal(reuse.status, 400, "a code works once");
});

it("the proof is only good for the number it was made for, and cannot log anyone in", async () => {
  const other = await register({ email: "otp-2@example.com", phone: "9000000001", phoneToken: s.token });
  assert.equal(other.status, 400);
  const asLogin = await api("GET", "/api/auth/me", { token: s.token });
  assert.equal(asLogin.status, 401, "the proof is not a login token");
});

it("with the proof, signup works, and the number is saved verified in its full form", async () => {
  const ok = await register({ email: "otp-3@example.com", phone: "09876543210", phoneToken: s.token });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.data.user.phone, "+919876543210");
  assert.equal(ok.body.data.user.phoneVerified, true);
  assert.equal(ok.body.data.company.billingContact.phone, "+919876543210");
});

it("five wrong codes use a code up", async () => {
  const phone = "9811111111";
  const sent = await send(phone);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const wrong = sent.body.data.devCode === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i += 1) assert.equal((await verify(phone, wrong)).status, 400);
  const sixth = await verify(phone, sent.body.data.devCode);
  assert.equal(sixth.status, 429, "even the right code is refused after five wrong ones");
  assert.equal(await Otp.countDocuments({ phone: "+919811111111" }), 0);
});

it("an expired code is refused", async () => {
  const phone = "9822222222";
  const sent = await send(phone);
  await Otp.updateOne({ phone: "+919822222222" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await verify(phone, sent.body.data.devCode)).status, 400);
});

it("a text that cannot be sent is reported, and does not use up the person's turn", async () => {
  const realSend = messaging.PROVIDERS.simulated.send;
  messaging.PROVIDERS.simulated.send = async () => { throw new Error("provider down"); };
  const failed = await send("9833333333");
  messaging.PROVIDERS.simulated.send = realSend;
  assert.equal(failed.status, 502);
  assert.equal(await Otp.countDocuments({ phone: "+919833333333" }), 0);
  const retry = await send("9833333333");
  assert.equal(retry.status, 200, "no waiting period after a failed text");
});

it("more than five codes an hour to one number are refused", async () => {
  const phone = "+919844444444";
  await Otp.create({ phone, purpose: "SIGNUP", codeHash: "x", sentCount: 5, windowStartedAt: new Date(), lastSentAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() + 600000) });
  const res = await send("9844444444");
  assert.equal(res.status, 429);
  assert.match(res.body.message, /hour/);
});

it("cleanup: the check is switched off again", async () => {
  process.env.SIGNUP_OTP = "off";
});
