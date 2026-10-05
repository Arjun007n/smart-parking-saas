const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const make = (scope) => ({
  info: (...args) => console.log(stamp(), `[${scope}]`, ...args),
  warn: (...args) => console.warn(stamp(), `[${scope}]`, "WARN", ...args),
  error: (...args) => console.error(stamp(), `[${scope}]`, "ERROR", ...args),
});
module.exports = { make };
