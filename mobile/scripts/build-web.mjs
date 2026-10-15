// Builds the website (../client) into mobile/web with the server address built in, ready for `cap sync`.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import appEnv from "./appEnv.cjs";
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
  env: { ...process.env, VITE_API_URL: settings.api },
  stdio: "inherit",
  shell: true, // npm is npm.cmd on Windows
});
if (result.status !== 0) {
  console.error("\nThe website build failed (see above). Run `npm install` in the client folder, then try again.\n");
  process.exit(result.status || 1);
}
