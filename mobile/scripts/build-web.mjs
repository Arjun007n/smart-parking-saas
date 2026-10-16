// Builds the website (../client) into mobile/web with the server address built in, ready for `cap sync`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import appEnv from "./appEnv.cjs";
import { injectCsp, mobileCsp } from "./csp.mjs";
const { checkApiUrl, readAppEnv } = appEnv;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let settings;
try {
  settings = checkApiUrl(readAppEnv(root));
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

console.log(`Building the website for the app. Server: ${settings.api}${settings.dev ? "  (test mode)" : ""}`);
const result = spawnSync("npm", ["run", "build", "--", "--outDir", "../mobile/web", "--emptyOutDir"], {
  cwd: path.join(root, "..", "client"),
  env: { ...process.env, VITE_API_URL: settings.api, VITE_APP_DEV: settings.dev ? "1" : "" },
  stdio: "inherit",
  shell: true, // npm is npm.cmd on Windows
});
if (result.status !== 0) {
  console.error("\nThe website build failed (see above). Run `npm install` in the client folder, then try again.\n");
  process.exit(result.status || 1);
}

// Release builds get a content security policy in the app's copy of index.html (see scripts/csp.mjs).
// APP_CSP=0 leaves it out. Test mode (APP_DEV=1) never gets one.
const page = path.join(root, "web", "index.html");
if (!settings.dev && process.env.APP_CSP !== "0" && existsSync(page)) {
  const html = readFileSync(page, "utf8");
  const out = injectCsp(html, mobileCsp({ api: settings.api }));
  if (out !== html) writeFileSync(page, out);
  console.log("Added a content security policy to the app's index.html.");
}
