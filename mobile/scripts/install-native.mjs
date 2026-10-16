// Copies the app's phone features (mobile/native/android) into the generated Android project and wires them in:
// the Java files, MainActivity, the scanner library and the Bluetooth permissions. Safe to run again and again.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packagePath, patchGradle, patchMainActivity, patchMinify, patchNativeManifest, patchProguard, patchProguardRules, withPackage } from "./native.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { appId } = require(path.join(root, "capacitor.config.js"));

const main = path.join(root, "android", "app", "src", "main");
const gradle = path.join(root, "android", "app", "build.gradle");
if (!existsSync(main) || !existsSync(gradle)) {
  console.error("\nThere is no Android project yet. Run `npx cap add android` once, then `npm run sync`.\n");
  process.exit(1);
}

const edit = (file, change) => {
  const before = readFileSync(file, "utf8");
  const after = change(before);
  if (after !== before) writeFileSync(file, after);
  return after !== before;
};

const javaDir = path.join(main, "java", packagePath(appId));
if (!existsSync(path.join(javaDir, "MainActivity.java"))) {
  console.error(`\nMainActivity.java was not found in ${javaDir}. Is the appId in capacitor.config.js the one the Android project was made with?\n`);
  process.exit(1);
}

const source = path.join(root, "native", "android");
mkdirSync(javaDir, { recursive: true });
for (const name of readdirSync(source).filter((file) => file.endsWith(".java"))) {
  const target = path.join(javaDir, name);
  const text = withPackage(readFileSync(path.join(source, name), "utf8"), appId);
  if (!existsSync(target) || readFileSync(target, "utf8") !== text) writeFileSync(target, text);
}

edit(path.join(javaDir, "MainActivity.java"), patchMainActivity);
edit(gradle, patchGradle);
edit(path.join(main, "AndroidManifest.xml"), patchNativeManifest);

// The plugins' own Android build files (in node_modules) and the app's.
edit(gradle, patchProguard);
// Release builds are shrunk with R8 (the keep rules go in proguard-rules.pro). Set APP_MINIFY=0 to leave it off.
if (process.env.APP_MINIFY !== "0") {
  edit(gradle, patchMinify);
  const rules = path.join(root, "android", "app", "proguard-rules.pro");
  if (existsSync(rules)) edit(rules, (text) => patchProguardRules(text, appId));
}
const modules = path.join(root, "node_modules");
const pluginFiles = [];
if (existsSync(modules)) {
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const scoped = entry.name.startsWith("@") ? readdirSync(path.join(modules, entry.name)).map((name) => path.join(modules, entry.name, name)) : [path.join(modules, entry.name)];
    for (const dir of scoped) pluginFiles.push(path.join(dir, "android", "build.gradle"));
  }
}
for (const file of pluginFiles.filter((f) => existsSync(f))) edit(file, patchProguard);
console.log("Phone features installed: Bluetooth printer, QR scanner and number plate reader.");
