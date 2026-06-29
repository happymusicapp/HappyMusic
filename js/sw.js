/* ═══════════════════════════════════════════════
   HAPPY MUSIC – sw.js
   Service Worker: cache offline + estratégia de rede
═══════════════════════════════════════════════ */

const CACHE_NAME    = 'happymusic-v1';
const CACHE_STATIC  = 'happymusic-static-v1';
const CACHE_AUDIO   = 'happymusic-audio-v1';

// Arquivos do app shell — cacheados no install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/drive.js',
  '/js/player.js',
  '/js/ui.js',
  '/js/app.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

// ── INSTALL ───────────────────────────────────
// Pré-cacheia o app shell completo
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
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

  // ── 1. Áudio do Google Drive → Cache then Network
  //       Salva localmente para ouvir offline
  if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/drive/v3/files')) {
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
// Limita o cache de áudio a 50 faixas (~500 MB estimado)
const MAX_AUDIO_ENTRIES = 50;

async function _cacheFirstAudio(request) {
  const cache  = await caches.open(CACHE_AUDIO);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
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
