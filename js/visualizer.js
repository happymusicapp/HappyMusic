/* ═══════════════════════════════════════════════
   HAPPY MUSIC – visualizer.js
   Visualizador de áudio: barras verticais neon
   reagindo em tempo real à música, no estilo dos
   visualizadores clássicos do Windows Media Player.
   Usa a Web Audio API (AnalyserNode) ligada direto
   no <audio> do player.js — sem alterar o playback.
═══════════════════════════════════════════════ */

const Visualizer = (() => {

  // ── ESTADO ────────────────────────────────────
  let _audioEl      = null;
  let _canvas        = null;
  let _canvasCtx     = null;
  let _hintEl        = null;

  let _audioCtx      = null;
  let _analyser      = null;
  let _sourceNode     = null;
  let _dataArray     = null;
  let _bufferLength  = 0;

  let _rafId         = null;
  let _ready          = false; // grafo de áudio já montado?

  // Paleta neon "psicodélica" — ciclada barra a barra.
  const NEON_COLORS = [
    '#FF00E5', '#FF3EA5', '#FF6B6B', '#FFB84D',
    '#FFD23F', '#B4FF39', '#39FF14', '#14FFB8',
    '#00F0FF', '#00B4FF', '#7C3AFF', '#C77DFF',
  ];

  // ── INICIALIZAÇÃO ─────────────────────────────
  function init() {
    _audioEl = (typeof Player !== 'undefined' && Player.getAudioElement)
      ? Player.getAudioElement()
      : null;
    _canvas  = document.getElementById('visualizer-canvas');
    _hintEl  = document.getElementById('visualizer-hint');

    if (!_audioEl || !_canvas) return; // markup/áudio ainda não disponíveis

    _canvasCtx = _canvas.getContext('2d');
    _resizeCanvas();

    window.addEventListener('resize', _resizeCanvas);

    _audioEl.addEventListener('play',  _onPlay);
    _audioEl.addEventListener('pause', _onPause);
    _audioEl.addEventListener('ended', _onPause);

    _drawIdle();
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

      _audioCtx    = new AudioCtx();
      _sourceNode  = _audioCtx.createMediaElementSource(_audioEl);
      _analyser    = _audioCtx.createAnalyser();
      _analyser.fftSize = 128;
      _analyser.smoothingTimeConstant = 0.78;

      _bufferLength = _analyser.frequencyBinCount;
      _dataArray    = new Uint8Array(_bufferLength);

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
    if (_hintEl) _hintEl.classList.add('hidden');
    if (!_rafId) _loop();
  }

  function _onPause() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = null;
    _drawIdle();
  }

  // ── CANVAS RESPONSIVO ──────────────────────────
  function _resizeCanvas() {
    if (!_canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = _canvas.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    _canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    _canvas.height = Math.max(1, Math.round(rect.height * dpr));

    if (!_rafId) _drawIdle();
  }

  // ── LOOP DE ANIMAÇÃO ───────────────────────────
  function _loop() {
    _rafId = requestAnimationFrame(_loop);
    if (!_analyser) return;
    _analyser.getByteFrequencyData(_dataArray);
    _drawBars(_dataArray, true);
  }

  // ── DESENHO ────────────────────────────────────
  function _drawBars(data, animated) {
    const w = _canvas.width;
    const h = _canvas.height;
    if (!w || !h) return;

    _canvasCtx.clearRect(0, 0, w, h);

    const barCount = data.length;
    const gap      = w * 0.006;
    const barWidth = Math.max(1, (w - gap * (barCount - 1)) / barCount);

    for (let i = 0; i < barCount; i++) {
      const value  = animated ? data[i] / 255 : 0.08;
      const barH   = Math.max(h * 0.02, value * h * 0.96);
      const x      = i * (barWidth + gap);
      const y      = h - barH;
      const color  = NEON_COLORS[i % NEON_COLORS.length];

      const gradient = _canvasCtx.createLinearGradient(0, h, 0, y);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, '#ffffff');

      _canvasCtx.save();
      _canvasCtx.shadowColor = color;
      _canvasCtx.shadowBlur  = animated ? Math.max(6, value * 22) : 8;
      _canvasCtx.fillStyle   = gradient;
      _roundRectPath(x, y, barWidth, barH, barWidth * 0.4);
      _canvasCtx.fill();
      _canvasCtx.restore();
    }
  }

  // Estado parado (nenhuma música tocando): barrinhas baixas e suaves,
  // só pra manter o visual vivo mesmo sem áudio rolando.
  function _drawIdle() {
    if (!_canvasCtx || !_canvas) return;
    const fakeData = new Uint8Array(48); // valores todos zerados
    _drawBars(fakeData, false);
    if (_hintEl) _hintEl.classList.remove('hidden');
  }

  function _roundRectPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    _canvasCtx.beginPath();
    _canvasCtx.moveTo(x + r, y);
    _canvasCtx.arcTo(x + w, y,     x + w, y + h, r);
    _canvasCtx.arcTo(x + w, y + h, x,     y + h, r);
    _canvasCtx.arcTo(x,     y + h, x,     y,     r);
    _canvasCtx.arcTo(x,     y,     x + w, y,     r);
    _canvasCtx.closePath();
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', () => Visualizer.init());
