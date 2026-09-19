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
        if (_repeat !== 'all') return -1;
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
    if (window.NativeMedia) NativeMedia.setPlaybackState('paused');
    else if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    _listeners.onPause?.();
  }

  function togglePlay() {
    if (audio.paused) play();
    else              pause();
  }

  // Fone/Bluetooth desconectado de verdade (evento nativo, ver
  // MainActivity.java) — precisa pausar igual ao pause() manual, e NÃO
  // cair na auto-retomada acima (que é só pra "roubadas" de foco
  // passageiras). Sem isso, a música voltava a tocar sozinha pelo
  // alto-falante do celular assim que o Bluetooth caía.
  if (window.NativeApp && window.NativeApp.isNative) {
    window.addEventListener('hmAudioBecomingNoisy', () => {
      if (!audio.paused) pause();
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
    if (target >= _queue.length) target = (_repeat === 'all') ? 0 : -1;
    const immediate = target;

    // Sem internet: pula direto as faixas não baixadas, sem nem tentar
    // carregá-las (antes, o player mostrava a faixa seguinte, esperava a
    // falha e só então pulava — parecia "trocar música sozinho").
    if (offline && target !== -1) target = _seekPlayable(target, +1);

    if (target === -1) {
      // Fim da fila sem repeat (ou nada baixado mais à frente): em vez de
      // parar, tenta continuar sozinho com faixas do mesmo estilo (ver
      // _pickAutoContinueTracks).
      const extra = _pickAutoContinueTracks(getCurrentTrack(), _queue.map(t => t.id));
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
    } else if (_repeat === 'all') {
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
  function _updateMediaSession(track) {
    if (!window.NativeMedia) return;

    NativeMedia.setMetadata({
      title:  track.title,
      artist: track.artist,
      album:  'Happy Music',
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
