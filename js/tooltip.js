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

  // How the box clears what it describes. A tooltip GAP below the point where
  // the pointer crossed a 60px state circle lands *on* the circle, so a target
  // small enough to step over is anchored to its own box and the box is cleared
  // whole. Only something too large for that falls back to the pointer — an edge
  // group's rect is the entire arc, and stepping over that would fling the
  // tooltip to the far end of the diagram — where the clearance has just to get
  // past the 16px hit stroke the pointer is somewhere inside.
  const CLEAR_POINT = 13;
  const COMPACT_MAX = 96;
  // Past this length a label is a sentence, not a name — let it wrap.
  const WRAP_AT = 46;

  // Crossing the GAP between the anchor and the tooltip means leaving the
  // anchor, which is a pointerout. Long enough to walk 8px, short enough that
  // an ordinary "move away" still feels immediate.
  const HIDE_GRACE = 160;

  let tipEl = null;
  let bodyEl = null;
  let showTimer = null;
  let holdTimer = null;
  let hideTimer = null;
  let current = null;
  // The target a show is already armed for. `current` cannot answer this: it is
  // only set once the tooltip is up, so before that every hoverable descendant
  // crossed on the way in re-armed the timer from scratch with a new anchor —
  // and several exist. An accepting state's ring is a painted 1.5px annulus 5px
  // inside the rim, and a selected edge carries its curve handle, so those two
  // waited out the delay twice while a plain state waited it out once.
  let pending = null;

  // Whether the pointer may enter the tooltip. Only ever true for a tip whose
  // content did not fit — see the note over `.tooltip.is-reachable` in
  // css/modals.css for why this is not simply always on.
  function reachable() {
    return !!tipEl && tipEl.classList.contains('is-reachable');
  }

  function inTip(node) {
    return !!(tipEl && node && node !== document && tipEl.contains(node));
  }

  function ensureEl() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.setAttribute('aria-hidden', 'true');
    // The scroll lives on an inner box, not on .tooltip itself. A browser drops
    // border-radius on whichever edge a scrollbar occupies when the element
    // carrying the radius is also the scroll container, so a scrolling tooltip
    // came back with two square corners down its right-hand side. The outer box
    // keeps the radius and clips to it; the inner one scrolls. It also keeps the
    // keycap chip out of the scrolling area, where it belongs — a shortcut is a
    // property of the control, not a row of its description.
    bodyEl = document.createElement('div');
    bodyEl.className = 'tooltip-body';
    tipEl.appendChild(bodyEl);
    // Attached once, at creation, the way the canvas renderer attaches its
    // listeners — they outlive every later show() and close over nothing.
    tipEl.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    tipEl.addEventListener('pointerleave', hide);
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

    // Measure from a neutral offset, not from wherever the last tooltip was.
    // A position: fixed box with `left` set and `right: auto` shrink-to-fits
    // against `viewport - left`, so measuring while the previous hover's offset
    // is still on the element squeezes the width — and that squeezed width is
    // then what the new offset is computed from. A table hovered near the right
    // edge came back permanently narrow, breaking "Write" into "Wri/te".
    el.style.left = '0px';
    el.style.top = '0px';
    const tw = el.offsetWidth;
    const th = el.offsetHeight;

    // See CLEAR_POINT above. The two ends are tracked separately because the
    // flip has to clear the *top* of the target: measured from its bottom, an
    // "above" placement lands back on the thing it is describing.
    const useRect = !point || (r.width <= COMPACT_MAX && r.height <= COMPACT_MAX);
    const anchorX = useRect ? r.left + r.width / 2 : point.x;
    const anchorBottom = useRect ? r.bottom : point.y + CLEAR_POINT;
    const anchorTop = useRect ? r.top : point.y - CLEAR_POINT;

    let top = anchorBottom + GAP;
    let placement = 'below';
    if (top + th > innerHeight - 4) {
      const above = anchorTop - GAP - th;
      if (above >= 4) { top = above; placement = 'above'; }
    }

    // Neither end fits when the tip is taller than the room at either — a long
    // edge bundle, or a table with a row per tape. Before this, `top` was only
    // ever *chosen*, never bounded, so such a tooltip ran off the bottom of the
    // window and was cut off with nothing to say so. The stylesheet's max-height
    // is the other half: clamping alone would slide a too-tall box up until its
    // own top left the screen instead.
    top = Math.max(6, Math.min(top, innerHeight - th - 6));

    let left = anchorX - tw / 2;
    left = Math.max(6, Math.min(left, innerWidth - tw - 6));

    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.dataset.placement = placement;
  }

  // A label may be a small table: rows split on \n and cells on \t, with a row of
  // exactly '---' drawn as a rule. A row holding one cell spans the full
  // width, so a heading and a hint sit above and below the columns without a
  // second grammar for them.
  //
  // It stays a *string* deliberately. data-tip is an attribute, so a structured
  // payload would mean a second channel into this module and a second tooltip
  // implementation to go with it. This way every existing tooltip is unchanged
  // and the ones with something tabular to say gain a way to say it — the tab
  // is the whole opt-in, and a plain label never reaches this path.
  function renderGrid(el, label) {
    const rows = label.split('\n');
    const cols = rows.reduce((n, r) => Math.max(n, r.split('\t').length), 1);
    const grid = document.createElement('div');
    grid.className = 'tooltip-grid';
    grid.style.gridTemplateColumns = `repeat(${cols}, max-content)`;
    for (const row of rows) {
      if (row === '---') {
        const hr = document.createElement('div');
        hr.className = 'tooltip-rule';
        grid.appendChild(hr);
        continue;
      }
      const cells = row.split('\t');
      cells.forEach((text, i) => {
        const cell = document.createElement('div');
        // The first column is what a row is *called*; the rest is what it says.
        // A lone cell is a heading or a hint, and spans rather than sitting in
        // the key column looking like one very wide label.
        cell.className = 'tooltip-cell'
          + (cells.length === 1
            ? (text.startsWith('+') ? ' tooltip-more' : ' tooltip-span')
            : (i === 0 ? ' tooltip-key' : ''));
        cell.textContent = text;
        grid.appendChild(cell);
      });
    }
    el.appendChild(grid);
  }

  function show(target, point) {
    if (!target) return;
    const label = target.getAttribute('data-tip');
    if (!label) return;

    const el = ensureEl();
    const kbd = target.getAttribute('data-tip-kbd');
    // Clearing `el` would take the body box with it, so the two parts are
    // cleared separately: the content, and the keycap chip a previous show may
    // have appended beside it.
    bodyEl.textContent = '';
    const oldKbd = el.querySelector('.tooltip-kbd');
    if (oldKbd) oldKbd.remove();
    const tabular = label.includes('\t');
    if (tabular) renderGrid(bodyEl, label);
    else bodyEl.appendChild(document.createTextNode(label));
    // Sentence-length or explicitly multi-line labels wrap into a block; short
    // single-line ones stay on one line. A grid is already a block and must not
    // inherit pre-line — its cells carry the breaks themselves.
    el.classList.toggle('is-grid', tabular);
    el.classList.toggle('wrap', !tabular && (label.length > WRAP_AT || label.includes('\n')));
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
    // Measured rather than assumed: the content is whole, so this is the case
    // that actually overflowed, and a tooltip that fits must keep
    // pointer-events: none — it sits over the canvas, and one that could be
    // hovered would take the pointer off the diagram it is describing. The
    // measurement is of the body, which is what scrolls; the class goes on the
    // outer box, which is what the pointer meets. Height only, because that is
    // the only axis the body scrolls on.
    el.classList.toggle('is-reachable', bodyEl.scrollHeight > bodyEl.clientHeight + 1);
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(holdTimer);
    clearTimeout(hideTimer);
    pending = null;
    current = null;
    if (!tipEl) return;
    tipEl.classList.remove('show', 'measuring', 'wrap', 'is-grid', 'is-reachable');
    tipEl.setAttribute('aria-hidden', 'true');
  }

  // Leaving the anchor hides at once when there is nothing to reach for, and
  // after a grace period when there is — the pointer may be on its way in.
  // pointerenter on the tooltip cancels it.
  function leave() {
    if (!reachable()) { hide(); return; }
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_GRACE);
  }

  function scheduleShow(target, delay, point) {
    clearTimeout(showTimer);
    pending = target;
    showTimer = setTimeout(() => { pending = null; show(target, point); }, delay);
  }

  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    // Moving onto the tooltip is not moving onto a new anchor: it must not
    // re-arm the show timer for whatever is behind it, and it cancels the
    // pending hide the way pointerenter does.
    if (inTip(e.target)) { clearTimeout(hideTimer); return; }
    const t = targetFor(e.target);
    // `pending` as well as `current`: crossing from a state's circle onto its
    // accepting ring, or from an edge onto its curve handle, is a pointerover
    // for a descendant of the target already being waited on — not a new anchor.
    if (!t || t === current || t === pending) return;
    scheduleShow(t, SHOW_DELAY, { x: e.clientX, y: e.clientY });
  });

  document.addEventListener('pointerout', e => {
    if (e.pointerType === 'touch') return;
    if (inTip(e.target)) return;
    const t = targetFor(e.target);
    if (!t) return;
    // Ignore moves between descendants of the same target.
    if (e.relatedTarget && targetFor(e.relatedTarget) === t) return;
    // Straight into the tooltip is not leaving at all.
    if (inTip(e.relatedTarget)) { clearTimeout(hideTimer); return; }
    leave();
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
      // A tooltip cannot be hovered (pointer-events: none), so on touch the only
      // dwell it gets is this one — and a table takes longer to read than a
      // phrase does.
      if (current) setTimeout(hide, tipEl && tipEl.classList.contains('is-grid') ? 4000 : 1200);
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

  // Any of these can move or obscure the anchor. Both are capture-phase, so
  // both see events that happened *inside* a reachable tooltip — a press on its
  // scrollbar and the scroll that press produces — and each would otherwise
  // close the thing being read at the first attempt to read it.
  document.addEventListener('pointerdown', e => { if (!inTip(e.target)) hide(); }, true);
  window.addEventListener('scroll', e => { if (!inTip(e.target)) hide(); }, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
})();
