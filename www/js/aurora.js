// ═══════════════════════════════════════════════
// Aurora – fundo animado tipo "aurora boreal roxa"
// pintado em <canvas> atrás da capa no player expandido.
//
// Abordagem: partículas/blobs com gradiente radial, movidas por
// somas de senos em fases diferentes (ruído orgânico "barato",
// sem precisar de lib de Perlin/Simplex noise). Roda em Canvas 2D
// puro — leve o suficiente pra WebView do Capacitor e não compete
// com o decode de áudio, ao contrário de um vídeo de fundo.
//
// Ciclo de vida: só desenha enquanto o player está .expanded
// (start/stop chamados pelo ui.js). Também pausa sozinho quando a
// aba/app fica em background (visibilitychange) e num resize
// re-dimensiona o canvas no DPR real do aparelho (limitado a 2x
// pra não pesar em telas 3x/4x).
// ═══════════════════════════════════════════════

const Aurora = (() => {
  let canvas = null;
  let ctx = null;
  let rafId = null;
  let running = false;
  let blobs = [];
  let w = 0, h = 0, dpr = 1;
  let startTime = 0;

  // Paleta roxa da marca (mesma usada no anel de glow da capa)
  const PALETTE = [
    '#7C3AFF', // --purple
    '#A06CFF', // --purple-soft
    '#5B1FD6', // --purple-deep
    '#C77DFF', // acento claro
    '#3D0F8C', // roxo profundo, quase índigo
  ];

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const RGB = PALETTE.map(hexToRgb);

  function makeBlobs(count) {
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        color: RGB[i % RGB.length],
        // posição-base em fração (0..1) da tela, pra reagir a resize
        bx: Math.random(),
        by: Math.random() * 0.7, // concentra mais na metade de cima, como aurora real
        // raio-base relativo à menor dimensão da tela
        rBase: 0.28 + Math.random() * 0.30,
        rPulseAmt: 0.05 + Math.random() * 0.08,
        // velocidades/fases distintas pra cada "onda" de deslocamento
        freqX1: 0.06 + Math.random() * 0.08,
        freqX2: 0.13 + Math.random() * 0.10,
        freqY1: 0.05 + Math.random() * 0.07,
        ampX: 0.14 + Math.random() * 0.10,
        ampY: 0.10 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseFreq: 0.15 + Math.random() * 0.12,
        alpha: 0.16 + Math.random() * 0.10,
      });
    }
    return list;
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    if (!running) return;
    const time = (t - startTime) / 1000;

    // Fundo quase preto com leve fade (em vez de clearRect puro) —
    // dá uma cauda sutil que suaviza o movimento das blobs.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6,4,12,0.35)';
    ctx.fillRect(0, 0, w, h);

    const minDim = Math.min(w, h);
    ctx.globalCompositeOperation = 'lighter';

    for (const b of blobs) {
      const x = (b.bx + Math.sin(time * b.freqX1 + b.phase) * b.ampX
                       + Math.sin(time * b.freqX2 + b.phase * 1.7) * b.ampX * 0.4) * w;
      const y = (b.by + Math.sin(time * b.freqY1 + b.phase * 0.6) * b.ampY) * h;
      const pulse = 1 + Math.sin(time * b.pulseFreq + b.pulsePhase) * b.rPulseAmt;
      const r = b.rBase * minDim * pulse;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const { r: rr, g: gg, b: bb } = b.color;
      grad.addColorStop(0, `rgba(${rr},${gg},${bb},${b.alpha})`);
      grad.addColorStop(0.55, `rgba(${rr},${gg},${bb},${b.alpha * 0.35})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    rafId = requestAnimationFrame(draw);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      pauseLoop();
    } else if (running) {
      resumeLoop();
    }
  }

  function pauseLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function resumeLoop() {
    if (rafId || !running) return;
    startTime = performance.now() - (Aurora._elapsed || 0);
    rafId = requestAnimationFrame(draw);
  }

  function start(canvasEl) {
    canvas = canvasEl || document.getElementById('player-aurora');
    if (!canvas || running) return;
    ctx = canvas.getContext('2d', { alpha: false });
    running = true;
    blobs = makeBlobs(6);
    resize();
    startTime = performance.now();
    ctx.fillStyle = '#06040c';
    ctx.fillRect(0, 0, w, h);
    rafId = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function stop() {
    running = false;
    pauseLoop();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  return { start, stop };
})();
