package com.happymusic.app;

import android.app.Application;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.Bridge;

public class HappyMusicApplication extends Application {

  // Fone/Bluetooth desconectado no meio da reprodução: o Android avisa com
  // esse broadcast (mesmo sinal que apps como o Spotify escutam) antes do
  // áudio trocar sozinho pro alto-falante do aparelho.
  //
  // Registrado aqui (Application), não na MainActivity: a música toca com
  // a tela bloqueada/app em segundo plano através de um foreground service
  // (plugin de MediaSession) — nesse cenário o Android pode considerar a
  // Activity "parada" mesmo com o processo do app vivo. Um receiver preso
  // ao ciclo de vida da Activity corre o risco de não estar mais ativo
  // bem na hora em que o usuário desconecta o fone. Aqui ele vive
  // enquanto o processo do app existir.
  public static Bridge activeBridge;

  private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction()) && activeBridge != null) {
        activeBridge.triggerWindowJSEvent("hmAudioBecomingNoisy");
      }
    }
  };

  @Override
  public void onCreate() {
    super.onCreate();

    IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);

    // A partir do Android 13 (API 33), todo registerReceiver() feito em
    // código precisa dizer explicitamente se aceita broadcasts de outros
    // apps (RECEIVER_EXPORTED) ou só do sistema/do próprio app
    // (RECEIVER_NOT_EXPORTED) — sem isso o registro pode falhar. Esse
    // broadcast em especial só pode vir do sistema mesmo, então
    // RECEIVER_NOT_EXPORTED é o certo.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    } else {
      registerReceiver(noisyReceiver, filter);
    }
  }
}
