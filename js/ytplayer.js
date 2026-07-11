/* ═══════════════════════════════════════════════
   HAPPY MUSIC – ytplayer.js
   Player de filmes: embute o YouTube IFrame Player
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
  };

  function on(event, fn) {
    if (event in _listeners) _listeners[event] = fn;
  }

  // Carrega o script da API do YouTube só na primeira vez que um filme
  // é aberto — quem nunca usa a aba de filmes nunca baixa esse script.
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
  }

  // Cria o player uma única vez dentro do elemento indicado. Chamadas
  // seguintes reaproveitam a mesma instância (recriar o iframe do
  // zero a cada filme aberto seria mais lento e mais frágil).
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
  // chamado a partir de um toque do usuário no card do filme, então o
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
  // (a próxima vez que um filme for aberto, reaproveita, sem esperar a
  // API carregar de novo).
  function stop() {
    _stopProgressTimer();
    if (_player && typeof _player.stopVideo === 'function') _player.stopVideo();
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
  };

})();
