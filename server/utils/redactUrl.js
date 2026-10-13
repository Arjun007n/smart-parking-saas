// Secrets that travel in a web address (the customer's booking link, a password-reset link) must not end up in
// the server's log files, so they are hidden before an address is logged.
//
//   /api/public/booking/bookings/66f...?token=abc123  ->  /api/public/booking/bookings/66f...?token=[hidden]
const SECRET_PARAMS = ["token", "key", "code", "secret", "password"];
const PATTERN = new RegExp(`([?&](?:${SECRET_PARAMS.join("|")})=)[^&#\\s"]*`, "gi");

const redactUrl = (value) => (typeof value === "string" ? value.replace(PATTERN, "$1[hidden]") : value);

module.exports = { redactUrl, SECRET_PARAMS };
