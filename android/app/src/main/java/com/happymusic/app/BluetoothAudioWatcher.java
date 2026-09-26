package com.happymusic.app;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;

// Detecta quando uma saída de áudio Bluetooth aparece (o carro ligou e
// conectou sozinho, um fone/caixa de som pareou) pra avisar o JS retomar
// a música sozinha, igual o Spotify faz — ver "hmBluetoothConnected" em
// player.js.
//
// De propósito usamos a API de DISPOSITIVOS de áudio (AudioManager),
// não a API de Bluetooth em si: ela não pede nenhuma permissão de
// Bluetooth (BLUETOOTH_CONNECT etc., exigida a partir do Android 12),
// só avisa quando uma NOVA saída de áudio passa a existir. A2DP é o
// perfil usado pra streaming de música estéreo (carro, caixa, fone);
// SCO é o de viva-voz/ligação — incluímos os dois porque alguns
// sistemas de carro mais simples só oferecem o segundo.
//
// Isolado nesta classe própria (em vez de direto na
// HappyMusicApplication) porque AudioDeviceCallback/AudioDeviceInfo só
// existem a partir do Android 6 (API 23), e o app aceita a partir do
// Android 5.1 (API 22) — referências a essas classes ficando direto
// numa classe carregada em todo aparelho poderiam travar o verificador
// do Android em versões mais antigas. HappyMusicApplication só chama
// start() depois de checar a versão do Android.
class BluetoothAudioWatcher {

  static void start(Context context) {
    AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    if (audioManager == null) return;

    audioManager.registerAudioDeviceCallback(new AudioDeviceCallback() {
      @Override
      public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
        for (AudioDeviceInfo device : addedDevices) {
          int type = device.getType();
          if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
            if (HappyMusicApplication.activeBridge != null) {
              HappyMusicApplication.activeBridge.triggerWindowJSEvent("hmBluetoothConnected");
            }
            break;
          }
        }
      }
    }, new Handler(Looper.getMainLooper()));
  }
}
