/* ═══════════════════════════════════════════════
   HAPPY MUSIC – ytplayer.js
   Player de vídeos: embute o YouTube IFrame Player
   escondendo os controles nativos, pra usar os
   botões neon do próprio app (play/pause, barra de
   progresso) — mesmo visual do player de música.
═══════════════════════════════════════════════ */

const YTPlayer = (() => {

  let _player  = null; // instância do YT.Player (criada uma única vez e reaproveitada)
  let _initPromise = null;
  let _progressTimer = null;

  const _listeners = {
    onStateChange: null, // (playing) => {}
    onProgress:    null, // (current, duration) => {}
    onEnded:       null, // () => {}
  };

  function on(event, fn) {
    if (event in _listeners) _listeners[event] = fn;
  }

  // Carrega o script da API do YouTube só na primeira vez que um vídeo
  // é aberto — quem nunca usa a aba de vídeos nunca baixa esse script.
  function _loadApiScript() {
    return new Promise(resolve => {
      if (window.YT && window.YT.Player) { resolve(); return; }

      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevCallback?.();
        resolve();
      };

      if (!document.getElementById('youtube-iframe-api')) {
        const tag = document.createElement('script');
        tag.id  = 'youtube-iframe-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    });
  }

  function _stopProgressTimer() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  }

  // A API do YouTube não dispara evento de "tempo mudou" (como o
  // timeupdate do <audio>) — precisa perguntar de tempos em tempos.
  function _startProgressTimer() {
    _stopProgressTimer();
    _progressTimer = setInterval(() => {
      if (!_player || typeof _player.getCurrentTime !== 'function') return;
      const current  = _player.getCurrentTime() || 0;
      const duration = _player.getDuration() || 0;
      _listeners.onProgress?.(current, duration);
    }, 250);
  }

  function _onStateChange(e) {
    const playing = e.data === YT.PlayerState.PLAYING;
    _listeners.onStateChange?.(playing);
    if (playing) _startProgressTimer();
    else _stopProgressTimer();

    if (e.data === YT.PlayerState.ENDED) {
      _listeners.onEnded?.();
    }

    // Mantém a Media Session (notificação/tela de bloqueio) sincronizada
    // com o estado real do player — mesmo mecanismo usado pro áudio em
    // player.js. Isso não garante que o YouTube continue tocando com a
    // tela bloqueada (ver nota em setMediaSessionMetadata), mas garante
    // que, nos casos em que continua, os controles do bloqueio de tela
    // apareçam certos.
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }

  // ── MEDIA SESSION ────────────────────────────────
  // NOTA IMPORTANTE sobre tela bloqueada: isso melhora a notificação/
  // controles de mídia quando o vídeo está tocando, mas NÃO é garantia
  // de que o YouTube vá continuar tocando com a tela bloqueada. Motivo:
  // o player real (o <video> de verdade) vive dentro do iframe do
  // youtube.com, que é uma origem diferente da nossa — o próprio script
  // do YouTube decide pausar (ou não) quando a página fica oculta
  // (document.hidden), e a gente não tem acesso pra ler ou alterar nada
  // dentro desse iframe por causa da política de segurança same-origin
  // dos navegadores. É esse script do YouTube (não o nosso app) que
  // decide pausar o vídeo assim que a tela bloqueia — por isso "modo
  // computador" no navegador se comporta diferente: o site do YouTube
  // detecta um user-agent de desktop e serve o player web completo, que
  // não tem essa restrição. Configurar a Media Session é o máximo que
  // dá pra fazer do nosso lado; não existe um jeito confiável, via
  // JavaScript, de forçar o embed a se comportar como o player desktop.
  let _lastMetaVideoId = null;

  function setMediaSessionMetadata(video) {
    if (!('mediaSession' in navigator) || !video) return;
    if (_lastMetaVideoId === video.id) return;

    // Isolado num try/catch próprio de propósito: isso é só cosmético
    // (controles da tela de bloqueio), nunca deve impedir nem parecer
    // que o vídeo falhou ao abrir — em alguns WebViews/Android mais
    // antigos, `MediaMetadata` pode não existir mesmo com
    // `navigator.mediaSession` presente, e isso não pode derrubar a
    // reprodução (que já está rodando nesse ponto).
    try {
      _lastMetaVideoId = video.id;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: video.title || 'Vídeo',
        artist: 'HappyMusic',
        album: video.genre || '',
        artwork: video.thumbnail
          ? [
              { src: video.thumbnail, sizes: '480x360', type: 'image/jpeg' },
              { src: video.thumbnail, sizes: '320x180', type: 'image/jpeg' },
            ]
          : [],
      });

      navigator.mediaSession.setActionHandler('play',  () => play());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (typeof d.seekTime === 'number') seekTo(d.seekTime);
      });
    } catch (err) {
      console.warn('[YTPlayer] Não foi possível atualizar a Media Session:', err);
    }
  }

  function _clearMediaSession() {
    _lastMetaVideoId = null;
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
    navigator.mediaSession.setActionHandler('seekto', null);
  }

  // Cria o player uma única vez dentro do elemento indicado. Chamadas
  // seguintes reaproveitam a mesma instância (recriar o iframe do
  // zero a cada vídeo aberto seria mais lento e mais frágil).
  function _init(containerId) {
    if (_player) return Promise.resolve();
    if (_initPromise) return _initPromise;

    _initPromise = _loadApiScript().then(() => new Promise(resolve => {
      _player = new YT.Player(containerId, {
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0,        // escondido — os botões neon do app é que mandam
          disablekb: 1,
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
        },
        events: {
          onReady: () => resolve(),
          onStateChange: _onStateChange,
        },
      });
    }));

    return _initPromise;
  }

  // Carrega (ou troca para) um vídeo específico e tenta tocar — é
  // chamado a partir de um toque do usuário no card do vídeo, então o
  // autoplay costuma ser permitido; se o navegador bloquear mesmo
  // assim, o botão de play neon resolve.
  async function load(videoId, containerId) {
    await _init(containerId);
    _player.loadVideoById(videoId);
  }

  function play()  { _player?.playVideo(); }
  function pause() { _player?.pauseVideo(); }

  function togglePlay() {
    if (!_player || typeof _player.getPlayerState !== 'function') return;
    if (_player.getPlayerState() === YT.PlayerState.PLAYING) pause();
    else play();
  }

  function isPlaying() {
    return !!_player && typeof _player.getPlayerState === 'function'
      && _player.getPlayerState() === YT.PlayerState.PLAYING;
  }

  function seekTo(seconds) { _player?.seekTo(seconds, true); }

  function seekPercent(pct) {
    if (!_player) return;
    const duration = _player.getDuration() || 0;
    seekTo((pct / 100) * duration);
  }

  function getCurrentTime() { return _player ? (_player.getCurrentTime() || 0) : 0; }
  function getDuration()    { return _player ? (_player.getDuration()    || 0) : 0; }

  // Pausa e reseta — chamado ao fechar o player, sem destruir o iframe
  // (a próxima vez que um vídeo for aberto, reaproveita, sem esperar a
  // API carregar de novo).
  function stop() {
    _stopProgressTimer();
    if (_player && typeof _player.stopVideo === 'function') _player.stopVideo();
    _clearMediaSession();
  }

  return {
    load,
    play,
    pause,
    togglePlay,
    isPlaying,
    seekTo,
    seekPercent,
    getCurrentTime,
    getDuration,
    stop,
    on,
    setMediaSessionMetadata,
  };

})();
