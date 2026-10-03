const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");

// `tv` is the user's tokenVersion. Bumping it on the user (logout, password
// change, deactivation) invalidates every token issued before.
const signToken = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

const verifyToken = (token) => jwt.verify(token, env.jwtSecret);

const hashToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

// Returns the raw token (sent to the user) and its hash (stored in the DB).
const createResetToken = () => {
  const raw = crypto.randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
};

module.exports = { signToken, verifyToken, hashToken, createResetToken };
