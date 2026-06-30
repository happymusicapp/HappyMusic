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

    // Nav
    navBtns:        document.querySelectorAll('.nav-btn'),

    // Toast
    toast:          $('toast'),

    // Login
    btnLogin:       $('btn-login'),
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
  function setGreeting(name) {
    const hour = new Date().getHours();
    let greeting = 'Olá';
    if (hour >= 5  && hour < 12) greeting = 'Bom dia';
    else if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
    else greeting = 'Boa noite';

    const firstName = name ? name.split(' ')[0] : '';
    const sectionTitle = el.viewHome.querySelector('.section-title');
    if (sectionTitle) {
      sectionTitle.textContent = firstName
        ? `${greeting}, ${firstName} 👋`
        : `${greeting} 👋`;
    }
  }

  // ── ÍCONE DE MÚSICA (fallback sem capa) ───────
  function _musicIcon(size = 24) {
    return `<svg width="${size}" height="${size}" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
    </svg>`;
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
          <span class="track-meta">${_escape(track.artist)}${track.album ? ' · ' + _escape(track.album) : ''}</span>
        </div>
        <span class="track-duration">${track.duration ? Player.formatTime(track.duration) : '—'}</span>
      </div>
    `).join('');
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
    }

    // Favorito
    const fav = Player.isFavorite(track.id);
    el.btnFav.classList.toggle('active', fav);
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
  }

  // ── BIND EVENTOS DE LISTA ──────────────────────
  function bindTrackListEvents(container, tracks) {
    container.addEventListener('click', e => {
      const item = e.target.closest('.track-item');
      if (!item) return;
      const index = parseInt(item.dataset.index, 10);
      if (isNaN(index)) return;
      Player.loadQueue(tracks, index);
    });

    container.addEventListener('keydown', e => {
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
    bindPlayerEvents,
    bindTrackListEvents,
    bindRecentEvents,
  };

})();
