import test from "node:test";
import assert from "node:assert/strict";
import appEnv from "../scripts/appEnv.cjs";
const { checkApiUrl, parseEnvText, readAppEnv } = appEnv;
import { hardenManifest } from "../scripts/manifest.mjs";

const CAPACITOR_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

test("app.env: comments, quotes and blank lines", () => {
  assert.deepEqual(parseEnvText('# c\n\nAPI_URL="https://a.example"\nAPP_DEV=1\r\nbad line\n'), { API_URL: "https://a.example", APP_DEV: "1" });
});

test("app.env: the environment wins over the file", () => {
  assert.equal(readAppEnv("/nonexistent", { API_URL: "https://x.example" }).API_URL, "https://x.example");
  assert.equal(readAppEnv("/nonexistent", {}).API_URL, undefined);
});

test("API_URL: a real app needs a public https address, without /api", () => {
  assert.deepEqual(checkApiUrl({ API_URL: "https://api.parking.example/" }), { api: "https://api.parking.example", dev: false });
  assert.deepEqual(checkApiUrl({ API_URL: "https://api.parking.example:8443" }), { api: "https://api.parking.example:8443", dev: false });
  assert.throws(() => checkApiUrl({}), /API_URL is not set/);
  assert.throws(() => checkApiUrl({ API_URL: "https://api.parking.example/api" }), /must not end with \/api/);
  assert.throws(() => checkApiUrl({ API_URL: "http://api.parking.example" }), /must start with https/);
  assert.throws(() => checkApiUrl({ API_URL: "https://192.168.1.50:5000" }), /private address/);
  assert.throws(() => checkApiUrl({ API_URL: "https://localhost:5000" }), /private address/);
  assert.throws(() => checkApiUrl({ API_URL: "not a url" }), /not a web address/);
});

test("API_URL: test mode allows plain http on this PC or the local network", () => {
  assert.deepEqual(checkApiUrl({ API_URL: "http://10.0.2.2:5000", APP_DEV: "1" }), { api: "http://10.0.2.2:5000", dev: true });
  assert.deepEqual(checkApiUrl({ API_URL: "http://192.168.1.50:5000", APP_DEV: "1" }), { api: "http://192.168.1.50:5000", dev: true });
});

test("manifest: backup off and plain http blocked for a real app", () => {
  const out = hardenManifest(CAPACITOR_MANIFEST);
  assert.match(out, /android:allowBackup="false"/);
  assert.match(out, /android:usesCleartextTraffic="false"/);
  assert.doesNotMatch(out, /allowBackup="true"/);
  assert.match(out, /android:icon="@mipmap\/ic_launcher"/, "other settings are kept");
  assert.match(out, /<uses-permission android:name="android.permission.INTERNET" \/>/);
  assert.equal((out.match(/usesCleartextTraffic/g) || []).length, 1);
});

test("manifest: test mode allows plain http; running again changes nothing; switching back works", () => {
  const dev = hardenManifest(CAPACITOR_MANIFEST, { dev: true });
  assert.match(dev, /android:usesCleartextTraffic="true"/);
  assert.equal(hardenManifest(dev, { dev: true }), dev);
  const back = hardenManifest(dev, { dev: false });
  assert.match(back, /android:usesCleartextTraffic="false"/);
  assert.equal((back.match(/usesCleartextTraffic/g) || []).length, 1);
});

test("manifest: a manifest without an application tag is refused", () => {
  assert.throws(() => hardenManifest("<manifest></manifest>"), /No <application> tag/);
});

import { PLUGIN_CLASSES, SCANNER_DEPENDENCY, TEXT_DEPENDENCY, packagePath, patchGradle, patchMainActivity, patchNativeManifest, patchProguard, withPackage } from "../scripts/native.mjs";

const MAIN_ACTIVITY = `package com.smartparking.operator;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;
const GRADLE = `apply plugin: 'com.android.application'

android {
    namespace = "com.smartparking.operator"
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation project(':capacitor-android')
}
`;

test("native: package path comes from the app id", () => {
  assert.equal(packagePath("com.smartparking.operator"), "com/smartparking/operator");
  assert.throws(() => packagePath("operator"), /not a package name/);
  assert.equal(withPackage("package __PACKAGE__;", "com.a.b"), "package com.a.b;");
});

test("native: MainActivity registers every plugin before the page starts, and only once", () => {
  const out = patchMainActivity(MAIN_ACTIVITY);
  for (const name of PLUGIN_CLASSES) assert.match(out, new RegExp(`registerPlugin\\(${name}\\.class\\);`));
  assert.match(out, /import android\.os\.Bundle;/);
  assert.ok(out.indexOf("registerPlugin(ThermalPrinterPlugin") < out.indexOf("super.onCreate"));
  assert.equal(patchMainActivity(out), out);
});

test("native: an existing onCreate gets the lines before super.onCreate", () => {
  const own = `package x;\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {\n  @Override\n  public void onCreate(Bundle savedInstanceState) {\n    super.onCreate(savedInstanceState);\n  }\n}\n`;
  const out = patchMainActivity(own);
  assert.ok(out.indexOf("registerPlugin(QrScannerPlugin") < out.indexOf("super.onCreate"));
  assert.equal(patchMainActivity(out), out);
  assert.throws(() => patchMainActivity("class MainActivity {}"), /unexpected shape/);
});

test("native: an app made before the plate reader existed gets only the new plugin", () => {
  const old = `package x;\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {\n  @Override\n  public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(ThermalPrinterPlugin.class);\n        registerPlugin(QrScannerPlugin.class);\n    super.onCreate(savedInstanceState);\n  }\n}\n`;
  const out = patchMainActivity(old);
  assert.equal((out.match(/registerPlugin\(ThermalPrinterPlugin/g) || []).length, 1);
  assert.equal((out.match(/registerPlugin\(QrScannerPlugin/g) || []).length, 1);
  assert.match(out, /registerPlugin\(PlateReaderPlugin\.class\);/);
  assert.ok(out.indexOf("registerPlugin(PlateReaderPlugin") < out.indexOf("super.onCreate"));
  assert.equal(patchMainActivity(out), out);
  const oldGradle = patchGradle(GRADLE).replace(`    implementation '${TEXT_DEPENDENCY}'\n`, "");
  const upgraded = patchGradle(oldGradle);
  assert.ok(upgraded.includes(TEXT_DEPENDENCY));
  assert.equal((upgraded.match(/play-services-code-scanner/g) || []).length, 1);
});

test("native: the scanner and text reader libraries are added to the dependencies once", () => {
  const out = patchGradle(GRADLE);
  assert.ok(out.includes(`implementation '${SCANNER_DEPENDENCY}'`));
  assert.ok(out.includes(`implementation '${TEXT_DEPENDENCY}'`));
  assert.equal(patchGradle(out), out);
  assert.equal((out.match(/dependencies \{/g) || []).length, 1);
  assert.throws(() => patchGradle("android {}"), /no dependencies block/);
});

test("native: Bluetooth and camera permissions and the scanner hint are added once, other lines kept", () => {
  const out = patchNativeManifest(hardenManifest(CAPACITOR_MANIFEST));
  assert.match(out, /android\.permission\.BLUETOOTH_CONNECT/);
  assert.match(out, /android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30"/);
  assert.match(out, /com\.google\.mlkit\.vision\.DEPENDENCIES/);
  assert.match(out, /android\.permission\.INTERNET/);
  assert.equal((out.match(/android\.permission\.CAMERA/g) || []).length, 1);
  assert.equal(patchNativeManifest(out), out);
  assert.equal((out.match(/BLUETOOTH_CONNECT/g) || []).length, 1);
  assert.match(out, /allowBackup="false"/, "the safe settings stay");
});

test("native: the old proguard file name is replaced, other lines kept, running again changes nothing", () => {
  const old = "release {\n  proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'\n}";
  const out = patchProguard(old);
  assert.match(out, /proguard-android-optimize\.txt/);
  assert.doesNotMatch(out, /proguard-android\.txt/);
  assert.match(out, /'proguard-rules\.pro'/);
  assert.equal(patchProguard(out), out);
});
