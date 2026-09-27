// ══════════════════════════════════════════════════════════════════
//  THE TAPE TRACKER — drawing a tape, including its ends
// ══════════════════════════════════════════════════════════════════
//  js/tape.js models where the head may go; this draws it. Until this
//  module existed the tracker drew a flat row of boxes and nothing else,
//  which made the four tapes in the app indistinguishable on screen:
//
//    TM    bounded at cell 0, infinite to the right
//    ITM   infinite both ways
//    LBA   bounded at both ends, two cells that refuse to be written
//    2DFA  bounded at both ends, read-only, never written at all
//
//  Those differences are the whole content of half the machine picker,
//  and every one of them is a fact about an *end* — precisely the part a
//  row of cells cannot show, since an end that is a wall and an end that
//  is blank tape running on forever look identical cell for cell. So a
//  row here is cells *between two caps*, and the caps are the point: a
//  hatched wall where the tape stops, a fade into ⋯ where it does not.
//
//  Three more things follow from drawing the ends rather than the cells:
//
//  • **Cell numbers are absolute, not window offsets.** A two-way tape
//    renumbers its window the moment it grows leftward (see snapshot()),
//    so the drawn index and the cell the machine is on diverge — which
//    simTM already had to work around by putting `@-3` in its note. The
//    row carries `origin` and labels each cell with `origin + i`, so the
//    negative cells a two-way tape grows are visible as negative.
//
//  • **Cells are reused across steps, keyed by absolute index.** The old
//    tracker rebuilt its innerHTML on every step, which meant the CSS
//    transition on a cell never once fired — the highlighted node was
//    always a brand new element with no previous state to animate from.
//    Same rule as renderAll(): diff, keep the node, let it move.
//
//  • **The head is followed, not merely marked.** A tape long enough to
//    scroll used to run the head straight out of the visible band with
//    nothing bringing it back.
//
//  Imports nothing, reads no App: a row is drawn from the descriptor it
//  is handed, which is what lets js/tape.js hand one over and the two-way
//  heads — which have no Tape at all — build the same shape by hand.
// ══════════════════════════════════════════════════════════════════

/** How many ghost cells trail off an unbounded end before the ⋯. */
const GHOST_CELLS = 2;

/**
 * Cells of clearance to keep between the head and the nearer edge — capped
 * at a quarter of the strip, since these panels are resized down to widths
 * where three cells is the whole visible band and the tape would re-centre
 * on every single step.
 */
const FOLLOW_PAD = 3;

/**
 * What kind of tape this is, in a phrase and a sentence.
 *
 * The phrase rides beside the label where it is always visible; the
 * sentence is the tooltip, because "bounded left" is a reminder for
 * someone who knows and no help at all to someone who does not.
 */
export function tapeModelSay(view) {
  // A caller that knows better may say better — the input row of a finite
  // automaton is a bounded read-only tape by every test here, and calling it
  // one would be true and useless. It says the word's length instead.
  if (view.say) return view.say;
  const left = view.leftBound !== null && view.leftBound !== undefined;
  const right = view.rightBound !== null && view.rightBound !== undefined;
  const ro = view.readOnly ? 'read-only, ' : '';

  if (view.periodLen) {
    return {
      badge: 'ω-word',
      tip: `An infinite word: the prefix, then the repeating block over and over. ${ro}bounded at the left, and it never ends on the right.`
    };
  }
  if (!left && !right) {
    return {
      badge: 'infinite both ways',
      tip: `Two-way infinite tape: ${ro}blank cells forever in both directions, so there is no leftmost cell and cell numbers go negative.`
    };
  }
  if (left && !right) {
    return {
      badge: 'bounded left',
      tip: `One-way infinite tape: ${ro}cell ${view.leftBound} is the leftmost cell and the head cannot move past it, but the tape runs on forever to the right.`
    };
  }
  if (!left && right) {
    return {
      badge: 'bounded right',
      tip: `${ro}the tape stops after cell ${view.rightBound}, but runs on forever to the left.`
    };
  }
  const n = view.rightBound - view.leftBound + 1;
  return {
    // For a tape bounded at both ends, "read-only" is the more distinguishing
    // half: it is the whole of what separates a two-way finite automaton from
    // an LBA, which is otherwise the same picture. The cell count carries the
    // boundedness either way.
    badge: view.readOnly ? `read-only · ${n} cells` : `bounded · ${n} cells`,
    tip: `Bounded at both ends: ${ro}the tape is exactly these ${n} cells and the head cannot leave them. Moving past either end is a halt, not a stall.`
  };
}

// ── one row ───────────────────────────────────────────────────────

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/**
 * The cap on one end of a row.
 *
 * A wall is drawn; an open end is *not* drawn — it is faded out, which is
 * the only honest picture of a tape that has no last cell. The ghost cells
 * are deliberately the same size as real ones so the fade reads as more
 * tape rather than as decoration.
 */
function buildCap(side, view) {
  const cap = el('div', `tv-cap tv-cap-${side}`);
  const bounded = side === 'l'
    ? (view.leftBound !== null && view.leftBound !== undefined)
    : (view.rightBound !== null && view.rightBound !== undefined);

  if (bounded) {
    cap.classList.add('is-wall');
    cap.setAttribute('data-tip', side === 'l'
      ? `The tape ends here — cell ${view.leftBound} is the leftmost cell.`
      : `The tape ends here — cell ${view.rightBound} is the last cell.`);
    cap.appendChild(el('span', 'tv-wall'));
    return cap;
  }

  cap.classList.add('is-open');
  // The ω-word's right-hand continuation is the repeating block, not blank
  // tape, so it is shown as such rather than as empty cells that would say
  // the word had run out.
  const period = side === 'r' && view.periodLen
    ? view.cells.slice(view.cells.length - view.periodLen)
    : null;
  // The fade runs *away* from the cells, so the left cap is built mirrored:
  // ⋯ first, then the ghosts getting solider as they approach cell `origin`.
  const ghosts = [];
  for (let i = 0; i < GHOST_CELLS; i++) {
    const ghost = el('div', 'tv-cell is-ghost');
    ghost.style.opacity = String(0.44 - i * 0.18);
    ghost.appendChild(el('span', 'tv-sym', period ? (period[i % period.length] ?? view.blank) : view.blank));
    ghost.appendChild(el('span', 'tv-idx', ''));
    ghosts.push(ghost);
  }
  if (side === 'l') {
    cap.appendChild(el('span', 'tv-inf', '⋯'));
    ghosts.reverse().forEach(g => cap.appendChild(g));
  } else {
    ghosts.forEach(g => cap.appendChild(g));
    cap.appendChild(el('span', 'tv-inf', '⋯'));
  }
  cap.setAttribute('data-tip', period
    ? 'The repeating block, forever.'
    : side === 'l'
      ? 'Blank cells, forever — the tape has no leftmost cell.'
      : 'Blank cells, forever — the tape has no last cell.');
  return cap;
}

function cellTip(view, abs, sym, isHead) {
  const bits = [`Cell ${abs}`, `holds ${sym === ' ' ? 'a space' : `'${sym}'`}`];
  if (isHead) bits.push('— the head is here');
  if (view.markers && view.markers.includes(sym)) bits.push('· an end marker: it cannot be overwritten');
  else if (view.readOnly) bits.push('· read-only');
  return bits.join(' ');
}

// ── a long tape is drawn as a band ────────────────────────────────
// The tracker used to hold a node for every cell of the window, and the
// window is as wide as the machine has travelled: three thousand cells at
// 2.5M steps of the five-state busy beaver, twelve thousand by its halt, and
// on a machine that walks off down its tape as many as it has taken steps.
// Those were most of the page's nodes, and every frame of playback laid all
// of them out to change the two cells the head moved between.
//
// A strip shows a few dozen cells at a time, so past `2 × TRACK_BAND + 1`
// cells only a band of that many is drawn — around the head while the run
// plays, around what the reader has scrolled to otherwise — and the cells
// either side of it are padding the width they would have taken. The
// scrollbar is the whole tape's, the cell numbers are the real ones, and a
// scroll that nears the band's edge moves the band (see followScroll). A tape
// narrower than that is drawn whole, exactly as before.
const TRACK_BAND = 120;
// The distance from one cell to the next before one has been measured: a
// 26px cell and the track's 1px gap. followHead measures the real one.
const DEFAULT_PITCH = 27;

/**
 * The cells to draw, [lo, hi], of a window [first, last].
 *
 * `center` is a cell to centre on — a scroll asking for what it has reached.
 * Without one the band follows the head, and keeps the band drawn last while
 * the head is still well inside it, so a head pacing back and forth costs no
 * DOM at all.
 */
function bandOf(cellWrap, first, last, headAbs, center) {
  if (last - first < 2 * TRACK_BAND + 1) return [first, last];
  if (center == null) {
    const was = cellWrap.__tvRange;
    if (was && was[1] - was[0] === 2 * TRACK_BAND && was[0] >= first && was[1] <= last
      && headAbs >= was[0] + TRACK_BAND / 2 && headAbs <= was[1] - TRACK_BAND / 2) return was;
    center = headAbs;
  }
  const lo = Math.max(first, Math.min(Math.round(center) - TRACK_BAND, last - 2 * TRACK_BAND));
  return [lo, lo + 2 * TRACK_BAND];
}

/**
 * Builds or updates one row's cells, keyed by absolute cell number.
 *
 * **When the band moves, only the cells new to it are inserted.** The band
 * is a contiguous run of cell numbers and the nodes already in the row are
 * in that order, so a band that grew or slid by a cell needs one insertion
 * at that end — not every cell re-appended. It used to be every cell: on a
 * two-way tape the window moves on most frames of fast playback, so the
 * tracker re-appended the whole tape once a frame (27% of a frame at 2.5M
 * steps of the five-state busy beaver, and each move was two records for the
 * document-wide MutationObserver in dropdown.js). It also kept moving the
 * head's node, which resets the transition on it.
 */
function syncCells(cellWrap, view, finalClass, center = null) {
  let cache = cellWrap.__tvCells;
  if (!cache) cache = cellWrap.__tvCells = new Map();
  cellWrap.__tvLast = { view, finalClass };

  const first = view.origin;
  const last = view.origin + view.cells.length - 1;
  const [lo, hi] = bandOf(cellWrap, first, last, view.origin + view.head, center);
  const was = cellWrap.__tvRange;
  const moved = !was || was[0] !== lo || was[1] !== hi;
  // The part of the old band the new one keeps is already in the row, in
  // order — trusted only if its ends are still where they were left, since a
  // caller that emptied the row would otherwise have us insert beside nodes
  // that are no longer in it.
  const keepLo = was ? Math.max(lo, was[0]) : 0;
  const keepHi = was ? Math.min(hi, was[1]) : -1;
  const kept = moved && keepLo <= keepHi
    && cache.get(keepLo)?.parentNode === cellWrap && cache.get(keepHi)?.parentNode === cellWrap;
  const before = [], after = [];

  // The cells that left the band, in order, to be reused for the ones that
  // arrive. At Max a head sweeping a long tape lands the band somewhere new
  // on most frames, and a band that does not overlap the last one is then
  // the same nodes in the same order with new contents: nothing is created,
  // moved or removed. A band that slid moves only its ends.
  const spare = [];
  if (moved && was) {
    for (let abs = was[0]; abs <= was[1]; abs++) {
      if (abs >= lo && abs <= hi) { abs = hi; continue; }
      const node = cache.get(abs);
      if (!node) continue;
      cache.delete(abs);
      node.__tvKey = null;   // its index and tooltip are about another cell now
      spare.push(node);
    }
  }
  const inPlace = moved && !kept && spare.length === hi - lo + 1
    && spare.every(node => node.parentNode === cellWrap);
  let reused = 0;

  // Everything a cell's tooltip reads that is not the cell itself.
  const tipKey = `${(view.markers || []).join('\u0001')}|${view.readOnly ? 1 : 0}`;
  for (let i = lo - first; i <= hi - first; i++) {
    const abs = view.origin + i;
    const sym = view.cells[i];
    const isHead = i === view.head;

    let node = cache.get(abs);
    if (!node) {
      node = reused < spare.length ? spare[reused++] : null;
      if (!node) {
        node = el('div', 'tv-cell');
        node.appendChild(el('span', 'tv-sym'));
        node.appendChild(el('span', 'tv-idx'));
      }
      cache.set(abs, node);
    }
    const marker = !!(view.markers && view.markers.includes(sym));
    const cls = 'tv-cell'
      + (isHead ? ' is-head' : '')
      + (marker ? ' is-marker' : '')
      + (sym === view.blank ? ' is-blank' : '')
      + (view.periodLen && i >= view.periodFrom
        && (i - view.periodFrom) % view.periodLen === 0 ? ' is-period-start' : '')
      + (isHead && finalClass ? ` ${finalClass}` : '');
    // Written only when what this cell should show differs from what this
    // function last wrote *to this node*. That memo lives on the node, so it
    // cannot drift the way a "what did the last step look like" cache would on
    // a scrub: a scrub computes each cell's key afresh and compares it with the
    // node's own. Nothing else writes a tv-cell. Before this, every step
    // rewrote every cell's class, text and tooltip — for a 2,000-symbol word
    // that was 37% of a step, to change the two cells the head moved between.
    const key = `${cls}\u0000${sym}\u0000${tipKey}`;
    if (node.__tvKey !== key) {
      node.className = cls;
      node.firstChild.textContent = sym;
      node.lastChild.textContent = String(abs);
      node.setAttribute('data-tip', cellTip(view, abs, sym, isHead));
      node.__tvKey = key;
    }
    if (moved && !inPlace && !(kept && abs >= keepLo && abs <= keepHi)) (abs < keepLo ? before : after).push(node);
  }

  if (moved && !inPlace) {
    // What left the band and was not reused goes. Only the old band's two
    // ends were visited to find it, since the cache is keyed by cell.
    for (let k = reused; k < spare.length; k++) {
      if (spare[k].parentNode) spare[k].parentNode.removeChild(spare[k]);
    }
    if (kept) {
      const anchor = cache.get(keepLo);
      for (const node of before) cellWrap.insertBefore(node, anchor);
      for (const node of after) cellWrap.appendChild(node);
    } else {
      // Nothing to keep: a jump to a band that does not overlap, a first
      // draw, or a row someone emptied. Everything goes in, in order.
      while (cellWrap.firstChild) cellWrap.removeChild(cellWrap.firstChild);
      for (const node of before) cellWrap.appendChild(node);
      for (const node of after) cellWrap.appendChild(node);
    }
  }
  cellWrap.__tvRange = [lo, hi];

  // The cells not drawn, as the width they would take.
  const pitch = cellWrap.__tvPitch || DEFAULT_PITCH;
  const padL = lo > first ? `${(lo - first) * pitch}px` : '';
  const padR = hi < last ? `${(last - hi) * pitch}px` : '';
  if (cellWrap.__tvPad !== `${padL}|${padR}` && cellWrap.style) {
    cellWrap.style.paddingLeft = padL;
    cellWrap.style.paddingRight = padR;
    cellWrap.__tvPad = `${padL}|${padR}`;
  }
  return cache.get(view.origin + view.head) || null;
}

/**
 * The reader scrolled a long tape: once they near the band's edge, move the
 * band to where they are looking. Reads layout, which a scroll handler may —
 * the browser has just laid out to scroll.
 */
function followScroll(strip, cellWrap) {
  const drawn = cellWrap.__tvLast, band = cellWrap.__tvRange;
  if (!drawn || !band) return;
  const { view, finalClass } = drawn;
  const first = view.origin, last = view.origin + view.cells.length - 1;
  if (band[0] === first && band[1] === last) return;
  const pitch = cellWrap.__tvPitch || DEFAULT_PITCH;
  const x = strip.scrollLeft - (cellWrap.offsetLeft || 0);
  const c0 = first + Math.floor(x / pitch);
  const c1 = first + Math.ceil((x + strip.clientWidth) / pitch);
  const slack = TRACK_BAND / 2;
  if ((band[0] === first || c0 - slack >= band[0]) && (band[1] === last || c1 + slack <= band[1])) return;
  syncCells(cellWrap, view, finalClass, (c0 + c1) / 2);
}

/**
 * Slides the strip so the head stays visible.
 *
 * Only when it has actually left the band — scrolling on every step would
 * take a tape the reader had scrolled away from to read and yank it back
 * under them, which is the same decision `Session.pinned` makes for the
 * StateMate transcript.
 */
function followHead(strip, headCell, instant) {
  if (!headCell || typeof headCell.offsetLeft !== 'number') return;
  const view = strip.clientWidth;
  if (!view) return;
  const cell = headCell.offsetWidth || 26;
  const pad = Math.min(FOLLOW_PAD * cell, view / 4);
  const left = headCell.offsetLeft;
  const right = left + cell;
  // The band's padding stands in for cells at this pitch (see bandOf), so it
  // is measured here, where layout is being read anyway.
  const next = headCell.nextSibling || null, prev = next ? null : headCell.previousSibling;
  const pitch = next ? next.offsetLeft - left : prev ? left - prev.offsetLeft : 0;
  if (pitch > 0 && Number.isFinite(pitch) && headCell.parentNode) headCell.parentNode.__tvPitch = pitch;
  if (left - pad >= strip.scrollLeft && right + pad <= strip.scrollLeft + view) return;
  const target = Math.max(0, left - view / 2 + cell / 2);
  if (!instant && typeof strip.scrollTo === 'function') strip.scrollTo({ left: target, behavior: 'smooth' });
  else strip.scrollLeft = target;
}

// ── the tracker ───────────────────────────────────────────────────

/**
 * Draws every row of the step tracker into `host`.
 *
 * A row is either a tape — cells between two caps, with the caps carrying
 * the model — or a *track*: a stack, a queue, an output, a distribution.
 * Those are not tapes and are deliberately not drawn as ones; they get
 * the same cells and none of the ends, since a stack's ends are a top and
 * a bottom rather than a wall and an infinity.
 *
 * @param {HTMLElement} host
 * @param {Array<{label: string, view?: object, cells?: string[], head?: number,
 *                capL?: string, capR?: string, finalClass?: string}>} rows
 * @param {{defer?: (read: () => void) => void, instant?: boolean}} [opts]
 *   `defer` receives the head-following scroll, which reads layout. The player
 *   queues it behind the rest of a frame's writes so the frame lays out once;
 *   without it the read runs inline, which is right for a caller that draws
 *   only the tracker. `instant` makes that scroll a jump rather than a glide —
 *   under fast playback the head moves again before a smooth scroll lands, and
 *   each new one restarts from mid-air, so the head outruns the strip.
 */
export function renderTracker(host, rows, opts = {}) {
  const defer = opts.defer || (read => read());
  let cache = host.__tvRows;
  if (!cache) cache = host.__tvRows = new Map();
  const live = new Set();
  const order = [];

  rows.forEach((row, idx) => {
    const key = `${idx}:${row.label}`;
    live.add(key);
    let rowEl = cache.get(key);
    if (!rowEl) {
      rowEl = el('div', 'tv-row');
      const gutter = el('div', 'tv-gutter');
      gutter.appendChild(el('span', 'tv-label'));
      gutter.appendChild(el('span', 'tv-model'));
      rowEl.appendChild(gutter);
      const strip = el('div', 'tv-strip');
      const track = el('div', 'tv-track');
      track.appendChild(el('div', 'tv-cap tv-cap-l'));
      track.appendChild(el('div', 'tv-cells'));
      track.appendChild(el('div', 'tv-cap tv-cap-r'));
      strip.appendChild(track);
      rowEl.appendChild(strip);
      const cells = track.childNodes[1];
      strip.addEventListener('scroll', () => followScroll(strip, cells), { passive: true });
      cache.set(key, rowEl);
      host.appendChild(rowEl);
    }
    order.push(key);

    const gutter = rowEl.firstChild;
    const strip = rowEl.lastChild;
    const track = strip.firstChild;
    const cellWrap = track.childNodes[1];

    const isTape = !!row.view;
    // A descriptor either way, so one code path draws both — a track is
    // just a tape whose ends nobody claims anything about.
    const view = isTape ? row.view : {
      kind: 'track',
      cells: row.cells || [],
      head: row.head ?? -1,
      origin: 0,
      leftBound: undefined,
      rightBound: undefined,
      markers: [],
      blank: '',
      readOnly: true
    };

    rowEl.setAttribute('data-kind', isTape ? 'tape' : 'track');
    gutter.firstChild.textContent = row.label;

    const model = gutter.lastChild;
    if (isTape) {
      const say = tapeModelSay(view);
      model.textContent = say.badge;
      model.setAttribute('data-tip', say.tip);
      model.style.display = '';
    } else {
      model.textContent = '';
      model.removeAttribute('data-tip');
      model.style.display = 'none';
    }

    // The caps are rebuilt rather than diffed: they are a handful of nodes
    // and they change only when the tape's shape does, which for a tape is
    // never and for a track is not at all.
    const capKey = isTape
      ? `${view.leftBound}|${view.rightBound}|${view.periodLen || 0}|${view.blank}`
      : `${row.capL || ''}|${row.capR || ''}`;
    if (track.__tvCapKey !== capKey) {
      const l = isTape ? buildCap('l', view) : el('div', 'tv-cap tv-cap-l is-note', row.capL || '');
      const r = isTape ? buildCap('r', view) : el('div', 'tv-cap tv-cap-r is-note', row.capR || '');
      track.replaceChild(l, track.firstChild);
      track.replaceChild(r, track.lastChild);
      track.__tvCapKey = capKey;
    }

    const headCell = syncCells(cellWrap, view, row.finalClass);
    if (isTape) defer(() => followHead(strip, headCell, !!opts.instant));
  });

  for (const [key, node] of cache) {
    if (live.has(key)) continue;
    if (node.parentNode) node.parentNode.removeChild(node);
    cache.delete(key);
  }

  // Re-appending is how a node moves, and moving a node can reset the CSS
  // transitions inside it — so it happens only when the rows genuinely
  // reordered, which is when the machine changed rather than when it
  // stepped. Switching from a DFA to an MTM is the case that needs it.
  const wantOrder = order.join('\u0000');
  if (host.__tvOrder !== wantOrder) {
    order.forEach(key => host.appendChild(cache.get(key)));
    host.__tvOrder = wantOrder;
  }
}

/** Drops the cached nodes, so the next render builds from nothing. */
export function resetTracker(host) {
  if (!host) return;
  host.__tvRows = null;
  host.__tvOrder = null;
  // The header and body are the tracker's own two children, cached on it by
  // simulation.js; dropping the nodes without dropping the handles would
  // leave it writing into elements that are no longer in the page.
  host.__tvHeader = null;
  host.__tvBody = null;
  while (host.firstChild) host.removeChild(host.firstChild);
}
