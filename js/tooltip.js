// ══════════════════════════════════════════════════════════════════
//  TOOLTIPS
// ══════════════════════════════════════════════════════════════════
//  Native `title` tooltips are unstyleable, slow to appear, and never show on
//  touch devices — which matters here because the header is now largely
//  icon-only, so the label IS the affordance.
//
//  Opt in with `data-tip="Label"` and optionally `data-tip-kbd="X"` for a
//  shortcut chip. A single delegated listener + one shared node keeps this
//  cheap regardless of how many elements opt in.
//
//  Interaction model:
//    pointer  — hover, after a short delay
//    keyboard — on focus-visible, immediately
//    touch    — long-press (native tooltips never fire here)
(function () {
  const SHOW_DELAY = 380;
  const TOUCH_HOLD = 450;
  const GAP = 8;
  // Past this length a label is a sentence, not a name — let it wrap.
  const WRAP_AT = 46;

  let tipEl = null;
  let showTimer = null;
  let holdTimer = null;
  let current = null;

  function ensureEl() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function targetFor(node) {
    return node && node.closest ? node.closest('[data-tip]') : null;
  }

  // Positioned fixed and clamped to the viewport. Flips below the target when
  // there isn't room above, so header buttons read downward as expected.
  function place(target, point) {
    const el = ensureEl();
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;

    const anchorX = point?.x ?? (r.left + r.width / 2);
    const anchorY = point?.y ?? r.bottom;
    let top = anchorY + GAP;
    let placement = 'below';
    if (top + th > innerHeight - 4) {
      const above = anchorY - GAP - th;
      if (above >= 4) { top = above; placement = 'above'; }
    }

    let left = anchorX - tw / 2;
    left = Math.max(6, Math.min(left, innerWidth - tw - 6));

    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.dataset.placement = placement;
  }

  function show(target, point) {
    if (!target) return;
    const label = target.getAttribute('data-tip');
    if (!label) return;

    const el = ensureEl();
    const kbd = target.getAttribute('data-tip-kbd');
    el.textContent = '';
    el.appendChild(document.createTextNode(label));
    // Sentence-length or explicitly multi-line labels wrap into a block;
    // short single-line ones stay on one line.
    el.classList.toggle('wrap', label.length > WRAP_AT || label.includes('\n'));
    if (kbd) {
      const k = document.createElement('span');
      k.className = 'tooltip-kbd';
      k.textContent = kbd;
      el.appendChild(k);
    }

    current = target;
    // Make it measurable before positioning, but not yet visible.
    el.classList.add('measuring');
    el.classList.remove('show');
    place(target, point);
    el.classList.remove('measuring');
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(holdTimer);
    current = null;
    if (!tipEl) return;
    tipEl.classList.remove('show', 'measuring', 'wrap');
    tipEl.setAttribute('aria-hidden', 'true');
  }

  function scheduleShow(target, delay, point) {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(target, point), delay);
  }

  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const t = targetFor(e.target);
    if (!t || t === current) return;
    scheduleShow(t, SHOW_DELAY, { x: e.clientX, y: e.clientY });
  });

  document.addEventListener('pointerout', e => {
    if (e.pointerType === 'touch') return;
    const t = targetFor(e.target);
    if (!t) return;
    // Ignore moves between descendants of the same target.
    if (e.relatedTarget && targetFor(e.relatedTarget) === t) return;
    hide();
  });

  // Long-press on touch, since hover doesn't exist there.
  document.addEventListener('touchstart', e => {
    const t = targetFor(e.target);
    if (!t) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => show(t, { x: e.touches[0]?.clientX, y: e.touches[0]?.clientY }), TOUCH_HOLD);
  }, { passive: true });

  ['touchend', 'touchcancel', 'touchmove'].forEach(evt => {
    document.addEventListener(evt, () => {
      clearTimeout(holdTimer);
      // Leave a briefly-shown tip up long enough to read after release.
      if (current) setTimeout(hide, 1200);
    }, { passive: true });
  });

  document.addEventListener('focusin', e => {
    const t = targetFor(e.target);
    if (!t) return;
    // Only for keyboard focus; a click already conveys intent.
    if (t.matches && t.matches(':focus-visible')) show(t);
  });

  document.addEventListener('focusout', e => {
    if (targetFor(e.target)) hide();
  });

  // Any of these can move or obscure the anchor.
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
})();
