/* ═══════════════════════════════════════════════
   HAPPY MUSIC – drive.js
   Autenticação OAuth 2.0 (PKCE) + Google Drive API
═══════════════════════════════════════════════ */

const Drive = (() => {

  // ── CONFIGURAÇÃO ──────────────────────────────
  const CLIENT_ID   = '399410204831-4mnno8596jcn2s99ve6e30rvdrh6jf0p.apps.googleusercontent.com';
  const REDIRECT_URI = window.location.origin + '/';
  const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');

  // Extensões de áudio suportadas
  const AUDIO_MIME_TYPES = [
    'audio/mpeg',       // .mp3
    'audio/mp4',        // .m4a
    'audio/ogg',        // .ogg
    'audio/wav',        // .wav
    'audio/flac',       // .flac
    'audio/x-flac',
    'audio/aac',
    'audio/webm',
  ];

  // Chaves de armazenamento local
  const KEY_TOKEN      = 'hm_access_token';
  const KEY_EXPIRY     = 'hm_token_expiry';
  const KEY_USER       = 'hm_user';
  const KEY_VERIFIER   = 'hm_pkce_verifier';
  const KEY_FOLDER_ID  = 'hm_folder_id';

  // ── ESTADO INTERNO ────────────────────────────
  let _token  = null;
  let _user   = null;
  let _tracks = [];

  // ── PKCE HELPERS ──────────────────────────────
  function _randomBytes(length) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
  }

  function _base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function _generateVerifier() {
    const bytes = _randomBytes(32);
    return _base64url(bytes);
  }

  async function _generateChallenge(verifier) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(verifier);
    const digest  = await crypto.subtle.digest('SHA-256', data);
    return _base64url(digest);
  }

  // ── OAUTH: INICIAR LOGIN ───────────────────────
  async function login() {
    const verifier   = await _generateVerifier();
    const challenge  = await _generateChallenge(verifier);

    sessionStorage.setItem(KEY_VERIFIER, verifier);

    const params = new URLSearchParams({
      client_id:             CLIENT_ID,
      redirect_uri:          REDIRECT_URI,
      response_type:         'code',
      scope:                 SCOPES,
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      access_type:           'offline',
      prompt:                'consent select_account',
    });

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  // ── OAUTH: TROCAR CÓDIGO POR TOKEN ────────────
  async function handleCallback() {
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const error    = params.get('error');

    if (error || !code) return false;

    const verifier = sessionStorage.getItem(KEY_VERIFIER);
    if (!verifier) return false;

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     CLIENT_ID,
          redirect_uri:  REDIRECT_URI,
          grant_type:    'authorization_code',
          code_verifier: verifier,
        }),
      });

      if (!res.ok) throw new Error('Token exchange failed');

      const data = await res.json();

      _token = data.access_token;
      const expiry = Date.now() + (data.expires_in * 1000);

      localStorage.setItem(KEY_TOKEN,  _token);
      localStorage.setItem(KEY_EXPIRY, expiry);

      window.history.replaceState({}, '', '/');
      sessionStorage.removeItem(KEY_VERIFIER);

      await _fetchUser();
      return true;

    } catch (err) {
      console.error('[Drive] Erro ao trocar código:', err);
      return false;
    }
  }

  // ── TOKEN: RESTAURAR DA SESSÃO ─────────────────
  function restoreSession() {
    const token  = localStorage.getItem(KEY_TOKEN);
    const expiry = parseInt(localStorage.getItem(KEY_EXPIRY) || '0', 10);
    const user   = localStorage.getItem(KEY_USER);

    if (token && expiry > Date.now()) {
      _token = token;
      _user  = user ? JSON.parse(user) : null;
      return true;
    }

    _clearSession();
    return false;
  }

  function isLoggedIn() {
    return !!_token && parseInt(localStorage.getItem(KEY_EXPIRY) || '0', 10) > Date.now();
  }

  function logout() {
    _clearSession();
    _tracks = [];
  }

  function _clearSession() {
    _token = null;
    _user  = null;
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_EXPIRY);
    localStorage.removeItem(KEY_USER);
    localStorage.removeItem(KEY_FOLDER_ID);
  }

  // ── USUÁRIO ───────────────────────────────────
  async function _fetchUser() {
    try {
      const res  = await _get('https://www.googleapis.com/oauth2/v2/userinfo');
      _user = res;
      localStorage.setItem(KEY_USER, JSON.stringify(_user));
    } catch (err) {
      console.warn('[Drive] Não foi possível buscar dados do usuário:', err);
    }
  }

  function getUser() { return _user; }

  // ── REQUISIÇÃO AUTENTICADA ────────────────────
  async function _get(url, params = {}) {
    const qs  = new URLSearchParams(params).toString();
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(qs ? `${url}${sep}${qs}` : url, {
      headers: { Authorization: `Bearer ${_token}` },
    });

    if (res.status === 401) {
      _clearSession();
      throw new Error('UNAUTHORIZED');
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── PASTAS ────────────────────────────────────
  async function listFolders() {
    const data = await _get('https://www.googleapis.com/drive/v3/files', {
      q:        "mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents",
      fields:   'files(id,name)',
      orderBy:  'name',
      pageSize: 50,
    });
    return data.files || [];
  }

  function setFolderId(id) { localStorage.setItem(KEY_FOLDER_ID, id); }
  function getFolderId()    { return localStorage.getItem(KEY_FOLDER_ID); }

  // ── MÚSICAS ───────────────────────────────────
  async function listTracks(folderId = null) {
    const folder = folderId || getFolderId();

    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    const parentQ   = folder ? `'${folder}' in parents and` : '';

    let allFiles = [];
    let pageToken = null;

    do {
      const params = {
        q:        `${parentQ} (${mimeQuery}) and trashed=false`,
        fields:   'nextPageToken,files(id,name,size,mimeType,modifiedTime,thumbnailLink,videoMediaMetadata)',
        orderBy:  'name',
        pageSize: 200,
      };
      if (pageToken) params.pageToken = pageToken;

      const data = await _get('https://www.googleapis.com/drive/v3/files', params);
      allFiles = allFiles.concat(data.files || []);
      pageToken = data.nextPageToken || null;

    } while (pageToken);

    _tracks = allFiles.map(_parseTrack);
    return _tracks;
  }

  function _parseTrack(file) {
    const name     = file.name || '';
    const noExt    = name.replace(/\.[^.]+$/, '');

    const dashIdx  = noExt.indexOf(' - ');
    const artist   = dashIdx > -1 ? noExt.slice(0, dashIdx).trim() : 'Desconhecido';
    const title    = dashIdx > -1 ? noExt.slice(dashIdx + 3).trim() : noExt;

    const duration = file.videoMediaMetadata?.durationMillis
      ? Math.floor(Number(file.videoMediaMetadata.durationMillis) / 1000)
      : null;

    return {
      id:           file.id,
      name:         file.name,
      title,
      artist,
      duration,
      thumbnail:    file.thumbnailLink || null,
      mimeType:     file.mimeType,
      modifiedTime: file.modifiedTime,
      size:         file.size ? parseInt(file.size, 10) : null,
    };
  }

  function getCachedTracks() { return _tracks; }

  function getStreamUrl(fileId) {
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${_token}`;
  }

  function searchTracks(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return _tracks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q)
    );
  }

  return {
    login,
    handleCallback,
    restoreSession,
    isLoggedIn,
    logout,
    getUser,
    listFolders,
    setFolderId,
    getFolderId,
    listTracks,
    getCachedTracks,
    getStreamUrl,
    searchTracks,
  };

})();
