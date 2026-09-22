package com.happymusic.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Pede o foco de áudio do sistema enquanto a música toca — é o que faz
// o Android avisar a gente quando uma ligação chega ou o WhatsApp começa
// a gravar/tocar um áudio (os dois pedem foco pro sistema achando que
// vão ser os únicos a soar), pra ficar mudo igual o Spotify faz, e
// avisar de novo quando a ligação/áudio termina, pra poder voltar a
// tocar sozinho.
//
// Sem isso, o <audio> do WebView já perde o foco e pausa sozinho nessas
// horas (o Chromium cuida disso por trás — é o mesmo motivo do app já
// pausar quando o GPS fala ou uma notificação toca, ver o listener de
// 'pause' em player.js), mas a gente não sabe distinguir "distração
// rápida" de "ligação/áudio em andamento", nem fica sabendo quando o
// foco realmente volta — então o app não pode saber a hora certa de
// voltar a tocar sozinho. Registrando nosso próprio pedido de foco, o
// Android nos avisa dos dois lados (perdeu / recuperou) direto.
@CapacitorPlugin(name = "AudioFocus")
public class AudioFocusPlugin extends Plugin {

  private AudioManager audioManager;
  private AudioFocusRequest focusRequest; // API 26+
  private AudioManager.OnAudioFocusChangeListener listener;
  private boolean requested = false;

  @Override
  public void load() {
    audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    listener = focusChange -> {
      String reason;
      switch (focusChange) {
        case AudioManager.AUDIOFOCUS_LOSS:
          reason = "loss";
          break;
        case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
          reason = "loss_transient";
          break;
        case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
          reason = "loss_transient_can_duck";
          break;
        case AudioManager.AUDIOFOCUS_GAIN:
          reason = "gain";
          break;
        default:
          return; // outros valores não interessam aqui
      }
      JSObject data = new JSObject();
      data.put("reason", reason);
      notifyListeners("focusChange", data);
    };
  }

  // Chamado pelo JS toda vez que uma faixa começa a tocar de verdade
  // (ver native-bridge.js / player.js). Idempotente: só pede de fato na
  // primeira vez, enquanto não tivermos soltado o foco de novo.
  @PluginMethod
  public void request(PluginCall call) {
    if (!requested) {
      requested = true;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        AudioAttributes attrs = new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build();
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(attrs)
          .setOnAudioFocusChangeListener(listener)
          .build();
        audioManager.requestAudioFocus(focusRequest);
      } else {
        audioManager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
      }
    }
    call.resolve();
  }

  // Chamado pelo JS quando o usuário pausa de propósito (ver
  // player.js: pause() só chama isso fora do caso de perda de foco —
  // continuar "inscrito" durante uma ligação/áudio é o que garante o
  // aviso de volta quando o foco é devolvido).
  @PluginMethod
  public void abandon(PluginCall call) {
    if (requested) {
      requested = false;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
        audioManager.abandonAudioFocusRequest(focusRequest);
      } else {
        audioManager.abandonAudioFocus(listener);
      }
    }
    call.resolve();
  }
}
