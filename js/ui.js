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
    recentCollectionsShelf: $('recent-collections-shelf'),
    recentCollectionsList:  $('recent-collections-list'),
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
    btnSelectionFavorite:   $('btn-selection-favorite'),
    btnSelectionAddPlaylist:$('btn-selection-add-playlist'),
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
    editCoverPreview:     $('edit-cover-preview-img'),
    editCoverPlaceholder: $('edit-cover-placeholder'),
    editCoverInput:       $('edit-cover-input'),
    btnEditCoverPick:     $('btn-edit-cover-pick'),
    btnEditCoverChoose:   $('btn-edit-cover-choose'),
    btnEditCoverRemove:   $('btn-edit-cover-remove'),
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
    btnPlaylistAddTracks: $('btn-playlist-add-tracks'),
    playlistTracksList:   $('playlist-tracks-list'),

    modalNewPlaylist:     $('modal-new-playlist'),
    newPlaylistName:      $('new-playlist-name'),
    btnNewPlaylistCreate: $('btn-new-playlist-create'),
    btnNewPlaylistCancel: $('btn-new-playlist-cancel'),

    modalAddToPlaylist:      $('modal-add-to-playlist'),
    addToPlaylistSubtitle:   $('add-to-playlist-subtitle'),
    addToPlaylistList:       $('add-to-playlist-list'),
    addToPlaylistNewName:    $('add-to-playlist-new-name'),
    btnAddToPlaylistCreate:  $('btn-add-to-playlist-create'),
    btnAddToPlaylistClose:   $('btn-add-to-playlist-close'),

    modalAddTracksToPlaylist:  $('modal-add-tracks-to-playlist'),
    addTracksPickerSearch:     $('add-tracks-picker-search'),
    addTracksPickerList:       $('add-tracks-picker-list'),
    btnAddTracksPickerConfirm: $('btn-add-tracks-picker-confirm'),
    btnAddTracksPickerClose:   $('btn-add-tracks-picker-close'),

    // Filmes
    movieGrid:            $('movie-grid'),
    btnMovieRefresh:      $('btn-movie-refresh'),
    btnMovieUploadOpen:   $('btn-movie-upload-open'),
    inputUploadMovies:    $('input-upload-movies'),
    movieFilterGenre:     $('movie-filter-genre'),
    btnMovieFilterClear:  $('btn-movie-filter-clear'),

    modalUploadMovie:       $('modal-upload-movie'),
    movieUploadList:        $('movie-upload-list'),
    btnMovieUploadAddMore:  $('btn-movie-upload-add-more'),
    btnMovieUploadSendAll:  $('btn-movie-upload-send-all'),
    btnUploadMovieClose:    $('btn-upload-movie-close'),

    modalMovieEdit:         $('modal-movie-edit'),
    editMovieTitle:         $('edit-movie-title'),
    editMovieGenre:         $('edit-movie-genre'),
    editMovieYear:          $('edit-movie-year'),
    movieGenreSuggestions:  $('movie-genre-suggestions'),
    btnMovieEditSave:       $('btn-movie-edit-save'),
    btnMovieEditCancel:     $('btn-movie-edit-cancel'),

    moviePlayerOverlay:  $('movie-player-overlay'),
    movieVideo:          $('movie-video'),
    moviePlayerTitle:    $('movie-player-title'),
    btnMovieClose:       $('btn-movie-close'),
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
      sectionTitle.textContent = `${greeting}`;
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
      Drive.fetchEmbeddedCover(track.id, track.coverId)
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
      if (art) art.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="" loading="lazy" />` : _musicIcon(20);
    });
    const current = Player.getCurrentTrack();
    if (current && current.id === trackId) {
      el.playerArt.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="" />` : _musicIcon(24);
    }
  }

  // Wrapper público — usado depois de salvar/remover uma capa personalizada
  // no modal de editar informações, pra refletir na hora sem esperar re-render.
  function refreshTrackArt(trackId, dataUrl) {
    _applyCoverToDom(trackId, dataUrl || null);
  }

  // ── RECENT LIST (formato compacto, igual à lista) ─
  function renderRecent(tracks) {
    if (!tracks.length) {
      el.recentList.innerHTML = `<p class="empty-hint">Nenhuma música tocada ainda.</p>`;
      return;
    }

    el.recentList.innerHTML = tracks.map(track => `
      <div class="track-item recent-track-item" data-id="${track.id}" role="button" tabindex="0" aria-label="${_escape(track.title)} — ${_escape(track.artist)}">
        <div class="track-art">
          ${track.thumbnail
            ? `<img src="${track.thumbnail}" alt="" loading="lazy" />`
            : _musicIcon(20)}
        </div>
        <div class="track-info">
          <span class="track-title">${_escape(track.title)}</span>
          <span class="track-meta">${_escape(track.artist)}</span>
        </div>
      </div>
    `).join('');

    tracks.forEach(track => _queueCoverFetch(track));
  }

  // ── COLEÇÕES RECENTES (playlists / favoritas abertas recentemente) ─
  function renderRecentCollections(items) {
    if (!items.length) {
      el.recentCollectionsShelf.classList.add('hidden');
      el.recentCollectionsList.innerHTML = '';
      return;
    }
    el.recentCollectionsShelf.classList.remove('hidden');
    el.recentCollectionsList.innerHTML = items.map(it => `
      <div class="recent-collection-chip" data-id="${it.id}" role="button" tabindex="0" aria-label="${_escape(it.name)}">
        <div class="recent-collection-chip-art ${it.isFavorites ? 'is-fav' : ''}">
          ${it.isFavorites ? _favIcon(true, 24) : _playlistIcon()}
        </div>
        <span class="recent-collection-chip-name">${_escape(it.name)}</span>
      </div>
    `).join('');
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
        ${track.duration ? `<span class="track-duration">${Player.formatTime(track.duration)}</span>` : ''}
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

  function _editIcon() {
    return `<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    </svg>`;
  }

  function _addToPlaylistIcon() {
    return `<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <path d="M3 6h13M3 12h9M3 18h9"/><path d="M18 14v6M15 17h6"/>
    </svg>`;
  }

  function _favIcon(active, size = 17) {
    return `<svg width="${size}" height="${size}" fill="${active ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" ${active ? 'style="color:var(--purple-soft)"' : ''}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>`;
  }

  function _trashIcon() {
    return `<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
    </svg>`;
  }

  function _checkIcon(size = 14) {
    return `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;
  }

  function _playIcon(size = 14) {
    return `<svg width="${size}" height="${size}" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
  }

  // ── MENU DE AÇÕES DA FAIXA (editar / add à playlist) ──
  // Popover simples e independente, sem framework — app.js registra o
  // que cada ação deve fazer via setTrackMenuHandlers.
  let _trackMenuHandlers = { onEdit: null, onAddToPlaylist: null, onDelete: null };

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

    const isFav = Player.isFavorite(track.id);

    const pop = document.createElement('div');
    pop.className = 'track-menu-popover';
    pop.innerHTML = `
      <button data-action="favorite">${_favIcon(isFav)}<span>${isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</span></button>
      <button data-action="edit">${_editIcon()}<span>Editar informações</span></button>
      <button data-action="playlist">${_addToPlaylistIcon()}<span>Adicionar à playlist</span></button>
      <div class="track-menu-popover-divider"></div>
      <button data-action="delete" class="danger">${_trashIcon()}<span>Excluir do Drive</span></button>
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
      if (action === 'delete') _trackMenuHandlers.onDelete?.(track);
      if (action === 'favorite') {
        const fav = Player.toggleFavorite(track.id);
        showToast(fav ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
        const current = Player.getCurrentTrack();
        if (current && current.id === track.id) el.btnFav.classList.toggle('active', fav);
        document.dispatchEvent(new CustomEvent('hm-favorite-change', { detail: { trackId: track.id, isFav: fav } }));
      }
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
    el.btnPlayPause.classList.toggle('is-playing', playing);
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
    select.classList.toggle('active', !!current);
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
  // Estado do seletor de capa — não dá pra guardar um File num <input
  // type=text>, então fica numa variável do módulo enquanto o modal
  // está aberto. `_editCoverAction` diz o que fazer ao salvar:
  // null = não mexe na capa · 'set' = subir _editCoverFile · 'remove' = tirar a capa atual.
  let _editCoverFile   = null;
  let _editCoverAction = null;

  function _setCoverPreview(dataUrl) {
    if (dataUrl) {
      el.editCoverPreview.src = dataUrl;
      el.editCoverPreview.classList.remove('hidden');
      el.editCoverPlaceholder.classList.add('hidden');
      el.btnEditCoverRemove.classList.remove('hidden');
    } else {
      el.editCoverPreview.src = '';
      el.editCoverPreview.classList.add('hidden');
      el.editCoverPlaceholder.classList.remove('hidden');
      el.btnEditCoverRemove.classList.add('hidden');
    }
  }

  function showTrackEditModal(track, knownGenres = []) {
    el.editFieldTitle.value  = track.title  || '';
    el.editFieldArtist.value = track.artist === 'Desconhecido' ? '' : (track.artist || '');
    el.editFieldAlbum.value  = track.album  || '';
    el.editFieldGenre.value  = track.genre  || '';
    el.genreSuggestions.innerHTML = knownGenres.map(g => `<option value="${_escape(g)}"></option>`).join('');

    _editCoverFile   = null;
    _editCoverAction = null;
    el.editCoverInput.value = '';
    _setCoverPreview(track.thumbnail || null);

    el.modalTrackEdit.classList.remove('hidden');
    el.modalTrackEdit.dataset.trackId = track.id;
    el.editFieldTitle.focus();
  }
  function hideTrackEditModal() {
    el.modalTrackEdit.classList.add('hidden');
    delete el.modalTrackEdit.dataset.trackId;
    _editCoverFile   = null;
    _editCoverAction = null;
  }
  function getTrackEditForm() {
    return {
      title:  el.editFieldTitle.value.trim(),
      artist: el.editFieldArtist.value.trim(),
      album:  el.editFieldAlbum.value.trim(),
      genre:  el.editFieldGenre.value.trim(),
      coverAction: _editCoverAction, // null | 'set' | 'remove'
      coverFile:   _editCoverFile,   // File, só quando coverAction === 'set'
    };
  }

  // Escolher imagem (toca na miniatura ou no botão "Escolher imagem")
  function _bindCoverPickerEvents() {
    const openPicker = () => el.editCoverInput.click();
    el.btnEditCoverPick.addEventListener('click', openPicker);
    el.btnEditCoverChoose.addEventListener('click', openPicker);

    el.editCoverInput.addEventListener('change', () => {
      const file = el.editCoverInput.files && el.editCoverInput.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Escolha um arquivo de imagem.');
        return;
      }
      _editCoverFile   = file;
      _editCoverAction = 'set';

      const reader = new FileReader();
      reader.onload = () => _setCoverPreview(reader.result);
      reader.readAsDataURL(file);
    });

    el.btnEditCoverRemove.addEventListener('click', () => {
      _editCoverFile   = null;
      _editCoverAction = 'remove';
      el.editCoverInput.value = '';
      _setCoverPreview(null);
    });
  }
  _bindCoverPickerEvents();

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
    const favCount = Player.getFavorites().length;
    const favCard = `
      <div class="playlist-card playlist-card-fav" data-id="__favorites__" role="button" tabindex="0">
        <div class="playlist-card-art playlist-card-art-fav">${_favIcon(true, 26)}</div>
        <span class="playlist-card-name">Favoritas</span>
        <span class="playlist-card-count">${favCount} música${favCount === 1 ? '' : 's'}</span>
      </div>`;

    if (!playlists.length) {
      el.playlistsList.innerHTML = favCard + `<p class="empty-hint">Nenhuma playlist ainda. Crie a primeira!</p>`;
      return;
    }
    el.playlistsList.innerHTML = favCard + playlists.map(p => `
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
  function showPlaylistDetail(playlist, opts = {}) {
    el.playlistsListWrap.classList.add('hidden');
    el.playlistDetail.classList.remove('hidden');
    el.playlistDetailTitle.textContent = playlist.name;
    el.playlistDetail.dataset.id = playlist.id;
    const isFav = !!opts.isFavorites;
    el.btnPlaylistDelete.classList.toggle('hidden', isFav);
    el.btnPlaylistAddTracks.classList.toggle('hidden', isFav);
  }

  function renderPlaylistTracks(tracks, currentId = null, isFavorites = false) {
    if (!tracks.length) {
      el.playlistTracksList.innerHTML = isFavorites
        ? `<p class="empty-hint">Você ainda não tem favoritas.<br>Toque no ❤ do menu de qualquer faixa para adicionar.</p>`
        : `<p class="empty-hint">Essa playlist ainda está vazia.<br>Toque em "Adicionar músicas" acima ou use o menu de qualquer faixa.</p>`;
      return;
    }
    renderTrackList(el.playlistTracksList, tracks, currentId);
    bindTrackListEvents(el.playlistTracksList, tracks);
  }

  // ── MODAL: NOVA PLAYLIST ───────────────────────
  function showNewPlaylistModal() {
    el.newPlaylistName.value = '';
    el.modalNewPlaylist.classList.remove('hidden');
    el.newPlaylistName.focus();
  }
  function hideNewPlaylistModal() { el.modalNewPlaylist.classList.add('hidden'); }

  // ── MODAL: ADICIONAR À PLAYLIST ────────────────
  function showAddToPlaylistModal(playlists, trackIdOrIds) {
    const ids = Array.isArray(trackIdOrIds) ? trackIdOrIds : [trackIdOrIds];
    el.addToPlaylistNewName.value = '';
    el.modalAddToPlaylist.dataset.trackIds = JSON.stringify(ids);

    if (ids.length > 1) {
      el.addToPlaylistSubtitle.textContent = `${ids.length} músicas selecionadas`;
      el.addToPlaylistSubtitle.classList.remove('hidden');
    } else {
      el.addToPlaylistSubtitle.classList.add('hidden');
    }

    if (!playlists.length) {
      el.addToPlaylistList.innerHTML = `<p class="empty-hint">Você ainda não tem playlists.</p>`;
    } else {
      el.addToPlaylistList.innerHTML = playlists.map(p => {
        const allIn  = ids.every(id => p.trackIds.includes(id));
        const someIn = !allIn && ids.some(id => p.trackIds.includes(id));
        const hint = allIn ? (_checkIcon(13) + ' na playlist') : someIn ? 'algumas na playlist' : 'adicionar';
        return `
          <div class="folder-item playlist-pick-item ${allIn ? 'selected' : ''}" data-id="${p.id}">
            ${_playlistIcon()}
            <span style="flex:1;">${_escape(p.name)}</span>
            <span class="profile-section-hint" style="margin:0; display:flex; align-items:center; gap:4px;">${hint}</span>
          </div>
        `;
      }).join('');
    }
    el.modalAddToPlaylist.classList.remove('hidden');
  }
  function hideAddToPlaylistModal() {
    el.modalAddToPlaylist.classList.add('hidden');
    delete el.modalAddToPlaylist.dataset.trackIds;
  }

  // ── MODAL: ADICIONAR MÚSICAS A UMA PLAYLIST (picker) ──
  function showAddTracksPickerModal(tracks, selectedIds) {
    el.addTracksPickerSearch.value = '';
    renderAddTracksPicker(tracks, selectedIds);
    el.modalAddTracksToPlaylist.classList.remove('hidden');
    el.addTracksPickerSearch.focus();
  }
  function hideAddTracksPickerModal() {
    el.modalAddTracksToPlaylist.classList.add('hidden');
  }
  function renderAddTracksPicker(tracks, selectedIds) {
    if (!tracks.length) {
      el.addTracksPickerList.innerHTML = `<p class="empty-hint">Nenhuma música encontrada.</p>`;
      return;
    }
    el.addTracksPickerList.innerHTML = tracks.map(t => `
      <div class="folder-item track-picker-item ${selectedIds.has(t.id) ? 'selected' : ''}" data-id="${t.id}">
        <input type="checkbox" ${selectedIds.has(t.id) ? 'checked' : ''} tabindex="-1" />
        <span style="flex:1; min-width:0; overflow:hidden;">
          <span class="track-title" style="display:block;">${_escape(t.title)}</span>
          <span class="track-meta" style="display:block;">${_escape(t.artist)}</span>
        </span>
      </div>
    `).join('');
  }

  // ── FILMES ──────────────────────────────────────
  function _filmIcon(size = 26) {
    return `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <rect x="2.5" y="5" width="19" height="14" rx="2"/>
      <path d="M7 5v14M17 5v14M2.5 9.5H7M17 9.5h4.5M2.5 14.5H7M17 14.5h4.5"/>
    </svg>`;
  }

  function _playCircleIcon() {
    return `<svg width="34" height="34" fill="rgba(255,255,255,0.95)" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
  }

  function _formatYearGenre(video) {
    return [video.year, video.genre].filter(Boolean).join(' · ') || 'Sem informações';
  }

  function renderMovieGrid(videos) {
    if (!videos.length) {
      el.movieGrid.innerHTML = `<p class="empty-hint">Nenhum filme ainda.<br>Toque no ➕ acima pra enviar o primeiro.</p>`;
      return;
    }
    el.movieGrid.innerHTML = videos.map(v => `
      <div class="movie-card" data-id="${v.id}" role="button" tabindex="0">
        <div class="movie-card-art" ${v.thumbnail ? `style="background-image:url('${v.thumbnail}')"` : ''}>
          ${v.thumbnail ? '' : _filmIcon(30)}
          <span class="movie-card-play">${_playCircleIcon()}</span>
        </div>
        <button class="movie-card-edit" data-edit="${v.id}" aria-label="Editar informações">${_editIcon()}</button>
        <span class="movie-card-name">${_escape(v.title)}</span>
        <span class="movie-card-meta">${_escape(_formatYearGenre(v))}</span>
      </div>
    `).join('');
  }

  const _movieGridData = new WeakMap();
  let _movieMenuHandlers = { onEdit: null, onPlay: null };

  function setMovieMenuHandlers(handlers) {
    _movieMenuHandlers = { ..._movieMenuHandlers, ...handlers };
  }

  function bindMovieGridEvents(container, videos) {
    _movieGridData.set(container, videos);
    if (container.dataset.hmBound) return;
    container.dataset.hmBound = '1';

    container.addEventListener('click', e => {
      const currentVideos = _movieGridData.get(container) || [];

      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        e.stopPropagation();
        const video = currentVideos.find(v => v.id === editBtn.dataset.edit);
        if (video) _movieMenuHandlers.onEdit?.(video);
        return;
      }

      const card = e.target.closest('.movie-card');
      if (!card) return;
      const video = currentVideos.find(v => v.id === card.dataset.id);
      if (video) _movieMenuHandlers.onPlay?.(video);
    });
  }

  // ── FILTRO DE FILMES (gênero) ───────────────────
  function renderMovieFilterOptions(genres, activeGenre = '') {
    _fillSelect(el.movieFilterGenre, genres, activeGenre, 'Gênero');
    el.btnMovieFilterClear.classList.toggle('hidden', !activeGenre);
  }

  // ── MODAL: ENVIAR FILMES ────────────────────────
  function showMovieUploadModal() { el.modalUploadMovie.classList.remove('hidden'); }
  function hideMovieUploadModal() { el.modalUploadMovie.classList.add('hidden'); }

  // ── MODAL: EDITAR INFORMAÇÕES DO FILME ─────────
  function showMovieEditModal(video, knownGenres = []) {
    el.editMovieTitle.value = video.title || '';
    el.editMovieGenre.value = video.genre || '';
    el.editMovieYear.value  = video.year  || '';
    el.movieGenreSuggestions.innerHTML = knownGenres.map(g => `<option value="${_escape(g)}"></option>`).join('');
    el.modalMovieEdit.classList.remove('hidden');
    el.modalMovieEdit.dataset.videoId = video.id;
    el.editMovieTitle.focus();
  }
  function hideMovieEditModal() {
    el.modalMovieEdit.classList.add('hidden');
    delete el.modalMovieEdit.dataset.videoId;
  }
  function getMovieEditForm() {
    return {
      title: el.editMovieTitle.value.trim(),
      genre: el.editMovieGenre.value.trim(),
      year:  el.editMovieYear.value.trim(),
    };
  }

  // ── PLAYER DE FILME (tela cheia) ────────────────
  function openMoviePlayer(title, streamUrl) {
    el.moviePlayerTitle.textContent = title;
    el.movieVideo.src = streamUrl;
    el.moviePlayerOverlay.classList.remove('hidden');
    el.movieVideo.play().catch(() => {}); // autoplay pode ser bloqueado; controles nativos resolvem
  }
  function closeMoviePlayer() {
    el.movieVideo.pause();
    el.movieVideo.removeAttribute('src');
    el.movieVideo.load();
    el.moviePlayerOverlay.classList.add('hidden');
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
    el.btnSelectionFavorite.disabled = count === 0;
    el.btnSelectionAddPlaylist.disabled = count === 0;
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
      showToast(fav ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
      document.dispatchEvent(new CustomEvent('hm-favorite-change', { detail: { trackId: track.id, isFav: fav } }));
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
  // As listas são re-renderizadas várias vezes (filtro, busca, upload,
  // edição...). Sem isso, cada chamada empilhava outro listener no mesmo
  // container e um clique disparava a ação repetida vezes — é o que
  // fazia a seleção de músicas "não funcionar" (selecionava e
  // desselecionava no mesmo clique). Agora o listener é criado uma
  // única vez por container; só a referência de tracks é atualizada.
  const _trackListData = new WeakMap();

  function bindTrackListEvents(container, tracks) {
    _trackListData.set(container, tracks);
    if (container.dataset.hmBound) return;
    container.dataset.hmBound = '1';

    container.addEventListener('click', e => {
      const currentTracks = _trackListData.get(container) || [];

      const dlBtn = e.target.closest('[data-dl]');
      if (dlBtn) {
        e.stopPropagation();
        _handleDownloadClick(dlBtn.dataset.dl, currentTracks);
        return;
      }

      const menuBtn = e.target.closest('[data-menu]');
      if (menuBtn) {
        e.stopPropagation();
        _openTrackMenu(menuBtn.dataset.menu, menuBtn, currentTracks);
        return;
      }

      const item = e.target.closest('.track-item');
      if (!item) return;

      if (container.classList.contains('select-mode')) {
        e.stopPropagation();
        const cb = item.querySelector('.track-select-cb');
        if (cb) {
          // Se o toque foi direto no quadradinho, o navegador já inverteu o
          // estado dele sozinho (comportamento nativo do checkbox) — inverter
          // de novo aqui cancelaria o toque. Só inverte manualmente quando o
          // clique veio de outro lugar da linha (nome, foto, etc.).
          if (e.target !== cb) cb.checked = !cb.checked;
          item.classList.toggle('selected', cb.checked);
        }
        document.dispatchEvent(new CustomEvent('hm-selection-change'));
        return;
      }

      const index = parseInt(item.dataset.index, 10);
      if (isNaN(index)) return;
      Player.loadQueue(currentTracks, index);
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
    _trackListData.set(el.recentList, tracks);
    if (el.recentList.dataset.hmBound) return;
    el.recentList.dataset.hmBound = '1';

    el.recentList.addEventListener('click', e => {
      const currentTracks = _trackListData.get(el.recentList) || [];
      const item = e.target.closest('.track-item');
      if (!item) return;
      const id = item.dataset.id;
      const track = currentTracks.find(t => t.id === id);
      if (!track) return;
      const index = currentTracks.indexOf(track);
      Player.loadQueue(currentTracks, index >= 0 ? index : 0);
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
    renderRecentCollections,
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
    checkIcon: _checkIcon,
    playIcon: _playIcon,

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
    refreshTrackArt,

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
    showAddTracksPickerModal,
    hideAddTracksPickerModal,
    renderAddTracksPicker,

    // Filmes
    renderMovieGrid,
    bindMovieGridEvents,
    setMovieMenuHandlers,
    renderMovieFilterOptions,
    showMovieUploadModal,
    hideMovieUploadModal,
    showMovieEditModal,
    hideMovieEditModal,
    getMovieEditForm,
    openMoviePlayer,
    closeMoviePlayer,
  };

})();
