package com.happymusic.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.Handler;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Normalização de volume entre as músicas.
 *
 * Como funciona: pra cada música, decodifica alguns trechos (~30 s no total,
 * numa thread de baixa prioridade), mede o volume percebido em LUFS (ver
 * LoudnessMeter) e guarda o resultado no aparelho, por id da música. Na hora
 * de tocar, o serviço pede gainLinearFor(id) e ajusta o volume do player:
 * músicas mais altas que o alvo são ABAIXADAS até o alvo; as mais baixas
 * ficam como estão (não há amplificação — amplificar pode distorcer, e o
 * controle de volume do aparelho resolve).
 *
 * A medição de uma música nunca é refeita (fica em cache). O serviço pede a
 * análise da faixa atual e das próximas, então normalmente o ganho já está
 * pronto antes da música começar.
 */
final class VolumeNormalizer {

    interface Listener {
        /** Chamado na thread principal quando a medição de uma faixa fica pronta. */
        void onLoudnessReady(String trackId);
    }

    /** Volume alvo. Faixas mais altas que isso são abaixadas até aqui. */
    static final double TARGET_LUFS = -16.0;
    /** Nunca abaixa mais que isso (evita efeitos estranhos em medições erradas). */
    static final double MAX_ATTENUATION_DB = 18.0;

    private static final String TAG = "VolumeNormalizer";
    private static final String PREFS_LOUDNESS = "hm_loudness";
    private static final String PREFS_SETTINGS = "hm_normalizer_settings";
    private static final String KEY_ENABLED = "enabled";

    private static final long SEGMENT_SHORT_US = 40_000_000L; // faixa curta: 40 s do começo
    private static final long SEGMENT_US = 15_000_000L;       // faixa normal: 2 trechos de 15 s
    private static final long LONG_TRACK_US = 70_000_000L;
    private static final long TIMEOUT_MS = 45_000L;

    private final Context context;
    private final Handler mainHandler;
    private final Listener listener;
    private final SharedPreferences loudnessPrefs;

    private volatile boolean enabled;
    private volatile Set<String> wanted = Collections.emptySet();

    private final Map<String, Float> cache = new ConcurrentHashMap<>();
    private final Set<String> queued = Collections.synchronizedSet(new HashSet<String>());
    private final Set<String> failed = Collections.synchronizedSet(new HashSet<String>());

    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "hm-loudness");
        t.setDaemon(true);
        t.setPriority(Thread.MIN_PRIORITY);
        return t;
    });

    /** Interrompe a análise em andamento (a faixa saiu da lista de interesse). */
    private static final class CancelledException extends RuntimeException {
        CancelledException() { super("cancelled", null, false, false); }
    }

    VolumeNormalizer(Context context, Handler mainHandler, Listener listener) {
        this.context = context.getApplicationContext();
        this.mainHandler = mainHandler;
        this.listener = listener;
        this.loudnessPrefs = this.context.getSharedPreferences(PREFS_LOUDNESS, Context.MODE_PRIVATE);
        this.enabled = readEnabled(this.context);
        for (Map.Entry<String, ?> e : loudnessPrefs.getAll().entrySet()) {
            if (e.getValue() instanceof Float) cache.put(e.getKey(), (Float) e.getValue());
        }
    }

    // ── Configuração (ligar/desligar) ─────────────────────────────

    static boolean readEnabled(Context ctx) {
        return ctx.getApplicationContext()
                .getSharedPreferences(PREFS_SETTINGS, Context.MODE_PRIVATE)
                .getBoolean(KEY_ENABLED, true); // ligado por padrão
    }

    static void saveEnabled(Context ctx, boolean value) {
        ctx.getApplicationContext()
                .getSharedPreferences(PREFS_SETTINGS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_ENABLED, value).apply();
    }

    boolean isEnabled() { return enabled; }

    /** Relê a configuração salva (o plugin grava e avisa o serviço). */
    void reloadEnabled() {
        enabled = readEnabled(context);
        if (!enabled) wanted = Collections.emptySet(); // para análises pendentes
    }

    // ── Ganho ─────────────────────────────────────────────────────

    /** Ganho em dB (≤ 0) para uma faixa de volume 'lufs'. Pública pra teste. */
    static double gainDbFor(double lufs) {
        if (Double.isNaN(lufs) || Double.isInfinite(lufs)) return 0.0;
        double g = TARGET_LUFS - lufs;
        if (g > 0.0) g = 0.0;
        if (g < -MAX_ATTENUATION_DB) g = -MAX_ATTENUATION_DB;
        return g;
    }

    /** Fator linear (0..1) para player.setVolume(); 1.0 se desligado ou ainda sem medição. */
    float gainLinearFor(String trackId) {
        if (!enabled || trackId == null) return 1.0f;
        Float lufs = cache.get(trackId);
        if (lufs == null) return 1.0f;
        return (float) Math.pow(10.0, gainDbFor(lufs) / 20.0);
    }

    // ── Análise em segundo plano ──────────────────────────────────

    /**
     * Pede a análise dessas faixas, em ordem de prioridade (a atual primeiro).
     * Substitui o pedido anterior: o que saiu da lista é abandonado.
     */
    void analyzeAsync(List<NativePlayerService.QueueItem> items) {
        if (!enabled || items == null) return;
        Set<String> w = new HashSet<>();
        for (NativePlayerService.QueueItem it : items) {
            if (it != null && it.id != null) w.add(it.id);
        }
        wanted = w;
        for (final NativePlayerService.QueueItem it : items) {
            if (it == null || it.id == null) continue;
            if (cache.containsKey(it.id) || failed.contains(it.id)) continue;
            if (!queued.add(it.id)) continue;
            try {
                executor.execute(() -> runAnalysis(it));
            } catch (Exception e) {
                queued.remove(it.id);
            }
        }
    }

    private void runAnalysis(final NativePlayerService.QueueItem it) {
        try {
            if (!enabled || !wanted.contains(it.id)) return;
            double lufs = measure(it);
            if (Double.isNaN(lufs) || Double.isInfinite(lufs)) {
                failed.add(it.id);
                return;
            }
            cache.put(it.id, (float) lufs);
            loudnessPrefs.edit().putFloat(it.id, (float) lufs).apply();
            mainHandler.post(() -> listener.onLoudnessReady(it.id));
        } catch (CancelledException ignored) {
            // não é falha: só deixou de interessar (a faixa mudou/lista trocou)
        } catch (Throwable t) {
            Log.w(TAG, "Falha ao medir volume de " + it.id + ": " + t);
            failed.add(it.id); // não insiste de novo nesta sessão
        } finally {
            queued.remove(it.id);
        }
    }

    private void checkAlive(String id, long deadline) {
        if (!enabled || !wanted.contains(id)) throw new CancelledException();
        if (SystemClock.elapsedRealtime() > deadline) throw new IllegalStateException("tempo esgotado");
    }

    /** Decodifica trechos da faixa e devolve o LUFS integrado (NaN se não deu). */
    private double measure(NativePlayerService.QueueItem it) throws Exception {
        final long deadline = SystemClock.elapsedRealtime() + TIMEOUT_MS;
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        try {
            if (it.path != null && !it.path.isEmpty()) {
                Uri uri = it.path.contains("://") ? Uri.parse(it.path) : Uri.fromFile(new File(it.path));
                if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
                    extractor.setDataSource(uri.getPath());
                } else {
                    extractor.setDataSource(context, uri, null);
                }
            } else if (it.url != null) {
                Map<String, String> headers = it.headers != null ? it.headers : new HashMap<String, String>();
                extractor.setDataSource(it.url, headers);
            } else {
                return Double.NaN;
            }

            int trackIndex = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { trackIndex = i; format = f; break; }
            }
            if (trackIndex < 0 || format == null) return Double.NaN;
            extractor.selectTrack(trackIndex);

            long durationUs = format.containsKey(MediaFormat.KEY_DURATION) ? format.getLong(MediaFormat.KEY_DURATION) : 0L;
            long[] starts;
            long segmentUs;
            if (durationUs > LONG_TRACK_US) {
                starts = new long[]{(long) (durationUs * 0.25), (long) (durationUs * 0.60)};
                segmentUs = SEGMENT_US;
            } else {
                starts = new long[]{0L};
                segmentUs = SEGMENT_SHORT_US;
            }

            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            codec.configure(format, null, null, 0);
            codec.start();

            int rate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
            int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;
            int pcmEncoding = 2; // ENCODING_PCM_16BIT

            LoudnessMeter meter = null;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

            for (int seg = 0; seg < starts.length; seg++) {
                if (starts[seg] > 0) extractor.seekTo(starts[seg], MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                if (seg > 0) codec.flush(); // descarta o que sobrou do trecho anterior

                long framesTarget = 0; // calculado quando a taxa real (da saída) for conhecida
                long frames = 0;
                boolean inputDone = false, outputDone = false;

                while (!outputDone) {
                    checkAlive(it.id, deadline);

                    if (!inputDone) {
                        int ii = codec.dequeueInputBuffer(10_000);
                        if (ii >= 0) {
                            ByteBuffer ib = codec.getInputBuffer(ii);
                            int size = ib != null ? extractor.readSampleData(ib, 0) : -1;
                            if (size < 0) {
                                codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                inputDone = true;
                            } else {
                                codec.queueInputBuffer(ii, 0, size, extractor.getSampleTime(), 0);
                                extractor.advance();
                            }
                        }
                    }

                    int oi = codec.dequeueOutputBuffer(info, 10_000);
                    if (oi >= 0) {
                        if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                            ByteBuffer ob = codec.getOutputBuffer(oi);
                            if (ob != null) {
                                if (meter == null) meter = new LoudnessMeter(rate, channels);
                                if (framesTarget == 0) framesTarget = (long) rate * segmentUs / 1_000_000L;
                                frames += feed(meter, ob, info.offset, info.size, channels, pcmEncoding);
                            }
                        }
                        if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                        codec.releaseOutputBuffer(oi, false);
                        if (framesTarget > 0 && frames >= framesTarget) break;
                    } else if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        MediaFormat of = codec.getOutputFormat();
                        if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                        if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                        pcmEncoding = of.containsKey("pcm-encoding") ? of.getInteger("pcm-encoding") : 2;
                    }
                }
                if (meter != null) meter.endSegment();
            }

            return meter != null ? meter.integratedLufs() : Double.NaN;
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (Exception ignored) { }
                try { codec.release(); } catch (Exception ignored) { }
            }
            try { extractor.release(); } catch (Exception ignored) { }
        }
    }

    /** Converte o PCM decodificado em float e entrega ao medidor. Devolve quantos frames. */
    private static int feed(LoudnessMeter meter, ByteBuffer ob, int offset, int size, int channels, int encoding) {
        if (channels < 1) return 0;
        ob.position(offset);
        ob.limit(offset + size);
        ob.order(ByteOrder.nativeOrder());

        int bytesPerSample = encoding == 4 ? 4 : (encoding == 3 ? 1 : 2);
        int frames = size / bytesPerSample / channels;
        if (frames <= 0) return 0;
        int samples = frames * channels;
        float[] buf = new float[samples];

        if (encoding == 4) {            // PCM float
            FloatBuffer fb = ob.asFloatBuffer();
            fb.get(buf, 0, samples);
        } else if (encoding == 3) {     // PCM 8 bits (sem sinal)
            for (int i = 0; i < samples; i++) buf[i] = ((ob.get() & 0xFF) - 128) / 128f;
        } else {                        // PCM 16 bits
            ShortBuffer sb = ob.asShortBuffer();
            for (int i = 0; i < samples; i++) buf[i] = sb.get() / 32768f;
        }
        meter.addInterleaved(buf, frames, channels);
        return frames;
    }
}
