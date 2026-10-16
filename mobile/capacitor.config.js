// The app's settings. `app.env` (see app.env.example) decides production or test mode.
//
// appId is the app's permanent name on the phone and on Google Play. It cannot be changed after the app is published,
// so decide it before the first release.
const { readAppEnv } = require("./scripts/appEnv.cjs");

const dev = readAppEnv(__dirname).APP_DEV === "1";

module.exports = {
  appId: "com.smartparking.operator",
  appName: "Smart Parking",
  // The website, built for the app by `npm run web` (scripts/build-web.mjs).
  webDir: "web",
  server: {
    // Production: the app's pages are https://localhost, so calls to an https server are never "mixed content".
    // Test mode (APP_DEV=1) talks to a server on your own network over plain http, so the pages are http://localhost.
    androidScheme: dev ? "http" : "https",
    cleartext: dev,
  },
  android: {
    allowMixedContent: false,
    // Chrome's remote inspector can read the page and the sign-in: only in test mode.
    webContentsDebuggingEnabled: dev,
    // Keep the page out from under the phone's status and navigation bars.
    adjustMarginsForEdgeToEdge: "force",
  },
};
