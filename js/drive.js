/* ═══════════════════════════════════════════════
   HAPPY MUSIC – drive.js
   Autenticação OAuth 2.0 (PKCE) + Google Drive API
═══════════════════════════════════════════════ */

const Drive = (() => {

  // ── CONFIGURAÇÃO ──────────────────────────────
  const CLIENT_ID   = '1097906554235-06h3ll6bn26opgqsddohls1d2a0mct5p.apps.googleusercontent.com';
  const REDIRECT_URI = window.location.origin + '/';
  // 'drive' (não só 'drive.readonly') porque agora o app também precisa
  // enviar arquivos novos e editar metadados (gênero/artista/álbum/título)
  // de faixas que já existiam no Drive antes do app existir.
  // 'drive.appdata' guarda as playlists numa pasta invisível ao usuário,
  // sincronizada com a conta Google, sem poluir o Drive dele.
  const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.appdata',
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
    'audio/x-m4a',
  ];

  // Fallback por extensão — alguns navegadores/SOs não preenchem o
  // `file.type` corretamente pra certos formatos de áudio.
  const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'ogg', 'oga', 'wav', 'flac', 'aac', 'webm', 'wma'];

  // Verifica se um File escolhido pelo usuário é realmente um arquivo de áudio,
  // pra nunca deixar subir algo errado (foto, PDF etc) sem querer.
  function isAudioFile(file) {
    if (!file) return false;
    if (file.type && (file.type.startsWith('audio/') || AUDIO_MIME_TYPES.includes(file.type))) return true;
    const ext = (file.name || '').split('.').pop().toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  }

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
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          redirect_uri:  REDIRECT_URI,
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
    localStorage.removeItem('hm_folder_name');
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
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
    });
    return data.files || [];
  }

  function setFolderId(id) {
    if (id) {
      localStorage.setItem(KEY_FOLDER_ID, id);
    } else {
      localStorage.removeItem(KEY_FOLDER_ID);
    }
  }
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
        fields:   'nextPageToken,files(id,name,size,mimeType,modifiedTime,thumbnailLink,videoMediaMetadata,properties)',
        orderBy:  'name',
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: 'allDrives',
      };
      if (pageToken) params.pageToken = pageToken;

      const data = await _get('https://www.googleapis.com/drive/v3/files', params);
      allFiles = allFiles.concat(data.files || []);
      pageToken = data.nextPageToken || null;

    } while (pageToken);

    _tracks = allFiles.map(_parseTrack);
    return _tracks;
  }

  // Metadados "cadastrados" pelo usuário (upload/edição pelo app) ficam
  // gravados como `properties` do arquivo no Drive — sobrevivem a
  // renomear o arquivo e não dependem de convenção de nome nenhuma.
  // Quando não existem (arquivo adicionado direto pelo Drive, do jeito
  // antigo), cai graciosamente pro parsing do nome:
  // "Artista - Álbum - Faixa - Título.ext"
  function _parseTrack(file) {
    const name  = file.name || '';
    const noExt = name.replace(/\.[^.]+$/, '');
    const props = file.properties || {};

    const hasCustomMetadata = !!(props.hm_title || props.hm_artist || props.hm_album || props.hm_genre);

    let artist, album, genre, title, trackNumber = null;

    if (hasCustomMetadata) {
      title  = props.hm_title  || noExt;
      artist = props.hm_artist || 'Desconhecido';
      album  = props.hm_album  || null;
      genre  = props.hm_genre  || null;
    } else {
      const parts = noExt.split(' - ').map(p => p.trim()).filter(Boolean);
      artist = 'Desconhecido';
      album  = null;
      genre  = null;
      title  = noExt;
      let track = null;

      if (parts.length >= 4) {
        // Artista - Álbum - Faixa - Título
        artist = parts[0];
        album  = parts[1];
        track  = parts[2];
        title  = parts.slice(3).join(' - ');
      } else if (parts.length === 3) {
        // Artista - Álbum - Título  (sem número de faixa)
        [artist, album, title] = parts;
      } else if (parts.length === 2) {
        // Artista - Título
        [artist, title] = parts;
      }
      // parts.length <= 1 → mantém title = nome completo, artist = 'Desconhecido'

      // Número da faixa: extrai dígitos (01 → 1)
      trackNumber = track && /^\d+$/.test(track) ? parseInt(track, 10) : null;
    }

    const duration = file.videoMediaMetadata?.durationMillis
      ? Math.floor(Number(file.videoMediaMetadata.durationMillis) / 1000)
      : null;

    return {
      id:           file.id,
      name:         file.name,
      title,
      artist,
      album,
      genre,
      trackNumber,
      hasCustomMetadata,
      duration,
      thumbnail:    file.thumbnailLink || null,
      mimeType:     file.mimeType,
      modifiedTime: file.modifiedTime,
      size:         file.size ? parseInt(file.size, 10) : null,
    };
  }

  function getCachedTracks() { return _tracks; }

  // ── STREAMING ─────────────────────────────────
  // O Google Drive bloqueia o token como query param em alt=media.
  // Por isso buscamos o áudio via fetch (header Authorization) e
  // criamos uma Object URL local para o <audio> tocar.
  const _blobCache = new Map(); // fileId -> object URL (evita re-fetch)

  async function fetchAudioUrl(fileId) {
    if (_blobCache.has(fileId)) return _blobCache.get(fileId);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${_token}` } }
    );

    if (res.status === 401) {
      _clearSession();
      throw new Error('UNAUTHORIZED');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    _blobCache.set(fileId, objectUrl);
    return objectUrl;
  }

  // Libera memória de um blob específico (chamar ao trocar de música, se quiser)
  function revokeAudioUrl(fileId) {
    const url = _blobCache.get(fileId);
    if (url) {
      URL.revokeObjectURL(url);
      _blobCache.delete(fileId);
    }
  }

  function searchTracks(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return _tracks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album && t.album.toLowerCase().includes(q)) ||
      (t.genre && t.genre.toLowerCase().includes(q)) ||
      t.name.toLowerCase().includes(q)
    );
  }

  // ── FILTROS (gênero / artista / álbum) ─────────
  // Listas de valores distintos já vistos, pra popular os <select> de
  // filtro sem duplicar nem precisar de outra chamada à API.
  function _facetValues(field) {
    const set = new Set();
    _tracks.forEach(t => { if (t[field]) set.add(t[field]); });
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function getKnownGenres()  { return _facetValues('genre'); }
  function getKnownArtists() { return _facetValues('artist'); }
  function getKnownAlbums()  { return _facetValues('album'); }

  function filterTracks({ genre, artist, album } = {}) {
    return _tracks.filter(t =>
      (!genre  || t.genre  === genre) &&
      (!artist || t.artist === artist) &&
      (!album  || t.album  === album)
    );
  }

  // ── CAPA EMBUTIDA (ID3 / MP4) ──────────────────
  // O Drive raramente gera thumbnailLink pra áudio (diferente de imagem/vídeo),
  // então quando falta capa buscamos a arte embutida no próprio arquivo
  // (tag ID3 APIC no MP3, atom "covr" no M4A) lendo só o início do arquivo.
  const _coverCache = new Map(); // fileId -> dataURL | null

  async function fetchEmbeddedCover(fileId) {
    if (_coverCache.has(fileId)) return _coverCache.get(fileId);
    if (!_token) return null;

    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${_token}`,
            Range: 'bytes=0-1500000', // 1.5MB costuma bastar pra capa embutida
          },
        }
      );

      if (res.status === 401) {
        _clearSession();
        throw new Error('UNAUTHORIZED');
      }
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const dataUrl = await _readCoverFromBlob(blob);
      _coverCache.set(fileId, dataUrl);
      return dataUrl;

    } catch (err) {
      console.warn('[Drive] capa embutida indisponível:', fileId, err);
      _coverCache.set(fileId, null);
      return null;
    }
  }

  function _readCoverFromBlob(blob) {
    return new Promise(resolve => {
      if (typeof jsmediatags === 'undefined') { resolve(null); return; }
      jsmediatags.read(blob, {
        onSuccess: tag => {
          const pic = tag?.tags?.picture;
          if (!pic || !pic.data || !pic.data.length) { resolve(null); return; }
          try {
            let binary = '';
            const bytes = pic.data;
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.slice(i, i + chunkSize));
            }
            resolve(`data:${pic.format};base64,${btoa(binary)}`);
          } catch (e) {
            resolve(null);
          }
        },
        onError: () => resolve(null),
      });
    });
  }

  // ── ENVIO DE MÚSICAS (upload resumable + tags) ─
  // Sobe o arquivo pro Drive já com gênero/artista/álbum/título
  // cadastrados como `properties`. Usa upload resumable — se a conexão
  // cair no meio, retoma de onde parou em vez de reenviar tudo de novo
  // (até 3 tentativas automáticas).
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function _initResumableSession(meta, file) {
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true' +
      '&fields=id,name,size,mimeType,modifiedTime,thumbnailLink,videoMediaMetadata,properties',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${_token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': meta.mimeType,
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify(meta),
      }
    );

    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (!res.ok) throw new Error(`Falha ao iniciar envio (HTTP ${res.status})`);

    const location = res.headers.get('Location');
    if (!location) throw new Error('O Drive não retornou uma sessão de envio válida.');
    return location;
  }

  // Pergunta ao Drive quantos bytes já recebeu (protocolo resumable) e
  // reenvia só o restante — é isso que torna o upload "à prova de queda".
  function _uploadChunk(sessionUrl, blob, startOffset, totalSize, onProgress, attempt = 0) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', sessionUrl, true);
      if (startOffset > 0 || blob.size !== totalSize) {
        xhr.setRequestHeader('Content-Range', `bytes ${startOffset}-${totalSize - 1}/${totalSize}`);
      }

      xhr.upload.onprogress = e => {
        if (onProgress) onProgress(Math.min(totalSize, startOffset + e.loaded), totalSize);
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('Resposta inválida do Drive ao enviar o arquivo.')); }
          return;
        }
        if (xhr.status === 401) { _clearSession(); reject(new Error('UNAUTHORIZED')); return; }
        if (attempt >= 3) { reject(new Error(`Falha no envio (HTTP ${xhr.status}) após várias tentativas.`)); return; }

        try {
          await _sleep(1000 * (attempt + 1));
          resolve(await _resumeUpload(sessionUrl, blob, totalSize, onProgress, attempt + 1));
        } catch (err) { reject(err); }
      };

      xhr.onerror = async () => {
        if (attempt >= 3) { reject(new Error('Erro de rede durante o envio. Tente novamente mais tarde.')); return; }
        try {
          await _sleep(1000 * (attempt + 1));
          resolve(await _resumeUpload(sessionUrl, blob, totalSize, onProgress, attempt + 1));
        } catch (err) { reject(err); }
      };

      xhr.send(blob);
    });
  }

  async function _resumeUpload(sessionUrl, originalBlob, totalSize, onProgress, attempt) {
    // Pergunta ao Drive onde parou
    const check = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${totalSize}` },
    }).catch(() => null);

    if (check && check.status >= 200 && check.status < 300) {
      return check.json(); // já tinha concluído antes de cair a conexão
    }

    let received = 0;
    if (check && check.status === 308) {
      const range = check.headers.get('Range'); // formato "bytes=0-12345"
      if (range) received = parseInt(range.split('-')[1], 10) + 1;
    }

    const remaining = originalBlob.slice(received);
    return _uploadChunk(sessionUrl, remaining, received, totalSize, onProgress, attempt);
  }

  async function uploadTrack(file, metadata = {}, { folderId, onProgress } = {}) {
    if (!isAudioFile(file)) throw new Error('Esse arquivo não é um áudio suportado.');

    const targetFolder = folderId || getFolderId();
    const meta = {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      properties: {
        hm_title:  (metadata.title  || '').slice(0, 120),
        hm_artist: (metadata.artist || 'Desconhecido').slice(0, 120),
        hm_album:  (metadata.album  || '').slice(0, 120),
        hm_genre:  (metadata.genre  || '').slice(0, 60),
      },
    };
    if (targetFolder) meta.parents = [targetFolder];

    const sessionUrl = await _initResumableSession(meta, file);
    const created = await _uploadChunk(sessionUrl, file, 0, file.size, onProgress);

    const parsed = _parseTrack(created);
    _tracks = [..._tracks, parsed];
    return parsed;
  }

  // ── EDITAR METADADOS DE UMA FAIXA EXISTENTE ────
  async function updateTrackMetadata(fileId, metadata = {}) {
    const body = {
      properties: {
        hm_title:  (metadata.title  || '').slice(0, 120),
        hm_artist: (metadata.artist || 'Desconhecido').slice(0, 120),
        hm_album:  (metadata.album  || '').slice(0, 120),
        hm_genre:  (metadata.genre  || '').slice(0, 60),
      },
    };

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}` +
      '?supportsAllDrives=true&fields=id,name,size,mimeType,modifiedTime,thumbnailLink,videoMediaMetadata,properties',
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (!res.ok) throw new Error(`Falha ao salvar alterações (HTTP ${res.status})`);

    const updated = await res.json();
    const parsed = _parseTrack(updated);
    const idx = _tracks.findIndex(t => t.id === fileId);
    if (idx !== -1) _tracks[idx] = parsed;
    return parsed;
  }

  // ── PLAYLISTS (guardadas no appDataFolder do Drive) ──
  // Ficam numa pasta invisível ao usuário, vinculada à própria conta
  // Google — sincroniza entre aparelhos sem poluir o Drive dele.
  // Sempre grava também uma cópia local (localStorage) antes de tentar
  // salvar no Drive, então uma falha de rede nunca perde a playlist.
  const PLAYLISTS_FILENAME = 'happymusic-playlists.json';
  const KEY_PLAYLISTS_CACHE = 'hm_playlists_cache';
  let _playlistsFileId = null;

  function _loadPlaylistsCache() {
    try { return JSON.parse(localStorage.getItem(KEY_PLAYLISTS_CACHE) || '[]'); }
    catch { return []; }
  }
  function _savePlaylistsCache(list) {
    try { localStorage.setItem(KEY_PLAYLISTS_CACHE, JSON.stringify(list)); } catch {}
  }

  async function _findPlaylistsFile() {
    const data = await _get('https://www.googleapis.com/drive/v3/files', {
      q: `name='${PLAYLISTS_FILENAME}' and trashed=false`,
      spaces: 'appDataFolder',
      fields: 'files(id,name)',
      pageSize: 1,
    });
    return (data.files && data.files[0]) || null;
  }

  async function loadPlaylists() {
    try {
      const file = await _findPlaylistsFile();
      if (!file) {
        _playlistsFileId = null;
        const cached = _loadPlaylistsCache();
        return cached;
      }
      _playlistsFileId = file.id;

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const list = await res.json();
      const playlists = Array.isArray(list) ? list : [];
      _savePlaylistsCache(playlists);
      return playlists;
    } catch (err) {
      console.warn('[Drive] Não deu pra carregar playlists do Drive, usando cópia local:', err);
      return _loadPlaylistsCache();
    }
  }

  async function _multipartCreateJson(name, content) {
    const boundary = 'hmboundary' + Date.now();
    const metadata = { name, parents: ['appDataFolder'] };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
      `--${boundary}--`;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${_token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function _mediaUpdateJson(fileId, content) {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${_token}`,
        'Content-Type': 'application/json',
      },
      body: content,
    });
    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Salva local primeiro (nunca perde a playlist por falha de rede) e
  // só depois tenta sincronizar com o Drive; se a sincronização falhar,
  // devolve false mas os dados continuam salvos neste aparelho.
  async function savePlaylists(playlists) {
    _savePlaylistsCache(playlists);
    const content = JSON.stringify(playlists);

    try {
      if (_playlistsFileId) {
        await _mediaUpdateJson(_playlistsFileId, content);
      } else {
        const created = await _multipartCreateJson(PLAYLISTS_FILENAME, content);
        _playlistsFileId = created.id;
      }
      return true;
    } catch (err) {
      console.error('[Drive] Playlist salva só neste aparelho — falha ao sincronizar com o Drive:', err);
      return false;
    }
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
    fetchAudioUrl,
    revokeAudioUrl,
    searchTracks,
    fetchEmbeddedCover,
    isAudioFile,
    getKnownGenres,
    getKnownArtists,
    getKnownAlbums,
    filterTracks,
    uploadTrack,
    updateTrackMetadata,
    loadPlaylists,
    savePlaylists,
  };

})();
