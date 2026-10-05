// One place where unexpected errors are reported.
//
// Today it writes a structured line to the server log, which the hosting
// platform collects. To add an error-monitoring service (for example
// Sentry), call it from `reportError` below; nothing else needs to change.

const reportError = (error, context = {}) => {
  const entry = {
    level: "error",
    time: new Date().toISOString(),
    message: error && error.message ? error.message : String(error),
    ...context,
  };
  console.error(JSON.stringify(entry));
  if (error && error.stack && process.env.NODE_ENV !== "test") console.error(error.stack);
};

module.exports = { reportError };
