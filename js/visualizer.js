/* ═══════════════════════════════════════════════
   HAPPY MUSIC – visualizer.js
   Visualizador de áudio: em vez de um widget à parte,
   o próprio botão de play/pause pulsa (escala + brilho
   roxo) no tempo da batida da música.
   Usa a Web Audio API (AnalyserNode) ligada direto no
   <audio> do player.js — sem alterar o playback.
═══════════════════════════════════════════════ */

const Visualizer = (() => {

  // ── ESTADO ────────────────────────────────────
  let _audioEl  = null;
  let _playBtn  = null;

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

  // ── INICIALIZAÇÃO ─────────────────────────────
  function init() {
    _audioEl = (typeof Player !== 'undefined' && Player.getAudioElement)
      ? Player.getAudioElement()
      : null;
    _playBtn = document.getElementById('btn-play-pause');

    if (!_audioEl || !_playBtn) return; // markup/áudio ainda não disponíveis

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

    // Desliga o pulso decorativo padrão (CSS) — o JS assume o controle
    _playBtn.classList.add('viz-active');
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

    _playBtn.classList.remove('viz-active'); // volta pro pulso decorativo padrão
    _playBtn.style.transform = '';
    _playBtn.style.boxShadow = '';
  }

  // ── LOOP DE ANIMAÇÃO ───────────────────────────
  function _loop() {
    _rafId = requestAnimationFrame(_loop);
    if (!_analyser) return;
    _analyser.getByteFrequencyData(_dataArray);
    _frameCount++;
    _updateButton(_dataArray);
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

  // ── ANIMA O BOTÃO DE PLAY NO RITMO DA MÚSICA ───
  function _updateButton(data) {
    const n       = data.length;
    const bassEnd = Math.max(1, Math.floor(n * 0.15));

    const bass    = _bandAvg(data, 0, bassEnd);
    const overall = _bandAvg(data, 0, n);
    const beat    = _detectBeat(bass); // 0..1, pico seco a cada batida

    // Escala é barata (compositor) — dá pra atualizar todo frame
    const scale = 1 + overall * 0.05 + beat * 0.14;
    _playBtn.style.transform = `scale(${scale.toFixed(3)})`;

    // box-shadow é a parte cara de repintar — atualiza só a cada 2 frames
    // (ainda parece suave, mas alivia CPU/GPU em aparelhos mais fracos).
    if (_frameCount % 2 === 0) {
      const spread = 22 + overall * 14 + beat * 26;
      const glowA  = Math.min(0.85, 0.38 + overall * 0.2 + beat * 0.35);
      const halo   = 20 + beat * 36;
      const glowB  = Math.min(0.6, 0.15 + beat * 0.4);
      _playBtn.style.boxShadow =
        `0 6px ${spread.toFixed(0)}px rgba(124,58,255,${glowA.toFixed(2)}), ` +
        `0 0 ${halo.toFixed(0)}px rgba(199,125,255,${glowB.toFixed(2)})`;
    }
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', () => Visualizer.init());
