/* ═══════════════════════════════════════════════
   HAPPY MUSIC – drive.js
   Autenticação OAuth 2.0 (PKCE) + Google Drive API
═══════════════════════════════════════════════ */

const Drive = (() => {

  // ── CONFIGURAÇÃO ──────────────────────────────
  const CLIENT_ID   = '1097906554235-06h3ll6bn26opgqsddohls1d2a0mct5p.apps.googleusercontent.com';
  // Dentro do app nativo (Capacitor), window.location.origin é um
  // endereço local interno (ex.: https://localhost), não o domínio real
  // — e é o domínio real que está cadastrado no Google Cloud Console e
  // no assetlinks.json. O redirect nunca chega a carregar dentro da
  // WebView do app mesmo (ver login()/NativeBrowser), então é seguro
  // fixar esse valor aqui. Mesma lógica pras chamadas a /api/* abaixo.
  const API_BASE = window.NativeApiBase || '';
  const REDIRECT_URI = (window.NativeBrowser && window.NativeBrowser.isNative)
    ? API_BASE + '/'
    : window.location.origin + '/';
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
  const KEY_REFRESH    = 'hm_refresh_token';
  const KEY_USER       = 'hm_user';
  const KEY_VERIFIER   = 'hm_pkce_verifier';
  const KEY_FOLDER_ID  = 'hm_folder_id';
  // Cópia local da última lista de músicas obtida do Drive — mesmo padrão
  // já usado pra playlists e vídeos: se o Drive não responder (sem
  // internet, API fora do ar), a biblioteca continua aparecendo e as
  // faixas já baixadas continuam tocando, em vez do app mostrar um
  // erro genérico.
  const KEY_TRACKS_CACHE = 'hm_tracks_cache';

  // ── ESTADO INTERNO ────────────────────────────
  let _token  = null;
  let _user   = null;
  let _tracks = [];
  let _videos = [];

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

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Dentro do app nativo, o Google bloqueia login feito na própria
    // WebView — precisa abrir numa aba de navegador de verdade.
    if (window.NativeBrowser && window.NativeBrowser.isNative) {
      window.NativeBrowser.open(authUrl);
    } else {
      window.location.href = authUrl;
    }
  }

  // ── OAUTH: TROCAR CÓDIGO POR TOKEN ────────────
  async function handleCallback(url = window.location.href) {
    const params   = new URL(url, window.location.origin).searchParams;
    const code     = params.get('code');
    const error    = params.get('error');

    if (error || !code) return false;

    const verifier = sessionStorage.getItem(KEY_VERIFIER);
    if (!verifier) return false;

    try {
      const res = await fetch(`${API_BASE}/api/token`, {
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
      // O Google só manda refresh_token na primeira autorização (por
      // isso o prompt inclui 'consent' — garante que ele sempre venha).
      // É o que permite renovar o access_token sozinho depois, sem
      // precisar pedir pro usuário logar de novo a cada ~1h.
      if (data.refresh_token) {
        localStorage.setItem(KEY_REFRESH, data.refresh_token);
      }

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
  async function restoreSession() {
    const token  = localStorage.getItem(KEY_TOKEN);
    const expiry = parseInt(localStorage.getItem(KEY_EXPIRY) || '0', 10);
    const user   = localStorage.getItem(KEY_USER);

    if (token && expiry > Date.now()) {
      _token = token;
      _user  = user ? JSON.parse(user) : null;
      return true;
    }

    // Sem token nenhum salvo — nunca fez login, aí sim precisa mesmo.
    if (!token) {
      _clearSession();
      return false;
    }

    // Access token expirado (app fechado/tela travada por mais de ~1h)
    // — antes de forçar login de novo, tenta renovar com o refresh_token.
    if (localStorage.getItem(KEY_REFRESH)) {
      const refreshed = await _refreshAccessToken();
      if (refreshed) {
        _user = user ? JSON.parse(user) : null;
        return true;
      }

      // A renovação falhou — mas só é motivo de verdade pra derrubar a
      // sessão se o Google respondeu dizendo que o refresh_token não
      // vale mais (_lastRefreshWasRevoked). Qualquer outra falha (sem
      // internet, timeout, sinal fraco, etc.) mantém a sessão com o
      // token vencido que já tem: o app abre normalmente e toca o que
      // já foi baixado; a próxima chamada com internet de verdade
      // renova ou detecta uma expiração legítima então.
      //
      // Importante: NÃO depende de navigator.onLine pra essa decisão
      // — esse sinal só indica se existe uma interface de rede ativa,
      // não se ela tem internet de verdade (ex.: sinal fraco, portal
      // cativo de wifi), e por isso não é confiável aqui.
      if (!_lastRefreshWasRevoked) {
        _token = token;
        _user  = user ? JSON.parse(user) : null;
        return true;
      }
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
    localStorage.removeItem(KEY_REFRESH);
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

  // ── RENOVAÇÃO DE TOKEN ─────────────────────────
  let _refreshPromise = null; // evita disparar vários refreshes em paralelo

  // true só quando o Google respondeu de verdade dizendo que o
  // refresh_token não vale mais (ex.: revogado/expirado) — diferente de
  // uma falha de rede, que não significa que a sessão acabou.
  let _lastRefreshWasRevoked = false;

  function _refreshAccessToken() {
    if (_refreshPromise) return _refreshPromise;

    const refreshToken = localStorage.getItem(KEY_REFRESH);
    if (!refreshToken) return Promise.resolve(false);

    _lastRefreshWasRevoked = false;

    // Timeout curto: numa conexão "meio viva" (sinal fraco tentando
    // conectar, sem nunca completar), sem isso o fetch pode ficar
    // pendurado por muito tempo, travando o app numa tela de
    // carregamento em vez de cair pro modo offline rapidinho.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    _refreshPromise = fetch(`${API_BASE}/api/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    })
      .then(async res => {
        if (!res.ok) {
          // O Google respondeu (não é falha de rede) — se foi porque o
          // refresh_token não vale mais, isso sim é uma sessão vencida
          // de verdade, não uma questão de conexão.
          try {
            const body = await res.json();
            if (body?.error === 'invalid_grant') _lastRefreshWasRevoked = true;
          } catch { /* corpo não veio em JSON, ignora */ }
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data || !data.access_token) return false;
        _token = data.access_token;
        const expiry = Date.now() + (data.expires_in * 1000);
        localStorage.setItem(KEY_TOKEN,  _token);
        localStorage.setItem(KEY_EXPIRY, expiry);
        return true;
      })
      .catch(err => {
        // Erro de fetch de verdade (sem resposta nenhuma do servidor) —
        // sem internet, DNS falhou, timeout, etc. Não é o Google
        // dizendo "não", é só falta de conexão mesmo.
        console.warn('[Drive] Falha ao renovar token:', err);
        return false;
      })
      .finally(() => {
        clearTimeout(timeoutId);
        _refreshPromise = null;
      });

    return _refreshPromise;
  }

  // Chamado antes de qualquer requisição autenticada: se o access token
  // já expirou (ou está prestes a), renova antes de seguir — evita
  // bater 401 no meio de uma troca de faixa com a tela travada.
  async function _ensureValidToken() {
    const expiry = parseInt(localStorage.getItem(KEY_EXPIRY) || '0', 10);
    if (_token && expiry - Date.now() > 60_000) return true;
    return _refreshAccessToken();
  }

  // ── REQUISIÇÃO AUTENTICADA ────────────────────
  async function _get(url, params = {}) {
    await _ensureValidToken();

    const qs  = new URLSearchParams(params).toString();
    const sep = url.includes('?') ? '&' : '?';
    const fullUrl = qs ? `${url}${sep}${qs}` : url;

    let res = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${_token}` },
    });

    if (res.status === 401) {
      // Token pode ter expirado no meio da chamada — tenta renovar uma
      // vez antes de desistir e derrubar a sessão.
      const refreshed = await _refreshAccessToken();
      if (refreshed) {
        res = await fetch(fullUrl, {
          headers: { Authorization: `Bearer ${_token}` },
        });
      }
      if (res.status === 401) {
        _clearSession();
        throw new Error('UNAUTHORIZED');
      }
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
  function _loadTracksCache() {
    try { return JSON.parse(localStorage.getItem(KEY_TRACKS_CACHE) || '[]'); }
    catch { return []; }
  }
  function _saveTracksCache(list) {
    try { localStorage.setItem(KEY_TRACKS_CACHE, JSON.stringify(list)); } catch {}
  }

  // Última lista de músicas salva localmente, sem tentar falar com o
  // Drive — usada como último recurso quando listTracks() falha e
  // também exposta pra quem só precisa ler a biblioteca já carregada
  // (ex.: seletor de faixas de playlist).
  function getOfflineTracks() { return _loadTracksCache(); }

  async function listTracks(folderId = null) {
    const folder = folderId || getFolderId();

    const mimeQuery = AUDIO_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
    const parentQ   = folder ? `'${folder}' in parents and` : '';

    try {
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
      _saveTracksCache(_tracks);
      return _tracks;

    } catch (err) {
      if (err.message === 'UNAUTHORIZED') throw err;

      // Sem conexão (ou Drive fora do ar): cai pra última lista salva
      // localmente, igual já é feito com playlists e vídeos — assim dá
      // pra abrir o app e ouvir o que já foi baixado mesmo sem internet.
      const cached = _loadTracksCache();
      if (cached.length) {
        console.warn('[Drive] Não deu pra carregar músicas do Drive, usando cópia local:', err);
        _tracks = cached;
        return _tracks;
      }
      throw err;
    }
  }

  // ── VÍDEOS (catálogo de vídeos do YouTube) ─────
  // Vídeo não é mais um arquivo enviado pro Drive — é só um link do
  // YouTube. O YouTube cuida do streaming/armazenamento; a gente só
  // guarda a listinha (id, título, gênero, miniatura) num JSON no
  // appDataFolder do Drive, exatamente como já é feito com as playlists
  // — sincroniza entre os aparelhos da família sem subir vídeo nenhum.
  const VIDEOS_FILENAME  = 'happymusic-videos.json';
  const KEY_VIDEOS_CACHE = 'hm_videos_cache';
  let _videosFileId = null;

  function _loadVideosCache() {
    try { return JSON.parse(localStorage.getItem(KEY_VIDEOS_CACHE) || '[]'); }
    catch { return []; }
  }
  function _saveVideosCache(list) {
    try { localStorage.setItem(KEY_VIDEOS_CACHE, JSON.stringify(list)); } catch {}
  }

  async function _findVideosFile() {
    const data = await _get('https://www.googleapis.com/drive/v3/files', {
      q: `name='${VIDEOS_FILENAME}' and trashed=false`,
      spaces: 'appDataFolder',
      fields: 'files(id,name)',
      pageSize: 1,
    });
    return (data.files && data.files[0]) || null;
  }

  async function loadVideos() {
    try {
      const file = await _findVideosFile();
      if (!file) {
        _videosFileId = null;
        _videos = _loadVideosCache();
        return _videos;
      }
      _videosFileId = file.id;

      await _ensureValidToken();

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const list = await res.json();
      _videos = Array.isArray(list) ? list : [];
      _saveVideosCache(_videos);
      return _videos;
    } catch (err) {
      if (err?.message === 'UNAUTHORIZED') throw err;
      console.warn('[Drive] Não deu pra carregar vídeos do Drive, usando cópia local:', err);
      _videos = _loadVideosCache();
      return _videos;
    }
  }

  function getCachedVideos() { return _videos; }

  // Salva local primeiro (nunca perde o catálogo por falha de rede) e só
  // depois sincroniza com o Drive — mesmo mecanismo das playlists.
  async function _saveVideosCatalog() {
    _saveVideosCache(_videos);
    const content = JSON.stringify(_videos);
    try {
      if (_videosFileId) {
        await _mediaUpdateJson(_videosFileId, content);
      } else {
        const created = await _multipartCreateJson(VIDEOS_FILENAME, content);
        _videosFileId = created.id;
      }
      return true;
    } catch (err) {
      console.error('[Drive] Vídeo salvo só neste aparelho — falha ao sincronizar com o Drive:', err);
      return false;
    }
  }

  // Aceita link comum (watch?v=), encurtado (youtu.be/), shorts, embed,
  // ou o ID puro (11 caracteres) colado direto.
  function extractYouTubeId(url) {
    if (!url) return null;
    const trimmed = url.trim();
    const m = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return m[1];
    if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
    return null;
  }

  // Busca título/miniatura/canal públicos via oEmbed do YouTube — não
  // precisa de API key nem de cota, e funciona com vídeos não-listados
  // (desde que a incorporação não esteja desabilitada pelo dono).
  async function _fetchYouTubeOEmbed(videoId) {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) throw new Error('Não foi possível encontrar esse vídeo no YouTube. Verifique o link.');
    return res.json();
  }

  // Adiciona um vídeo ao catálogo a partir de um link do YouTube.
  async function addVideo({ url, genre = '' } = {}) {
    const videoId = extractYouTubeId(url);
    if (!videoId) throw new Error('Link do YouTube inválido.');
    if (_videos.some(v => v.id === videoId)) throw new Error('Esse vídeo já está na sua lista.');

    const meta = await _fetchYouTubeOEmbed(videoId);

    const entry = {
      id:        videoId,
      title:     meta.title || 'Sem título',
      channel:   meta.author_name || null,
      thumbnail: meta.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      genre:     (genre || '').trim().slice(0, 60) || null,
      addedAt:   Date.now(),
    };

    _videos = [entry, ..._videos];
    await _saveVideosCatalog();
    return entry;
  }

  // Edita só título/gênero (dados que o próprio app guarda) — canal e
  // miniatura continuam vindo do YouTube.
  async function updateVideoMetadata(videoId, metadata = {}) {
    const idx = _videos.findIndex(v => v.id === videoId);
    if (idx === -1) throw new Error('Vídeo não encontrado.');

    _videos[idx] = {
      ..._videos[idx],
      title: (metadata.title || _videos[idx].title || '').slice(0, 120),
      genre: (metadata.genre || '').trim().slice(0, 60) || null,
    };

    await _saveVideosCatalog();
    return _videos[idx];
  }

  // Remove um vídeo só do catálogo (o vídeo continua no YouTube).
  async function deleteVideo(videoId) {
    _videos = _videos.filter(v => v.id !== videoId);
    await _saveVideosCatalog();
    return true;
  }

  function getKnownMovieGenres() {
    const set = new Set();
    _videos.forEach(v => { if (v.genre) set.add(v.genre); });
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function filterVideos({ genre } = {}) {
    return _videos.filter(v => !genre || v.genre === genre);
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
      coverId:      props.hm_cover_id || null, // capa personalizada (arquivo separado no Drive), ver setCustomCover
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
  //
  // IMPORTANTE — vazamento de memória corrigido: cada faixa tocada
  // (e cada pré-carregada) baixa o arquivo inteiro como Blob pra RAM.
  // Sem limite, isso crescia sem parar numa sessão longa (ex.: carro,
  // dezenas de músicas seguidas, ou arquivos grandes tipo FLAC/WAV) até
  // estourar a memória do processo — o Android então mata o WebView/aba
  // do Chrome em segundo plano e a música para, sem relação nenhuma com
  // uma faixa específica. Por isso agora é um cache com limite (LRU):
  // guarda só as últimas MAX_BLOB_CACHE faixas e libera (revokeObjectURL)
  // as mais antigas automaticamente. Faixas offline não perdem nada —
  // continuam servidas instantaneamente do Cache Storage do Service
  // Worker (sw.js), só o Blob em RAM que é recriado se tocar de novo.
  const _blobCache = new Map(); // fileId -> object URL
  const _blobOrder = [];        // ordem de inserção, pra saber o que é mais antigo
  const MAX_BLOB_CACHE = 4;     // atual + próxima pré-carregada + folga

  function _cacheBlob(fileId, objectUrl) {
    _blobCache.set(fileId, objectUrl);
    _blobOrder.push(fileId);

    while (_blobOrder.length > MAX_BLOB_CACHE) {
      const oldId = _blobOrder.shift();
      if (oldId === fileId) continue; // nunca revoga o que acabou de entrar
      const oldUrl = _blobCache.get(oldId);
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
        _blobCache.delete(oldId);
      }
    }
  }

  async function fetchAudioUrl(fileId) {
    if (_blobCache.has(fileId)) return _blobCache.get(fileId);

    // Já baixada e o app roda nativo: toca direto do arquivo no disco,
    // sem gastar rede nem memória RAM com blob.
    if (window.NativeFS && window.NativeFS.isNative) {
      const localSrc = await window.NativeFS.getAudioSrc(fileId);
      if (localSrc) return localSrc;
    }

    await _ensureValidToken();

    const requestUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    let res = await fetch(requestUrl, { headers: { Authorization: `Bearer ${_token}` } });

    if (res.status === 401) {
      const refreshed = await _refreshAccessToken();
      if (refreshed) {
        res = await fetch(requestUrl, { headers: { Authorization: `Bearer ${_token}` } });
      }
      if (res.status === 401) {
        _clearSession();
        throw new Error('UNAUTHORIZED');
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    _cacheBlob(fileId, objectUrl);
    return objectUrl;
  }

  // Dados pra baixar o áudio direto pro disco nativo (Filesystem.downloadFile),
  // sem passar pelo fetch()/blob do JS. Garante que o token está válido
  // antes (o download nativo não sabe renovar token sozinho).
  async function getAudioDownloadInfo(fileId) {
    await _ensureValidToken();
    return {
      url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      headers: { Authorization: `Bearer ${_token}` },
    };
  }

  // Libera memória de um blob específico (chamado ao remover um download)
  function revokeAudioUrl(fileId) {
    const url = _blobCache.get(fileId);
    if (url) {
      URL.revokeObjectURL(url);
      _blobCache.delete(fileId);
    }
    const idx = _blobOrder.indexOf(fileId);
    if (idx !== -1) _blobOrder.splice(idx, 1);
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

  // ── CAPA EMBUTIDA (ID3 / MP4) OU PERSONALIZADA ─
  // O Drive raramente gera thumbnailLink pra áudio (diferente de imagem/vídeo).
  // Prioridade: 1) capa personalizada enviada pelo usuário (arquivo separado
  // no Drive, ver setCustomCover) — 2) arte embutida no próprio arquivo de
  // áudio (tag ID3 APIC no MP3, atom "covr" no M4A).
  const _coverCache = new Map(); // fileId -> dataURL | null

  async function fetchEmbeddedCover(fileId, customCoverId = null) {
    if (_coverCache.has(fileId)) return _coverCache.get(fileId);
    if (!_token) return null;

    try {
      await _ensureValidToken();

      if (customCoverId) {
        const dataUrl = await _fetchImageAsDataUrl(customCoverId);
        if (dataUrl) {
          _coverCache.set(fileId, dataUrl);
          return dataUrl;
        }
        // Se a capa personalizada falhar ao carregar, cai pro fallback abaixo.
      }

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
      console.warn('[Drive] capa indisponível:', fileId, err);
      _coverCache.set(fileId, null);
      return null;
    }
  }

  // Baixa uma imagem do Drive (arquivo de capa personalizada) e devolve
  // como dataURL, pro mesmo formato usado pela capa embutida/ID3.
  async function _fetchImageAsDataUrl(fileId) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${_token}` } }
    );
    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (!res.ok) return null;
    const blob = await res.blob();
    return _blobToDataUrl(blob);
  }

  function _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
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
    await _ensureValidToken();

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

    await _ensureValidToken();

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

  // ── CAPA PERSONALIZADA (imagem escolhida pelo usuário) ──
  // A capa é salva como um arquivo de imagem separado, na mesma pasta da
  // música no Drive, e associada à faixa via a property `hm_cover_id`.
  // Isso evita ter que reescrever a tag ID3 dentro do arquivo de áudio
  // (arriscado e nem sempre suportado pelo formato) — o Drive é quem guarda
  // o vínculo, então continua funcionando mesmo se o arquivo for renomeado.
  async function _uploadCoverImage(track, imageFile) {
    await _ensureValidToken();

    const meta = {
      name: `.happymusic_capa_${track.id}`,
      properties: { hm_cover_for: track.id },
    };
    const folderId = getFolderId();
    if (folderId) meta.parents = [folderId];

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json; charset=UTF-8' }));
    form.append('file', imageFile);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${_token}` },
        body: form,
      }
    );

    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (!res.ok) throw new Error(`Falha ao enviar a capa (HTTP ${res.status})`);

    const created = await res.json();
    return created.id;
  }

  // Atualiza só as properties informadas, sem mexer nas outras já salvas —
  // a Drive API faz merge por chave (valor `null` remove a chave).
  async function _patchProperties(fileId, propsPatch) {
    await _ensureValidToken();

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,properties`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: propsPatch }),
      }
    );

    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (!res.ok) throw new Error(`Falha ao salvar alterações (HTTP ${res.status})`);
    return res.json();
  }

  // Manda um arquivo pra lixeira sem derrubar o fluxo principal se falhar
  // (ex.: capa antiga já tinha sido apagada por fora) — não é crítico.
  async function _trashFileSilently(fileId) {
    try {
      await _ensureValidToken();
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ trashed: true }),
        }
      );
    } catch (err) {
      console.warn('[Drive] não foi possível descartar a capa antiga:', fileId, err);
    }
  }

  // Envia (ou substitui) a capa personalizada de uma faixa.
  // Retorna a dataURL da nova capa, já pronta pra exibir.
  async function setCustomCover(track, imageFile) {
    const oldCoverId = track.coverId || null;

    const newCoverId = await _uploadCoverImage(track, imageFile);
    await _patchProperties(track.id, { hm_cover_id: newCoverId });

    if (oldCoverId && oldCoverId !== newCoverId) _trashFileSilently(oldCoverId);

    track.coverId      = newCoverId;
    track._coverTried  = false;
    _coverCache.delete(track.id);

    const dataUrl = await fetchEmbeddedCover(track.id, newCoverId);
    track.thumbnail = dataUrl;
    return dataUrl;
  }

  // Remove a capa personalizada de uma faixa (volta a usar a capa embutida
  // no áudio, se houver, ou o placeholder padrão).
  async function removeCustomCover(track) {
    const oldCoverId = track.coverId || null;

    await _patchProperties(track.id, { hm_cover_id: null });
    if (oldCoverId) _trashFileSilently(oldCoverId);

    track.coverId     = null;
    track.thumbnail   = null;
    track._coverTried = false;
    _coverCache.delete(track.id);
  }

  // ── EXCLUIR UMA FAIXA (manda pra lixeira do Drive) ──
  // Usa trashed:true em vez de DELETE definitivo — o arquivo continua
  // recuperável pela lixeira do Google Drive por um tempo, é mais seguro
  // do que apagar de vez direto pelo app.
  async function deleteTrack(fileId) {
    await _ensureValidToken();

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trashed: true }),
      }
    );

    if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
    if (res.status === 404) {
      // Já não existe no Drive (apagado por fora) — trata como sucesso local.
      _tracks = _tracks.filter(t => t.id !== fileId);
      return true;
    }
    if (!res.ok) throw new Error(`Falha ao excluir a música (HTTP ${res.status})`);

    _tracks = _tracks.filter(t => t.id !== fileId);
    _blobCache.delete(fileId);
    return true;
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

      await _ensureValidToken();

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

    await _ensureValidToken();

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
    await _ensureValidToken();

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

  // ── PLAYLISTS DE VÍDEO (mesmo mecanismo das playlists de música,
  // só que num arquivo separado no appDataFolder) ──
  const MOVIE_PLAYLISTS_FILENAME = 'happymusic-movie-playlists.json';
  const KEY_MOVIE_PLAYLISTS_CACHE = 'hm_movie_playlists_cache';
  let _moviePlaylistsFileId = null;

  function _loadMoviePlaylistsCache() {
    try { return JSON.parse(localStorage.getItem(KEY_MOVIE_PLAYLISTS_CACHE) || '[]'); }
    catch { return []; }
  }
  function _saveMoviePlaylistsCache(list) {
    try { localStorage.setItem(KEY_MOVIE_PLAYLISTS_CACHE, JSON.stringify(list)); } catch {}
  }

  async function _findMoviePlaylistsFile() {
    const data = await _get('https://www.googleapis.com/drive/v3/files', {
      q: `name='${MOVIE_PLAYLISTS_FILENAME}' and trashed=false`,
      spaces: 'appDataFolder',
      fields: 'files(id,name)',
      pageSize: 1,
    });
    return (data.files && data.files[0]) || null;
  }

  async function loadMoviePlaylists() {
    try {
      const file = await _findMoviePlaylistsFile();
      if (!file) {
        _moviePlaylistsFileId = null;
        return _loadMoviePlaylistsCache();
      }
      _moviePlaylistsFileId = file.id;

      await _ensureValidToken();

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (res.status === 401) { _clearSession(); throw new Error('UNAUTHORIZED'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const list = await res.json();
      const playlists = Array.isArray(list) ? list : [];
      _saveMoviePlaylistsCache(playlists);
      return playlists;
    } catch (err) {
      console.warn('[Drive] Não deu pra carregar playlists de vídeo do Drive, usando cópia local:', err);
      return _loadMoviePlaylistsCache();
    }
  }

  async function saveMoviePlaylists(playlists) {
    _saveMoviePlaylistsCache(playlists);
    const content = JSON.stringify(playlists);

    try {
      if (_moviePlaylistsFileId) {
        await _mediaUpdateJson(_moviePlaylistsFileId, content);
      } else {
        const created = await _multipartCreateJson(MOVIE_PLAYLISTS_FILENAME, content);
        _moviePlaylistsFileId = created.id;
      }
      return true;
    } catch (err) {
      console.error('[Drive] Playlist de vídeo salva só neste aparelho — falha ao sincronizar com o Drive:', err);
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
    getOfflineTracks,
    fetchAudioUrl,
    revokeAudioUrl,
    getAudioDownloadInfo,
    searchTracks,
    fetchEmbeddedCover,
    setCustomCover,
    removeCustomCover,
    isAudioFile,
    getKnownGenres,
    getKnownArtists,
    getKnownAlbums,
    filterTracks,
    uploadTrack,
    updateTrackMetadata,
    deleteTrack,
    loadPlaylists,
    savePlaylists,

    // Vídeos (catálogo de vídeos do YouTube)
    loadVideos,
    getCachedVideos,
    addVideo,
    updateVideoMetadata,
    deleteVideo,
    extractYouTubeId,
    getKnownMovieGenres,
    filterVideos,

    // Playlists de vídeo
    loadMoviePlaylists,
    saveMoviePlaylists,
  };

})();
