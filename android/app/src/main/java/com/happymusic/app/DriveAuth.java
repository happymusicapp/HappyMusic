package com.happymusic.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Token de acesso ao Google Drive, renovado AQUI no nativo.
 *
 * Por quê: o token do Drive vale ~1 hora. Antes, o JS entregava ao
 * ExoPlayer o token já embutido nas faixas da fila — com o app fechado
 * numa viagem longa, as faixas seguintes começavam depois de o token
 * vencer, falhavam, e a música simplesmente parava. Agora o serviço
 * pede um token válido a cada vez que abre um arquivo do Drive (ver
 * NativePlayerService.buildDriveDataSourceFactory), sem depender do JS.
 *
 * O JS só entrega as credenciais (setAuth) ao entrar/renovar; o
 * refresh_token é o mesmo que o app já guarda no próprio aparelho.
 */
final class DriveAuth {

    private static final String PREFS = "hm_native_auth";
    private static final String KEY_REFRESH = "refresh";
    private static final String KEY_API_BASE = "api_base";
    private static final String KEY_ACCESS = "access";
    private static final String KEY_EXPIRY = "expiry";
    private static final long MARGIN_MS = 90_000L;

    private DriveAuth() { }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isDriveUrl(String url) {
        return url != null && url.startsWith("https://www.googleapis.com/drive/");
    }

    static void save(Context ctx, String refreshToken, String apiBase, String accessToken, long expiryMs) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        if (refreshToken != null && !refreshToken.isEmpty()) e.putString(KEY_REFRESH, refreshToken);
        if (apiBase != null && !apiBase.isEmpty()) e.putString(KEY_API_BASE, apiBase);
        if (accessToken != null && !accessToken.isEmpty()) {
            e.putString(KEY_ACCESS, accessToken);
            e.putLong(KEY_EXPIRY, expiryMs);
        }
        e.apply();
    }

    static void clear(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }

    /**
     * Um token válido (renovando se preciso), ou null se não deu. Pode
     * bloquear até ~8 s na rede — chame de thread de carregamento, nunca da
     * principal. Sincronizado: só uma renovação por vez.
     */
    static synchronized String getToken(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String access = p.getString(KEY_ACCESS, null);
        long expiry = p.getLong(KEY_EXPIRY, 0L);
        long now = System.currentTimeMillis();
        if (access != null && expiry - now > MARGIN_MS) return access;

        String refresh = p.getString(KEY_REFRESH, null);
        String apiBase = p.getString(KEY_API_BASE, null);
        if (refresh != null && apiBase != null) {
            String fresh = refreshToken(ctx, refresh, apiBase);
            if (fresh != null) return fresh;
        }
        // Sem como renovar agora (sem rede?): usa o antigo se ainda não venceu de fato.
        if (access != null && expiry > now) return access;
        return null;
    }

    private static String refreshToken(Context ctx, String refresh, String apiBase) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(apiBase + "/api/refresh").openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONObject().put("refresh_token", refresh).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) { os.write(body); }
            if (conn.getResponseCode() != 200) return null;

            StringBuilder sb = new StringBuilder();
            try (InputStream is = conn.getInputStream()) {
                byte[] buf = new byte[2048];
                int n;
                while ((n = is.read(buf)) > 0) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
            JSONObject json = new JSONObject(sb.toString());
            String token = json.optString("access_token", null);
            if (token == null || token.isEmpty()) return null;
            long expiresIn = json.optLong("expires_in", 3600L);
            prefs(ctx).edit()
                    .putString(KEY_ACCESS, token)
                    .putLong(KEY_EXPIRY, System.currentTimeMillis() + expiresIn * 1000L)
                    .apply();
            return token;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
