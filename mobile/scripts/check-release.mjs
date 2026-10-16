// `npm run check:release` - run it before you generate the signed bundle. It stops (exit 1) when the project
// is set up for testing instead of for release:
//   * APP_DEV=1 (test mode),
//   * API_URL is plain http or a private address,
//   * the generated Android project allows plain http, cloud backup or debugging,
//   * the network security config is missing or allows plain http.
// A project in test mode is fixed by clearing APP_DEV, setting the public https API_URL and running `npm run sync`.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import appEnv from "./appEnv.cjs";

const { checkApiUrl, readAppEnv } = appEnv;

// Returns a list of problems (empty = fine). Pure: every input is passed in, so it can be tested.
//   env              { API_URL, APP_DEV }
//   manifest         text of AndroidManifest.xml, or null when there is no android project
//   networkConfig    text of res/xml/network_security_config.xml, or null when missing
//   gradle           text of android/app/build.gradle, or null (only used for a warning)
export const checkRelease = ({ env, manifest = null, networkConfig = null, gradle = null }) => {
  const problems = [];
  const warnings = [];
  if (String(env.APP_DEV || "").trim() === "1") {
    problems.push("APP_DEV=1 is set (test mode). Clear APP_DEV in app.env and in your environment.");
  }
  try {
    // Checked as a release even when APP_DEV=1, so a plain http / private address is always reported.
    checkApiUrl({ API_URL: env.API_URL, APP_DEV: "" });
  } catch (error) {
    problems.push(`API_URL: ${error.message}`);
  }
  if (manifest !== null) {
    const attr = (name) => {
      const m = new RegExp(`${name.replace(":", "\\:")}\\s*=\\s*(["'])([^"']*)\\1`).exec(manifest);
      return m ? m[2] : null;
    };
    if (attr("android:usesCleartextTraffic") === "true") problems.push('AndroidManifest.xml has usesCleartextTraffic="true". Run `npm run sync` with APP_DEV cleared.');
    if (attr("android:allowBackup") !== "false") problems.push('AndroidManifest.xml does not have allowBackup="false". Run `npm run sync`.');
    if (attr("android:debuggable") !== null) problems.push("AndroidManifest.xml sets android:debuggable. Run `npm run sync` (it removes it).");
    if (attr("android:networkSecurityConfig") !== "@xml/network_security_config") {
      problems.push("AndroidManifest.xml does not use the network security config. Run `npm run sync`.");
    }
    if (networkConfig === null) problems.push("res/xml/network_security_config.xml is missing. Run `npm run sync`.");
    else if (/cleartextTrafficPermitted\s*=\s*["']true["']/.test(networkConfig)) {
      problems.push('network_security_config.xml allows plain http (cleartextTrafficPermitted="true"). Run `npm run sync` with APP_DEV cleared.');
    }
    if (gradle !== null && !/\brelease\s*\{[^}]*?minifyEnabled\s+true/.test(gradle)) {
      warnings.push("The release build is not minified (minifyEnabled is not true). Run `npm run sync` (unless you set APP_MINIFY=0 on purpose).");
    }
  }
  return { problems, warnings };
};

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

const run = () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const main = path.join(root, "android", "app", "src", "main");
  const hasAndroid = existsSync(path.join(root, "android"));
  const { problems, warnings } = checkRelease({
    env: readAppEnv(root),
    manifest: hasAndroid ? read(path.join(main, "AndroidManifest.xml")) ?? "" : null,
    networkConfig: read(path.join(main, "res", "xml", "network_security_config.xml")),
    gradle: read(path.join(root, "android", "app", "build.gradle")),
  });
  if (!hasAndroid) console.log("Note: there is no android/ project yet, so only app.env was checked.");
  warnings.forEach((w) => console.warn(`WARNING: ${w}`));
  if (problems.length) {
    console.error("\nNOT READY FOR RELEASE:");
    problems.forEach((p) => console.error(`  - ${p}`));
    console.error("");
    process.exit(1);
  }
  console.log("Release check passed: production settings, https server address, plain http and backup off.");
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
