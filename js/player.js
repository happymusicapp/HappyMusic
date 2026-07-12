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
    onPlay:        null,  // (track) => {}
    onPause:       null,  // () => {}
    onEnd:         null,  // () => {}
    onProgress:    null,  // (current, duration) => {}
    onError:       null,  // (err) => {}
    onLoading:     null,  // (track) => {} — disparado ao iniciar busca do áudio
    onOfflineSkip: null,  // (track) => {} — disparado ao pular pra próxima faixa baixada, sem internet
    onAllOffline:  null,  // () => {} — disparado quando, offline, nenhuma faixa da fila está baixada
  };

  // ── FILA ──────────────────────────────────────
  function loadQueue(tracks, startIndex = 0) {
    _originalQueue = [...tracks];
    _queue         = _shuffle ? _shuffled(tracks, startIndex) : [...tracks];
    _index         = _shuffle ? 0 : startIndex;
    _preloadedTrackId = null;
    _loadedTrackId = null;
    _play();
  }

  // Prepara a fila e a faixa atual SEM iniciar a reprodução — usado só
  // pra deixar o player pronto com a última música tocada assim que o
  // app abre (o usuário só aperta play), sem tentar tocar áudio sozinho
  // (o navegador bloquearia mesmo, autoplay sem gesto do usuário).
  function primeQueue(tracks, startIndex = 0) {
    _originalQueue = [...tracks];
    _queue         = _shuffle ? _shuffled(tracks, startIndex) : [...tracks];
    _index         = _shuffle ? 0 : startIndex;
    _preloadedTrackId = null;
    _loadedTrackId = null; // faixa ainda não carregada de fato — só apertar play que buscamos a URL
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

  // ── ELEMENTO DE ÁUDIO (acesso bruto ao <audio>, se precisar) ──
  function getAudioElement() { return audio; }

  // ── PLAY / PAUSE ──────────────────────────────
  let _loadToken = 0; // evita race condition ao trocar de faixa rápido

  async function _play(_skipAttempts = 0) {
    const track = getCurrentTrack();
    if (!track) return;

    const myLoad = ++_loadToken;
    _listeners.onLoading?.(track);

    try {
      const url = await Drive.fetchAudioUrl(track.id);

      // Se o usuário já trocou de faixa enquanto isso carregava, ignora
      if (myLoad !== _loadToken) return;

      audio.src = url;
      audio.load();
      _loadedTrackId = track.id;

      await audio.play();
      _listeners.onPlay?.(track);

      // Pré-carrega a próxima faixa em segundo plano. Isso é essencial
      // com a tela travada: baixar o áudio inteiro (fetch + blob) só
      // depois que a faixa atual termina cria um intervalo mudo entre
      // uma faixa e outra. Nesse intervalo o Android (principalmente
      // MIUI/HyperOS) entende que não há playback ativo e pode suspender
      // a aba/WebView antes do fetch da próxima faixa terminar — o app
      // trava e nunca mais toca. Com a próxima faixa já em cache no
      // momento em que a atual termina, a troca é praticamente instantânea.
      _preloadNext();

    } catch (err) {
      if (myLoad !== _loadToken) return; // já trocou de faixa, ignora erro
      console.error('[Player] Erro ao reproduzir:', err);
      _handlePlaybackFailure(err, _skipAttempts);
    }
  }

  // Descobre, sem alterar o estado, qual seria o índice da próxima
  // faixa (espelha a lógica de next(), mas só de leitura).
  function _peekNextIndex() {
    if (!_queue.length) return -1;
    if (_repeat === 'one') return _index;
    if (_index < _queue.length - 1) return _index + 1;
    if (_repeat === 'all') return 0;
    return -1; // fim da fila, sem repeat
  }

  let _preloadedTrackId = null;

  // Busca antecipadamente o áudio da próxima faixa (Drive.fetchAudioUrl
  // já cacheia por fileId), sem bloquear nada. Se falhar, não tem problema:
  // _play() vai buscar de novo (com o intervalo mudo) quando chegar a vez.
  function _preloadNext() {
    const idx = _peekNextIndex();
    if (idx === -1) return;

    const track = _queue[idx];
    if (!track || track.id === _preloadedTrackId) return;

    _preloadedTrackId = track.id;
    Drive.fetchAudioUrl(track.id).catch(() => {
      if (_preloadedTrackId === track.id) _preloadedTrackId = null;
    });
  }

  // O player nunca deve simplesmente parar quando uma faixa falha ao
  // carregar. Em vez disso, tenta seguir pra próxima automaticamente:
  //  - Sem internet -> pula direto pra próxima faixa já baixada
  //    (presente no cache de áudio do Service Worker), ignorando as
  //    que não foram salvas, já que essas não vão tocar mesmo.
  //  - Com internet -> tenta a próxima faixa da fila normalmente
  //    (pode ter sido um erro pontual daquela faixa específica).
  // Em ambos os casos, limita as tentativas a uma volta completa na
  // fila pra não entrar em loop infinito caso nada esteja disponível.
  function _handlePlaybackFailure(err, skipAttempts) {
    if (!_queue.length || skipAttempts >= _queue.length) {
      _listeners.onError?.(err);
      return;
    }

    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

    if (offline) {
      const nextIndex = _findNextDownloadedIndex(_index);
      if (nextIndex === -1) {
        _listeners.onAllOffline?.();
        _listeners.onError?.(err);
        return;
      }
      _index = nextIndex;
      _listeners.onOfflineSkip?.(getCurrentTrack());
      _play(skipAttempts + 1);
      return;
    }

    _index = (_index + 1) % _queue.length;
    _play(skipAttempts + 1);
  }

  // Procura, a partir de (fromIndex + 1) e dando a volta na fila, o
  // índice da próxima faixa que já está baixada (cache de áudio).
  // Retorna -1 se nenhuma faixa da fila estiver baixada.
  function _findNextDownloadedIndex(fromIndex) {
    if (typeof Downloads === 'undefined') return -1;
    for (let i = 1; i <= _queue.length; i++) {
      const idx = (fromIndex + i) % _queue.length;
      const t = _queue[idx];
      if (t && Downloads.isDownloaded(t.id)) return idx;
    }
    return -1;
  }

  let _userPaused = false; // distingue pause pedido pelo usuário de pause inesperado (ver listener 'pause' abaixo)
  let _loadedTrackId = null; // id da faixa cujo áudio já foi buscado e setado em audio.src

  // Retoma a faixa já carregada. Se a faixa atual (ex.: vinda de primeQueue,
  // ao abrir o app com a última música tocada) ainda não teve o áudio
  // buscado/carregado, cai no fluxo completo (_play), que busca a URL no
  // Drive e só então toca — senão audio.play() não tem o que reproduzir.
  function play() {
    const track = getCurrentTrack();
    if (!track) return;

    if (_loadedTrackId !== track.id) {
      _play();
      return;
    }

    audio.play()
      .then(() => _listeners.onPlay?.(track))
      .catch(err => {
        console.error('[Player] Erro ao retomar reprodução:', err);
        _listeners.onError?.(err);
      });
  }
  function pause() {
    _userPaused = true;
    audio.pause();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    _listeners.onPause?.();
  }

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

    // Rede de segurança: se por algum motivo o preload disparado no
    // início da faixa (_play) ainda não terminou (rede lenta) ou nem
    // chegou a rodar, tenta de novo nos últimos segundos da música.
    if (audio.duration && audio.duration - audio.currentTime <= 20) {
      _preloadNext();
    }
  });

  audio.addEventListener('ended', () => {
    const track = getCurrentTrack();
    if (track) _addToRecent(track);
    next();
  });

  audio.addEventListener('play', () => {
    const track = getCurrentTrack();
    if (track) _addToRecent(track);
    // Voltou a tocar de verdade — zera o contador de tentativas de
    // retomada automática (ver listener 'pause' abaixo).
    _autoResumeAttempts = 0;
  });

  audio.addEventListener('error', (e) => {
    console.error('[Player] Erro de áudio:', e);
    // Falha no meio da reprodução (ex.: conexão caiu durante o stream)
    // também deve acionar o auto-skip, e não travar o player.
    _handlePlaybackFailure(e, 0);
  });

  // Detecta pause NÃO solicitado pelo usuário — ex.: o sistema de som do
  // carro (Bluetooth/Android Auto) rouba o foco de áudio momentaneamente
  // (uma notificação, o GPS falando) e devolve em seguida, mas o Chrome
  // deixa o <audio> pausado em vez de retomar sozinho. Sem isso, a
  // música "para" e só volta se o usuário abrir o app e apertar play.
  // Limita a "briga" com o foco de áudio do sistema: retomar na mesma
  // hora, sem parar, é o que pode deixar o Bluetooth do carro instável
  // (algumas centrais multimídia derrubam a conexão quando o áudio
  // oscila play/pause rápido demais). Por isso: espera um pouco antes
  // de retomar (dá tempo do próprio SO terminar a transferência de
  // foco) e desiste depois de algumas tentativas seguidas.
  let _autoResumeAttempts    = 0;
  let _autoResumeWindowStart = 0;
  let _lastAutoResumeAt      = 0;
  const AUTO_RESUME_MAX_ATTEMPTS = 3;
  const AUTO_RESUME_WINDOW_MS    = 8000; // janela em que as tentativas contam
  const AUTO_RESUME_MIN_GAP_MS   = 1200; // intervalo mínimo entre tentativas
  const AUTO_RESUME_DELAY_MS     = 400;  // espera antes de cada tentativa

  audio.addEventListener('pause', () => {
    if (_userPaused) { _userPaused = false; return; }
    if (!getCurrentTrack()) return;
    // Áudio terminou naturalmente (ended cuida disso) ou já está no fim
    if (audio.ended || (audio.duration && audio.currentTime >= audio.duration - 0.5)) return;

    const now = Date.now();
    if (now - _autoResumeWindowStart > AUTO_RESUME_WINDOW_MS) {
      _autoResumeWindowStart = now;
      _autoResumeAttempts = 0;
    }
    if (_autoResumeAttempts >= AUTO_RESUME_MAX_ATTEMPTS) {
      console.warn('[Player] Pausa inesperada repetida — desistindo de retomar sozinho pra não instabilizar o Bluetooth/áudio do carro.');
      return;
    }
    if (now - _lastAutoResumeAt < AUTO_RESUME_MIN_GAP_MS) return;

    _lastAutoResumeAt = now;
    _autoResumeAttempts++;

    // Pausa inesperada: tenta retomar depois de um pequeno atraso, pra
    // não colidir com o próprio processo de transferência de foco do
    // sistema. Se o navegador recusar (ex.: ainda sem permissão de
    // autoplay depois de perder o foco de vez), não fica insistindo.
    setTimeout(() => {
      if (!audio.paused || _userPaused) return; // já retomou sozinho, ou o usuário pausou nesse meio tempo
      audio.play().catch(err => {
        console.warn('[Player] Pausa inesperada, não foi possível retomar sozinho:', err);
      });
    }, AUTO_RESUME_DELAY_MS);
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
    navigator.mediaSession.playbackState = 'playing';
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
    primeQueue,
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

    // Elemento de áudio bruto
    getAudioElement,

    // Callbacks
    on,
    onPlay,
  };

})();
