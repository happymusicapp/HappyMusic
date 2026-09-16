/* ═══════════════════════════════════════════════
   HAPPY MUSIC – downloads.js
   Gerencia o "modo offline": baixar/remover faixas, baixar em lote
   (tudo / favoritas) e avisar a UI sobre o estado de cada faixa
   (idle/baixando/baixada).

   Duas fontes de verdade possíveis, dependendo de onde o app roda:
   - App nativo (Capacitor): arquivos de verdade no disco, fora do
     WebView (window.NativeFS, ver native-bridge.js) — sobrevive a
     "limpar cache do navegador" e é mais resistente ao Android apagar
     por falta de espaço (mesmo princípio usado por apps como Spotify).
   - Versão web (navegador): cache de áudio do Service Worker
     (CACHE_AUDIO em sw.js), como já era antes.

   Este módulo mantém uma cópia local (_cached) só pra não precisar
   perguntar a fonte de verdade toda hora, e ressincroniza quando
   necessário (refreshCachedIds).
═══════════════════════════════════════════════ */

const Downloads = (() => {

  const _cached      = new Set();  // ids confirmados como baixados
  const _downloading = new Set();  // ids sendo baixados agora
  const _listeners    = new Set(); // fn(id, state) — state: 'idle'|'downloading'|'downloaded'|'error'
                                    // id === null  → evento de sincronização em massa ("sync")

  const _native = () => window.NativeFS && window.NativeFS.isNative;

  let _swReady = false;

  // ── EVENTOS ────────────────────────────────────
  function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
  function _notify(id, state) { _listeners.forEach(fn => { try { fn(id, state); } catch {} }); }

  function _ensureMessageListener() {
    if (_native() || _swReady || !('serviceWorker' in navigator)) return;
    _swReady = true;
    navigator.serviceWorker.addEventListener('message', e => {
      const { type, payload } = e.data || {};
      if (type === 'CACHED_TRACKS') {
        _cached.clear();
        (payload || []).forEach(id => _cached.add(id));
        _notify(null, 'sync');
      }
      if (type === 'AUDIO_CACHE_CLEARED') {
        _cached.clear();
        _notify(null, 'sync');
      }
    });
  }

  function _postToSW(msg) {
    navigator.serviceWorker?.controller?.postMessage(msg);
  }

  // Pergunta à fonte de verdade (disco nativo ou Service Worker) quais
  // faixas já estão baixadas — corrige o estado local caso algo tenha
  // sido descartado por fora do app (ex.: limite de espaço do sistema).
  function refreshCachedIds() {
    if (_native()) {
      return window.NativeFS.listDownloadedIds().then(ids => {
        _cached.clear();
        ids.forEach(id => _cached.add(id));
        _notify(null, 'sync');
        return [..._cached];
      });
    }

    _ensureMessageListener();
    return new Promise(resolve => {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
        resolve([..._cached]);
        return;
      }
      const handler = e => {
        if (e.data?.type === 'CACHED_TRACKS') {
          navigator.serviceWorker.removeEventListener('message', handler);
          clearTimeout(timer);
          resolve([..._cached]);
        }
      };
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve([..._cached]);
      }, 4000);
      navigator.serviceWorker.addEventListener('message', handler);
      _postToSW({ type: 'GET_CACHED_TRACKS' });
    });
  }

  function isDownloaded(id)  { return _cached.has(id); }
  function isDownloading(id) { return _downloading.has(id); }

  // ── BAIXAR UMA FAIXA ───────────────────────────
  async function downloadTrack(track) {
    if (!track?.id || _cached.has(track.id) || _downloading.has(track.id)) return;

    _downloading.add(track.id);
    _notify(track.id, 'downloading');

    try {
      if (_native()) {
        // Baixa direto pro disco (Filesystem.downloadFile) — não passa
        // pela RAM do WebView nem pelo blob cache do drive.js.
        const info = await Drive.getAudioDownloadInfo(track.id);
        await window.NativeFS.downloadAudio(track.id, info);
      } else {
        // Versão web: o mesmo fetch usado pra tocar; o Service Worker
        // intercepta e guarda no cache de áudio automaticamente.
        await Drive.fetchAudioUrl(track.id);
      }
      _cached.add(track.id);
      _downloading.delete(track.id);
      _notify(track.id, 'downloaded');
    } catch (err) {
      console.error('[Downloads] Erro ao baixar', track.id, err);
      _downloading.delete(track.id);
      _notify(track.id, 'error');
    }
  }

  // ── REMOVER UMA FAIXA ──────────────────────────
  function removeTrack(id) {
    if (!id) return;
    _cached.delete(id);
    Drive.revokeAudioUrl(id);

    if (_native()) {
      window.NativeFS.deleteAudio(id);
    } else {
      _postToSW({ type: 'REMOVE_AUDIO', payload: { fileId: id } });
    }
    _notify(id, 'idle');
  }

  // ── LIMPAR TUDO ────────────────────────────────
  function clearAll() {
    if (_native()) {
      return window.NativeFS.clearAll().then(() => {
        _cached.clear();
        _notify(null, 'sync');
      });
    }

    _ensureMessageListener();
    return new Promise(resolve => {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
        _cached.clear();
        resolve();
        return;
      }
      const handler = e => {
        if (e.data?.type === 'AUDIO_CACHE_CLEARED') {
          navigator.serviceWorker.removeEventListener('message', handler);
          clearTimeout(timer);
          _cached.clear();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', handler);
        _cached.clear();
        resolve();
      }, 4000);
      navigator.serviceWorker.addEventListener('message', handler);
      _postToSW({ type: 'CLEAR_AUDIO_CACHE' });
    });
  }

  // ── DOWNLOAD EM LOTE (tudo / favoritas / seleção) ──
  // Concorrência limitada pra não disparar dezenas de downloads
  // simultâneos. Cancelável: incrementar _batchToken invalida o lote
  // em andamento (os downloads já em voo terminam, mas nenhum novo começa).
  const CONCURRENCY = 3;
  let _batchToken = 0;

  async function downloadMany(tracks, onProgress) {
    const myBatch = ++_batchToken;
    const list    = (tracks || []).filter(t => t?.id);
    const total   = list.length;
    let done      = list.filter(t => _cached.has(t.id)).length;

    onProgress?.(done, total);
    if (!total) return { done: 0, total: 0, cancelled: false };

    const pending = list.filter(t => !_cached.has(t.id));
    let cursor = 0;

    async function worker() {
      while (cursor < pending.length) {
        if (myBatch !== _batchToken) return; // cancelado
        const track = pending[cursor++];
        await downloadTrack(track);
        done++;
        onProgress?.(done, total);
      }
    }

    const workerCount = Math.min(CONCURRENCY, pending.length) || 1;
    await Promise.all(Array(workerCount).fill(0).map(worker));

    return { done, total, cancelled: myBatch !== _batchToken };
  }

  function cancelBatch() { _batchToken++; }

  // ── ESPAÇO EM DISCO ────────────────────────────
  // Estima se há espaço suficiente antes de um download grande.
  // Retorna null se a API não estiver disponível (não bloqueia o download).
  async function estimateStorage() {
    if (_native()) {
      // navigator.storage.estimate() só enxerga o armazenamento do
      // WebView, não os arquivos gravados via Filesystem — por isso o
      // "usado" vem de lá, mas o "total do dispositivo" ainda dá pra
      // pegar da mesma API (ela reflete o espaço livre geral do app).
      const usage = await window.NativeFS.totalBytes();
      if (!navigator.storage?.estimate) return { quota: 0, usage, available: 0 };
      try {
        const { quota = 0 } = await navigator.storage.estimate();
        return { quota, usage, available: Math.max(0, quota - usage) };
      } catch {
        return { quota: 0, usage, available: 0 };
      }
    }

    if (!navigator.storage?.estimate) return null;
    try {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      return { quota, usage, available: Math.max(0, quota - usage) };
    } catch {
      return null;
    }
  }

  // ── INIT ───────────────────────────────────────
  _ensureMessageListener();

  return {
    onChange,
    refreshCachedIds,
    isDownloaded,
    isDownloading,
    downloadTrack,
    removeTrack,
    clearAll,
    downloadMany,
    cancelBatch,
    estimateStorage,
  };

})();
