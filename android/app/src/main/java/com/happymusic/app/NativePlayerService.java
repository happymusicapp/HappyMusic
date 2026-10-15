package com.happymusic.app;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;

import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

// Serviço que toca o áudio de VERDADE (ExoPlayer), fora do WebView — é
// isso que permite a música continuar depois de fechar o app (ver
// android:stopWithTask="false" no AndroidManifest.xml). Substitui o
// antigo @jofr/capacitor-media-session: a notificação/MediaSession
// abaixo é adaptada quase igual à daquele plugin (código já testado),
// só trocando os ícones (que vinham junto do pacote dele, agora usamos
// os do próprio Android) e ligando de verdade num player.
//
// FASE 1/2 deste projeto: a faixa atual toca de forma 100% nativa
// (sobrevive a fechar o app). Quem decide qual é a fila (shuffle,
// repeat, modo rádio, filtro/playlist) continua sendo o player.js.
//
// FASE 3: o ExoPlayer agora recebe a faixa atual + a próxima já
// preparadas (ver loadQueueAndPlay) — assim, se a atual terminar com o
// app fechado, ele mesmo avança pra próxima sozinho, sem precisar do
// JS. Cada item carrega seu próprio título/artista/capa (MediaMetadata
// do próprio Media3), pra notificação se atualizar sozinha quando isso
// acontece.
public class NativePlayerService extends Service {

    // Um item da fila enviado pelo JS: id da faixa, metadata pra
    // notificação, e OU {url,headers} (streaming do Drive) OU {path}
    // (arquivo já baixado).
    public static class QueueItem {
        public String id, title, artist, album, artworkUrl, url, path;
        public Map<String, String> headers;
    }

    private MediaSessionCompat mediaSession;
    private PlaybackStateCompat.Builder playbackStateBuilder;
    private MediaMetadataCompat.Builder mediaMetadataBuilder;
    private NotificationManager notificationManager;
    private NotificationCompat.Builder notificationBuilder;
    private MediaStyle notificationStyle;
    private final Map<String, NotificationCompat.Action> notificationActions = new HashMap<>();
    private final Map<String, Long> playbackStateActions = new HashMap<>();
    private final String[] possibleActions = {"previoustrack", "play", "pause", "nexttrack", "stop"};
    final Set<String> possibleCompactViewActions = new HashSet<>(Arrays.asList("previoustrack", "play", "pause", "nexttrack", "stop"));
    private static final int NOTIFICATION_ID = 1;

    private int playbackState = PlaybackStateCompat.STATE_NONE;
    private String title = "";
    private String artist = "";
    private String album = "";
    private Bitmap artwork = null;
    private long duration = 0;
    private long position = 0;
    private float playbackSpeed = 1.0F;

    private boolean possibleActionsUpdate = true;
    private boolean playbackStateUpdate = false;
    private boolean mediaMetadataUpdate = false;
    private boolean notificationUpdate = false;

    private NativePlayerPlugin plugin;
    private ExoPlayer player;

    // Instância viva deste serviço no processo atual (null se não está
    // rodando). Existe pra uma NOVA instância do plugin — criada quando o
    // app é reaberto, com a música ainda tocando em segundo plano — poder
    // se religar ao serviço que já existe, sem esperar o JS chamar algum
    // método que faça o bind (ver NativePlayerPlugin.load()).
    private static volatile NativePlayerService runningInstance = null;

    public static NativePlayerService getRunningInstance() {
        return runningInstance;
    }

    // Handler preso à thread principal — é NELA que o ExoPlayer precisa
    // ser criado e SEMPRE acessado depois (regra do próprio ExoPlayer,
    // não é opcional). Os métodos do plugin (load/nativePlay/nativePause/
    // nativeSeek) são chamados pelo Capacitor numa thread própria dele
    // ("CapacitorPlugins"), então toda operação que mexe em `player`
    // precisa ser despachada pra cá dentro (ver postToMain abaixo).
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    // Cópia do estado, atualizada só de dentro da thread principal
    // (pelo próprio Player.Listener e pelo positionTicker abaixo), pra
    // getPositionMs()/getDurationMs()/isPlayingNow() poderem ser lidos
    // com segurança de QUALQUER thread (ex.: nativeGetState() do plugin,
    // chamado da thread "CapacitorPlugins") sem tocar no player.
    private volatile boolean cachedPlaying = false;
    private volatile long cachedPositionMs = 0;
    private volatile long cachedDurationMs = 0;
    private volatile String cachedMediaId = null;

    // ── Normalização de volume (ver VolumeNormalizer) ──
    private VolumeNormalizer normalizer;
    // Faixas da fila atual, NA MESMA ORDEM da playlist do ExoPlayer — o
    // índice do player aponta direto pra cá (ver loadQueueAndPlay).
    private List<QueueItem> currentItems = new ArrayList<>();
    private Runnable volumeRamp = null;

    // ── Persistência, Bluetooth e ociosidade ──
    // Tudo isto vive AQUI, no serviço (que sobrevive ao app fechado), e não
    // no JS — é o que dá a confiabilidade de "app de música de verdade".
    private String repeatModeStr = "none";
    private volatile List<String> cachedQueueIds = new ArrayList<>();
    private volatile int cachedIndex = 0;
    private int tickCount = 0;
    private boolean foregroundActive = false;

    // Bluetooth/fone desconectado no meio da música (o carro desligou): o
    // ExoPlayer pausa sozinho; guardamos isso pra retomar quando um áudio
    // Bluetooth voltar. Só vale se a música ESTAVA tocando — se o usuário
    // pausou de propósito, não retoma sozinho.
    private boolean resumeOnBluetooth = false;
    private long resumeOnBluetoothUntil = 0;
    private Object bluetoothCallback = null;
    private static final long BLUETOOTH_RESUME_WINDOW_MS = 12L * 60 * 60 * 1000;

    // Parado/pausado por muito tempo: salva o estado e solta a notificação
    // (o app reabre exatamente de onde parou, ver PlaybackStore).
    private static final long IDLE_STOP_MS = 20L * 60 * 1000;
    private static final long IDLE_STOP_BLUETOOTH_MS = 3L * 60 * 60 * 1000;
    private boolean idleScheduled = false;
    private final Runnable idleShutdown = new Runnable() {
        @Override
        public void run() {
            idleScheduled = false;
            if (player == null) return;
            savePlaybackState();
            player.setPlayWhenReady(false);
            foregroundActive = false;
            stopForeground(true);
            stopSelf();
        }
    };

    // Quantas faixas seguidas puladas por erro (ver onPlayerError) —
    // zera assim que uma toca de verdade. É pra não ficar pulando a
    // fila inteira à toa quando o sinal cai por completo (ex.: um
    // trecho longo sem cobertura numa viagem) — depois de algumas
    // tentativas, para e espera o usuário interagir de novo.
    private int consecutiveErrorSkips = 0;
    private static final int MAX_CONSECUTIVE_ERROR_SKIPS = 5;

    // onIsPlayingChanged/onPlaybackStateChanged só disparam quando o
    // ESTADO muda — sem isso a posição ficaria parada entre um evento e
    // outro (a barra de progresso no app não andaria durante a música).
    private final Runnable positionTicker = new Runnable() {
        @Override
        public void run() {
            if (player != null) {
                cachedPlaying = wantsPlay();
                cachedPositionMs = Math.max(player.getCurrentPosition(), 0);
                long d = player.getDuration();
                cachedDurationMs = (d == C.TIME_UNSET) ? 0 : Math.max(d, 0);
                MediaItem current = player.getCurrentMediaItem();
                cachedMediaId = current != null ? current.mediaId : null;
                cachedIndex = Math.max(player.getCurrentMediaItemIndex(), 0);
                if (cachedPlaying && ++tickCount % 10 == 0) savePlaybackState();
            }
            mainHandler.postDelayed(this, 500);
        }
    };

    private void postToMain(Runnable action) {
        mainHandler.post(action);
    }

    private final IBinder binder = new LocalBinder();

    public final class LocalBinder extends Binder {
        NativePlayerService getService() {
            return NativePlayerService.this;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        // Ao contrário do plugin antigo, NÃO paramos o serviço aqui — é
        // exatamente esse "destroy no unbind" que fazia a música parar
        // ao fechar o app. Sem chamar destroy(), o serviço (e o
        // ExoPlayer dentro dele) continuam rodando soltos, plugados de
        // novo automaticamente quando o app reabrir.
        return super.onUnbind(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningInstance = this;

        // CRÍTICO: como esse serviço é iniciado via
        // ContextCompat.startForegroundService() (ver
        // NativePlayerPlugin.ensureServiceThen), o Android EXIGE que
        // startForeground() seja chamado aqui dentro do onCreate(), de
        // forma síncrona e imediata — nos primeiros segundos de vida do
        // serviço. Antes, esse startForeground() só acontecia dentro de
        // connectAndInitialize(), chamado só quando o plugin terminava de
        // se conectar (bind) — um passo A PARTE, que podia demorar um
        // pouquinho mais que o Android tolera. Resultado: o sistema
        // derrubava o app com "did not then call startForeground in
        // time" bem na hora de tocar qualquer música. Por isso toda a
        // criação do player/sessão/notificação agora acontece aqui,
        // incondicional, e connectAndInitialize() só entra depois pra
        // ligar o plugin e refinar o conteúdo da notificação.
        initializePlayer();
        normalizer = new VolumeNormalizer(this, mainHandler, trackId -> {
            // Medição pronta: se for da faixa que está tocando agora, aplica
            // com uma descida suave (a faixa já estava tocando sem ajuste).
            if (trackId != null && trackId.equals(cachedMediaId)) applyNormalization(true);
        });
        initializeMediaSession();
        initializeNotification(buildFallbackContentIntent());
        ensureForeground();
        mainHandler.post(positionTicker);

        // Reiniciou (sistema matou o processo, ou o app foi aberto depois de
        // muito tempo): reabre a fila de onde parou, em pausa.
        restorePlaybackFromStore();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            bluetoothCallback = BluetoothAudioWatcher.register(this, mainHandler, this::onBluetoothAudioConnected);
        }
        registerNetworkWatcher();
    }

    // PendingIntent genérico (abre o app do jeito normal) usado como
    // conteúdo da notificação até o plugin conectar e mandar o intent de
    // verdade (ver connectAndInitialize) — só existe pra o
    // startForeground() do onCreate() ter algo válido pra usar na hora.
    private PendingIntent buildFallbackContentIntent() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent == null) launchIntent = new Intent();
        return PendingIntent.getActivity(getApplicationContext(), 0, launchIntent, PendingIntent.FLAG_IMMUTABLE);
    }

    private void initializePlayer() {
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();
        // O ExoPlayer é o ÚNICO dono do foco de áudio e do "fone saiu": pausa
        // sozinho numa ligação/GPS (e retoma quando acaba) e quando o fone ou o
        // Bluetooth desconecta — direto no nativo, sem depender do JavaScript.
        // (Não existe mais plugin de foco no JS: dois donos de foco brigavam entre si.)
        //
        // WAKE_MODE_NETWORK: com a tela apagada o Android põe a CPU e o Wi-Fi pra
        // dormir; sem isto, tocando em streaming do Drive a música engasga ou
        // para depois de alguns minutos (principalmente em Xiaomi/Samsung).
        // Segura o wake lock só enquanto está de fato tocando.
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && plugin != null) {
                    plugin.notifyEnded();
                }
                notifyJsState();
                syncStateFromPlayer();
                updateIdleTimer();
                checkStallOffline();
            }

            // Ligação/áudio do WhatsApp/GPS tomou o foco (ou devolveu): atualiza
            // tela e notificação. Quem pausa e retoma é o próprio ExoPlayer.
            @Override
            public void onPlaybackSuppressionReasonChanged(int playbackSuppressionReason) {
                notifyJsState();
                syncStateFromPlayer();
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (!playWhenReady) {
                    if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) {
                        // Outro app assumiu o áudio de vez (YouTube, outro player): fica
                        // pausado e NÃO volta sozinho — nem ao reconectar o Bluetooth.
                        resumeOnBluetooth = false;
                    } else if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY) {
                        // Fone/Bluetooth/carro saiu com a música tocando: retoma quando voltar.
                        resumeOnBluetooth = true;
                        resumeOnBluetoothUntil = System.currentTimeMillis() + BLUETOOTH_RESUME_WINDOW_MS;
                    } else if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) {
                        resumeOnBluetooth = false; // pausou de propósito: não retoma sozinho
                    }
                } else if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) {
                    resumeOnBluetooth = false;
                }
                rescheduleIdleTimer();
                savePlaybackState();
                // Pausa/retomada com a música ainda carregando não muda isPlaying (já
                // era falso): sem isto o JS e a notificação ficariam sem saber.
                notifyJsState();
                syncStateFromPlayer();
            }

            @Override
            public void onPositionDiscontinuity(Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
                // Pulo de posição (busca na barra, troca de faixa): a notificação
                // precisa da posição nova pra barra de progresso ficar certa.
                notifyJsState();
                syncStateFromPlayer();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    consecutiveErrorSkips = 0; // tocou de verdade — zera o contador de pulos por erro
                    retriesOnCurrent = 0;
                    // Voltou a tocar do Drive depois de um período sem internet.
                    if (offlineAnnounced && networkUp && player != null
                            && isStreamingIndex(player.getCurrentMediaItemIndex())) {
                        offlineAnnounced = false;
                        announce("Internet voltou.");
                    }
                }
                notifyJsState();
                savePlaybackState();
                // Atualiza a notificação (ícone tocar/pausar) a partir do
                // player de verdade, não só quando o JS manda — é o que
                // faz o botão continuar certo mesmo com o app fechado
                // (ex.: usuário pausou pela notificação, e sem isso ela
                // ficava travada mostrando "pausar" de novo, então
                // apertar de novo só mandava pausar outra vez, "sem
                // fazer nada" na prática).
                syncStateFromPlayer();
            }

            @Override
            public void onMediaItemTransition(MediaItem item, int reason) {
                // Disparado toda vez que o ExoPlayer muda de faixa sozinho —
                // inclusive quando a atual termina com o app fechado e ele
                // avança pra próxima já preparada, ou quando o usuário usa
                // próxima/anterior pela notificação/Bluetooth/fone.
                onCurrentItemChanged(item, true);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (plugin != null) plugin.notifyError(error.getMessage());
                // O serviço é o ÚNICO que decide o que fazer com a falha (tentar de
                // novo, ir pra uma baixada, pular) e AVISA o motivo — ver
                // handlePlayerError. O JS só reflete o estado na tela.
                handlePlayerError(error);
            }
        });
    }

    private void initializeMediaSession() {
        mediaSession = new MediaSessionCompat(this, "HappyMusicNativeSession");
        mediaSession.setCallback(new MediaSessionCallback());
        mediaSession.setActive(true);

        playbackStateBuilder = new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY)
                .setState(PlaybackStateCompat.STATE_PAUSED, position, playbackSpeed);
        mediaSession.setPlaybackState(playbackStateBuilder.build());

        mediaMetadataBuilder = new MediaMetadataCompat.Builder()
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        mediaSession.setMetadata(mediaMetadataBuilder.build());
    }

    private void initializeNotification(PendingIntent contentIntent) {
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("playback", "Reprodução", NotificationManager.IMPORTANCE_LOW);
            notificationManager.createNotificationChannel(channel);
        }

        notificationStyle = new MediaStyle().setMediaSession(mediaSession.getSessionToken());
        notificationBuilder = new NotificationCompat.Builder(this, "playback")
                .setStyle(notificationStyle)
                .setSmallIcon(getApplicationInfo().icon) // ícone do próprio app — nada de recurso emprestado de outro pacote
                .setContentIntent(contentIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        // Ícones do próprio Android (android.R.drawable) em vez dos que
        // vinham junto do plugin antigo — sempre existem, em qualquer
        // aparelho, sem depender de nenhum pacote externo.
        notificationActions.put("play", new NotificationCompat.Action(
                android.R.drawable.ic_media_play, "Tocar", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)
        ));
        notificationActions.put("pause", new NotificationCompat.Action(
                android.R.drawable.ic_media_pause, "Pausar", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE)
        ));
        notificationActions.put("previoustrack", new NotificationCompat.Action(
                android.R.drawable.ic_media_previous, "Faixa anterior", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
        ));
        notificationActions.put("nexttrack", new NotificationCompat.Action(
                android.R.drawable.ic_media_next, "Próxima faixa", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
        ));
        notificationActions.put("stop", new NotificationCompat.Action(
                android.R.drawable.ic_media_pause, "Parar", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP)
        ));

        playbackStateActions.put("previoustrack", PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS);
        playbackStateActions.put("play", (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PLAY));
        playbackStateActions.put("pause", (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PAUSE));
        playbackStateActions.put("nexttrack", PlaybackStateCompat.ACTION_SKIP_TO_NEXT);
        playbackStateActions.put("seekto", PlaybackStateCompat.ACTION_SEEK_TO);
        playbackStateActions.put("stop", PlaybackStateCompat.ACTION_STOP);
    }

    private void startForegroundNow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notificationBuilder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notificationBuilder.build());
        }
    }

    // Chamado pelo NativePlayerPlugin assim que o bind com o serviço
    // termina. Nessa altura o player/sessão/notificação já existem (tudo
    // isso já rodou no onCreate() acima) — aqui só liga a referência do
    // plugin (pra repassar botões de mídia e eventos de estado) e troca o
    // PendingIntent genérico da notificação pelo de verdade (abre a
    // Activity certa em vez do launcher padrão do pacote).
    public void connectAndInitialize(NativePlayerPlugin plugin, Intent intent) {
        this.plugin = plugin;
        if (notificationBuilder != null && intent != null) {
            notificationBuilder.setContentIntent(PendingIntent.getActivity(getApplicationContext(), 0, intent, PendingIntent.FLAG_IMMUTABLE));
        }
        update();
    }

    // "Quer tocar" = o usuário (ou o sistema) mandou tocar e ainda não acabou.
    // É este o estado que o JS e a notificação mostram: durante o carregamento
    // entre faixas (BUFFERING) o player não está "tocando" por um instante,
    // mas a intenção continua sendo tocar — usar isPlaying() aqui fazia a tela
    // piscar pausado/tocando a cada troca de música.
    //
    // Perda TEMPORÁRIA de foco de áudio (ligação, WhatsApp gravando/tocando um
    // áudio, GPS falando): o ExoPlayer mantém playWhenReady=true e só "suprime"
    // o som, voltando sozinho quando o foco retorna. Aí a tela e a notificação
    // mostram PAUSADO (como o Spotify) em vez de fingir que está tocando.
    private boolean wantsPlay() {
        if (player == null) return false;
        int st = player.getPlaybackState();
        return player.getPlayWhenReady()
                && st != Player.STATE_ENDED
                && st != Player.STATE_IDLE
                && player.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_NONE;
    }

    // ── Foreground ─────────────────────────────────────────────────

    // Idempotente. No Android 12+ o sistema pode recusar subir um serviço
    // em foreground quando o app está em segundo plano (ex.: reinício
    // automático depois de ser morto) — nesse caso não derruba o app: o
    // serviço só encerra, e o PlaybackStore guarda o estado pra próxima vez.
    private void ensureForeground() {
        if (foregroundActive) return;
        try {
            startForegroundNow();
            foregroundActive = true;
        } catch (Exception e) {
            android.util.Log.w("NativePlayerService", "Não foi possível subir em foreground: " + e);
            stopSelf();
        }
    }

    // ── Ociosidade: pausado por muito tempo → solta a notificação ──

    private void updateIdleTimer() {
        if (player == null) return;
        int st = player.getPlaybackState();
        boolean active = player.getPlayWhenReady() && st != Player.STATE_ENDED && st != Player.STATE_IDLE;
        if (active) {
            mainHandler.removeCallbacks(idleShutdown);
            idleScheduled = false;
            return;
        }
        if (idleScheduled) return;
        idleScheduled = true;
        mainHandler.postDelayed(idleShutdown, resumeOnBluetooth ? IDLE_STOP_BLUETOOTH_MS : IDLE_STOP_MS);
    }

    private void rescheduleIdleTimer() {
        mainHandler.removeCallbacks(idleShutdown);
        idleScheduled = false;
        updateIdleTimer();
    }

    // ── Bluetooth: voltou um áudio Bluetooth ───────────────────────

    private void onBluetoothAudioConnected() {
        if (player == null || !resumeOnBluetooth) return;
        if (System.currentTimeMillis() > resumeOnBluetoothUntil) { resumeOnBluetooth = false; return; }
        if (player.getMediaItemCount() == 0 || player.getPlayWhenReady()) return;
        // Pequena espera: deixa o sistema terminar de trocar a saída de áudio
        // (retomar na hora pode tocar no alto-falante do celular por um instante
        // ou deixar a central do carro instável).
        mainHandler.postDelayed(() -> {
            if (player == null || !resumeOnBluetooth || player.getPlayWhenReady()) return;
            resumeOnBluetooth = false;
            ensureForeground();
            player.setPlayWhenReady(true);
        }, 1500);
    }

    // ── Faixa atual mudou ──────────────────────────────────────────

    private void onCurrentItemChanged(MediaItem item, boolean notifyPlugin) {
        if (item == null || player == null) return;
        cachedMediaId = item.mediaId; // já, sem esperar o próximo tick
        cancelWaiting(); // mudou de faixa: não está mais esperando a internet pela anterior
        cachedIndex = Math.max(player.getCurrentMediaItemIndex(), 0);
        MediaMetadata meta = item.mediaMetadata;
        setTitle(meta.title != null ? meta.title.toString() : "");
        setArtist(meta.artist != null ? meta.artist.toString() : "");
        setAlbum(meta.albumTitle != null ? meta.albumTitle.toString() : "");
        setArtwork(null); // limpa até a nova capa (se houver) carregar
        possibleActionsUpdate = true; // "próxima"/"anterior" mudam de disponibilidade a cada faixa
        update();
        fetchArtworkAsync(meta.artworkUri != null ? meta.artworkUri.toString() : null);

        // Avisa o JS (se estiver vivo): ele só mantém a marcação de "faixa atual"
        // e a UI em dia; não recarrega nada (já está tocando).
        if (notifyPlugin && plugin != null) plugin.notifyTrackChanged(item.mediaId);

        // Cada faixa tem o seu ajuste de volume (ver VolumeNormalizer).
        applyNormalization(false);
        savePlaybackState();
    }

    // ── Falhas, internet e avisos por voz ──────────────────────────
    // Regra de ouro: a música NÃO baixada SEMPRE é tentada (streaming do Drive).
    // Só quando a tentativa falha é que se decide o que fazer, sabendo o MOTIVO:
    //  - sem internet     -> vai pra próxima música BAIXADA da fila; se não há
    //                        nenhuma, espera a internet voltar e tenta a MESMA de novo
    //  - sinal fraco, erro passageiro, token vencido, Drive instável -> tenta de
    //                        novo a mesma faixa (até MAX_RETRIES_SAME_TRACK) antes de desistir
    //  - arquivo com problema (404 etc.) -> pula pra próxima
    // E em todos os casos AVISA por voz (e na tela, se o app estiver aberto).

    private static final String PREFS_NATIVE_SETTINGS = "hm_native_settings";
    private static final String KEY_VOICE_ALERTS = "voice_alerts";
    private static final int MAX_RETRIES_SAME_TRACK = 2;
    private static final long RETRY_BASE_DELAY_MS = 2000L;
    private static final long WAIT_NETWORK_POLL_MS = 15000L;
    private static final float DUCK_VOLUME = 0.25f;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private volatile boolean networkUp = true;
    private boolean waitingForNetwork = false;
    private boolean offlineAnnounced = false;
    private int retriesOnCurrent = 0;
    private String retryingMediaId = null;
    private Runnable retryRunnable = null;

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingSpeech = null;
    private boolean speakingDuck = false;
    private String lastAnnounced = null;
    private long lastAnnouncedAt = 0L;

    private final Runnable endDuck = this::finishSpeakingDuck;

    private final Runnable waitPoll = new Runnable() {
        @Override
        public void run() {
            if (!waitingForNetwork || player == null) return;
            if (isNetworkAvailable()) {
                networkUp = true;
                resumeAfterNetwork();
                return;
            }
            mainHandler.postDelayed(this, WAIT_NETWORK_POLL_MS);
        }
    };

    // Avisos por voz ligados/desligados nas configurações (padrão: ligado).
    static boolean readVoiceAlerts(Context ctx) {
        return ctx.getApplicationContext()
                .getSharedPreferences(PREFS_NATIVE_SETTINGS, Context.MODE_PRIVATE)
                .getBoolean(KEY_VOICE_ALERTS, true);
    }

    static void saveVoiceAlerts(Context ctx, boolean enabled) {
        ctx.getApplicationContext()
                .getSharedPreferences(PREFS_NATIVE_SETTINGS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_VOICE_ALERTS, enabled).apply();
    }

    // A faixa nesse índice vem do streaming (não está baixada)? Fora da lista: false.
    private boolean isStreamingIndex(int idx) {
        if (idx < 0 || idx >= currentItems.size()) return false;
        QueueItem it = currentItems.get(idx);
        return it.path == null || it.path.isEmpty();
    }

    // Próxima faixa BAIXADA depois de 'from' (dando a volta: melhor repetir uma
    // baixada do que ficar em silêncio). -1 se nenhuma da fila está baixada.
    private int findDownloadedIndex(int from) {
        int n = currentItems.size();
        for (int i = 1; i < n; i++) {
            int idx = (from + i) % n;
            if (!isStreamingIndex(idx)) return idx;
        }
        return -1;
    }

    // Há rede com acesso à internet agora? Na dúvida (sem permissão, sem dado), diz que sim.
    private boolean isNetworkAvailable() {
        try {
            if (connectivityManager == null) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Network n = connectivityManager.getActiveNetwork();
                if (n == null) return false;
                NetworkCapabilities c = connectivityManager.getNetworkCapabilities(n);
                return c == null || c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            }
            NetworkInfo ni = connectivityManager.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    private void registerNetworkWatcher() {
        try {
            connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivityManager == null) return;
            networkUp = isNetworkAvailable();
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) { mainHandler.post(() -> onNetworkChanged()); }
                // Pequena espera: logo após onLost o sistema ainda pode listar a rede antiga.
                @Override public void onLost(Network network) { mainHandler.postDelayed(() -> onNetworkChanged(), 400); }
            };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivityManager.registerDefaultNetworkCallback(networkCallback);
            } else {
                connectivityManager.registerNetworkCallback(
                        new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
                        networkCallback);
            }
        } catch (Exception e) {
            networkCallback = null; // sem monitor: o tratamento de erro continua funcionando
        }
    }

    private void onNetworkChanged() {
        boolean up = isNetworkAvailable();
        boolean was = networkUp;
        networkUp = up;
        if (up == was) return;
        if (up) {
            if (waitingForNetwork) resumeAfterNetwork();
            else if (offlineAnnounced) {
                offlineAnnounced = false;
                announce("Internet voltou.");
            }
        } else {
            checkStallOffline();
        }
    }

    // Travou carregando uma faixa do streaming e já se sabe que não há internet:
    // não espera o erro (pode levar vários segundos de silêncio) — age agora.
    private void checkStallOffline() {
        if (player == null || waitingForNetwork || networkUp) return;
        if (!player.getPlayWhenReady() || player.getPlaybackState() != Player.STATE_BUFFERING) return;
        if (!isStreamingIndex(player.getCurrentMediaItemIndex())) return;
        switchToDownloadedOrWait(false);
    }

    private void cancelWaiting() {
        waitingForNetwork = false;
        mainHandler.removeCallbacks(waitPoll);
    }

    private void resumeAfterNetwork() {
        cancelWaiting();
        retriesOnCurrent = 0;
        if (player == null) return;
        player.prepare(); // se já estava preparado, não faz nada
        player.setPlayWhenReady(true);
    }

    // Sem internet (ou sinal que não aguenta): toca a próxima baixada; se não há
    // nenhuma, fica esperando a conexão voltar pra tentar a MESMA faixa de novo.
    private void switchToDownloadedOrWait(boolean weakSignal) {
        if (player == null) return;
        if (retryRunnable != null) mainHandler.removeCallbacks(retryRunnable);
        boolean firstTime = !offlineAnnounced;
        offlineAnnounced = true;
        if (playDownloadedFallback()) {
            cancelWaiting();
            if (firstTime) {
                announce(weakSignal
                        ? "Sinal fraco. Vou tocar as músicas baixadas."
                        : "Sem internet. Vou tocar as músicas baixadas.");
            }
            return;
        }
        if (!waitingForNetwork) {
            waitingForNetwork = true;
            announce(weakSignal
                    ? "Sinal fraco e nenhuma música baixada na fila. Vou continuar tentando."
                    : "Sem internet e nenhuma música baixada na fila. Vou tentar de novo quando a conexão voltar.");
        }
        mainHandler.removeCallbacks(waitPoll);
        mainHandler.postDelayed(waitPoll, WAIT_NETWORK_POLL_MS);
    }

    // ── Sempre ter o que tocar ─────────────────────────────────────
    // Quando a música atual não dá pra tocar (sem internet, sinal fraco, limite do
    // Drive...), a ordem é: 1) próxima BAIXADA da fila (a playlist/filtro escolhido);
    // 2) uma BAIXADA sorteada da biblioteca; 3) uma baixada anterior da própria fila.

    private final java.util.Random fallbackRng = new java.util.Random();
    private final Set<String> fallbackPlayed = new HashSet<>();

    private int findDownloadedAhead(int from) {
        for (int idx = from + 1; idx < currentItems.size(); idx++) {
            if (!isStreamingIndex(idx)) return idx;
        }
        return -1;
    }

    private void jumpToIndex(int idx) {
        player.seekTo(idx, 0L);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private List<QueueItem> poolCandidates(List<QueueItem> pool, String curId, boolean skipPlayed) {
        List<QueueItem> out = new ArrayList<>();
        for (QueueItem q : pool) {
            if (q.id == null || q.id.equals(curId)) continue;
            if (skipPlayed && fallbackPlayed.contains(q.id)) continue;
            if (!OfflinePool.exists(q)) continue;
            out.add(q);
        }
        return out;
    }

    // Coloca a faixa logo depois da atual e toca. Mantém o player e a lista alinhados.
    private boolean insertAfterCurrentAndPlay(QueueItem item) {
        if (player == null) return false;
        List<QueueItem> playable = new ArrayList<>();
        List<MediaSource> sources = buildSources(Collections.singletonList(item), playable);
        if (sources.isEmpty() || playable.isEmpty()) return false;
        if (!(currentItems instanceof ArrayList)) currentItems = new ArrayList<>(currentItems);
        int at = Math.min(Math.max(player.getCurrentMediaItemIndex(), -1) + 1, currentItems.size());
        currentItems.add(at, playable.get(0));
        player.addMediaSource(at, sources.get(0));
        publishQueueIds();
        jumpToIndex(at);
        PlaybackStore.saveQueue(this, currentItems, at, repeatModeStr);
        return true;
    }

    // true = achou e já está tocando algo que não depende de internet.
    private boolean playDownloadedFallback() {
        if (player == null) return false;
        int cur = Math.max(player.getCurrentMediaItemIndex(), 0);

        int ahead = findDownloadedAhead(cur);
        if (ahead != -1) {
            jumpToIndex(ahead);
            return true;
        }

        MediaItem curItem = player.getCurrentMediaItem();
        String curId = curItem != null ? curItem.mediaId : "";
        List<QueueItem> pool = OfflinePool.get(this);
        List<QueueItem> candidates = poolCandidates(pool, curId, true);
        if (candidates.isEmpty()) {
            fallbackPlayed.clear(); // já passou por todas: recomeça o sorteio
            candidates = poolCandidates(pool, curId, false);
        }
        if (!candidates.isEmpty()) {
            QueueItem pick = candidates.get(fallbackRng.nextInt(candidates.size()));
            fallbackPlayed.add(pick.id);
            if (insertAfterCurrentAndPlay(pick)) return true;
        }

        int any = findDownloadedIndex(cur);
        if (any != -1) {
            jumpToIndex(any);
            return true;
        }
        return false;
    }

    private static int httpStatusOf(Throwable t) {
        int guard = 0;
        while (t != null && guard++ < 10) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) {
                return ((HttpDataSource.InvalidResponseCodeException) t).responseCode;
            }
            t = t.getCause();
        }
        return -1;
    }

    // Falha de leitura que costuma ser passageira (sinal fraco, conexão caindo,
    // timeout). Resposta HTTP de erro (404, 403...) NÃO entra aqui: tem tratamento próprio.
    private static boolean isTransientIoError(PlaybackException e) {
        Throwable t = e;
        int guard = 0;
        while (t != null && guard++ < 10) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) return false;
            t = t.getCause();
        }
        int code = e.errorCode;
        if (code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
                || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
                || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT) return true;
        t = e;
        guard = 0;
        while (t != null && guard++ < 10) {
            if (t instanceof java.net.SocketException
                    || t instanceof java.net.UnknownHostException
                    || t instanceof java.io.InterruptedIOException
                    || t instanceof javax.net.ssl.SSLException
                    || t instanceof java.io.EOFException) return true;
            t = t.getCause();
        }
        return false;
    }

    private void scheduleRetry() {
        retriesOnCurrent++;
        if (retryRunnable != null) mainHandler.removeCallbacks(retryRunnable);
        retryRunnable = () -> {
            if (player == null) return;
            player.prepare(); // volta da posição em que parou
            player.setPlayWhenReady(true);
        };
        mainHandler.postDelayed(retryRunnable, RETRY_BASE_DELAY_MS * retriesOnCurrent);
    }

    // Todas as falhas de reprodução passam por aqui (thread principal).
    private void handlePlayerError(PlaybackException error) {
        if (player == null) return;
        int idx = Math.max(player.getCurrentMediaItemIndex(), 0);
        MediaItem cur = player.getCurrentMediaItem();
        String id = cur != null ? cur.mediaId : null;
        boolean streaming = isStreamingIndex(idx);
        int code = error.errorCode;
        int http = httpStatusOf(error);
        boolean netAvailable = isNetworkAvailable();
        networkUp = netAvailable;
        // Sinal fraco raramente aparece como "sem rede": costuma vir como conexão
        // derrubada no meio, SSL cortado, fim de dados inesperado ou timeout —
        // erros genéricos de leitura. Tudo isso é CONEXÃO (passageiro), não
        // "música ruim": tenta de novo e, se não adiantar, vai pra uma baixada
        // em vez de pular de música em música (todas falhariam do mesmo jeito).
        boolean connectivity = streaming && (!netAvailable || isTransientIoError(error));

        if (!Objects.equals(id, retryingMediaId)) {
            retryingMediaId = id;
            retriesOnCurrent = 0;
        }

        if (connectivity) {
            // Tem rede, mas a conexão falhou (sinal fraco, troca de torre): tenta a MESMA
            // faixa de novo antes de desistir. Sem rede nenhuma, não adianta insistir.
            if (netAvailable && retriesOnCurrent < MAX_RETRIES_SAME_TRACK) {
                scheduleRetry();
                return;
            }
            switchToDownloadedOrWait(netAvailable);
            return;
        }

        if (streaming && http > 0) {
            if (http == 401 || http == 403 || http == 429 || http >= 500) {
                // Token vencido (renovado de novo na próxima abertura) ou Drive instável/limitando.
                if (http == 401 || http == 403) DriveAuth.invalidate(this);
                if (retriesOnCurrent < MAX_RETRIES_SAME_TRACK) {
                    scheduleRetry();
                    return;
                }
            }
            // O Drive respondeu com erro mesmo após tentar de novo. O motivo vem no corpo
            // da resposta (ex.: authError, downloadQuotaExceeded, rateLimitExceeded).
            String reason = driveReasonOf(error);
            String r = reason.toLowerCase(Locale.ROOT);
            if (plugin != null) {
                plugin.notifyNotice("Drive: HTTP " + http + (reason.isEmpty() ? "" : " (" + reason + ")"));
            }
            boolean noScope = http == 403 && r.contains("insufficientpermissions");
            boolean authProblem = http == 401 || r.contains("autherror") || r.contains("invalidcredentials");
            boolean limitProblem = http == 429 || (http == 403
                    && (r.contains("ratelimit") || r.contains("quota") || r.contains("dailylimit")));
            // Sessão vencida ou limite do Drive valem pra TODAS as faixas: pular de uma
            // pra outra só gastaria a fila — melhor explicar o motivo e ir pras baixadas.
            if (noScope) {
                stopWithReason("Faltam permissões do Google Drive. Saia da conta e entre de novo, marcando todas as permissões.");
                return;
            }
            if (authProblem) {
                stopWithReason("A sessão do Google venceu. Abra o app e entre de novo.");
                return;
            }
            if (limitProblem) {
                stopWithReason("O Google Drive limitou o acesso. Tente de novo mais tarde.");
                return;
            }
        } else if (plugin != null) {
            // Detalhe técnico só na tela (a voz fala o resumo): ajuda a descobrir a causa real.
            plugin.notifyNotice("Erro: " + error.getErrorCodeName());
        }
        skipAfterFailure(http == 404 || http == 410);
    }

    // Motivo que o Google manda no corpo do erro HTTP ("reason": "..."), ou "".
    private static String driveReasonOf(Throwable t) {
        int guard = 0;
        while (t != null && guard++ < 10) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) {
                byte[] body = ((HttpDataSource.InvalidResponseCodeException) t).responseBody;
                if (body != null && body.length > 0) {
                    String text = new String(body, java.nio.charset.StandardCharsets.UTF_8);
                    java.util.regex.Matcher m = java.util.regex.Pattern
                            .compile("\"reason\"\\s*:\\s*\"([^\"]+)\"").matcher(text);
                    if (m.find()) return m.group(1);
                }
                return "";
            }
            t = t.getCause();
        }
        return "";
    }

    // Falha que vale pra qualquer faixa do Drive (sessão, limite): fala o motivo; toca uma
    // baixada se houver, senão pausa (não adianta pular a fila inteira).
    private void stopWithReason(String message) {
        if (player == null) return;
        if (playDownloadedFallback()) {
            announce(message + " Vou tocar as músicas baixadas.");
            return;
        }
        announce(message);
        player.setPlayWhenReady(false);
    }

    private void skipAfterFailure(boolean gone) {
        if (player == null) return;
        consecutiveErrorSkips++;
        if (consecutiveErrorSkips > MAX_CONSECUTIVE_ERROR_SKIPS) {
            consecutiveErrorSkips = 0;
            // Nunca ficar sem música: tenta uma baixada antes de desistir.
            if (playDownloadedFallback()) {
                announce("Várias músicas não carregaram. Vou tocar uma música baixada.");
                return;
            }
            announce("Várias músicas não carregaram. Parei a reprodução.");
            player.setPlayWhenReady(false);
            return;
        }
        announce(gone
                ? "Essa música não está mais disponível. Pulando."
                : "Não consegui carregar essa música. Pulando.");
        if (player.hasNextMediaItem()) {
            player.seekToNextMediaItem();
            player.prepare();
            player.setPlayWhenReady(true);
        } else if (plugin != null) {
            // Fim da fila carregada: pede "próxima" ao JS (modo rádio). Não usa "acabou"
            // porque no "repetir uma" o JS recomeçaria a MESMA faixa que acabou de falhar.
            plugin.actionCallback("nexttrack");
        } else {
            player.setPlayWhenReady(false);
        }
    }

    // ── Aviso por voz (e na tela) ──────────────────────────────────

    // Aviso vindo do JS (ex.: "entre de novo"): só a voz — o JS já mostra na tela.
    public void speakNotice(final String text) {
        mainHandler.post(() -> { if (readVoiceAlerts(this)) speak(text); });
    }

    private void announce(final String text) {
        mainHandler.post(() -> {
            long now = android.os.SystemClock.uptimeMillis();
            if (text.equals(lastAnnounced) && now - lastAnnouncedAt < 20000L) return; // não repete a mesma frase
            lastAnnounced = text;
            lastAnnouncedAt = now;
            if (plugin != null) plugin.notifyNotice(text);
            if (readVoiceAlerts(this)) speak(text);
        });
    }

    private void speak(String text) {
        if (tts == null) {
            pendingSpeech = text;
            try {
                tts = new TextToSpeech(getApplicationContext(), status -> mainHandler.post(() -> onTtsInit(status)));
            } catch (Exception e) {
                tts = null;
                pendingSpeech = null;
            }
            return;
        }
        if (!ttsReady) {
            pendingSpeech = text;
            return;
        }
        doSpeak(text);
    }

    private void onTtsInit(int status) {
        if (tts == null) return;
        if (status != TextToSpeech.SUCCESS) {
            try { tts.shutdown(); } catch (Exception ignored) { }
            tts = null;
            pendingSpeech = null;
            return;
        }
        try {
            tts.setLanguage(new Locale("pt", "BR"));
            tts.setAudioAttributes(new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { }
                @Override public void onDone(String utteranceId) { mainHandler.post(NativePlayerService.this::finishSpeakingDuck); }
                @Override public void onError(String utteranceId) { mainHandler.post(NativePlayerService.this::finishSpeakingDuck); }
            });
        } catch (Exception ignored) { }
        ttsReady = true;
        if (pendingSpeech != null) {
            String s = pendingSpeech;
            pendingSpeech = null;
            doSpeak(s);
        }
    }

    private void doSpeak(String text) {
        try {
            // A música (se estiver tocando) abaixa enquanto a voz fala.
            speakingDuck = true;
            if (player != null) player.setVolume(duckCap(player.getVolume()));
            mainHandler.removeCallbacks(endDuck);
            mainHandler.postDelayed(endDuck, 15000L); // segurança: nunca deixa o volume preso
            int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "hm-notice");
            if (r != TextToSpeech.SUCCESS) finishSpeakingDuck();
        } catch (Exception e) {
            finishSpeakingDuck();
        }
    }

    private void finishSpeakingDuck() {
        mainHandler.removeCallbacks(endDuck);
        if (!speakingDuck) return;
        speakingDuck = false;
        applyNormalization(false); // volta ao volume normal da faixa
    }

    private float duckCap(float v) {
        return speakingDuck ? Math.min(v, DUCK_VOLUME) : v;
    }

    // ── Persistência ───────────────────────────────────────────────

    // Só da thread principal. A fila inteira é gravada quando muda (ver
    // loadQueueAndPlay); aqui só faixa atual + posição.
    private void savePlaybackState() {
        if (player == null || currentItems.isEmpty()) return;
        int idx = Math.max(player.getCurrentMediaItemIndex(), 0);
        long pos = player.getPlaybackState() == Player.STATE_ENDED ? 0L : Math.max(player.getCurrentPosition(), 0L);
        PlaybackStore.savePosition(this, idx, pos);
    }

    private void restorePlaybackFromStore() {
        if (player == null || player.getMediaItemCount() > 0) return;
        PlaybackStore.Snapshot snap = PlaybackStore.read(this);
        if (snap == null) return;

        List<QueueItem> playable = new ArrayList<>();
        List<MediaSource> sources = buildSources(snap.items, playable);
        if (sources.isEmpty()) return;

        int idx = Math.min(Math.max(snap.index, 0), playable.size() - 1);
        applyRepeatMode(snap.repeatMode);
        currentItems = playable;
        publishQueueIds();

        player.setMediaSources(sources, idx, snap.positionMs);
        player.prepare();
        player.setPlayWhenReady(false); // volta em pausa: quem decide tocar é o usuário
        onCurrentItemChanged(player.getCurrentMediaItem(), false);
        setPlaybackState(PlaybackStateCompat.STATE_PAUSED);
        setPosition(snap.positionMs);
        update();
        updateIdleTimer();
    }

    private void publishQueueIds() {
        List<String> ids = new ArrayList<>();
        for (QueueItem it : currentItems) ids.add(it.id == null ? "" : it.id);
        cachedQueueIds = ids;
    }

    /** O serviço está em foreground agora? (o plugin só pede pra subir se não estiver) */
    public boolean isForegroundActive() { return foregroundActive; }

    /** Ids da fila carregada, na ordem do player (lido de qualquer thread). */
    public List<String> getQueueIds() { return cachedQueueIds; }

    /** Posição da faixa atual dentro de getQueueIds(). */
    public int getCurrentIndex() { return cachedIndex; }

    private void applyRepeatMode(String mode) {
        repeatModeStr = mode == null ? "none" : mode;
        if ("one".equals(repeatModeStr)) player.setRepeatMode(Player.REPEAT_MODE_ONE);
        else if ("all".equals(repeatModeStr)) player.setRepeatMode(Player.REPEAT_MODE_ALL);
        else player.setRepeatMode(Player.REPEAT_MODE_OFF);
    }

    // ── Fontes de áudio ────────────────────────────────────────────

    // Faixas do Drive: o token de acesso é pedido AQUI, a cada abertura de
    // arquivo (ver DriveAuth) — nunca fica velho, mesmo com o app fechado
    // horas numa viagem. Os cabeçalhos que o JS mandou (se mandou) valem só
    // até o primeiro pedido; depois o token novo substitui.
    private DataSource.Factory buildDriveDataSourceFactory(Map<String, String> jsHeaders) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory();
        if (jsHeaders != null && !jsHeaders.isEmpty()) http.setDefaultRequestProperties(jsHeaders);
        final android.content.Context appContext = getApplicationContext();
        return new ResolvingDataSource.Factory(http, new ResolvingDataSource.Resolver() {
            @Override
            public DataSpec resolveDataSpec(DataSpec dataSpec) {
                if (DriveAuth.isDriveUrl(dataSpec.uri.toString())) {
                    String token = DriveAuth.getToken(appContext);
                    if (token != null) {
                        Map<String, String> headers = new HashMap<>(dataSpec.httpRequestHeaders);
                        headers.put("Authorization", "Bearer " + token);
                        return dataSpec.withRequestHeaders(headers);
                    }
                }
                return dataSpec;
            }
        });
    }

    // Monta as fontes do ExoPlayer. 'playable' recebe só quem virou fonte
    // (mantém o índice do player alinhado com a lista).
    private List<MediaSource> buildSources(List<QueueItem> items, List<QueueItem> playable) {
        List<MediaSource> sources = new ArrayList<>();
        for (QueueItem it : items) {
            MediaMetadata metadata = new MediaMetadata.Builder()
                    .setTitle(it.title)
                    .setArtist(it.artist)
                    .setAlbumTitle(it.album)
                    .setArtworkUri(it.artworkUrl != null ? Uri.parse(it.artworkUrl) : null)
                    .build();
            MediaItem.Builder itemBuilder = new MediaItem.Builder()
                    .setMediaId(it.id != null ? it.id : "")
                    .setMediaMetadata(metadata);

            if (it.path != null && !it.path.isEmpty()) {
                // getAudioPath() no JS já devolve uma URI "file://..." (é o que o
                // getUri() do plugin de Filesystem retorna)
                Uri uri = it.path.contains("://") ? Uri.parse(it.path) : Uri.fromFile(new File(it.path));
                MediaItem mediaItem = itemBuilder.setUri(uri).build();
                sources.add(new ProgressiveMediaSource.Factory(new androidx.media3.datasource.DefaultDataSource.Factory(this)).createMediaSource(mediaItem));
                playable.add(it);
            } else if (it.url != null && !it.url.isEmpty()) {
                MediaItem mediaItem = itemBuilder.setUri(Uri.parse(it.url)).build();
                // Só 1 retentativa interna do ExoPlayer: as demais (e a decisão de ir pra uma
                // baixada) são do handlePlayerError, que sabe o motivo e avisa por voz.
                sources.add(new ProgressiveMediaSource.Factory(buildDriveDataSourceFactory(it.headers))
                        .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(1))
                        .createMediaSource(mediaItem));
                playable.add(it);
            }
        }
        return sources;
    }

    // ── Controle de reprodução (chamado pelo NativePlayerPlugin) ────

    public void loadQueueAndPlay(List<QueueItem> items, long resumeMs, String repeatMode) {
        loadQueueAndPlay(items, 0, resumeMs, repeatMode);
    }

    // startIndex: posição, dentro de 'items', da faixa que deve tocar agora —
    // o JS manda também as faixas ANTERIORES (histórico), pra "anterior"
    // funcionar sozinho no nativo, sem o app aberto.
    public void loadQueueAndPlay(List<QueueItem> items, int startIndex, long resumeMs, String repeatMode) {
        postToMain(() -> {
            if (player == null || items == null || items.isEmpty()) return;

            ensureForeground();
            consecutiveErrorSkips = 0; // fila nova — zera o contador de "pulou por erro" (ver onPlayerError)
            resumeOnBluetooth = false; // o usuário escolheu o que tocar agora
            cancelWaiting();
            if (retryRunnable != null) mainHandler.removeCallbacks(retryRunnable);
            retriesOnCurrent = 0;
            retryingMediaId = null;

            // Dá a volta sozinho quando a lista entregue acabar (loop de
            // playlist/filtro, ou repetir tudo/uma faixa).
            applyRepeatMode(repeatMode);

            QueueItem wanted = (startIndex >= 0 && startIndex < items.size()) ? items.get(startIndex) : items.get(0);
            List<QueueItem> playable = new ArrayList<>();
            List<MediaSource> sources = buildSources(items, playable);
            if (sources.isEmpty()) return;
            currentItems = playable;
            publishQueueIds();
            int idx = Math.max(playable.indexOf(wanted), 0);

            player.setMediaSources(sources, idx, resumeMs > 0 ? resumeMs : 0);
            player.prepare();
            player.setPlayWhenReady(true);

            PlaybackStore.saveQueue(this, playable, idx, repeatModeStr);
            onCurrentItemChanged(player.getCurrentMediaItem(), false); // título, capa e volume já na primeira faixa
            possibleActionsUpdate = true;
            update();
        });
    }

    // ── Normalização de volume ────────────────────────────────────

    // Ajusta o volume do player pra faixa que está tocando agora (e pede
    // a medição dela e das próximas, se ainda não existirem). Sem medição
    // ainda, fica em 100% — quando ela chegar, onLoudnessReady chama isto
    // de novo com ramp=true. Roda sempre na thread principal.
    private void applyNormalization(boolean ramp) {
        if (player == null || normalizer == null) return;
        MediaItem cur = player.getCurrentMediaItem();
        String id = cur != null ? cur.mediaId : null;
        float target = normalizer.gainLinearFor(id);
        if (ramp) rampVolume(target, 1200);
        else setVolumeNow(target);

        if (!normalizer.isEnabled()) return;
        int index = player.getCurrentMediaItemIndex();
        List<QueueItem> want = new ArrayList<>();
        for (int i = Math.max(index, 0); i < Math.min(currentItems.size(), index + 3); i++) {
            want.add(currentItems.get(i));
        }
        normalizer.analyzeAsync(want);
    }

    private void setVolumeNow(float volume) {
        if (volumeRamp != null) { mainHandler.removeCallbacks(volumeRamp); volumeRamp = null; }
        if (player != null) player.setVolume(duckCap(volume));
    }

    private void rampVolume(final float requested, final int durationMs) {
        if (player == null) return;
        final float to = duckCap(requested);
        if (volumeRamp != null) { mainHandler.removeCallbacks(volumeRamp); volumeRamp = null; }
        final float from = player.getVolume();
        if (Math.abs(from - to) < 0.01f) { player.setVolume(to); return; }
        final long startedAt = android.os.SystemClock.uptimeMillis();
        volumeRamp = new Runnable() {
            @Override
            public void run() {
                if (player == null) { volumeRamp = null; return; }
                float t = Math.min(1f, (android.os.SystemClock.uptimeMillis() - startedAt) / (float) durationMs);
                player.setVolume(from + (to - from) * t);
                if (t < 1f) mainHandler.postDelayed(this, 40);
                else volumeRamp = null;
            }
        };
        mainHandler.post(volumeRamp);
    }

    // Chamado pelo plugin quando o usuário liga/desliga a normalização
    // nas configurações (o valor já foi gravado no aparelho).
    public void onNormalizationSettingChanged() {
        postToMain(() -> {
            if (normalizer == null) return;
            normalizer.reloadEnabled();
            // Desligado: volta pra 100% suave; ligado: aplica o ganho da faixa atual.
            if (normalizer.isEnabled()) applyNormalization(true);
            else rampVolume(1.0f, 400);
        });
    }

    // Baixa a capa da PRÓXIMA faixa quando o ExoPlayer troca sozinho (ver
    // onMediaItemTransition) — roda numa thread separada (é rede), e só
    // aplica o resultado se ainda for a faixa atual quando terminar.
    private void fetchArtworkAsync(String url) {
        if (url == null || url.isEmpty()) return;
        final String requestedFor = title + "|" + artist; // marcador simples pra não aplicar fora de hora
        new Thread(() -> {
            Bitmap bmp = null;
            try {
                if (url.startsWith("http")) {
                    HttpURLConnection connection = (HttpURLConnection) (new URL(url)).openConnection();
                    connection.setDoInput(true);
                    connection.connect();
                    InputStream inputStream = connection.getInputStream();
                    bmp = android.graphics.BitmapFactory.decodeStream(inputStream);
                }
            } catch (Exception ignored) { /* sem capa, sem problema */ }
            final Bitmap result = bmp;
            if (result != null) {
                mainHandler.post(() -> {
                    if (requestedFor.equals(title + "|" + artist)) {
                        setArtwork(result);
                        update();
                    }
                });
            }
        }).start();
    }

    public void nativePlay() {
        postToMain(() -> {
            if (player == null) return;
            ensureForeground();
            // O usuário mandou tocar: recomeça a contagem de falhas e, se o player
            // tinha parado por erro (IDLE), prepara de novo — senão "tocar" não fazia nada.
            consecutiveErrorSkips = 0;
            retriesOnCurrent = 0;
            if (player.getPlaybackState() == Player.STATE_IDLE && player.getMediaItemCount() > 0) player.prepare();
            player.setPlayWhenReady(true);
        });
    }

    public void nativePause() {
        postToMain(() -> { if (player != null) player.setPlayWhenReady(false); });
    }

    // Repetir ligado/desligado COM A MÚSICA TOCANDO: o ExoPlayer precisa saber na hora
    // (antes só era definido ao carregar a fila — o botão não tinha efeito até a
    // próxima troca de fila, e com o app fechado a repetição nunca funcionava).
    public void nativeSetRepeatMode(final String mode) {
        postToMain(() -> {
            if (player == null) return;
            applyRepeatMode(mode);
            if (!currentItems.isEmpty()) {
                PlaybackStore.saveQueue(this, currentItems, Math.max(player.getCurrentMediaItemIndex(), 0), repeatModeStr);
            }
        });
    }

    public void nativeSeekTo(long ms) {
        postToMain(() -> { if (player != null) player.seekTo(ms); });
    }

    // Avança/recua pra faixa já carregada no ExoPlayer (ver
    // loadQueueAndPlay) — funciona mesmo com o app fechado, desde que o
    // player já tenha essa faixa preparada. Devolve se conseguiu, pro
    // chamador (MediaSessionCallback) saber se ainda precisa avisar o JS.
    public boolean nativeSeekToNext() {
        if (player == null || !player.hasNextMediaItem()) return false;
        postToMain(player::seekToNextMediaItem);
        return true;
    }

    public boolean nativeSeekToPrevious() {
        if (player == null || !player.hasPreviousMediaItem()) return false;
        postToMain(player::seekToPreviousMediaItem);
        return true;
    }

    // Lê do cache (ver campo no topo do arquivo), nunca do player
    // direto — quem chama isso é nativeGetState() do plugin, que roda na
    // thread do Capacitor, não a principal (mesma regra de sempre do
    // ExoPlayer; foi exatamente essa leitura direta que crashava aqui).
    public String getCurrentMediaId() {
        return cachedMediaId;
    }

    public long getPositionMs() {
        return cachedPositionMs;
    }

    public long getDurationMs() {
        return cachedDurationMs;
    }

    public boolean isPlayingNow() {
        return cachedPlaying;
    }

    // Só é seguro chamar de dentro da thread principal (Player.Listener
    // já roda nela) — atualiza o cache (ver campos no topo do arquivo) e
    // avisa o JS. Chamadas vindas de outra thread devem usar
    // getPositionMs()/getDurationMs()/isPlayingNow()/getCurrentMediaId()
    // acima, não isto.
    private void notifyJsState() {
        if (player != null) {
            cachedPlaying = wantsPlay();
            cachedPositionMs = Math.max(player.getCurrentPosition(), 0);
            long d = player.getDuration();
            cachedDurationMs = (d == C.TIME_UNSET) ? 0 : Math.max(d, 0);
            MediaItem current = player.getCurrentMediaItem();
            cachedMediaId = current != null ? current.mediaId : null;
        }
        if (plugin != null) {
            plugin.notifyStateChanged(cachedPlaying, cachedPositionMs, cachedDurationMs);
        }
    }

    // Deixa a notificação/MediaSession fiel ao player de verdade, sem
    // depender do JS pra avisar (ele pode estar morto, com o app
    // fechado). Chamado pelo Player.Listener sempre que o ExoPlayer
    // muda de tocando/pausado sozinho.
    private void syncStateFromPlayer() {
        if (player == null) return;
        // "Tocando" pra notificação = quer tocar e não acabou. Durante o
        // carregamento (BUFFERING) continua mostrando "pausar", como o
        // Spotify — senão o botão piscaria a cada troca de faixa.
        setPlaybackState(wantsPlay() ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED);
        setDuration(cachedDurationMs);
        setPosition(cachedPositionMs);
        update();
    }

    // O usuário deslizou o app pra fora dos recentes. Tocando: continua
    // (é o ponto do serviço). Pausado: não há motivo pra deixar a notificação
    // pendurada — salva e encerra (exceto esperando o Bluetooth voltar).
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        savePlaybackState();
        if (player != null && !player.getPlayWhenReady() && !resumeOnBluetooth) {
            mainHandler.removeCallbacks(idleShutdown);
            idleShutdown.run();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (runningInstance == this) runningInstance = null;
        releaseEverything();
        super.onDestroy();
    }

    private void releaseEverything() {
        mainHandler.removeCallbacks(positionTicker);
        mainHandler.removeCallbacks(idleShutdown);
        if (volumeRamp != null) { mainHandler.removeCallbacks(volumeRamp); volumeRamp = null; }
        if (normalizer != null) normalizer.shutdown();
        mainHandler.removeCallbacks(waitPoll);
        mainHandler.removeCallbacks(endDuck);
        if (retryRunnable != null) mainHandler.removeCallbacks(retryRunnable);
        if (networkCallback != null && connectivityManager != null) {
            try { connectivityManager.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) { }
            networkCallback = null;
        }
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) { }
            tts = null;
            ttsReady = false;
        }
        if (bluetoothCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            BluetoothAudioWatcher.unregister(this, bluetoothCallback);
            bluetoothCallback = null;
        }
        if (player != null) {
            savePlaybackState();
            player.release();
            player = null;
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
    }

    public void destroy() {
        if (runningInstance == this) runningInstance = null;
        releaseEverything();
        foregroundActive = false;
        stopForeground(true);
        stopSelf();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureForeground(); // quem nos iniciou (startForegroundService) exige isto em poucos segundos
        if (mediaSession != null && intent != null) MediaButtonReceiver.handleIntent(mediaSession, intent);
        return START_STICKY;
    }

    // ── Metadata / notificação (igual ao plugin antigo) ─────────────

    public void setPlaybackState(int playbackState) {
        if (this.playbackState != playbackState) {
            this.playbackState = playbackState;
            playbackStateUpdate = true;
            possibleActionsUpdate = true;
        }
    }

    public void setTitle(String title) {
        if (!this.title.equals(title)) {
            this.title = title;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setArtist(String artist) {
        if (!this.artist.equals(artist)) {
            this.artist = artist;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setAlbum(String album) {
        if (!this.album.equals(album)) {
            this.album = album;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setArtwork(Bitmap artwork) {
        this.artwork = artwork;
        mediaMetadataUpdate = true;
        notificationUpdate = true;
    }

    public void setDuration(long duration) {
        if (this.duration != duration) {
            this.duration = duration;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setPosition(long position) {
        if (this.position != position) {
            this.position = position;
            playbackStateUpdate = true;
        }
    }

    public void setPlaybackSpeed(float playbackSpeed) {
        if (this.playbackSpeed != playbackSpeed) {
            this.playbackSpeed = playbackSpeed;
            playbackStateUpdate = true;
        }
    }

    // update() agora lê player.hasNextMediaItem()/hasPreviousMediaItem()
    // (ver mais abaixo) — só pode rodar na thread principal (mesma regra
    // de sempre do ExoPlayer). Mas é chamado de vários lugares, alguns
    // deles métodos do plugin que rodam na thread "CapacitorPlugins"
    // (setMetadata, setPlaybackState, setPositionState,
    // updatePossibleActions) — por isso despacha pra thread principal
    // aqui dentro, ao invés de exigir que cada chamador se preocupe com
    // isso.
    public void update() {
        postToMain(this::updateOnMainThread);
    }

    @SuppressLint("RestrictedApi")
    private void updateOnMainThread() {
        if (possibleActionsUpdate) {
            if (notificationBuilder != null) {
                notificationBuilder.mActions.clear();
            }

            long activePlaybackStateActions = 0;
            int[] activeCompactViewActionIndices = new int[3];

            int notificationActionIndex = 0;
            int compactNotificationActionIndicesIndex = 0;
            for (String actionName : possibleActions) {
                // Tocar/pausar são tratados direto no ExoPlayer, sem
                // depender do JS (ver MediaSessionCallback.onPlay/onPause
                // abaixo) — por isso não ficam presos ao hasActionHandler,
                // que só reflete se o JS está vivo pra responder. Sem essa
                // exceção, uma vez que o app fosse fechado e o "call" do
                // JS ficasse pendurado (dangling), o botão de tocar/pausar
                // sumia (ou travava) da notificação de vez.
                boolean nativelyHandled = actionName.equals("play") || actionName.equals("pause");
                // "Anterior" sempre existe (reinicia a faixa se não houver outra antes);
                // "próxima" existe se o player tem pra onde ir (o JS cobre o fim da fila).
                boolean nativeCanSkip = (actionName.equals("nexttrack") && player != null && player.hasNextMediaItem())
                        || (actionName.equals("previoustrack") && player != null && player.getMediaItemCount() > 0);
                boolean eligible = nativelyHandled || nativeCanSkip || (plugin != null && plugin.hasActionHandler(actionName));
                if (eligible) {
                    if (actionName.equals("play") && playbackState != PlaybackStateCompat.STATE_PAUSED) {
                        continue;
                    }
                    if (actionName.equals("pause") && playbackState != PlaybackStateCompat.STATE_PLAYING) {
                        continue;
                    }

                    if (playbackStateActions.containsKey(actionName)) {
                        activePlaybackStateActions = activePlaybackStateActions | playbackStateActions.get(actionName);
                    }

                    if (notificationActions.containsKey(actionName)) {
                        notificationBuilder.addAction(notificationActions.get(actionName));
                        if (possibleCompactViewActions.contains(actionName) && compactNotificationActionIndicesIndex < 3) {
                            activeCompactViewActionIndices[compactNotificationActionIndicesIndex] = notificationActionIndex;
                            compactNotificationActionIndicesIndex++;
                        }
                        notificationActionIndex++;
                    }
                }
            }

            // Barra de progresso da notificação/tela de bloqueio/carro arrastável.
            if (player != null && player.getMediaItemCount() > 0) {
                activePlaybackStateActions |= PlaybackStateCompat.ACTION_SEEK_TO;
            }
            if (playbackStateBuilder != null) {
                playbackStateBuilder.setActions(activePlaybackStateActions);
            }
            if (notificationStyle != null) {
                if (compactNotificationActionIndicesIndex > 0) {
                    notificationStyle.setShowActionsInCompactView(Arrays.copyOfRange(activeCompactViewActionIndices, 0, compactNotificationActionIndicesIndex));
                } else {
                    notificationStyle.setShowActionsInCompactView();
                }
            }

            possibleActionsUpdate = false;
            playbackStateUpdate = true;
            notificationUpdate = true;
        }

        if (playbackStateUpdate && playbackStateBuilder != null) {
            playbackStateBuilder.setState(this.playbackState, this.position, this.playbackSpeed);
            mediaSession.setPlaybackState(playbackStateBuilder.build());
            playbackStateUpdate = false;
        }

        if (mediaMetadataUpdate && mediaMetadataBuilder != null) {
            mediaMetadataBuilder
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                    .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
            mediaSession.setMetadata(mediaMetadataBuilder.build());
            mediaMetadataUpdate = false;
        }

        if (notificationUpdate && notificationBuilder != null) {
            notificationBuilder
                    .setContentTitle(title)
                    .setContentText(artist + " - " + album)
                    .setLargeIcon(artwork);
            notificationManager.notify(NOTIFICATION_ID, notificationBuilder.build());
            notificationUpdate = false;
        }
    }

    public void updatePossibleActions() {
        this.possibleActionsUpdate = true;
        this.update();
    }

    // Botões de mídia (notificação, fone, tela de bloqueio, carro): agem
    // direto no ExoPlayer, funcionando com o app aberto ou fechado.
    private class MediaSessionCallback extends MediaSessionCompat.Callback {
        // O serviço é o ÚNICO dono da reprodução: botões da notificação, fone,
        // Bluetooth e carro agem direto no ExoPlayer, e o JS (se estiver vivo)
        // só fica sabendo pelos eventos de estado/faixa. Antes os dois agiam
        // ao mesmo tempo (nativo + JS) e um podia desfazer ou duplicar o outro
        // — era o "pulou duas músicas" e a pausa que voltava sozinha.
        @Override
        public void onPlay() {
            nativePlay();
        }

        @Override
        public void onPause() {
            nativePause();
        }

        @Override
        public void onSeekTo(long pos) {
            nativeSeekTo(pos);
        }

        @Override
        public void onSkipToPrevious() {
            // seekToPrevious: reinicia a faixa se já passou de ~3 s, senão vai
            // pra anterior (comportamento padrão de app de música).
            postToMain(() -> { if (player != null && player.getMediaItemCount() > 0) player.seekToPrevious(); });
        }

        @Override
        public void onSkipToNext() {
            // Só quando o ExoPlayer não tem mais pra onde ir (fim da fila
            // carregada) o JS é chamado — ele sabe continuar sozinho com faixas
            // do mesmo estilo (modo rádio).
            if (!nativeSeekToNext() && plugin != null) plugin.actionCallback("nexttrack");
        }

        @Override
        public void onStop() {
            nativePause();
        }
    }
}
