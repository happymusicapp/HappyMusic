package com.happymusic.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.IBinder;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

// Ponte JS <-> NativePlayerService. Mantém o mesmo nome de plugin
// ("MediaSession") e os mesmos métodos de metadata/ações que o
// @jofr/capacitor-media-session já tinha (setMetadata, setPlaybackState,
// setPositionState, setActionHandler) — native-bridge.js não precisa
// mudar nada disso. Os métodos novos (load/nativePlay/nativePause/
// nativeSeek/nativeGetState) são o que dá acesso ao ExoPlayer de
// verdade dentro do NativePlayerService.
@CapacitorPlugin(name = "MediaSession")
public class NativePlayerPlugin extends Plugin {
    private static final String TAG = "NativePlayerPlugin";

    private String title = "";
    private String artist = "";
    private String album = "";
    private Bitmap artwork = null;
    private final Map<String, PluginCall> actionHandlers = new HashMap<>();

    private NativePlayerService service = null;
    private final List<Runnable> pendingWhenReady = new ArrayList<>();

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
            NativePlayerService.LocalBinder binder = (NativePlayerService.LocalBinder) iBinder;
            service = binder.getService();
            Intent intent = new Intent(getActivity(), getActivity().getClass());
            service.connectAndInitialize(NativePlayerPlugin.this, intent);
            pushMetadataToService();

            for (Runnable r : pendingWhenReady) r.run();
            pendingWhenReady.clear();
        }

        @Override
        public void onServiceDisconnected(ComponentName componentName) {
            Log.d(TAG, "Desconectado do NativePlayerService");
            service = null;
        }
    };

    // Garante que o serviço existe e está conectado antes de rodar
    // "action". Se ainda não conectou (primeira vez), guarda a ação e
    // roda assim que o onServiceConnected disparar.
    private void ensureServiceThen(Runnable action) {
        if (service != null) {
            action.run();
            return;
        }
        pendingWhenReady.add(action);
        Intent intent = new Intent(getContext(), NativePlayerService.class);
        ContextCompat.startForegroundService(getContext(), intent);
        getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    private void pushMetadataToService() {
        if (service == null) return;
        service.setTitle(title);
        service.setArtist(artist);
        service.setAlbum(album);
        service.setArtwork(artwork);
        service.update();
    }

    private Bitmap urlToBitmap(String url) throws Exception {
        if (url.startsWith("http")) {
            HttpURLConnection connection = (HttpURLConnection) (new URL(url)).openConnection();
            connection.setDoInput(true);
            connection.connect();
            InputStream inputStream = connection.getInputStream();
            return BitmapFactory.decodeStream(inputStream);
        }
        int base64Index = url.indexOf(";base64,");
        if (base64Index != -1) {
            String base64Data = url.substring(base64Index + 8);
            byte[] decoded = Base64.decode(base64Data, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
        }
        return null;
    }

    // ── Metadata / MediaSession (mesma API do plugin antigo) ────────

    @PluginMethod
    public void setMetadata(PluginCall call) {
        title = call.getString("title", title);
        artist = call.getString("artist", artist);
        album = call.getString("album", album);

        JSArray artworkArray = call.getArray("artwork");
        if (artworkArray != null) {
            try {
                List<JSONObject> artworkList = artworkArray.toList();
                for (JSONObject art : artworkList) {
                    String src = art.optString("src", null);
                    if (src != null) {
                        try { this.artwork = urlToBitmap(src); }
                        catch (Exception e) { Log.w(TAG, "Falha ao carregar a capa da faixa", e); }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Falha ao ler artwork", e);
            }
        }

        if (service != null) pushMetadataToService();
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        String playbackState = call.getString("playbackState", "none");
        if (service != null) {
            int state;
            if ("playing".equals(playbackState)) state = PlaybackStateCompat.STATE_PLAYING;
            else if ("paused".equals(playbackState)) state = PlaybackStateCompat.STATE_PAUSED;
            else state = PlaybackStateCompat.STATE_NONE;
            service.setPlaybackState(state);
            service.update();
        }
        call.resolve();
    }

    @PluginMethod
    public void setPositionState(PluginCall call) {
        double duration = call.getDouble("duration", 0.0);
        double position = call.getDouble("position", 0.0);
        Double playbackRate = call.getDouble("playbackRate");
        if (service != null) {
            service.setDuration(Math.round(duration * 1000));
            service.setPosition(Math.round(position * 1000));
            service.setPlaybackSpeed(playbackRate == null || playbackRate == 0.0 ? 1.0F : playbackRate.floatValue());
            service.update();
        }
        call.resolve();
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void setActionHandler(PluginCall call) {
        call.setKeepAlive(true);
        actionHandlers.put(call.getString("action"), call);
        if (service != null) service.updatePossibleActions();
    }

    public boolean hasActionHandler(String action) {
        PluginCall call = actionHandlers.get(action);
        return call != null && !call.getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING);
    }

    public void actionCallback(String action) {
        actionCallback(action, new JSObject());
    }

    public void actionCallback(String action, JSObject data) {
        PluginCall call = actionHandlers.get(action);
        if (call != null && !call.getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING)) {
            data.put("action", action);
            call.resolve(data);
        } else {
            Log.d(TAG, "Sem handler pra ação " + action);
        }
    }

    // ── Reprodução de verdade (ExoPlayer dentro do NativePlayerService) ──

    // items[0] é a faixa atual, items[1] (se vier) é a próxima já
    // preparada — ver NativePlayerService.QueueItem/loadQueueAndPlay.
    // Assim, se a atual terminar com o app fechado, o ExoPlayer já tem
    // pra onde ir sozinho, sem precisar do JS (ver FASE 3 no topo do
    // NativePlayerService.java).
    @PluginMethod
    public void load(PluginCall call) {
        final double resumeSeconds = call.getDouble("resumeSeconds", 0.0);
        final long resumeMs = Math.round(resumeSeconds * 1000);

        final JSArray itemsArray = call.getArray("items");
        final List<NativePlayerService.QueueItem> queueItems = new ArrayList<>();
        if (itemsArray != null) {
            try {
                for (JSONObject obj : itemsArray.<JSONObject>toList()) {
                    NativePlayerService.QueueItem item = new NativePlayerService.QueueItem();
                    item.id = obj.optString("id", null);
                    item.title = obj.optString("title", "");
                    item.artist = obj.optString("artist", "");
                    item.album = obj.optString("album", "");
                    item.artworkUrl = obj.optString("artworkUrl", null);
                    item.url = obj.optString("url", null);
                    item.path = obj.optString("path", null);
                    JSONObject headersObj = obj.optJSONObject("headers");
                    if (headersObj != null) {
                        Map<String, String> headers = new HashMap<>();
                        Iterator<String> keys = headersObj.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            headers.put(k, headersObj.optString(k, ""));
                        }
                        item.headers = headers;
                    }
                    queueItems.add(item);
                }
            } catch (Exception e) {
                Log.w(TAG, "Falha ao ler a fila enviada pro player nativo", e);
            }
        }

        final String repeatMode = call.getString("repeatMode", "none");

        ensureServiceThen(() -> service.loadQueueAndPlay(queueItems, resumeMs, repeatMode));
        call.resolve();
    }

    @PluginMethod
    public void nativePlay(PluginCall call) {
        ensureServiceThen(() -> service.nativePlay());
        call.resolve();
    }

    @PluginMethod
    public void nativePause(PluginCall call) {
        if (service != null) service.nativePause();
        call.resolve();
    }

    @PluginMethod
    public void nativeSeek(PluginCall call) {
        double seconds = call.getDouble("positionSeconds", 0.0);
        if (service != null) service.nativeSeekTo(Math.round(seconds * 1000));
        call.resolve();
    }

    @PluginMethod
    public void nativeGetState(PluginCall call) {
        JSObject ret = new JSObject();
        if (service != null) {
            ret.put("playing", service.isPlayingNow());
            ret.put("positionSeconds", service.getPositionMs() / 1000.0);
            ret.put("durationSeconds", service.getDurationMs() / 1000.0);
            ret.put("trackId", service.getCurrentMediaId());
        } else {
            ret.put("playing", false);
            ret.put("positionSeconds", 0);
            ret.put("durationSeconds", 0);
            ret.put("trackId", null);
        }
        call.resolve(ret);
    }

    // Chamado pelo NativePlayerService quando o ExoPlayer muda de
    // estado sozinho (ver player.js: escuta "hmNativeStateChanged" /
    // "hmNativeEnded" / "hmNativeError" através do native-bridge.js).
    public void notifyStateChanged(boolean playing, long positionMs, long durationMs) {
        JSObject data = new JSObject();
        data.put("playing", playing);
        data.put("positionSeconds", positionMs / 1000.0);
        data.put("durationSeconds", durationMs / 1000.0);
        notifyListeners("stateChanged", data);
    }

    public void notifyEnded() {
        notifyListeners("ended", new JSObject());
    }

    public void notifyError(String message) {
        JSObject data = new JSObject();
        data.put("message", message != null ? message : "Erro de reprodução");
        notifyListeners("error", data);
    }

    // O ExoPlayer trocou de faixa sozinho (ver
    // NativePlayerService.onMediaItemTransition) — o JS usa isso só pra
    // manter sua própria marcação de "faixa atual" em dia, sem recarregar
    // nada (a faixa já está tocando de verdade).
    public void notifyTrackChanged(String trackId) {
        JSObject data = new JSObject();
        data.put("trackId", trackId);
        notifyListeners("trackChanged", data);
    }
}
