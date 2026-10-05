// CCTV camera adapter layer.
//
// A CCTV camera does not read plates and does not talk to the cloud. When a vehicle
// enters or leaves, the server asks the camera at that gate for a picture; the gate
// agent fetches a snapshot from the camera (its own address and password stay at
// the site) and uploads it to the ticket's photos. A snapshot is only useful close
// to the moment, so the command expires quickly.

const COMMAND_DEFAULTS = Object.freeze({
  CAPTURE_SNAPSHOT: { ttlSeconds: 90, ackTimeoutSeconds: 25, maxAttempts: 2 },
  SNAPSHOT_TEST: { ttlSeconds: 120, ackTimeoutSeconds: 25, maxAttempts: 2 },
});

// `kind` is the photo kind to file the picture under: ENTRY or EXIT.
const buildSnapshotCommand = ({ kind, sessionId }) => ({
  type: "CAPTURE_SNAPSHOT",
  payload: { kind, sessionId: String(sessionId) },
  ...COMMAND_DEFAULTS.CAPTURE_SNAPSHOT,
});

const buildSnapshotTest = () => ({ type: "SNAPSHOT_TEST", payload: {}, ...COMMAND_DEFAULTS.SNAPSHOT_TEST });

module.exports = { COMMAND_DEFAULTS, buildSnapshotCommand, buildSnapshotTest };
