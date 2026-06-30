/* ═══════════════════════════════════════════════
   HAPPY MUSIC – app.js
   Orquestrador principal: init, auth, carregamento
═══════════════════════════════════════════════ */

const App = (() => {

  // ── ESTADO ────────────────────────────────────
  let _tracks = [];   // todas as faixas carregadas
  let _initialized = false;
  const KEY_ONBOARDED = 'hm_onboarded';
  const GDRIVE_URL = 'https://drive.google.com/drive/my-drive';

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
        return;
      }
    }

    // 3. Tenta restaurar sessão existente
    if (Drive.restoreSession()) {
      await _startApp();
    } else {
      UI.showLogin();
    }
  }

  // ── INICIAR APP PÓS-LOGIN ──────────────────────
  async function _startApp() {
    UI.showApp();

    const user = Drive.getUser();
    UI.renderProfile(user);
    UI.setGreeting(user?.name);
    _updateFolderLabel();

    if (!localStorage.getItem(KEY_ONBOARDED)) {
      UI.showOnboarding();
    }

    await _loadTracks();
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
            Adicione arquivos de áudio à pasta do Google Drive.
            <br><br>
            <button id="btn-empty-drive" class="btn-outline btn-small">Abrir Google Drive</button>
          </div>`;
        const btn = document.getElementById('btn-empty-drive');
        if (btn) btn.addEventListener('click', () => window.open(GDRIVE_URL, '_blank'));
        _renderRecent();
        return;
      }

      // Renderiza lista completa
      UI.renderTrackList(UI.el.allTracksList, _tracks, _currentId());
      UI.bindTrackListEvents(UI.el.allTracksList, _tracks);

      // Recentes
      _renderRecent();

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
    const recent = Player.getRecent();
    // Cruza com _tracks pra garantir dados completos e atualizados
    const recentFull = recent
      .map(r => _tracks.find(t => t.id === r.id) || r)
      .filter(Boolean);

    UI.renderRecent(recentFull);
    UI.bindRecentEvents(_tracks);
  }

  function _currentId() {
    return Player.getCurrentTrack()?.id || null;
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
      UI.showToast('Até logo! 👋');
    });

    // Atualizar lista
    UI.el.btnRefresh.addEventListener('click', async () => {
      UI.showToast('Atualizando músicas…');
      await _loadTracks();
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
        UI.setGreeting(Drive.getUser()?.name);
      }
    });

    // Erros de rede globais
    window.addEventListener('online',  () => UI.showToast('Conexão restaurada ✓'));
    window.addEventListener('offline', () => UI.showToast('Sem conexão com a internet'));
  }

  // ── EXPORT ────────────────────────────────────
  return { init };

})();

// ── ARRANQUE ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
