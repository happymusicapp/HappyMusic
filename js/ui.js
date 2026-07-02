/* ═══════════════════════════════════════════════
   HAPPY MUSIC – ui.js
   Renderização de DOM, player UI, navegação de views
═══════════════════════════════════════════════ */

const UI = (() => {

  // ── ELEMENTOS ─────────────────────────────────
  const $ = id => document.getElementById(id);

  const el = {
    // Screens
    screenLogin:    $('screen-login'),
    screenApp:      $('screen-app'),

    // Header
    btnSearchToggle:$('btn-search-toggle'),
    btnUser:        $('btn-user'),
    userAvatar:     $('user-avatar'),
    searchBar:      $('search-bar'),
    searchInput:    $('search-input'),

    // Views
    viewHome:       $('view-home'),
    viewSearch:     $('view-search'),
    viewProfile:    $('view-profile'),
    mainContent:    $('main-content'),

    // Listas
    recentList:     $('recent-list'),
    allTracksList:  $('all-tracks-list'),
    searchResults:  $('search-results'),

    // Player
    player:         $('player'),
    playerArt:      $('player-art'),
    playerTitle:    $('player-title'),
    playerArtist:   $('player-artist'),
    btnFav:         $('btn-fav'),
    btnDownloadCurrent: $('btn-download-current'),
    seekBar:        $('seek-bar'),
    timeCurrent:    $('time-current'),
    timeTotal:      $('time-total'),
    btnPlayPause:   $('btn-play-pause'),
    iconPlay:       $('icon-play'),
    iconPause:      $('icon-pause'),
    btnPrev:        $('btn-prev'),
    btnNext:        $('btn-next'),
    btnShuffle:     $('btn-shuffle'),
    btnRepeat:      $('btn-repeat'),

    // Perfil
    profileAvatar:  $('profile-avatar'),
    profileName:    $('profile-name'),
    profileEmail:   $('profile-email'),
    btnLogout:      $('btn-logout'),
    btnRefresh:     $('btn-refresh'),
    btnOpenDrive:   $('btn-open-drive'),
    btnChooseFolder:$('btn-choose-folder'),
    folderCurrentLabel: $('folder-current-label'),

    // Offline / downloads
    offlineStatus:        $('offline-status'),
    offlineProgressWrap:  $('offline-progress-wrap'),
    offlineProgressFill:  $('offline-progress-fill'),
    offlineProgressText:  $('offline-progress-text'),
    btnDownloadAll:       $('btn-download-all'),
    btnDownloadFavorites: $('btn-download-favorites'),
    btnClearDownloads:    $('btn-clear-downloads'),

    // Onboarding
    modalOnboarding:    $('modal-onboarding'),
    btnOnboardingDrive: $('btn-onboarding-drive'),
    btnOnboardingClose: $('btn-onboarding-close'),

    // Seletor de pasta
    modalFolder:    $('modal-folder'),
    folderList:     $('folder-list'),
    btnFolderClose: $('btn-folder-close'),

    // Nav
    navBtns:        document.querySelectorAll('.nav-btn'),

    // Toast
    toast:          $('toast'),

    // Login
    btnLogin:       $('btn-login'),

    // Filtros
    filterBar:      $('filter-bar'),
    filterGenre:    $('filter-genre'),
    filterArtist:   $('filter-artist'),
    filterAlbum:    $('filter-album'),
    btnFilterClear: $('btn-filter-clear'),
    filterSummary:  $('filter-summary'),

    // Seleção múltipla / atribuição de gênero em lote
    btnSelectMode:          $('btn-select-mode'),
    selectionBar:           $('selection-bar'),
    selectionCount:         $('selection-count'),
    btnSelectionAssignGenre:$('btn-selection-assign-genre'),
    btnSelectionCancel:     $('btn-selection-cancel'),
    modalBulkGenre:         $('modal-bulk-genre'),
    bulkGenreCount:         $('bulk-genre-count'),
    bulkGenreField:         $('bulk-genre-field'),
    bulkGenreProgress:      $('bulk-genre-progress'),
    bulkGenreProgressFill:  $('bulk-genre-progress-fill'),
    btnBulkGenreSave:       $('btn-bulk-genre-save'),
    btnBulkGenreCancel:     $('btn-bulk-genre-cancel'),

    // Upload
    btnUploadOpen:    $('btn-upload-open'),
    inputUploadFiles: $('input-upload-files'),
    modalUpload:      $('modal-upload'),
    uploadList:       $('upload-list'),
    btnUploadAddMore: $('btn-upload-add-more'),
    btnUploadSendAll: $('btn-upload-send-all'),
    btnUploadClose:   $('btn-upload-close'),

    // Editar faixa
    modalTrackEdit:  $('modal-track-edit'),
    editFieldTitle:  $('edit-field-title'),
    editFieldArtist: $('edit-field-artist'),
    editFieldAlbum:  $('edit-field-album'),
    editFieldGenre:  $('edit-field-genre'),
    genreSuggestions:$('genre-suggestions'),
    btnEditSave:     $('btn-edit-save'),
    btnEditCancel:   $('btn-edit-cancel'),

    // Playlists
    viewPlaylists:        $('view-playlists'),
    playlistsListWrap:    $('playlists-list-wrap'),
    playlistsList:        $('playlists-list'),
    btnNewPlaylist:       $('btn-new-playlist'),
    playlistDetail:       $('playlist-detail'),
    playlistDetailTitle:  $('playlist-detail-title'),
    btnPlaylistBack:      $('btn-playlist-back'),
    btnPlaylistDelete:    $('btn-playlist-delete'),
    btnPlaylistPlay:      $('btn-playlist-play'),
    playlistTracksList:   $('playlist-tracks-list'),

    modalNewPlaylist:     $('modal-new-playlist'),
    newPlaylistName:      $('new-playlist-name'),
    btnNewPlaylistCreate: $('btn-new-playlist-create'),
    btnNewPlaylistCancel: $('btn-new-playlist-cancel'),

    modalAddToPlaylist:      $('modal-add-to-playlist'),
    addToPlaylistList:       $('add-to-playlist-list'),
    addToPlaylistNewName:    $('add-to-playlist-new-name'),
    btnAddToPlaylistCreate:  $('btn-add-to-playlist-create'),
    btnAddToPlaylistClose:   $('btn-add-to-playlist-close'),
  };

  // ── TOAST ──────────────────────────────────────
  let _toastTimer = null;

  function showToast(msg, duration = 2800) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.toast.classList.remove('show'), duration);
  }

  // ── SCREENS ────────────────────────────────────
  function showLogin() {
    el.screenLogin.classList.add('active');
    el.screenApp.classList.remove('active');
  }

  function showApp() {
    el.screenLogin.classList.remove('active');
    el.screenApp.classList.add('active');
  }

  // ── NAVEGAÇÃO DE VIEWS ─────────────────────────
  let _currentView = 'home';

  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${name}`);
    if (target) target.classList.add('active');

    el.navBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === name);
    });

    _currentView = name;

    // Scroll pro topo ao trocar de view
    el.mainContent.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getCurrentView() { return _currentView; }

  // ── SEARCH BAR TOGGLE ──────────────────────────
  function toggleSearchBar() {
    const hidden = el.searchBar.classList.toggle('hidden');
    if (!hidden) {
      el.searchInput.focus();
      showView('search');
    } else {
      el.searchInput.value = '';
      showView('home');
    }
  }

  // ── PERFIL ─────────────────────────────────────
  function renderProfile(user) {
    if (!user) return;
    el.userAvatar.src     = user.picture || '';
    el.profileAvatar.src  = user.picture || '';
    el.profileName.textContent  = user.name  || 'Usuário';
    el.profileEmail.textContent = user.email || '';
  }

  // ── SAUDAÇÃO DINÂMICA ──────────────────────────
  // Sem nome da pessoa — segue o padrão Spotify/YouTube Music (só o
  // horário). Evita casos estranhos como mostrar o nome errado da conta.
  function setGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Olá';
    if (hour >= 5  && hour < 12) greeting = 'Bom dia';
    else if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
    else greeting = 'Boa noite';

    const sectionTitle = el.viewHome.querySelector('.section-title');
    if (sectionTitle) {
      sectionTitle.textContent = `${greeting} 👋`;
    }
  }

  // ── ÍCONE DE MÚSICA (fallback sem capa) ───────
  function _musicIcon(size = 24) {
    return `<svg width="${size}" height="${size}" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
    </svg>`;
  }

  // ── DOWNLOAD OFFLINE: ícone + estado do botão ─
  function _dlState(trackId) {
    if (!trackId) return 'idle';
    if (Downloads.isDownloading(trackId)) return 'downloading';
    if (Downloads.isDownloaded(trackId))  return 'downloaded';
    return 'idle';
  }

  function _dlIcon(state) {
    if (state === 'downloading') return `<span class="dl-spinner"></span>`;
    if (state === 'downloaded') {
      return `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <polyline points="5 13 9 17 19 7"/>
      </svg>`;
    }
    return `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path d="M12 3v12m0 0l-4-4m4 4l4-4"/>
      <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/>
    </svg>`;
  }

  function _dlLabel(state) {
    return {
      downloading: 'Baixando…',
      downloaded:  'Baixado — toque para remover do offline',
      idle:        'Baixar para ouvir offline',
    }[state];
  }

  function _renderDlButton(trackId) {
    const state = _dlState(trackId);
    return `<button class="dl-btn ${state !== 'idle' ? state : ''}" data-dl="${trackId}"
                aria-label="${_dlLabel(state)}" title="${_dlLabel(state)}">
              ${_dlIcon(state)}
            </button>`;
  }

  function _setDlBtnState(btn, state) {
    if (!btn) return;
    btn.classList.remove('downloaded', 'downloading');
    if (state !== 'idle') btn.classList.add(state);
    btn.innerHTML = _dlIcon(state);
    btn.setAttribute('aria-label', _dlLabel(state));
    btn.title = _dlLabel(state);
  }

  // Aplica uma mudança de estado de download a todos os botões dessa
  // faixa na tela (lista, busca, recentes, player). id === null
  // re-sincroniza TODOS os botões presentes (usado após GET_CACHED_TRACKS
  // ou limpeza geral).
  function _applyDownloadState(id, state) {
    if (id === null) {
      document.querySelectorAll('[data-dl]').forEach(btn => {
        const tid = btn.dataset.dl;
        if (tid) _setDlBtnState(btn, _dlState(tid));
      });
      return;
    }
    document.querySelectorAll(`[data-dl="${id}"]`).forEach(btn => _setDlBtnState(btn, state));
  }

  // Força reavaliação de todos os botões de download visíveis
  // (chamar depois de Downloads.refreshCachedIds())
  function refreshDownloadBadges() {
    _applyDownloadState(null, 'sync');
  }

  function _handleDownloadClick(id, tracks) {
    if (!id) return;
    const track = (tracks || []).find(t => t.id === id) || Drive.getCachedTracks().find(t => t.id === id);
    if (!track) return;

    if (Downloads.isDownloaded(id)) {
      Downloads.removeTrack(id);
      showToast('Removida do offline');
    } else if (!Downloads.isDownloading(id)) {
      Downloads.downloadTrack(track);
    }
  }

  // ── CAPA EMBUTIDA (ID3/MP4): fila com concorrência limitada ──
  const _coverQueue = [];
  let _coverActive = 0;
  const COVER_CONCURRENCY = 3;

  function _queueCoverFetch(track, priority = false) {
    if (!track || track.thumbnail || track._coverTried) return;
    track._coverTried = true;
    if (priority) _coverQueue.unshift(track);
    else _coverQueue.push(track);
    _drainCoverQueue();
  }

  function _drainCoverQueue() {
    while (_coverActive < COVER_CONCURRENCY && _coverQueue.length) {
      const track = _coverQueue.shift();
      _coverActive++;
      Drive.fetchEmbeddedCover(track.id)
        .then(dataUrl => {
          if (dataUrl) {
            track.thumbnail = dataUrl;
            _applyCoverToDom(track.id, dataUrl);
          }
        })
        .catch(() => {})
        .finally(() => {
          _coverActive--;
          _drainCoverQueue();
        });
    }
  }

  function _applyCoverToDom(trackId, dataUrl) {
    document.querySelectorAll(`[data-id="${trackId}"]`).forEach(item => {
      const art = item.querySelector('.track-art, .recent-art');
      if (art) art.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy" />`;
    });
    const current = Player.getCurrentTrack();
    if (current && current.id === trackId) {
      el.playerArt.innerHTML = `<img src="${dataUrl}" alt="" />`;
    }
  }

  // ── RECENT GRID ────────────────────────────────
  function renderRecent(tracks) {
    if (!tracks.length) {
      el.recentList.innerHTML = `<p class="empty-hint">Nenhuma música tocada ainda.</p>`;
      return;
    }

    el.recentList.innerHTML = tracks.map(track => `
      <div class="recent-item" data-id="${track.id}" role="button" tabindex="0" aria-label="${_escape(track.title)}">
        <div class="recent-art">
          ${track.thumbnail
            ? `<img src="${track.thumbnail}" alt="" loading="lazy" />`
            : _musicIcon(22)}
        </div>
        <span class="recent-name">${_escape(track.title)}</span>
      </div>
    `).join('');

    tracks.forEach(track => _queueCoverFetch(track));
  }

  // ── TRACK LIST ─────────────────────────────────
  function renderTrackList(container, tracks, currentId = null) {
    if (!tracks.length) {
      container.innerHTML = `<p class="empty-hint">Nenhuma música encontrada.</p>`;
      return;
    }

    container.innerHTML = tracks.map((track, i) => `
      <div class="track-item ${track.id === currentId ? 'playing' : ''}"
           data-id="${track.id}"
           data-index="${i}"
           role="button"
           tabindex="0"
           aria-label="${_escape(track.title)} — ${_escape(track.artist)}">
        <input type="checkbox" class="track-select-cb" data-select="${track.id}" tabindex="-1" aria-hidden="true" />
        <span class="track-num">
          ${track.id === currentId
            ? _equalizerIcon()
            : String(i + 1)}
        </span>
        <div class="track-art">
          ${track.thumbnail
            ? `<img src="${track.thumbnail}" alt="" loading="lazy" />`
            : _musicIcon(20)}
        </div>
        <div class="track-info">
          <span class="track-title">${_escape(track.title)}</span>
          <span class="track-meta">${_escape(track.artist)}${track.album ? ' · ' + _escape(track.album) : ''}${track.genre ? ' · ' + _escape(track.genre) : ''}</span>
        </div>
        <span class="track-duration">${track.duration ? Player.formatTime(track.duration) : '—'}</span>
        ${_renderDlButton(track.id)}
        <button class="track-menu-btn" data-menu="${track.id}" aria-label="Mais opções">${_menuIcon()}</button>
      </div>
    `).join('');

    tracks.forEach(track => _queueCoverFetch(track));
  }

  function _menuIcon() {
    return `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
    </svg>`;
  }

  // ── MENU DE AÇÕES DA FAIXA (editar / add à playlist) ──
  // Popover simples e independente, sem framework — app.js registra o
  // que cada ação deve fazer via setTrackMenuHandlers.
  let _trackMenuHandlers = { onEdit: null, onAddToPlaylist: null };

  function setTrackMenuHandlers(handlers) {
    _trackMenuHandlers = { ..._trackMenuHandlers, ...handlers };
  }

  function _closeTrackMenu() {
    document.querySelector('.track-menu-popover')?.remove();
  }

  function _outsideMenuHandler(e) {
    if (!e.target.closest('.track-menu-popover') && !e.target.closest('[data-menu]')) _closeTrackMenu();
  }

  function _openTrackMenu(trackId, anchorEl, tracks) {
    _closeTrackMenu();
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    const pop = document.createElement('div');
    pop.className = 'track-menu-popover';
    pop.innerHTML = `
      <button data-action="edit">✏️ Editar informações</button>
      <button data-action="playlist">➕ Adicionar à playlist</button>
    `;
    document.body.appendChild(pop);

    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = rect.bottom + 4;
    if (top + popRect.height > window.innerHeight) top = rect.top - popRect.height - 4;
    let left = rect.right - popRect.width;
    if (left < 8) left = 8;
    pop.style.top  = `${top}px`;
    pop.style.left = `${left}px`;

    pop.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      _closeTrackMenu();
      if (action === 'edit') _trackMenuHandlers.onEdit?.(track);
      if (action === 'playlist') _trackMenuHandlers.onAddToPlaylist?.(track);
    });

    setTimeout(() => document.addEventListener('click', _outsideMenuHandler, { once: true }), 0);
  }

  // Ícone animado de equalizer para a faixa tocando
  function _equalizerIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="var(--purple-soft)">
      <rect x="1" y="6" width="2" height="10" rx="1">
        <animate attributeName="height" values="10;4;10" dur="0.9s" repeatCount="indefinite"/>
        <animate attributeName="y"      values="6;12;6"  dur="0.9s" repeatCount="indefinite"/>
      </rect>
      <rect x="5" y="2" width="2" height="14" rx="1">
        <animate attributeName="height" values="14;6;14" dur="0.7s" repeatCount="indefinite"/>
        <animate attributeName="y"      values="2;8;2"   dur="0.7s" repeatCount="indefinite"/>
      </rect>
      <rect x="9" y="4" width="2" height="12" rx="1">
        <animate attributeName="height" values="12;5;12" dur="1.1s" repeatCount="indefinite"/>
        <animate attributeName="y"      values="4;10;4"  dur="1.1s" repeatCount="indefinite"/>
      </rect>
      <rect x="13" y="7" width="2" height="9" rx="1">
        <animate attributeName="height" values="9;3;9"   dur="0.8s" repeatCount="indefinite"/>
        <animate attributeName="y"      values="7;13;7"  dur="0.8s" repeatCount="indefinite"/>
      </rect>
    </svg>`;
  }

  // Atualiza qual item da lista está marcado como tocando
  function setPlayingTrack(trackId) {
    document.querySelectorAll('.track-item').forEach(item => {
      const isPlaying = item.dataset.id === trackId;
      item.classList.toggle('playing', isPlaying);
      const numEl = item.querySelector('.track-num');
      if (numEl) {
        numEl.innerHTML = isPlaying
          ? _equalizerIcon()
          : item.dataset.index ? String(parseInt(item.dataset.index) + 1) : '';
      }
    });
  }

  // ── PLAYER UI ──────────────────────────────────
  function showPlayer() {
    el.player.classList.remove('hidden');
  }

  function updatePlayerTrack(track) {
    if (!track) return;
    showPlayer();

    el.playerTitle.textContent  = track.title;
    el.playerArtist.textContent = track.artist;

    if (track.thumbnail) {
      el.playerArt.innerHTML = `<img src="${track.thumbnail}" alt="" />`;
    } else {
      el.playerArt.innerHTML = _musicIcon(24);
      _queueCoverFetch(track, true);
    }

    // Favorito
    const fav = Player.isFavorite(track.id);
    el.btnFav.classList.toggle('active', fav);

    // Download offline
    el.btnDownloadCurrent.dataset.dl = track.id;
    _setDlBtnState(el.btnDownloadCurrent, _dlState(track.id));
  }

  function setPlayState(playing) {
    el.iconPlay.classList.toggle('hidden', playing);
    el.iconPause.classList.toggle('hidden', !playing);
  }

  function updateProgress(current, duration) {
    el.timeCurrent.textContent = Player.formatTime(current);
    el.timeTotal.textContent   = Player.formatTime(duration);

    const pct = duration ? (current / duration) * 100 : 0;
    el.seekBar.value = pct;

    // Gradiente da barra de progresso
    el.seekBar.style.background =
      `linear-gradient(to right, var(--purple) ${pct}%, var(--border) ${pct}%)`;
  }

  function setShuffleState(active) {
    el.btnShuffle.classList.toggle('active', active);
    el.btnShuffle.title = active ? 'Aleatório ativado' : 'Aleatório';
  }

  function setRepeatState(mode) {
    el.btnRepeat.classList.toggle('active', mode !== 'none');
    el.btnRepeat.title = { none: 'Repetir', all: 'Repetir tudo', one: 'Repetir uma' }[mode];

    // Troca o ícone para "repetir uma" quando mode === 'one'
    if (mode === 'one') {
      el.btnRepeat.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          <text x="10" y="14" font-size="7" fill="currentColor" stroke="none" font-weight="bold">1</text>
        </svg>`;
    } else {
      el.btnRepeat.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>`;
    }
  }

  // ── ONBOARDING MODAL ───────────────────────────
  function showOnboarding() {
    el.modalOnboarding.classList.remove('hidden');
  }
  function hideOnboarding() {
    el.modalOnboarding.classList.add('hidden');
  }

  // ── SELETOR DE PASTA ───────────────────────────
  function showFolderModal() {
    el.modalFolder.classList.remove('hidden');
  }
  function hideFolderModal() {
    el.modalFolder.classList.add('hidden');
  }

  function _folderIcon() {
    return `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`;
  }

  function renderFolderList(folders, currentFolderId) {
    const allDriveItem = `
      <div class="folder-item ${!currentFolderId ? 'selected' : ''}" data-id="">
        ${_folderIcon()} Todo o Drive (padrão)
      </div>`;

    if (!folders.length) {
      el.folderList.innerHTML = allDriveItem + `
        <p class="empty-hint">Nenhuma pasta encontrada na raiz do seu Drive.</p>`;
      return;
    }

    el.folderList.innerHTML = allDriveItem + folders.map(f => `
      <div class="folder-item ${f.id === currentFolderId ? 'selected' : ''}" data-id="${f.id}">
        ${_folderIcon()} ${_escape(f.name)}
      </div>
    `).join('');
  }

  function updateFolderLabel(name) {
    el.folderCurrentLabel.textContent = name
      ? `Buscando em: ${name}`
      : 'Buscando em todo o Drive';
  }

  // ── BARRA DE FILTROS (gênero / artista / álbum) ────
  function _fillSelect(select, values, activeValue, placeholder) {
    const current = activeValue || '';
    select.innerHTML = `<option value="">${placeholder}</option>` +
      values.map(v => `<option value="${_escape(v)}" ${v === current ? 'selected' : ''}>${_escape(v)}</option>`).join('');
  }

  function renderFilterOptions({ genres, artists, albums }, active = {}) {
    _fillSelect(el.filterGenre,  genres,  active.genre,  'Gênero');
    _fillSelect(el.filterArtist, artists, active.artist, 'Artista');
    _fillSelect(el.filterAlbum,  albums,  active.album,  'Álbum');

    const hasFilter = !!(active.genre || active.artist || active.album);
    el.btnFilterClear.classList.toggle('hidden', !hasFilter);
  }

  function setFilterSummary(text) {
    if (!text) {
      el.filterSummary.classList.add('hidden');
      el.filterSummary.textContent = '';
    } else {
      el.filterSummary.classList.remove('hidden');
      el.filterSummary.textContent = text;
    }
  }

  // ── MODAL: EDITAR METADADOS DA FAIXA ───────────
  function showTrackEditModal(track, knownGenres = []) {
    el.editFieldTitle.value  = track.title  || '';
    el.editFieldArtist.value = track.artist === 'Desconhecido' ? '' : (track.artist || '');
    el.editFieldAlbum.value  = track.album  || '';
    el.editFieldGenre.value  = track.genre  || '';
    el.genreSuggestions.innerHTML = knownGenres.map(g => `<option value="${_escape(g)}"></option>`).join('');
    el.modalTrackEdit.classList.remove('hidden');
    el.modalTrackEdit.dataset.trackId = track.id;
    el.editFieldTitle.focus();
  }
  function hideTrackEditModal() {
    el.modalTrackEdit.classList.add('hidden');
    delete el.modalTrackEdit.dataset.trackId;
  }
  function getTrackEditForm() {
    return {
      title:  el.editFieldTitle.value.trim(),
      artist: el.editFieldArtist.value.trim(),
      album:  el.editFieldAlbum.value.trim(),
      genre:  el.editFieldGenre.value.trim(),
    };
  }

  // ── UPLOAD DE MÚSICAS ──────────────────────────
  function showUploadModal() { el.modalUpload.classList.remove('hidden'); }
  function hideUploadModal() { el.modalUpload.classList.add('hidden'); }

  // ── PLAYLISTS ───────────────────────────────────
  function _playlistIcon() {
    return `<svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>`;
  }

  function renderPlaylists(playlists) {
    if (!playlists.length) {
      el.playlistsList.innerHTML = `<p class="empty-hint">Nenhuma playlist ainda. Crie a primeira!</p>`;
      return;
    }
    el.playlistsList.innerHTML = playlists.map(p => `
      <div class="playlist-card" data-id="${p.id}" role="button" tabindex="0">
        <div class="playlist-card-art">${_playlistIcon()}</div>
        <span class="playlist-card-name">${_escape(p.name)}</span>
        <span class="playlist-card-count">${p.trackIds.length} música${p.trackIds.length === 1 ? '' : 's'}</span>
      </div>
    `).join('');
  }

  function showPlaylistsRoot() {
    el.playlistsListWrap.classList.remove('hidden');
    el.playlistDetail.classList.add('hidden');
  }
  function showPlaylistDetail(playlist) {
    el.playlistsListWrap.classList.add('hidden');
    el.playlistDetail.classList.remove('hidden');
    el.playlistDetailTitle.textContent = playlist.name;
    el.playlistDetail.dataset.id = playlist.id;
  }

  function renderPlaylistTracks(tracks, currentId = null) {
    if (!tracks.length) {
      el.playlistTracksList.innerHTML = `
        <p class="empty-hint">Essa playlist ainda está vazia.<br>Adicione músicas pelo menu (⋮) de qualquer faixa.</p>`;
      return;
    }
    renderTrackList(el.playlistTracksList, tracks, currentId);
  }

  // ── MODAL: NOVA PLAYLIST ───────────────────────
  function showNewPlaylistModal() {
    el.newPlaylistName.value = '';
    el.modalNewPlaylist.classList.remove('hidden');
    el.newPlaylistName.focus();
  }
  function hideNewPlaylistModal() { el.modalNewPlaylist.classList.add('hidden'); }

  // ── MODAL: ADICIONAR À PLAYLIST ────────────────
  function showAddToPlaylistModal(playlists, trackId) {
    el.addToPlaylistNewName.value = '';
    el.modalAddToPlaylist.dataset.trackId = trackId;

    if (!playlists.length) {
      el.addToPlaylistList.innerHTML = `<p class="empty-hint">Você ainda não tem playlists.</p>`;
    } else {
      el.addToPlaylistList.innerHTML = playlists.map(p => `
        <div class="folder-item playlist-pick-item ${p.trackIds.includes(trackId) ? 'selected' : ''}" data-id="${p.id}">
          ${_playlistIcon()}
          <span style="flex:1;">${_escape(p.name)}</span>
          <span class="profile-section-hint" style="margin:0;">${p.trackIds.includes(trackId) ? '✓ na playlist' : 'adicionar'}</span>
        </div>
      `).join('');
    }
    el.modalAddToPlaylist.classList.remove('hidden');
  }
  function hideAddToPlaylistModal() {
    el.modalAddToPlaylist.classList.add('hidden');
    delete el.modalAddToPlaylist.dataset.trackId;
  }

  // ── SELEÇÃO MÚLTIPLA (atribuir gênero em lote) ─
  function isSelectMode(container) {
    return container.classList.contains('select-mode');
  }

  function setSelectMode(container, on) {
    container.classList.toggle('select-mode', on);
    if (!on) {
      container.querySelectorAll('.track-item.selected').forEach(item => {
        item.classList.remove('selected');
        const cb = item.querySelector('.track-select-cb');
        if (cb) cb.checked = false;
      });
    }
  }

  function getSelectedIds(container) {
    return [...container.querySelectorAll('.track-item.selected')].map(item => item.dataset.id);
  }

  function updateSelectionBar(count) {
    el.selectionCount.textContent = count === 1 ? '1 selecionada' : `${count} selecionadas`;
    el.btnSelectionAssignGenre.disabled = count === 0;
  }

  function showSelectionBar() { el.selectionBar.classList.remove('hidden'); }
  function hideSelectionBar() { el.selectionBar.classList.add('hidden'); }

  // ── MODAL: ATRIBUIR GÊNERO EM LOTE ─────────────
  function showBulkGenreModal(count, knownGenres = []) {
    el.bulkGenreCount.textContent = count === 1 ? '1 música selecionada' : `${count} músicas selecionadas`;
    el.bulkGenreField.value = '';
    el.genreSuggestions.innerHTML = knownGenres.map(g => `<option value="${_escape(g)}"></option>`).join('');
    el.bulkGenreProgress.classList.add('hidden');
    el.bulkGenreProgressFill.style.width = '0%';
    el.btnBulkGenreSave.disabled = false;
    el.modalBulkGenre.classList.remove('hidden');
    el.bulkGenreField.focus();
  }
  function hideBulkGenreModal() { el.modalBulkGenre.classList.add('hidden'); }
  function setBulkGenreProgress(done, total) {
    el.bulkGenreProgress.classList.remove('hidden');
    el.bulkGenreProgressFill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  }

  // ── LOADING STATE ──────────────────────────────
  function showLoading(container, rows = 5) {
    container.innerHTML = Array(rows).fill(0).map(() => `
      <div class="track-item skeleton" style="min-height:66px; border-radius:8px;"></div>
    `).join('');
  }

  // ── ESCAPE XSS ────────────────────────────────
  function _escape(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── BIND EVENTOS DO PLAYER ─────────────────────
  function bindPlayerEvents() {

    // Play / Pause
    el.btnPlayPause.addEventListener('click', () => {
      Player.togglePlay();
      setPlayState(Player.isPlaying());
    });

    // Próxima
    el.btnNext.addEventListener('click', () => Player.next());

    // Anterior
    el.btnPrev.addEventListener('click', () => Player.prev());

    // Seek
    el.seekBar.addEventListener('input', () => {
      Player.seekPercent(parseFloat(el.seekBar.value));
    });

    // Shuffle
    el.btnShuffle.addEventListener('click', () => {
      const active = Player.toggleShuffle();
      setShuffleState(active);
      showToast(active ? 'Aleatório ativado' : 'Aleatório desativado');
    });

    // Repeat
    el.btnRepeat.addEventListener('click', () => {
      const mode = Player.cycleRepeat();
      setRepeatState(mode);
      const labels = { none: 'Repetir desativado', all: 'Repetir tudo', one: 'Repetir uma música' };
      showToast(labels[mode]);
    });

    // Favorito
    el.btnFav.addEventListener('click', () => {
      const track = Player.getCurrentTrack();
      if (!track) return;
      const fav = Player.toggleFavorite(track.id);
      el.btnFav.classList.toggle('active', fav);
      showToast(fav ? '❤️ Adicionado aos favoritos' : 'Removido dos favoritos');
    });

    // Download offline da faixa atual
    el.btnDownloadCurrent.addEventListener('click', () => {
      const track = Player.getCurrentTrack();
      if (!track) return;
      if (Downloads.isDownloaded(track.id)) {
        Downloads.removeTrack(track.id);
        showToast('Removida do offline');
      } else if (!Downloads.isDownloading(track.id)) {
        Downloads.downloadTrack(track);
        showToast('Baixando para ouvir offline…');
      }
    });

    // Mantém todos os botões de download da tela sincronizados
    // com o estado real (idle / baixando / baixada)
    Downloads.onChange((id, state) => _applyDownloadState(id, state));

    // Nav inferior
    el.navBtns.forEach(btn => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });

    // Search toggle
    el.btnSearchToggle.addEventListener('click', toggleSearchBar);

    // Avatar → perfil
    el.btnUser.addEventListener('click', () => showView('profile'));

    // Player callbacks
    Player.onPlay(track => {
      updatePlayerTrack(track);
      setPlayState(true);
      setPlayingTrack(track.id);
    });

    Player.on('onLoading', track => {
      updatePlayerTrack(track);
      showToast('Carregando música…', 1500);
    });

    Player.on('onPause', () => setPlayState(false));

    Player.on('onProgress', (current, duration) => {
      updateProgress(current, duration);
    });

    Player.on('onError', () => {
      showToast('Erro ao carregar música. Tente novamente.');
      setPlayState(false);
    });

    // Sem internet: pulou automaticamente pra próxima faixa já baixada
    Player.on('onOfflineSkip', track => {
      showToast(`Sem internet — tocando "${track.title}" (baixada)`, 2500);
    });

    // Sem internet e nenhuma faixa da fila está baixada: não tem pra onde pular
    Player.on('onAllOffline', () => {
      showToast('Sem internet e nenhuma música da fila está baixada.', 3000);
      setPlayState(false);
    });
  }

  // ── BIND EVENTOS DE LISTA ──────────────────────
  function bindTrackListEvents(container, tracks) {
    container.addEventListener('click', e => {
      const dlBtn = e.target.closest('[data-dl]');
      if (dlBtn) {
        e.stopPropagation();
        _handleDownloadClick(dlBtn.dataset.dl, tracks);
        return;
      }

      const menuBtn = e.target.closest('[data-menu]');
      if (menuBtn) {
        e.stopPropagation();
        _openTrackMenu(menuBtn.dataset.menu, menuBtn, tracks);
        return;
      }

      const item = e.target.closest('.track-item');
      if (!item) return;

      if (container.classList.contains('select-mode')) {
        e.stopPropagation();
        const cb = item.querySelector('.track-select-cb');
        if (cb) cb.checked = !cb.checked;
        item.classList.toggle('selected', cb ? cb.checked : false);
        document.dispatchEvent(new CustomEvent('hm-selection-change'));
        return;
      }

      const index = parseInt(item.dataset.index, 10);
      if (isNaN(index)) return;
      Player.loadQueue(tracks, index);
    });

    container.addEventListener('keydown', e => {
      if (e.target.closest('[data-dl]')) return; // deixa o botão lidar com seu próprio Enter/Espaço
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.target.closest('.track-item')?.click();
      }
    });
  }

  function bindRecentEvents(tracks) {
    el.recentList.addEventListener('click', e => {
      const item = e.target.closest('.recent-item');
      if (!item) return;
      const id = item.dataset.id;
      const track = tracks.find(t => t.id === id);
      if (!track) return;
      const index = tracks.indexOf(track);
      Player.loadQueue(tracks, index >= 0 ? index : 0);
    });
  }

  // ── OFFLINE: RESUMO E PROGRESSO DE LOTE ────────
  function setOfflineSummary(text) {
    el.offlineStatus.textContent = text;
  }

  // which: 'all' | 'fav' | null — controla qual botão vira "Cancelar"
  function setDownloadBatchUI(running, done = 0, total = 0, which = null) {
    el.btnDownloadAll.disabled       = running && which !== 'all';
    el.btnDownloadFavorites.disabled = running && which !== 'fav';

    el.btnDownloadAll.textContent       = (running && which === 'all') ? 'Cancelar' : 'Baixar tudo';
    el.btnDownloadFavorites.textContent = (running && which === 'fav') ? 'Cancelar' : 'Baixar favoritas';

    el.btnDownloadAll.classList.toggle('btn-cancel', running && which === 'all');
    el.btnDownloadFavorites.classList.toggle('btn-cancel', running && which === 'fav');

    if (running) {
      el.offlineProgressWrap.classList.remove('hidden');
      const pct = total ? Math.round((done / total) * 100) : 0;
      el.offlineProgressFill.style.width = pct + '%';
      el.offlineProgressText.textContent = `${done} / ${total}`;
    } else {
      el.offlineProgressWrap.classList.add('hidden');
    }
  }

  // ── EXPORT ────────────────────────────────────
  return {
    el,
    showToast,
    showLogin,
    showApp,
    showView,
    getCurrentView,
    toggleSearchBar,
    renderProfile,
    setGreeting,
    renderRecent,
    renderTrackList,
    setPlayingTrack,
    updatePlayerTrack,
    setPlayState,
    updateProgress,
    setShuffleState,
    setRepeatState,
    showLoading,
    showOnboarding,
    hideOnboarding,
    showFolderModal,
    hideFolderModal,
    renderFolderList,
    updateFolderLabel,
    bindPlayerEvents,
    bindTrackListEvents,
    bindRecentEvents,
    refreshDownloadBadges,
    setOfflineSummary,
    setDownloadBatchUI,

    // Filtros
    renderFilterOptions,
    setFilterSummary,

    // Menu da faixa
    setTrackMenuHandlers,

    // Seleção múltipla / gênero em lote
    isSelectMode,
    setSelectMode,
    getSelectedIds,
    updateSelectionBar,
    showSelectionBar,
    hideSelectionBar,
    showBulkGenreModal,
    hideBulkGenreModal,
    setBulkGenreProgress,

    // Edição de metadados
    showTrackEditModal,
    hideTrackEditModal,
    getTrackEditForm,

    // Upload
    showUploadModal,
    hideUploadModal,

    // Playlists
    renderPlaylists,
    showPlaylistsRoot,
    showPlaylistDetail,
    renderPlaylistTracks,
    showNewPlaylistModal,
    hideNewPlaylistModal,
    showAddToPlaylistModal,
    hideAddToPlaylistModal,
  };

})();
