/* ═══════════════════════════════════════════════
   HAPPY MUSIC – visualizer.js
   Visualizador de áudio atrás do botão de play:
   um anel liso reage à batida do grave, e dois
   polígonos SVG "tremem" como ondas sonoras, com
   os pontos recalculados a partir do médio/agudo
   da música a cada frame. O botão em si fica parado.
   Usa a Web Audio API (AnalyserNode) ligada direto no
   <audio> do player.js — sem alterar o playback.
═══════════════════════════════════════════════ */

const Visualizer = (() => {

  // ── ESTADO ────────────────────────────────────
  let _audioEl  = null;
  let _stageEl  = null;
  let _ring1    = null;
  let _wave2    = null;
  let _wave3    = null;

  let _audioCtx     = null;
  let _analyser     = null;
  let _sourceNode   = null;
  let _dataArray    = null;

  let _rafId      = null;
  let _ready      = false; // grafo de áudio já montado?
  let _watchdogId = null;
  let _frameCount = 0;

  // Detecção de batida: janela curta de energia grave recente + um
  // "impulso" que dispara nos picos (kick/batida) e decai a cada frame,
  // pra dar aquele pulso seco no tempo da música em vez de só seguir o
  // volume suavemente.
  let _bassHistory = [];
  let _beatPulse   = 0;

  // Raio-base (em unidades do viewBox do SVG) de cada onda, parado
  const WAVE2_BASE = 34;
  const WAVE3_BASE = 42;

  // ── INICIALIZAÇÃO ─────────────────────────────
  function init() {
    _audioEl = (typeof Player !== 'undefined' && Player.getAudioElement)
      ? Player.getAudioElement()
      : null;

    _stageEl = document.getElementById('play-btn-stage');
    _ring1   = document.getElementById('play-ring-1');
    _wave2   = document.getElementById('play-wave-2');
    _wave3   = document.getElementById('play-wave-3');

    if (!_audioEl || !_stageEl) return; // markup/áudio ainda não disponíveis

    _resetWaves(); // desenha o círculo-base antes de qualquer música tocar

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
      _analyser.smoothingTimeConstant = 0.7; // um pouco menos suave = mais "tremido"

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
    _stageEl.style.removeProperty('--viz-energy');
    if (_ring1) { _ring1.style.transform = ''; _ring1.style.opacity = ''; }
    _resetWaves();
  }

  // ── LOOP DE ANIMAÇÃO ───────────────────────────
  function _loop() {
    _rafId = requestAnimationFrame(_loop);
    if (!_analyser) return;
    _analyser.getByteFrequencyData(_dataArray);
    _frameCount++;
    _update(_dataArray);
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

  // Gera um círculo perfeito (usado no repouso, antes de tocar qualquer coisa)
  function _circlePoints(radius, pointCount) {
    const pts = [];
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      pts.push(`${(Math.cos(angle) * radius).toFixed(1)},${(Math.sin(angle) * radius).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  function _resetWaves() {
    if (_wave2) { _wave2.setAttribute('points', _circlePoints(WAVE2_BASE, 20)); _wave2.style.opacity = ''; }
    if (_wave3) { _wave3.setAttribute('points', _circlePoints(WAVE3_BASE, 24)); _wave3.style.opacity = ''; }
  }

  // Monta o polígono "tremido": cada ponto amostra um bin de frequência
  // diferente (bins vizinhos variam bastante de amplitude, o que já dá
  // aquele serrilhado natural de onda sonora) + um chacoalho fininho
  // independente do áudio, só pra garantir tremor visível mesmo em
  // trechos mais quietos da música.
  function _wavePoints(data, startIdx, endIdx, baseRadius, jitter, pointCount) {
    const pts = [];
    const span = Math.max(1, endIdx - startIdx);
    for (let i = 0; i < pointCount; i++) {
      const angle  = (i / pointCount) * Math.PI * 2;
      const binIdx = startIdx + Math.floor((i / pointCount) * span);
      const amp    = data[Math.min(binIdx, data.length - 1)] / 255;
      const noise  = Math.sin(i * 12.9898 + _frameCount * 0.6) * 0.12;
      const r      = baseRadius + amp * jitter + noise * jitter * 0.4;
      pts.push(`${(Math.cos(angle) * r).toFixed(1)},${(Math.sin(angle) * r).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  // ── ATUALIZA O ANEL DE GRAVE + AS DUAS ONDAS ───
  function _update(data) {
    const n       = data.length;
    const bassEnd = Math.max(1, Math.floor(n * 0.15));
    const midEnd  = Math.max(bassEnd + 1, Math.floor(n * 0.5));

    const bass   = _bandAvg(data, 0, bassEnd);
    const mid    = _bandAvg(data, bassEnd, midEnd);
    const treble = _bandAvg(data, midEnd, n);
    const overall = _bandAvg(data, 0, n);
    const beat   = _detectBeat(bass); // 0..1, pico seco a cada batida

    // Alimenta o "sol" atrás de tudo — só uma custom property (barato,
    // o CSS é quem faz scale/opacity com ela; nunca escrevemos `filter`
    // aqui, que foi o que causava engasgo na música antes).
    _stageEl.style.setProperty('--viz-energy', Math.min(1, overall + beat * 0.3).toFixed(3));

    // Anel de grave: liso, soma energia contínua + o impulso da batida
    _setRing(_ring1, Math.min(1, bass + beat * 0.6), 1.00, 1.9, 0.9);

    // Ondas de médio/agudo: pontos tremidos, cuja amplitude também cresce
    // com a energia da faixa (fica mais "espinhento" quanto mais forte)
    if (_wave2) {
      _wave2.setAttribute('points', _wavePoints(data, bassEnd, midEnd, WAVE2_BASE, 10 + mid * 22, 20));
      _wave2.style.opacity = Math.min(0.9, 0.25 + mid * 0.75).toFixed(3);
    }
    if (_wave3) {
      _wave3.setAttribute('points', _wavePoints(data, midEnd, n, WAVE3_BASE, 8 + treble * 20, 24));
      _wave3.style.opacity = Math.min(0.85, 0.2 + treble * 0.7).toFixed(3);
    }
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', () => Visualizer.init());
