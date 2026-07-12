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
  const GDRIVE_URL = 'https://drive.google.com/drive/my-drive';

  // Filtros da tela "Todas as músicas"
  let _filters = { genre: '', artist: '', album: '' };

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

    // 1. Bind eventos fixos (player, nav, search)
    UI.bindPlayerEvents();
    _bindAppEvents();

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
      _tracks = await Drive.listTracks();

      if (!_tracks.length) {
        UI.el.allTracksList.innerHTML = `
          <div class="empty-hint">
            Nenhuma música encontrada.<br>
            Envie arquivos de áudio pelo app ou adicione direto na pasta do Google Drive.
            <br><br>
            <button id="btn-empty-drive" class="btn-outline btn-small">Abrir Google Drive</button>
          </div>`;
        const btn = document.getElementById('btn-empty-drive');
        if (btn) btn.addEventListener('click', () => window.open(GDRIVE_URL, '_blank'));
        _renderRecent();
        _refreshFilterBar();
        return;
      }

      // Recentes
      _renderRecent();
      _refreshFilterBar();
      _renderAllTracksList();
      _primeLastPlayed();

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
      UI.showToast('Não foi possível carregar as músicas.');
    }
  }

  function _renderRecent() {
    // A prateleira "Tocadas recentemente" foi removida da Home. O
    // histórico em si (Player.getRecent) continua sendo gravado — só não
    // é mais exibido como lista aqui. Mantemos apenas a atualização das
    // "Coleções recentes".
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

    if (!count) {
      UI.setOfflineSummary('Nenhuma música baixada ainda. Baixe antes de pegar estrada sem internet.');
      return;
    }

    const size = _formatBytes(bytes);
    UI.setOfflineSummary(`${count} de ${_tracks.length} músicas baixadas${size ? ' · ' + size : ''}.`);
  }

  // Avisa se o download vai provavelmente estourar o espaço livre do
  // aparelho, mas deixa o usuário decidir se quer arriscar mesmo assim
  async function _confirmIfLowStorage(tracks) {
    const totalBytes = tracks.reduce((sum, t) => sum + (t.size || 0), 0);
    if (!totalBytes) return true; // sem estimativa de tamanho, não bloqueia

    const storage = await Downloads.estimateStorage();
    if (!storage || !storage.quota) return true;

    if (totalBytes > storage.available * 0.9) {
      return window.confirm(
        `Isso baixa cerca de ${_formatBytes(totalBytes)}, mas seu aparelho tem só ` +
        `${_formatBytes(storage.available)} livres. Baixar mesmo assim? ` +
        `(pode parar antes de terminar tudo)`
      );
    }
    return true;
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

    if (!list.length) {
      UI.el.allTracksList.innerHTML = `<p class="empty-hint">Nenhuma música com esse filtro.</p>`;
    } else {
      UI.renderTrackList(UI.el.allTracksList, list, _currentId());
      UI.bindTrackListEvents(UI.el.allTracksList, list);
    }

    const active = [_filters.genre, _filters.artist, _filters.album].filter(Boolean).length;
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
      UI.showFilterPicker('genre', _filters.genre, value => {
        _filters.genre = value;
        _refreshFilterBar();
        _renderAllTracksList();
      });
    });
    UI.el.filterChipArtist.addEventListener('click', () => {
      UI.showFilterPicker('artist', _filters.artist, value => {
        _filters.artist = value;
        _refreshFilterBar();
        _renderAllTracksList();
      });
    });
    UI.el.filterChipAlbum.addEventListener('click', () => {
      UI.showFilterPicker('album', _filters.album, value => {
        _filters.album = value;
        _refreshFilterBar();
        _renderAllTracksList();
      });
    });
    UI.el.btnFilterClear.addEventListener('click', () => {
      _filters = { genre: '', artist: '', album: '' };
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

  function _renderUploadList() {
    const genreOptions = _knownGenres().map(g => `<option value="${g}"></option>`).join('');

    if (!_uploadItems.length) {
      UI.el.uploadList.innerHTML = `<p class="empty-hint">Nenhum arquivo selecionado ainda.</p>`;
      UI.el.btnUploadSendAll.disabled = true;
      return;
    }

    UI.el.uploadList.innerHTML = _uploadItems.map(item => `
      <div class="upload-item upload-item-${item.status}" data-upload-id="${item.localId}">
        <div class="upload-item-head">
          <span class="upload-item-filename">${_escHtml(item.file.name)}</span>
          ${item.status === 'done' ? `<span class="upload-item-badge">${UI.checkIcon(13)} Enviada</span>` : ''}
          ${item.status !== 'uploading' ? `<button class="text-btn upload-item-remove" data-remove="${item.localId}">Remover</button>` : ''}
        </div>

        ${item.status !== 'done' ? `
          <div class="upload-field">
            <label>Título</label>
            <input type="text" class="text-input" data-field="title" data-id="${item.localId}" value="${_escHtml(item.title)}" />
          </div>
          <div class="upload-field">
            <label>Artista</label>
            <input type="text" class="text-input" data-field="artist" data-id="${item.localId}" value="${_escHtml(item.artist)}" placeholder="Desconhecido" />
          </div>
          <div class="upload-field">
            <label>Álbum</label>
            <input type="text" class="text-input" data-field="album" data-id="${item.localId}" value="${_escHtml(item.album)}" />
          </div>
          <div class="upload-field">
            <label>Gênero</label>
            <input type="text" class="text-input" data-field="genre" data-id="${item.localId}" value="${_escHtml(item.genre)}" list="upload-genre-suggestions" />
          </div>
        ` : ''}

        ${item.status === 'uploading' ? `
          <div class="dl-progress">
            <div class="dl-progress-bar"><div class="dl-progress-fill" style="width:${item.progress}%"></div></div>
            <span class="profile-section-hint" style="margin:0;">${item.progress}%</span>
          </div>` : ''}

        ${item.status === 'error' ? `
          <p class="upload-item-error">${_escHtml(item.errorMsg || 'Falha ao enviar.')}</p>
          <button class="btn-outline btn-small" data-retry="${item.localId}">Tentar novamente</button>
        ` : ''}
      </div>
    `).join('') + `<datalist id="upload-genre-suggestions">${genreOptions}</datalist>`;

    UI.el.btnUploadSendAll.disabled = !_uploadItems.some(i => i.status === 'pending' || i.status === 'error');
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
      });
    });
    if (rejected) {
      UI.showToast(rejected === 1
        ? '1 arquivo ignorado: não é um áudio suportado.'
        : `${rejected} arquivos ignorados: não são áudios suportados.`);
    }
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
          const row = document.querySelector(`[data-upload-id="${item.localId}"] .dl-progress-fill`);
          const pctLabel = document.querySelector(`[data-upload-id="${item.localId}"] .dl-progress .profile-section-hint`);
          if (row) row.style.width = item.progress + '%';
          if (pctLabel) pctLabel.textContent = item.progress + '%';
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

    const pending = () => _uploadItems.filter(i => i.status === 'pending' || i.status === 'error');
    async function worker() {
      let next;
      while ((next = pending()[0])) {
        await _uploadOne(next);
      }
    }
    await Promise.all(Array(UPLOAD_CONCURRENCY).fill(0).map(worker));

    _uploadRunning = false;
    _updateOfflineSummary();
  }

  function _bindUploadEvents() {
    UI.el.btnUploadOpen.addEventListener('click', () => {
      UI.showUploadModal();
      _renderUploadList();
    });

    UI.el.inputUploadFiles.addEventListener('change', e => {
      if (e.target.files?.length) _addFilesToUploadQueue(e.target.files);
      e.target.value = ''; // permite selecionar o mesmo arquivo de novo depois
    });

    UI.el.btnUploadAddMore.addEventListener('click', () => UI.el.inputUploadFiles.click());
    UI.el.btnUploadSendAll.addEventListener('click', () => _uploadAllPending());

    UI.el.btnUploadClose.addEventListener('click', () => {
      if (_uploadRunning) {
        UI.showToast('Aguarde o envio terminar antes de fechar.');
        return;
      }
      UI.hideUploadModal();
      _uploadItems = _uploadItems.filter(i => i.status !== 'done'); // limpa concluídos
    });

    UI.el.uploadList.addEventListener('input', e => {
      const input = e.target.closest('[data-field]');
      if (!input) return;
      const item = _uploadItems.find(i => i.localId === parseInt(input.dataset.id, 10));
      if (!item) return;
      item[input.dataset.field] = input.value;
    });

    UI.el.uploadList.addEventListener('click', e => {
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
    if (!window.confirm(`Excluir "${track.title}" do Google Drive? O arquivo vai pra lixeira do Drive (fica recuperável por lá), mas some do HappyMusic.`)) return;

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
    if (UI.getCurrentView() === 'home') _renderAllTracksList();
    if (UI.getCurrentView() === 'search' && UI.el.searchInput.value.trim()) {
      _handleSearch(UI.el.searchInput.value);
    }
    if (_activePlaylistId) _renderActivePlaylistTracks();
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
      if (id === FAVORITES_ID) return { id: FAVORITES_ID, name: 'Favoritas', isFavorites: true };
      const p = _playlists.find(pl => pl.id === id);
      return p ? { id: p.id, name: p.name, isFavorites: false } : null;
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
      UI.showView('playlists');
      if (chip.dataset.id === FAVORITES_ID) _openFavoritesView();
      else _openPlaylist(chip.dataset.id);
    });

    UI.el.btnPlaylistBack.addEventListener('click', () => {
      _activePlaylistId = null;
      UI.showPlaylistsRoot();
    });

    UI.el.btnPlaylistDelete.addEventListener('click', async () => {
      if (_activePlaylistId === FAVORITES_ID) return;
      const playlist = _playlists.find(p => p.id === _activePlaylistId);
      if (!playlist) return;
      if (!window.confirm(`Excluir a playlist "${playlist.name}"? Isso não apaga as músicas, só a playlist.`)) return;

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
      Player.loadQueue(tracks, 0);
    });

    // Mantém a tela de Favoritas (se aberta) e a contagem no card sincronizadas
    // sempre que uma faixa é favoritada/desfavoritada de qualquer lugar do app.
    document.addEventListener('hm-favorite-change', () => {
      if (_activePlaylistId === FAVORITES_ID) _renderActivePlaylistTracks();
      UI.renderPlaylists(_playlists);
    });
  }

  let _pickerSelectedIds = new Set();

  function _openAddTracksPicker() {
    if (_activePlaylistId === FAVORITES_ID) return;
    const playlist = _playlists.find(p => p.id === _activePlaylistId);
    if (!playlist) return;
    _pickerSelectedIds = new Set(playlist.trackIds);
    UI.showAddTracksPickerModal(Drive.getCachedTracks(), _pickerSelectedIds);
  }

  function _bindAddTracksPickerEvents() {
    UI.el.btnPlaylistAddTracks.addEventListener('click', () => _openAddTracksPicker());
    UI.el.btnAddTracksPickerClose.addEventListener('click', () => UI.hideAddTracksPickerModal());

    UI.el.addTracksPickerSearch.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      const all = Drive.getCachedTracks();
      const filtered = q
        ? all.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
        : all;
      UI.renderAddTracksPicker(filtered, _pickerSelectedIds);
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
    });

    UI.el.btnAddTracksPickerConfirm.addEventListener('click', async () => {
      const playlist = _playlists.find(p => p.id === _activePlaylistId);
      if (!playlist) { UI.hideAddTracksPickerModal(); return; }
      playlist.trackIds = [..._pickerSelectedIds];
      UI.renderPlaylists(_playlists);
      _renderActivePlaylistTracks();
      UI.hideAddTracksPickerModal();
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
      _renderMovieGrid();
    } catch (err) {
      console.error('[App] Erro ao carregar vídeos:', err);
      if (err?.message === 'UNAUTHORIZED') { Drive.logout(); UI.showLogin(); }
    }
  }

  function _visibleMovies() {
    return Drive.filterVideos({ genre: _movieFilterGenre });
  }

  function _renderMovieGrid() {
    UI.renderMovieGrid(_visibleMovies());
    UI.bindMovieGridEvents(UI.el.movieGrid, _visibleMovies());
  }

  function _refreshMovieFilterBar() {
    UI.renderMovieFilterOptions(Drive.getKnownMovieGenres(), _movieFilterGenre);
  }

  function _bindMovieFilterEvents() {
    UI.el.movieFilterGenre.addEventListener('change', e => {
      _movieFilterGenre = e.target.value;
      _refreshMovieFilterBar();
      _renderMovieGrid();
    });
    UI.el.btnMovieFilterClear.addEventListener('click', () => {
      _movieFilterGenre = '';
      _refreshMovieFilterBar();
      _renderMovieGrid();
    });
    UI.el.btnMovieRefresh.addEventListener('click', () => _loadMovies());
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
      const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(q)}`);
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

  function _bindMovieCustomControls() {
    if (_moviePlayerBound) return;
    _moviePlayerBound = true;

    YTPlayer.on('onStateChange', playing => UI.setMoviePlayState(playing));
    YTPlayer.on('onProgress', (current, duration) => UI.updateMovieProgress(current, duration));
    YTPlayer.on('onEnded', () => _playNextMovie());

    UI.el.btnMoviePlayPause.addEventListener('click', () => YTPlayer.togglePlay());
    UI.el.movieSeekBar.addEventListener('input', () => {
      YTPlayer.seekPercent(parseFloat(UI.el.movieSeekBar.value));
    });
  }

  let _currentMovieId = null;

  async function _openMoviePlayerFor(video) {
    _currentMovieId = video.id;
    UI.openMoviePlayer(video.title);
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

  // Ao terminar um vídeo, toca o próximo da lista visível (respeitando
  // o filtro de gênero ativo) e, ao chegar no último, volta pro
  // primeiro — a lista de vídeos nunca para sozinha.
  function _playNextMovie() {
    const list = _visibleMovies();
    if (!list.length) return;
    const idx = list.findIndex(v => v.id === _currentMovieId);
    const next = list[(idx + 1) % list.length];
    if (next) _openMoviePlayerFor(next);
  }

  function _closeMoviePlayer() {
    YTPlayer.stop();
    UI.closeMoviePlayer();
  }

  function _bindMoviePlayerEvents() {
    UI.el.btnMovieClose.addEventListener('click', () => _closeMoviePlayer());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !UI.el.moviePlayerOverlay.classList.contains('hidden')) _closeMoviePlayer();
    });

    UI.setMovieMenuHandlers({
      onEdit: video => _openMovieEditModal(video),
      onPlay: video => _openMoviePlayerFor(video),
    });
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

  // ── SELEÇÃO DE PASTA ───────────────────────────
  function _bindFolderListClick(folders) {
    UI.el.folderList.dataset.bound = '1';
    UI.el.folderList.addEventListener('click', async e => {
      const item = e.target.closest('.folder-item');
      if (!item) return;

      const id = item.dataset.id || null;
      const name = id ? (folders.find(f => f.id === id)?.name || null) : null;

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

  // ── EVENTOS DA APP ─────────────────────────────
  function _bindAppEvents() {

    // Login
    UI.el.btnLogin.addEventListener('click', () => Drive.login());

    // Logout
    UI.el.btnLogout.addEventListener('click', () => {
      Drive.logout();
      Player.pause();
      _tracks = [];
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
    UI.el.btnOnboardingDrive.addEventListener('click', () => {
      window.open(GDRIVE_URL, '_blank');
    });
    UI.el.btnOnboardingClose.addEventListener('click', () => {
      localStorage.setItem(KEY_ONBOARDED, '1');
      UI.hideOnboarding();
    });

    // Perfil: abrir Drive
    UI.el.btnOpenDrive.addEventListener('click', () => {
      window.open(GDRIVE_URL, '_blank');
    });

    // Perfil: escolher pasta
    UI.el.btnChooseFolder.addEventListener('click', async () => {
      UI.showFolderModal();
      try {
        const folders = await Drive.listFolders();
        UI.renderFolderList(folders, Drive.getFolderId());
        UI.el.folderList.dataset.bound !== '1' && _bindFolderListClick(folders);
      } catch (err) {
        console.error('[App] Erro ao listar pastas:', err);
        UI.el.folderList.innerHTML = `<p class="empty-hint">Não foi possível listar as pastas.</p>`;
      }
    });
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

    UI.el.btnClearDownloads.addEventListener('click', async () => {
      if (!window.confirm('Remover todas as músicas baixadas para offline?')) return;
      await Downloads.clearAll();
      UI.refreshDownloadBadges();
      _updateOfflineSummary();
      UI.showToast('Downloads removidos.');
    });

    // Mantém o resumo "X de Y músicas baixadas" sempre atualizado
    Downloads.onChange(() => _updateOfflineSummary());

    // Filtros, upload, edição de metadados e playlists
    _bindFilterEvents();
    _bindSelectionEvents();
    _bindUploadEvents();
    _bindEditModalEvents();
    _bindPlaylistEvents();
    _bindAddToPlaylistModalEvents();
    _bindAddTracksPickerEvents();

    // Vídeos
    _bindMovieFilterEvents();
    _bindMovieAddEvents();
    _bindMovieEditModalEvents();
    _bindMoviePlayerEvents();

    UI.setTrackMenuHandlers({
      onEdit: track => _openEditModal(track),
      onAddToPlaylist: track => _openAddToPlaylistModal(track),
      onDelete: track => _deleteTrack(track),
    });

    // Fecha modais novos ao clicar fora da caixa (mesmo padrão dos outros modais)
    [UI.el.modalUpload, UI.el.modalTrackEdit, UI.el.modalNewPlaylist, UI.el.modalAddToPlaylist, UI.el.modalAddTracksToPlaylist].forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target !== modal) return;
        if (modal === UI.el.modalUpload) {
          if (_uploadRunning) { UI.showToast('Aguarde o envio terminar antes de fechar.'); return; }
          UI.hideUploadModal();
        } else if (modal === UI.el.modalTrackEdit) UI.hideTrackEditModal();
        else if (modal === UI.el.modalNewPlaylist) UI.hideNewPlaylistModal();
        else if (modal === UI.el.modalAddToPlaylist) _closeAddToPlaylistModal();
        else if (modal === UI.el.modalAddTracksToPlaylist) UI.hideAddTracksPickerModal();
      });
    });

    // Voltar pra tela raiz de playlists sempre que a aba é reaberta
    document.querySelectorAll('.nav-btn').forEach(btn => {
      if (btn.dataset.view === 'playlists') {
        btn.addEventListener('click', () => {
          _activePlaylistId = null;
          UI.showPlaylistsRoot();
          UI.renderPlaylists(_playlists);
        });
      }
    });

    // Busca em tempo real
    UI.el.searchInput.addEventListener('input', e => {
      _handleSearch(e.target.value);
    });

    // Limpa busca ao pressionar Escape
    UI.el.searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        UI.toggleSearchBar();
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
    window.addEventListener('online',  () => UI.showToast('Conexão restaurada'));
    window.addEventListener('offline', () => UI.showToast('Sem conexão com a internet'));
  }

  // ── EXPORT ────────────────────────────────────
  return { init };

})();

// ── ARRANQUE ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
