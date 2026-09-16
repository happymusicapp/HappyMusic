// ═══════════════════════════════════════════════
// PlayerFX – pequenos efeitos visuais do player:
//   1) toggleExpand   → transição elástica ao abrir/fechar o player
//   2) updateGlowDot  → ponto de luz na ponta da barra de progresso
//   3) ripple         → onda ao tocar no botão de play/pause
//   4) setHeartbeat   → "batida" na capa enquanto a próxima faixa carrega
//   5) initSwipe      → arrastar a capa (expandida) troca de faixa,
//                        com a capa seguinte "espiando" pela borda
//
// Tudo em Canvas/DOM + CSS puro, sem dependências, pensado pra não
// pesar no WebView do Capacitor (nada de libs de gesto/animação).
// ═══════════════════════════════════════════════

const PlayerFX = (() => {

  // Flag interna: quando um swipe "de verdade" acontece, marcamos aqui
  // pra que o botão de expandir/colapsar (que envolve a capa) ignore o
  // click sintético que o navegador dispara logo depois do arraste.
  let _suppressClick = false;

  function consumeSuppressedClick() {
    if (_suppressClick) { _suppressClick = false; return true; }
    return false;
  }

  // ── 1) TRANSIÇÃO ELÁSTICA DO PLAYER ──────────
  // Em vez de só alternar a classe .expanded (corte seco), adicionamos
  // uma classe .opening/.closing que dispara uma animação CSS com
  // "overshoot" (cubic-bezier tipo back-ease) — a sensação de mola.
  function toggleExpand(playerEl, { onOpen, onClose } = {}) {
    if (!playerEl) return;
    const opening = !playerEl.classList.contains('expanded');

    if (opening) {
      playerEl.classList.remove('closing');
      playerEl.classList.add('expanded', 'opening');
      _armAnimationCleanup(playerEl, 'opening', 650);
      onOpen && onOpen();
    } else {
      playerEl.classList.remove('opening');
      playerEl.classList.add('closing');
      _armAnimationCleanup(playerEl, 'closing', 320, () => {
        playerEl.classList.remove('expanded');
      });
      onClose && onClose();
    }
    return opening;
  }

  // Remove a classe de animação quando ela termina (ignorando
  // animationend borbulhado de filhos, tipo a capa que anima junto) —
  // e tem um fallback por timeout pra nunca travar num estado preso.
  function _armAnimationCleanup(el, className, fallbackMs, extra) {
    let done = false;
    function finish(ev) {
      if (ev && ev.target !== el) return; // ignora bubbling de filhos
      if (done) return;
      done = true;
      el.classList.remove(className);
      extra && extra();
      el.removeEventListener('animationend', finish);
    }
    el.addEventListener('animationend', finish);
    setTimeout(finish, fallbackMs);
  }

  // ── 2) BRILHO CORRENDO NA BARRA DE PROGRESSO ─
  // O elemento fica fora do "clip" da barra (que só mostra o shimmer
  // diagonal), posicionado exatamente na ponta do preenchimento via
  // left:%, sincronizado pelo mesmo updateProgress() que já existia.
  function updateGlowDot(dotEl, pct) {
    if (!dotEl) return;
    dotEl.style.left = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ── 3) RIPPLE NO BOTÃO DE PLAY ───────────────
  function ripple(btnEl) {
    if (!btnEl) return;
    const span = document.createElement('span');
    span.className = 'play-btn-ripple';
    btnEl.appendChild(span);
    let removed = false;
    const remove = () => { if (!removed) { removed = true; span.remove(); } };
    span.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 700); // segurança, caso animationend não dispare
  }

  // ── 4) HEARTBEAT DE CARREGAMENTO ─────────────
  function setHeartbeat(artEl, active) {
    if (!artEl) return;
    artEl.classList.toggle('is-loading', !!active);
  }

  // ── 5) SWIPE NA CAPA (player expandido) ──────
  // Arrastar a capa faz a faixa atual "sair" enquanto a próxima/anterior
  // "entra" pela borda, tipo um carrossel. Passou do limiar → troca de
  // verdade (onCommit); senão, volta pro lugar com uma animação suave.
  function initSwipe({ artEl, playerEl, getPrevTrack, getNextTrack, onCommit, iconFallbackHtml }) {
    if (!artEl) return;

    let dragging = false;   // ponteiro pressionado
    let decided = false;    // já decidimos que é arraste horizontal (não scroll vertical)
    let startX = 0, startY = 0, dx = 0, direction = 0;
    let artWidth = 0;
    let currentLayer = null, peekLayer = null;
    let originalHTML = '';

    function layerHtml(track) {
      if (track && track.thumbnail) {
        return `<img src="${track.thumbnail}" alt="" />`;
      }
      return iconFallbackHtml || '';
    }

    function beginDragUI(track) {
      originalHTML = artEl.innerHTML;
      artEl.innerHTML = '';

      currentLayer = document.createElement('div');
      currentLayer.className = 'player-art-layer';
      currentLayer.innerHTML = originalHTML;

      peekLayer = document.createElement('div');
      peekLayer.className = 'player-art-layer player-art-peek';
      peekLayer.style.transform = `translateX(${direction * 100}%)`;
      peekLayer.innerHTML = layerHtml(track);

      artEl.appendChild(currentLayer);
      artEl.appendChild(peekLayer);
      artEl.classList.add('is-dragging');
    }

    function applyDrag() {
      if (!currentLayer) return;
      currentLayer.style.transform = `translateX(${dx}px)`;
      if (peekLayer && artWidth) {
        const peekPct = direction * 100 + (dx / artWidth) * 100;
        peekLayer.style.transform = `translateX(${peekPct}%)`;
      }
    }

    function endDragUI(committed) {
      artEl.classList.remove('is-dragging');
      if (!currentLayer) return;

      const dur = 0.3;
      currentLayer.style.transition = `transform ${dur}s cubic-bezier(0.22,1,0.36,1)`;
      if (peekLayer) peekLayer.style.transition = `transform ${dur}s cubic-bezier(0.22,1,0.36,1)`;

      if (committed) {
        currentLayer.style.transform = `translateX(${direction * artWidth}px)`;
        if (peekLayer) peekLayer.style.transform = 'translateX(0%)';
        setTimeout(() => { onCommit && onCommit(direction); }, dur * 1000);
        // Não precisamos limpar manualmente: onCommit troca a faixa,
        // o que dispara updatePlayerTrack() e substitui o innerHTML.
      } else {
        currentLayer.style.transform = 'translateX(0px)';
        if (peekLayer) peekLayer.style.transform = `translateX(${direction * 100}%)`;
        setTimeout(() => {
          artEl.innerHTML = originalHTML;
          currentLayer = null; peekLayer = null;
        }, dur * 1000);
      }
    }

    function reset() {
      dragging = false; decided = false; dx = 0; direction = 0;
    }

    artEl.addEventListener('pointerdown', (e) => {
      if (!playerEl.classList.contains('expanded')) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      dragging = true; decided = false; dx = 0;
      startX = e.clientX; startY = e.clientY;
      artWidth = artEl.offsetWidth || 280;
      try { artEl.setPointerCapture(e.pointerId); } catch (_) {}
    });

    artEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rawDx = e.clientX - startX;
      const rawDy = e.clientY - startY;

      if (!decided) {
        if (Math.abs(rawDx) < 10 && Math.abs(rawDy) < 10) return;
        if (Math.abs(rawDx) <= Math.abs(rawDy)) { dragging = false; return; } // é scroll vertical, ignora
        direction = rawDx < 0 ? 1 : -1; // arrasta p/ esquerda = próxima; p/ direita = anterior
        const track = direction === 1 ? getNextTrack?.() : getPrevTrack?.();
        if (!track) { dragging = false; return; }
        decided = true;
        _suppressClick = true;
        beginDragUI(track);
      }

      dx = Math.max(-artWidth, Math.min(artWidth, rawDx));
      currentLayer && (currentLayer.style.transition = 'none');
      peekLayer && (peekLayer.style.transition = 'none');
      applyDrag();
    });

    function finish() {
      if (!dragging) return;
      dragging = false;
      if (!decided) return;
      const threshold = Math.max(56, artWidth * 0.26);
      endDragUI(Math.abs(dx) > threshold);
      reset();
    }

    artEl.addEventListener('pointerup', finish);
    artEl.addEventListener('pointercancel', () => { if (decided) endDragUI(false); reset(); });
  }

  return { toggleExpand, updateGlowDot, ripple, setHeartbeat, initSwipe, consumeSuppressedClick };
})();
