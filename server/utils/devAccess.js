// Developer conveniences (the password-reset token in the API answer, error details) are meant for the
// developer sitting at this computer. This helper says whether the caller is that developer: the server
// must be in development or test mode AND the connection must come from this same computer.
//
// It looks at the real network address of the connection, never at headers such as X-Forwarded-For, which
// anyone can type. A phone or another computer on the Wi-Fi therefore never gets these extras, even when the
// server is running in development mode and reachable on the network.
const env = require("../config/env");

const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;

const isLoopbackAddress = (address) => LOOPBACK.test(String(address || ""));

// A request without a socket (a hand-made object in a unit test) counts as local.
const isLocalCaller = (req) => {
  const socket = req && req.socket;
  if (!socket) return true;
  return isLoopbackAddress(socket.remoteAddress);
};

const devAccess = (req) => env.isDevLike && isLocalCaller(req);

module.exports = { devAccess, isLocalCaller, isLoopbackAddress };
