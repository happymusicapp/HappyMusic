/* ═══════════════════════════════════════════════
   HAPPY MUSIC – player.js
   Engine de áudio: fila, shuffle, repeat, progresso
═══════════════════════════════════════════════ */

const Player = (() => {

  // ── ESTADO ────────────────────────────────────
  const audio = new Audio();
  audio.preload = 'metadata';

  let _queue        = [];   // fila atual (array de tracks)
  let _originalQueue= [];   // cópia sem shuffle
  let _index        = -1;   // índice atual na fila
  let _shuffle      = false;
  let _repeat       = 'none'; // 'none' | 'all' | 'one'
  let _favorites    = new Set(JSON.parse(localStorage.getItem('hm_favorites') || '[]'));

  // ── CALLBACKS (registrados pelo ui.js / app.js) ──
  const _listeners = {
    onPlay:      null,  // (track) => {}
    onPause:     null,  // () => {}
    onEnd:       null,  // () => {}
    onProgress:  null,  // (current, duration) => {}
    onError:     null,  // (err) => {}
  };

  // ── FILA ──────────────────────────────────────
  function loadQueue(tracks, startIndex = 0) {
    _originalQueue = [...tracks];
    _queue         = _shuffle ? _shuffled(tracks, startIndex) : [...tracks];
    _index         = _shuffle ? 0 : startIndex;
    _play();
  }

  function getQueue()        { return _queue; }
  function getCurrentTrack() { return _queue[_index] || null; }
  function getCurrentIndex() { return _index; }

  // ── SHUFFLE ───────────────────────────────────
  function _shuffled(tracks, pinIndex) {
    const pin   = tracks[pinIndex];
    const rest  = tracks.filter((_, i) => i !== pinIndex);
    // Fisher-Yates
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [pin, ...rest];
  }

  function toggleShuffle() {
    _shuffle = !_shuffle;
    const current = getCurrentTrack();

    if (_shuffle) {
      _queue = _shuffled(_originalQueue, _originalQueue.indexOf(current));
      _index = 0;
    } else {
      _queue = [..._originalQueue];
      _index = current ? _queue.indexOf(current) : 0;
    }

    return _shuffle;
  }

  function isShuffle() { return _shuffle; }

  // ── REPEAT ────────────────────────────────────
  // Cicla: none → all → one → none
  function cycleRepeat() {
    const cycle = { none: 'all', all: 'one', one: 'none' };
    _repeat = cycle[_repeat];
    return _repeat;
  }

  function getRepeat() { return _repeat; }

  // ── PLAY / PAUSE ──────────────────────────────
  function _play() {
    const track = getCurrentTrack();
    if (!track) return;

    const url = Drive.getStreamUrl(track.id);
    if (audio.src !== url) {
      audio.src = url;
      audio.load();
    }

    audio.play()
      .then(() => { _listeners.onPlay?.(track); })
      .catch(err => {
        console.error('[Player] Erro ao reproduzir:', err);
        _listeners.onError?.(err);
      });
  }

  function play()  { audio.play().then(() => _listeners.onPlay?.(getCurrentTrack())); }
  function pause() { audio.pause(); _listeners.onPause?.(); }

  function togglePlay() {
    if (audio.paused) play();
    else              pause();
  }

  function isPlaying() { return !audio.paused; }

  // ── NAVEGAÇÃO ─────────────────────────────────
  function next() {
    if (!_queue.length) return;

    if (_repeat === 'one') {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    if (_index < _queue.length - 1) {
      _index++;
    } else if (_repeat === 'all') {
      _index = 0;
    } else {
      // fim da fila sem repeat
      _listeners.onEnd?.();
      return;
    }

    _play();
  }

  function prev() {
    if (!_queue.length) return;

    // Se passou mais de 3s, reinicia a música atual
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    if (_index > 0) {
      _index--;
    } else if (_repeat === 'all') {
      _index = _queue.length - 1;
    }

    _play();
  }

  // Pula para uma faixa específica da fila pelo índice
  function jumpTo(index) {
    if (index < 0 || index >= _queue.length) return;
    _index = index;
    _play();
  }

  // ── SEEK ──────────────────────────────────────
  function seek(seconds) {
    if (!isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
  }

  function seekPercent(pct) {
    if (!isFinite(audio.duration)) return;
    seek((pct / 100) * audio.duration);
  }

  function getDuration()    { return isFinite(audio.duration) ? audio.duration : 0; }
  function getCurrentTime() { return audio.currentTime; }
  function getProgress()    { return getDuration() ? (audio.currentTime / getDuration()) * 100 : 0; }

  // ── VOLUME ────────────────────────────────────
  function setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); }
  function getVolume()  { return audio.volume; }

  // ── FAVORITOS ─────────────────────────────────
  function toggleFavorite(trackId) {
    if (_favorites.has(trackId)) {
      _favorites.delete(trackId);
    } else {
      _favorites.add(trackId);
    }
    _saveFavorites();
    return _favorites.has(trackId);
  }

  function isFavorite(trackId) { return _favorites.has(trackId); }

  function getFavorites() {
    return Drive.getCachedTracks().filter(t => _favorites.has(t.id));
  }

  function _saveFavorites() {
    localStorage.setItem('hm_favorites', JSON.stringify([..._favorites]));
  }

  // ── HISTÓRICO RECENTE ──────────────────────────
  const KEY_RECENT = 'hm_recent';
  const MAX_RECENT = 8;

  function _addToRecent(track) {
    let recent = getRecent();
    recent = recent.filter(t => t.id !== track.id);   // remove duplicata
    recent.unshift(track);
    if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
    localStorage.setItem(KEY_RECENT, JSON.stringify(recent));
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(KEY_RECENT) || '[]'); }
    catch { return []; }
  }

  // ── FORMATAÇÃO DE TEMPO ────────────────────────
  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── EVENTOS DO AUDIO ELEMENT ──────────────────
  audio.addEventListener('timeupdate', () => {
    _listeners.onProgress?.(audio.currentTime, audio.duration || 0);
  });

  audio.addEventListener('ended', () => {
    const track = getCurrentTrack();
    if (track) _addToRecent(track);
    next();
  });

  audio.addEventListener('play', () => {
    const track = getCurrentTrack();
    if (track) _addToRecent(track);
  });

  audio.addEventListener('error', (e) => {
    console.error('[Player] Erro de áudio:', e);
    _listeners.onError?.(e);
  });

  // Media Session API (controles na tela de bloqueio / Bluetooth)
  function _updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.title,
      artist: track.artist,
      album:  'Happy Music',
      artwork: track.thumbnail
        ? [{ src: track.thumbnail, sizes: '96x96', type: 'image/jpeg' }]
        : [{ src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });

    navigator.mediaSession.setActionHandler('play',           () => play());
    navigator.mediaSession.setActionHandler('pause',          () => pause());
    navigator.mediaSession.setActionHandler('nexttrack',      () => next());
    navigator.mediaSession.setActionHandler('previoustrack',  () => prev());
    navigator.mediaSession.setActionHandler('seekto', (d) => seek(d.seekTime));
  }

  // ── REGISTRO DE CALLBACKS ─────────────────────
  function on(event, fn) {
    if (event in _listeners) _listeners[event] = fn;
  }

  // Sobrescreve onPlay para também atualizar Media Session
  const _origOn = on;
  function onPlay(fn) {
    _listeners.onPlay = (track) => {
      fn(track);
      _updateMediaSession(track);
    };
  }

  // ── EXPORT ────────────────────────────────────
  return {
    // Fila
    loadQueue,
    getQueue,
    getCurrentTrack,
    getCurrentIndex,
    jumpTo,

    // Controles
    play,
    pause,
    togglePlay,
    isPlaying,
    next,
    prev,

    // Opções
    toggleShuffle,
    isShuffle,
    cycleRepeat,
    getRepeat,

    // Seek / tempo
    seek,
    seekPercent,
    getDuration,
    getCurrentTime,
    getProgress,
    formatTime,

    // Volume
    setVolume,
    getVolume,

    // Favoritos
    toggleFavorite,
    isFavorite,
    getFavorites,

    // Histórico
    getRecent,

    // Callbacks
    on,
    onPlay,
  };

})();
