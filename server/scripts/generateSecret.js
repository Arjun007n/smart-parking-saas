// Prints a new random JWT_SECRET (96 hex characters). Copy it into the hosting service's secret settings (or
// server/.env on your own computer). Changing the secret signs everybody out once.
//   node scripts/generateSecret.js
console.log(require("crypto").randomBytes(48).toString("hex"));
