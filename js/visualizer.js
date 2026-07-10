/* ═══════════════════════════════════════════════
   HAPPY MUSIC – visualizer.js
   Visualizador de áudio atrás do botão de play.

   IMPORTANTE — por que não usa mais Web Audio API:
   As versões anteriores ligavam o <audio> num
   AudioContext (createMediaElementSource → Analyser →
   destino) pra conseguir "ler" a música de verdade.
   Só que isso faz o SOM em si passar a depender desse
   contexto — e o Android suspende/mexe nele sozinho
   (tela bloqueada, outro app em primeiro plano, économia
   de energia), causando música picotada/chiando, às
   vezes até sem motivo aparente.

   Por isso agora o visualizador é 100% decorativo: ele
   só olha se o <audio> está tocando ou pausado (evento
   padrão, inofensivo) e anima os anéis/ondas com um
   "pulso" e um "tremido" simulados por tempo — parece
   reagir à música, mas nunca encosta no áudio de
   verdade. Zero risco de engasgo.
═══════════════════════════════════════════════ */

const Visualizer = (() => {

  // ── ESTADO ────────────────────────────────────
  let _audioEl  = null;
  let _stageEl  = null;
  let _ring1    = null;
  let _wave2    = null;
  let _wave3    = null;

  let _rafId        = null;
  let _playStartTime = 0;

  // BPM "médio" usado só pra simular o pulso da batida — não é lido da
  // música real, é só um ritmo genérico que dá a sensação de estar vivo.
  const FAKE_BPM       = 116;
  const BEAT_INTERVAL  = 60000 / FAKE_BPM; // ms

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

    _resetShapes(); // desenha o círculo-base antes de qualquer música tocar

    _audioEl.addEventListener('play',  _onPlay);
    _audioEl.addEventListener('pause', _onPause);
    _audioEl.addEventListener('ended', _onPause);
  }

  // ── EVENTOS DE PLAYBACK (só leitura — nunca mexe no áudio) ──
  function _onPlay() {
    _stageEl.classList.add('viz-active'); // desliga o "respirar" via CSS, JS assume
    _playStartTime = performance.now();
    if (!_rafId) _loop();
  }

  function _onPause() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = null;

    _stageEl.classList.remove('viz-active'); // volta a "respirar" sozinho
    _stageEl.style.removeProperty('--viz-energy');
    if (_ring1) { _ring1.style.transform = ''; _ring1.style.opacity = ''; }
    _resetShapes();
  }

  // ── LOOP DE ANIMAÇÃO ───────────────────────────
  function _loop(now) {
    _rafId = requestAnimationFrame(_loop);
    _update(now || performance.now());
  }

  // Pulso "seco" simulado: sobe rápido no início de cada ciclo e decai
  // rápido — imita a sensação de uma batida sem precisar analisar áudio.
  function _fakeBeat(elapsed) {
    const phase = (elapsed % BEAT_INTERVAL) / BEAT_INTERVAL; // 0..1 no ciclo atual
    return Math.max(0, 1 - phase * 3.4);
  }

  function _setRing(el, energy, minScale, maxScale, maxOpacity) {
    if (!el) return;
    const scale   = minScale + energy * (maxScale - minScale);
    const opacity = Math.min(maxOpacity, 0.15 + energy * maxOpacity);
    el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    el.style.opacity   = opacity.toFixed(3);
  }

  function _circlePoints(radius, pointCount) {
    const pts = [];
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      pts.push(`${(Math.cos(angle) * radius).toFixed(1)},${(Math.sin(angle) * radius).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  function _resetShapes() {
    if (_wave2) { _wave2.setAttribute('points', _circlePoints(WAVE2_BASE, 20)); _wave2.style.opacity = ''; }
    if (_wave3) { _wave3.setAttribute('points', _circlePoints(WAVE3_BASE, 24)); _wave3.style.opacity = ''; }
  }

  // Onda "tremida" simulada: soma de senos com fases diferentes por
  // ponto e no tempo — dá um tremor orgânico sem depender de áudio real.
  function _wavePoints(now, baseRadius, jitter, pointCount, seed) {
    const pts = [];
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      const n1 = Math.sin(i * 1.7 + now * 0.0024 + seed);
      const n2 = Math.sin(i * 3.3 - now * 0.0037 + seed * 2.3);
      const amp = (n1 * 0.6 + n2 * 0.4 + 1) / 2; // normaliza pra 0..1
      const r = baseRadius + amp * jitter;
      pts.push(`${(Math.cos(angle) * r).toFixed(1)},${(Math.sin(angle) * r).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  // ── ATUALIZA O ANEL DE GRAVE + AS DUAS ONDAS ───
  function _update(now) {
    const elapsed = now - _playStartTime;
    const beat = _fakeBeat(elapsed);

    // "Sol" atrás de tudo — reage ao pulso simulado + uma leve respiração
    const energy = Math.min(1, 0.32 + beat * 0.55 + (Math.sin(now * 0.0016) * 0.5 + 0.5) * 0.15);
    _stageEl.style.setProperty('--viz-energy', energy.toFixed(3));

    // Anel de grave: liso, salta no pulso simulado
    _setRing(_ring1, beat, 1.00, 1.9, 0.9);

    // Ondas: tremor orgânico + um pouco mais de amplitude perto da batida
    if (_wave2) {
      _wave2.setAttribute('points', _wavePoints(now, WAVE2_BASE, 12 + beat * 14, 20, 1.3));
      _wave2.style.opacity = (0.35 + beat * 0.4).toFixed(3);
    }
    if (_wave3) {
      _wave3.setAttribute('points', _wavePoints(now, WAVE3_BASE, 9 + beat * 11, 24, 4.7));
      _wave3.style.opacity = (0.3 + beat * 0.35).toFixed(3);
    }
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', () => Visualizer.init());
