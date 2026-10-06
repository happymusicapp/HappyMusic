package com.happymusic.app;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Handler;

/**
 * Avisa o serviço de áudio quando uma saída Bluetooth de música aparece
 * (o carro ligou e conectou sozinho, um fone/caixa pareou).
 *
 * Agora é o PRÓPRIO SERVIÇO que registra isto (antes era a Application, que
 * só conseguia avisar o JS — e com o app fechado o aviso se perdia).
 *
 * Usa a API de dispositivos de áudio (AudioManager), não a de Bluetooth: não
 * pede permissão de Bluetooth. A2DP = música estéreo; SCO = viva-voz (alguns
 * carros simples só oferecem esse). Isolado em classe própria porque
 * AudioDeviceCallback só existe a partir da API 23 e o app aceita a 22 — só
 * chame register() depois de checar a versão.
 */
final class BluetoothAudioWatcher {

    private BluetoothAudioWatcher() { }

    /** Devolve o callback registrado (guarde pra passar a unregister()). */
    static Object register(Context context, Handler handler, final Runnable onBluetoothAudioConnected) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) return null;

        AudioDeviceCallback callback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                for (AudioDeviceInfo device : addedDevices) {
                    int type = device.getType();
                    if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                        onBluetoothAudioConnected.run();
                        break;
                    }
                }
            }
        };
        audioManager.registerAudioDeviceCallback(callback, handler);
        return callback;
    }

    static void unregister(Context context, Object callback) {
        if (callback == null) return;
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager != null) audioManager.unregisterAudioDeviceCallback((AudioDeviceCallback) callback);
    }
}
