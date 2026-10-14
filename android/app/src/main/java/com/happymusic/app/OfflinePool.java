package com.happymusic.app;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Lista das músicas BAIXADAS da biblioteca, guardada no aparelho.
 *
 * O JS manda a lista sempre que a biblioteca carrega ou os downloads mudam. O player
 * nativo usa quando precisa de uma música que toque sem internet e a fila atual não tem
 * nenhuma baixada — assim funciona mesmo com o app fechado (sem o JS rodando).
 */
final class OfflinePool {
    private static final String FILE_NAME = "offline_pool.json";
    private static List<NativePlayerService.QueueItem> cache = null;

    private OfflinePool() { }

    static synchronized void save(Context ctx, String json) {
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), FILE_NAME))) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            // sem lista nova: fica a anterior (ou nenhuma)
        }
        cache = null;
    }

    static synchronized List<NativePlayerService.QueueItem> get(Context ctx) {
        if (cache != null) return cache;
        List<NativePlayerService.QueueItem> list = new ArrayList<>();
        try {
            File f = new File(ctx.getFilesDir(), FILE_NAME);
            if (f.exists()) {
                byte[] buf = new byte[(int) f.length()];
                try (FileInputStream in = new FileInputStream(f)) {
                    int off = 0;
                    while (off < buf.length) {
                        int n = in.read(buf, off, buf.length - off);
                        if (n < 0) break;
                        off += n;
                    }
                }
                JSONArray arr = new JSONArray(new String(buf, StandardCharsets.UTF_8));
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    NativePlayerService.QueueItem q = new NativePlayerService.QueueItem();
                    q.id = o.isNull("id") ? null : o.optString("id");
                    q.title = o.isNull("title") ? "" : o.optString("title");
                    q.artist = o.isNull("artist") ? "" : o.optString("artist");
                    q.album = o.isNull("album") ? "" : o.optString("album");
                    q.artworkUrl = o.isNull("artworkUrl") ? null : o.optString("artworkUrl");
                    q.path = o.isNull("path") ? null : o.optString("path");
                    if (q.id != null && !q.id.isEmpty() && q.path != null && !q.path.isEmpty()) list.add(q);
                }
            }
        } catch (Exception ignored) {
            // arquivo corrompido: trata como lista vazia
        }
        cache = list;
        return list;
    }

    /** O arquivo ainda está no aparelho? (pode ter sido apagado depois da última lista) */
    static boolean exists(NativePlayerService.QueueItem q) {
        try {
            String p = q.path;
            if (p == null) return false;
            String filePath = p.startsWith("file:") ? Uri.parse(p).getPath() : p;
            return filePath != null && new File(filePath).exists();
        } catch (Exception e) {
            return true;
        }
    }
}
