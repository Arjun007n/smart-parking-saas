# Mobile app

The Android app for gate staff lives in `mobile/` (see `mobile/README.md` for the steps). It is the website in `client/` packaged with Capacitor, so there is one set of screens. The server is unchanged except for one allowed address (below). The gate agent keeps working the barrier and the printer.

## How it fits together

```
Phone app (Capacitor)  --https-->  Server + MongoDB   (unchanged)
Website                --https-->  Server
Gate PC: gate agent  ----------->  Server (outgoing), works the barrier, printer and camera
```

## What was built (Phase 1)

* `mobile/`: the Capacitor project. `npm run android` builds the website for the app with the server address from `mobile/app.env`, syncs it into the Android project and opens Android Studio.
* `client/src/native/`: the only code that knows about the phone. It does nothing in a browser. The sign-in token is read from secure storage before the first screen; the Android back button goes back one page and leaves the app on the first page; the website's service worker is not registered inside the app.
* Safe Android settings, applied by `npm run sync`: no cloud backup of the app's data, plain `http` blocked in a real app.

## Phase 2: gate features on the phone

* **Bluetooth printer.** Menu, Printer: pick a printer that is paired in the phone's Bluetooth settings, choose 58 mm or 80 mm paper and print a test slip. After that a new ticket prints by itself when it is made (like the gate PC), the Ticket page has a Print ticket button for reprints, and Print bill (Exit) and Print on this phone's printer (receipt page) print the bill. The slip is built in `client/src/native/escpos.js` (plain ESC/POS, with the rupee sign written as "Rs." because thermal printers have no such character); `native/android/ThermalPrinterPlugin.java` only sends the bytes over Bluetooth to a printer that is already paired. Not on the slip: the entry photo.
* **QR scan at Exit.** Scan QR code opens the phone's own scanner screen (Google's code scanner, through `QrScannerPlugin.java`) and looks the ticket up. If the scanner cannot start (a phone without Google Play services), the page's own camera reader opens instead.
* **Phone Home.** On a phone-sized screen the Home starts with big Entry and Exit buttons, History and Inside now shortcuts, the day's collection, the printer in use, and the customers booked ahead.
* **Number plate camera (Entry and Exit).** On a phone, Entry has a Camera | Keyboard switch and Exit has a QR Code | Vehicle Number switch. In camera mode the page shows the back camera, cuts the plate frame out of a picture every ~0.65 s and sends it to `PlateReaderPlugin.java` (ML Kit text recognition, on the phone, no internet needed). `client/src/native/plate.js` finds an Indian plate in the lines that come back (fixes look-alike characters by place, joins two-row bike plates, knows the state codes and the BH series) and trusts a plate once it was read twice. Entry then fills the vehicle number (tap the vehicle type to make the ticket); Exit looks the vehicle up at once. A plate that was just handled, or was not found, is ignored for a minute. The camera needs the CAMERA permission, which `install-native.mjs` adds to the manifest.
* The phone's Entry and Exit screens have their own top bar (back, the other screen, printer, history, barrier) and, on Exit, a fixed bottom bar with **Exit** and **Scan Again**. The invoice at the end is a popup with **OK** and **Print Receipt**. The website's own screens are unchanged (all of this is `md:hidden` / phone-width only).
* `npm run sync` now also runs `scripts/install-native.mjs`: it copies the Java files into the Android project, registers them in `MainActivity` (only the ones missing), adds Google's code scanner and ML Kit's text recognition libraries to `app/build.gradle` and the Bluetooth and camera permissions to the manifest. Running it again changes nothing.

Not done on purpose: reading a number plate from a phone photo. Plates come from the gate's ANPR camera or are typed (an earlier decision); say so if that should change.

Not yet tested on a real phone and printer (the Android build cannot run in the cloud workspace): the Bluetooth connection (some printers need a pairing code, some only answer on one channel, which the plugin tries), the scanner and the Gradle library version.

## What the server needs

The app's own pages come from `https://localhost` (release) or `http://localhost` (test mode). Add that address to `CLIENT_URL`, after the website's address (the first address is used in email links):

```
CLIENT_URL=https://your-site.example,https://localhost
```

The server does not use cookies for sign-in (a bearer token), so allowing this address does not open the API to other sites.

## Next phases

1. Push alerts.
2. Customer and pass-holder app (needs a pass-user login on the server).
3. iPhone (needs a Mac and Apple's developer account; the Bluetooth printer would need a different plugin there).
4. Plate reading from the phone camera, only if wanted (see above).
