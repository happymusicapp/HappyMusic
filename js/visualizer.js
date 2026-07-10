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
  let _hueBase       = 0;      // gira continuamente pro efeito "arco-íris vivo"

  // Paleta neon "argolas" — matiz exatos de vermelho, roxo, azul, amarelo,
  // verde e laranja, na ordem natural do círculo cromático (pra interpolar
  // suave entre uma cor e outra em vez de saltar).
  const PALETTE_HUES = [25, 48, 155, 205, 275, 350]; // laranja, amarelo, verde, azul, roxo, vermelho

  // Interpola o matiz numa posição t (0..1) ao longo da paleta acima,
  // cruzando suavemente de uma argola pra outra.
  function _hueAt(t) {
    const n      = PALETTE_HUES.length;
    const scaled = ((t % 1) + 1) % 1 * n;
    const idx    = Math.floor(scaled) % n;
    const frac   = scaled - Math.floor(scaled);
    const h1     = PALETTE_HUES[idx];
    let   h2     = PALETTE_HUES[(idx + 1) % n];
    if (h2 < h1) h2 += 360; // cruza o "fim" do círculo (vermelho → laranja)
    return (h1 + (h2 - h1) * frac) % 360;
  }

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
    _hueBase = (_hueBase + 2.2) % 360; // gira o arco-íris a cada frame
    _drawBars(_dataArray, true);
  }

  // ── DESENHO ────────────────────────────────────
  function _drawBars(data, animated) {
    const w = _canvas.width;
    const h = _canvas.height;
    if (!w || !h) return;

    // Volume médio, usado só pra "respirar" o fundo com a música
    let avg = 0;
    if (animated) {
      for (let i = 0; i < data.length; i++) avg += data[i];
      avg = avg / data.length / 255; // 0..1
    }

    // Fundo: leve rastro (em vez de limpar 100%) só enquanto está tocando —
    // isso dá aquele efeito "respirando" sem deixar resíduo da última faixa
    // quando o áudio pausa ou o canvas é redimensionado.
    if (animated) {
      _canvasCtx.fillStyle = 'rgba(8,6,14,0.42)';
      _canvasCtx.fillRect(0, 0, w, h);
    } else {
      _canvasCtx.clearRect(0, 0, w, h);
    }

    if (animated && avg > 0.02) {
      const glowRadius = w * (0.25 + avg * 0.35);
      const bgHue = _hueAt(_hueBase / 360 + 0.5);
      const radial = _canvasCtx.createRadialGradient(
        w / 2, h * 1.05, 0,
        w / 2, h * 1.05, glowRadius
      );
      radial.addColorStop(0, `hsla(${bgHue}, 100%, 60%, ${0.16 + avg * 0.22})`);
      radial.addColorStop(1, 'rgba(0,0,0,0)');
      _canvasCtx.fillStyle = radial;
      _canvasCtx.fillRect(0, 0, w, h);
    }

    const barCount = data.length;
    const gap      = w * 0.006;
    const barWidth = Math.max(1, (w - gap * (barCount - 1)) / barCount);

    for (let i = 0; i < barCount; i++) {
      const value  = animated ? data[i] / 255 : 0.08;
      const barH   = Math.max(h * 0.02, value * h * 0.98);
      const x      = i * (barWidth + gap);
      const y      = h - barH;

      // Matiz gira continuamente + varia por posição → arco-íris vivo que
      // nunca se repete igual, em vez de uma paleta fixa.
      // Posição da barra + fase animada → cor interpolada dentro da paleta
      // das argolas (nunca sai do vermelho/roxo/azul/amarelo/verde/laranja).
      const t      = (i / barCount) + (_hueBase / 360);
      const hue    = _hueAt(t);
      const c1     = `hsl(${hue}, 100%, ${animated ? 58 : 40}%)`;
      const c2     = `hsl(${_hueAt(t + 0.02)}, 100%, 72%)`;
      const c3     = '#ffffff';

      const gradient = _canvasCtx.createLinearGradient(0, h, 0, y);
      gradient.addColorStop(0,   c1);
      gradient.addColorStop(0.6, c2);
      gradient.addColorStop(1,   c3);

      // Camada 1 — halo bem largo e translúcido (dá o "brilho vazando")
      _canvasCtx.save();
      _canvasCtx.globalAlpha = animated ? 0.55 : 0.25;
      _canvasCtx.shadowColor = c1;
      _canvasCtx.shadowBlur  = animated ? Math.max(18, value * 55) : 12;
      _canvasCtx.fillStyle   = gradient;
      _roundRectPath(x, y, barWidth, barH, barWidth * 0.4);
      _canvasCtx.fill();
      _canvasCtx.restore();

      // Camada 2 — núcleo nítido por cima, mais saturado e com blur menor
      _canvasCtx.save();
      _canvasCtx.shadowColor = c2;
      _canvasCtx.shadowBlur  = animated ? Math.max(10, value * 28) : 6;
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
