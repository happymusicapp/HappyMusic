package com.happymusic.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Avisos falados com a VOZ GRAVADA (arquivos em res/raw), em vez da voz do Android.
 *
 * Cada frase que o app fala tem um arquivo com nome combinado. Se TODOS os arquivos
 * que a frase precisa existirem, toca a gravação; se faltar qualquer um, devolve
 * null e quem chamou usa a voz do Android como antes — dá pra gravar aos poucos.
 *
 * Frases com final comum ("... Vou tocar as músicas baixadas.") tocam dois arquivos
 * em sequência: o início + "sufixo_baixadas".
 */
final class VoiceClips {
    private static final String SUFFIX_TEXT = " Vou tocar as músicas baixadas.";
    private static final String SUFFIX_KEY = "sufixo_baixadas";
    private static final Map<String, String> KEYS = new HashMap<>();
    static {
        KEYS.put("Sem internet. Vou tocar as músicas baixadas.", "sem_internet_baixadas");
        KEYS.put("Sinal fraco. Vou tocar as músicas baixadas.", "sinal_fraco_baixadas");
        KEYS.put("Sem internet e nenhuma música baixada na fila. Vou tentar de novo quando a conexão voltar.", "sem_internet_sem_baixadas");
        KEYS.put("Sinal fraco e nenhuma música baixada na fila. Vou continuar tentando.", "sinal_fraco_sem_baixadas");
        KEYS.put("Essa música não está mais disponível. Pulando.", "musica_indisponivel");
        KEYS.put("Não consegui carregar essa música. Pulando.", "nao_consegui_carregar");
        KEYS.put("Várias músicas não carregaram. Parei a reprodução.", "varias_falharam");
        KEYS.put("Internet voltou.", "internet_voltou");
        KEYS.put("A sessão do Google venceu. Entre de novo no app.", "sessao_venceu");
        KEYS.put("O Google Drive limitou o acesso. Tente de novo mais tarde.", "drive_limitou");
        KEYS.put("Faltam permissões do Google Drive. Saia da conta e entre de novo, marcando todas as permissões.", "faltam_permissoes");
        // Opcional (se gravar): "Várias músicas não carregaram." + sufixo
        KEYS.put("Várias músicas não carregaram.", "varias_falharam_curto");
    }

    private static MediaPlayer current;

    private VoiceClips() { }

    /** Ids dos arquivos que dizem esta frase, ou null se não há gravação completa dela. */
    static List<Integer> resolve(Context ctx, String text) {
        if (text == null) return null;
        List<String> keys = new ArrayList<>();
        String key = KEYS.get(text);
        if (key != null) {
            keys.add(key);
        } else if (text.endsWith(SUFFIX_TEXT)) {
            String headKey = KEYS.get(text.substring(0, text.length() - SUFFIX_TEXT.length()));
            if (headKey == null) return null;
            keys.add(headKey);
            keys.add(SUFFIX_KEY);
        } else {
            return null;
        }
        List<Integer> ids = new ArrayList<>();
        for (String k : keys) {
            int id = ctx.getResources().getIdentifier(k, "raw", ctx.getPackageName());
            if (id == 0) return null; // falta gravar este pedaço: usa a voz do Android na frase toda
            ids.add(id);
        }
        return ids;
    }

    /** Toca os arquivos em sequência (thread principal). onDone roda ao terminar ou se der erro. */
    static void play(Context ctx, List<Integer> ids, Runnable onDone) {
        stop();
        playAt(ctx.getApplicationContext(), ids, 0, onDone);
    }

    static synchronized void stop() {
        if (current != null) {
            try { current.stop(); } catch (Exception ignored) { }
            try { current.release(); } catch (Exception ignored) { }
            current = null;
        }
    }

    private static void playAt(final Context app, final List<Integer> ids, final int index, final Runnable onDone) {
        if (index >= ids.size()) {
            if (onDone != null) onDone.run();
            return;
        }
        try {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            MediaPlayer mp = MediaPlayer.create(app, ids.get(index), attrs, AudioManager.AUDIO_SESSION_ID_GENERATE);
            if (mp == null) {
                if (onDone != null) onDone.run();
                return;
            }
            synchronized (VoiceClips.class) { current = mp; }
            mp.setOnCompletionListener(m -> {
                try { m.release(); } catch (Exception ignored) { }
                synchronized (VoiceClips.class) { if (current == m) current = null; }
                playAt(app, ids, index + 1, onDone);
            });
            mp.setOnErrorListener((m, what, extra) -> {
                try { m.release(); } catch (Exception ignored) { }
                synchronized (VoiceClips.class) { if (current == m) current = null; }
                if (onDone != null) onDone.run();
                return true;
            });
            mp.start();
        } catch (Exception e) {
            if (onDone != null) onDone.run();
        }
    }
}
