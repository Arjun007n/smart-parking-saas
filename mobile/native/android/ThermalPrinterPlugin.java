package __PACKAGE__;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Prints to a Bluetooth thermal printer (the common 58 mm / 80 mm receipt printers, which use the "serial port"
 * Bluetooth profile). The printer must be paired in the phone's Bluetooth settings first; this plugin lists the paired
 * devices and sends bytes (ESC/POS, made by the website code) to the one the person chose.
 *
 * Only devices that are already paired can be used: the app never connects to an arbitrary address.
 */
@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class ThermalPrinterPlugin extends Plugin {

    // The standard "serial port" service id that thermal printers answer to.
    private static final UUID SERIAL_PORT = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CHUNK = 512;
    private static final int MAX_BYTES = 256 * 1024;

    // One print at a time, off the main thread (connecting can take a few seconds).
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    // Android 12 and newer ask for "Nearby devices"; older versions grant Bluetooth when the app is installed.
    private boolean allowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private JSObject statusObject() {
        BluetoothAdapter adapter = adapter();
        JSObject result = new JSObject();
        result.put("supported", adapter != null);
        result.put("enabled", adapter != null && adapter.isEnabled());
        result.put("allowed", allowed());
        return result;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (allowed()) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("bluetooth", call, "accessResult");
    }

    @PermissionCallback
    private void accessResult(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void pairedDevices(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This phone has no Bluetooth.", "NO_BLUETOOTH");
            return;
        }
        if (!allowed()) {
            call.reject("Bluetooth is not allowed for this app.", "NO_PERMISSION");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is off.", "BT_OFF");
            return;
        }
        JSArray devices = new JSArray();
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice device : bonded) {
                JSObject item = new JSObject();
                String name = device.getName();
                BluetoothClass type = device.getBluetoothClass();
                item.put("address", device.getAddress());
                item.put("name", name == null || name.isEmpty() ? device.getAddress() : name);
                item.put("printer", type != null && type.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING);
                devices.put(item);
            }
        } catch (SecurityException e) {
            call.reject("Bluetooth is not allowed for this app.", "NO_PERMISSION");
            return;
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void print(PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || data == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("No printer chosen.", "NO_PRINTER");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("The print data is not valid.", "CONNECT_FAILED");
            return;
        }
        if (bytes.length == 0 || bytes.length > MAX_BYTES) {
            call.reject("The print data has a wrong size.", "CONNECT_FAILED");
            return;
        }
        final BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This phone has no Bluetooth.", "NO_BLUETOOTH");
            return;
        }
        if (!allowed()) {
            call.reject("Bluetooth is not allowed for this app.", "NO_PERMISSION");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is off.", "BT_OFF");
            return;
        }

        worker.execute(() -> {
            BluetoothSocket socket = null;
            try {
                // Only a printer the person has paired in the phone's settings may be used.
                BluetoothDevice device = null;
                for (BluetoothDevice bonded : adapter.getBondedDevices()) {
                    if (bonded.getAddress().equalsIgnoreCase(address)) {
                        device = bonded;
                        break;
                    }
                }
                if (device == null) {
                    call.reject("The printer is not paired.", "NOT_PAIRED");
                    return;
                }
                adapter.cancelDiscovery(); // a running search slows the connection down
                socket = connect(device);
                OutputStream out = socket.getOutputStream();
                for (int at = 0; at < bytes.length; at += CHUNK) {
                    out.write(bytes, at, Math.min(CHUNK, bytes.length - at));
                    out.flush();
                    Thread.sleep(20); // small printers lose bytes when they are sent faster than they print
                }
                Thread.sleep(500); // let the printer take the last bytes before the connection is closed
                call.resolve();
            } catch (SecurityException e) {
                call.reject("Bluetooth is not allowed for this app.", "NO_PERMISSION");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                call.reject("The printing was interrupted.", "CONNECT_FAILED");
            } catch (IOException e) {
                call.reject("Could not reach the printer.", "CONNECT_FAILED");
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (IOException ignored) {
                        // already closed
                    }
                }
            }
        });
    }

    // The normal way first; a few printers only answer on channel 1, which Android offers through a hidden method.
    @SuppressLint("MissingPermission")
    private BluetoothSocket connect(BluetoothDevice device) throws IOException {
        BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SERIAL_PORT);
        try {
            socket.connect();
            return socket;
        } catch (IOException first) {
            try {
                socket.close();
            } catch (IOException ignored) {
                // closed already
            }
            try {
                BluetoothSocket fallback = (BluetoothSocket) device.getClass().getMethod("createRfcommSocket", int.class).invoke(device, 1);
                if (fallback == null) throw first;
                fallback.connect();
                return fallback;
            } catch (Exception second) {
                throw first;
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdown();
        super.handleOnDestroy();
    }
}
