/* ═══════════════════════════════════════════════
   HAPPY MUSIC – player.js
   Engine de áudio: fila, shuffle, repeat, progresso
═══════════════════════════════════════════════ */

const Player = (() => {

  // ── MOTOR DE ÁUDIO (ExoPlayer nativo, fora do WebView, OU <audio> no
  // navegador) ──────────────────────────────────────────────────────
  // Dentro do app Android, quem toca o áudio de verdade agora é o
  // NativePlayerService (ver NativePlayerService.java) — é isso que
  // permite a música continuar tocando depois de fechar o app. Na
  // versão web (PWA no navegador), continua sendo o <audio> de sempre.
  // As duas implementações abaixo (_WebAudioEngine / _NativeAudioEngine)
  // expõem a MESMA interface mínima (currentTime, duration, paused,
  // play(), pause(), setSource(), addEventListener/dispatchEvent com os
  // eventos play/pause/ended/timeupdate/error) — todo o resto deste
  // arquivo (fila, shuffle, repeat, modo rádio, foco de áudio, retomar
  // de onde parou...) usa só essa interface e não sabe (nem precisa
  // saber) qual das duas está tocando por baixo.
  const _useNative = !!(window.NativeMedia && window.NativeMedia.isNative);

  class _WebAudioEngine extends EventTarget {
    constructor() {
      super();
      this._audio = new Audio();
      this._audio.preload = 'metadata';
      ['play', 'pause', 'ended', 'timeupdate', 'error', 'loadedmetadata'].forEach(evt => {
        this._audio.addEventListener(evt, () => this.dispatchEvent(new Event(evt)));
      });
    }
    get paused()        { return this._audio.paused; }
    get ended()         { return this._audio.ended; }
    get duration()      { return this._audio.duration; }
    get currentTime()   { return this._audio.currentTime; }
    set currentTime(v)  { this._audio.currentTime = v; }
    get volume()        { return this._audio.volume; }
    set volume(v)       { this._audio.volume = v; }
    // info = { url } — a versão web sempre recebe um blob: local (ver
    // Drive.fetchAudioUrl), nunca headers/path. upcoming/repeatMode são
    // ignorados (só o motor nativo consegue deixar o resto da fila
    // pré-carregado).
    async setSource(info, resumeSeconds, upcoming, repeatMode) {
      this._audio.src = info.url;
      this._audio.load();
      if (resumeSeconds > 0) this._audio.currentTime = resumeSeconds;
    }
    play()  { return this._audio.play(); }
    pause() { this._audio.pause(); }
  }

  class _NativeAudioEngine extends EventTarget {
    constructor() {
      super();
      this._paused = true;
      this._currentTime = 0;
      this._duration = 0;
      this._justEnded = 0; // timestamp do último 'ended' — ver hmNativeStateChanged abaixo

      // O nativo avisa sozinho quando o ExoPlayer muda de estado —
      // inclusive quando quem mandou tocar/pausar foi um botão físico,
      // a notificação, ou o próprio sistema (ver NativePlayerService.java
      // / native-bridge.js). Repassamos como play/pause/ended/timeupdate
      // pra ficar idêntico ao que o <audio> já disparava.
      window.addEventListener('hmNativeStateChanged', (e) => {
        const playing = !!e.detail?.playing;
        const wasPaused = this._paused;
        this._paused = !playing;
        this._currentTime = e.detail?.positionSeconds || 0;
        this._duration = e.detail?.durationSeconds || 0;
        if (wasPaused && playing) {
          this._justEnded = 0;
          this.dispatchEvent(new Event('play'));
        } else if (!wasPaused && !playing) {
          // O ExoPlayer manda "parou de tocar" e "acabou a faixa" quase
          // juntos quando chega no fim — sem isso, esse "parou" cairia
          // no listener de 'pause' abaixo (pensado pra ligação/GPS
          // roubando o foco) e tentaria RETOMAR a mesma faixa bem na
          // hora em que o listener de 'ended' já está avançando pra
          // próxima. Consome a flag (com validade curta, pra nunca
          // engolir uma pausa de verdade caso o aviso de 'ended' não
          // venha por algum motivo) e não dispara o 'pause' espúrio.
          if (this._justEnded && Date.now() - this._justEnded < 3000) {
            this._justEnded = 0;
          } else {
            this.dispatchEvent(new Event('pause'));
          }
        }
        this.dispatchEvent(new Event('timeupdate'));
      });
      window.addEventListener('hmNativeEnded', () => {
        this._paused = true;
        this._justEnded = Date.now();
        this.dispatchEvent(new Event('ended'));
      });
      window.addEventListener('hmNativeError', () => {
        this.dispatchEvent(new Event('error'));
      });

      // O nativo só avisa quando o ESTADO muda, não a cada segundo — sem
      // isso a barra de progresso ficaria parada durante a reprodução.
      setInterval(async () => {
        if (this._paused || !window.NativeMedia) return;
        const state = await window.NativeMedia.nativeGetState({ light: true });
        if (state) {
          this._currentTime = state.positionSeconds || 0;
          this._duration = state.durationSeconds || 0;
          this.dispatchEvent(new Event('timeupdate'));
        }
      }, 1000);
    }
    get paused()        { return this._paused; }
    get ended()         { return false; } // tratado via evento 'ended' acima
    get duration()      { return this._duration; }
    get currentTime()   { return this._currentTime; }
    set currentTime(v)  { this._currentTime = v; window.NativeMedia.nativeSeek(v); }
    get volume()        { return this._volume ?? 1; }
    set volume(v)       { this._volume = v; } // sem controle de volume nativo nesta fase — guardado só pra não quebrar quem ler de volta
    // info = { id, title, artist, album, artworkUrl, url, headers } ou
    // { ...path } — ver _resolveTrackSource(). upcoming (mesmo formato,
    // array, opcional) é o RESTO DA FILA já peekado: vai junto pro
    // ExoPlayer poder trocar de música sozinho por várias faixas
    // seguidas quando a atual (e as de depois) terminarem, mesmo com o
    // app fechado — ex.: uma viagem de carro (ver FASE 3 —
    // loadQueueAndPlay em NativePlayerService.java). repeatMode
    // ('none'|'all'|'one') é pro ExoPlayer saber dar a volta sozinho
    // quando a lista entregue acabar.
    // history (opcional): as faixas ANTES da atual — com elas o "anterior" da
    // notificação/fone/carro funciona direto no nativo, sem o app aberto.
    async setSource(info, resumeSeconds, upcoming, repeatMode, history) {
      const before = history || [];
      const items = [...before, info, ...(upcoming || [])];
      await window.NativeMedia.load({ items, resumeSeconds, repeatMode, startIndex: before.length });
      this._currentTime = resumeSeconds || 0;
    }
    async play()  { await window.NativeMedia.nativePlay(); this._paused = false; }
    pause() { window.NativeMedia.nativePause(); this._paused = true; }
  }

  // ── ESTADO ────────────────────────────────────
  const audio = _useNative ? new _NativeAudioEngine() : new _WebAudioEngine();

  let _queue        = [];   // fila atual (array de tracks)
  let _originalQueue= [];   // cópia sem shuffle
  let _index        = -1;   // índice atual na fila
  let _shuffle      = false;
  let _repeat       = 'none'; // 'none' | 'all' | 'one'

  // Fila "fechada" (playlist, ou biblioteca com filtro de artista/gênero/
  // álbum aplicado): ao terminar, dá a volta e continua tocando as MESMAS
  // faixas, em vez de cair no modo rádio (_pickAutoContinueTracks) e
  // trazer músicas de fora dali. Setado via opts.loop em loadQueue().
  let _queueLoops   = false;
  let _favorites    = new Set(JSON.parse(localStorage.getItem('hm_favorites') || '[]'));

  // Ponto (em segundos) pra retomar assim que a faixa restaurada por
  // restoreResumeState() for carregada de verdade (ver _play()) — sem
  // isso, reabrir o app depois de o processo ser recriado em segundo
  // plano sempre voltaria a faixa do zero.
  let _pendingResumeTime = 0;
  let _pendingResumeTrackId = null; // o ponto salvo só vale pra ESSA faixa
  let _lastResumeSaveAt  = 0; // throttle do salvamento periódico (ver timeupdate)

  // ── CALLBACKS (registrados pelo ui.js / app.js) ──
  const _listeners = {
    onPlay:        null,  // (track) => {}
    onPause:       null,  // () => {}
    onEnd:         null,  // () => {}
    onProgress:    null,  // (current, duration) => {}
    onError:       null,  // (err) => {}
    onLoading:     null,  // (track) => {} — disparado só na tentativa inicial (a faixa que o usuário realmente escolheu)
    onTrackSkipped:null,  // (failedTrack, err) => {} — disparado a cada faixa pulada automaticamente por erro (ver _handlePlaybackFailure)
    onOfflineSkip: null,  // (track) => {} — disparado ao pular pra próxima faixa baixada, sem internet
    onAllOffline:  null,  // () => {} — disparado quando, offline, nenhuma faixa da fila está baixada
    onOfflineBlocked: null, // (track, info) => {} — o usuário ESCOLHEU uma faixa que não toca sem internet; nada foi trocado (ver _blockIfUnavailableOffline / _abortExplicit)
    onAutoContinue: null, // (tracks) => {} — disparado ao completar a fila sozinho (modo rádio)
  };

  // ── FILA ──────────────────────────────────────
  // opts.skipUnavailable: usar em botões do tipo "tocar esta lista/playlist"
  // (o usuário não escolheu uma faixa específica). Sem internet, começa
  // pela primeira faixa baixada em vez de recusar.
  // Sem essa opção (toque numa faixa específica da lista), a faixa
  // escolhida é a que toca — ou, se não puder tocar, avisa e NÃO troca
  // por outra (era isso que deixava o usuário sem entender nada).
  // Retorna true se a fila foi carregada, false se foi recusada.
  function loadQueue(tracks, startIndex = 0, opts = {}) {
    let start = startIndex;
    let skippedTo = null;

    if (_isOffline() && tracks.length) {
      if (opts.skipUnavailable) {
        const found = _firstPlayableIndex(tracks, start);
        if (found === -1) {
          _listeners.onAllOffline?.();
          return false;
        }
        if (found !== start) skippedTo = tracks[found];
        start = found;
      } else if (_blockIfUnavailableOffline(tracks[start])) {
        return false;
      }
    }

    // Foto do estado atual, pra desfazer se a faixa escolhida falhar por
    // conexão (sinal fraco / wifi sem internet — casos em que
    // navigator.onLine ainda diz "true"): ver _abortExplicit.
    const snapshot = _snapshot();

    _originalQueue = [...tracks];
    _queue         = _shuffle ? _shuffled(tracks, start) : [...tracks];
    _index         = _shuffle ? 0 : start;
    _queueLoops    = !!opts.loop;
    _preloadedTrackId = null;
    _loadedTrackId = null;
    _play(0, { explicit: true, snapshot });

    // Depois do _play() de propósito: o onLoading dele mostra "Carregando…"
    // e este aviso (mais importante) tem que ser o que fica na tela.
    if (skippedTo) _listeners.onOfflineSkip?.(skippedTo);
    return true;
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

  // ── RETOMAR DE ONDE PAROU (sobrevive a reabrir o app) ──────────
  // O WebView do Android pode ser recriado do zero depois de um bom
  // tempo em segundo plano (o sistema derruba o processo por memória —
  // comum bem na hora de gravar/mandar um áudio no WhatsApp, ou numa
  // ligação mais longa). Quando isso acontece, todo o estado do
  // player em memória (fila, filtro/playlist ativa, ponto exato da
  // música) se perde — sem isso, o app "esquece" que você tinha
  // filtrado por gênero/artista/álbum ou tocado uma playlist, e ao
  // reabrir cai de volta na biblioteca inteira a partir do início da
  // faixa. Salvamos periodicamente um retrato mínimo (ids da fila,
  // faixa atual, ponto exato, loop/shuffle/repeat) e usamos pra
  // reconstruir tudo igual no próximo _primeLastPlayed() do app.js.
  const KEY_RESUME = 'hm_resume';

  function _saveResumeState() {
    try {
      const track = getCurrentTrack();
      if (!track || track.isExternal || !_queue.length) return;
      localStorage.setItem(KEY_RESUME, JSON.stringify({
        ids:     _originalQueue.map(t => t.id),
        trackId: track.id,
        time:    audio.currentTime || 0,
        loop:    _queueLoops,
        shuffle: _shuffle,
        repeat:  _repeat,
      }));
    } catch (_) { /* localStorage indisponível/cheio — não é crítico */ }
  }

  function _readSavedResume() {
    try {
      const raw = localStorage.getItem(KEY_RESUME);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // Monta a fila do JS em torno de uma faixa que o motor nativo JÁ está
  // tocando/pausado (carregada de verdade lá): usa a fila salva se ela
  // contém a faixa; senão sobra só a própria faixa por ora.
  // nativeIds (opcional): a fila REAL do player nativo (ids, na ordem em que ele
  // toca). Quando vem, ela vale mais que a salva pelo JS — o nativo pode ter
  // avançado várias faixas com o app fechado, sem o JS ficar sabendo.
  function _adoptNativeQueue(track, saved, pool, nativeIds) {
    let list = [];
    let idx  = -1;
    let fromNative = false;
    if (Array.isArray(nativeIds) && nativeIds.length) {
      list = nativeIds.map(id => pool.find(t => t.id === id)).filter(Boolean);
      idx  = list.findIndex(t => t.id === track.id);
      fromNative = idx !== -1;
    }
    if (!fromNative) {
      list = (saved?.ids || []).map(id => pool.find(t => t.id === id)).filter(Boolean);
      idx  = list.findIndex(t => t.id === track.id);
      if (idx === -1) { list = [track]; idx = 0; }
    }

    _originalQueue    = list;
    _shuffle          = saved ? !!saved.shuffle : false;
    _repeat           = saved && (saved.repeat === 'all' || saved.repeat === 'one') ? saved.repeat : 'none';
    _queueLoops       = saved ? !!saved.loop : false;
    // Fila vinda do nativo já está na ordem de reprodução (embaralhada, se for o caso).
    _queue            = (_shuffle && !fromNative) ? _shuffled(list, idx) : [...list];
    _index            = (_shuffle && !fromNative) ? 0 : idx;
    _preloadedTrackId = null;
    _loadedTrackId    = track.id; // já carregada de verdade no nativo
    _pendingResumeTime = 0;       // nada a retomar — já está na posição certa
  }

  // O motor só sabe do estado real a partir de agora (nunca recebeu
  // 'hmNativeStateChanged' pra essa faixa) — atualiza o "espelho" JS
  // direto, pra isPlaying()/getCurrentTime() já saírem certos.
  function _applyNativeMirror(state) {
    const dur = state.durationSeconds || 0;
    const pos = state.positionSeconds || 0;
    audio._paused      = !state.playing;
    audio._currentTime = pos;
    audio._duration    = dur;
    // Faixa que já tinha ACABADO no nativo (parado no fim): apertar play
    // não faria nada lá — marca como não carregada pra play() recarregar
    // do começo.
    if (!state.playing && dur > 0 && pos >= dur - 1) {
      audio._currentTime = 0;
      _loadedTrackId = null;
    }
  }

  // Reconcilia o JS com o que o ExoPlayer está tocando AGORA. Chamado ao
  // voltar pro app (visibilitychange): enquanto ele esteve em segundo
  // plano / fechado, o nativo pode ter trocado de faixa várias vezes sem
  // o JS (pausado ou recriado) receber nenhum aviso. Retorna a faixa
  // atual do nativo (já refletida na fila/estado do JS) ou null se não
  // há nada a sincronizar. Quem chama atualiza a UI.
  async function syncWithNative(allTracks) {
    if (!_useNative || !window.NativeMedia) return null;
    const state = await window.NativeMedia.nativeGetState();
    if (!state || !state.trackId) return null;

    const pool = (allTracks && allTracks.length)
      ? allTracks
      : ((typeof Drive !== 'undefined' && Drive.getCachedTracks && Drive.getCachedTracks()) || []);
    const track = pool.find(t => t.id === state.trackId);
    if (!track) return null;

    const sameAsCurrent = getCurrentTrack()?.id === state.trackId && _loadedTrackId === state.trackId;
    if (!sameAsCurrent) {
      const idx = _queue.findIndex(t => t.id === state.trackId);
      if (idx !== -1) {
        _index = idx;
        _loadedTrackId = state.trackId;
        _preloadedTrackId = null;
        _pendingResumeTime = 0;
      } else {
        _adoptNativeQueue(track, _readSavedResume(), pool, state.queue);
      }
      if (!track.isExternal) _addToRecent(track);
    }
    _applyNativeMirror(state);
    if (!sameAsCurrent) _saveResumeState();
    return track;
  }

  // Chamado pelo app.js na inicialização, assim que a biblioteca
  // completa (allTracks) estiver carregada. Não toca nada sozinho —
  // só remonta fila/índice/loop/shuffle/repeat e guarda o ponto exato
  // pra aplicar quando o usuário apertar play (ver _pendingResumeTime
  // em _play()). Retorna a faixa restaurada, ou null se não havia
  // nada salvo (instalação nova) ou as faixas salvas não existem mais
  // no Drive (apagadas/movidas enquanto o app estava fechado).
  async function restoreResumeState(allTracks) {
    try {
      const raw = localStorage.getItem(KEY_RESUME);
      let saved = null;
      if (raw) { try { saved = JSON.parse(raw); } catch { saved = null; } }

      // FASE 3: no nativo, o ExoPlayer pode ter avançado sozinho pra
      // próxima faixa (ou até parado, se essa também acabou) enquanto o
      // app estava fechado — o que foi salvo no celular por último pode
      // já não bater com a realidade. Pergunta pro motor nativo o que
      // está tocando DE VERDADE agora e usa isso como fonte da verdade
      // (mesmo quando é a mesma faixa salva: assim o estado tocando/
      // pausado e o ponto exato também vêm do nativo, e apertar play não
      // recarrega a faixa à toa).
      if (_useNative && window.NativeMedia) {
        const state = await window.NativeMedia.nativeGetState();
        if (state && state.trackId) {
          const track = allTracks.find(t => t.id === state.trackId);
          if (track) {
            _adoptNativeQueue(track, saved, allTracks, state.queue);
            _applyNativeMirror(state);
            return track;
          }
        }
      }

      if (!saved || !Array.isArray(saved.ids) || !saved.ids.length) return null;

      const list = saved.ids.map(id => allTracks.find(t => t.id === id)).filter(Boolean);
      const idx  = list.findIndex(t => t.id === saved.trackId);
      if (idx === -1) return null;

      _originalQueue     = list;
      _shuffle           = !!saved.shuffle;
      _repeat            = (saved.repeat === 'all' || saved.repeat === 'one') ? saved.repeat : 'none';
      _queueLoops        = !!saved.loop;
      _queue             = _shuffle ? _shuffled(list, idx) : [...list];
      _index             = _shuffle ? 0 : idx;
      _preloadedTrackId  = null;
      _loadedTrackId     = null;
      _pendingResumeTime = Math.max(0, saved.time || 0);
      _pendingResumeTrackId = saved.trackId;

      return list[idx];
    } catch (_) {
      return null;
    }
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

  // ── CONEXÃO / O QUE TOCA SEM INTERNET ───────────
  // navigator.onLine só vira "false" quando o aparelho SABE que está sem
  // rede (modo avião, wifi e dados desligados). Sinal fraco no carro ou
  // wifi sem internet continuam "true" — esses casos são pegos na hora
  // de carregar a faixa (ver _isConnectivityError).
  function _isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  // Há prova concreta de que a faixa toca sem internet? (baixada no
  // aparelho, já carregada na memória nesta sessão, ou arquivo externo
  // aberto direto do celular)
  function _isKnownPlayableOffline(track) {
    if (!track) return false;
    if (track.isExternal) return true;
    if (typeof Drive !== 'undefined' && Drive.hasAudioInMemory?.(track.id)) return true;
    return typeof Downloads !== 'undefined' && Downloads.isDownloaded(track.id);
  }

  // Versão que decide se BLOQUEIA: enquanto o app ainda não terminou de
  // conferir o que está baixado (primeiros instantes após abrir), não dá
  // pra afirmar que a faixa "não foi baixada" — então não bloqueia, deixa
  // tentar (se falhar por conexão, _abortExplicit avisa do mesmo jeito).
  function _isPlayableOffline(track) {
    if (typeof Downloads !== 'undefined' && Downloads.isSynced && !Downloads.isSynced()) return true;
    return _isKnownPlayableOffline(track);
  }

  // Erro de rede (e não um problema da faixa em si, tipo 403/404).
  // Dois formatos: fetch() lançando TypeError sem rede ("Failed to fetch",
  // "Load failed"...) ou o Service Worker respondendo 503 "Áudio
  // indisponível offline" (sw.js) — o que chega aqui como "HTTP 503".
  function _isConnectivityError(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    if (err instanceof TypeError) return /fetch|network|load failed/i.test(msg);
    return msg === 'DRIVE_UNAVAILABLE' || /^HTTP (502|503|504)$/.test(msg);
  }

  // Primeira faixa que toca offline a partir de startIndex (dando a volta
  // na lista). -1 se nenhuma.
  function _firstPlayableIndex(tracks, startIndex) {
    for (let n = 0; n < tracks.length; n++) {
      const i = (startIndex + n) % tracks.length;
      if (_isPlayableOffline(tracks[i])) return i;
    }
    return -1;
  }

  // Próxima faixa da fila que toca offline, andando de `from` na direção
  // `dir` (+1 / -1). Só dá a volta na fila com repeat 'all'. -1 se acabou.
  function _seekPlayable(from, dir) {
    const len = _queue.length;
    for (let n = 0; n < len; n++) {
      let i = from + dir * n;
      if (i < 0 || i >= len) {
        if (_repeat !== 'all' && !_queueLoops) return -1;
        i = ((i % len) + len) % len;
      }
      if (_isPlayableOffline(_queue[i])) return i;
    }
    return -1;
  }

  // Usuário escolheu uma faixa específica que não toca sem internet.
  // Não mexe em NADA (fila, índice, o que está tocando continua tocando)
  // e só avisa. Retorna true se bloqueou.
  function _blockIfUnavailableOffline(track) {
    if (!track || !_isOffline() || _isPlayableOffline(track)) return false;
    _listeners.onOfflineBlocked?.(track, {
      reason: 'offline', restore: null, wasPlaying: !audio.paused,
    });
    return true;
  }

  // Foto do estado da fila, pra poder desfazer uma escolha que falhou.
  function _snapshot() {
    return {
      queue: _queue, originalQueue: _originalQueue, index: _index,
      loadedTrackId: _loadedTrackId, preloadedTrackId: _preloadedTrackId,
      queueLoops: _queueLoops,
    };
  }

  // A faixa escolhida falhou por conexão. Volta a fila pro que era antes
  // (o <audio> nem foi tocado ainda — só troca de src quando a busca da
  // faixa dá certo, então o que já estava tocando segue tocando) e avisa
  // a UI pra voltar o player ao normal + mostrar o motivo.
  function _abortExplicit(track, snap) {
    let restore = null;
    if (snap && snap.queue.length) {
      _queue = snap.queue;
      _originalQueue = snap.originalQueue;
      _index = snap.index;
      _loadedTrackId = snap.loadedTrackId;
      _preloadedTrackId = snap.preloadedTrackId;
      _queueLoops = !!snap.queueLoops;
      restore = getCurrentTrack();
    }
    _listeners.onOfflineBlocked?.(track, {
      reason: 'network', restore, wasPlaying: !audio.paused,
    });
  }

  // ── PLAY / PAUSE ──────────────────────────────
  let _loadToken = 0; // evita race condition ao trocar de faixa rápido

  // _ctx = { explicit, snapshot } quando quem chamou foi uma ESCOLHA do
  // usuário (toque na lista, botão play numa faixa ainda não carregada...).
  // Nesse caso, falha de conexão não pode virar "toca outra faixa": ver catch.
  async function _play(_skipAttempts = 0, _ctx = null) {
    const track = getCurrentTrack();
    if (!track) return;

    const myLoad = ++_loadToken;
    // Só avisa a UI (troca capa/título no player) na tentativa inicial —
    // a faixa que o usuário realmente tocou. Nas tentativas seguintes,
    // disparadas automaticamente por _handlePlaybackFailure quando uma
    // faixa falha, NÃO atualizamos o player visualmente: antes, cada
    // faixa que falhava no meio da fila trocava capa/título/artista na
    // tela por uma fração de segundo antes de falhar de novo, dando a
    // impressão de "o player pulando várias músicas sozinho" quando na
    // verdade eram só tentativas invisíveis de recuperação de erro.
    if (_skipAttempts === 0) _listeners.onLoading?.(track);

    try {
      const source = await _resolveTrackSource(track);

      // Deixa o RESTO DA FILA pronto e carregado no motor nativo (ver
      // FASE 3) — é o que permite o ExoPlayer trocar de música sozinho
      // quando a atual terminar, mesmo com o app fechado, por várias
      // faixas seguidas (ex.: uma viagem de carro), não só uma. Resolve
      // tudo em paralelo — não baixa áudio nenhum nessa hora, só monta
      // a URL/token (ou acha o caminho do arquivo baixado) de cada uma,
      // então é rápido mesmo com várias faixas.
      let upcoming = [];
      let history  = [];
      if (_useNative) {
        _extendQueueForNative(track);
        const historyIdx  = _peekHistoryIndexes();
        const upcomingIdx = _peekUpcomingIndexes();
        const all = [...historyIdx, ...upcomingIdx];
        if (all.length) {
          const resolved = await Promise.allSettled(all.map(idx => _resolveTrackSource(_queue[idx])));
          const ok = r => r.status === 'fulfilled';
          history  = resolved.slice(0, historyIdx.length).filter(ok).map(r => r.value);
          upcoming = resolved.slice(historyIdx.length).filter(ok).map(r => r.value);
        }
      }

      // Se o usuário já trocou de faixa enquanto isso carregava, ignora
      if (myLoad !== _loadToken) return;

      // Restaura o ponto exato de uma sessão anterior (ver
      // restoreResumeState) — só na primeira vez que essa faixa é
      // carregada de fato depois de restaurada; consumido uma vez só.
      // Só retoma se for a MESMA faixa que estava salva. Antes, o ponto
      // ficava pendente pra "a primeira faixa carregada": tocar outra
      // música logo ao abrir o app começava no meio dela.
      const resumeSeconds = (_pendingResumeTime > 0 && _pendingResumeTrackId === track.id) ? _pendingResumeTime : 0;
      _pendingResumeTime = 0;
      _pendingResumeTrackId = null;

      // 'one' reaproveita o próprio ExoPlayer repetindo a faixa atual
      // sozinho (ver repeatMode nativo); 'all'/loop de playlist-filtro
      // já vêm cobertos dentro de upcoming (_peekUpcomingIndexes dá a
      // volta), mas ainda passamos o modo pra ele saber repetir quando
      // a lista entregue acabar.
      const repeatMode = _repeat === 'one' ? 'one' : (_repeat === 'all' || _queueLoops) ? 'all' : 'none';

      await audio.setSource(source, resumeSeconds, upcoming, repeatMode, history);
      _loadedTrackId = track.id;

      await audio.play();
      _listeners.onPlay?.(track);
      _saveResumeState();

      // Pré-carrega a próxima faixa em segundo plano. Isso é essencial
      // com a tela travada: baixar o áudio inteiro (fetch + blob) só
      // depois que a faixa atual termina cria um intervalo mudo entre
      // uma faixa e outra. Nesse intervalo o Android (principalmente
      // MIUI/HyperOS) entende que não há playback ativo e pode suspender
      // a aba/WebView antes do fetch da próxima faixa terminar — o app
      // trava e nunca mais toca. Com a próxima faixa já em cache no
      // momento em que a atual termina, a troca é praticamente instantânea.
      // (Só se aplica ao motor web — o ExoPlayer nativo faz o próprio
      // buffering sozinho, e não depende do WebView pra continuar vivo.)
      _preloadNext();

    } catch (err) {
      if (myLoad !== _loadToken) return; // já trocou de faixa, ignora erro
      console.error('[Player] Erro ao reproduzir:', err);

      const connectivity = _isConnectivityError(err);

      // O usuário escolheu ESTA faixa e a conexão falhou: não troca por
      // outra (ele não entenderia por que tocou uma música diferente).
      // Desfaz o que a escolha mexeu, deixa o que já tocava tocando e avisa.
      if (_skipAttempts === 0 && _ctx?.explicit && connectivity) {
        _abortExplicit(track, _ctx.snapshot);
        return;
      }

      // Falha de conexão é anunciada pelo aviso de "pulou pra faixa baixada"
      // (em _handlePlaybackFailure) — não faz sentido um toast "não foi
      // possível tocar X (Failed to fetch)" logo antes dele.
      if (!connectivity && !_isOffline()) _listeners.onTrackSkipped?.(track, err);
      _handlePlaybackFailure(err, _skipAttempts);
    }
  }

  // Descobre de onde vem o áudio da faixa, no formato que o motor atual
  // espera (ver _WebAudioEngine/_NativeAudioEngine acima):
  //  - Web: sempre um blob: local (Drive.fetchAudioUrl já resolve baixado
  //    vs. streaming sozinho, e cacheia o blob).
  //  - Nativo: baixada -> caminho de arquivo puro (NativeFS.getAudioPath,
  //    o ExoPlayer toca direto do disco); senão -> URL + cabeçalho de
  //    autorização do Drive (Drive.getAudioDownloadInfo), pro ExoPlayer
  //    buscar sozinho, sem gastar memória/rede duplicada num blob que
  //    ninguém mais usaria.
  async function _resolveTrackSource(track) {
    if (_useNative) {
      // title/artist/album/artworkUrl vão junto pro motor nativo poder
      // atualizar a notificação sozinho quando avançar pra essa faixa
      // sem ajuda do JS (ver FASE 3 — onMediaItemTransition em
      // NativePlayerService.java). Mesmos campos usados em
      // _updateMediaSession, pra ficar igual em qualquer um dos dois
      // caminhos.
      const meta = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: 'HappyMusic',
        artworkUrl: track.thumbnail || null,
      };
      // Arquivo do aparelho aberto por "Abrir com": não existe no Drive nem na
      // pasta de downloads — o ExoPlayer abre direto pela URI original.
      if (track.isExternal) {
        if (track.__uri) return { ...meta, album: track.album || meta.album, path: track.__uri };
        throw new Error('Arquivo externo sem URI');
      }
      if (window.NativeFS && window.NativeFS.isNative) {
        const path = await window.NativeFS.getAudioPath(track.id);
        if (path) return { ...meta, path };
      }
      const info = await Drive.getAudioDownloadInfo(track.id);
      return { ...meta, url: info.url, headers: info.headers };
    }
    return { url: await Drive.fetchAudioUrl(track.id) };
  }

  // Descobre, sem alterar o estado, qual seria o índice da próxima
  // faixa (espelha a lógica de next(), mas só de leitura).
  function _peekNextIndex() {
    if (!_queue.length) return -1;
    if (_repeat === 'one') return _index;
    if (_index < _queue.length - 1) return _index + 1;
    if (_repeat === 'all' || _queueLoops) return 0;
    return -1; // fim da fila, sem repeat
  }

  // Lista de índices que vêm depois da faixa atual, na ordem em que
  // tocariam (já considerando repeat/loop) — usada pra deixar o motor
  // nativo com o RESTO da fila pronto de uma vez (ver _play()), não só
  // a próxima faixa. É o que permite uma viagem de horas com o app
  // fechado continuar trocando de música sozinha, sem precisar
  // desbloquear o telefone a cada faixa. 40 faixas à frente já cobre
  // umas 2h de música com folga; sem limite, uma biblioteca enorme sem
  // filtro ficaria resolvendo centenas de URLs à toa a cada troca.
  const NATIVE_QUEUE_LOOKAHEAD = 40;

  function _peekUpcomingIndexes(limit = NATIVE_QUEUE_LOOKAHEAD) {
    if (!_queue.length || _repeat === 'one') return []; // repeat-one: a própria faixa atual já cobre (ver repeatMode nativo)
    const out = [];
    let i = _index;
    for (let n = 0; n < limit; n++) {
      let next = i + 1;
      if (next >= _queue.length) {
        if (_repeat === 'all' || _queueLoops) next = 0;
        else break; // fim da fila, sem repeat
      }
      if (next === _index) break; // já demos a volta completa na fila
      out.push(next);
      i = next;
    }
    return out;
  }

  // Faixas que tocaram ANTES da atual (até 10), em ordem — vão pro nativo
  // junto com o resto da fila (ver _play) pra "anterior" funcionar lá.
  const NATIVE_QUEUE_HISTORY = 10;

  function _peekHistoryIndexes(limit = NATIVE_QUEUE_HISTORY) {
    if (!_queue.length || _repeat === 'one') return [];
    const out = [];
    for (let i = _index - 1; i >= 0 && out.length < limit; i--) out.push(i);
    return out.reverse();
  }

  // Fila aberta (sem repeat nem loop) quase acabando: completa JÁ com faixas
  // do mesmo estilo (modo rádio), antes de mandar pro nativo. Sem isso, com o
  // app fechado a fila carregada acabava e vinha silêncio — o modo rádio só
  // rodava no JS, que pode estar dormindo.
  function _extendQueueForNative(track) {
    if (track.isExternal) return; // arquivo avulso do aparelho: toca só ele
    if (_queueLoops || _repeat !== 'none') return;
    if (_queue.length - 1 - _index >= 10) return;
    const extra = _pickAutoContinueTracks(track, _queue.map(t => t.id));
    if (!extra.length) return;
    _queue         = [..._queue, ...extra];
    _originalQueue = [..._originalQueue, ...extra];
  }

  let _preloadedTrackId = null;

  // Busca antecipadamente o áudio da próxima faixa (Drive.fetchAudioUrl
  // já cacheia por fileId), sem bloquear nada. Se falhar, não tem problema:
  // _play() vai buscar de novo (com o intervalo mudo) quando chegar a vez.
  function _preloadNext() {
    if (_useNative) return; // ExoPlayer cuida do próprio buffering sozinho
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

    // Sem rede de verdade (navigator.onLine === false) OU sinal fraco / wifi
    // sem internet (onLine continua "true", mas o fetch falhou por
    // conexão): nos dois casos não adianta tentar faixa por faixa — cada
    // uma gastaria segundos de retentativa em silêncio. Vai direto pra
    // próxima já baixada.
    const offline = _isOffline() || _isConnectivityError(err);

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
      if (t && _isKnownPlayableOffline(t)) return idx;
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
      if (_blockIfUnavailableOffline(track)) return;
      _play(0, { explicit: true, snapshot: _snapshot() });
      return;
    }

    // A fila foi editada ("A seguir") enquanto estava pausado: o ExoPlayer
    // ainda tem a ordem antiga. Recarrega no ponto atual (já toca sozinho).
    if (_useNative && _nativeQueueDirty) {
      _refreshNativeUpcoming();
      return;
    }

    audio.play()
      .then(() => _listeners.onPlay?.(track))
      .catch(err => {
        console.error('[Player] Erro ao retomar reprodução:', err);
        _listeners.onError?.(err);
      });

    // Rede de segurança (só nativo): a faixa foi mostrada como "carregada" a
    // partir do que estava salvo, mas se o serviço reiniciou e não conseguiu
    // reabrir a fila (arquivo apagado, por ex.), o play não faria nada. Se
    // depois de 2 s o nativo não tem ESTA faixa, carrega do zero.
    if (_useNative) {
      setTimeout(async () => {
        if (_userPaused || getCurrentTrack()?.id !== track.id) return;
        const st = await window.NativeMedia.nativeGetState({ light: true });
        if (!st || st.trackId !== track.id) {
          _loadedTrackId = null;
          _play(0, { explicit: true, snapshot: _snapshot() });
        }
      }, 2000);
    }
  }
  function pause() {
    _userPaused = true;
    audio.pause();
    if (window.NativeMedia) NativeMedia.setPlaybackState('paused');
    else if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    _saveResumeState();
    _listeners.onPause?.();
  }

  function togglePlay() {
    if (audio.paused) play();
    else              pause();
  }

  // Foco de áudio (ligação, WhatsApp gravando/tocando áudio, YouTube, GPS),
  // fone/Bluetooth desconectado e retomada ao conectar o Bluetooth são
  // tratados 100% pelo serviço nativo (NativePlayerService / ExoPlayer) —
  // o JS só reflete o estado na tela (ver 'hmNativeStateChanged').

  // O ExoPlayer avançou/recuou SOZINHO pra uma faixa já preparada (ver
  // FASE 3 — a "próxima" pré-carregada em _play(), ou o botão de
  // avançar/recuar da notificação com o app fechado). Só atualiza a
  // marcação de "faixa atual" e a UI — NÃO chama _play()/next() de
  // novo, porque a faixa já está tocando de verdade; recarregar aqui
  // reiniciaria ela do zero à toa.
  if (window.NativeApp && window.NativeApp.isNative) {
    window.addEventListener('hmNativeTrackChanged', (e) => {
      const newId = e.detail?.trackId;
      if (!newId || newId === _loadedTrackId) return;
      let idx = _queue.findIndex(t => t.id === newId);
      if (idx === -1) {
        // Faixa fora da fila que o JS conhece (ex.: o JS foi recriado e só
        // sabe a fila salva): acha na biblioteca e remonta em volta dela
        // em vez de ignorar — senão a tela ficava presa na faixa antiga.
        const pool = (typeof Drive !== 'undefined' && Drive.getCachedTracks && Drive.getCachedTracks()) || [];
        const found = pool.find(t => t.id === newId);
        if (!found) return;
        _adoptNativeQueue(found, _readSavedResume(), pool);
        idx = _index;
      }
      _index = idx;
      _loadedTrackId = newId;
      const track = _queue[idx];
      if (track && !track.isExternal) _addToRecent(track);
      _listeners.onPlay?.(track);
      _saveResumeState();
    });
  }

  function isPlaying() { return !audio.paused; }

  // ── CONTINUAR SOZINHO (MODO RÁDIO) ─────────────
  // Quando o usuário clica numa música avulsa (favoritos, playlist
  // pequena, resultado de busca, "recentes"...) a fila carregada pode
  // ter só aquela faixa (ou poucas). Sem isso, ao terminar a única
  // música o player simplesmente parava. Em vez disso, ao chegar no
  // fim da fila (sem repeat ativo) buscamos mais faixas do mesmo
  // gênero da última música tocada, direto da biblioteca completa do
  // Drive, e continuamos tocando — como uma rádio baseada no estilo.
  function _pickAutoContinueTracks(referenceTrack, excludeIds, count = 15) {
    if (typeof Drive === 'undefined' || typeof Drive.getCachedTracks !== 'function') return [];

    let all = Drive.getCachedTracks() || [];
    // Sem internet, só continua com faixas que tocam offline — senão a
    // "rádio" sugeriria músicas que vão falhar.
    if (_isOffline()) all = all.filter(_isPlayableOffline);
    if (!all.length) return [];

    const exclude = new Set(excludeIds);
    const genre = referenceTrack?.genre || null;

    let pool = all.filter(t => !exclude.has(t.id) && (genre ? t.genre === genre : true));

    // Nenhuma outra faixa do mesmo estilo sobrando — melhor continuar
    // tocando algo (qualquer faixa ainda não tocada) do que simplesmente
    // parar a reprodução.
    if (!pool.length) pool = all.filter(t => !exclude.has(t.id));
    if (!pool.length) return [];

    // Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool.slice(0, count);
  }

  // ── NAVEGAÇÃO ─────────────────────────────────
  function next() {
    if (!_queue.length) return;

    if (_repeat === 'one') {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    const offline = _isOffline();

    let target = _index + 1;
    if (target >= _queue.length) target = (_repeat === 'all' || _queueLoops) ? 0 : -1;
    const immediate = target;

    // Sem internet: pula direto as faixas não baixadas, sem nem tentar
    // carregá-las (antes, o player mostrava a faixa seguinte, esperava a
    // falha e só então pulava — parecia "trocar música sozinho").
    if (offline && target !== -1) target = _seekPlayable(target, +1);

    if (target === -1) {
      // Fim da fila sem repeat: em vez de parar, tenta continuar sozinho
      // com faixas do mesmo estilo (ver _pickAutoContinueTracks) — MAS
      // só quando a fila não é fechada (_queueLoops). Numa playlist ou
      // biblioteca filtrada por artista/gênero/álbum, o pedido é nunca
      // sair dali; mesmo no caso raro de estar offline e nenhuma faixa
      // da própria seleção estar baixada, é melhor parar do que emendar
      // uma faixa de outro estilo por trás (era esse vazamento que fazia
      // "sertanejo" de repente tocar rock).
      const extra = _queueLoops ? [] : _pickAutoContinueTracks(getCurrentTrack(), _queue.map(t => t.id));
      if (extra.length) {
        const firstNew = _queue.length;
        _queue         = [..._queue, ...extra];
        _originalQueue = [..._originalQueue, ...extra];
        _index         = firstNew;
        _listeners.onAutoContinue?.(extra);
      } else {
        _listeners.onEnd?.();
        return;
      }
    } else {
      _index = target;
    }

    _play();

    // Depois do _play() pra o aviso não ser coberto pelo "Carregando…".
    if (offline && target !== -1 && target !== immediate) {
      _listeners.onOfflineSkip?.(getCurrentTrack());
    }
  }

  function prev() {
    if (!_queue.length) return;

    // Se passou mais de 3s, reinicia a música atual
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    let target = _index;
    if (_index > 0) {
      target = _index - 1;
    } else if (_repeat === 'all' || _queueLoops) {
      target = _queue.length - 1;
    }

    // Sem internet: volta pra faixa anterior QUE ESTÁ BAIXADA. Se não
    // houver nenhuma, reinicia a atual (que já está tocando, então toca).
    let skipped = false;
    if (_isOffline() && target !== _index) {
      const found = _seekPlayable(target, -1);
      if (found === -1) {
        target = _index;
      } else {
        skipped = found !== target;
        target = found;
      }
    }

    _index = target;
    _play();

    if (skipped) _listeners.onOfflineSkip?.(getCurrentTrack());
  }

  // Pula para uma faixa específica da fila pelo índice
  function jumpTo(index) {
    if (index < 0 || index >= _queue.length) return;
    if (_blockIfUnavailableOffline(_queue[index])) return;
    const snapshot = _snapshot();
    _index = index;
    _play(0, { explicit: true, snapshot });
  }

  // ── EDIÇÃO DA FILA ("A seguir") ────────────────
  // O ExoPlayer nativo já recebeu as próximas faixas (ver _play): se a
  // ordem muda aqui, ele precisa receber de novo, senão trocaria de
  // faixa na ordem antiga com a tela apagada. Recarregar reinicia o
  // buffer (pequeno corte), então só fazemos com a música tocando; se
  // estiver pausada, fica marcado e é refeito no próximo play().
  let _nativeQueueDirty = false;
  let _queueRefreshTimer = null;

  function _afterQueueEdit() {
    _saveResumeState();
    if (!_useNative) return;
    _nativeQueueDirty = true;
    clearTimeout(_queueRefreshTimer);
    _queueRefreshTimer = setTimeout(() => {
      if (!audio.paused) _refreshNativeUpcoming();
    }, 700);
  }

  async function _refreshNativeUpcoming() {
    const track = getCurrentTrack();
    if (!_useNative || !track || _loadedTrackId !== track.id) return;
    _nativeQueueDirty = false;
    const myLoad = _loadToken;
    const pos = audio.currentTime || 0;
    try {
      const source = await _resolveTrackSource(track);
      const historyIdx  = _peekHistoryIndexes();
      const upcomingIdx = _peekUpcomingIndexes();
      const resolved = await Promise.allSettled([...historyIdx, ...upcomingIdx].map(i => _resolveTrackSource(_queue[i])));
      const ok = r => r.status === 'fulfilled';
      const history  = resolved.slice(0, historyIdx.length).filter(ok).map(r => r.value);
      const upcoming = resolved.slice(historyIdx.length).filter(ok).map(r => r.value);
      if (myLoad !== _loadToken || getCurrentTrack()?.id !== track.id) return; // usuário trocou de faixa nesse meio tempo
      const repeatMode = _repeat === 'one' ? 'one' : (_repeat === 'all' || _queueLoops) ? 'all' : 'none';
      await audio.setSource(source, pos, upcoming, repeatMode, history); // o nativo já começa tocando
      _listeners.onPlay?.(track);
    } catch (err) {
      _nativeQueueDirty = true; // não deu certo — tenta de novo no próximo play()
      console.warn('[Player] Não foi possível atualizar a fila nativa:', err);
    }
  }

  function _syncOriginalAfterEdit(removedTrack) {
    if (!_shuffle) _originalQueue = [..._queue];
    else if (removedTrack) {
      const i = _originalQueue.findIndex(t => t.id === removedTrack.id);
      if (i !== -1) _originalQueue.splice(i, 1);
    }
  }

  // Coloca a faixa logo depois da atual. Se já está na fila, MOVE (sem
  // duplicar). Retorna 'ok' | 'current' (é a que está tocando) | 'empty'.
  function playNext(track) {
    if (!track) return 'empty';
    const cur = getCurrentTrack();
    if (!cur) {
      // Nada carregado ainda: vira a fila inteira, só preparada.
      primeQueue([track], 0);
      return 'empty';
    }
    if (cur.id === track.id) return 'current';
    const existing = _queue.findIndex(t => t.id === track.id);
    if (existing !== -1) {
      _queue.splice(existing, 1);
      if (existing < _index) _index--;
    } else if (_shuffle) {
      _originalQueue.push(track);
    }
    _queue.splice(_index + 1, 0, track);
    _syncOriginalAfterEdit(null);
    _afterQueueEdit();
    return 'ok';
  }

  // Coloca a faixa no fim da fila (se já estava, move pro fim).
  function addToQueue(track) {
    if (!track) return 'empty';
    const cur = getCurrentTrack();
    if (!cur) { primeQueue([track], 0); return 'empty'; }
    if (cur.id === track.id) return 'current';
    const existing = _queue.findIndex(t => t.id === track.id);
    if (existing !== -1) {
      _queue.splice(existing, 1);
      if (existing < _index) _index--;
    } else if (_shuffle) {
      _originalQueue.push(track);
    }
    _queue.push(track);
    _syncOriginalAfterEdit(null);
    _afterQueueEdit();
    return 'ok';
  }

  // Move um item DEPOIS da faixa atual (índices da fila de reprodução).
  function moveInQueue(from, to) {
    if (from === _index || to === _index) return false;
    if (from < 0 || to < 0 || from >= _queue.length || to >= _queue.length || from === to) return false;
    const [t] = _queue.splice(from, 1);
    _queue.splice(to, 0, t);
    if (from < _index && to >= _index) _index--;
    else if (from > _index && to <= _index) _index++;
    _syncOriginalAfterEdit(null);
    _afterQueueEdit();
    return true;
  }

  function removeFromQueue(index) {
    if (index === _index || index < 0 || index >= _queue.length) return false;
    const [removed] = _queue.splice(index, 1);
    if (index < _index) _index--;
    _syncOriginalAfterEdit(removed);
    _afterQueueEdit();
    return true;
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
    // Mesma regra de _playlistTracks (app.js): sempre em ordem alfabética
    // pelo título, tanto na tela quanto na ordem de reprodução.
    return Drive.getCachedTracks()
      .filter(t => _favorites.has(t.id))
      .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pt-BR', { sensitivity: 'base' }));
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

    // Guarda o ponto atual de tempos em tempos (não a cada tick) —
    // é o que permite retomar do lugar certo se o processo for
    // recriado no meio da faixa, sem nunca ter passado por pause()
    // (ver restoreResumeState / _pendingResumeTime).
    const now = Date.now();
    if (now - _lastResumeSaveAt > 5000) {
      _lastResumeSaveAt = now;
      _saveResumeState();
    }
  });

  audio.addEventListener('ended', () => {
    const track = getCurrentTrack();
    if (track && !track.isExternal) _addToRecent(track);
    next();
  });

  audio.addEventListener('play', () => {
    const track = getCurrentTrack();
    if (track && !track.isExternal) _addToRecent(track);
    // Voltou a tocar de verdade — zera os contadores de retomada
    // automática e de falhas seguidas (ver listeners 'pause'/'error').
    _autoResumeAttempts = 0;
    _errorSkipStreak = 0;
    // Tocar começou por fora do app (notificação, fone, Bluetooth): reflete na tela.
    if (_useNative && track) _listeners.onPlay?.(track);
  });

  // Conta falhas seguidas do elemento <audio> (evento 'error', disparado
  // de forma assíncrona pelo próprio navegador — separado do try/catch
  // de _play()). Sem isso, cada falha reiniciaria a contagem em 0 e o
  // player poderia ficar pulando de faixa em faixa pra sempre, nunca
  // acionando a rede de segurança de _handlePlaybackFailure.
  let _errorSkipStreak = 0;

  audio.addEventListener('error', (e) => {
    console.error('[Player] Erro de áudio:', e);
    _errorSkipStreak++;
    // Falha no meio da reprodução (ex.: conexão caiu durante o stream)
    // também deve acionar o auto-skip, e não travar o player.
    _handlePlaybackFailure(e, _errorSkipStreak);
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
    // Motor nativo: o ExoPlayer é o dono do play/pause (foco de áudio, ligação,
    // fone/Bluetooth saindo, botões da notificação). Ele mesmo retoma o que deve
    // ser retomado — o JS só REFLETE na tela. A "auto-retomada" abaixo brigava
    // com ele (e com a pausa que o usuário acabou de pedir).
    if (_useNative) {
      _userPaused = false;
      _listeners.onPause?.();
      return;
    }
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

  // Media Session API (controles na tela de bloqueio / Bluetooth) —
  // usa o plugin nativo (com foreground service) dentro do app Android,
  // ou a Media Session Web API normal quando roda no navegador.
  let _nextHandlerSet = false;

  function _updateMediaSession(track) {
    if (!window.NativeMedia) return;

    // Motor nativo: o serviço mostra título/capa/estado/posição sozinho, a
    // partir da fila que recebeu — o JS não empurra mais nada por cima (isso
    // gerava notificação desatualizada). Resta só o "próxima" pro caso do
    // nativo chegar ao fim da fila carregada (aí o JS continua no modo rádio).
    if (_useNative) {
      if (!_nextHandlerSet) {
        _nextHandlerSet = true;
        NativeMedia.setActionHandler('nexttrack', () => next());
      }
      return;
    }

    NativeMedia.setMetadata({
      title:  track.title,
      artist: track.artist,
      album:  'HappyMusic',
      artwork: track.thumbnail
        ? [{ src: track.thumbnail, sizes: '96x96', type: 'image/jpeg' }]
        : [{ src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });

    NativeMedia.setActionHandler('play',           () => play());
    NativeMedia.setActionHandler('pause',          () => pause());
    NativeMedia.setActionHandler('nexttrack',      () => next());
    NativeMedia.setActionHandler('previoustrack',  () => prev());
    NativeMedia.setActionHandler('seekto', (d) => seek(d.seekTime));
    NativeMedia.setPlaybackState('playing');
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
    restoreResumeState,
    syncWithNative,
    getQueue,
    playNext,
    addToQueue,
    moveInQueue,
    removeFromQueue,
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
