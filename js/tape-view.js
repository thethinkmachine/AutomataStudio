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

/**
 * Builds or updates one row's cells, keyed by absolute cell number.
 *
 * The order pass runs only when the window actually moved, because a
 * two-way tape's window grows leftward and everything shifts — but on an
 * ordinary step nothing moves and re-appending every cell would undo the
 * one thing this reuse buys, which is that the head's highlight animates
 * from where it was.
 */
function syncCells(cellWrap, view, finalClass) {
  let cache = cellWrap.__tvCells;
  if (!cache) cache = cellWrap.__tvCells = new Map();

  const first = view.origin;
  const last = view.origin + view.cells.length - 1;
  const wantOrder = `${first}:${last}`;
  const reorder = cellWrap.__tvOrder !== wantOrder;

  const live = new Set();
  for (let i = 0; i < view.cells.length; i++) {
    const abs = view.origin + i;
    live.add(abs);
    const sym = view.cells[i];
    const isHead = i === view.head;

    let node = cache.get(abs);
    if (!node) {
      node = el('div', 'tv-cell');
      node.appendChild(el('span', 'tv-sym'));
      node.appendChild(el('span', 'tv-idx'));
      cache.set(abs, node);
    }
    // Written unconditionally, the way render.js writes its sync* classes:
    // a "what did we draw last time" cache here drifts the moment a step is
    // scrubbed to rather than stepped to.
    const marker = !!(view.markers && view.markers.includes(sym));
    node.className = 'tv-cell'
      + (isHead ? ' is-head' : '')
      + (marker ? ' is-marker' : '')
      + (sym === view.blank ? ' is-blank' : '')
      + (view.periodLen && i >= view.periodFrom
        && (i - view.periodFrom) % view.periodLen === 0 ? ' is-period-start' : '')
      + (isHead && finalClass ? ` ${finalClass}` : '');
    node.firstChild.textContent = sym;
    node.lastChild.textContent = String(abs);
    node.setAttribute('data-tip', cellTip(view, abs, sym, isHead));
    if (reorder) cellWrap.appendChild(node);
  }

  for (const [abs, node] of cache) {
    if (live.has(abs)) continue;
    if (node.parentNode) node.parentNode.removeChild(node);
    cache.delete(abs);
  }
  cellWrap.__tvOrder = wantOrder;
  return cache.get(view.origin + view.head) || null;
}

/**
 * Slides the strip so the head stays visible.
 *
 * Only when it has actually left the band — scrolling on every step would
 * take a tape the reader had scrolled away from to read and yank it back
 * under them, which is the same decision `Session.pinned` makes for the
 * StateMate transcript.
 */
function followHead(strip, headCell) {
  if (!headCell || typeof headCell.offsetLeft !== 'number') return;
  const view = strip.clientWidth;
  if (!view) return;
  const cell = headCell.offsetWidth || 26;
  const pad = Math.min(FOLLOW_PAD * cell, view / 4);
  const left = headCell.offsetLeft;
  const right = left + cell;
  if (left - pad >= strip.scrollLeft && right + pad <= strip.scrollLeft + view) return;
  const target = Math.max(0, left - view / 2 + cell / 2);
  if (typeof strip.scrollTo === 'function') strip.scrollTo({ left: target, behavior: 'smooth' });
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
 */
export function renderTracker(host, rows) {
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
    if (isTape) followHead(strip, headCell);
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
