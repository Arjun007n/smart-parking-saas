// Boom barrier adapter layer (plan, section 22).
//
// The server only ever says "open" or "close" for a named device. HOW that
// becomes an electrical pulse (HTTP relay, TCP relay board, USB/serial
// controller) is decided by a driver in the gate agent at the site.
//
// A barrier command is useful only for a few seconds, so it expires quickly
// and is retried a few times before being reported as failed.

const COMMAND_DEFAULTS = Object.freeze({
  BARRIER_OPEN: { ttlSeconds: 30, ackTimeoutSeconds: 6, maxAttempts: 3 },
  BARRIER_CLOSE: { ttlSeconds: 30, ackTimeoutSeconds: 6, maxAttempts: 3 },
});

const DEFAULT_PULSE_MS = 1000;

const buildBarrierCommand = (type, device, extra = {}) => {
  const defaults = COMMAND_DEFAULTS[type];
  if (!defaults) throw new Error(`${type} is not a barrier command`);
  return {
    type,
    payload: {
      action: type === "BARRIER_OPEN" ? "OPEN" : "CLOSE",
      pulseMs: (device.config && device.config.pulseMs) || DEFAULT_PULSE_MS,
      ...extra,
    },
    ...defaults,
  };
};

module.exports = { COMMAND_DEFAULTS, DEFAULT_PULSE_MS, buildBarrierCommand };
