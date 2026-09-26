// ══════════════════════════════════════════════════════════════════
//  SPACE-TIME DIAGRAMS — a whole run of a tape, one row per step
// ══════════════════════════════════════════════════════════════════
//  The tracker shows one configuration. This shows all of them at once:
//  time runs down, space runs across, and each row is the tape as it
//  stood at that step, with the head's path threaded through the rows.
//  It is the picture a textbook draws for a TM computation, and it is
//  the one view in the app that makes a *shape* of a run visible — a
//  zig-zag that widens every pass, a sweep that never comes back.
//
//  Three things decide how it is built.
//
//  • **The tape log is the source, and it is read in place.** A tape
//    machine's step does not store its tape (see js/tape-log.js): it holds
//    a head position and the one cell it wrote. Asking every step for
//    `step.tape` would rebuild a window array per row — the O(steps ×
//    window) the log exists to avoid — so this replays the journal
//    itself, one write per row, with checkpoints along the way so a
//    viewport halfway down a ten-thousand-step run is a short replay
//    rather than a long one. Steps that do store their tape (the two-way
//    heads, whose tape never changes) are read directly.
//
//    **A checkpoint is spaced by what it costs, not by a fixed count of
//    rows.** It is a copy of the whole tape, so on a tape that grows with
//    the run — the runaway machine walking off down fresh blanks, exactly
//    the one a teaching tool gets pointed at — a copy every 256 rows is
//    rows² / 256 cells: measured, 498 MB at 80,000 steps and 7 GB at
//    300,000. So the next checkpoint waits until the rows since the last
//    one are at least as many as the cells it would copy. The copies then
//    sum to no more than the rows, so the diagram is linear in the run
//    whatever its tape does; and a replay is never longer than the copy a
//    cursor already walks to load its base, so a read costs the same order
//    as before. A tape that stays narrow still gets one every 256 rows.
//
//  • **It never pulls.** The model indexes the steps that exist and
//    nothing more. On a streaming run the rest have not been computed,
//    and computing them because a diagram asked would be the frozen tab
//    lazy execution exists to prevent. Growing it is the player's job.
//
//  • **One painter for every output.** The screen, the PNG and the SVG
//    are drawn by the same `paintSpaceTime` against a 2D-context-shaped
//    surface: a canvas for the first two, and `svgContext()` — a context
//    that records SVG elements instead of pixels — for the third. Two
//    renderers would be two pictures that drift, and the export is only
//    worth having if it is the picture the reader was looking at.
//
//  Columns are **absolute cell numbers**, fixed for the whole diagram.
//  A two-way tape renumbers its tracker window every time it grows left;
//  a diagram that did the same would shear sideways at every such step.
//
//  DOM-free and App-free: the UI (js/spacetime-ui.js) hands in the steps,
//  the alphabet and a way to name a state.
// ══════════════════════════════════════════════════════════════════

import { stepJournals, stepLogIndex } from './tape-log.js';

/** The fewest rows between replay checkpoints; a wide tape spaces them further. */
const CHECKPOINT = 256;

/** Cell size at which a symbol is printed in its cell. */
export const GLYPH_MIN = 13;

/** Cell size at which the grid hairlines are drawn. */
const GRID_MIN = 7;

/** The cell sizes the zoom steps through. */
export const CELL_SIZES = Object.freeze([1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 26, 32]);

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

// ── the palette ───────────────────────────────────────────────────
//  Symbols are identities, so they take a categorical palette in a fixed
//  order — slot n is always the nth symbol of Γ, so a symbol keeps its
//  colour from one run to the next and from one machine to the next that
//  shares its alphabet. The steps are the validated reference set, one per
//  mode, each checked against the surfaces the diagram is drawn on.
//
//  A space-time grid puts every pair of symbols side by side, which is the
//  strictest case a palette can face: only the first three slots stay
//  distinguishable under every colour-vision deficiency on colour alone.
//  Past three the colour is not asked to carry identity by itself — the
//  symbol is printed in its cell whenever the cells are large enough to
//  hold it, the hover readout names it at any size, and the legend is always
//  on screen. A ninth symbol is folded into a neutral "other" rather than
//  given a generated hue.

export const SYMBOL_PALETTE = Object.freeze({
  light: Object.freeze(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']),
  dark: Object.freeze(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'])
});

/** A fixed light style for print and papers, whatever theme is on screen. */
export const PRINT_STYLE = Object.freeze({
  scheme: 'light',
  bg: '#ffffff',
  gutterBg: '#f7f7f5',
  rulerBg: '#f7f7f5',
  ink: '#16181d',
  ink2: '#4f5560',
  ink3: '#8a8f98',
  grid: 'rgba(22,24,29,0.10)',
  rule: 'rgba(22,24,29,0.18)',
  accent: '#1f6fd1',
  good: '#0b8a3e',
  bad: '#c93434',
  warn: '#b7791f',
  wallBg: '#ecebe7',
  wallInk: 'rgba(22,24,29,0.32)',
  palette: SYMBOL_PALETTE.light,
  other: '#9a9ea6',
  mono: MONO,
  sans: SANS
});

/** What a run's last row says, and the colour it says it in. */
export const FINAL_SAY = Object.freeze({
  accept: { text: 'ACCEPT', tone: 'good' },
  reject: { text: 'REJECT', tone: 'bad' },
  loop: { text: 'LOOPS', tone: 'warn' },
  timeout: { text: 'NO VERDICT', tone: 'ink3' }
});

// ══════════════════════════════════════════════════════════════════
//  THE MODEL
// ══════════════════════════════════════════════════════════════════

function logTrack(j) {
  let lo = j.leftBound !== null ? j.leftBound : 0;
  let hi = 0;
  for (const k of j.initial.keys()) {
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  if (j.leftBound !== null && lo < j.leftBound) lo = j.leftBound;
  if (j.rightBound !== null) hi = j.rightBound;
  return {
    kind: 'log',
    unit: 'cell',
    j,
    blank: j.blank,
    markers: j.markers || [],
    leftBound: j.leftBound,
    rightBound: j.rightBound,
    readOnly: false,
    lo,
    hi,
    // The tape as it stands at the last indexed row, and copies of it as
    // `{ row, cells }`, ascending by row. The copies are the whole memory cost
    // of the diagram, and `nextCheckpoint` is what keeps them linear in the
    // rows — see the header.
    live: new Map(j.initial),
    checkpoints: [],
    nextCheckpoint: 0
  };
}

function viewTrack(viewOf, first, unit = 'cell') {
  const v = viewOf(first) || {};
  return {
    kind: 'view',
    unit,
    viewOf,
    blank: v.blank,
    markers: v.markers || [],
    leftBound: v.leftBound ?? 0,
    rightBound: v.rightBound ?? null,
    readOnly: !!v.readOnly,
    lo: Infinity,
    hi: -Infinity
  };
}

/** How a step exposes tape `t`'s view, for steps that store one. */
function viewAccessor(step, t) {
  if (Array.isArray(step.views)) return s => (s.views ? s.views[t] : null);
  if (step.view) return s => s.view;
  if (Array.isArray(step.tape)) {
    return s => (Array.isArray(s.tape)
      ? { cells: s.tape, head: s.head ?? -1, origin: 0, leftBound: 0, rightBound: null, markers: [] }
      : null);
  }
  return null;
}

/**
 * A space-time model over a run's steps.
 *
 * `extend(count)` indexes steps up to `count` — the reachable prefix, which
 * on a block run is shorter than the array. Nothing is read past it, and
 * nothing is ever pulled from the run.
 *
 * @param steps the run's steps array (App.simSteps — the same object for the
 *        life of a run, growing as a streaming run plays)
 * @param opts  { alphabet: ordered symbols that fix the colour slots,
 *                tracks: [{ viewOf(step) -> view, unit }] — rows the caller
 *                describes itself, for a machine whose store is not a tape }
 */
export function makeSpaceTime(steps, opts = {}) {
  const model = {
    steps,
    rows: 0,
    tapes: null,
    supported: true,
    // Bumped whenever an extent grows, so a caller can tell a layout that is
    // still valid from one whose columns have moved.
    version: 0,
    symbols: [],
    extend,
    headAt,
    stateAt: i => steps[i]?.state,
    finalAt: i => steps[i]?.final,
    cursor,
    slotOf,
    lastWrite,
    writesIn
  };

  const slots = new Map();
  const markerSet = new Set();
  let blankSym = null;

  function noteSymbol(sym) {
    if (sym === undefined || sym === null || sym === blankSym || markerSet.has(sym)) return;
    if (!slots.has(sym)) slots.set(sym, slots.size);
    if (!model._seen.has(sym)) { model._seen.add(sym); rebuildSymbols(); }
  }
  model._seen = new Set();
  function rebuildSymbols() {
    model.symbols = [...model._seen].sort((a, b) => slots.get(a) - slots.get(b));
  }

  /** -1 blank, -2 a boundary marker, otherwise the symbol's colour slot. */
  function slotOf(sym) {
    if (sym === undefined || sym === null || sym === blankSym) return -1;
    if (markerSet.has(sym)) return -2;
    const s = slots.get(sym);
    return s === undefined ? 8 : Math.min(s, 8);
  }

  function detect() {
    const s0 = steps[0];
    if (!s0) return false;
    const journals = stepJournals(s0);
    // A logged step addresses its journal by its own index, and the diagram
    // addresses it by row. They are the same number for every run the tape
    // machines produce; if a caller ever handed over a slice they would not
    // be, and the stored views are the honest fallback.
    if (Array.isArray(opts.tracks) && opts.tracks.length) {
      // A stack, a queue, an output: rows the caller knows how to read off a
      // step. Drawn exactly as a tape is — a stack's bottom is a wall and its
      // top is the head, so the head's path *is* the stack's height over time.
      model.tapes = opts.tracks.map(spec => viewTrack(spec.viewOf, s0, spec.unit || 'cell'));
    } else if (journals && stepLogIndex(s0) === 0) {
      model.tapes = journals.map(j => logTrack(j));
    } else {
      const count = Array.isArray(s0.views) ? s0.views.length : 1;
      const tracks = [];
      for (let t = 0; t < count; t++) {
        const viewOf = viewAccessor(s0, t);
        if (!viewOf) { model.supported = false; return false; }
        tracks.push(viewTrack(viewOf, s0));
      }
      model.tapes = tracks;
    }
    const first = model.tapes[0];
    blankSym = first.blank;
    model.tapes.forEach(t => t.markers.forEach(m => markerSet.add(m)));
    // Slots follow Γ's order, not the order symbols happen to turn up in, so a
    // symbol is the same colour on every run. The blank and the end markers are
    // drawn as themselves rather than as symbols, and take no slot.
    (opts.alphabet || []).forEach(sym => {
      if (sym !== blankSym && !markerSet.has(sym) && !slots.has(sym)) slots.set(sym, slots.size);
    });
    model.tapes.forEach(t => {
      if (t.kind === 'log') for (const v of t.j.initial.values()) noteSymbol(v);
    });
    return true;
  }

  function grow(t, x) {
    if (x === undefined || x === null || x < -1e9) return;
    let lo = x, hi = x;
    if (t.leftBound !== null && lo < t.leftBound) lo = t.leftBound;
    if (t.rightBound !== null && hi > t.rightBound) hi = t.rightBound;
    if (lo < t.lo) { t.lo = lo; model.version++; }
    if (hi > t.hi) { t.hi = hi; model.version++; }
  }

  function indexLogRow(t, i) {
    const j = t.j;
    if (i > 0) {
      const c = j.wCell[i - 1];
      if (c !== undefined) {
        const s = j.wSym[i - 1];
        if (s === undefined) t.live.delete(c);
        else { t.live.set(c, s); noteSymbol(s); }
        grow(t, c);
      }
    }
    if (i >= t.nextCheckpoint) {
      t.checkpoints.push({ row: i, cells: new Map(t.live) });
      t.nextCheckpoint = i + Math.max(CHECKPOINT, t.live.size);
    }
    grow(t, j.heads[i]);
  }

  function indexViewRow(t, i) {
    const v = t.viewOf(steps[i]);
    if (!v || !v.cells) return;
    const origin = v.origin || 0;
    grow(t, origin);
    grow(t, origin + v.cells.length - 1);
    // A read-only tape shares one array across the whole run, so its symbols
    // need noting once rather than per row.
    if (!t.readOnly || i === 0) v.cells.forEach(noteSymbol);
  }

  /** Index steps up to `count`. Returns true if anything new was indexed. */
  function extend(count) {
    const n = Math.min(count ?? steps.length, steps.length);
    if (n <= model.rows) return false;
    if (!model.tapes && !detect()) return false;
    for (let i = model.rows; i < n; i++) {
      for (const t of model.tapes) {
        if (t.kind === 'log') indexLogRow(t, i);
        else indexViewRow(t, i);
      }
    }
    model.tapes.forEach(t => {
      // An empty two-way tape can have seen nothing but its head; a view track
      // whose first view was missing has no extent at all. Either way, cell 0.
      if (t.lo > t.hi) { t.lo = 0; t.hi = 0; }
    });
    model.rows = n;
    return true;
  }

  /** The absolute cell under tape t's head at row i, or null. */
  function headAt(t, i) {
    const tr = model.tapes && model.tapes[t];
    if (!tr || i < 0 || i >= model.rows) return null;
    if (tr.kind === 'log') {
      const h = tr.j.heads[i];
      return h === undefined ? null : h;
    }
    const v = tr.viewOf(steps[i]);
    if (!v || v.head === undefined || v.head < 0) return null;
    return (v.origin || 0) + v.head;
  }

  /**
   * Row r of tape t, restricted to columns c0..c1, and a way to step to the
   * next row. `cells[x - c0]` is the symbol in cell x.
   *
   * A painter walks rows top to bottom, so a cursor is the shape it wants:
   * one checkpoint copy and a short replay to reach the first row, then a
   * single write per row after that.
   */
  function cursor(t, r, c0, c1) {
    const tr = model.tapes[t];
    const width = Math.max(0, c1 - c0 + 1);
    const blank = tr.blank;
    if (tr.kind === 'view') {
      const cells = new Array(width);
      let row = r;
      const load = () => {
        cells.fill(blank);
        const v = row < model.rows ? tr.viewOf(steps[row]) : null;
        if (!v || !v.cells) return;
        const o = v.origin || 0;
        const a = Math.max(c0, o), b = Math.min(c1, o + v.cells.length - 1);
        for (let x = a; x <= b; x++) cells[x - c0] = v.cells[x - o];
      };
      load();
      return { cells, c0, next() { row++; load(); } };
    }

    const j = tr.j;
    const cells = new Array(width).fill(blank);
    // The last checkpoint at or before r. They are unevenly spaced, so it is
    // searched for rather than computed.
    const cps = tr.checkpoints;
    let lo = 0, hi = cps.length - 1, k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cps[mid].row <= r) { k = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const base = k >= 0 ? cps[k].cells : j.initial;
    for (const [x, s] of base) if (x >= c0 && x <= c1) cells[x - c0] = s;
    let row = k >= 0 ? cps[k].row : 0;
    const apply = w => {
      const c = j.wCell[w];
      if (c === undefined || c < c0 || c > c1) return;
      const s = j.wSym[w];
      cells[c - c0] = s === undefined ? blank : s;
    };
    while (row < r) { apply(row); row++; }
    return { cells, c0, next() { apply(row); row++; } };
  }

  /** What tape t's cell x held at row i, for a track that stores views. */
  function viewCell(tr, i, x) {
    const v = tr.viewOf(steps[i]);
    if (!v || !v.cells) return undefined;
    const k = x - (v.origin || 0);
    return k >= 0 && k < v.cells.length ? v.cells[k] : undefined;
  }

  /**
   * Who put what is in cell x at row r there.
   *
   * `{ row, by }`: `row` is the first row showing the write, `by` the row whose
   * step made it — the transition that wrote it is the one taken out of row
   * `by`. Null when nothing has written the cell since the run began: it is
   * input, or blank tape the head has not touched.
   *
   * A tape's journal records writes, so a write of the symbol already there
   * still counts — it *was* written. A stored-view row (a stack) records only
   * contents, so there a write is a change.
   */
  function lastWrite(t, r, x) {
    const tr = model.tapes && model.tapes[t];
    if (!tr || r <= 0) return null;
    const top = Math.min(r, model.rows - 1);
    if (tr.kind === 'log') {
      const wc = tr.j.wCell;
      for (let w = top - 1; w >= 0; w--) if (wc[w] === x) return { row: w + 1, by: w };
      return null;
    }
    if (tr.readOnly) return null;
    let cur = viewCell(tr, top, x);
    for (let i = top; i > 0; i--) {
      const prev = viewCell(tr, i - 1, x);
      if (prev !== cur) return { row: i, by: i - 1 };
      cur = prev;
    }
    return null;
  }

  /** The rows in r0..r1 on which cell x was written — what a trace marks. */
  function writesIn(t, x, r0, r1) {
    const tr = model.tapes && model.tapes[t];
    const out = [];
    if (!tr || tr.readOnly) return out;
    const a = Math.max(1, r0);
    const b = Math.min(r1, model.rows - 1);
    if (tr.kind === 'log') {
      const wc = tr.j.wCell;
      for (let i = a; i <= b; i++) if (wc[i - 1] === x) out.push(i);
      return out;
    }
    let prev = viewCell(tr, a - 1, x);
    for (let i = a; i <= b; i++) {
      const cur = viewCell(tr, i, x);
      if (cur !== prev) out.push(i);
      prev = cur;
    }
    return out;
  }

  return model;
}

/**
 * The branch of a nondeterministic run that accepted, as a run of its own.
 *
 * A breadth-first search yields configurations in the order it dequeues them,
 * so consecutive steps are unrelated branches and a diagram of the steps as
 * they come would interleave them. But every configuration names the branch it
 * was expanded from (`parent`), so walking back from the accepting step to the
 * root is exactly the computation that accepted — one timeline, drawable like
 * any deterministic run. Null when the last step is not an accept.
 *
 * `stepOfRow[r]` is the search step row r came from, and `rowOfStep` the way
 * back, so the player and the diagram can follow each other.
 */
export function acceptingBranch(steps) {
  const last = steps && steps[steps.length - 1];
  if (!last || last.final !== 'accept' || last.branch === undefined) return null;
  const byBranch = new Map();
  steps.forEach((s, i) => { if (s.branch !== undefined && !byBranch.has(s.branch)) byBranch.set(s.branch, i); });
  const idx = [];
  const seen = new Set();
  let cur = steps.length - 1;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    idx.push(cur);
    const p = steps[cur].parent;
    if (p === null || p === undefined) break;
    cur = byBranch.get(p);
  }
  idx.reverse();
  const root = steps[idx[0]];
  if (!root || (root.parent !== null && root.parent !== undefined)) return null;
  return {
    steps: idx.map(i => steps[i]),
    stepOfRow: idx,
    rowOfStep: new Map(idx.map((s, r) => [s, r])),
    explored: steps.length
  };
}

// ══════════════════════════════════════════════════════════════════
//  LAYOUT
// ══════════════════════════════════════════════════════════════════

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const charW = px => px * 0.6;
const font = (px, weight, fam) => `${weight || 400} ${px}px ${fam}`;

/** 1, 2, 5, 10, 20, 50 … — the first of those at least `n`. */
export function niceStep(n) {
  if (n <= 1) return 1;
  let p = 1;
  for (;;) {
    for (const m of [1, 2, 5]) if (m * p >= n) return m * p;
    p *= 10;
  }
}

function fit(text, maxChars) {
  const s = String(text);
  if (maxChars <= 0) return '';
  if (s.length <= maxChars) return s;
  return maxChars <= 1 ? s.slice(0, 1) : s.slice(0, maxChars - 1) + '…';
}

/**
 * Where everything goes, in diagram coordinates.
 *
 * @param o { cell, rowFrom, rowTo, gutter, caption, legend, stateName, tapeLabels }
 */
export function spaceTimeLayout(model, o = {}) {
  const cell = Math.max(1, Math.round(o.cell || 8));
  const glyphs = cell >= GLYPH_MIN;
  const last = Math.max(0, model.rows - 1);
  const rowFrom = clamp(o.rowFrom ?? 0, 0, last);
  const rowTo = clamp(o.rowTo ?? last, rowFrom, last);
  const rowCount = model.rows ? rowTo - rowFrom + 1 : 0;
  const tapes = model.tapes || [];

  const labelPx = glyphs ? clamp(Math.round(cell * 0.55), 9, 11) : 10;
  const digits = Math.max(4, String(rowTo).length);
  const withGutter = o.gutter !== false;
  const showStates = withGutter && glyphs && typeof o.stateName === 'function';

  let stateChars = 0;
  if (showStates) {
    // Names are measured over the rows drawn, capped so one long name does
    // not take the gutter from the diagram.
    for (let i = rowFrom; i <= rowTo; i++) {
      const n = String(o.stateName(model.stateAt(i)) ?? '').length;
      if (n > stateChars) { stateChars = n; if (n >= 14) break; }
    }
    stateChars = Math.min(14, Math.max(5, stateChars));
  }
  const numW = withGutter ? Math.ceil(charW(labelPx) * digits) + 16 : 0;
  const gutterW = numW + (showStates ? Math.ceil(charW(labelPx) * stateChars) + 12 : 0);

  const captionH = o.caption ? 50 : 0;
  const rulerH = 36;
  const top = captionH + rulerH;
  const capW = clamp(cell, 6, 12);
  const GAP = 22;

  let x = gutterW + 10;
  const placed = tapes.map((t, i) => {
    const cols = t.hi - t.lo + 1;
    const e = {
      index: i,
      lo: t.lo,
      hi: t.hi,
      cols,
      capW,
      x: x + capW,
      label: (o.tapeLabels && o.tapeLabels[i]) || (tapes.length > 1 ? `T${i + 1}` : 'Tape')
    };
    x = e.x + cols * cell + capW + GAP;
    return e;
  });
  const width = Math.max(gutterW + 120, x - GAP + 12);

  // Below the last row: the run's ending, and in an export the legend.
  const statusH = rowCount ? 30 : 0;
  const legendH = o.legend && model.symbols.length ? 26 : 0;
  const height = top + rowCount * cell + statusH + legendH + 6;

  return {
    cell, glyphs, grid: cell >= GRID_MIN, labelPx,
    rowFrom, rowTo, rowCount,
    gutterW, numW, showStates, stateChars,
    captionH, rulerH, top, capW,
    tapes: placed, width, height,
    statusH, legendH,
    caption: o.caption || null,
    stateName: o.stateName || (id => String(id ?? '')),
    complete: o.complete !== false
  };
}

/** Diagram coordinates → { row, tape, col }, for hover and click. */
export function hitSpaceTime(L, x, y) {
  if (y < L.top) return null;
  const row = L.rowFrom + Math.floor((y - L.top) / L.cell);
  if (row < L.rowFrom || row > L.rowTo) return null;
  for (const e of L.tapes) {
    if (x >= e.x && x < e.x + e.cols * L.cell) {
      return { row, tape: e.index, col: e.lo + Math.floor((x - e.x) / L.cell) };
    }
  }
  return { row, tape: -1, col: null };
}

// ══════════════════════════════════════════════════════════════════
//  THE PAINTER
// ══════════════════════════════════════════════════════════════════

function hatch(ctx, x0, y0, w, y1, spacing) {
  // 45° strokes across a narrow strip, clipped to it by hand — a clip region
  // is the one thing the SVG surface does not record, and there is no need
  // for one when the strip is a rectangle.
  ctx.beginPath();
  for (let y = y0 - w; y < y1; y += spacing) {
    const sLo = Math.max(0, y + w - y1);
    const sHi = Math.min(w, y + w - y0);
    if (sHi <= sLo) continue;
    ctx.moveTo(x0 + sLo, y + w - sLo);
    ctx.lineTo(x0 + sHi, y + w - sHi);
  }
  ctx.stroke();
}

/**
 * Draw a diagram, or the part of it a viewport shows.
 *
 * @param ctx a CanvasRenderingContext2D, or an `svgContext()`
 * @param V   { sx, sy, vw, vh } the viewport in diagram coordinates — the
 *            gutter and ruler stay pinned while the cells scroll under them;
 *            { playhead, hover, headPath, clip }.
 */
export function paintSpaceTime(ctx, model, L, S, V = {}) {
  const sx = V.sx || 0;
  const sy = V.sy || 0;
  const vw = V.vw ?? L.width;
  const vh = V.vh ?? L.height;
  const { cell, top, gutterW } = L;
  const headPath = V.headPath !== false;
  const pal = S.palette;

  if (S.bg) { ctx.fillStyle = S.bg; ctx.fillRect(0, 0, vw, vh); }

  const lastRow = L.rowFrom + L.rowCount - 1;
  const rA = L.rowCount ? L.rowFrom + Math.max(0, Math.floor(sy / cell)) : 0;
  const rB = L.rowCount ? Math.min(lastRow, L.rowFrom + Math.floor((sy + vh - top) / cell)) : -1;
  const yOf = r => top + (r - L.rowFrom) * cell - sy;
  const xLeft = gutterW + sx;
  const xRight = sx + vw;
  const bodyBottom = Math.min(vh, yOf(lastRow) + cell);

  const clipped = V.clip && typeof ctx.clip === 'function';
  if (clipped) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(gutterW, top, Math.max(0, vw - gutterW), Math.max(0, vh - top));
    ctx.clip();
  }

  const fillOf = slot => (slot < 0 ? null : slot < 8 ? pal[slot] : S.other);
  const glyphPx = clamp(Math.round(cell * 0.56), 8, 15);
  const glyphChars = Math.max(1, Math.floor((cell - 3) / charW(glyphPx)));

  for (const e of L.tapes) {
    const tr = model.tapes[e.index];
    const edgeL = e.x - sx;
    const edgeR = e.x + e.cols * cell - sx;
    const colX = c => e.x + (c - e.lo) * cell - sx;

    // The ends. A wall is where the head cannot go; a dashed edge is where
    // the tape goes on and the diagram simply stops drawing it — dashed
    // meaning "not part of the machine", as it does everywhere in the app.
    if (rA <= rB) {
      const y0 = yOf(rA);
      const y1 = bodyBottom;
      const wall = (x) => {
        ctx.fillStyle = S.wallBg;
        ctx.fillRect(x, y0, e.capW, y1 - y0);
        ctx.strokeStyle = S.wallInk;
        ctx.lineWidth = 1;
        hatch(ctx, x, y0, e.capW, y1, 5);
      };
      const open = (x) => {
        ctx.strokeStyle = S.ink3;
        ctx.lineWidth = 1;
        if (ctx.setLineDash) ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
      };
      const boundL = tr.leftBound !== null && tr.leftBound !== undefined && e.lo <= tr.leftBound;
      const boundR = tr.rightBound !== null && tr.rightBound !== undefined && e.hi >= tr.rightBound;
      if (boundL) wall(edgeL - e.capW); else open(edgeL - 0.5);
      if (boundR) wall(edgeR); else open(edgeR + 0.5);
    }

    const c0 = Math.max(e.lo, e.lo + Math.floor((xLeft - e.x) / cell));
    const c1 = Math.min(e.hi, e.lo + Math.floor((xRight - e.x) / cell));
    if (c0 > c1 || rA > rB) continue;

    // The head's path, through the centre of the head cell on every row, with
    // a halo of the ground under it so it stays legible over any fill. Once
    // symbols are printed it goes *under* the cells instead, as a faint thread
    // the glyphs sit on — drawn over them it read as a strikethrough.
    const drawPath = () => {
      const pts = [];
      const pr0 = Math.max(L.rowFrom, rA - 1);
      const pr1 = Math.min(lastRow, rB + 1);
      for (let r = pr0; r <= pr1; r++) {
        const h = model.headAt(e.index, r);
        pts.push(h === null ? null : [colX(h) + cell / 2, yOf(r) + cell / 2]);
      }
      const trace = () => {
        ctx.beginPath();
        let pen = false;
        for (const p of pts) {
          if (!p) { pen = false; continue; }
          if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
          pen = true;
        }
        ctx.stroke();
      };
      ctx.lineJoin = 'round';
      if (L.glyphs) {
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = S.ink;
        ctx.lineWidth = 2;
        trace();
      } else {
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = S.halo || S.bg || S.gutterBg || '#ffffff';
        ctx.lineWidth = cell < 4 ? 3 : 4;
        trace();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = S.ink;
        ctx.lineWidth = cell < 3 ? 1 : 1.5;
        trace();
      }
      ctx.globalAlpha = 1;
    };
    if (headPath && L.glyphs) drawPath();

    // Cells. Below the glyph size a run of equal cells is one rectangle, which
    // is what keeps a thousand-column row cheap on a canvas and small in an
    // SVG; above it each cell is a tint with its symbol printed on it, since
    // colour alone cannot tell more than three symbols apart for everyone.
    const cur = model.cursor(e.index, rA, c0, c1);
    const glyphRows = [];
    // Full strength only where a cell is a pixel or two and needs all the
    // colour it can carry. Larger, a long run of one symbol at full saturation
    // becomes a slab that drowns the head's path, which is the thing being read.
    const fillAlpha = cell < 4 ? 0.9 : 0.6;
    for (let r = rA; r <= rB; r++) {
      const y = yOf(r);
      const cells = cur.cells;
      if (L.glyphs) {
        for (let i = 0; i < cells.length; i++) {
          const slot = model.slotOf(cells[i]);
          if (slot === -1) continue;
          ctx.fillStyle = slot === -2 ? S.ink : fillOf(slot);
          ctx.globalAlpha = slot === -2 ? 0.12 : 0.3;
          ctx.fillRect(colX(c0 + i), y, cell, cell);
        }
        ctx.globalAlpha = 1;
        glyphRows.push({ y, cells: cells.slice() });
      } else {
        let runStart = 0;
        let runFill = null;
        let runAlpha = 1;
        const flush = (end) => {
          if (runFill) {
            ctx.globalAlpha = runAlpha;
            ctx.fillStyle = runFill;
            ctx.fillRect(colX(c0 + runStart), y, (end - runStart) * cell, cell);
          }
        };
        for (let i = 0; i <= cells.length; i++) {
          let f = null;
          let a = 1;
          if (i < cells.length) {
            const slot = model.slotOf(cells[i]);
            if (slot === -2) { f = S.ink; a = 0.3; } else { f = fillOf(slot); a = fillAlpha; }
          }
          if (f !== runFill || a !== runAlpha || i === cells.length) {
            flush(i);
            runStart = i;
            runFill = f;
            runAlpha = a;
          }
        }
        ctx.globalAlpha = 1;
      }
      if (r < rB) cur.next();
    }

    if (L.grid) {
      ctx.strokeStyle = S.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const gy0 = yOf(rA);
      for (let c = c0; c <= c1 + 1; c++) {
        const x = Math.round(colX(c)) + 0.5;
        ctx.moveTo(x, gy0);
        ctx.lineTo(x, bodyBottom);
      }
      const gx0 = colX(c0);
      const gx1 = colX(c1 + 1);
      for (let r = rA; r <= rB + 1 && r <= lastRow + 1; r++) {
        const y = Math.round(yOf(r)) + 0.5;
        ctx.moveTo(gx0, y);
        ctx.lineTo(gx1, y);
      }
      ctx.stroke();
    }

    if (headPath && !L.glyphs) drawPath();

    if (L.glyphs) {
      ctx.font = font(glyphPx, 500, S.mono);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Each glyph is cut out of the path under it by a ring of the ground.
      const halo = headPath && (S.halo || S.bg);
      if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.lineJoin = 'round'; }
      for (const g of glyphRows) {
        for (let i = 0; i < g.cells.length; i++) {
          const slot = model.slotOf(g.cells[i]);
          if (slot === -1) continue;
          const text = fit(g.cells[i], glyphChars);
          const x = colX(c0 + i) + cell / 2;
          const y = g.y + cell / 2 + 0.5;
          if (halo) ctx.strokeText(text, x, y);
          ctx.fillStyle = slot === -2 ? S.ink2 : S.ink;
          ctx.fillText(text, x, y);
        }
      }
    }

    // The head itself. A ring once symbols are printed, since the ring has to
    // leave the symbol legible; below that the path carries the head — a ring
    // on every row as well read as a chain of boxes — and with the path off
    // the cell is inked instead.
    for (let r = rA; r <= rB; r++) {
      const h = model.headAt(e.index, r);
      if (h === null || h < c0 || h > c1) continue;
      const x = colX(h);
      const y = yOf(r);
      if (L.glyphs) {
        ctx.strokeStyle = S.ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
      } else if (!headPath) {
        ctx.fillStyle = S.ink;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y, cell, cell);
        ctx.globalAlpha = 1;
      }
    }
  }

  // A traced cell: every row that wrote it, and the stretch from the write that
  // put its current symbol there down to the row being asked about.
  const trace = V.trace;
  const te = trace && L.tapes[trace.tape];
  if (te && rA <= rB) {
    const x = te.x + (trace.col - te.lo) * cell - sx;
    if (x + cell > gutterW && x < vw) {
      const from = trace.from === null || trace.from === undefined ? L.rowFrom : Math.max(L.rowFrom, trace.from);
      const y0 = Math.max(yOf(from), top - cell);
      const y1 = Math.min(yOf(trace.row) + cell, vh + cell);
      if (y1 > y0) {
        ctx.fillStyle = S.accent;
        ctx.globalAlpha = 0.14;
        ctx.fillRect(x, y0, cell, y1 - y0);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = S.accent;
      const tick = Math.max(2, Math.min(4, cell / 4));
      for (const r of model.writesIn(trace.tape, trace.col, rA, rB)) {
        ctx.fillRect(x - tick - 1, yOf(r), tick, cell);
      }
      ctx.strokeStyle = S.accent;
      ctx.lineWidth = 2;
      if (trace.from !== null && trace.from !== undefined && trace.from >= rA && trace.from <= rB) {
        ctx.strokeRect(x + 1, yOf(trace.from) + 1, cell - 2, cell - 2);
      }
      if (trace.row >= rA && trace.row <= rB) {
        if (ctx.setLineDash) ctx.setLineDash([3, 2]);
        ctx.strokeRect(x + 1, yOf(trace.row) + 1, cell - 2, cell - 2);
        if (ctx.setLineDash) ctx.setLineDash([]);
      }
    }
  }

  // The step on screen, and the cell under the pointer.
  const content0 = gutterW;
  const contentW = Math.max(0, Math.min(vw, L.width - sx) - gutterW);
  if (V.playhead !== undefined && V.playhead !== null && V.playhead >= rA && V.playhead <= rB) {
    const y = yOf(V.playhead);
    ctx.fillStyle = S.accent;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(content0, y, contentW, cell);
    ctx.globalAlpha = 0.9;
    const lw = cell >= 6 ? 1.5 : 1;
    ctx.fillRect(content0, y - lw, contentW, lw);
    if (cell >= 6) ctx.fillRect(content0, y + cell, contentW, lw);
    ctx.globalAlpha = 1;
    // The head on that step, in the accent, at every size — the one cell the
    // tracker is showing, findable at 1px as well as at 30.
    for (const e of L.tapes) {
      const h = model.headAt(e.index, V.playhead);
      if (h === null) continue;
      const x = e.x + (h - e.lo) * cell - sx;
      if (x + cell < gutterW || x > vw) continue;
      ctx.strokeStyle = S.accent;
      const lw = cell >= 6 ? 2 : 1.5;
      ctx.lineWidth = lw;
      const pad = cell >= 6 ? lw / 2 : -lw;
      ctx.strokeRect(x + pad, y + pad, cell - 2 * pad, cell - 2 * pad);
    }
  }
  if (V.hover && V.hover.row >= rA && V.hover.row <= rB) {
    const y = yOf(V.hover.row);
    ctx.fillStyle = S.ink;
    ctx.globalAlpha = 0.06;
    ctx.fillRect(content0, y, contentW, cell);
    ctx.globalAlpha = 1;
    const e = L.tapes[V.hover.tape];
    if (e && V.hover.col !== null) {
      ctx.strokeStyle = S.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(e.x + (V.hover.col - e.lo) * cell - sx - 0.75, y - 0.75, cell + 1.5, cell + 1.5);
    }
  }

  if (clipped) ctx.restore();

  // How the run ended, under its last row. Pinned horizontally, so it can be
  // read wherever the diagram has been scrolled to.
  if (L.rowCount) {
    const y = top + L.rowCount * cell - sy + 17;
    if (y > top - 4 && y < vh + 12) {
      const fin = FINAL_SAY[model.finalAt(lastRow)];
      const x = gutterW + 10;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (L.complete && fin) {
        ctx.font = font(11, 700, S.mono);
        ctx.fillStyle = S[fin.tone] || S.ink2;
        ctx.fillText(fin.text, x, y);
        ctx.font = font(11, 400, S.mono);
        ctx.fillStyle = S.ink2;
        const steps = lastRow;
        ctx.fillText(`after ${steps.toLocaleString()} step${steps === 1 ? '' : 's'}, in ${L.stateName(model.stateAt(lastRow))}`,
          x + charW(11) * (fin.text.length + 1), y);
      } else if (!L.complete) {
        ctx.strokeStyle = S.ink3;
        ctx.lineWidth = 1;
        if (ctx.setLineDash) ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x + Math.min(contentW - 20, 260), y - 9);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
        ctx.font = font(11, 400, S.mono);
        ctx.fillStyle = S.ink3;
        ctx.fillText(`${L.rowCount.toLocaleString()} steps so far — the run goes on`, x, y + 2);
      }
    }
  }

  // ── the gutter: step numbers, and state names once there is room ──
  if (gutterW) {
    if (S.gutterBg) {
      ctx.fillStyle = S.gutterBg;
      ctx.fillRect(0, top, gutterW, Math.max(0, vh - top));
    }
    ctx.fillStyle = S.rule;
    ctx.fillRect(gutterW - 1, top, 1, Math.max(0, Math.min(vh, bodyBottom + 6) - top));
    if (rA <= rB) {
      const px = L.labelPx;
      ctx.textBaseline = 'middle';
      const every = L.glyphs ? 1 : niceStep(Math.ceil(15 / cell));
      const finalAt = L.complete ? model.finalAt(lastRow) : null;
      for (let r = rA - (rA % every); r <= rB; r += every) {
        if (r < rA) continue;
        const y = yOf(r) + cell / 2;
        // A label half under the ruler is a clipped label; the next tick says
        // where the reader is just as well.
        if (y - px / 2 < top) continue;
        const isPlay = r === V.playhead;
        const isFinal = r === lastRow && FINAL_SAY[finalAt];
        ctx.font = font(px, isPlay || isFinal ? 700 : 400, S.mono);
        ctx.fillStyle = isPlay ? S.accent : isFinal ? S[FINAL_SAY[finalAt].tone] : S.ink3;
        ctx.textAlign = 'right';
        ctx.fillText(String(r), L.numW - 8, y);
        if (!L.glyphs) {
          ctx.fillStyle = S.rule;
          ctx.fillRect(gutterW - 5, Math.round(yOf(r)), 4, 1);
        }
        if (L.showStates) {
          ctx.textAlign = 'left';
          ctx.font = font(px, isPlay ? 600 : 400, S.mono);
          ctx.fillStyle = isPlay ? S.accent : S.ink2;
          ctx.fillText(fit(L.stateName(model.stateAt(r)), L.stateChars), L.numW, y);
        }
      }
      // The playhead is always labelled, whatever the tick interval skipped.
      const p = V.playhead;
      if (!L.glyphs && p !== undefined && p !== null && p >= rA && p <= rB && p % every !== 0) {
        const y = yOf(p) + cell / 2;
        const label = String(p);
        const w = charW(px) * label.length + 8;
        ctx.fillStyle = S.gutterBg || S.bg;
        if (ctx.fillStyle) ctx.fillRect(L.numW - 4 - w, y - 7, w, 14);
        ctx.font = font(px, 700, S.mono);
        ctx.fillStyle = S.accent;
        ctx.textAlign = 'right';
        ctx.fillText(label, L.numW - 8, y);
      }
    }
    if (V.playhead !== undefined && V.playhead !== null && V.playhead >= rA && V.playhead <= rB) {
      // A tab on the gutter's edge, pointing into the row.
      const y = yOf(V.playhead) + cell / 2;
      ctx.fillStyle = S.accent;
      ctx.beginPath();
      ctx.moveTo(gutterW - 5, y - 4);
      ctx.lineTo(gutterW, y);
      ctx.lineTo(gutterW - 5, y + 4);
      if (typeof ctx.fill === 'function') ctx.fill();
    }
  }

  // ── the ruler: which tape, and which cell ──
  const rTop = L.captionH;
  if (S.rulerBg) {
    ctx.fillStyle = S.rulerBg;
    ctx.fillRect(0, rTop, vw, L.rulerH);
  }
  ctx.fillStyle = S.rule;
  ctx.fillRect(0, top - 1, vw, 1);
  const numPx = 9;
  for (const e of L.tapes) {
    const edge = e.x - e.capW - sx;
    const colX = c => e.x + (c - e.lo) * cell - sx;
    ctx.font = font(10, 600, S.sans);
    ctx.fillStyle = S.ink2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lblX = Math.max(edge, gutterW + 6);
    // The label has the tape's own width and the gap after it, and no more —
    // on a narrow multi-tape diagram "T1 · bounded left" would run into T2's.
    // Too long, it drops the description and keeps the name.
    const room = e.x + e.cols * cell + e.capW + 16 - sx - lblX;
    const short = String(e.label).split(' · ')[0];
    const label = charW(10) * String(e.label).length <= room ? e.label : short;
    if (lblX < e.x + e.cols * cell - sx && charW(10) * label.length <= room + 8) ctx.fillText(label, lblX, rTop + 10);

    const c0 = Math.max(e.lo, e.lo + Math.floor((xLeft - e.x) / cell));
    const c1 = Math.min(e.hi, e.lo + Math.floor((xRight - e.x) / cell));
    if (c0 > c1) continue;
    const widest = Math.max(String(e.lo).length, String(e.hi).length);
    const every = niceStep(Math.ceil((charW(numPx) * widest + 10) / cell));
    ctx.font = font(numPx, 400, S.mono);
    ctx.textAlign = 'center';
    for (let c = Math.ceil(c0 / every) * every; c <= c1; c += every) {
      const x = colX(c) + cell / 2;
      if (x < gutterW + 4) continue;
      ctx.fillStyle = c === 0 ? S.ink : S.ink3;
      ctx.fillText(String(c), x, top - 12);
      ctx.fillStyle = S.rule;
      ctx.fillRect(Math.round(x), top - 5, 1, 4);
    }
    // Where the head is on the step on screen.
    const p = V.playhead;
    if (p !== undefined && p !== null) {
      const h = model.headAt(e.index, p);
      if (h !== null && h >= c0 && h <= c1) {
        const x = colX(h) + cell / 2;
        ctx.fillStyle = S.accent;
        ctx.beginPath();
        ctx.moveTo(x - 4, top - 6);
        ctx.lineTo(x + 4, top - 6);
        ctx.lineTo(x, top - 1);
        if (typeof ctx.fill === 'function') ctx.fill();
      }
    }
  }
  if (gutterW) {
    if (S.rulerBg) {
      ctx.fillStyle = S.rulerBg;
      ctx.fillRect(0, rTop, gutterW, L.rulerH - 1);
    }
    ctx.fillStyle = S.rule;
    ctx.fillRect(gutterW - 1, rTop, 1, L.rulerH);
    ctx.font = font(9, 600, S.sans);
    ctx.fillStyle = S.ink3;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('step', L.numW - 8, top - 12);
    if (L.showStates) {
      ctx.textAlign = 'left';
      ctx.fillText('state', L.numW, top - 12);
    }
  }

  // ── an export's caption and legend ──
  if (L.captionH && L.caption) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font(13, 700, S.sans);
    ctx.fillStyle = S.ink;
    ctx.fillText(L.caption.title || '', 12, 18);
    if (L.caption.sub) {
      ctx.font = font(11, 400, S.sans);
      ctx.fillStyle = S.ink2;
      ctx.fillText(L.caption.sub, 12, 36);
    }
  }
  if (L.legendH) {
    let x = gutterW + 10;
    const y = top + L.rowCount * cell - sy + L.statusH + 12;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(10, 400, S.mono);
    for (const sym of model.symbols) {
      const slot = model.slotOf(sym);
      ctx.fillStyle = fillOf(slot) || S.ink3;
      ctx.fillRect(x, y - 5, 10, 10);
      ctx.fillStyle = S.ink2;
      ctx.fillText(sym, x + 14, y);
      x += 14 + charW(10) * String(sym).length + 14;
    }
    if (headPath) {
      ctx.strokeStyle = S.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x + 6, y - 4);
      ctx.lineTo(x + 12, y + 4);
      ctx.stroke();
      ctx.fillStyle = S.ink2;
      ctx.fillText('head', x + 17, y);
    }
  }
}

// ══════════════════════════════════════════════════════════════════
//  AN SVG SURFACE
// ══════════════════════════════════════════════════════════════════
//  The subset of CanvasRenderingContext2D the painter uses, recording
//  elements instead of pixels. Every attribute is written inline — no
//  stylesheet, no classes, no external font — so the file renders the
//  same in a browser, in Inkscape and inside a LaTeX figure.

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = v => Math.round(v * 100) / 100;

export function svgContext(width, height) {
  const parts = [];
  const stack = [];
  let path = [];
  const ctx = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    font: font(10, 400, MONO),
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    _dash: [],
    save() { stack.push({ ...ctx, _dash: [...ctx._dash] }); },
    restore() { const s = stack.pop(); if (s) Object.assign(ctx, s); },
    setLineDash(d) { ctx._dash = [...d]; },
    rect() {},
    clip() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push(`M${n2(x)} ${n2(y)}`); },
    lineTo(x, y) { path.push(`L${n2(x)} ${n2(y)}`); },
    op() { return ctx.globalAlpha < 1 ? ` opacity="${n2(ctx.globalAlpha)}"` : ''; },
    fillRect(x, y, w, h) {
      if (w <= 0 || h <= 0) return;
      parts.push(`<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="${esc(ctx.fillStyle)}"${ctx.op()}/>`);
    },
    strokeRect(x, y, w, h) {
      parts.push(`<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="none" stroke="${esc(ctx.strokeStyle)}" stroke-width="${n2(ctx.lineWidth)}"${ctx.op()}/>`);
    },
    stroke() {
      if (!path.length) return;
      const dash = ctx._dash.length ? ` stroke-dasharray="${ctx._dash.join(' ')}"` : '';
      parts.push(`<path d="${path.join('')}" fill="none" stroke="${esc(ctx.strokeStyle)}" stroke-width="${n2(ctx.lineWidth)}" stroke-linejoin="${ctx.lineJoin === 'round' ? 'round' : 'miter'}" stroke-linecap="butt"${dash}${ctx.op()}/>`);
    },
    fill() {
      if (!path.length) return;
      parts.push(`<path d="${path.join('')}Z" fill="${esc(ctx.fillStyle)}"${ctx.op()}/>`);
    },
    fillText(text, x, y) {
      const m = /^(\d+)\s+([\d.]+)px\s+(.+)$/.exec(ctx.font) || [];
      const anchor = { center: 'middle', right: 'end', end: 'end' }[ctx.textAlign] || 'start';
      const base = { middle: 'central', top: 'hanging', hanging: 'hanging' }[ctx.textBaseline];
      parts.push(`<text x="${n2(x)}" y="${n2(y)}" font-family="${esc(m[3] || MONO)}" font-size="${m[2] || 10}" font-weight="${m[1] || 400}" fill="${esc(ctx.fillStyle)}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${base ? ` dominant-baseline="${base}"` : ''}${ctx.op()}>${esc(text)}</text>`);
    },
    // A raster embedded in the vector file — the whole-run export's cells,
    // which are a picture at one pixel per bin rather than shapes. Pixelated,
    // so a viewer scaling it up shows bins rather than a blur.
    imageSmoothingEnabled: true,
    drawImage(img, x, y, w, h) {
      if (!img || typeof img.toDataURL !== 'function') return;
      const smooth = ctx.imageSmoothingEnabled !== false;
      parts.push(`<image x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" preserveAspectRatio="none"${smooth ? '' : ' style="image-rendering:pixelated" image-rendering="pixelated"'} href="${img.toDataURL('image/png')}"${ctx.op()}/>`);
    },
    strokeText(text, x, y) {
      const m = /^(\d+)\s+([\d.]+)px\s+(.+)$/.exec(ctx.font) || [];
      const anchor = { center: 'middle', right: 'end', end: 'end' }[ctx.textAlign] || 'start';
      const base = { middle: 'central', top: 'hanging', hanging: 'hanging' }[ctx.textBaseline];
      parts.push(`<text x="${n2(x)}" y="${n2(y)}" font-family="${esc(m[3] || MONO)}" font-size="${m[2] || 10}" font-weight="${m[1] || 400}" fill="none" stroke="${esc(ctx.strokeStyle)}" stroke-width="${n2(ctx.lineWidth)}" stroke-linejoin="round"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${base ? ` dominant-baseline="${base}"` : ''}${ctx.op()}>${esc(text)}</text>`);
    },
    measureText(text) { return { width: String(text).length * 6 }; },
    toString() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(width)}" height="${n2(height)}" viewBox="0 0 ${n2(width)} ${n2(height)}">`
        + parts.join('') + '</svg>';
    },
    get size() { return parts.length; }
  };
  return ctx;
}

/**
 * A style with no ground: the diagram's own panels go too, or a transparent
 * export on a dark theme would be two dark boxes around transparent cells.
 * The halo under the head's path keeps the colour it had, since it is what
 * separates the path from the fills it crosses.
 */
export function transparentStyle(S) {
  return { ...S, halo: S.halo || S.bg, bg: null, gutterBg: null, rulerBg: null };
}

/** The whole diagram as an SVG document. */
export function spaceTimeSVG(model, L, S, opts = {}) {
  const ctx = svgContext(L.width, L.height);
  const style = opts.transparent ? transparentStyle(S) : S;
  paintSpaceTime(ctx, model, L, style, { headPath: opts.headPath, playhead: opts.playhead });
  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + ctx.toString();
}

// ══════════════════════════════════════════════════════════════════
//  TEXT AND CSV
// ══════════════════════════════════════════════════════════════════

function symWidth(model, t) {
  let w = String(t.blank ?? '').length || 1;
  for (const s of model.symbols) w = Math.max(w, String(s).length);
  for (const m of t.markers) w = Math.max(w, String(m).length);
  return w;
}

/**
 * The diagram as aligned text, one line per step — the form that pastes into
 * a paper, an email or a terminal. The head's cell is bracketed.
 */
export function spaceTimeText(model, o = {}) {
  const stateName = o.stateName || (id => String(id ?? ''));
  const from = clamp(o.rowFrom ?? 0, 0, Math.max(0, model.rows - 1));
  const to = clamp(o.rowTo ?? model.rows - 1, from, Math.max(0, model.rows - 1));
  if (!model.rows || !model.tapes) return '';
  const tapes = model.tapes;
  const widths = tapes.map(t => symWidth(model, t));
  const digits = String(to).length;
  let sw = 5;
  for (let i = from; i <= to; i++) sw = Math.max(sw, String(stateName(model.stateAt(i))).length);

  const out = [];
  if (o.title) out.push(`# ${o.title}`);
  if (o.sub) out.push(`# ${o.sub}`);
  tapes.forEach((t, i) => {
    // A label that already says what kind of tape it is gets the extent and
    // nothing else; a bare one says which ends are open.
    const named = o.tapeLabels && o.tapeLabels[i];
    const name = named || (tapes.length > 1 ? `T${i + 1}` : 'Tape');
    const ends = named ? '' : `${t.leftBound === null ? ', unbounded left' : ''}${t.rightBound === null ? ', unbounded right' : ''}`;
    out.push(`# ${name}: ${t.lo}..${t.hi}${ends}`);
  });
  out.push(`# [x] marks the head`);
  out.push('');

  const cursors = tapes.map((t, i) => model.cursor(i, from, t.lo, t.hi));
  for (let r = from; r <= to; r++) {
    const segs = tapes.map((t, i) => {
      const h = model.headAt(i, r);
      const w = widths[i];
      return cursors[i].cells.map((s, k) => {
        const txt = String(s).padEnd(w);
        return t.lo + k === h ? `[${txt}]` : ` ${txt} `;
      }).join('');
    });
    out.push(`${String(r).padStart(digits)}  ${String(stateName(model.stateAt(r))).padEnd(sw)}  ${segs.join('  |  ')}`.trimEnd());
    if (r < to) cursors.forEach(c => c.next());
  }
  const fin = FINAL_SAY[model.finalAt(to)];
  if (fin && o.complete !== false) out.push('', `# ${fin.text}`);
  return out.join('\n') + '\n';
}

const csvCell = s => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/**
 * One line per step and tape: `step,state,tape,head` and then one column per
 * absolute cell, over the union of every tape's extent so a multi-tape run
 * shares one header.
 */
export function spaceTimeCSV(model, o = {}) {
  const stateName = o.stateName || (id => String(id ?? ''));
  if (!model.rows || !model.tapes) return '';
  const from = clamp(o.rowFrom ?? 0, 0, model.rows - 1);
  const to = clamp(o.rowTo ?? model.rows - 1, from, model.rows - 1);
  const lo = Math.min(...model.tapes.map(t => t.lo));
  const hi = Math.max(...model.tapes.map(t => t.hi));
  const head = ['step', 'state', 'tape', 'head'];
  for (let c = lo; c <= hi; c++) head.push(String(c));
  const lines = [head.join(',')];
  const cursors = model.tapes.map((t, i) => model.cursor(i, from, t.lo, t.hi));
  for (let r = from; r <= to; r++) {
    model.tapes.forEach((t, i) => {
      const row = [r, csvCell(stateName(model.stateAt(r))), i + 1, model.headAt(i, r) ?? ''];
      for (let c = lo; c <= hi; c++) {
        row.push(c < t.lo || c > t.hi ? '' : csvCell(cursors[i].cells[c - t.lo]));
      }
      lines.push(row.join(','));
    });
    if (r < to) cursors.forEach(c => c.next());
  }
  return lines.join('\n') + '\n';
}

/** Roughly how many elements an SVG of this layout would hold. */
export function estimateSvgElements(model, L) {
  const cols = L.tapes.reduce((n, e) => n + e.cols, 0);
  return L.rowCount * cols * (L.glyphs ? 2 : 0.5) + L.rowCount * 2;
}

// ══════════════════════════════════════════════════════════════════
//  THE OVERVIEW — the whole run, averaged down to a few hundred pixels
// ══════════════════════════════════════════════════════════════════
//  The strip beside the diagram, and the whole-run export. Both are the
//  same object: the run divided into a grid of *bins* — a slice of time by
//  a span of cells — each holding how many (row, cell) pairs showed each
//  symbol. A bin's colour is its most common symbol, its strength how much
//  of it was written on.
//
//  Two shortcuts would each be wrong. Sampling a row per pixel skips most
//  rows and loses thin features, and the head's path is the thinnest one.
//  Reading every cell of every row costs rows × cells — twenty million at
//  the default budget, and again on every step of a streaming run.
//
//  **A cell only changes when it is written**, so this counts *durations*,
//  and it reads the same tape journal the diagram does.
//
//  **A boundary costs the strip's width, not the tape's.** Each column keeps
//  a *tally* — how many non-blank cells in it hold each symbol right now —
//  and closing a time bin credits every column tally × bin length at once.
//  A tally assumes each of its cells held its symbol for the whole bin, so a
//  write partway through settles the difference when it happens: a cell that
//  starts holding a symbol q rows into its bin is charged −q, and one that
//  stops is credited +q. The open bin therefore holds a correction, and its
//  true count is that plus tally × the rows it has so far — which is what
//  `overviewGrid` reads.
//
//  It used to visit every live cell at every boundary, crediting each its
//  stretch. That is exact too, and it costs boundaries × live cells: on a
//  tape as wide as its 100,000-row run, 6,362 boundaries came to 118 million
//  credits and 2.6 seconds, to add into four hundred columns. The counts are
//  the same numbers either way; tests/spacetime.test.js checks them against a
//  cell-by-cell count through every kind of merge.
//
//  The boxes are Uint32Array, and a correction can take one below zero for
//  a while. Typed-array stores wrap modulo 2³², so the arithmetic is modular
//  throughout and the count comes out exact once the bin closes — a closed
//  bin is never negative, and only closed bins are merged in time.
//
//  **Growing without redrawing.** A streaming run gets longer; refitting
//  the grid to every new row would rescale the strip continuously. So time
//  bins cover a power-of-two number of rows, and when the run outgrows them
//  pairs of bins are *merged* — exact, since counts add — and the bin size
//  doubles. Cells work the same way, aligned at multiples of a power-of-two
//  width, so a two-way tape growing left merges rather than rebuilds. The
//  export, which knows the run's size up front, instead picks its bin sizes
//  once (`fixed`) and never merges.
//
//  The head is kept as the leftmost and rightmost cell it visited within
//  each time bin, which is exactly what a zig-zag compresses to: a sweep
//  stays a sweep however hard it is squeezed.

const OV_SLOTS = 10;           // 0–7 the palette, 8 "other", 9 an end marker
const OV_OTHER = 8;
const OV_MARKER = 9;
const I32_MAX = 2147483647;
const I32_MIN = -2147483648;

function ovSlot(model, sym) {
  const s = model.slotOf(sym);
  return s === -1 ? -1 : s === -2 ? OV_MARKER : Math.min(s, OV_OTHER);
}

function viewCellsAt(model, tr, r) {
  const out = new Map();
  const v = tr.viewOf(model.steps[r]);
  if (!v || !v.cells) return out;
  const o = v.origin || 0;
  v.cells.forEach((sym, k) => out.set(o + k, sym));
  return out;
}

/**
 * An overview over a space-time model.
 *
 * @param opts { binsY, binsX (a number, or one per tape), fixed, rowFrom, rowTo }
 *        Streaming (the default) follows `model.rows` as it grows. `fixed`
 *        builds once over rowFrom..rowTo with bin sizes chosen to fit.
 */
export function makeOverview(model, opts = {}) {
  const BY = Math.max(2, (opts.binsY || 384) & ~1);
  const fixed = !!opts.fixed;
  const from = fixed ? Math.max(0, opts.rowFrom || 0) : 0;
  const to = fixed ? Math.min(model.rows - 1, opts.rowTo ?? model.rows - 1) : Infinity;

  const xbin = (st, x) => Math.floor((x - st.xOrigin) / st.w);

  const ov = {
    model, BY, fixed, from,
    // What was asked for, so a caller sizing the bins to a strip can tell
    // whether this overview still fits it.
    binsX: opts.binsX,
    rows: 0,
    binRows: fixed ? Math.max(1, Math.ceil((to - from + 1) / BY)) : 1,
    version: 0,
    tapes: [],
    extend,
    xbinOf: (t, x) => xbin(ov.tapes[t], x)
  };

  function col(st, b) {
    let a = st.cols.get(b);
    if (!a) { a = new Uint32Array(BY * OV_SLOTS); st.cols.set(b, a); }
    return a;
  }
  // A column's tally: how many of its cells hold each slot, and after them
  // (at OV_SLOTS) a bitmask of the slots that are nonzero — so a boundary
  // visits the symbols a column actually has, not all ten of every column.
  // A narrow tape of one symbol (BB(5)) was slower with the ten.
  const MASK = OV_SLOTS;
  function tallyOf(st, b) {
    let t = st.tally.get(b);
    if (!t) { t = new Int32Array(OV_SLOTS + 1); st.tally.set(b, t); }
    return t;
  }

  // The open bin closes after `len` rows: every column, tally × len at once.
  function closeBin(st, bin, len) {
    const k = bin * OV_SLOTS;
    for (const [b, t] of st.tally) {
      let m = t[MASK];
      if (m === 0) continue;
      const a = col(st, b);
      do {
        const s = 31 - Math.clz32(m & -m);
        a[k + s] += t[s] * len;
        m &= m - 1;
      } while (m !== 0);
    }
  }

  /**
   * Cell x becomes slot s (blank if s < 0), `into` rows into the open bin
   * `bin`. The slot it stops holding is credited the rows it held, and the
   * one it starts is charged the rows it missed — see the header.
   */
  function write(st, x, s, bin, into) {
    const old = st.live.get(x);
    // A symbol written over itself, or a blank over a blank, changes nothing.
    if (old === s || (old === undefined && s < 0)) return;
    const b = xbin(st, x);
    const t = tallyOf(st, b);
    const a = into > 0 ? col(st, b) : null;
    const k = bin * OV_SLOTS;
    if (old !== undefined) {
      if (--t[old] === 0) t[MASK] &= ~(1 << old);
      if (a) a[k + old] += into;
    }
    if (s >= 0) {
      if (t[s]++ === 0) t[MASK] |= 1 << s;
      if (a) a[k + s] -= into;
      st.live.set(x, s);
    } else st.live.delete(x);
  }

  function initTape(t) {
    const tr = model.tapes[t];
    const BX = Math.max(2, (Array.isArray(opts.binsX) ? opts.binsX[t] : opts.binsX) || 96);
    const st = {
      t, tr, BX,
      cols: new Map(),
      w: 1,
      xOrigin: 0,
      headMin: new Int32Array(BY).fill(I32_MAX),
      headMax: new Int32Array(BY).fill(I32_MIN),
      // Cell → the slot it holds, for every non-blank cell; and per column,
      // how many of them hold each slot.
      live: new Map(),
      tally: new Map()
    };
    if (fixed) {
      st.xOrigin = tr.lo;
      st.w = Math.max(1, Math.ceil((tr.hi - tr.lo + 1) / BX));
    }
    let initial;
    if (from === 0) initial = tr.kind === 'log' ? tr.j.initial : viewCellsAt(model, tr, 0);
    else {
      initial = new Map();
      model.cursor(t, from, tr.lo, tr.hi).cells.forEach((sym, k) => initial.set(tr.lo + k, sym));
    }
    for (const [x, sym] of initial) write(st, x, ovSlot(model, sym), 0, 0);
    st.prev = new Map(initial);
    return st;
  }

  // Pairs of time bins become one. In place, low to high: bin i reads 2i and
  // 2i+1, which no earlier i has written. Only ever at a boundary, after the
  // open bin has closed: its correction is relative to where it started, and
  // doubling the bin length under it would move that start.
  function mergeY() {
    const half = BY / 2;
    for (const st of ov.tapes) {
      for (const a of st.cols.values()) {
        for (let i = 0; i < half; i++) {
          for (let s = 0; s < OV_SLOTS; s++) {
            a[i * OV_SLOTS + s] = a[2 * i * OV_SLOTS + s] + a[(2 * i + 1) * OV_SLOTS + s];
          }
        }
        a.fill(0, half * OV_SLOTS);
      }
      for (let i = 0; i < half; i++) {
        st.headMin[i] = Math.min(st.headMin[2 * i], st.headMin[2 * i + 1]);
        st.headMax[i] = Math.max(st.headMax[2 * i], st.headMax[2 * i + 1]);
      }
      st.headMin.fill(I32_MAX, half);
      st.headMax.fill(I32_MIN, half);
    }
    ov.binRows *= 2;
  }

  // Pairs of cell bins become one. Exact because bins are aligned at
  // multiples of their width from cell 0, so floor(b / 2) is the bin of the
  // doubled width — negative cells included.
  function mergeX(st) {
    const next = new Map();
    for (const [b, a] of st.cols) {
      const nb = Math.floor(b / 2);
      const have = next.get(nb);
      if (!have) next.set(nb, a);
      else for (let k = 0; k < a.length; k++) have[k] += a[k];
    }
    st.cols = next;
    const tally = new Map();
    for (const [b, t] of st.tally) {
      const nb = Math.floor(b / 2);
      const have = tally.get(nb);
      if (!have) tally.set(nb, t);
      else { for (let s = 0; s < OV_SLOTS; s++) have[s] += t[s]; have[MASK] |= t[MASK]; }
    }
    st.tally = tally;
    st.w *= 2;
  }

  const spanFits = st => xbin(st, st.tr.hi) - xbin(st, st.tr.lo) + 1 <= st.BX;

  function extend() {
    if (!model.tapes) return false;
    const n = fixed ? to + 1 : model.rows;
    if (!ov.tapes.length) {
      if (n <= from) return false;
      ov.tapes = model.tapes.map((_, t) => initTape(t));
    }
    const start = from + ov.rows;
    if (start >= n) return false;
    // Widen the cell bins *before* crediting, not after. The model is already
    // indexed to n, so its extent is every cell this pass can touch; merging
    // afterwards meant one pass over a finished run — ⏭, or the section opened
    // late — first made a column per cell at the old width. On a tape as wide
    // as the run that was a BY × 10 array for each of 100,000 cells: 6 GB
    // allocated and 21 s spent, to be merged away on the last line. The widths
    // come out the same either way, and merging is exact, so the counts do too.
    if (!fixed) for (const st of ov.tapes) while (!spanFits(st)) mergeX(st);
    for (let r = start; r < n; r++) {
      const q = r - from;
      // Close the bin that ended, *then* merge: see mergeY.
      if (q > 0 && q % ov.binRows === 0) {
        for (const st of ov.tapes) closeBin(st, q / ov.binRows - 1, ov.binRows);
      }
      if (!fixed) while (q >= BY * ov.binRows) mergeY();
      const bin = Math.floor(q / ov.binRows);
      const into = q - bin * ov.binRows;
      for (const st of ov.tapes) {
        if (q > 0 && st.tr.kind === 'log') {
          const j = st.tr.j;
          const c = j.wCell[r - 1];
          if (c !== undefined) {
            const sym = j.wSym[r - 1];
            write(st, c, sym === undefined ? -1 : ovSlot(model, sym), bin, into);
          }
        }
        if (q > 0 && st.tr.kind === 'view' && !st.tr.readOnly) {
          // A stack has no journal; its row is its contents. So a write is a
          // cell whose symbol differs from the row before — the same event a
          // tape's journal records, found by comparing instead of by reading.
          const cur = viewCellsAt(model, st.tr, r);
          const change = (x, sym) => write(st, x, sym === undefined ? -1 : ovSlot(model, sym), bin, into);
          for (const [x, sym] of cur) if (st.prev.get(x) !== sym) change(x, sym);
          for (const x of st.prev.keys()) if (!cur.has(x)) change(x, undefined);
          st.prev = cur;
        }
        const h = model.headAt(st.t, r);
        if (h !== null) {
          if (h < st.headMin[bin]) st.headMin[bin] = h;
          if (h > st.headMax[bin]) st.headMax[bin] = h;
        }
      }
    }
    ov.rows = n - from;
    ov.version++;
    return true;
  }

  return ov;
}

/**
 * Tape t's bins as a dense grid, with the rows still open in the last bin
 * credited — what the picture is drawn from, and what the tests check against
 * a brute-force count.
 */
export function overviewGrid(ov, t) {
  const st = ov.tapes[t];
  if (!st || !ov.rows) return null;
  const tr = st.tr;
  const n = ov.rows;
  const ny = Math.ceil(n / ov.binRows);
  const bLo = ov.xbinOf(t, tr.lo);
  const bHi = ov.xbinOf(t, tr.hi);
  const nx = bHi - bLo + 1;
  const counts = new Uint32Array(ny * nx * OV_SLOTS);
  for (const [b, a] of st.cols) {
    if (b < bLo || b > bHi) continue;
    const xi = b - bLo;
    for (let i = 0; i < ny; i++) {
      for (let s = 0; s < OV_SLOTS; s++) counts[(i * nx + xi) * OV_SLOTS + s] = a[i * OV_SLOTS + s];
    }
  }
  // The last bin is still open: what it holds is a correction, and its count
  // is that plus tally × the rows it has so far. Modular, like the bins.
  const last = ny - 1;
  const len = n - last * ov.binRows;
  for (const [b, tl] of st.tally) {
    if (b < bLo || b > bHi) continue;
    const k = (last * nx + b - bLo) * OV_SLOTS;
    for (let s = 0; s < OV_SLOTS; s++) if (tl[s] !== 0) counts[k + s] += tl[s] * len;
  }
  return {
    t, nx, ny, bLo, w: st.w, binRows: ov.binRows, rows: n,
    counts,
    // Copies: a later merge rewrites these arrays in place, and a picture
    // built from this grid must go on describing the rows it was built from.
    headMin: st.headMin.slice(0, ny),
    headMax: st.headMax.slice(0, ny),
    // The first cell the grid's left edge stands for — a bin is aligned to its
    // width, so this can sit left of the tape's first cell.
    cell0: st.xOrigin + bLo * st.w,
    lo: tr.lo,
    hi: tr.hi,
    leftBound: tr.leftBound,
    rightBound: tr.rightBound
  };
}

/** '#abc', '#aabbcc', 'rgb(…)' or 'rgba(…)' as [r, g, b], or null. */
export function rgbOf(color) {
  const c = String(color || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map(h => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})/i.exec(c);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (m) return [+m[1], +m[2], +m[3]].map(Math.round);
  return null;
}

/** The ten slot colours an overview image is painted in. */
export function overviewColors(S) {
  const pal = S.palette.map(c => rgbOf(c) || [128, 128, 128]);
  return [...pal, rgbOf(S.other) || [138, 143, 152], rgbOf(S.ink2) || [128, 128, 128]];
}

/**
 * The grid as pixels, one per bin: the most common symbol's colour, at a
 * strength set by how much of the bin was written on. Blank bins are clear.
 */
export function overviewImage(grid, colors) {
  const { nx, ny, counts, binRows, rows, w } = grid;
  const data = new Uint8ClampedArray(nx * ny * 4);
  for (let i = 0; i < ny; i++) {
    const rowsIn = Math.min(binRows, rows - i * binRows);
    const area = Math.max(1, rowsIn * w);
    for (let xi = 0; xi < nx; xi++) {
      const base = (i * nx + xi) * OV_SLOTS;
      let best = -1;
      let bestN = 0;
      let total = 0;
      for (let s = 0; s < OV_SLOTS; s++) {
        const v = counts[base + s];
        total += v;
        if (v > bestN) { bestN = v; best = s; }
      }
      if (!total) continue;
      const rgb = colors[best];
      const cover = Math.min(1, total / area);
      const p = (i * nx + xi) * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = Math.round(255 * (best === OV_MARKER ? 0.5 : 0.4 + 0.6 * cover));
    }
  }
  return { data, width: nx, height: ny };
}

/**
 * The head's path through the bins: across each bin from the end nearer the
 * previous one to the other, so a back-and-forth compresses to a zig-zag of
 * horizontal spans rather than a smear.
 */
function envelopePath(grid, xCenter, yMid) {
  const pts = [];
  let prev = null;
  for (let i = 0; i < grid.ny; i++) {
    const a = grid.headMin[i];
    const b = grid.headMax[i];
    if (a > b) { pts.push(null); prev = null; continue; }
    const y = yMid(i);
    const xa = xCenter(a);
    const xb = xCenter(b);
    if (prev && Math.abs(prev[0] - xb) < Math.abs(prev[0] - xa)) {
      pts.push([xb, y], [xa, y]);
      prev = [xa, y];
    } else {
      pts.push([xa, y], [xb, y]);
      prev = [xb, y];
    }
  }
  return pts;
}

function strokePath(ctx, pts) {
  ctx.beginPath();
  let pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    pen = true;
  }
  ctx.stroke();
}

function strokeHeadPath(ctx, pts, S, heavy) {
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = S.halo || S.bg || S.gutterBg || '#ffffff';
  ctx.lineWidth = heavy ? 3.5 : 3;
  strokePath(ctx, pts);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = S.ink;
  ctx.lineWidth = heavy ? 1.5 : 1.25;
  strokePath(ctx, pts);
}

// ── the strip ─────────────────────────────────────────────────────

/**
 * Where everything in the strip goes. While a run is still streaming the
 * vertical scale is the overview's capacity — the next power of two — so the
 * strip rescales only when the run doubles, and the part not yet computed is
 * visible as such rather than the computed part stretching to fill it.
 */
export function overviewGeometry(ov, W, H, complete) {
  const pad = 6;
  const top = pad;
  const innerH = Math.max(10, H - 2 * pad);
  const n = ov.rows;
  const scaleRows = complete ? Math.max(1, n) : Math.max(n, ov.BY * ov.binRows);
  const tracks = ov.model.tapes || [];
  const k = Math.max(1, tracks.length);
  const gap = 4;
  const side = 6;
  // Whole pixels, so every tape's edges land on the pixel grid.
  const tw = Math.max(6, Math.floor((W - 2 * side - gap * (k - 1)) / k));
  const tapes = tracks.map((tr, t) => ({ t, lo: tr.lo, hi: tr.hi, x: side + t * (tw + gap), w: tw }));
  return {
    W, H, top, innerH, scaleRows, rows: n, tapes, gap,
    yOf: r => top + (r / scaleRows) * innerH,
    rowAt: y => clamp(Math.floor(((y - top) / innerH) * scaleRows), 0, Math.max(0, n - 1)),
    xOf: (e, c) => e.x + ((c - e.lo) / (e.hi - e.lo + 1)) * e.w,
    cellAt: (e, x) => clamp(e.lo + Math.floor(((x - e.x) / e.w) * (e.hi - e.lo + 1)), e.lo, e.hi),
    tapeAt: x => tapes.find(e => x >= e.x - gap / 2 && x < e.x + e.w + gap / 2) || null
  };
}

/**
 * The strip's still part — ground, wells, bins and the head's path — drawn at
 * the device's own resolution into `ctx`, a canvas `G.W × dpr` by `G.H × dpr`.
 *
 * **Every device pixel takes the bin under its centre.** The first version
 * drew one pixel per bin and let the browser stretch the picture to fit, with
 * smoothing on — so a tape eighteen cells wide became eighteen pixels blurred
 * across fifty, every column edge a gradient. Sampling per device pixel keeps
 * every edge on the pixel grid, and a caller that sizes the bins to the strip
 * (never more bins than pixels) loses none of them to the sampling.
 *
 * Drawn once per change and blitted 1:1 per frame; the parts that move —
 * the viewport box, the playhead — are `paintOverviewStrip`'s.
 */
export function renderOverviewBase(ctx, grids, colors, S, G, dpr, opts = {}) {
  const Wd = Math.round(G.W * dpr);
  const Hd = Math.round(G.H * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Wd, Hd);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = S.gutterBg;
  ctx.fillRect(0, 0, G.W, G.H);
  ctx.fillStyle = S.rule;
  ctx.fillRect(0, 0, 1, G.H);
  if (!G.rows) return;
  const yEnd = G.yOf(G.rows);
  for (const e of G.tapes) {
    ctx.fillStyle = S.bg;
    ctx.fillRect(e.x, G.top, e.w, yEnd - G.top);
  }

  // The bins, composited over the wells by hand: one read, one write.
  const py0 = Math.max(0, Math.round(G.top * dpr));
  const py1 = Math.min(Hd, Math.round(yEnd * dpr));
  if (py1 > py0 && typeof ctx.getImageData === 'function') {
    const img = ctx.getImageData(0, 0, Wd, Hd);
    const d = img.data;
    for (const e of G.tapes) {
      const g = grids[e.t];
      if (!g) continue;
      const pix = overviewImage(g, colors).data;
      const cols = e.hi - e.lo + 1;
      const px0 = Math.max(0, Math.round(e.x * dpr));
      const px1 = Math.min(Wd, Math.round((e.x + e.w) * dpr));
      const xBin = new Int32Array(px1 - px0);
      for (let px = px0; px < px1; px++) {
        const c = e.lo + Math.floor(((px + 0.5) / dpr - e.x) / e.w * cols);
        xBin[px - px0] = Math.floor((c - g.cell0) / g.w);
      }
      for (let py = py0; py < py1; py++) {
        const r = Math.floor(((py + 0.5) / dpr - G.top) / G.innerH * G.scaleRows);
        const i = Math.floor(r / g.binRows);
        if (r >= g.rows || i < 0 || i >= g.ny) continue;
        for (let px = px0; px < px1; px++) {
          const xi = xBin[px - px0];
          if (xi < 0 || xi >= g.nx) continue;
          const s = (i * g.nx + xi) * 4;
          const a = pix[s + 3];
          if (!a) continue;
          const t = (py * Wd + px) * 4;
          const k = a / 255;
          d[t] = pix[s] * k + d[t] * (1 - k);
          d[t + 1] = pix[s + 1] * k + d[t + 1] * (1 - k);
          d[t + 2] = pix[s + 2] * k + d[t + 2] * (1 - k);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  if (opts.headPath === false) return;
  // Lighter than in the diagram: squeezed this hard, a run's short early
  // sweeps overplot, and at full ink they smear into a white block that hides
  // the shape the strip is there to show. The horizontal spans sit on pixel
  // centres, so a one-pixel line is one pixel rather than two half-lit ones.
  const snapY = y => (Math.floor(y * dpr) + 0.5) / dpr;
  for (const e of G.tapes) {
    const g = grids[e.t];
    if (!g) continue;
    const cellW = e.w / (e.hi - e.lo + 1);
    const pts = envelopePath(g,
      c => G.xOf(e, c) + cellW / 2,
      i => snapY(G.yOf(i * g.binRows + Math.min(g.binRows, g.rows - i * g.binRows) / 2)));
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = S.ink;
    ctx.lineWidth = 1;
    strokePath(ctx, pts);
    ctx.globalAlpha = 1;
  }
}

/**
 * Draw the strip: the base from `renderOverviewBase`, copied pixel for pixel,
 * and what moves over it.
 *
 * @param V { complete, view: { row0, row1, cols: [[c0, c1] | null per tape] },
 *            playhead, marks: [{ from, to, tone }] }
 */
export function paintOverviewStrip(ctx, ov, base, S, G, V = {}) {
  const { W, H } = G;
  if (base) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
  } else {
    ctx.fillStyle = S.gutterBg;
    ctx.fillRect(0, 0, W, H);
  }
  if (!G.rows) return;
  const yEnd = G.yOf(G.rows);
  const yFull = G.top + G.innerH;

  for (const e of G.tapes) {
    // Not yet computed: the well goes on, dashed, to where the scale ends.
    if (!V.complete && yFull - yEnd > 2) {
      ctx.strokeStyle = S.ink3;
      ctx.lineWidth = 1;
      if (ctx.setLineDash) ctx.setLineDash([2, 3]);
      ctx.strokeRect(e.x + 0.5, yEnd + 0.5, e.w - 1, yFull - yEnd - 1);
      if (ctx.setLineDash) ctx.setLineDash([]);
    }
  }

  // Landmarks, as bars on the outer edge: a loop's span, a block boundary,
  // how the run ended.
  for (const m of V.marks || []) {
    const y0 = G.yOf(m.from);
    const y1 = Math.max(y0 + 2, G.yOf(m.to + 1));
    ctx.fillStyle = S[m.tone] || S.accent;
    ctx.fillRect(W - 4, y0, 3, y1 - y0);
  }

  // Where the diagram is looking.
  const view = V.view;
  if (view) {
    const y0 = G.yOf(view.row0);
    const y1 = Math.max(y0 + 4, G.yOf(view.row1 + 1));
    ctx.fillStyle = S.accent;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(2, y0, W - 6, y1 - y0);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = S.accent;
    ctx.lineWidth = 1.25;
    for (const e of G.tapes) {
      const cr = view.cols && view.cols[e.t];
      if (!cr) continue;
      const x0 = Math.max(e.x - 1, G.xOf(e, cr[0]));
      const x1 = Math.min(e.x + e.w + 1, Math.max(G.xOf(e, cr[0]) + 3, G.xOf(e, cr[1] + 1)));
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(2, x1 - x0 - 1), Math.max(2, y1 - y0 - 1));
    }
    ctx.globalAlpha = 1;
  }

  const p = V.playhead;
  if (p !== undefined && p !== null && p >= 0 && p < G.rows) {
    const y = Math.round(G.yOf(p + 0.5)) + 0.5;
    ctx.fillStyle = S.accent;
    ctx.fillRect(3, y - 0.75, W - 7, 1.5);
    ctx.beginPath();
    ctx.moveTo(1, y - 4);
    ctx.lineTo(6, y);
    ctx.lineTo(1, y + 4);
    if (typeof ctx.fill === 'function') ctx.fill();
  }
}

// ── the whole-run export ──────────────────────────────────────────

/** The largest the whole-run picture's plot is allowed to be. */
export const WHOLE_RUN_MAX = Object.freeze({ tapeW: 480, h: 1600 });

/** The bin counts a whole-run export of rows from..to is built with. */
export function wholeRunBins(model, from, to) {
  const rows = Math.min(to - from + 1, WHOLE_RUN_MAX.h);
  return {
    binsY: rows + (rows % 2),
    binsX: (model.tapes || []).map(t => Math.min(t.hi - t.lo + 1, WHOLE_RUN_MAX.tapeW))
  };
}

/**
 * Where everything goes in a whole-run picture. A bin is drawn as a block of
 * whole pixels — square when nothing had to be compressed, so a short run
 * exported this way still looks like its diagram.
 */
export function wholeRunLayout(grids, o = {}) {
  const ny = Math.max(1, ...grids.map(g => g.ny));
  const plain = grids.every(g => g.w === 1 && g.binRows === 1);
  const sy = clamp(Math.floor(WHOLE_RUN_MAX.h / ny), 1, 4);
  const sxs = grids.map(g => clamp(Math.floor(WHOLE_RUN_MAX.tapeW / g.nx), 1, 6));
  const square = plain ? Math.max(1, Math.min(sy, ...sxs)) : null;
  const scaleY = square || sy;
  const lastRow = (o.rowFrom || 0) + (grids[0] ? grids[0].rows - 1 : 0);
  const gutterW = Math.ceil(charW(10) * Math.max(4, String(lastRow).length)) + 18;
  const captionH = o.caption ? 50 : 0;
  const rulerH = 36;
  const top = captionH + rulerH;
  const capW = 6;
  const GAP = 24;
  let x = gutterW + 10;
  const tapes = grids.map((g, i) => {
    const sx = square || sxs[i];
    const e = {
      t: g.t, g, sx, x: x + capW, w: g.nx * sx,
      label: (o.tapeLabels && o.tapeLabels[i]) || (grids.length > 1 ? `T${i + 1}` : 'Tape')
    };
    x = e.x + e.w + capW + GAP;
    return e;
  });
  const plotH = ny * scaleY;
  const statusH = 30;
  const legendH = o.legend ? 26 : 0;
  return {
    gutterW, captionH, rulerH, top, capW, tapes, scaleY, plotH, ny,
    width: Math.max(gutterW + 220, x - GAP + 12),
    height: top + plotH + statusH + legendH + 6,
    caption: o.caption || null,
    rowFrom: o.rowFrom || 0
  };
}

/** Draw a whole run into one picture: a canvas for PNG, `svgContext` for SVG. */
export function paintWholeRun(ctx, model, grids, imgs, S, EL, o = {}) {
  const { top, plotH } = EL;
  if (S.bg) { ctx.fillStyle = S.bg; ctx.fillRect(0, 0, EL.width, EL.height); }
  const g0 = grids[0];
  if (!g0) return;
  const binRows = g0.binRows;
  const rows = g0.rows;
  const y1 = top + plotH;

  for (const e of EL.tapes) {
    const g = e.g;
    const cellPx = e.sx / g.w;
    const xOf = c => e.x + (c - g.cell0) * cellPx;
    // The ends, as in the diagram: a wall where the head cannot go, a dashed
    // edge where the tape carries on past what is drawn.
    const boundL = g.leftBound !== null && g.leftBound !== undefined && g.lo <= g.leftBound;
    const boundR = g.rightBound !== null && g.rightBound !== undefined && g.hi >= g.rightBound;
    const edge = (bound, x) => {
      if (bound) {
        ctx.fillStyle = S.wallBg;
        ctx.fillRect(x, top, EL.capW, plotH);
        ctx.strokeStyle = S.wallInk;
        ctx.lineWidth = 1;
        hatch(ctx, x, top, EL.capW, y1, 5);
      } else {
        ctx.strokeStyle = S.ink3;
        ctx.lineWidth = 1;
        if (ctx.setLineDash) ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, y1);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
      }
    };
    const xL = xOf(g.lo);
    const xR = xOf(g.hi + 1);
    edge(boundL, boundL ? xL - EL.capW : xL - 0.5);
    edge(boundR, boundR ? xR : xR + 0.5);

    if (imgs[e.t]) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(imgs[e.t], e.x, top, e.w, g.ny * EL.scaleY);
      ctx.imageSmoothingEnabled = true;
    }
    if (o.headPath !== false) {
      strokeHeadPath(ctx, envelopePath(g,
        c => xOf(c) + cellPx / 2,
        i => top + (i + Math.min(1, (g.rows - i * binRows) / binRows) / 2) * EL.scaleY), S, EL.scaleY >= 3);
    }

    // The ruler: the tape's name, and cell numbers at a readable interval.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(10, 600, S.sans);
    ctx.fillStyle = S.ink2;
    ctx.fillText(e.label, e.x - EL.capW, EL.captionH + 11);
    const widest = Math.max(String(g.lo).length, String(g.hi).length);
    const every = niceStep(Math.ceil((charW(9) * widest + 12) / cellPx));
    ctx.font = font(9, 400, S.mono);
    ctx.textAlign = 'center';
    for (let c = Math.ceil(g.lo / every) * every; c <= g.hi; c += every) {
      const x = xOf(c) + cellPx / 2;
      ctx.fillStyle = c === 0 ? S.ink : S.ink3;
      ctx.fillText(String(c), x, top - 12);
      ctx.fillStyle = S.rule;
      ctx.fillRect(Math.round(x), top - 5, 1, 4);
    }
  }

  // The gutter: step numbers down the side.
  if (S.gutterBg) {
    ctx.fillStyle = S.gutterBg;
    ctx.fillRect(0, top, EL.gutterW, plotH);
  }
  ctx.fillStyle = S.rule;
  ctx.fillRect(EL.gutterW - 1, top, 1, plotH);
  const pxPerRow = EL.scaleY / binRows;
  const every = niceStep(Math.ceil(18 / pxPerRow));
  ctx.font = font(10, 400, S.mono);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r += every) {
    const yr = top + r * pxPerRow;
    // The first label sits on the plot's top edge rather than half above it.
    const y = Math.max(top + 6, yr + Math.min(EL.scaleY, Math.max(pxPerRow, 1)) / 2);
    ctx.fillStyle = S.ink3;
    ctx.fillText(String(r + EL.rowFrom), EL.gutterW - 8, y);
    ctx.fillStyle = S.rule;
    ctx.fillRect(EL.gutterW - 5, Math.round(yr), 4, 1);
  }
  ctx.font = font(9, 600, S.sans);
  ctx.fillStyle = S.ink3;
  ctx.fillText('step', EL.gutterW - 8, top - 12);

  // How it ended, and how much it was squeezed to fit.
  const last = EL.rowFrom + rows - 1;
  const fin = o.complete !== false ? FINAL_SAY[model.finalAt(last)] : null;
  const ys = y1 + 17;
  const x = EL.gutterW + 10;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let tx = x;
  if (fin) {
    ctx.font = font(11, 700, S.mono);
    ctx.fillStyle = S[fin.tone] || S.ink2;
    ctx.fillText(fin.text, tx, ys);
    tx += charW(11) * (fin.text.length + 1);
  }
  const tail = [fin
    ? `after ${last.toLocaleString()} step${last === 1 ? '' : 's'}`
    : `steps ${EL.rowFrom.toLocaleString()}–${last.toLocaleString()}`];
  if (binRows > 1) tail.push(`each pixel row is ${binRows} steps`);
  if (grids.some(g => g.w > 1)) tail.push(`each pixel column is ${Math.max(...grids.map(g => g.w))} cells`);
  ctx.font = font(11, 400, S.mono);
  ctx.fillStyle = S.ink2;
  ctx.fillText(tail.join(' · '), tx, ys);

  if (EL.caption) {
    ctx.font = font(13, 700, S.sans);
    ctx.fillStyle = S.ink;
    ctx.fillText(EL.caption.title || '', 12, 18);
    if (EL.caption.sub) {
      ctx.font = font(11, 400, S.sans);
      ctx.fillStyle = S.ink2;
      ctx.fillText(EL.caption.sub, 12, 36);
    }
  }

  if (o.legend && model.symbols.length) {
    let lx = x;
    const ly = y1 + 30 + 12;
    ctx.font = font(10, 400, S.mono);
    for (const sym of model.symbols) {
      const slot = model.slotOf(sym);
      ctx.fillStyle = slot < 8 ? S.palette[slot] : S.other;
      ctx.fillRect(lx, ly - 5, 10, 10);
      ctx.fillStyle = S.ink2;
      ctx.fillText(sym, lx + 14, ly);
      lx += 14 + charW(10) * String(sym).length + 14;
    }
    if (o.headPath !== false) {
      ctx.strokeStyle = S.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, ly + 4);
      ctx.lineTo(lx + 6, ly - 4);
      ctx.lineTo(lx + 12, ly + 4);
      ctx.stroke();
      ctx.fillStyle = S.ink2;
      ctx.fillText('head', lx + 17, ly);
    }
  }
}
