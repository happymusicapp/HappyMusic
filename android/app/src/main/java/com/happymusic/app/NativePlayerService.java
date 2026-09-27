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
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import java.io.File;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
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
// FASE 1 deste projeto: só a faixa atual toca de forma 100% nativa
// (sobrevive a fechar o app). "Próxima"/"anterior" ainda são decisões
// do player.js (fila, shuffle, repeat, modo rádio, filtro/playlist) —
// por isso essas duas ações continuam só repassadas pro JS, não tratadas
// aqui dentro. Numa fase seguinte dá pra ensinar o ExoPlayer a tocar a
// fila inteira sozinho.
public class NativePlayerService extends Service {

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
        // handleAudioFocus/handleAudioBecomingNoisy ficam desligados de
        // propósito nesta fase: quem já cuida disso hoje é o
        // AudioFocusPlugin/hmAudioBecomingNoisy (ver player.js) — dá pra
        // migrar pro ExoPlayer numa fase seguinte.
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, false)
                .setHandleAudioBecomingNoisy(false)
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
                notifyJsState();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (plugin != null) plugin.notifyError(error.getMessage());
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
                android.R.drawable.ic_media_play, "Tocar", MediaButtonReceiver.buildMediaButtonPendingIntent(this, (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PLAY))
        ));
        notificationActions.put("pause", new NotificationCompat.Action(
                android.R.drawable.ic_media_pause, "Pausar", MediaButtonReceiver.buildMediaButtonPendingIntent(this, (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PAUSE))
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

    public void loadAndPlay(String url, Map<String, String> headers, long resumeMs) {
        if (player == null) return;
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory();
        if (headers != null && !headers.isEmpty()) httpFactory.setDefaultRequestProperties(headers);
        MediaItem item = MediaItem.fromUri(url);
        player.setMediaSource(new ProgressiveMediaSource.Factory(httpFactory).createMediaSource(item));
        player.prepare();
        if (resumeMs > 0) player.seekTo(resumeMs);
        player.setPlayWhenReady(true);
    }

    public void loadLocalAndPlay(String absolutePath, long resumeMs) {
        if (player == null) return;
        // getAudioPath() no JS já devolve uma URI "file://..." (é o que
        // o getUri() do plugin de Filesystem retorna) — usar Uri.parse
        // direto; Uri.fromFile(new File(...)) só funciona com caminho
        // puro, sem esquema, e quebraria aqui.
        Uri uri = absolutePath.contains("://") ? Uri.parse(absolutePath) : Uri.fromFile(new File(absolutePath));
        MediaItem item = MediaItem.fromUri(uri);
        player.setMediaItem(item);
        player.prepare();
        if (resumeMs > 0) player.seekTo(resumeMs);
        player.setPlayWhenReady(true);
    }

    public void nativePlay() {
        if (player != null) player.setPlayWhenReady(true);
    }

    public void nativePause() {
        if (player != null) player.setPlayWhenReady(false);
    }

    public void nativeSeekTo(long ms) {
        if (player != null) player.seekTo(ms);
    }

    public long getPositionMs() {
        return player != null ? Math.max(player.getCurrentPosition(), 0) : 0;
    }

    public long getDurationMs() {
        if (player == null) return 0;
        long d = player.getDuration();
        return d == C.TIME_UNSET ? 0 : Math.max(d, 0);
    }

    public boolean isPlayingNow() {
        return player != null && player.isPlaying();
    }

    private void notifyJsState() {
        if (plugin != null) {
            plugin.notifyStateChanged(isPlayingNow(), getPositionMs(), getDurationMs());
        }
    }

    public void destroy() {
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

    @SuppressLint("RestrictedApi")
    public void update() {
        if (possibleActionsUpdate) {
            if (notificationBuilder != null) {
                notificationBuilder.mActions.clear();
            }

            long activePlaybackStateActions = 0;
            int[] activeCompactViewActionIndices = new int[3];

            int notificationActionIndex = 0;
            int compactNotificationActionIndicesIndex = 0;
            for (String actionName : possibleActions) {
                if (plugin != null && plugin.hasActionHandler(actionName)) {
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

    // Botões de mídia (notificação, fone, tela de bloqueio, carro). Play/
    // pause/seekTo já mexem direto no ExoPlayer (resposta instantânea,
    // funciona mesmo com o app fechado); nexttrack/previoustrack ainda
    // dependem da fila em JS nesta fase, por isso só repassam pro plugin.
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
            if (plugin != null) plugin.actionCallback("previoustrack");
        }

        @Override
        public void onSkipToNext() {
            if (plugin != null) plugin.actionCallback("nexttrack");
        }

        @Override
        public void onStop() {
            nativePause();
            if (plugin != null) plugin.actionCallback("stop");
        }
    }
}
