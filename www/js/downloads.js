/* ═══════════════════════════════════════════════
   HAPPY MUSIC – downloads.js
   Gerencia o "modo offline": baixar/remover faixas do cache de
   áudio do Service Worker, baixar em lote (tudo / favoritas) e
   avisar a UI sobre o estado de cada faixa (idle/baixando/baixada).

   A real fonte de verdade é o cache do Service Worker (CACHE_AUDIO
   em sw.js). Este módulo mantém uma cópia local (_cached) só pra
   não precisar perguntar ao SW toda hora, e ressincroniza quando
   necessário (refreshCachedIds).
═══════════════════════════════════════════════ */

const Downloads = (() => {

  const _cached      = new Set();  // ids confirmados no cache de áudio
  const _downloading = new Set();  // ids sendo baixados agora
  const _listeners    = new Set(); // fn(id, state) — state: 'idle'|'downloading'|'downloaded'|'error'
                                    // id === null  → evento de sincronização em massa ("sync")

  let _swReady = false;

  // ── EVENTOS ────────────────────────────────────
  function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
  function _notify(id, state) { _listeners.forEach(fn => { try { fn(id, state); } catch {} }); }

  function _ensureMessageListener() {
    if (_swReady || !('serviceWorker' in navigator)) return;
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

  // Pergunta ao Service Worker quais faixas já estão no cache de áudio
  // (fonte de verdade — corrige o estado local caso o SW tenha
  // descartado alguma faixa por limite de espaço)
  function refreshCachedIds() {
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
  // Dispara o fetch do áudio (o mesmo usado pra tocar); o Service Worker
  // intercepta e guarda no cache de áudio automaticamente — não precisa
  // de nenhum endpoint especial pra "baixar".
  async function downloadTrack(track) {
    if (!track?.id || _cached.has(track.id) || _downloading.has(track.id)) return;

    _downloading.add(track.id);
    _notify(track.id, 'downloading');

    try {
      await Drive.fetchAudioUrl(track.id);
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
    _postToSW({ type: 'REMOVE_AUDIO', payload: { fileId: id } });
    _notify(id, 'idle');
  }

  // ── LIMPAR TUDO ────────────────────────────────
  function clearAll() {
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
