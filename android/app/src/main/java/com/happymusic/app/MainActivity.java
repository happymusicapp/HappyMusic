package com.happymusic.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Plugins escritos dentro do próprio app (não instalados via npm)
    // precisam ser registrados manualmente, e antes do super.onCreate()
    // — ver NativePlayerPlugin.java.
    registerPlugin(NativePlayerPlugin.class);
    super.onCreate(savedInstanceState);

    // Android 13+ (API 33): sem esta permissão o sistema esconde a
    // notificação do player (controles na barra de notificações e na tela
    // de bloqueio). Pede uma vez; se o usuário negar, o Android não pergunta
    // de novo e a música continua tocando normalmente.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
    }
  }
}
