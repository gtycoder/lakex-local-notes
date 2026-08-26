package com.lakenotes.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpenFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
