// Proving a person owns a mobile number, by texting them a 6 digit code (used when a company signs up).
//
//   send(phone)           texts a new code (limited: 30 seconds between texts, 5 texts an hour per number)
//   verify(phone, code)   checks it (5 tries per code) and hands back a short-lived proof, `phoneToken`
//   assertProof(token, phone)   used by registration: the proof must be ours and for this very number
//
// It runs only when SIGNUP_OTP=on, which needs text messages set up (MESSAGING_PROVIDER). The code is
// never stored (only a keyed hash), never logged, and never returned, except by the development
// simulator so the flow can be tried without a phone.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const AppError = require("../utils/AppError");
const env = require("../config/env");
const messaging = require("../integrations/messaging");
const Otp = require("../models/Otp");
const caps = require("../utils/messageCaps");

const PURPOSE = "SIGNUP";
const CODE_MINUTES = 10;
const RESEND_SECONDS = 30;
const SENDS_PER_HOUR = 5;
const MAX_TRIES = 5;
const PROOF_MINUTES = 30;

const required = () => String(process.env.SIGNUP_OTP || "off").trim().toLowerCase() === "on";
// Shown to the signup page: is a code needed, and can one be sent.
const options = () => ({ otpRequired: required() && messaging.isEnabled() });

const hashCode = (phone, code) => crypto.createHmac("sha256", env.jwtSecret).update(`otp:${PURPOSE}:${phone}:${code}`).digest("hex");
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

const phoneOf = (value) => {
  const phone = messaging.normalizePhone(value);
  if (!phone) throw new AppError("Enter a valid mobile number", 400);
  return phone;
};

// `showDevCode`: the practice code may be put in the answer (only the developer at this computer gets it).
const send = async (value, { showDevCode = true } = {}) => {
  if (!required() || !messaging.isEnabled()) throw new AppError("Mobile verification is not switched on", 409);
  const phone = phoneOf(value);
  const now = Date.now();
  const code = newCode();

  // A platform-wide budget for verification texts per hour (stops a flood of sign-up requests from running up
  // the text-message bill). Generous by default: OTP_SENDS_PER_HOUR_TOTAL.
  const hourlyTotal = Number(process.env.OTP_SENDS_PER_HOUR_TOTAL) >= 1 ? Math.floor(Number(process.env.OTP_SENDS_PER_HOUR_TOTAL)) : 300;
  if (!caps.take("otp:total", hourlyTotal, 3600 * 1000)) {
    throw new AppError("Too many codes are being requested right now. Please try again in a few minutes.", 429);
  }

  let record = await Otp.findOne({ phone, purpose: PURPOSE });
  if (record) {
    const sinceLast = (now - record.lastSentAt.getTime()) / 1000;
    if (sinceLast < RESEND_SECONDS) {
      throw new AppError(`Please wait ${Math.ceil(RESEND_SECONDS - sinceLast)} seconds before asking for another code`, 429);
    }
    const freshWindow = now - record.windowStartedAt.getTime() >= 3600 * 1000;
    if (!freshWindow && record.sentCount >= SENDS_PER_HOUR) {
      throw new AppError("Too many codes were sent to this number. Please try again in an hour.", 429);
    }
    // One step that only succeeds if nobody else asked for a code since we read the record. Two requests sent at
    // the same moment therefore cannot both pass the waiting time or the hourly count.
    const updated = await Otp.findOneAndUpdate(
      { _id: record._id, lastSentAt: record.lastSentAt, sentCount: record.sentCount },
      {
        $set: {
          codeHash: hashCode(phone, code), attempts: 0, expiresAt: new Date(now + CODE_MINUTES * 60000), lastSentAt: new Date(now),
          sentCount: freshWindow ? 1 : record.sentCount + 1, ...(freshWindow ? { windowStartedAt: new Date(now) } : {}),
        },
      },
      { new: true }
    );
    if (!updated) throw new AppError(`Please wait ${RESEND_SECONDS} seconds before asking for another code`, 429);
    record = updated;
  } else {
    try {
      record = await Otp.create({ phone, purpose: PURPOSE, codeHash: hashCode(phone, code), expiresAt: new Date(now + CODE_MINUTES * 60000) });
    } catch (error) {
      // Another request created the record a moment before this one.
      if (error && error.code === 11000) throw new AppError(`Please wait ${RESEND_SECONDS} seconds before asking for another code`, 429);
      throw error;
    }
  }

  const result = await messaging.send({
    to: phone,
    body: `${code} is your Smart Parking verification code. It works for ${CODE_MINUTES} minutes. Do not share it with anyone.`,
    key: `otp:${record._id}:${record.sentCount}:${record.lastSentAt.getTime()}`,
  });
  if (!result.sent) {
    // Let the person ask again at once: the failed text should not count against them.
    await Otp.deleteOne({ _id: record._id });
    throw new AppError("We could not send the text message. Check the number and try again.", 502);
  }
  const showCode = showDevCode && env.isDevLike && messaging.providerName() === "simulated";
  return { phone, expiresInMinutes: CODE_MINUTES, resendInSeconds: RESEND_SECONDS, ...(showCode ? { devCode: code } : {}) };
};

const verify = async (value, code) => {
  if (!required()) throw new AppError("Mobile verification is not switched on", 409);
  const phone = phoneOf(value);
  const wrong = new AppError("That code is not right, or it has expired. Ask for a new one.", 400);
  const record = await Otp.findOne({ phone, purpose: PURPOSE });
  if (!record || record.expiresAt <= new Date()) throw wrong;
  // Count this try first, in one step, so many tries sent at the same moment cannot all slip under the limit.
  const counted = await Otp.findOneAndUpdate({ _id: record._id, attempts: { $lt: MAX_TRIES } }, { $inc: { attempts: 1 } }, { new: true });
  if (!counted) {
    await Otp.deleteOne({ _id: record._id });
    throw new AppError("Too many wrong codes. Ask for a new one.", 429);
  }
  const given = Buffer.from(hashCode(phone, String(code || "").trim()));
  const real = Buffer.from(record.codeHash);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) throw wrong;
  // A code works once: only the request that removes it gets the proof.
  const removed = await Otp.deleteOne({ _id: record._id, codeHash: record.codeHash });
  if (!removed || removed.deletedCount !== 1) throw wrong;
  const phoneToken = jwt.sign({ purpose: "phone-verified", phone }, env.jwtSecret, { algorithm: "HS256", expiresIn: `${PROOF_MINUTES}m` });
  return { phone, phoneToken };
};

// For registration: throws unless `token` proves this number was verified a moment ago.
const assertProof = (token, value) => {
  const phone = phoneOf(value);
  let payload;
  try {
    payload = jwt.verify(String(token || ""), env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    throw new AppError("Verify your mobile number first", 400);
  }
  if (payload.purpose !== "phone-verified" || payload.phone !== phone) throw new AppError("Verify your mobile number first", 400);
  return phone;
};

module.exports = { required, options, send, verify, assertProof, CODE_MINUTES, RESEND_SECONDS, SENDS_PER_HOUR, MAX_TRIES };
