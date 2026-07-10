/* ═══════════════════════════════════════════════
   HAPPY MUSIC – visualizer.js
   Visualizador de áudio: três argolas neon atrás do
   botão de play, que pulsam no tempo da batida da
   música. O botão em si fica parado — quem "dança"
   é a luz por trás dele.
   Usa a Web Audio API (AnalyserNode) ligada direto no
   <audio> do player.js — sem alterar o playback.
═══════════════════════════════════════════════ */

const Visualizer = (() => {

  // ── ESTADO ────────────────────────────────────
  let _audioEl  = null;
  let _stageEl  = null;
  let _ring1    = null;
  let _ring2    = null;
  let _ring3    = null;

  let _audioCtx     = null;
  let _analyser     = null;
  let _sourceNode   = null;
  let _dataArray    = null;

  let _rafId      = null;
  let _ready      = false; // grafo de áudio já montado?
  let _watchdogId = null;

  // Detecção de batida: janela curta de energia grave recente + um
  // "impulso" que dispara nos picos (kick/batida) e decai a cada frame,
  // pra dar aquele pulso seco no tempo da música em vez de só seguir o
  // volume suavemente.
  let _bassHistory = [];
  let _beatPulse   = 0;

  // ── INICIALIZAÇÃO ─────────────────────────────
  function init() {
    _audioEl = (typeof Player !== 'undefined' && Player.getAudioElement)
      ? Player.getAudioElement()
      : null;

    _stageEl = document.getElementById('play-btn-stage');
    _ring1   = document.getElementById('play-ring-1');
    _ring2   = document.getElementById('play-ring-2');
    _ring3   = document.getElementById('play-ring-3');

    if (!_audioEl || !_stageEl) return; // markup/áudio ainda não disponíveis

    _audioEl.addEventListener('play',  _onPlay);
    _audioEl.addEventListener('pause', _onPause);
    _audioEl.addEventListener('ended', _onPause);

    // O áudio agora passa PELO AudioContext (pra o analyser conseguir ler
    // os dados) — se o navegador suspender o contexto (tela bloqueada, app
    // em segundo plano, economia de energia), o SOM PARA de verdade, não
    // é só o visual que congela. Por isso resume agressivamente sempre
    // que a página volta a ficar visível/em foco.
    document.addEventListener('visibilitychange', _resumeIfNeeded);
    window.addEventListener('focus', _resumeIfNeeded);
    window.addEventListener('pageshow', _resumeIfNeeded);
  }

  function _resumeIfNeeded() {
    if (_audioCtx && _audioCtx.state === 'suspended' && _audioEl && !_audioEl.paused) {
      _audioCtx.resume().catch(() => {});
    }
  }

  // Cria o grafo de áudio (AudioContext → AnalyserNode → destino) só na
  // primeira vez que a música toca. createMediaElementSource só pode ser
  // chamado uma vez por elemento <audio>, por isso o guard em `_ready`.
  // Importante: o analyser é conectado em ctx.destination pra que o som
  // continue saindo normalmente — sem isso, o áudio ficaria mudo.
  function _ensureAudioGraph() {
    if (_ready) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      _audioCtx   = new AudioCtx();
      _sourceNode = _audioCtx.createMediaElementSource(_audioEl);
      _analyser   = _audioCtx.createAnalyser();
      _analyser.fftSize = 128;
      _analyser.smoothingTimeConstant = 0.78;

      _dataArray = new Uint8Array(_analyser.frequencyBinCount);

      _sourceNode.connect(_analyser);
      _analyser.connect(_audioCtx.destination);

      _ready = true;
    } catch (err) {
      console.error('[Visualizer] Não foi possível iniciar o Web Audio API:', err);
    }
  }

  // ── EVENTOS DE PLAYBACK ────────────────────────
  function _onPlay() {
    _ensureAudioGraph();
    if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();

    _stageEl.classList.add('viz-active'); // desliga o "respirar" via CSS, JS assume
    _bassHistory = [];
    _beatPulse   = 0;

    if (!_rafId) _loop();

    // Watchdog: alguns Android suspendem o AudioContext sem disparar
    // nenhum evento (nem visibilitychange) — confere de tempos em tempos
    // se ainda está tocando de verdade enquanto o <audio> diz que sim.
    if (!_watchdogId) _watchdogId = setInterval(_resumeIfNeeded, 2000);
  }

  function _onPause() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = null;
    if (_watchdogId) { clearInterval(_watchdogId); _watchdogId = null; }

    _stageEl.classList.remove('viz-active'); // volta a "respirar" sozinho
    _resetRings();
  }

  // ── LOOP DE ANIMAÇÃO ───────────────────────────
  function _loop() {
    _rafId = requestAnimationFrame(_loop);
    if (!_analyser) return;
    _analyser.getByteFrequencyData(_dataArray);
    _updateRings(_dataArray);
  }

  // Média normalizada (0..1) de uma faixa do espectro
  function _bandAvg(data, start, end) {
    if (end <= start) return 0;
    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i];
    return (sum / (end - start)) / 255;
  }

  // Compara o grave atual com a média recente — um salto brusco acima da
  // média é uma "batida" (kick/bumbo). Dispara um impulso que decai rápido
  // nos frames seguintes, criando o efeito de pulso no tempo da música.
  function _detectBeat(bass) {
    _bassHistory.push(bass);
    if (_bassHistory.length > 32) _bassHistory.shift(); // ~0.5s de janela a 60fps

    const avg = _bassHistory.reduce((a, b) => a + b, 0) / _bassHistory.length;
    const isBeat = _bassHistory.length > 10 && bass > 0.24 && bass > avg * 1.32;

    _beatPulse = isBeat ? 1 : _beatPulse * 0.82; // decaimento rápido entre batidas
    return _beatPulse;
  }

  function _setRing(el, energy, minScale, maxScale, maxOpacity) {
    if (!el) return;
    const scale   = minScale + energy * (maxScale - minScale);
    const opacity = Math.min(maxOpacity, 0.15 + energy * maxOpacity);
    el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    el.style.opacity   = opacity.toFixed(3);
  }

  // ── ARGOLAS REAGINDO À MÚSICA (grave/médio/agudo) ──
  function _updateRings(data) {
    const n       = data.length;
    const bassEnd = Math.max(1, Math.floor(n * 0.15));
    const midEnd  = Math.max(bassEnd + 1, Math.floor(n * 0.5));

    const bass   = _bandAvg(data, 0, bassEnd);
    const mid    = _bandAvg(data, bassEnd, midEnd);
    const treble = _bandAvg(data, midEnd, n);
    const beat   = _detectBeat(bass); // 0..1, pico seco a cada batida

    // A argola mais próxima do botão soma grave contínuo + o impulso da
    // batida — dá aquele "salto" nítido a cada kick.
    _setRing(_ring1, Math.min(1, bass + beat * 0.6), 1.00, 1.9, 0.9);
    _setRing(_ring2, mid,                             1.15, 2.5, 0.65);
    _setRing(_ring3, treble,                           1.30, 3.2, 0.5);
  }

  // Estado parado: devolve o controle pro CSS (animação "respirando" sozinha)
  function _resetRings() {
    [_ring1, _ring2, _ring3].forEach(el => {
      if (!el) return;
      el.style.transform = '';
      el.style.opacity   = '';
    });
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', () => Visualizer.init());
