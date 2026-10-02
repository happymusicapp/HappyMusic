package com.happymusic.app;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
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
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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

    // Quantas faixas seguidas puladas por erro (ver onPlayerError) —
    // zera assim que uma toca de verdade. É pra não ficar pulando a
    // fila inteira à toa quando o sinal cai por completo (ex.: um
    // trecho longo sem cobertura numa viagem) — depois de algumas
    // tentativas, para e espera o usuário interagir de novo.
    private int consecutiveErrorSkips = 0;
    private static final int MAX_CONSECUTIVE_ERROR_SKIPS = 3;

    // onIsPlayingChanged/onPlaybackStateChanged só disparam quando o
    // ESTADO muda — sem isso a posição ficaria parada entre um evento e
    // outro (a barra de progresso no app não andaria durante a música).
    private final Runnable positionTicker = new Runnable() {
        @Override
        public void run() {
            if (player != null) {
                cachedPlaying = player.isPlaying();
                cachedPositionMs = Math.max(player.getCurrentPosition(), 0);
                long d = player.getDuration();
                cachedDurationMs = (d == C.TIME_UNSET) ? 0 : Math.max(d, 0);
                MediaItem current = player.getCurrentMediaItem();
                cachedMediaId = current != null ? current.mediaId : null;
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
        initializeMediaSession();
        initializeNotification(buildFallbackContentIntent());
        startForegroundNow();
        mainHandler.post(positionTicker);
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
        // handleAudioFocus/handleAudioBecomingNoisy em true: o próprio
        // ExoPlayer pausa/retoma sozinho quando perde/ganha o foco de
        // áudio (ligação, GPS, Bluetooth reconectando no carro) e quando
        // o fone/Bluetooth desconecta — direto no nativo, sem depender
        // de o JavaScript estar respondendo. É justamente com a tela
        // travada (ex.: Bluetooth do carro) que o WebView pode demorar
        // mais pra reagir, e antes disso ficava só por conta do
        // AudioFocusPlugin/hmAudioBecomingNoisy (ver player.js), que
        // dependem do JS acordar — isso aqui é uma segunda camada, mais
        // rápida e independente, por trás da mesma proteção; o
        // AudioFocusPlugin continua ativo também (as duas não conflitam,
        // só uma delas de fato reage primeiro cada vez).
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && plugin != null) {
                    plugin.notifyEnded();
                }
                notifyJsState();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) consecutiveErrorSkips = 0; // tocou de verdade — zera o contador de pulos por erro
                notifyJsState();
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
                // Disparado toda vez que o ExoPlayer muda de faixa
                // sozinho — inclusive quando a faixa atual termina com o
                // app fechado e ele avança pra próxima já preparada (ver
                // loadQueueAndPlay). Sem isso, a notificação continuaria
                // mostrando o título/capa da faixa ANTERIOR mesmo com
                // outra já tocando.
                if (item == null) return;
                cachedMediaId = item.mediaId; // atualiza já, sem esperar o próximo tick do positionTicker
                MediaMetadata meta = item.mediaMetadata;
                setTitle(meta.title != null ? meta.title.toString() : "");
                setArtist(meta.artist != null ? meta.artist.toString() : "");
                setAlbum(meta.albumTitle != null ? meta.albumTitle.toString() : "");
                setArtwork(null); // limpa até a nova capa (se houver) carregar
                possibleActionsUpdate = true; // "próxima"/"anterior" mudam de disponibilidade a cada faixa
                update();
                fetchArtworkAsync(meta.artworkUri != null ? meta.artworkUri.toString() : null);

                // Avisa o JS (se estiver vivo) qual faixa está tocando
                // agora de verdade — ele usa isso só pra manter a própria
                // marcação de "faixa atual" e a UI em dia; não recarrega
                // nada (já está tocando).
                if (plugin != null) plugin.notifyTrackChanged(item.mediaId);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (plugin != null) plugin.notifyError(error.getMessage());

                // Uma faixa da fila falhou (ex.: trecho sem sinal numa
                // viagem, pra quem está tocando por streaming) — em vez
                // de simplesmente parar, tenta pular pra próxima já
                // preparada e continuar a viagem. Só até um limite (ver
                // MAX_CONSECUTIVE_ERROR_SKIPS): se o sinal sumiu de vez,
                // não adianta ficar tentando a fila inteira à toa.
                consecutiveErrorSkips++;
                if (consecutiveErrorSkips <= MAX_CONSECUTIVE_ERROR_SKIPS && player != null && player.hasNextMediaItem()) {
                    player.seekToNextMediaItem();
                    player.prepare();
                    player.setPlayWhenReady(true);
                }
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

    // ── Controle de reprodução (chamado pelo NativePlayerPlugin) ────

    public void loadQueueAndPlay(List<QueueItem> items, long resumeMs, String repeatMode) {
        postToMain(() -> {
            if (player == null || items == null || items.isEmpty()) return;

            consecutiveErrorSkips = 0; // fila nova — zera o contador de "pulou por erro" (ver onPlayerError)

            // Dá a volta sozinho quando a lista entregue acabar (loop de
            // playlist/filtro, ou repetir tudo/uma faixa) — sem isso,
            // mesmo entregando a fila inteira, ele pararia no fim dela
            // em vez de recomeçar.
            if ("one".equals(repeatMode)) player.setRepeatMode(Player.REPEAT_MODE_ONE);
            else if ("all".equals(repeatMode)) player.setRepeatMode(Player.REPEAT_MODE_ALL);
            else player.setRepeatMode(Player.REPEAT_MODE_OFF);

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
                    // getAudioPath() no JS já devolve uma URI "file://..."
                    // (é o que o getUri() do plugin de Filesystem retorna)
                    Uri uri = it.path.contains("://") ? Uri.parse(it.path) : Uri.fromFile(new File(it.path));
                    MediaItem mediaItem = itemBuilder.setUri(uri).build();
                    sources.add(new ProgressiveMediaSource.Factory(new androidx.media3.datasource.DefaultDataSource.Factory(this)).createMediaSource(mediaItem));
                } else if (it.url != null) {
                    MediaItem mediaItem = itemBuilder.setUri(Uri.parse(it.url)).build();
                    DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory();
                    if (it.headers != null && !it.headers.isEmpty()) httpFactory.setDefaultRequestProperties(it.headers);
                    sources.add(new ProgressiveMediaSource.Factory(httpFactory).createMediaSource(mediaItem));
                }
            }
            if (sources.isEmpty()) return;

            player.setMediaSources(sources, 0, resumeMs > 0 ? resumeMs : 0);
            player.prepare();
            player.setPlayWhenReady(true);
            // A disponibilidade de "próxima"/"anterior" na notificação
            // depende de quantos itens têm na fila (ver update() acima) —
            // isso mudou agora que carregamos uma fila nova.
            possibleActionsUpdate = true;
            update();
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
        postToMain(() -> { if (player != null) player.setPlayWhenReady(true); });
    }

    public void nativePause() {
        postToMain(() -> { if (player != null) player.setPlayWhenReady(false); });
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
            cachedPlaying = player.isPlaying();
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
        setPlaybackState(player.isPlaying() ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED);
        setPosition(cachedPositionMs);
        update();
    }

    @Override
    public void onDestroy() {
        if (runningInstance == this) runningInstance = null;
        super.onDestroy();
    }

    public void destroy() {
        if (runningInstance == this) runningInstance = null;
        mainHandler.removeCallbacks(positionTicker);
        if (player != null) {
            player.release();
            player = null;
        }
        stopForeground(true);
        stopSelf();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (mediaSession != null) MediaButtonReceiver.handleIntent(mediaSession, intent);
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
                boolean nativeCanSkip = (actionName.equals("nexttrack") && player != null && player.hasNextMediaItem())
                        || (actionName.equals("previoustrack") && player != null && player.hasPreviousMediaItem());
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

    // Botões de mídia (notificação, fone, tela de bloqueio, carro). Todos
    // já mexem direto no ExoPlayer primeiro (resposta instantânea,
    // funciona mesmo com o app fechado — próxima/anterior só se já
    // tiver algo carregado ali, ver loadQueueAndPlay) E avisam o plugin,
    // pro JS (se estiver vivo) poder ir além disso com a fila completa.
    private class MediaSessionCallback extends MediaSessionCompat.Callback {
        @Override
        public void onPlay() {
            // Chama o callback pro JS PRIMEIRO, e só depois mexe no
            // ExoPlayer de verdade — ver onPause() abaixo, mesmo motivo.
            if (plugin != null) plugin.actionCallback("play");
            nativePlay();
        }

        @Override
        public void onPause() {
            // Avisa o JS (play()/pause() do player.js, que marca a pausa
            // como "pedida pelo usuário") ANTES de mexer no ExoPlayer.
            // Se fosse na ordem inversa, o aviso nativo de "estado mudou"
            // (assíncrono, pelo Player.Listener) podia chegar no JS ANTES
            // desse callback, e o player.js confundiria essa pausa com
            // uma "pausa inesperada" (ligação/GPS) e tentaria retomar a
            // música sozinha bem na hora em que o usuário pediu pra parar.
            if (plugin != null) plugin.actionCallback("pause");
            nativePause();
        }

        @Override
        public void onSeekTo(long pos) {
            nativeSeekTo(pos);
            if (plugin != null) {
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("seekTime", (double) pos / 1000.0);
                plugin.actionCallback("seekto", data);
            }
        }

        @Override
        public void onSkipToPrevious() {
            // Se a faixa anterior já estiver carregada no ExoPlayer (ver
            // loadQueueAndPlay), toca ela direto — funciona mesmo com o
            // app fechado. Sempre avisa o JS também: se ele estiver vivo,
            // é quem decide a fila de verdade (shuffle/repeat/modo rádio)
            // e pode querer ir além dessa única faixa pré-carregada.
            nativeSeekToPrevious();
            if (plugin != null) plugin.actionCallback("previoustrack");
        }

        @Override
        public void onSkipToNext() {
            nativeSeekToNext();
            if (plugin != null) plugin.actionCallback("nexttrack");
        }

        @Override
        public void onStop() {
            nativePause();
            if (plugin != null) plugin.actionCallback("stop");
        }
    }
}
