// Applies the safe manifest settings (scripts/manifest.mjs) to the generated Android project.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import appEnv from "./appEnv.cjs";
import { hardenManifest, networkSecurityConfig } from "./manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
if (!existsSync(file)) {
  console.error("\nThere is no Android project yet. Run `npx cap add android` once, then `npm run sync`.\n");
  process.exit(1);
}
const dev = appEnv.readAppEnv(root).APP_DEV === "1";
const before = readFileSync(file, "utf8");
const after = hardenManifest(before, { dev });
if (after !== before) writeFileSync(file, after);
// The network security rule the manifest points to: plain http off (on only in test mode).
const xmlDir = path.join(root, "android", "app", "src", "main", "res", "xml");
const netFile = path.join(xmlDir, "network_security_config.xml");
const net = networkSecurityConfig({ dev });
mkdirSync(xmlDir, { recursive: true });
if (!existsSync(netFile) || readFileSync(netFile, "utf8") !== net) writeFileSync(netFile, net);
console.log(`Android manifest: backup off, plain http ${dev ? "ALLOWED (test mode)" : "blocked"}${after === before ? " (already set)" : ""}.`);
