# Smart Parking Android app

The app for gate staff. It is the website (`../client`) packaged into an Android app with [Capacitor](https://capacitorjs.com), so the website and the app share one set of screens, and the app talks to the same server. The gate agent on the gate PC still works the barrier and the printer; the app is only a new screen.

The app opens, signs in and works the operator screens (Entry, Exit, lists). It prints tickets and bills on a Bluetooth thermal printer (Menu, Printer) and scans QR codes at Exit with the phone's camera. Push alerts come next (see `docs/mobile.md`).

## What you need once

1. **Node.js 22 or newer** (Capacitor 8 needs it; you have it).
2. **Android Studio** (free, about 1 GB or more). On the first start let it install the Android SDK. It includes Java.
3. A phone for testing (optional): Settings, About phone, tap *Build number* seven times; then Settings, Developer options, turn on *USB debugging*. Or use the emulator that comes with Android Studio (Tools, Device Manager).

## First time

Open a terminal (PowerShell or the VS Code terminal) in this `mobile` folder.

```
npm install
copy app.env.example app.env
```

**Lock the package versions (once).** There is no `package-lock.json` yet, and `package.json` uses `^` ranges, so two installs can
give two different versions. After the first `npm install` works, commit the `package-lock.json` it wrote, and from then on
install with `npm ci` (it installs exactly what the lock file says and fails if it does not match `package.json`).

Open `app.env` and set the server address:

* **Testing, server running on this PC** (`npm run dev` in `server`):
  * Android emulator: `API_URL=http://10.0.2.2:5000` and `APP_DEV=1`
  * Real phone on the same Wi-Fi: `API_URL=http://<this PC's Wi-Fi address>:5000` and `APP_DEV=1` (find the address with `ipconfig`)
* **A real release:** `API_URL=https://api.your-site.example` and leave `APP_DEV` empty.

Let the server accept the app. In `server/.env` the `CLIENT_URL` list must also contain the address the app uses for its own pages:

* test mode: add `http://localhost`, for example `CLIENT_URL=http://localhost:5173,http://localhost`
* release: add `https://localhost`, for example `CLIENT_URL=https://your-site.example,https://localhost` (keep your website first: the first address is used in email links)

Restart the server after changing it. Then create the Android project (once):

```
npx cap add android
```

## Every time you want to try the app

```
npm run android
```

This builds the website for the app, copies it into the Android project, applies the safe Android settings, and opens Android Studio. In Android Studio choose your phone or emulator at the top and press the green **Run** button. After you change the website code, run `npm run android` again (or `npm run sync`, then Run).

`npm run run:android` builds and starts the app on a connected device straight from the terminal.

## What the scripts do

| Command | What it does |
|---|---|
| `npm run web` | Builds `../client` into `web/` with `API_URL` built in. The website's own `dist` folder is not touched |
| `npm run sync` | `web`, then `cap sync android`, then the safe Android settings, then the phone features (Bluetooth printer, QR scanner) |
| `npm run android` | `sync`, then opens Android Studio |
| `npm run check:release` | Stops (exit 1) if the project is still set up for testing. Run it before every release build |
| `npm test` | Tests of the helper scripts, the printer code, the release check and the token storage |

## The Bluetooth printer

1. Switch the printer on and pair it once in the phone's Bluetooth settings (the code is usually 0000 or 1234).
2. In the app: Menu, Printer, Show paired devices, Choose. Pick the paper size and tap Print test slip.
3. From then on a new ticket prints by itself, and Print bill prints the bill.

If nothing prints: the printer must be on, close, and not connected to another phone. The first time, Android asks for "Nearby devices"; allow it. Printers that are not the common serial-port kind (some label printers) are not supported.

## Safe settings (done by `npm run sync`)

* The phone may not copy the app's saved data to a cloud backup (`allowBackup=false`).
* A real app talks only to `https` addresses. Plain `http` is switched on only with `APP_DEV=1`, and the build refuses a plain `http` address without it.
* The sign-in token is kept in the phone's secure storage (Android Keystore) through `capacitor-secure-storage-plugin`. If secure storage fails in a **release** app, the token is kept in memory only: the person stays signed in until the app is closed, then signs in again (it is never copied to the WebView's `localStorage`). In **test mode** (`APP_DEV=1`) the app's private storage is still used as a fallback so testing keeps working.
* `res/xml/network_security_config.xml` is written into the Android project and named in the manifest: plain `http` is off, and on only with `APP_DEV=1`. The manifest never sets `android:debuggable`, and the web inspector is on only in test mode.
* Release builds are shrunk with R8 (`minifyEnabled true` for the release build type only, with keep rules for Capacitor and this app's plugins added to `proguard-rules.pro`). Set `APP_MINIFY=0` when running `npm run sync` to leave it off if a release build misbehaves. Try a release build on a phone before you publish.
* `npm run web` adds a content security policy to the app's copy of `index.html` in release builds (see `scripts/csp.mjs` and `docs/security.md`); `APP_CSP=0` turns it off. Test mode gets none.

## Before you publish

**Run `npm run check:release` first**, with `APP_DEV` cleared and the public `https` address in `API_URL`, then `npm run sync`, then generate the signed bundle. The check fails if `APP_DEV=1` is set, `API_URL` is `http` or a private address, or the generated Android project allows plain `http`, backup or debugging (it also warns if the release build is not minified). Never upload a bundle built after a test-mode `sync`: sync again in release mode first.

* **App ID**: `com.smartparking.operator` (in `capacitor.config.js`). It cannot be changed after the app is published. Choose it now.
* **Target Android version**: Google Play asks for a recent one. Check Play's current requirement and, if needed, raise `targetSdkVersion` and `compileSdkVersion` in `android/variables.gradle`.
* Release build: Android Studio, Build, Generate Signed App Bundle (AAB). Keep the signing key (`.jks`) and its password safe and backed up: without them you cannot update the app. Never put the key in Git.
* Icons and splash screen: put a 1024 x 1024 icon in `resources/` and use `@capacitor/assets` (not set up yet).

## Troubleshooting

| Problem | Fix |
|---|---|
| `API_URL is not set` | Copy `app.env.example` to `app.env` and fill it in |
| The website build fails | Run `npm install` in `../client` once, then try again |
| The app opens but sign-in says network error | The server is not reachable from the phone: check `API_URL`, that the server runs, and (real phone) that the PC firewall allows port 5000 |
| Sign-in fails with a CORS message in the log | Add the app's address to `CLIENT_URL` (see above) and restart the server |
| `npm install` says `capacitor-secure-storage-plugin` does not match Capacitor | Remove that line from `package.json` and run `npm install` again. The app still works without it, but in a release app the token is then kept in memory only (the person signs in again after closing the app); tell me and I will change the plugin |
| Android Studio asks to update Gradle or the plugin | Accept; Capacitor 8 works with current versions |
