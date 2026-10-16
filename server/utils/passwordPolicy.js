const AppError = require("./AppError");

// The passwords that attackers try first. Length (8 to 72) is already enforced by the request rules; this adds
// a refusal of the most common choices, with a message the person can act on.
const COMMON = new Set([
  "12345678", "123456789", "1234567890", "11111111", "00000000", "87654321", "password", "password1", "password12",
  "password123", "passw0rd", "p@ssw0rd", "qwertyui", "qwerty123", "qwertyuiop", "iloveyou", "abcd1234", "abc12345",
  "admin123", "admin1234", "welcome1", "welcome123", "letmein1", "letmein123", "changeme", "changeme1", "parking123",
  "smartparking", "smartparking1", "11223344", "12341234", "1q2w3e4r", "1qaz2wsx", "asdfghjk", "zxcvbnm1",
]);

const isCommonPassword = (value) => {
  // Exact match only: "password123" is refused, "Password123" is a different, longer-tried choice that is allowed.
  const text = String(value || "");
  if (COMMON.has(text)) return true;
  // The same character repeated ("aaaaaaaa") or a plain run of digits ("23456789").
  if (/^(.)\1+$/.test(text)) return true;
  if (/^\d+$/.test(text) && ("0123456789".includes(text) || "9876543210".includes(text))) return true;
  return false;
};

const assertNotCommon = (value) => {
  if (isCommonPassword(value)) throw new AppError("That password is too easy to guess. Choose something less common.", 400);
};

module.exports = { isCommonPassword, assertNotCommon };
