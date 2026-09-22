/* ═══════════════════════════════════════════════
   HAPPY MUSIC – app.js
   Orquestrador principal: init, auth, carregamento
═══════════════════════════════════════════════ */

const App = (() => {

  // ── ESTADO ────────────────────────────────────
  let _tracks = [];   // todas as faixas carregadas
  let _initialized = false;
  let _readyFired = false;
  const KEY_ONBOARDED = 'hm_onboarded';
  const KEY_AUTO_DOWNLOAD = 'hm_auto_download';
  const GDRIVE_URL = 'https://drive.google.com/drive/my-drive';

  // ── ABRIR ARQUIVO EXTERNO ("Abrir com" do Android) ──
  // Toca um áudio que não faz parte da biblioteca do Drive — o usuário
  // tocou num MP3 num gerenciador de arquivos (ou recebeu por WhatsApp
  // etc.) e escolheu o HappyMusic pra abrir. Ver AndroidManifest.xml
  // (intent-filter de audio/*) e NativeApp.onUrlOpen mais abaixo.
  const EXTERNAL_ID_PREFIX = 'external:';
  let _pendingExternalUri = null; // guardado se chegar antes do app terminar de iniciar
  let _appStarted = false; // só true depois que _startApp() termina (login ok, faixas carregadas)

  function _tryConsumePendingExternalAudio() {
    if (!_pendingExternalUri || !_appStarted) return;
    const uri = _pendingExternalUri;
    _pendingExternalUri = null;
    _handleExternalAudioOpen(uri);
  }

  async function _handleExternalAudioOpen(uri) {
    if (!window.Capacitor?.convertFileSrc) return;

    const src = window.Capacitor.convertFileSrc(uri);
    const id = EXTERNAL_ID_PREFIX + Date.now();

    let title = 'Música externa';
    let artist = 'Desconhecido';
    let album = '';
    let thumbnail = null;
    let blob = null;

    try {
      const res = await fetch(src);
      blob = await res.blob();
      const tags = await Drive.readAudioTags(blob);
      if (tags) {
        title     = tags.title     || title;
        artist    = tags.artist    || artist;
        album     = tags.album     || album;
        thumbnail = tags.picture   || null;
      }
    } catch (err) {
      console.warn('[App] não deu pra ler metadados do arquivo externo:', err);
    }

    Drive.registerExternalAudio(id, src);

    // Guarda o blob e os metadados já lidos no próprio objeto da faixa
    // (nunca persistido em lugar nenhum, só em memória) — é o que o
    // botão "Adicionar à biblioteca" usa depois, sem precisar buscar o
    // arquivo de novo.
    const track = {
      id, title, artist, album, genre: '', thumbnail, isExternal: true,
      __blob: blob, __title: title, __artist: artist, __album: album,
    };
    Player.loadQueue([track], 0);
    UI.showToast('Tocando arquivo do aparelho (fora da sua biblioteca)');
  }

  // Deriva uma extensão de arquivo a partir do mimeType do Blob — o
  // <audio>/fetch não nos dá o nome original do arquivo (só o Android
  // sabe, e não expõe isso pelo content://), então sem isso o arquivo
  // subiria pro Drive sem extensão nenhuma.
  const AUDIO_EXT_BY_MIME = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/opus': 'opus',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/webm': 'weba',
  };
  function _extFromMime(mime) {
    return AUDIO_EXT_BY_MIME[(mime || '').toLowerCase()] || 'mp3';
  }


  // Abre o Google Drive já na conta logada no app (evita cair numa
  // conta diferente ou pedir login de novo) e sempre num navegador de
  // verdade — dentro do app nativo, window.open() na WebView embutida
  // não reaproveita a sessão feita no login (mesmo motivo do OAuth).
  function _openGoogleDrive() {
    const email = Drive.getUser()?.email;
    const url = email
      ? `${GDRIVE_URL}?authuser=${encodeURIComponent(email)}`
      : GDRIVE_URL;

    if (window.NativeBrowser && window.NativeBrowser.isNative) {
      window.NativeBrowser.open(url);
    } else {
      window.open(url, '_blank');
    }
  }

  // Filtros da tela "Todas as músicas"
  let _filters = { genre: '', artist: [], album: '' };

  // Playlists (cache em memória; fonte de verdade é o Drive.loadPlaylists/savePlaylists)
  let _playlists = [];
  let _activePlaylistId = null;
  const KEY_RECENT_PLAYLISTS = 'hm_recent_playlists';
  const MAX_RECENT_PLAYLISTS = 8;

  // Fila de upload — cada item guarda o File + os metadados digitados
  let _uploadItems = [];
  let _uploadCounter = 0;

  // Vídeos (catálogo de links do YouTube)
  let _videos = [];
  let _movieFilterGenre = '';

  // Coleção ativa na aba de vídeos: '__all__' | MOVIE_FAVORITES_ID | id de playlist
  let _movieCollection = '__all__';
  const MOVIE_FAVORITES_ID = '__movie_favorites__';

  // Favoritos de vídeo (localStorage — mesmo padrão dos favoritos de música)
  const KEY_VIDEO_FAVORITES = 'hm_video_favorites';
  let _videoFavorites = new Set(JSON.parse(localStorage.getItem(KEY_VIDEO_FAVORITES) || '[]'));

  // Playlists de vídeo (cache em memória; fonte de verdade é o Drive.loadMoviePlaylists/saveMoviePlaylists)
  let _moviePlaylists = [];

  // Sugestões de gênero pra facilitar o cadastro (além dos gêneros já usados)
  const DEFAULT_GENRES = [
    'MPB', 'Sertanejo', 'Pagode', 'Samba', 'Forró', 'Axé', 'Gospel',
    'Pop', 'Rock', 'Eletrônica', 'Funk', 'Reggae', 'Infantil', 'Instrumental',
  ];

  const DEFAULT_MOVIE_GENRES = [
    'Ação', 'Comédia', 'Drama', 'Terror', 'Suspense', 'Romance',
    'Animação', 'Documentário', 'Ficção Científica', 'Infantil',
  ];

  function _uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'pl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // Avisa o index.html (que controla a splash) que a tela inicial
  // (login ou app) já foi decidida e aplicada — só então a splash
  // pode começar a desaparecer, evitando o "flash" de tela errada
  // ou em branco enquanto o app ainda está decidindo o que mostrar.
  function _markReady() {
    if (_readyFired) return;
    _readyFired = true;
    window.__hmReady = true;
    document.dispatchEvent(new Event('hm-ready'));
  }

  // ── INIT ──────────────────────────────────────
  async function init() {
    if (_initialized) return;
    _initialized = true;

    // Estado inicial de conexão (faixa "Sem internet" + músicas não
    // baixadas esmaecidas). Os eventos online/offline mantêm em dia depois.
    UI.setOnlineState?.(navigator.onLine);

    // 1. Bind eventos fixos (player, nav, search)
    UI.bindPlayerEvents();
    _bindAppEvents();

    // 1.5. App nativo: escuta o retorno do login do Google (que acontece
    // numa aba de navegador externa, não dentro do app — ver drive.js).
    if (window.NativeApp && window.NativeApp.isNative) {
      window.NativeApp.onUrlOpen(async (url) => {
        // Arquivo de áudio aberto via "Abrir com" do Android chega aqui
        // como content:// (às vezes file://) — nada a ver com o retorno
        // do login OAuth (que é sempre https://). Guarda e tenta tocar
        // assim que o app terminar de iniciar (pode chegar antes do
        // login terminar, numa abertura a frio).
        if (url.startsWith('content://') || url.startsWith('file://')) {
          _pendingExternalUri = url;
          _tryConsumePendingExternalAudio();
          return;
        }

        if (!url.includes('code=') && !url.includes('error=')) return;

        window.NativeBrowser.close();

        const ok = await Drive.handleCallback(url);
        if (!ok) {
          UI.showLogin();
          UI.showToast('Erro ao autenticar. Tente novamente.');
          return;
        }
        await _startApp();
      });
    }

    // 2. Verifica se voltou do OAuth (código na URL)
    const params = new URLSearchParams(window.location.search);
    if (params.get('code')) {
      const ok = await Drive.handleCallback();
      if (!ok) {
        UI.showLogin();
        UI.showToast('Erro ao autenticar. Tente novamente.');
        _markReady();
        return;
      }
    }

    // 3. Tenta restaurar sessão existente
    if (await Drive.restoreSession()) {
      await _startApp();
    } else {
      UI.showLogin();
      _markReady();
    }
  }

  // ── INICIAR APP PÓS-LOGIN ──────────────────────
  async function _startApp() {
    UI.showApp();
    _markReady();

    const user = Drive.getUser();
    UI.renderProfile(user);
    UI.setGreeting();
    _updateFolderLabel();

    if (!localStorage.getItem(KEY_ONBOARDED)) {
      UI.showOnboarding();
    }

    // Mostra a última música tocada NA HORA, sem esperar a lista carregar
    // do Drive (isso é uma chamada de rede — dependendo da conexão, o
    // player só apareceria alguns segundos depois, parecendo que não
    // tinha aparecido). Usa o que já está salvo localmente; quando
    // _loadTracks() terminar, _primeLastPlayed() completa a fila de
    // verdade (pra next/prev funcionarem).
    _primeLastPlayedInstant();

    // Sincroniza com o que já está no cache de áudio do Service Worker
    // (fonte de verdade) e atualiza os indicadores visuais assim que
    // a resposta chegar — sem bloquear o carregamento das músicas.
    Downloads.refreshCachedIds().then(() => {
      UI.refreshDownloadBadges();
      _updateOfflineSummary();
    });

    // Pede armazenamento persistente: sem isso, o cache de áudio offline
    // (Cache Storage do Service Worker) é "melhor esforço" e o Android
    // pode apagá-lo sozinho sob pressão de espaço, sem avisar — fazendo
    // faixas "baixadas" pararem de tocar offline do nada. Não bloqueia
    // nada se for negado, só reduz a chance disso acontecer.
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }

    await _loadTracks();
    _updateOfflineSummary();
    _loadPlaylists();
    _loadMovies();
    _loadMoviePlaylists();

    _appStarted = true;
    _tryConsumePendingExternalAudio();
  }

  function _updateFolderLabel() {
    // Sem nome guardado localmente; mostra genérico se houver pasta selecionada
    const folderId = Drive.getFolderId();
    UI.updateFolderLabel(folderId ? (localStorage.getItem('hm_folder_name') || 'pasta selecionada') : null);
  }

  // ── CARREGAR FAIXAS ────────────────────────────
  async function _loadTracks() {
    // Skeleton enquanto carrega
    UI.showLoading(UI.el.allTracksList, 6);

    try {
      const wasOffline = !navigator.onLine;
      _tracks = await Drive.listTracks();

      // Preenche de cara as capas que já estão salvas de uma sessão
      // anterior, ANTES de desenhar qualquer lista — pra não aparecer o
      // ícone piscando e trocando pra capa um instante depois em toda
      // música que já tinha capa conhecida.
      await Drive.preloadCachedCovers(_tracks);

      if (wasOffline && _tracks.length) {
        UI.showToast('Sem conexão — mostrando sua biblioteca salva. Só as músicas baixadas tocam offline.');
      }

      if (!_tracks.length) {
        UI.el.allTracksList.innerHTML = `
          <div class="empty-hint">
            Nenhuma música encontrada.<br>
            Envie arquivos de áudio pelo app ou adicione direto na pasta do Google Drive.
            <br><br>
            <button id="btn-empty-drive" class="btn-outline btn-small">Abrir Google Drive</button>
          </div>`;
        const btn = document.getElementById('btn-empty-drive');
        if (btn) btn.addEventListener('click', _openGoogleDrive);
        _renderRecent();
        _refreshFilterBar();
        return;
      }

      // Recentes
      _renderRecent();
      _refreshFilterBar();
      _renderAllTracksList();
      _primeLastPlayed();

      _autoDownloadMissing();

    } catch (err) {
      console.error('[App] Erro ao carregar músicas:', err);

      if (err.message === 'UNAUTHORIZED') {
        Drive.logout();
        UI.showLogin();
        UI.showToast('Sessão expirada. Faça login novamente.');
        return;
      }

      UI.el.allTracksList.innerHTML = `
        <p class="empty-hint">Erro ao carregar músicas. Verifique sua conexão.</p>`;
      // DIAGNÓSTICO TEMPORÁRIO: mostra a mensagem real do erro no toast
      // (a genérica escondia o motivo de verdade). Reverter depois que
      // acharmos a causa.
      UI.showToast('Erro: ' + (err && err.message ? err.message : err), 6000);
    }
  }

  function _renderRecent() {
    // Reativado: a Home ficou com um vão vazio depois que "Todas as
    // músicas" foi pra aba Biblioteca — o histórico (Player.getRecent())
    // nunca parou de ser gravado, só não tinha pra onde desenhar.
    //
    // Player.getRecent() devolve uma FOTO congelada de cada música (foi
    // gravada em localStorage no instante em que ela tocou) — se a capa
    // foi trocada depois (manualmente, ou porque a busca automática de
    // capa só termina alguns segundos depois de a música começar), essa
    // foto antiga nunca se atualiza sozinha. Por isso, sempre que for
    // desenhar, atualiza cada item com os dados atuais de _tracks (a
    // fonte viva) antes de mostrar — assim a Home sempre reflete a capa
    // (e título/artista, se tiverem sido editados) mais recente.
    const recent = Player.getRecent().map(saved => {
      const live = _tracks.find(t => t.id === saved.id);
      return live ? { ...saved, ...live } : saved;
    });
    UI.renderRecent(recent);
    UI.bindRecentEvents(recent); // liga o clique — sem isso a lista aparece mas não toca nada
    _renderRecentCollections();
  }

  // Mostra a última música tocada assim que o app abre, usando só o que
  // já está salvo localmente (Player.getRecent()) — sem esperar a lista
  // de músicas carregar do Drive. É só uma pré-visualização; a fila de
  // verdade é montada depois por _primeLastPlayed(), quando _tracks
  // estiver disponível.
  function _primeLastPlayedInstant() {
    try {
      if (Player.getCurrentTrack()) return;
      const recent = Player.getRecent();
      if (!recent.length) return;
      UI.updatePlayerTrack(recent[0]);
      UI.setPlayState(false);
    } catch (err) {
      console.error('[App] Erro ao pré-carregar a última música (instantâneo):', err);
    }
  }

  // Deixa o player pronto com a última música tocada, com a fila
  // completa montada (pra next/prev funcionarem) — só falta apertar
  // play, igual ao Spotify. Não toca sozinho (autoplay sem gesto do
  // usuário é bloqueado pelo navegador mesmo).
  function _primeLastPlayed() {
    try {
      const recent = Player.getRecent();
      if (!recent.length) return;

      const track = _tracks.find(t => t.id === recent[0].id);
      if (!track) return; // pode ter sido apagada/movida no Drive

      // Se a versão instantânea já não deixou nada tocando, isso só
      // troca a fila internamente (sem UI piscar) — se por acaso já
      // estiver tocando algo (usuário foi rápido), não mexe em nada.
      if (Player.getCurrentTrack() && Player.isPlaying()) return;

      Player.primeQueue(_tracks, _tracks.indexOf(track));
      UI.updatePlayerTrack(track);
      UI.setPlayState(false);
    } catch (err) {
      console.error('[App] Erro ao pré-carregar a última música:', err);
    }
  }

  function _currentId() {
    return Player.getCurrentTrack()?.id || null;
  }

  // ── MODO OFFLINE ────────────────────────────────
  let _batchRunning = false;

  function _formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function _updateOfflineSummary() {
    if (_batchRunning) return; // o progresso do lote já cobre o status nesse momento

    if (!_tracks.length) {
      UI.setLibraryStats({ total: 0 });
      UI.setOfflineSummary('Carregue suas músicas pra poder baixá-las para ouvir offline.');
      return;
    }

    let count = 0;
    let bytes = 0;
    _tracks.forEach(t => {
      if (Downloads.isDownloaded(t.id)) {
        count++;
        bytes += t.size || 0;
      }
    });

    UI.setLibraryStats({ total: _tracks.length, downloaded: count, bytes });
    UI.updateDownloadAllButton(count, _tracks.length);

    if (!count) {
      UI.setOfflineSummary('Nenhuma música baixada ainda. Baixe antes de pegar estrada sem internet.');
      return;
    }

    const size = _formatBytes(bytes);
    UI.setOfflineSummary(`${count} de ${_tracks.length} músicas baixadas${size ? ' · ' + size : ''}.`);
  }

  // Avisa se o download vai provavelmente estourar o espaço livre do
  // aparelho, mas deixa o usuário decidir se quer arriscar mesmo assim
  async function _confirmIfLowStorage(tracks, silent = false) {
    const totalBytes = tracks.reduce((sum, t) => sum + (t.size || 0), 0);
    if (!totalBytes) return true; // sem estimativa de tamanho, não bloqueia

    const storage = await Downloads.estimateStorage();
    if (!storage || !storage.quota) return true;

    if (totalBytes > storage.available * 0.9) {
      if (silent) return false;
      return UI.confirmDialog(
        `Isso baixa cerca de ${_formatBytes(totalBytes)}, mas seu aparelho tem só ` +
        `${_formatBytes(storage.available)} livres. Baixar mesmo assim? ` +
        `(pode parar antes de terminar tudo)`,
        { title: 'Pouco espaço livre', okLabel: 'Baixar mesmo assim', danger: false }
      );
    }
    return true;
  }

  // ── DOWNLOAD AUTOMÁTICO ─────────────────────────
  // Baixa sozinho o que ainda falta assim que a biblioteca carrega —
  // sem precisar tocar em "Baixar tudo" toda vez. Silencioso: sem
  // internet ou sem espaço suficiente, só não faz nada (ou avisa por
  // toast), nunca interrompe o uso do app.
  let _autoDownloadRanThisSession = false;

  function isAutoDownloadEnabled() {
    return localStorage.getItem(KEY_AUTO_DOWNLOAD) === '1'; // desligado por padrão
  }

  function setAutoDownloadEnabled(enabled) {
    localStorage.setItem(KEY_AUTO_DOWNLOAD, enabled ? '1' : '0');
  }

  async function _autoDownloadMissing() {
    if (_autoDownloadRanThisSession) return;
    if (!isAutoDownloadEnabled() || !navigator.onLine || _batchRunning) return;

    const missing = _tracks.filter(t => !Downloads.isDownloaded(t.id));
    _autoDownloadRanThisSession = true; // só tenta uma vez por sessão
    if (!missing.length) return;

    // Checagem silenciosa de espaço — automático não deve interromper
    // com um popup perguntando "baixar mesmo assim?"; só avisa e
    // deixa pra a pessoa baixar manualmente o que quiser depois.
    if (!(await _confirmIfLowStorage(missing, /* silent */ true))) {
      UI.showToast('Espaço baixo pro download automático — baixe manualmente o que precisar em Perfil.');
      return;
    }

    await _runDownloadBatch(missing, 'all');
  }

  async function _runDownloadBatch(tracks, which) {
    if (_batchRunning) {
      Downloads.cancelBatch();
      return;
    }

    if (!tracks.length) {
      UI.showToast(which === 'fav' ? 'Você ainda não tem músicas favoritas.' : 'Nenhuma música pra baixar.');
      return;
    }

    if (!(await _confirmIfLowStorage(tracks))) return;

    _batchRunning = true;
    UI.setDownloadBatchUI(true, 0, tracks.length, which);

    const result = await Downloads.downloadMany(tracks, (done, total) => {
      UI.setDownloadBatchUI(true, done, total, which);
    });

    // Ressincroniza com o SW: o cache de áudio tem um limite máximo de
    // faixas e pode ter descartado as mais antigas (FIFO) durante o lote
    await Downloads.refreshCachedIds();
    UI.refreshDownloadBadges();

    _batchRunning = false;
    UI.setDownloadBatchUI(false);
    _updateOfflineSummary();

    if (result.cancelled) {
      UI.showToast('Download cancelado.');
    } else {
      UI.showToast(`${result.done} de ${result.total} músicas disponíveis offline`);
    }
  }

  // ── SELEÇÃO MÚLTIPLA / AÇÕES EM LOTE ───────────
  // Útil pra quem já tem um monte de música solta no Drive e quer
  // organizar por gênero, favoritar ou montar uma playlist sem
  // editar faixa por faixa.
  function _updateSelectionUI() {
    const count = UI.getSelectedIds(UI.el.allTracksList).length;
    UI.updateSelectionBar(count);
  }

  function _exitSelectMode() {
    UI.setSelectMode(UI.el.allTracksList, false);
    UI.hideSelectionBar();
    UI.el.btnSelectMode.classList.remove('active');
    UI.el.btnSelectMode.title = 'Selecionar';
    UI.el.btnSelectMode.setAttribute('aria-label', 'Selecionar músicas');
  }

  async function _applyBulkGenre(genre) {
    const ids = UI.getSelectedIds(UI.el.allTracksList);
    if (!ids.length) return;

    UI.el.btnBulkGenreSave.disabled = true;
    let done = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        const current = _findTrackAnywhere(id);
        await Drive.updateTrackMetadata(id, {
          title:  current?.title  || '',
          artist: current?.artist || '',
          album:  current?.album  || '',
          genre,
        });
        const idx = _tracks.findIndex(t => t.id === id);
        if (idx !== -1) _tracks[idx] = Drive.getCachedTracks().find(t => t.id === id) || _tracks[idx];
      } catch (err) {
        console.error('[App] Falha ao atribuir gênero em lote:', id, err);
        failed++;
        if (err?.message === 'UNAUTHORIZED') {
          Drive.logout();
          UI.showLogin();
          UI.hideBulkGenreModal();
          return;
        }
      }
      done++;
      UI.setBulkGenreProgress(done, ids.length);
    }

    UI.hideBulkGenreModal();
    _exitSelectMode();
    _refreshFilterBar();
    _renderAllTracksList();

    UI.showToast(failed
      ? `Gênero aplicado a ${done - failed} de ${ids.length} (${failed} falharam — tenta de novo nessas)`
      : `Gênero "${genre}" aplicado a ${done} música${done === 1 ? '' : 's'}`);
  }

  function _applyBulkFavorite() {
    const ids = UI.getSelectedIds(UI.el.allTracksList);
    if (!ids.length) return;

    let added = 0;
    ids.forEach(id => {
      if (!Player.isFavorite(id)) {
        Player.toggleFavorite(id);
        added++;
      }
    });

    document.dispatchEvent(new CustomEvent('hm-favorite-change'));
    _exitSelectMode();
    _renderAllTracksList();

    UI.showToast(added
      ? `${added} música${added === 1 ? '' : 's'} adicionada${added === 1 ? '' : 's'} aos favoritos`
      : 'Essas músicas já estavam nos favoritos');
  }

  function _openBulkAddToPlaylist() {
    const ids = UI.getSelectedIds(UI.el.allTracksList);
    if (!ids.length) return;
    UI.showAddToPlaylistModal(_playlists, ids);
  }

  function _bindSelectionEvents() {
    UI.el.btnSelectMode.addEventListener('click', () => {
      const on = !UI.isSelectMode(UI.el.allTracksList);
      UI.setSelectMode(UI.el.allTracksList, on);
      UI.el.btnSelectMode.classList.toggle('active', on);
      UI.el.btnSelectMode.setAttribute('aria-label', on ? 'Cancelar seleção' : 'Selecionar músicas');
      UI.el.btnSelectMode.title = on ? 'Cancelar seleção' : 'Selecionar';
      if (on) { UI.showSelectionBar(); _updateSelectionUI(); }
      else { UI.hideSelectionBar(); }
    });

    UI.el.btnSelectionCancel.addEventListener('click', () => _exitSelectMode());

    UI.el.btnSelectionFavorite.addEventListener('click', () => _applyBulkFavorite());

    UI.el.btnSelectionAddPlaylist.addEventListener('click', () => _openBulkAddToPlaylist());

    UI.el.btnSelectionAssignGenre.addEventListener('click', () => {
      const count = UI.getSelectedIds(UI.el.allTracksList).length;
      if (!count) return;
      UI.showBulkGenreModal(count, _knownGenres());
    });

    document.addEventListener('hm-selection-change', () => _updateSelectionUI());

    UI.el.btnBulkGenreSave.addEventListener('click', () => {
      const genre = UI.el.bulkGenreField.value.trim();
      if (!genre) { UI.showToast('Digite um gênero.'); return; }
      _applyBulkGenre(genre);
    });

    UI.el.btnBulkGenreCancel.addEventListener('click', () => UI.hideBulkGenreModal());

    UI.el.modalBulkGenre.addEventListener('click', e => {
      if (e.target === UI.el.modalBulkGenre) UI.hideBulkGenreModal();
    });
  }


  // ── FILTROS (gênero / artista / álbum) ─────────
  function _visibleTracks() {
    return Drive.filterTracks(_filters);
  }

  function _renderAllTracksList() {
    const list = _visibleTracks();

    if (!_tracks.length) return; // trata vazio lá em cima, em _loadTracks

    const active = [_filters.genre, (_filters.artist && _filters.artist.length ? 1 : ''), _filters.album].filter(Boolean).length;

    if (!list.length) {
      UI.el.allTracksList.innerHTML = `<p class="empty-hint">Nenhuma música com esse filtro.</p>`;
    } else {
      UI.renderTrackListIncremental(UI.el.allTracksList, list, _currentId(), UI.el.mainContent);
      // loop: true só com filtro (artista/gênero/álbum) ativo — nesse caso
      // é uma seleção fechada, então ao acabar continua girando nela mesma
      // em vez de emendar músicas de fora (modo rádio). Sem filtro (lista
      // inteira da biblioteca) mantém o comportamento de rádio de sempre.
      UI.bindTrackListEvents(UI.el.allTracksList, list, { loop: active > 0 });
    }

    UI.setFilterSummary(active ? `${list.length} de ${_tracks.length} músicas com o filtro atual` : null);

    if (UI.isSelectMode(UI.el.allTracksList)) _updateSelectionUI();
  }

  function _refreshFilterBar() {
    UI.renderFilterOptions({
      genres:  Drive.getKnownGenres(),
      artists: Drive.getKnownArtists(),
      albums:  Drive.getKnownAlbums(),
    }, _filters);
  }

  function _bindFilterEvents() {
    UI.el.filterChipGenre.addEventListener('click', () => {
      UI.hideFilterMenu();
      UI.showFilterPicker('genre', _filters.genre, value => {
        _filters.genre = value;
        _refreshFilterBar();
        _renderAllTracksList();
      });
    });
    UI.el.filterChipArtist.addEventListener('click', () => {
      UI.hideFilterMenu();
      UI.showFilterPicker('artist', _filters.artist, values => {
        _filters.artist = values;
        _refreshFilterBar();
        _renderAllTracksList();
      }, { multi: true });
    });
    UI.el.filterChipAlbum.addEventListener('click', () => {
      UI.hideFilterMenu();
      UI.showFilterPicker('album', _filters.album, value => {
        _filters.album = value;
        _refreshFilterBar();
        _renderAllTracksList();
      });
    });
    UI.el.btnFilterClear.addEventListener('click', () => {
      _filters = { genre: '', artist: [], album: '' };
      _refreshFilterBar();
      _renderAllTracksList();
    });
  }

  // ── ENVIO DE MÚSICAS (upload) ──────────────────
  function _knownGenres() {
    const known = Drive.getKnownGenres();
    return [...new Set([...DEFAULT_GENRES, ...known])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function _filenameToTitle(name) {
    return (name || '').replace(/\.[^.]+$/, '');
  }

  function _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const _ICON_NOTE = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  const _ICON_UPLOAD_BIG = `<svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>`;
  const _ICON_CARET = `<svg class="upload-item-caret" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;
  const _ICON_WARN = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;

  const _isActiveUpload = i => i.status === 'pending' || i.status === 'error';

  function _uploadItemTitle(item) {
    return item.title.trim() || _filenameToTitle(item.file.name);
  }

  function _uploadItemMeta(item) {
    const parts = [item.artist.trim() || 'Sem artista'];
    if (item.album.trim()) parts.push(item.album.trim());
    parts.push(UI.fmtBytes(item.file.size));
    return parts.join(' · ');
  }

  function _uploadItemHtml(item) {
    const st = item.status;
    const canToggle = st === 'pending' || st === 'error';
    const icon = st === 'done' ? UI.checkIcon(20) : st === 'error' ? _ICON_WARN : _ICON_NOTE;
    const state =
      st === 'uploading' ? `<span class="upload-item-pct">${item.progress}%</span>` :
      st === 'done'      ? 'Enviada' :
      st === 'error'     ? 'Falhou' : '';

    return `
      <div class="upload-item upload-item-${st} ${canToggle && item.expanded ? 'open' : ''}" data-upload-id="${item.localId}">
        <button type="button" class="upload-item-head" ${canToggle ? `data-toggle="${item.localId}"` : 'disabled'}>
          <span class="upload-item-icon">${icon}</span>
          <span class="upload-item-main">
            <span class="upload-item-title">${_escHtml(_uploadItemTitle(item))}</span>
            <span class="upload-item-meta">${_escHtml(_uploadItemMeta(item))}</span>
          </span>
          <span class="upload-item-state">${state}${st === 'pending' ? _ICON_CARET : ''}</span>
        </button>

        ${canToggle ? `
          <div class="upload-item-form">
            <div class="upload-field">
              <label>Título</label>
              <input type="text" class="text-input" data-field="title" data-id="${item.localId}" value="${_escHtml(item.title)}" autocomplete="off" />
            </div>
            <div class="upload-field-row">
              <div class="upload-field">
                <label>Artista</label>
                <input type="text" class="text-input" data-field="artist" data-id="${item.localId}" value="${_escHtml(item.artist)}" placeholder="Desconhecido" autocomplete="off" />
              </div>
              <div class="upload-field">
                <label>Álbum</label>
                <input type="text" class="text-input" data-field="album" data-id="${item.localId}" value="${_escHtml(item.album)}" autocomplete="off" />
              </div>
            </div>
            <div class="upload-field">
              <label>Gênero</label>
              <div class="genre-suggest-wrap">
                <input type="text" class="text-input" data-field="genre" data-id="${item.localId}" value="${_escHtml(item.genre)}" placeholder="Ex: MPB" autocomplete="off" />
                <div class="genre-suggest-list hidden"></div>
              </div>
            </div>
            <div class="upload-item-foot">
              <button type="button" class="text-btn upload-item-remove" data-remove="${item.localId}">Remover da fila</button>
            </div>
          </div>` : ''}

        ${st === 'uploading' ? `
          <div class="upload-item-progress">
            <div class="dl-progress-bar"><div class="dl-progress-fill" style="width:${item.progress}%"></div></div>
          </div>` : ''}

        ${st === 'error' ? `
          <p class="upload-item-msg">${_escHtml(item.errorMsg || 'Falha ao enviar.')}</p>
          <div class="upload-item-retry"><button type="button" class="btn-outline btn-small" data-retry="${item.localId}">Tentar novamente</button></div>
        ` : ''}
      </div>`;
  }

  function _renderUploadList() {
    if (!_uploadItems.length) {
      UI.el.uploadList.innerHTML = `
        <div class="upload-empty">
          <span class="upload-empty-icon">${_ICON_UPLOAD_BIG}</span>
          <strong>Nenhum arquivo escolhido</strong>
          <span>MP3, M4A, WAV, FLAC… Antes de enviar, você cadastra artista, álbum e gênero de cada música.</span>
          <button type="button" class="btn-primary btn-small" data-pick-files>Escolher arquivos</button>
        </div>`;
    } else {
      UI.el.uploadList.innerHTML = _uploadItems.map(_uploadItemHtml).join('');

      // Sugestões de gênero próprias (o <datalist> nativo aparece fora
      // do lugar no WebView do Android — mesmo motivo do resto do app)
      UI.el.uploadList.querySelectorAll('input[data-field="genre"]').forEach(input => {
        UI.attachGenreSuggest(input, input.parentElement.querySelector('.genre-suggest-list'), _knownGenres);
      });
    }
    _updateUploadFooter();
  }

  // Rodapé (resumo + botão principal) e painel "Preencher para todas"
  function _updateUploadFooter() {
    const active    = _uploadItems.filter(_isActiveUpload);
    const uploading = _uploadItems.filter(i => i.status === 'uploading');
    const done      = _uploadItems.filter(i => i.status === 'done');
    const btn = UI.el.btnUploadSendAll;
    btn.dataset.mode = '';

    UI.el.uploadBulk.classList.toggle('hidden', active.length < 2);

    if (!_uploadItems.length) {
      UI.el.uploadSummary.textContent = '';
      btn.textContent = 'Enviar';
      btn.disabled = true;
      return;
    }

    if (_uploadRunning || uploading.length) {
      UI.el.uploadSummary.textContent = `Enviando… ${done.length} de ${_uploadItems.length} concluída${done.length === 1 ? '' : 's'}`;
      btn.textContent = 'Enviando…';
      btn.disabled = true;
      return;
    }

    if (!active.length) {
      UI.el.uploadSummary.textContent = `${done.length} música${done.length === 1 ? ' enviada' : 's enviadas'} pro seu Drive`;
      btn.textContent = 'Concluir';
      btn.dataset.mode = 'done';
      btn.disabled = false;
      return;
    }

    const bytes = active.reduce((sum, i) => sum + (i.file.size || 0), 0);
    UI.el.uploadSummary.textContent =
      `${active.length} arquivo${active.length === 1 ? '' : 's'} · ${UI.fmtBytes(bytes)}`;
    btn.textContent = active.length === 1 ? 'Enviar música' : `Enviar ${active.length} músicas`;
    btn.disabled = false;
  }

  function _refreshUploadItemHead(item) {
    const row = UI.el.uploadList.querySelector(`[data-upload-id="${item.localId}"]`);
    if (!row) return;
    row.querySelector('.upload-item-title').textContent = _uploadItemTitle(item);
    row.querySelector('.upload-item-meta').textContent  = _uploadItemMeta(item);
  }

  function _addFilesToUploadQueue(fileList) {
    let rejected = 0;
    Array.from(fileList).forEach(file => {
      if (!Drive.isAudioFile(file)) { rejected++; return; }
      _uploadItems.push({
        localId: ++_uploadCounter,
        file,
        title:  _filenameToTitle(file.name),
        artist: '',
        album:  '',
        genre:  '',
        status: 'pending', // pending | uploading | done | error
        progress: 0,
        errorMsg: null,
        expanded: false,
      });
    });
    if (rejected) {
      UI.showToast(rejected === 1
        ? '1 arquivo ignorado: não é um áudio suportado.'
        : `${rejected} arquivos ignorados: não são áudios suportados.`);
    }

    // Um arquivo só: já abre pra preencher. Vários: tudo fechado (lista curta)
    // e o "Preencher para todas" resolve o que for comum.
    const pending = _uploadItems.filter(i => i.status === 'pending');
    pending.forEach(i => { i.expanded = pending.length === 1; });
    _renderUploadList();
  }

  async function _uploadOne(item) {
    item.status = 'uploading';
    item.progress = 0;
    item.errorMsg = null;
    _renderUploadList();

    try {
      const track = await Drive.uploadTrack(item.file, {
        title:  item.title.trim()  || _filenameToTitle(item.file.name),
        artist: item.artist.trim() || 'Desconhecido',
        album:  item.album.trim(),
        genre:  item.genre.trim(),
      }, {
        onProgress: (loaded, total) => {
          item.progress = total ? Math.round((loaded / total) * 100) : 0;
          const row = UI.el.uploadList.querySelector(`[data-upload-id="${item.localId}"]`);
          if (!row) return;
          const fill = row.querySelector('.dl-progress-fill');
          const pct  = row.querySelector('.upload-item-pct');
          if (fill) fill.style.width = item.progress + '%';
          if (pct)  pct.textContent = item.progress + '%';
        },
      });

      item.status = 'done';
      _tracks = [..._tracks, track];
      _refreshFilterBar();
      _renderAllTracksList();
      UI.showToast(`"${track.title}" enviada`);
    } catch (err) {
      console.error('[App] Erro ao enviar música:', err);
      item.status = 'error';
      item.errorMsg = err?.message === 'UNAUTHORIZED'
        ? 'Sessão expirada — faça login novamente.'
        : (err?.message || 'Falha ao enviar. Tente novamente.');

      if (err?.message === 'UNAUTHORIZED') {
        Drive.logout();
        UI.showLogin();
      }
    }
    _renderUploadList();
  }

  const UPLOAD_CONCURRENCY = 2;
  let _uploadRunning = false;

  async function _uploadAllPending() {
    if (_uploadRunning) return;
    _uploadRunning = true;
    _updateUploadFooter();

    const pending = () => _uploadItems.filter(i => i.status === 'pending');
    async function worker() {
      let next;
      while ((next = pending()[0])) {
        await _uploadOne(next);
      }
    }
    await Promise.all(Array(UPLOAD_CONCURRENCY).fill(0).map(worker));

    _uploadRunning = false;
    _renderUploadList();
    _updateOfflineSummary();
  }

  // Fecha a sheet de envio (bloqueia enquanto envia) e limpa os concluídos
  function _closeUploadSheet() {
    if (_uploadRunning) {
      UI.showToast('Aguarde o envio terminar antes de fechar.');
      return;
    }
    UI.hideUploadModal();
    _uploadItems = _uploadItems.filter(i => i.status !== 'done');
  }

  function _bindUploadEvents() {
    // "Enviar do aparelho": vai direto pro seletor de arquivos. A sheet
    // abre quando há arquivos escolhidos (ou se sobrou fila de antes).
    UI.el.btnUploadOpen.addEventListener('click', () => {
      if (_uploadItems.length) {
        UI.showUploadModal();
        _renderUploadList();
      } else {
        UI.el.inputUploadFiles.click();
      }
    });

    UI.el.inputUploadFiles.addEventListener('change', e => {
      if (e.target.files?.length) {
        _addFilesToUploadQueue(e.target.files);
        UI.showUploadModal();
      }
      e.target.value = ''; // permite selecionar o mesmo arquivo de novo depois
    });

    UI.el.btnUploadAddMore.addEventListener('click', () => UI.el.inputUploadFiles.click());
    UI.el.btnUploadSendAll.addEventListener('click', () => {
      if (UI.el.btnUploadSendAll.dataset.mode === 'done') _closeUploadSheet();
      else _uploadAllPending();
    });
    UI.el.btnUploadClose.addEventListener('click', _closeUploadSheet);

    // "Preencher para todas": só aplica os campos preenchidos, nas faixas ainda não enviadas
    UI.el.btnUploadBulkToggle.addEventListener('click', () => {
      const collapsed = UI.el.uploadBulk.classList.toggle('collapsed');
      UI.el.btnUploadBulkToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    UI.attachGenreSuggest(UI.el.uploadBulkGenre, UI.el.uploadBulkGenreList, _knownGenres);
    UI.el.btnUploadBulkApply.addEventListener('click', () => {
      const vals = {
        artist: UI.el.uploadBulkArtist.value.trim(),
        album:  UI.el.uploadBulkAlbum.value.trim(),
        genre:  UI.el.uploadBulkGenre.value.trim(),
      };
      if (!vals.artist && !vals.album && !vals.genre) {
        UI.showToast('Preencha artista, álbum ou gênero primeiro.');
        return;
      }
      const targets = _uploadItems.filter(_isActiveUpload);
      targets.forEach(item => {
        Object.entries(vals).forEach(([field, value]) => { if (value) item[field] = value; });
      });
      _renderUploadList();
      UI.el.uploadBulk.classList.add('collapsed');
      UI.el.btnUploadBulkToggle.setAttribute('aria-expanded', 'false');
      UI.showToast(`Aplicado a ${targets.length} faixa${targets.length === 1 ? '' : 's'}`);
    });

    UI.el.uploadList.addEventListener('input', e => {
      const input = e.target.closest('[data-field]');
      if (!input) return;
      const item = _uploadItems.find(i => i.localId === parseInt(input.dataset.id, 10));
      if (!item) return;
      item[input.dataset.field] = input.value;
      _refreshUploadItemHead(item);
    });

    UI.el.uploadList.addEventListener('click', e => {
      if (e.target.closest('[data-pick-files]')) {
        UI.el.inputUploadFiles.click();
        return;
      }

      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const id = parseInt(toggle.dataset.toggle, 10);
        const item = _uploadItems.find(i => i.localId === id);
        if (!item) return;
        const willOpen = !item.expanded;
        // Um aberto por vez: mantém a lista curta no celular
        _uploadItems.forEach(i => { i.expanded = false; });
        item.expanded = willOpen;
        UI.el.uploadList.querySelectorAll('.upload-item').forEach(row => {
          row.classList.toggle('open', willOpen && row.dataset.uploadId === String(id));
        });
        if (willOpen) toggle.closest('.upload-item').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }

      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn) {
        _uploadItems = _uploadItems.filter(i => i.localId !== parseInt(removeBtn.dataset.remove, 10));
        _renderUploadList();
        return;
      }
      const retryBtn = e.target.closest('[data-retry]');
      if (retryBtn) {
        const item = _uploadItems.find(i => i.localId === parseInt(retryBtn.dataset.retry, 10));
        if (item) _uploadOne(item);
      }
    });

    // Botão "Adicionar à biblioteca" no player, só visível pra faixa
    // externa (ver _handleExternalAudioOpen). Reaproveita 100% o modal
    // de upload que já existe: injeta um item pré-preenchido com o que
    // foi lido da tag ID3 e deixa o usuário revisar antes de enviar.
    UI.el.btnAddToLibrary.addEventListener('click', () => {
      const track = Player.getCurrentTrack();
      if (!track || !track.isExternal) return;

      if (!track.__blob) {
        UI.showToast('Não foi possível ler o arquivo pra enviar.');
        return;
      }

      UI.el.btnAddToLibrary.disabled = true; // evita clique duplo enquanto essa faixa tocar

      const ext = _extFromMime(track.__blob.type);
      const baseName = track.__title && track.__title !== 'Música externa' ? track.__title : 'musica';
      const file = new File([track.__blob], `${baseName}.${ext}`, { type: track.__blob.type || 'audio/mpeg' });

      _uploadItems.push({
        localId: ++_uploadCounter,
        file,
        title:  track.__title  || _filenameToTitle(file.name),
        artist: track.__artist || '',
        album:  track.__album  || '',
        genre:  '',
        status: 'pending',
        progress: 0,
        errorMsg: null,
        expanded: true,
      });
      _renderUploadList();
      UI.showUploadModal();
    });
  }

  // ── EDITAR METADADOS DE UMA FAIXA ──────────────
  function _findTrackAnywhere(id) {
    return _tracks.find(t => t.id === id) || Drive.getCachedTracks().find(t => t.id === id);
  }

  function _openEditModal(track) {
    UI.showTrackEditModal(track, _knownGenres());
  }

  // ── EXCLUIR UMA FAIXA DO DRIVE ──────────────────
  async function _deleteTrack(track) {
    const ok = await UI.confirmDialog(
      `O arquivo vai pra lixeira do Drive (fica recuperável por lá), mas some do HappyMusic.`,
      { title: `Excluir "${track.title}"?`, okLabel: 'Excluir' }
    );
    if (!ok) return;

    try {
      await Drive.deleteTrack(track.id);

      _tracks = _tracks.filter(t => t.id !== track.id);

      // Remove a faixa de qualquer playlist que a continha
      let touchedPlaylists = false;
      _playlists.forEach(p => {
        if (p.trackIds.includes(track.id)) {
          p.trackIds = p.trackIds.filter(id => id !== track.id);
          touchedPlaylists = true;
        }
      });

      // Pausa se a faixa excluída era a que estava tocando
      const current = Player.getCurrentTrack();
      if (current && current.id === track.id) Player.pause();

      // Se tinha sido baixada pra ouvir offline, remove do cache também
      if (Downloads.isDownloaded(track.id)) Downloads.removeTrack(track.id);
      UI.refreshDownloadBadges();

      UI.renderPlaylists(_playlists);
      _reRenderCurrentViews();
      _renderRecent();
      UI.showToast('Música excluída — foi pra lixeira do Drive');

      if (touchedPlaylists) await _persistPlaylists();
    } catch (err) {
      console.error('[App] Erro ao excluir música:', err);
      if (err?.message === 'UNAUTHORIZED') {
        Drive.logout();
        UI.showLogin();
        UI.showToast('Sessão expirada. Faça login novamente.');
        return;
      }
      UI.showToast('Não foi possível excluir a música. Tente de novo.');
    }
  }

  function _reRenderCurrentViews() {
    _refreshFilterBar();
    // "home" virou "library" na reforma da navegação — essa checagem
    // ficou presa ao nome antigo e nunca mais disparava.
    if (UI.getCurrentView() === 'library') _renderAllTracksList();
    if (UI.getCurrentView() === 'search' && UI.el.searchInput.value.trim()) {
      _handleSearch(UI.el.searchInput.value);
    }
    if (_activePlaylistId) _renderActivePlaylistTracks();
    // A Home mostra "Tocadas recentemente" com dados que podem ter ficado
    // desatualizados (capa/título/artista) — reconcilia sempre que algo
    // muda, esteja o usuário olhando pra Home agora ou não.
    _renderRecent();
  }

  function _bindEditModalEvents() {
    UI.el.btnEditSave.addEventListener('click', async () => {
      const trackId = UI.el.modalTrackEdit.dataset.trackId;
      if (!trackId) return;
      const form  = UI.getTrackEditForm();
      const track = _findTrackAnywhere(trackId);

      try {
        // A capa é salva à parte (arquivo de imagem próprio no Drive),
        // então processa isso antes/independente dos campos de texto.
        if (track && form.coverAction === 'set' && form.coverFile) {
          await Drive.setCustomCover(track, form.coverFile);
        } else if (track && form.coverAction === 'remove') {
          await Drive.removeCustomCover(track);
        }

        await Drive.updateTrackMetadata(trackId, form);
        const idx = _tracks.findIndex(t => t.id === trackId);
        if (idx !== -1) {
          const fresh = Drive.getCachedTracks().find(t => t.id === trackId) || _tracks[idx];
          // updateTrackMetadata só mexe em título/artista/álbum/gênero — a capa
          // que acabamos de aplicar (ou tirar) fica guardada em `track`, então
          // preserva ela aqui em vez de deixar o objeto "novo" sobrescrever.
          if (track) {
            fresh.thumbnail = track.thumbnail;
            fresh.coverId   = track.coverId;
          }
          _tracks[idx] = fresh;
        }
        UI.hideTrackEditModal();
        UI.showToast('Informações atualizadas');
        _reRenderCurrentViews();
        UI.refreshTrackArt(trackId, track ? track.thumbnail : null);
      } catch (err) {
        console.error('[App] Erro ao editar metadados:', err);
        if (err.message === 'UNAUTHORIZED') {
          Drive.logout();
          UI.showLogin();
          UI.showToast('Sessão expirada. Faça login novamente.');
          return;
        }
        UI.showToast('Não foi possível salvar. Tente novamente.');
      }
    });

    UI.el.btnEditCancel.addEventListener('click', () => UI.hideTrackEditModal());
  }

  // ── PLAYLISTS ───────────────────────────────────
  const FAVORITES_ID = '__favorites__';

  function _playlistTracks(playlist) {
    return playlist.trackIds.map(id => _findTrackAnywhere(id)).filter(Boolean);
  }
  // ui.js usa isso pra montar a capa em colagem da grade de Coleções
  // (renderPlaylists), sem precisar que cada um dos vários lugares que
  // chamam essa função passe as faixas resolvidas manualmente.
  window.HMResolvePlaylistTracks = _playlistTracks;

  async function _loadPlaylists() {
    _playlists = await Drive.loadPlaylists();
    UI.renderPlaylists(_playlists);
    _renderRecentCollections();
  }

  async function _persistPlaylists() {
    const ok = await Drive.savePlaylists(_playlists);
    if (!ok) UI.showToast('Playlist salva neste aparelho — sincronização com o Drive falhou.');
    return ok;
  }

  // ── COLEÇÕES RECENTES (mostradas na Home) ──────
  function _getRecentPlaylistIds() {
    try { return JSON.parse(localStorage.getItem(KEY_RECENT_PLAYLISTS) || '[]'); }
    catch { return []; }
  }

  function _addRecentPlaylist(id) {
    let recent = _getRecentPlaylistIds().filter(pid => pid !== id);
    recent.unshift(id);
    if (recent.length > MAX_RECENT_PLAYLISTS) recent = recent.slice(0, MAX_RECENT_PLAYLISTS);
    localStorage.setItem(KEY_RECENT_PLAYLISTS, JSON.stringify(recent));
  }

  function _renderRecentCollections() {
    const items = _getRecentPlaylistIds().map(id => {
      if (id === FAVORITES_ID) {
        return { id: FAVORITES_ID, name: 'Favoritas', isFavorites: true, tracks: Player.getFavorites().slice(0, 4) };
      }
      const p = _playlists.find(pl => pl.id === id);
      return p ? { id: p.id, name: p.name, isFavorites: false, tracks: _playlistTracks(p).slice(0, 4) } : null;
    }).filter(Boolean).slice(0, 6);
    UI.renderRecentCollections(items);
  }

  function _renderActivePlaylistTracks() {
    if (_activePlaylistId === FAVORITES_ID) {
      UI.renderPlaylistTracks(Player.getFavorites(), _currentId(), true);
      return;
    }
    const playlist = _playlists.find(p => p.id === _activePlaylistId);
    if (!playlist) return;
    UI.renderPlaylistTracks(_playlistTracks(playlist), _currentId());
  }

  // Remove uma faixa da playlist atualmente aberta (via menu de 3 pontinhos).
  // Só é chamada quando uma playlist de verdade está ativa (Favoritas usa
  // o coração pra isso — ver opts.removable em UI.renderPlaylistTracks).
  async function _removeTrackFromActivePlaylist(track) {
    const playlist = _playlists.find(p => p.id === _activePlaylistId);
    if (!playlist) return;
    playlist.trackIds = playlist.trackIds.filter(id => id !== track.id);
    UI.renderPlaylists(_playlists);
    _renderActivePlaylistTracks();
    _renderRecentCollections();
    UI.showToast(`"${track.title}" removida da playlist`);
    await _persistPlaylists();
  }

  function _openPlaylist(id) {
    const playlist = _playlists.find(p => p.id === id);
    if (!playlist) return;
    _activePlaylistId = id;
    UI.showPlaylistDetail(playlist);
    _renderActivePlaylistTracks();
    _addRecentPlaylist(id);
    _renderRecentCollections();
  }

  function _openFavoritesView() {
    _activePlaylistId = FAVORITES_ID;
    UI.showPlaylistDetail({ id: FAVORITES_ID, name: 'Favoritas' }, { isFavorites: true });
    _renderActivePlaylistTracks();
    _addRecentPlaylist(FAVORITES_ID);
    _renderRecentCollections();
  }

  function _bindPlaylistEvents() {
    UI.el.btnNewPlaylist.addEventListener('click', () => UI.showNewPlaylistModal());

    UI.el.btnNewPlaylistCreate.addEventListener('click', async () => {
      const name = UI.el.newPlaylistName.value.trim();
      if (!name) { UI.showToast('Dê um nome pra playlist.'); return; }

      const playlist = { id: _uuid(), name, trackIds: [], createdAt: Date.now() };
      _playlists = [..._playlists, playlist];
      UI.renderPlaylists(_playlists);
      UI.hideNewPlaylistModal();
      UI.showToast(`Playlist "${name}" criada`);
      await _persistPlaylists();
    });

    UI.el.btnNewPlaylistCancel.addEventListener('click', () => UI.hideNewPlaylistModal());

    UI.el.playlistsList.addEventListener('click', e => {
      const card = e.target.closest('.playlist-card');
      if (!card) return;
      if (card.dataset.id === FAVORITES_ID) _openFavoritesView();
      else _openPlaylist(card.dataset.id);
    });

    UI.el.recentCollectionsList.addEventListener('click', e => {
      const chip = e.target.closest('.recent-collection-chip');
      if (!chip) return;

      if (chip.dataset.id === FAVORITES_ID) {
        UI.showCollectionPreview('Favoritas', Player.getFavorites(), _currentId());
        return;
      }
      const playlist = _playlists.find(p => p.id === chip.dataset.id);
      if (!playlist) return;
      UI.showCollectionPreview(playlist.name, _playlistTracks(playlist), _currentId());
    });

    UI.el.collectionPreviewList.addEventListener('click', e => {
      // Botão de menu (3 pontinhos) e de download ficam DENTRO da linha
      // (.track-item), então um toque neles também "conta" como toque na
      // linha — sem esse filtro, o modal fechava por baixo do menu antes
      // dele terminar de abrir, e o menu perdia a referência de posição
      // (o botão já não existia mais na tela), abrindo lá no canto
      // superior esquerdo em vez de perto do dedo.
      if (e.target.closest('[data-menu], [data-dl]')) return;
      if (e.target.closest('.track-item')) UI.hideCollectionPreview();
    });

    UI.el.btnPlaylistBack.addEventListener('click', () => {
      _activePlaylistId = null;
      UI.showPlaylistsRoot();
    });

    UI.el.btnPlaylistDelete.addEventListener('click', async () => {
      if (_activePlaylistId === FAVORITES_ID) return;
      const playlist = _playlists.find(p => p.id === _activePlaylistId);
      if (!playlist) return;
      const ok = await UI.confirmDialog(
        'Isso não apaga as músicas, só a playlist.',
        { title: `Excluir "${playlist.name}"?`, okLabel: 'Excluir' }
      );
      if (!ok) return;

      _playlists = _playlists.filter(p => p.id !== playlist.id);
      _activePlaylistId = null;
      UI.showPlaylistsRoot();
      UI.renderPlaylists(_playlists);
      localStorage.setItem(KEY_RECENT_PLAYLISTS, JSON.stringify(_getRecentPlaylistIds().filter(id => id !== playlist.id)));
      _renderRecentCollections();
      UI.showToast('Playlist excluída');
      await _persistPlaylists();
    });

    UI.el.btnPlaylistPlay.addEventListener('click', () => {
      const tracks = _activePlaylistId === FAVORITES_ID
        ? Player.getFavorites()
        : _playlistTracks(_playlists.find(p => p.id === _activePlaylistId) || { trackIds: [] });
      if (!tracks.length) { UI.showToast('Essa playlist ainda está vazia.'); return; }
      // Botão "tocar a lista": sem internet, começa pela primeira música
      // baixada em vez de recusar (o usuário não escolheu uma faixa específica).
      // loop: true — ao acabar a playlist, continua tocando ela mesma
      // (dá a volta), em vez de entrar no modo rádio com músicas de fora.
      Player.loadQueue(tracks, 0, { skipUnavailable: true, loop: true });
    });

    // Mantém a tela de Favoritas (se aberta) e a contagem no card sincronizadas
    // sempre que uma faixa é favoritada/desfavoritada de qualquer lugar do app.
    document.addEventListener('hm-favorite-change', () => {
      if (_activePlaylistId === FAVORITES_ID) _renderActivePlaylistTracks();
      UI.renderPlaylists(_playlists);
    });
  }

  let _pickerSelectedIds = new Set();

  // Filtros do seletor "Adicionar músicas" — independentes dos filtros da
  // Biblioteca (mexer aqui não muda a lista lá, e vice-versa).
  let _pickerFilters = { genre: [], artist: [] };
  let _pickerShown = [];   // o que está aparecendo na lista agora (busca + filtros)

  function _pickerVisibleTracks() {
    const q = UI.el.addTracksPickerSearch.value.trim().toLowerCase();
    const list = Drive.filterTracks(_pickerFilters);
    return q
      ? list.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
      : list;
  }

  function _updateAddTracksToolbar() {
    UI.setAddTracksPickerToolbar?.({
      shown: _pickerShown.length,
      total: Drive.getCachedTracks().length,
      genres: _pickerFilters.genre,
      artists: _pickerFilters.artist,
      allShownSelected: _pickerShown.length > 0 && _pickerShown.every(t => _pickerSelectedIds.has(t.id)),
      selectedCount: _pickerSelectedIds.size,
    });
  }

  function _refreshAddTracksPicker() {
    _pickerShown = _pickerVisibleTracks();
    UI.renderAddTracksPicker(_pickerShown, _pickerSelectedIds);
    _updateAddTracksToolbar();
  }

  // Opções de um filtro com a contagem de músicas de cada uma, levando em
  // conta o OUTRO filtro (escolheu o gênero Rock → em Artista só aparecem
  // artistas de Rock). Valores já selecionados ficam sempre na lista, pra
  // dar pra desmarcar mesmo que o outro filtro os tenha zerado.
  function _pickerFilterOptions(type) {
    const other = type === 'genre' ? { artist: _pickerFilters.artist } : { genre: _pickerFilters.genre };
    const counts = new Map();
    Drive.filterTracks(other).forEach(t => {
      const v = t[type];
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    });
    _pickerFilters[type].forEach(v => { if (!counts.has(v)) counts.set(v, 0); });
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([value, n]) => ({ value, label: `${value} · ${n}` }));
  }

  function _openAddTracksPicker() {
    if (_activePlaylistId === FAVORITES_ID) return;
    const playlist = _playlists.find(p => p.id === _activePlaylistId);
    if (!playlist) return;
    _pickerSelectedIds = new Set(playlist.trackIds);
    _pickerFilters = { genre: [], artist: [] };
    UI.showAddTracksPickerModal(Drive.getCachedTracks(), _pickerSelectedIds);
    _refreshAddTracksPicker();
  }

  function _bindAddTracksPickerEvents() {
    UI.el.btnPlaylistAddTracks.addEventListener('click', () => _openAddTracksPicker());
    UI.el.btnAddTracksPickerClose.addEventListener('click', () => UI.hideAddTracksPickerModal());

    UI.el.addTracksPickerSearch.addEventListener('input', () => _refreshAddTracksPicker());

    [['genre', UI.el.addPickerChipGenre], ['artist', UI.el.addPickerChipArtist]].forEach(([type, chip]) => {
      chip?.addEventListener('click', () => {
        UI.showFilterPicker(type, _pickerFilters[type], values => {
          _pickerFilters[type] = values;
          _refreshAddTracksPicker();
        }, { multi: true, options: _pickerFilterOptions(type) });
      });
    });

    UI.el.btnAddTracksClearFilters?.addEventListener('click', () => {
      _pickerFilters = { genre: [], artist: [] };
      _refreshAddTracksPicker();
    });

    // Marca (ou desmarca) tudo o que está aparecendo — o atalho pra quando
    // o filtro já isolou o que a pessoa quer (ex.: todas do artista X).
    UI.el.btnAddTracksSelectAll?.addEventListener('click', () => {
      const allSelected = _pickerShown.length > 0 && _pickerShown.every(t => _pickerSelectedIds.has(t.id));
      _pickerShown.forEach(t => allSelected ? _pickerSelectedIds.delete(t.id) : _pickerSelectedIds.add(t.id));
      UI.renderAddTracksPicker(_pickerShown, _pickerSelectedIds);
      _updateAddTracksToolbar();
    });

    UI.el.addTracksPickerList.addEventListener('click', e => {
      const item = e.target.closest('.track-picker-item');
      if (!item) return;
      const id = item.dataset.id;
      if (_pickerSelectedIds.has(id)) _pickerSelectedIds.delete(id);
      else _pickerSelectedIds.add(id);
      item.classList.toggle('selected');
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = item.classList.contains('selected');
      _updateAddTracksToolbar();
    });

    UI.el.btnAddTracksPickerConfirm.addEventListener('click', async () => {
      const playlist = _playlists.find(p => p.id === _activePlaylistId);
      if (!playlist) { UI.hideAddTracksPickerModal(); return; }
      playlist.trackIds = [..._pickerSelectedIds];
      // Fecha primeiro e protege o redesenho: um erro ao desenhar a tela
      // nunca pode deixar o "Concluir" travado sem fechar nem salvar.
      UI.hideAddTracksPickerModal();
      try {
        UI.renderPlaylists(_playlists);
        _renderActivePlaylistTracks();
      } catch (err) {
        console.error('[App] Falha ao redesenhar a playlist:', err);
      }
      UI.showToast('Playlist atualizada');
      await _persistPlaylists();
    });
  }

  function _openAddToPlaylistModal(track) {
    UI.showAddToPlaylistModal(_playlists, [track.id]);
  }

  function _closeAddToPlaylistModal() {
    UI.hideAddToPlaylistModal();
    if (UI.isSelectMode(UI.el.allTracksList)) _exitSelectMode();
  }

  function _bindAddToPlaylistModalEvents() {
    UI.el.addToPlaylistList.addEventListener('click', async e => {
      const item = e.target.closest('.playlist-pick-item');
      if (!item) return;
      const trackIds = JSON.parse(UI.el.modalAddToPlaylist.dataset.trackIds || '[]');
      const playlist = _playlists.find(p => p.id === item.dataset.id);
      if (!playlist || !trackIds.length) return;

      const allIn = trackIds.every(id => playlist.trackIds.includes(id));
      if (allIn) {
        playlist.trackIds = playlist.trackIds.filter(id => !trackIds.includes(id));
      } else {
        const set = new Set(playlist.trackIds);
        trackIds.forEach(id => set.add(id));
        playlist.trackIds = [...set];
      }

      UI.showAddToPlaylistModal(_playlists, trackIds); // re-renderiza com o novo estado
      UI.renderPlaylists(_playlists);
      if (_activePlaylistId === playlist.id) _renderActivePlaylistTracks();
      await _persistPlaylists();
    });

    UI.el.btnAddToPlaylistCreate.addEventListener('click', async () => {
      const name = UI.el.addToPlaylistNewName.value.trim();
      const trackIds = JSON.parse(UI.el.modalAddToPlaylist.dataset.trackIds || '[]');
      if (!name || !trackIds.length) { UI.showToast('Dê um nome pra playlist.'); return; }

      const playlist = { id: _uuid(), name, trackIds: [...trackIds], createdAt: Date.now() };
      _playlists = [..._playlists, playlist];
      UI.showAddToPlaylistModal(_playlists, trackIds);
      UI.renderPlaylists(_playlists);
      UI.showToast(trackIds.length > 1
        ? `Playlist "${name}" criada com ${trackIds.length} músicas`
        : `Playlist "${name}" criada e música adicionada`);
      await _persistPlaylists();
    });

    UI.el.btnAddToPlaylistClose.addEventListener('click', () => _closeAddToPlaylistModal());
  }

  // ── VÍDEOS ──────────────────────────────────────
  function _knownMovieGenres() {
    const known = Drive.getKnownMovieGenres();
    return [...new Set([...DEFAULT_MOVIE_GENRES, ...known])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async function _loadMovies() {
    try {
      _videos = await Drive.loadVideos();
      _refreshMovieFilterBar();
      _refreshMovieCollectionOptions();
      _renderMovieGrid();
    } catch (err) {
      console.error('[App] Erro ao carregar vídeos:', err);
      if (err?.message === 'UNAUTHORIZED') { Drive.logout(); UI.showLogin(); }
    }
  }

  // Combina a coleção ativa (todos / favoritos / uma playlist) com o
  // filtro de gênero — os dois se aplicam juntos.
  function _visibleMovies() {
    let list;
    if (_movieCollection === MOVIE_FAVORITES_ID) {
      list = _getFavoriteVideos();
    } else if (_movieCollection && _movieCollection !== '__all__') {
      const playlist = _moviePlaylists.find(p => p.id === _movieCollection);
      list = playlist ? _moviePlaylistVideos(playlist) : _videos;
    } else {
      list = _videos;
    }
    return _movieFilterGenre ? list.filter(v => v.genre === _movieFilterGenre) : list;
  }

  function _renderMovieGrid() {
    UI.renderMovieGrid(_visibleMovies());
    UI.bindMovieGridEvents(UI.el.movieGrid, _visibleMovies());
  }

  function _refreshMovieFilterBar() {
    UI.renderMovieFilterOptions(Drive.getKnownMovieGenres(), _movieFilterGenre);
  }

  function _bindMovieFilterEvents() {
    UI.el.btnMovieFilterMenu.addEventListener('click', () => {
      UI.showFilterPicker('moviegenre', _movieFilterGenre, value => {
        _movieFilterGenre = value;
        _refreshMovieFilterBar();
        _renderMovieGrid();
      });
    });
    UI.el.btnMovieRefresh.addEventListener('click', () => _loadMovies());
  }

  // ── FAVORITOS DE VÍDEO ──────────────────────────
  function _saveVideoFavorites() {
    localStorage.setItem(KEY_VIDEO_FAVORITES, JSON.stringify([..._videoFavorites]));
  }
  function _isVideoFavorite(id) { return _videoFavorites.has(id); }
  function _toggleVideoFavorite(id) {
    if (_videoFavorites.has(id)) _videoFavorites.delete(id);
    else _videoFavorites.add(id);
    _saveVideoFavorites();
    return _videoFavorites.has(id);
  }
  function _getFavoriteVideos() {
    return _videos.filter(v => _videoFavorites.has(v.id));
  }

  function _toggleMovieFavoriteFromMenu(video) {
    const fav = _toggleVideoFavorite(video.id);
    UI.showToast(fav ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
    if (_currentMovieId === video.id) UI.setMovieFavoriteState(fav);
    document.dispatchEvent(new CustomEvent('hm-video-favorite-change'));
  }

  // ── PLAYLISTS DE VÍDEO (Coleções) ───────────────
  function _moviePlaylistVideos(playlist) {
    return playlist.videoIds.map(id => _videos.find(v => v.id === id)).filter(Boolean);
  }

  async function _loadMoviePlaylists() {
    _moviePlaylists = await Drive.loadMoviePlaylists();
    _refreshMovieCollectionOptions();
  }

  async function _persistMoviePlaylists() {
    const ok = await Drive.saveMoviePlaylists(_moviePlaylists);
    if (!ok) UI.showToast('Playlist de vídeo salva neste aparelho — sincronização com o Drive falhou.');
    return ok;
  }

  function _refreshMovieCollectionOptions() {
    UI.renderMovieCollectionOptions(_moviePlaylists, _movieCollection, _getFavoriteVideos().length);
  }

  function _openAddVideoToPlaylistModal(video) {
    UI.showAddVideoToPlaylistModal(_moviePlaylists, [video.id]);
  }

  function _bindMovieCollectionEvents() {
    UI.el.filterChipMovieCollection.addEventListener('click', () => {
      UI.showFilterPicker('moviecollection', _movieCollection, value => {
        _movieCollection = value || '__all__';
        _refreshMovieCollectionOptions();
        _renderMovieGrid();
      });
    });

    UI.el.btnMovieNewPlaylist.addEventListener('click', () => UI.showNewMoviePlaylistModal());

    UI.el.btnNewMoviePlaylistCreate.addEventListener('click', async () => {
      const name = UI.el.newMoviePlaylistName.value.trim();
      if (!name) { UI.showToast('Dê um nome pra playlist.'); return; }

      const playlist = { id: _uuid(), name, videoIds: [], createdAt: Date.now() };
      _moviePlaylists = [..._moviePlaylists, playlist];
      _movieCollection = playlist.id;
      UI.hideNewMoviePlaylistModal();
      UI.showToast(`Playlist "${name}" criada`);
      _refreshMovieCollectionOptions();
      _renderMovieGrid();
      await _persistMoviePlaylists();
    });
    UI.el.btnNewMoviePlaylistCancel.addEventListener('click', () => UI.hideNewMoviePlaylistModal());
    UI.el.modalNewMoviePlaylist.addEventListener('click', e => {
      if (e.target === UI.el.modalNewMoviePlaylist) UI.hideNewMoviePlaylistModal();
    });

    UI.el.btnMovieCollectionDelete.addEventListener('click', async () => {
      const playlist = _moviePlaylists.find(p => p.id === _movieCollection);
      if (!playlist) return;
      const ok = await UI.confirmDialog(
        'Isso não apaga os vídeos, só a playlist.',
        { title: `Excluir "${playlist.name}"?`, okLabel: 'Excluir' }
      );
      if (!ok) return;

      _moviePlaylists = _moviePlaylists.filter(p => p.id !== playlist.id);
      _movieCollection = '__all__';
      _refreshMovieCollectionOptions();
      _renderMovieGrid();
      UI.showToast('Playlist excluída');
      await _persistMoviePlaylists();
    });

    // Mantém a contagem de favoritos e a lista (se aberta) sincronizadas
    // sempre que um vídeo é favoritado/desfavoritado de qualquer lugar.
    document.addEventListener('hm-video-favorite-change', () => {
      _refreshMovieCollectionOptions();
      if (_movieCollection === MOVIE_FAVORITES_ID) _renderMovieGrid();
    });
  }

  function _bindAddVideoToPlaylistModalEvents() {
    UI.el.addVideoToPlaylistList.addEventListener('click', async e => {
      const item = e.target.closest('.playlist-pick-item');
      if (!item) return;
      const videoIds = JSON.parse(UI.el.modalAddVideoToPlaylist.dataset.videoIds || '[]');
      const playlist = _moviePlaylists.find(p => p.id === item.dataset.id);
      if (!playlist || !videoIds.length) return;

      const allIn = videoIds.every(id => playlist.videoIds.includes(id));
      if (allIn) {
        playlist.videoIds = playlist.videoIds.filter(id => !videoIds.includes(id));
      } else {
        const set = new Set(playlist.videoIds);
        videoIds.forEach(id => set.add(id));
        playlist.videoIds = [...set];
      }

      UI.showAddVideoToPlaylistModal(_moviePlaylists, videoIds); // re-renderiza com o novo estado
      _refreshMovieCollectionOptions();
      if (_movieCollection === playlist.id) _renderMovieGrid();
      await _persistMoviePlaylists();
    });

    UI.el.btnAddVideoToPlaylistCreate.addEventListener('click', async () => {
      const name = UI.el.addVideoToPlaylistNewName.value.trim();
      const videoIds = JSON.parse(UI.el.modalAddVideoToPlaylist.dataset.videoIds || '[]');
      if (!name || !videoIds.length) { UI.showToast('Dê um nome pra playlist.'); return; }

      const playlist = { id: _uuid(), name, videoIds: [...videoIds], createdAt: Date.now() };
      _moviePlaylists = [..._moviePlaylists, playlist];
      UI.showAddVideoToPlaylistModal(_moviePlaylists, videoIds);
      _refreshMovieCollectionOptions();
      UI.showToast(videoIds.length > 1
        ? `Playlist "${name}" criada com ${videoIds.length} vídeos`
        : `Playlist "${name}" criada e vídeo adicionado`);
      await _persistMoviePlaylists();
    });

    UI.el.btnAddVideoToPlaylistClose.addEventListener('click', () => UI.hideAddVideoToPlaylistModal());
    UI.el.modalAddVideoToPlaylist.addEventListener('click', e => {
      if (e.target === UI.el.modalAddVideoToPlaylist) UI.hideAddVideoToPlaylistModal();
    });
  }

  // ── ADICIONAR VÍDEO (link do YouTube) ──────────
  function _openMovieAddModal() {
    UI.showMovieAddModal(_knownMovieGenres());
  }

  async function _submitMovieAdd() {
    const form = UI.getMovieAddForm();
    if (!form.url.trim()) { UI.showToast('Cole o link do vídeo.'); return; }

    UI.setMovieAddSaving(true);
    try {
      const video = await Drive.addVideo({ url: form.url.trim(), genre: form.genre.trim() });
      _videos = [video, ..._videos];
      _refreshMovieFilterBar();
      _renderMovieGrid();
      UI.hideMovieAddModal();
      UI.showToast(`"${video.title}" adicionado`);
    } catch (err) {
      console.error('[App] Erro ao adicionar vídeo:', err);
      if (err?.message === 'UNAUTHORIZED') {
        Drive.logout();
        UI.showLogin();
        UI.showToast('Sessão expirada. Faça login novamente.');
        return;
      }
      UI.showToast(err?.message || 'Não foi possível adicionar esse vídeo.');
    } finally {
      UI.setMovieAddSaving(false);
    }
  }

  function _bindMovieAddEvents() {
    UI.el.btnMovieUploadOpen.addEventListener('click', () => _openMovieAddModal());
    UI.el.btnMovieAddSave.addEventListener('click', () => _submitMovieAdd());
    UI.el.btnUploadMovieClose.addEventListener('click', () => UI.hideMovieAddModal());
    UI.el.modalUploadMovie.addEventListener('click', e => {
      if (e.target === UI.el.modalUploadMovie) UI.hideMovieAddModal();
    });

    UI.el.btnMovieSearch.addEventListener('click', () => _runMovieSearch());
    UI.el.movieSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _runMovieSearch(); }
    });
    UI.el.movieSearchResults.addEventListener('click', e => {
      const item = e.target.closest('.yt-search-result');
      if (!item) return;
      UI.showMoviePreview(item.dataset.videoId, item.dataset.videoTitle);
    });
    UI.el.btnMoviePreviewBack.addEventListener('click', () => UI.backFromMoviePreview());
    UI.el.btnMoviePreviewUse.addEventListener('click', () => UI.confirmMoviePreview());
  }

  // ── PESQUISAR VÍDEOS NO YOUTUBE ──────────────────
  // Busca só dispara com Enter ou clique no botão (não a cada tecla) —
  // cada busca consome cota da API do YouTube, então evita gastar cota
  // à toa enquanto a pessoa ainda está digitando.
  let _movieSearchInFlight = false;

  async function _runMovieSearch() {
    const q = UI.el.movieSearchInput.value.trim();
    if (!q) { UI.hideMovieSearchResults(); return; }
    if (_movieSearchInFlight) return;

    _movieSearchInFlight = true;
    UI.setMovieSearchLoading(true);
    try {
      const apiBase = window.NativeApiBase || '';
      const res = await fetch(`${apiBase}/api/youtube-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error_description || 'Não foi possível pesquisar agora.');
      UI.renderMovieSearchResults(data.results || []);
    } catch (err) {
      console.error('[App] Erro ao pesquisar no YouTube:', err);
      UI.showMovieSearchError(err?.message || 'Não foi possível pesquisar agora.');
    } finally {
      _movieSearchInFlight = false;
      UI.setMovieSearchLoading(false);
    }
  }

  // ── EXCLUIR VÍDEO DO CATÁLOGO ───────────────────
  async function _deleteMovie(video) {
    try {
      await Drive.deleteVideo(video.id);
      _videos = _videos.filter(v => v.id !== video.id);
      _refreshMovieFilterBar();
      _renderMovieGrid();
      UI.showToast('Vídeo removido da lista');
    } catch (err) {
      console.error('[App] Erro ao remover vídeo:', err);
      UI.showToast('Não foi possível remover. Tente novamente.');
    }
  }

  // ── EDITAR INFORMAÇÕES DE UM VÍDEO ─────────────
  function _openMovieEditModal(video) {
    UI.showMovieEditModal(video, _knownMovieGenres());
  }

  function _bindMovieEditModalEvents() {
    UI.el.btnMovieEditSave.addEventListener('click', async () => {
      const videoId = UI.el.modalMovieEdit.dataset.videoId;
      if (!videoId) return;
      const form = UI.getMovieEditForm();

      try {
        const updated = await Drive.updateVideoMetadata(videoId, form);
        const idx = _videos.findIndex(v => v.id === videoId);
        if (idx !== -1) _videos[idx] = updated;
        UI.hideMovieEditModal();
        UI.showToast('Informações atualizadas');
        _refreshMovieFilterBar();
        _renderMovieGrid();
      } catch (err) {
        console.error('[App] Erro ao editar vídeo:', err);
        if (err?.message === 'UNAUTHORIZED') {
          Drive.logout();
          UI.showLogin();
          UI.showToast('Sessão expirada. Faça login novamente.');
          return;
        }
        UI.showToast('Não foi possível salvar. Tente novamente.');
      }
    });

    UI.el.btnMovieEditCancel.addEventListener('click', () => UI.hideMovieEditModal());
    UI.el.modalMovieEdit.addEventListener('click', e => {
      if (e.target === UI.el.modalMovieEdit) UI.hideMovieEditModal();
    });

    UI.el.btnMovieEditDelete.addEventListener('click', () => {
      const videoId = UI.el.modalMovieEdit.dataset.videoId;
      const video = _videos.find(v => v.id === videoId);
      if (!video) return;
      UI.hideMovieEditModal();
      _deleteMovie(video);
    });
  }

  // ── PLAYER DE VÍDEO (tela cheia) ────────────────
  // O vídeo em si é tocado pelo player embutido do YouTube (YTPlayer) —
  // sem token de acesso pra renovar, sem stream próprio pra manter vivo.
  let _moviePlayerBound = false;
  let _currentMovieId   = null;
  let _movieQueue       = [];    // ordem de reprodução atual (com ou sem shuffle)
  let _movieQueueIndex  = -1;
  let _movieShuffle     = false;
  let _movieRepeat      = 'none'; // 'none' | 'all' | 'one' — mesmo ciclo do player de música

  // Controla se empilhamos uma entrada no histórico do navegador ao abrir
  // o player — usado pra fazer o botão físico "voltar" do Android fechar
  // o vídeo em vez de sair do app (ver _openMoviePlayerFor/_closeMoviePlayer).
  let _movieHistoryPushed = false;

  function _bindMovieCustomControls() {
    if (_moviePlayerBound) return;
    _moviePlayerBound = true;

    YTPlayer.on('onStateChange', playing => UI.setMoviePlayState(playing));
    YTPlayer.on('onProgress', (current, duration) => UI.updateMovieProgress(current, duration));
    YTPlayer.on('onEnded', () => _movieNext());

    UI.el.btnMoviePlayPause.addEventListener('click', () => YTPlayer.togglePlay());
    UI.el.movieSeekBar.addEventListener('input', () => {
      YTPlayer.seekPercent(parseFloat(UI.el.movieSeekBar.value));
    });

    UI.el.btnMovieNext.addEventListener('click', () => _movieNext());
    UI.el.btnMoviePrev.addEventListener('click', () => _moviePrev());

    UI.el.btnMovieShuffle.addEventListener('click', () => {
      const active = _toggleMovieShuffle();
      UI.setMovieShuffleState(active);
      UI.showToast(active ? 'Aleatório ativado' : 'Aleatório desativado');
    });

    UI.el.btnMovieRepeat.addEventListener('click', () => {
      const mode = _cycleMovieRepeat();
      UI.setMovieRepeatState(mode);
      const labels = { none: 'Repetir desativado', all: 'Repetir tudo', one: 'Repetir um vídeo' };
      UI.showToast(labels[mode]);
    });
  }

  // Fisher-Yates, igual ao usado no player de música — fixa o vídeo de
  // início na 1ª posição e embaralha o resto.
  function _shuffledMovies(list, pinIndex) {
    const pin  = list[pinIndex];
    const rest = list.filter((_, i) => i !== pinIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return pin ? [pin, ...rest] : rest;
  }

  // Monta a fila de reprodução a partir da lista visível (respeitando
  // o filtro de gênero ativo), começando pelo vídeo escolhido.
  function _buildMovieQueue(startVideo) {
    const base = _visibleMovies();
    if (_movieShuffle) {
      const pinIdx = base.findIndex(v => v.id === startVideo.id);
      _movieQueue = _shuffledMovies(base, pinIdx === -1 ? 0 : pinIdx);
      _movieQueueIndex = 0;
    } else {
      _movieQueue = [...base];
      _movieQueueIndex = _movieQueue.findIndex(v => v.id === startVideo.id);
      if (_movieQueueIndex === -1) _movieQueueIndex = 0;
    }
  }

  function _toggleMovieShuffle() {
    _movieShuffle = !_movieShuffle;
    const current = _movieQueue[_movieQueueIndex];

    if (_movieShuffle) {
      const base = _visibleMovies();
      const pinIdx = current ? base.findIndex(v => v.id === current.id) : 0;
      _movieQueue = _shuffledMovies(base, pinIdx === -1 ? 0 : pinIdx);
      _movieQueueIndex = 0;
    } else {
      _movieQueue = _visibleMovies();
      _movieQueueIndex = current ? _movieQueue.findIndex(v => v.id === current.id) : 0;
      if (_movieQueueIndex === -1) _movieQueueIndex = 0;
    }
    return _movieShuffle;
  }

  function _cycleMovieRepeat() {
    const cycle = { none: 'all', all: 'one', one: 'none' };
    _movieRepeat = cycle[_movieRepeat];
    return _movieRepeat;
  }

  async function _openMoviePlayerFor(video, { rebuildQueue = true } = {}) {
    // Pausa o player de música antes de abrir o vídeo — sem isso, o áudio
    // da música e o áudio do vídeo do YouTube tocam ao mesmo tempo.
    Player.pause();

    if (rebuildQueue) _buildMovieQueue(video);
    _currentMovieId = video.id;

    // Empilha uma entrada de histórico só na primeira abertura (não a
    // cada troca de vídeo dentro do player) — é o que faz o botão físico
    // "voltar" do Android fechar o player em vez de sair pra tela de
    // login/permissões do Google (ver _closeMoviePlayer e o listener de
    // 'popstate' em _bindMoviePlayerEvents).
    if (UI.el.moviePlayerOverlay.classList.contains('hidden')) {
      history.pushState({ hmOverlay: 'movie-player' }, '');
      _movieHistoryPushed = true;
    }

    UI.openMoviePlayer(video.title);
    UI.setMovieFavoriteState(_isVideoFavorite(video.id));
    _bindMovieCustomControls();

    // Só o carregamento em si conta como falha de verdade — passos
    // depois disso (Media Session) são cosméticos e não devem acionar
    // essa mensagem mesmo se falharem (é isso que causava o aviso de
    // erro aparecer com o vídeo já tocando normalmente).
    try {
      await YTPlayer.load(video.id, 'movie-video-target');
    } catch (err) {
      console.error('[App] Erro ao abrir vídeo:', err);
      UI.showToast('Não foi possível abrir o vídeo. Tente novamente.');
      return;
    }

    YTPlayer.setMediaSessionMetadata(video);
  }

  function _playCurrentQueueMovie() {
    const video = _movieQueue[_movieQueueIndex];
    if (video) _openMoviePlayerFor(video, { rebuildQueue: false });
  }

  // A fila de vídeos nunca "acaba" de verdade — mesmo com repetir
  // desligado, ao chegar no fim ela volta pro começo. "Repetir um"
  // é a única opção que muda o comportamento de verdade (fica no
  // mesmo vídeo em vez de avançar).
  function _movieNext() {
    if (!_movieQueue.length) return;
    if (_movieRepeat === 'one') {
      YTPlayer.seekTo(0);
      YTPlayer.play();
      return;
    }
    _movieQueueIndex = (_movieQueueIndex + 1) % _movieQueue.length;
    _playCurrentQueueMovie();
  }

  function _moviePrev() {
    if (!_movieQueue.length) return;
    // Como no player de música: se já passou de alguns segundos,
    // reinicia o vídeo atual em vez de voltar pro anterior.
    if (YTPlayer.getCurrentTime() > 3) {
      YTPlayer.seekTo(0);
      return;
    }
    _movieQueueIndex = (_movieQueueIndex - 1 + _movieQueue.length) % _movieQueue.length;
    _playCurrentQueueMovie();
  }

  // `fromPopState`: true quando chamado em reação ao botão físico/gesto
  // de voltar do Android (o histórico já foi consumido pelo navegador,
  // então aqui só cuidamos de fechar a tela — nada de mexer no histórico
  // de novo, ou entraríamos num loop).
  function _closeMoviePlayer({ fromPopState = false } = {}) {
    YTPlayer.stop();
    UI.closeMoviePlayer();
    if (_movieHistoryPushed) {
      _movieHistoryPushed = false;
      // Fechado pelo X ou Esc: "consome" a entrada de histórico que
      // empilhamos ao abrir, senão o botão voltar precisaria de dois
      // toques (um pra "nada", depois o de verdade).
      if (!fromPopState) history.back();
    }
  }

  function _bindMoviePlayerEvents() {
    UI.el.btnMovieClose.addEventListener('click', () => _closeMoviePlayer());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !UI.el.moviePlayerOverlay.classList.contains('hidden')) _closeMoviePlayer();
    });

    // Botão físico "voltar" / gesto de voltar do Android: se o player de
    // vídeo estiver aberto, fecha ele em vez de deixar o navegador voltar
    // no histórico (o que levava de volta pra tela de permissões do login
    // do Google).
    window.addEventListener('popstate', () => {
      if (!UI.el.moviePlayerOverlay.classList.contains('hidden')) {
        _closeMoviePlayer({ fromPopState: true });
      }
    });

    UI.el.btnMovieFavorite.addEventListener('click', () => {
      if (!_currentMovieId) return;
      const fav = _toggleVideoFavorite(_currentMovieId);
      UI.setMovieFavoriteState(fav);
      UI.showToast(fav ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
      document.dispatchEvent(new CustomEvent('hm-video-favorite-change'));
    });

    UI.setMovieMenuHandlers({
      onEdit: video => _openMovieEditModal(video),
      onPlay: video => _openMoviePlayerFor(video),
      onFavorite: video => _toggleMovieFavoriteFromMenu(video),
      onAddToPlaylist: video => _openAddVideoToPlaylistModal(video),
    });
    UI.setIsVideoFavoriteFn(id => _isVideoFavorite(id));
  }

  // ── BUSCA ─────────────────────────────────────
  function _handleSearch(query) {
    const q = query.trim();

    if (!q) {
      UI.el.searchResults.innerHTML = `
        <p class="empty-hint">Digite para buscar músicas.</p>`;
      return;
    }

    const results = Drive.searchTracks(q);

    if (!results.length) {
      UI.el.searchResults.innerHTML = `
        <p class="empty-hint">Nenhum resultado para "<strong>${q}</strong>".</p>`;
      return;
    }

    UI.renderTrackList(UI.el.searchResults, results, _currentId());
    UI.bindTrackListEvents(UI.el.searchResults, results);
  }

  // Busca não fecha/navega mais ao tocar num resultado — a busca agora é
  // uma aba fixa (igual Spotify/Apple Music), não um overlay que precisa
  // fechar. Tocar num resultado só toca a música e continua na Busca.
  function _bindSearchResultsClose() { /* nada a fazer — mantido só pra não quebrar a chamada abaixo */ }

  // ── SELEÇÃO DE PASTA ───────────────────────────
  async function _openFolderSheet() {
    UI.showFolderModal();
    UI.showFolderLoading();
    try {
      const folders = await Drive.listFolders();
      UI.renderFolderList(folders, Drive.getFolderId());
    } catch (err) {
      console.error('[App] Erro ao listar pastas:', err);
      UI.renderFolderError(_openFolderSheet);
    }
  }

  // Um único listener na lista (delegação): o nome da pasta vem do próprio
  // item tocado, então continua certo mesmo se a lista for recarregada.
  function _bindFolderListClick() {
    UI.el.folderList.addEventListener('click', async e => {
      const item = e.target.closest('.folder-item');
      if (!item) return;

      const id = item.dataset.id || null;
      const name = id ? (item.dataset.name || null) : null;

      // Tocou na pasta que já está ativa: só fecha
      if ((id || null) === (Drive.getFolderId() || null)) {
        UI.hideFolderModal();
        return;
      }

      Drive.setFolderId(id);
      if (name) {
        localStorage.setItem('hm_folder_name', name);
      } else {
        localStorage.removeItem('hm_folder_name');
      }

      _updateFolderLabel();
      UI.hideFolderModal();
      UI.showToast(name ? `Pasta alterada para "${name}"` : 'Buscando em todo o Drive');
      await _loadTracks();
      _updateOfflineSummary();
    });
  }

  // ── PERFIL / AJUSTES ───────────────────────────
  // O perfil é uma tela "por cima" das abas: abrir empilha uma entrada no
  // histórico, pra o botão físico/gesto de voltar do Android fechar o
  // perfil em vez de sair do app (mesmo esquema do player de vídeo).
  let _viewBeforeProfile = 'home';
  let _profileHistoryPushed = false;
  let _swallowNextPop = false;

  function _openProfile() {
    if (UI.getCurrentView() === 'profile') return;
    _viewBeforeProfile = UI.getCurrentView();
    UI.showView('profile');
    history.pushState({ hmOverlay: 'profile' }, '');
    _profileHistoryPushed = true;
  }

  function _closeProfile({ fromPopState = false } = {}) {
    if (UI.getCurrentView() !== 'profile') return;
    UI.showView(_viewBeforeProfile || 'home');
    if (_profileHistoryPushed) {
      _profileHistoryPushed = false;
      if (!fromPopState) history.back();
    }
  }

  function _toggleProfile() {
    if (UI.getCurrentView() === 'profile') _closeProfile();
    else _openProfile();
  }

  // Saiu do perfil por outro caminho (aba de baixo): descarta a entrada
  // de histórico à toa, senão o primeiro "voltar" não faria nada visível.
  function _dropProfileHistory() {
    if (!_profileHistoryPushed) return;
    _profileHistoryPushed = false;
    _swallowNextPop = true;
    history.back();
  }

  // "Voltar" com um modal/sheet aberto por cima do perfil fecha o modal
  // (não o perfil). Retorna true se havia algo a fechar.
  function _closeTopModalFromBack() {
    const open = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
    const top = open[open.length - 1];
    if (!top) return false;
    const btn = top.querySelector('.modal-close, #btn-confirm-cancel, .text-btn.modal-skip');
    if (btn) { btn.click(); return true; }
    top.click(); // clique no fundo — mesmo caminho de "tocar fora"
    return true;
  }

  function _bindProfileNavigation() {
    UI.el.btnUser.addEventListener('click', _toggleProfile);
    UI.el.btnProfileBack.addEventListener('click', () => _closeProfile());

    UI.el.navBtns.forEach(btn => btn.addEventListener('click', _dropProfileHistory));

    window.addEventListener('popstate', () => {
      if (_swallowNextPop) { _swallowNextPop = false; return; }
      if (!_profileHistoryPushed || UI.getCurrentView() !== 'profile') return;

      if (_closeTopModalFromBack()) {
        // O navegador já consumiu a entrada: recoloca pra o perfil continuar "por baixo"
        history.pushState({ hmOverlay: 'profile' }, '');
        return;
      }
      _closeProfile({ fromPopState: true });
    });
  }

  // ── ESCOLHER O QUE BAIXAR: dados e resolução ────
  function _countBy(field) {
    const map = new Map();
    _tracks.forEach(t => {
      const v = t[field];
      if (v) map.set(v, (map.get(v) || 0) + 1);
    });
    return map;
  }

  function _buildDownloadCategories() {
    const artistCount = _countBy('artist');
    const albumCount  = _countBy('album');
    const genreCount  = _countBy('genre');
    const favs = Player.getFavorites();

    return {
      playlist: [
        { value: FAVORITES_ID, label: 'Favoritas', count: favs.length },
        ..._playlists.map(p => ({ value: p.id, label: p.name, count: p.trackIds.length })),
      ],
      artist: Drive.getKnownArtists().map(a => ({ value: a, label: a, count: artistCount.get(a) || 0 })),
      album:  Drive.getKnownAlbums().map(a => ({ value: a, label: a, count: albumCount.get(a) || 0 })),
      genre:  Drive.getKnownGenres().map(g => ({ value: g, label: g, count: genreCount.get(g) || 0 })),
    };
  }

  // selections: { playlist: [ids], artist: [nomes], album: [...], genre: [...] }
  function _resolveDownloadSelection(selections) {
    let tracks = [];

    (selections.playlist || []).forEach(v => {
      if (v === FAVORITES_ID) tracks = tracks.concat(Player.getFavorites());
      else {
        const pl = _playlists.find(p => p.id === v);
        if (pl) tracks = tracks.concat(_playlistTracks(pl));
      }
    });
    ['artist', 'album', 'genre'].forEach(cat => {
      if (selections[cat]?.length) tracks = tracks.concat(Drive.filterTracks({ [cat]: selections[cat] }));
    });

    // Uma faixa pode aparecer em mais de uma seleção (ex.: 2 playlists
    // que compartilham música) — conta e baixa só uma vez.
    const seen = new Set();
    return tracks.filter(t => { if (!t?.id || seen.has(t.id)) return false; seen.add(t.id); return true; });
  }

  // ── EVENTOS DA APP ─────────────────────────────
  function _bindAppEvents() {

    // Login
    UI.el.btnLogin.addEventListener('click', () => Drive.login());

    // Perfil: abrir/fechar, voltar (inclui botão físico do Android)
    _bindProfileNavigation();

    // Logout (com confirmação: é um toque fácil de dar sem querer)
    UI.el.btnLogout.addEventListener('click', async () => {
      const ok = await UI.confirmDialog(
        'Você vai precisar entrar com o Google de novo. Suas músicas continuam no Drive.',
        { title: 'Sair da conta?', okLabel: 'Sair', danger: false }
      );
      if (!ok) return;
      _dropProfileHistory();
      Drive.logout();
      Player.pause();
      _tracks = [];
      UI.showView('home');
      UI.showLogin();
      UI.showToast('Até logo!');
    });

    // Atualizar lista
    UI.el.btnRefresh.addEventListener('click', async () => {
      UI.showToast('Atualizando músicas…');
      await _loadTracks();
      _updateOfflineSummary();
    });

    // Onboarding: abrir Drive / pular
    UI.el.btnOnboardingDrive.addEventListener('click', _openGoogleDrive);
    UI.el.btnOnboardingClose.addEventListener('click', () => {
      localStorage.setItem(KEY_ONBOARDED, '1');
      UI.hideOnboarding();
    });

    // Perfil: abrir Drive
    UI.el.btnOpenDrive.addEventListener('click', _openGoogleDrive);

    // Perfil: escolher pasta
    UI.el.btnChooseFolder.addEventListener('click', _openFolderSheet);
    _bindFolderListClick();
    UI.el.btnFolderClose.addEventListener('click', () => UI.hideFolderModal());
    UI.el.modalFolder.addEventListener('click', e => {
      if (e.target === UI.el.modalFolder) UI.hideFolderModal();
    });
    UI.el.modalOnboarding.addEventListener('click', e => {
      if (e.target === UI.el.modalOnboarding) {
        localStorage.setItem(KEY_ONBOARDED, '1');
        UI.hideOnboarding();
      }
    });

    // Modo offline: baixar tudo / baixar favoritas / limpar
    UI.el.btnDownloadAll.addEventListener('click', () => {
      _runDownloadBatch(_tracks, 'all');
    });

    UI.el.btnDownloadFavorites.addEventListener('click', () => {
      _runDownloadBatch(Player.getFavorites(), 'fav');
    });

    // Escolher o que baixar (playlist/artista/álbum/gênero) — Perfil →
    // Modo offline. As opções são montadas na hora de abrir (pra já
    // refletir playlists/favoritas atuais); a seleção só vira lista de
    // faixas quando o usuário confirma.
    UI.el.btnDownloadCustom.addEventListener('click', () => {
      // Com um lote desse tipo rodando, a linha vira "Cancelar download"
      if (_batchRunning) { _runDownloadBatch([], 'custom'); return; }

      UI.showDownloadPicker(_buildDownloadCategories(), selections => {
        const tracks = _resolveDownloadSelection(selections);
        _runDownloadBatch(tracks, 'custom');
      }, {
        countTracks: selections => {
          const tracks  = _resolveDownloadSelection(selections);
          const pending = tracks.filter(t => !Downloads.isDownloaded(t.id));
          return {
            total:   tracks.length,
            pending: pending.length,
            bytes:   pending.reduce((sum, t) => sum + (t.size || 0), 0),
          };
        },
      });
    });

    UI.el.btnClearDownloads.addEventListener('click', async () => {
      const ok = await UI.confirmDialog(
        'As músicas continuam disponíveis pra baixar de novo quando quiser.',
        { title: 'Remover todos os downloads?', okLabel: 'Remover' }
      );
      if (!ok) return;
      await Downloads.clearAll();
      UI.refreshDownloadBadges();
      _updateOfflineSummary();
      UI.showToast('Downloads removidos.');
    });

    UI.el.chkAutoDownload.checked = isAutoDownloadEnabled();
    UI.el.chkAutoDownload.addEventListener('change', () => {
      setAutoDownloadEnabled(UI.el.chkAutoDownload.checked);
    });

    // Mantém o resumo "X de Y músicas baixadas" sempre atualizado
    Downloads.onChange(() => _updateOfflineSummary());

    // Filtros, upload, edição de metadados e playlists
    _bindFilterEvents();
    _bindSearchResultsClose();
    _bindSelectionEvents();
    _bindUploadEvents();
    _bindEditModalEvents();
    _bindPlaylistEvents();
    _bindAddToPlaylistModalEvents();
    _bindAddTracksPickerEvents();

    // Vídeos
    _bindMovieFilterEvents();
    _bindMovieCollectionEvents();
    _bindAddVideoToPlaylistModalEvents();
    _bindMovieAddEvents();
    _bindMovieEditModalEvents();
    _bindMoviePlayerEvents();

    UI.setTrackMenuHandlers({
      onEdit: track => _openEditModal(track),
      onAddToPlaylist: track => _openAddToPlaylistModal(track),
      onDelete: track => _deleteTrack(track),
      onRemoveFromPlaylist: track => _removeTrackFromActivePlaylist(track),
    });

    // Fecha modais novos ao clicar fora da caixa (mesmo padrão dos outros modais)
    [UI.el.modalUpload, UI.el.modalTrackEdit, UI.el.modalNewPlaylist, UI.el.modalAddToPlaylist, UI.el.modalAddTracksToPlaylist].forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target !== modal) return;
        if (modal === UI.el.modalUpload) {
          _closeUploadSheet();
        } else if (modal === UI.el.modalTrackEdit) UI.hideTrackEditModal();
        else if (modal === UI.el.modalNewPlaylist) UI.hideNewPlaylistModal();
        else if (modal === UI.el.modalAddToPlaylist) _closeAddToPlaylistModal();
        else if (modal === UI.el.modalAddTracksToPlaylist) UI.hideAddTracksPickerModal();
      });
    });
    // (modais de playlist de vídeo fecham ao clicar fora dentro dos
    // próprios _bindMovieCollectionEvents/_bindAddVideoToPlaylistModalEvents)

    // Reabrir a aba Biblioteca sempre volta pra raiz (lista), fechando
    // o detalhe de playlist se estiver aberto.
    document.querySelectorAll('.nav-btn').forEach(btn => {
      if (btn.dataset.view === 'library') {
        btn.addEventListener('click', () => {
          _activePlaylistId = null;
          UI.showPlaylistsRoot();
          UI.renderPlaylists(_playlists);
        });
      }
    });

    // Busca em tempo real — apagar o texto todo só limpa os resultados
    // (a busca é uma aba fixa agora, não fecha/navega mais sozinha).
    UI.el.searchInput.addEventListener('input', e => {
      if (!e.target.value) { UI.clearSearchResults(); return; }
      _handleSearch(e.target.value);
    });

    // Escape limpa o campo de busca
    UI.el.searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        UI.el.searchInput.value = '';
        UI.clearSearchResults();
      }
    });

    // Atualiza recentes sempre que trocar para a home
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.view === 'home') {
          _renderRecent();
        }
      });
    });

    // Visibilidade da página (volta do plano de fundo)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Drive.isLoggedIn()) {
        // Atualiza saudação (pode ter mudado o horário)
        UI.setGreeting();
      }
    });

    // Erros de rede globais
    window.addEventListener('online', () => {
      UI.setOnlineState?.(true);
      UI.showToast('Conexão restaurada');
    });
    window.addEventListener('offline', () => {
      UI.setOnlineState?.(false);
      UI.showToast('Sem internet — só as músicas baixadas tocam', 3500);
    });
  }

  // ── EXPORT ────────────────────────────────────
  return { init };

})();

// ── ARRANQUE ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
