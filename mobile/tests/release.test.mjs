import test from "node:test";
import assert from "node:assert/strict";
import { checkRelease } from "../scripts/check-release.mjs";
import { hardenManifest, networkSecurityConfig, NETWORK_SECURITY_REF } from "../scripts/manifest.mjs";
import { patchMinify, patchProguardRules, PROGUARD_MARK } from "../scripts/native.mjs";

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:debuggable="true"
        android:icon="@mipmap/ic_launcher"
        android:theme="@style/AppTheme">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
</manifest>
`;
const GRADLE = "android {\n    buildTypes {\n        release {\n            minifyEnabled false\n            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'\n        }\n    }\n}\n";
const release = { API_URL: "https://api.parking.example", APP_DEV: "" };
const goodManifest = hardenManifest(MANIFEST);
const goodNet = networkSecurityConfig({ dev: false });
const goodGradle = patchMinify(GRADLE);

test("harden: network security config referenced, debuggable removed, backup and cleartext off, running again changes nothing", () => {
  const out = hardenManifest(MANIFEST);
  assert.match(out, new RegExp(`android:networkSecurityConfig="${NETWORK_SECURITY_REF}"`));
  assert.match(out, /allowBackup="false"/);
  assert.match(out, /usesCleartextTraffic="false"/);
  assert.doesNotMatch(out, /debuggable/);
  assert.match(out, /android:icon="@mipmap\/ic_launcher"/);
  assert.equal(hardenManifest(out), out);
  assert.equal((out.match(/networkSecurityConfig/g) || []).length, 1);
});

test("network security config: cleartext off for release, on only in test mode", () => {
  assert.match(networkSecurityConfig({ dev: false }), /cleartextTrafficPermitted="false"/);
  assert.doesNotMatch(networkSecurityConfig({ dev: false }), /cleartextTrafficPermitted="true"/);
  assert.match(networkSecurityConfig({ dev: true }), /cleartextTrafficPermitted="true"/);
  assert.match(networkSecurityConfig(), /cleartextTrafficPermitted="false"/);
});

test("release check: a correct release project passes (and with no android project only app.env is checked)", () => {
  assert.deepEqual(checkRelease({ env: release, manifest: goodManifest, networkConfig: goodNet, gradle: goodGradle }), { problems: [], warnings: [] });
  assert.deepEqual(checkRelease({ env: release }).problems, []);
});

test("release check: APP_DEV=1, http and private API_URL fail", () => {
  assert.match(checkRelease({ env: { ...release, APP_DEV: "1" } }).problems.join("\n"), /APP_DEV=1/);
  assert.match(checkRelease({ env: { API_URL: "http://api.parking.example" } }).problems.join("\n"), /API_URL.*https/);
  assert.match(checkRelease({ env: { API_URL: "https://192.168.1.50:5000" } }).problems.join("\n"), /private address/);
  assert.match(checkRelease({ env: { API_URL: "http://10.0.2.2:5000", APP_DEV: "1" } }).problems.join("\n"), /APP_DEV=1/);
  assert.equal(checkRelease({ env: { API_URL: "http://10.0.2.2:5000", APP_DEV: "1" } }).problems.length, 2, "test mode is reported for both reasons");
  assert.match(checkRelease({ env: {} }).problems.join("\n"), /API_URL is not set/);
});

test("release check: the manifest must not allow cleartext, backup or debugging", () => {
  const dev = hardenManifest(MANIFEST, { dev: true });
  assert.match(checkRelease({ env: release, manifest: dev, networkConfig: goodNet, gradle: goodGradle }).problems.join("\n"), /usesCleartextTraffic="true"/);
  assert.match(checkRelease({ env: release, manifest: MANIFEST, networkConfig: goodNet, gradle: goodGradle }).problems.join("\n"), /allowBackup/);
  assert.match(checkRelease({ env: release, manifest: MANIFEST, networkConfig: goodNet, gradle: goodGradle }).problems.join("\n"), /debuggable/);
  assert.match(checkRelease({ env: release, manifest: MANIFEST.replace('android:allowBackup="true"', 'android:allowBackup="false" android:debuggable="true"'), networkConfig: goodNet }).problems.join("\n"), /debuggable/);
  assert.match(checkRelease({ env: release, manifest: goodManifest, networkConfig: networkSecurityConfig({ dev: true }), gradle: goodGradle }).problems.join("\n"), /cleartextTrafficPermitted/);
  assert.match(checkRelease({ env: release, manifest: goodManifest, networkConfig: null, gradle: goodGradle }).problems.join("\n"), /network_security_config.xml is missing/);
  assert.match(checkRelease({ env: release, manifest: goodManifest.replace(/\s*android:networkSecurityConfig="[^"]*"/, ""), networkConfig: goodNet }).problems.join("\n"), /network security config/);
});

test("release check: an un-minified release build is a warning, not a failure", () => {
  const result = checkRelease({ env: release, manifest: goodManifest, networkConfig: goodNet, gradle: GRADLE });
  assert.deepEqual(result.problems, []);
  assert.match(result.warnings.join("\n"), /minif/);
});

test("minify: only the release build type is switched on, once; debug is untouched", () => {
  const out = patchMinify(GRADLE);
  assert.match(out, /release \{\s*minifyEnabled true/);
  assert.equal(patchMinify(out), out);
  const both = "buildTypes {\n  debug {\n    minifyEnabled false\n  }\n  release {\n    minifyEnabled false\n  }\n}";
  const patched = patchMinify(both);
  assert.match(patched, /debug \{\s*minifyEnabled false/);
  assert.match(patched, /release \{\s*minifyEnabled true/);
  assert.equal(patchMinify("no build types here"), "no build types here");
});

test("proguard rules: keep rules for Capacitor, plugins and the app's package are added once", () => {
  const original = "# default rules\n";
  const out = patchProguardRules(original, "com.smartparking.operator");
  assert.ok(out.startsWith(original));
  assert.ok(out.includes(PROGUARD_MARK));
  assert.match(out, /-keep class com\.getcapacitor\.\*\* \{ \*; \}/);
  assert.match(out, /-keep class com\.smartparking\.operator\.\*\* \{ \*; \}/);
  assert.match(out, /@com\.getcapacitor\.PluginMethod public <methods>/);
  assert.equal(patchProguardRules(out, "com.smartparking.operator"), out);
});

import { injectCsp, mobileCsp } from "../scripts/csp.mjs";

test("app CSP: only the app and its server may be called; the policy is put before the scripts, once", () => {
  const csp = mobileCsp({ api: "https://api.parking.example:8443" });
  assert.match(csp, /connect-src 'self' https:\/\/api\.parking\.example:8443 https:\/\/maps\.googleapis\.com(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /connect-src[^;]*\bhttps:(;| |$)/, "no blanket https: for calls");
  const html = '<!doctype html><html><head>\n<meta charset="UTF-8" />\n<script type="module" src="/a.js"></script></head><body></body></html>';
  const out = injectCsp(html, csp);
  assert.ok(out.indexOf("Content-Security-Policy") > out.indexOf('charset="UTF-8"'));
  assert.ok(out.indexOf("Content-Security-Policy") < out.indexOf("<script"));
  assert.equal(injectCsp(out, csp), out);
  assert.match(injectCsp("<html><head></head></html>", csp), /<head>\s*<meta http-equiv/);
  assert.throws(() => injectCsp("<p>no head</p>", csp), /no <head>/);
});
