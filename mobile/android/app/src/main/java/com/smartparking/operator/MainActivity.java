package com.smartparking.operator;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        
        registerPlugin(PlateReaderPlugin.class);
registerPlugin(ThermalPrinterPlugin.class);
        registerPlugin(QrScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
