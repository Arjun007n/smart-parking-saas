// Adds the app's own phone features (Bluetooth printer, QR scanner, number plate reader) to the generated Android project.
// Every function takes the text of a file and returns the new text; running one twice changes nothing.

export const PLUGIN_CLASSES = ["ThermalPrinterPlugin", "QrScannerPlugin", "PlateReaderPlugin"];

// Google's code scanner (part of Google Play services) and ML Kit's text reader (the model comes with the app, so it
// works without internet). The Bluetooth printer needs nothing extra.
export const SCANNER_DEPENDENCY = "com.google.android.gms:play-services-code-scanner:16.1.0";
export const TEXT_DEPENDENCY = "com.google.mlkit:text-recognition:16.0.1";

const PERMISSIONS = [
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
  '<uses-feature android:name="android.hardware.bluetooth" android:required="false" />',
  // The number plate camera (the page opens the camera itself).
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];
const SCANNER_META = '<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />';

// "com.smartparking.operator" -> the folder com/smartparking/operator
export const packagePath = (appId) => {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(appId)) throw new Error(`appId "${appId}" is not a package name like com.company.app`);
  return appId.split(".").join("/");
};

// A Java file of this folder, with the app's package name put in.
export const withPackage = (source, appId) => source.replaceAll("__PACKAGE__", appId);

// MainActivity must register the plugins before the page starts. Only the ones that are missing are added, so an
// app made with an older version of this script gets the new plugin and nothing is registered twice.
export const patchMainActivity = (source) => {
  const missing = PLUGIN_CLASSES.filter((name) => !source.includes(`registerPlugin(${name}.class)`));
  if (missing.length === 0) return source;
  const registrations = missing.map((name) => `        registerPlugin(${name}.class);`).join("\n");

  // The file Capacitor generates: an empty class.
  const empty = /public class MainActivity extends BridgeActivity\s*\{\s*\}/;
  if (empty.test(source)) {
    let out = source.replace(
      empty,
      `public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n${registrations}\n        super.onCreate(savedInstanceState);\n    }\n}`,
    );
    if (!/import android\.os\.Bundle;/.test(out)) out = out.replace(/(import com\.getcapacitor\.BridgeActivity;)/, "import android.os.Bundle;\n$1");
    return out;
  }

  // A MainActivity that already has an onCreate: add the lines before super.onCreate.
  const create = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*)(?=[^]*super\.onCreate)/;
  if (create.test(source)) return source.replace(create, `$1\n${registrations}\n`);
  throw new Error("MainActivity.java has an unexpected shape. Add registerPlugin(ThermalPrinterPlugin.class); registerPlugin(QrScannerPlugin.class); and registerPlugin(PlateReaderPlugin.class); before super.onCreate by hand.");
};

// The scanner and text reader libraries go into the app's dependencies (each only once).
export const patchGradle = (source) => {
  const wanted = [SCANNER_DEPENDENCY, TEXT_DEPENDENCY].filter((dependency) => !source.includes(dependency.split(":").slice(0, 2).join(":")));
  if (wanted.length === 0) return source;
  const open = /^dependencies\s*\{[^\n]*\n/m;
  if (!open.test(source)) throw new Error("app/build.gradle has no dependencies block.");
  return source.replace(open, (match) => `${match}${wanted.map((dependency) => `    implementation '${dependency}'\n`).join("")}`);
};

// Bluetooth and camera permissions, and the scanner's pre-download hint.
export const patchNativeManifest = (xml) => {
  let out = xml;
  const missing = PERMISSIONS.filter((line) => !out.includes(line.match(/android:name="([^"]+)"/)[1]));
  if (missing.length) {
    if (!/<\/manifest>/.test(out)) throw new Error("No </manifest> found in AndroidManifest.xml");
    out = out.replace(/<\/manifest>/, `\n    ${missing.join("\n    ")}\n</manifest>`);
  }
  if (!out.includes("com.google.mlkit.vision.DEPENDENCIES")) {
    if (!/<\/application>/.test(out)) throw new Error("No </application> found in AndroidManifest.xml");
    out = out.replace(/<\/application>/, `    ${SCANNER_META}\n    </application>`);
  }
  return out;
};

// Current Android build tools refuse the old "proguard-android.txt" file name. One of the plugins (the secure storage
// plugin) still uses it in its own build file, so it is changed to the name the build tools accept.
export const patchProguard = (source) => source.replaceAll("getDefaultProguardFile('proguard-android.txt')", "getDefaultProguardFile('proguard-android-optimize.txt')");
