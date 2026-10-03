package com.happymusic.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Guarda no aparelho o que está tocando (fila, faixa atual, posição), pra
 * o app mostrar e retomar EXATAMENTE de onde parou — mesmo se o sistema
 * matar o processo, o serviço reiniciar ou o usuário fechar e reabrir.
 *
 * Quem escreve é só o serviço nativo (é ele quem sabe a verdade, o JS pode
 * estar morto). Quem lê é o próprio serviço (ao reiniciar) e o plugin (pra
 * responder ao JS enquanto o serviço ainda não está rodando).
 *
 * Nunca guarda cabeçalhos/tokens: eles expiram, e o serviço renova sozinho
 * (ver DriveAuth).
 */
final class PlaybackStore {

    static final class Snapshot {
        final List<NativePlayerService.QueueItem> items;
        final int index;
        final long positionMs;
        final String repeatMode;

        Snapshot(List<NativePlayerService.QueueItem> items, int index, long positionMs, String repeatMode) {
            this.items = items;
            this.index = index;
            this.positionMs = positionMs;
            this.repeatMode = repeatMode;
        }

        String currentId() {
            if (index < 0 || index >= items.size()) return null;
            return items.get(index).id;
        }
    }

    private static final String PREFS = "hm_playback";
    private static final String KEY_QUEUE = "queue";
    private static final String KEY_REPEAT = "repeat";
    private static final String KEY_INDEX = "index";
    private static final String KEY_POSITION = "position";

    private PlaybackStore() { }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Grava a fila inteira (chamar só quando a fila muda). Zera a posição. */
    static void saveQueue(Context ctx, List<NativePlayerService.QueueItem> items, int index, String repeatMode) {
        try {
            JSONArray arr = new JSONArray();
            for (NativePlayerService.QueueItem it : items) {
                JSONObject o = new JSONObject();
                o.put("id", it.id == null ? "" : it.id);
                o.put("title", it.title == null ? "" : it.title);
                o.put("artist", it.artist == null ? "" : it.artist);
                o.put("album", it.album == null ? "" : it.album);
                if (it.artworkUrl != null) o.put("artworkUrl", it.artworkUrl);
                if (it.path != null && !it.path.isEmpty()) o.put("path", it.path);
                if (it.url != null && !it.url.isEmpty()) o.put("url", it.url);
                arr.put(o);
            }
            prefs(ctx).edit()
                    .putString(KEY_QUEUE, arr.toString())
                    .putString(KEY_REPEAT, repeatMode == null ? "none" : repeatMode)
                    .putInt(KEY_INDEX, index)
                    .putLong(KEY_POSITION, 0L)
                    .apply();
        } catch (Exception ignored) {
            // não é crítico: no pior caso o app só não retoma de onde parou
        }
    }

    /** Grava só a faixa atual e a posição (barato — pode chamar com frequência). */
    static void savePosition(Context ctx, int index, long positionMs) {
        prefs(ctx).edit().putInt(KEY_INDEX, index).putLong(KEY_POSITION, Math.max(0L, positionMs)).apply();
    }

    static void clear(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }

    /** Devolve o que foi salvo, ou null se não há nada (ou está ilegível). */
    static Snapshot read(Context ctx) {
        try {
            SharedPreferences p = prefs(ctx);
            String raw = p.getString(KEY_QUEUE, null);
            if (raw == null) return null;
            JSONArray arr = new JSONArray(raw);
            List<NativePlayerService.QueueItem> items = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                NativePlayerService.QueueItem it = new NativePlayerService.QueueItem();
                it.id = o.optString("id", "");
                it.title = o.optString("title", "");
                it.artist = o.optString("artist", "");
                it.album = o.optString("album", "");
                it.artworkUrl = o.has("artworkUrl") ? o.optString("artworkUrl", null) : null;
                it.path = o.has("path") ? o.optString("path", null) : null;
                it.url = o.has("url") ? o.optString("url", null) : null;
                items.add(it);
            }
            if (items.isEmpty()) return null;
            int index = p.getInt(KEY_INDEX, 0);
            if (index < 0 || index >= items.size()) index = 0;
            return new Snapshot(items, index, p.getLong(KEY_POSITION, 0L), p.getString(KEY_REPEAT, "none"));
        } catch (Exception e) {
            return null;
        }
    }
}
