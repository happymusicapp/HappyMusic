package com.happymusic.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.cache.Cache;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.ContentMetadata;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;

import java.io.File;
import java.util.ArrayList;

/**
 * Cache TEMPORÁRIO de áudio do streaming (Drive).
 *
 * Toda faixa tocada em streaming passa por aqui e fica guardada (até o limite);
 * além disso o serviço baixa antecipadamente as próximas da fila (ver
 * NativePlayerService.startPrefetch). Se a internet cair, o que estiver aqui
 * toca normalmente. Diferente dos downloads de verdade: tem limite de tamanho
 * e as mais antigas são apagadas sozinhas (LRU) — nunca enche o aparelho.
 */
final class TrackCache {

    static final long MAX_BYTES = 300L * 1024L * 1024L;
    static final long MAX_FILE_BYTES = 80L * 1024L * 1024L; // arquivo maior que isso não é pré-carregado
    static final int AHEAD = 5;                              // quantas faixas à frente

    private static final String PREFS = "hm_native_settings";
    private static final String KEY_PREFETCH = "prefetch";
    private static final String KEY_PREFETCH_MOBILE = "prefetch_mobile";

    private static SimpleCache cache;

    private TrackCache() { }

    static synchronized Cache get(Context ctx) {
        if (cache == null) {
            Context app = ctx.getApplicationContext();
            File dir = new File(app.getCacheDir(), "hm_audio_cache");
            cache = new SimpleCache(dir, new LeastRecentlyUsedCacheEvictor(MAX_BYTES),
                    new StandaloneDatabaseProvider(app));
        }
        return cache;
    }

    /** Fonte que lê do cache e, o que não tiver, busca no upstream (guardando). */
    static CacheDataSource.Factory factory(Context ctx, DataSource.Factory upstream) {
        return new CacheDataSource.Factory()
                .setCache(get(ctx))
                .setUpstreamDataSourceFactory(upstream)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }

    /** A faixa inteira já está no cache (toca sem internet)? */
    static boolean isFullyCached(Context ctx, String url) {
        if (url == null || url.isEmpty()) return false;
        try {
            Cache c = get(ctx);
            long length = ContentMetadata.getContentLength(c.getContentMetadata(url));
            return length > 0 && c.isCached(url, 0, length);
        } catch (Exception e) {
            return false;
        }
    }

    /** Apaga tudo (usado no logout). */
    static void clear(Context ctx) {
        try {
            Cache c = get(ctx);
            for (String key : new ArrayList<>(c.getKeys())) c.removeResource(key);
        } catch (Exception ignored) { }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean prefetchEnabled(Context ctx) { return prefs(ctx).getBoolean(KEY_PREFETCH, true); }

    /** Pré-carregar também com dados móveis (padrão: sim). */
    static boolean prefetchOnMobile(Context ctx) { return prefs(ctx).getBoolean(KEY_PREFETCH_MOBILE, true); }

    static void saveSettings(Context ctx, boolean enabled, boolean mobile) {
        prefs(ctx).edit().putBoolean(KEY_PREFETCH, enabled).putBoolean(KEY_PREFETCH_MOBILE, mobile).apply();
    }
}
