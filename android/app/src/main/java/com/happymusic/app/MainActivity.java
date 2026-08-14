package com.happymusic.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Deixa a Bridge (WebView) acessível pro receiver registrado em
    // HappyMusicApplication — ver aquela classe pra entender o motivo
    // de registrar lá e não aqui.
    HappyMusicApplication.activeBridge = getBridge();
  }

  @Override
  public void onDestroy() {
    if (HappyMusicApplication.activeBridge == getBridge()) {
      HappyMusicApplication.activeBridge = null;
    }
    super.onDestroy();
  }
}
