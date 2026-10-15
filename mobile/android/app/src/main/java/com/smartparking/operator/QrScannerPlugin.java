package com.smartparking.operator;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * Scans a QR code with the phone's own scanner screen (Google's code scanner, part of Google Play services).
 * It has its own camera view, needs no camera permission for this app, and reads codes fast and reliably.
 * The website falls back to its own camera reader if this fails (a phone without Google Play services).
 */
@CapacitorPlugin(name = "QrScanner")
public class QrScannerPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        if (getActivity() == null) {
            call.reject("The app is not on the screen.", "FAILED");
            return;
        }
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), options);
        scanner
            .startScan()
            .addOnSuccessListener(barcode -> {
                String text = barcode.getRawValue();
                if (text == null || text.isEmpty()) {
                    call.reject("The code could not be read.", "FAILED");
                    return;
                }
                JSObject result = new JSObject();
                result.put("text", text);
                call.resolve(result);
            })
            .addOnCanceledListener(() -> call.reject("Scanning was closed.", "CANCELLED"))
            .addOnFailureListener(e -> call.reject(e.getMessage() == null ? "The scanner failed." : e.getMessage(), "FAILED"));
    }
}
