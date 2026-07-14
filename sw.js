/* ═══════════════════════════════════════════════
   HAPPY MUSIC – sw.js
   Service Worker: cache offline + estratégia de rede
═══════════════════════════════════════════════ */

const CACHE_NAME    = 'happymusic-v43';
const CACHE_STATIC  = 'happymusic-static-v43';
const CACHE_AUDIO   = 'happymusic-audio-v2';

// Arquivos do app shell — cacheados no install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/drive.js',
  '/js/downloads.js',
  '/js/player.js',
  '/js/ui.js',
  '/js/app.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/splash-mark.png',
];

// ── INSTALL ───────────────────────────────────
// Pré-cacheia o app shell completo, ignorando o cache HTTP do navegador
// (cache: 'reload') pra garantir que sempre pega a versão mais recente
// do servidor — sem isso, arquivos com Cache-Control: immutable podiam
// ficar presos numa versão antiga mesmo após o app atualizar.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => Promise.all(
        STATIC_ASSETS.map(url =>
          fetch(url, { cache: 'reload' })
            .then(res => { if (res.ok) return cache.put(url, res); })
            .catch(() => {})
        )
      ))
      .then(() => self.skipWaiting())  // ativa imediatamente
  );
});

// ── ACTIVATE ──────────────────────────────────
// Remove caches antigos de versões anteriores
self.addEventListener('activate', event => {
  const validCaches = [CACHE_STATIC, CACHE_AUDIO];

  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !validCaches.includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())  // assume controle imediato
  );
});

// ── FETCH ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET e extensões de browser
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // ── 0. Rotas da nossa própria API (Cloudflare Functions) → Network Only
  //       Nunca cacheia e NUNCA cai no fallback de index.html do
  //       _cacheFirst — sem essa regra, um erro de rede ou um 404 na
  //       function vira silenciosamente uma resposta 200 com o HTML do
  //       app, e o código que espera JSON quebra com "Unexpected token
  //       '<'". Rotas de API sempre precisam da resposta real (ou o
  //       erro real), nunca de um substituto do cache.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // ── 1. Áudio do Google Drive → Cache then Network
  //       Salva localmente para ouvir offline
  //
  //       IMPORTANTE: só entra aqui o download do CONTEÚDO do arquivo
  //       (.../files/{id}?alt=media). A checagem antiga usava apenas
  //       startsWith('/drive/v3/files'), que também batia com a chamada
  //       de LISTAGEM das músicas (.../files?q=...) — isso fazia a lista
  //       de faixas ficar presa em cache (Cache First) e nunca mais
  //       atualizar, escondendo músicas novas adicionadas no Drive até o
  //       usuário limpar os dados do Chrome. Agora exigimos um fileId no
  //       path (/files/{id}) e o parâmetro alt=media, que só existe na
  //       requisição de download — a listagem nunca tem os dois.
  const isDriveFileContent =
    url.hostname === 'www.googleapis.com' &&
    /^\/drive\/v3\/files\/[^/]+$/.test(url.pathname) &&
    url.searchParams.get('alt') === 'media';

  if (isDriveFileContent) {
    // Requisições com cabeçalho Range (ex.: leitura parcial dos primeiros
    // bytes do arquivo pra extrair a capa embutida ID3/MP4) nunca passam
    // pelo cache: o servidor responde 206 Partial Content, e a Cache API
    // não aceita armazenar respostas 206 — isso fazia cache.put() lançar
    // erro, cair no catch e devolver um 503 falso, quebrando a extração
    // da capa (era a causa das mini capas não aparecerem).
    if (request.headers.has('Range')) {
      event.respondWith(fetch(request));
      return;
    }
    event.respondWith(_cacheFirstAudio(request));
    return;
  }

  // ── 2. API do Google (OAuth, userinfo, files list) → Network Only
  //       Nunca cacheia tokens ou listas dinâmicas
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com')) {
    event.respondWith(fetch(request));
    return;
  }

  // ── 3. Fontes Google → Stale While Revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(_staleWhileRevalidate(request, CACHE_STATIC));
    return;
  }

  // ── 4. Assets do app shell → Cache First
  event.respondWith(_cacheFirst(request));
});

// ── ESTRATÉGIAS ───────────────────────────────

// Cache First: serve do cache, só vai à rede se não encontrar
async function _cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // App shell offline — retorna index.html como fallback
    return caches.match('/index.html');
  }
}

// Stale While Revalidate: serve cache imediatamente, atualiza em background
async function _staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

// Cache First para áudio: cacheia streams para ouvir offline
// Limita o cache de áudio a 300 faixas (suficiente pra "baixar tudo" em
// bibliotecas médias sem deixar o cache crescer sem controle; quem tiver
// uma biblioteca maior que isso ainda consegue baixar manualmente as
// faixas que quiser, só não cabe tudo de uma vez)
const MAX_AUDIO_ENTRIES = 300;

async function _cacheFirstAudio(request) {
  const cache  = await caches.open(CACHE_AUDIO);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.status !== 206) {
      await _limitedCachePut(cache, request, response.clone());
    }
    return response;
  } catch {
    return new Response('Áudio indisponível offline.', { status: 503 });
  }
}

// Mantém o cache de áudio dentro do limite máximo
async function _limitedCachePut(cache, request, response) {
  const keys = await cache.keys();
  if (keys.length >= MAX_AUDIO_ENTRIES) {
    // Remove a entrada mais antiga (FIFO)
    await cache.delete(keys[0]);
  }
  await cache.put(request, response);
}

// ── MENSAGENS DO APP ──────────────────────────
// Permite que o app.js se comunique com o SW

self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {

    // Força atualização do app shell (chamado após deploy)
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    // Remove uma faixa específica do cache de áudio
    case 'REMOVE_AUDIO': {
      if (!payload?.fileId) break;
      caches.open(CACHE_AUDIO).then(cache => {
        cache.keys().then(keys => {
          keys.forEach(key => {
            if (key.url.includes(payload.fileId)) cache.delete(key);
          });
        });
      });
      break;
    }

    // Limpa todo o cache de áudio
    case 'CLEAR_AUDIO_CACHE':
      caches.delete(CACHE_AUDIO)
        .then(() => event.source?.postMessage({ type: 'AUDIO_CACHE_CLEARED' }));
      break;

    // Retorna lista de faixas cacheadas offline
    case 'GET_CACHED_TRACKS':
      caches.open(CACHE_AUDIO).then(async cache => {
        const keys = await cache.keys();
        const ids  = keys.map(k => {
          const match = k.url.match(/files\/([^?]+)/);
          return match ? match[1] : null;
        }).filter(Boolean);
        event.source?.postMessage({ type: 'CACHED_TRACKS', payload: ids });
      });
      break;
  }
});
