// Slows down password guessing against one account, whatever IP addresses
// the guesses come from (the per-IP rate limit cannot see that).
//
// After MAX_FAILED wrong passwords in a row the account is locked for
// LOCK_MINUTES. A correct password after the lock ends resets the counter.

const bcrypt = require("bcryptjs");

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

const isLocked = (user, now = new Date()) => Boolean(user.lockedUntil && user.lockedUntil > now);

const minutesLeft = (user, now = new Date()) =>
  Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000));

// What to store after a wrong password.
const afterFailure = (failedLogins = 0, now = new Date()) => {
  const count = failedLogins + 1;
  return count >= MAX_FAILED
    ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60000) }
    : { failedLogins: count };
};

// A real bcrypt hash of a random value. Logins for unknown emails are checked
// against it so they take as long as logins for real accounts, which stops
// the response time from revealing which emails are registered.
let dummyHash;
const getDummyHash = async () => {
  if (!dummyHash) dummyHash = await bcrypt.hash(`unused-${Math.random()}-${Date.now()}`, 12);
  return dummyHash;
};
const burnTime = async (password) => bcrypt.compare(String(password), await getDummyHash());

module.exports = { MAX_FAILED, LOCK_MINUTES, isLocked, minutesLeft, afterFailure, burnTime };
