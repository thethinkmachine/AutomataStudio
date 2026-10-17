// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — THE DEEP MAP
// ══════════════════════════════════════════════════════════════════
// A finite room drawn as one zoomable map, from the whole room down to single
// volumes. DOM-free: the worker reads tiles with it and the tests check it
// without a page. The painter is babel-ui.js's.
//
// The layout. A finite room's volume is a mixed-radix number, its digits
// listed low first by roomShape().radices(). The map splits the room in
// number order: level 0 is the whole room, each level cuts every block into
// a grid of children taken from the next digits down — about a hundred
// children a level, whole digits wherever they fit, so in a DFA room one
// level fixes two moves (a 10 × 10 grid in a 10-state room) and the last one
// the accept set (32 × 32). A digit too large for one level is narrowed over
// several, as a run of its values. A block is therefore always a run of
// consecutive volume numbers, and a cell's children read left to right, top
// to bottom, in number order.
//
// The camera. Fifty levels down a double can no longer tell neighbouring
// cells apart, so the camera is a cell, not a point: the level whose cells
// are drawn, that level's cell under the centre as BigInt grid coordinates,
// a float offset inside it, and the cell's width in CSS pixels — kept between
// MAP_FLOOR and the size at which its children would be drawable, so zooming
// past either bound moves it one level.
//
// A tile is one block drawn as its children; its cells are read in the
// worker. A block's colour is MAP_SAMPLES machines drawn from it — seeded by
// the cell, so a view always looks the same and the reading pane can show the
// very machines it came from. Cells at the bottom level are single volumes and
// read exactly.

// Every room has one: a finite room's layout is built from its digits, and an
// endless room is a row of its sizes (sizeLayout), each size a finite run of
// volumes laid out the same way. Nothing in a layout is held per level as a
// BigInt — a block's size, a level's width — because a room 100,000 levels
// deep would hold 100,000 numbers each as long as its volume numbers: that is
// what ran dfa-300-300 out of memory and once kept rooms past 2,500 levels on
// the census map. Each level is its grid and a symbolic size (which digit, how
// many of its values), and the numbers are worked out when asked, from their
// neighbours (sizeAt, widthAt).

import { roomId, roomShape } from './wings.js';
import { seededBelow } from './volumes.js';
import { cellClassesOf, classifyBody } from './census.js';
import { flatLanguageClass } from './facts.js';
import { tileSpans } from './spell.js';
import { prefixProducts, radixProduct, valueAt, volumesBefore } from './shape.js';

/** The smallest cell the map draws, in CSS px: below it, the level above is drawn. */
export const MAP_FLOOR = 6;
/** The largest a single volume's cell grows. */
export const MAP_MAX_CELL = 420;
/** From this cell width, a volume is drawn as a plate. */
export const PLATE_FROM = 120;
/** A cell past the end of the room. */
export const VOID = 255;
/** A machine the classifier could not settle. */
export const UNKNOWN = 254;

const FAN_TARGET = 100;   // children a level aims for
const FAN_MAX = 1024;     // and never exceeds
const NARROW = 256;       // a huge digit is narrowed this many ways a level

/**
 * How many machines colour a block. Five for finite automata and ω-automata,
 * whose classifiers take microseconds; one for the rooms whose machines are
 * run (Turing machines, the one-counter automaton), where five would make
 * every screen five times slower to read.
 */
export function samplesFor(wing, layout = null) {
  if (!(wing.kind === 'fa' || wing.kind === 'omega')) return 1;
  // Past about 33,000 bits a volume is a long decode, and five a block made
  // a tile take seconds: one a block, as in the rooms whose machines are run.
  return layout && layout.lvol[0] > 10000 ? 1 : 5;
}

/** log10 of a positive BigInt, to a float's precision — from its hex digits, so a long one costs nothing. */
export function bigLog10(b) {
  b = BigInt(b);
  if (b < 1n << 50n) return Math.log10(Number(b));
  const hex = b.toString(16);
  return Math.log10(parseInt(hex.slice(0, 12), 16)) + (hex.length - 12) * Math.log10(16);
}

// ── The layout ─────────────────────────────────────────────────────

const layouts = new Map();

function remember(id, layout) {
  if (layouts.size > 64) layouts.clear();
  layouts.set(id, layout);
  return layout;
}

/** A finite room's deep-map layout (cached per room), or null for an endless room — whose sizes have theirs (sizeLayout). */
export function deepLayout(wing, params) {
  const id = roomId(wing, params);
  const known = layouts.get(id);
  if (known) return known;
  const shape = roomShape(wing, params);
  if (!shape.finite) return null;
  // `radices` leaves out digits with one value: they say nothing and would make empty levels.
  const radices = (shape.radices ? shape.radices() : [shape.total]).map(BigInt).filter(r => r > 1n);
  // Only a wing that names its parts (q9 · j, F) has something to say about a
  // level: without one, every part is called by its shape ("set").
  const spans = () => {
    if (!wing.tile) return null;
    try { return tileSpans(wing, params, valueAt(shape, 0n).value); } catch { return null; }
  };
  return remember(id, buildLayout(id, shape.total, radices, spans));
}

/**
 * Size s of an endless room as a finite room of its own: its count(s) volumes,
 * the first of them the room's volume `base`. A size has no parts to split by,
 * so its volumes are laid out by the decimal digits of their rank in it: a
 * level fixes two, a 10 × 10 grid every block fills, and the only empty cells
 * are past its last volume. Narrowed as one huge digit, a few hundred ways a
 * level, a run of 7 left a 3 × 3 with holes at the end of every block.
 * Null for a size with no machines.
 */
export function sizeLayout(wing, params, s) {
  const id = `${roomId(wing, params)}@${s}`;
  const known = layouts.get(id);
  if (known) return known;
  const shape = roomShape(wing, params);
  if (shape.finite) return null;
  const total = shape.count(s);
  if (!(total > 0n)) return null;
  const radices = [];
  let rest = total;
  while (rest > 10n) { radices.push(10n); rest = (rest + 9n) / 10n; }
  if (rest > 1n) radices.push(rest);
  const layout = buildLayout(id, total, radices, () => null);
  layout.size = s;
  layout.base = volumesBefore(shape, s);
  return remember(id, layout);
}

/** Products of a row of BigInts read like an array: `view[l]` is the product of the first l (prefixProducts). */
function lazyProducts(row, whole = null) {
  const at = prefixProducts(row, whole);
  return { at, view: new Proxy([], { get: (t, p) => (p === 'length' ? row.length + 1 : typeof p === 'string' && /^\d+$/.test(p) ? at(Number(p)) : t[p]) }) };
}

/** An array read through a function, worked out once per index. */
function lazyRow(n, fn) {
  const cache = new Map();
  const at = l => {
    if (!cache.has(l)) cache.set(l, fn(l));
    return cache.get(l);
  };
  return new Proxy([], { get: (t, p) => (p === 'length' ? n : typeof p === 'string' && /^\d+$/.test(p) ? at(Number(p)) : t[p]) });
}

/**
 * The layout of a run of `total` volumes numbered by `radices` (low first).
 * A block is held as places[i] · m — the product of the digits below i, times
 * m values of digit i still open (m = 1 when the block is aligned to a digit):
 * every comparison the walk makes reads digit indices and small numbers.
 */
function buildLayout(id, total, radices, spansOf) {
  const R = radices.length;
  // The radices' product: the room's total, or past it for a size whose
  // top digit runs on past its last volume (those cells are past the room).
  const places = lazyProducts(radices, radixProduct(radices));
  const logPlace = new Float64Array(R + 1);
  for (let k = 0; k < R; k++) logPlace[k + 1] = logPlace[k] + bigLog10(radices[k]);
  // The digit index k with places[k] = places[i] · m, if there is one.
  const placeIndexOf = (i, m) => {
    let prod = 1n, k = i;
    while (prod < m && k < R) { prod *= radices[k]; k++; }
    return prod === m ? k : undefined;
  };

  // Each level is laid out as it is chosen, because its grid depends on the
  // shape of the cells it cuts: `asp` is their width over their height.
  const levels = [], aspect = [1];
  let asp = 1, i = R, m = 1n;
  const FAN = BigInt(FAN_MAX);
  const pushLevel = (ci, cm) => {
    const fan = Number((radixProduct(radices, ci, i) * m + cm - 1n) / cm);
    const { cols, rows } = gridFor(fan, placeIndexOf(i, m), placeIndexOf(ci, cm), radices, asp, true);
    levels.push({ cols, rows, colsB: BigInt(cols), rowsB: BigInt(rows), ci, cm });
    asp *= rows / cols;
    aspect.push(asp);
    i = ci; m = cm;
  };

  for (let guard = 0; guard < 1e8; guard++) {
    if (i === 0 && m === 1n && levels.length) break;   // down to single volumes
    if (logPlace[i] + bigLog10(m) < 3.5 && places.at(i) * m <= FAN) { pushLevel(0, 1n); break; }
    if (m > FAN) {
      // Inside a digit too big for one level: narrow it to runs of its values.
      pushLevel(i, (m + BigInt(NARROW) - 1n) / BigInt(NARROW));
      continue;
    }
    // Finish the open digit (if any) and take whole digits below while they
    // fit: the fan nearest a hundred, preferring one that fills its grid —
    // a short last row reads as missing volumes at every block's end.
    const score = (j, F) => {
      const g = gridFor(F, m === 1n ? i : undefined, j, radices, asp);
      return Math.abs(Math.log(F / FAN_TARGET)) + (g.cols * g.rows === F ? 0 : 0.8);
    };
    let F = Number(m), best = m > 1n ? { j: i, F, score: score(i, F) } : null;
    for (let j = i - 1; j >= 0; j--) {
      F *= Number(radices[j]);
      if (!(F <= FAN_MAX)) break;
      const sc = score(j, F);
      if (!best || sc < best.score) best = { j, F, score: sc };
    }
    if (best) { pushLevel(best.j, 1n); continue; }
    // The next digit down is too big to take whole: open it.
    i -= 1;
    m = radices[i];
  }

  const D = levels.length;
  const sizeAt = l => (l === 0 ? total : places.at(levels[l - 1].ci) * levels[l - 1].cm);
  levels.forEach((lv, l) => Object.defineProperty(lv, 'child', { get: () => sizeAt(l + 1), enumerable: false }));
  const colsRow = levels.map(lv => lv.colsB), rowsRow = levels.map(lv => lv.rowsB);
  const W = lazyProducts(colsRow).view, H = lazyProducts(rowsRow).view;
  const lW = new Float64Array(D + 1);
  for (let l = 0; l < D; l++) lW[l + 1] = lW[l] + Math.log10(levels[l].cols);
  const lvol = new Float64Array(D + 1);
  for (let l = 0; l <= D; l++) {
    const ci = l ? levels[l - 1].ci : R, cm = l ? levels[l - 1].cm : 1n;
    const lg = logPlace[ci] + bigLog10(cm);
    lvol[l] = lg < 14 ? Math.log10(Number(sizeAt(l))) : lg;
  }
  const layout = {
    id, total, levels, aspect, W, H, D, lvol,
    lW,                           // log10 of each level's columns: the depth measure
    sizes: lazyRow(D + 1, sizeAt),
    colsRow, rowsRow,             // each level's grid as BigInts, for the camera's long moves
    blocks: new Map(),            // blockAt's recent answers
    radices
  };
  let spans;
  layout.picks = lazyRow(D, l => {
    if (spans === undefined) spans = spansOf();
    return levelPick(layout, l, spans);
  });
  return layout;
}

/** How oblong a cell may get: a level's grid always brings it back inside this. */
const MAX_SKEW = 2.5;

/**
 * A level's grid, for cells `asp` wide per unit of height. Its rows and
 * columns are chosen so the children come out as square as they can — not
 * the grid itself: a room of binary digits split 16 × 8 at every level halves
 * its cells' width each time, and after a few dozen levels they were
 * thousands of times taller than wide, too thin for the camera ever to reach
 * the next level. When the children are whole digits, the split is between
 * digits — rows from the higher, columns from the lower, so a DFA's two moves
 * read as rows and columns, and a level's children stay in number order.
 * Otherwise the grid that holds them nearest square; the last row may run short.
 */
function gridFor(fan, hiIndex, loIndex, radices, asp = 1, exactly = false) {
  const skewOf = (cols, rows) => Math.abs(Math.log(asp * rows / cols));
  if (hiIndex !== undefined && loIndex !== undefined && hiIndex > loIndex) {
    let best = null;
    for (let k = loIndex; k <= hiIndex; k++) {
      let cols = 1, rows = 1;
      for (let j = loIndex; j < k; j++) cols *= Number(radices[j]);
      for (let j = k; j < hiIndex; j++) rows *= Number(radices[j]);
      const skew = skewOf(cols, rows);
      if (!best || skew < best.skew) best = { cols, rows, skew };
    }
    if (best && best.skew <= Math.log(MAX_SKEW)) return { cols: best.cols, rows: best.rows };
  }
  // Not cut between digits (none fits square enough, or the children are a
  // run of one digit): then a grid the children fill exactly, if one is square
  // enough, since a short last row reads as missing volumes — 1,000 children
  // in a 29 × 35. Never while the walk is choosing how many digits a level
  // takes (`exactly` off): there it would favour levels that cannot be read
  // as rows of one digit and columns of another.
  let exact = null;
  for (let r = 1; exactly && r * r <= fan; r++) {
    if (fan % r) continue;
    for (const [rows, cols] of [[r, fan / r], [fan / r, r]]) {
      const skew = skewOf(cols, rows);
      if (skew <= Math.log(MAX_SKEW) && (!exact || skew < exact.skew)) exact = { cols, rows, skew };
    }
  }
  if (exact) return { cols: exact.cols, rows: exact.rows };
  let rows = Math.min(fan, Math.max(1, Math.round(Math.sqrt(fan / asp))));
  const cols = Math.ceil(fan / rows);
  rows = Math.ceil(fan / cols);
  return { cols, rows };
}

/**
 * What a level decides, named the way the volume page spells a number (q9 · j,
 * F, …): the parts whose digits lie between the level's block size and its
 * children's. `across`/`down` are set when the level is exactly two parts,
 * read as columns and rows. Sizes are compared by digit index: places[k] is
 * below places[i] · m exactly when k < i, or k = i with m > 1.
 */
function levelPick(layout, l, spans) {
  if (!spans) return { names: [], whole: true };
  const { levels, radices } = layout;
  const lv = levels[l];
  const R = radices.length;
  const pi = l ? levels[l - 1].ci : R, pm = l ? levels[l - 1].cm : 1n;
  const below = (k, i, m) => k < i || (k === i && m > 1n);                         // places[k] < places[i]·m
  const above = (k, i, m) => k > i + 1 || (k === i + 1 && i < R && m < radices[i]); // places[k] > places[i]·m
  const inside = spans.filter(t => !below(t.start, lv.ci, lv.cm) && below(t.start, pi, pm));
  const whole = inside.every(t => !above(t.end, pi, pm));
  const open = inside.length ? [] : spans.filter(t => below(t.start, lv.ci, lv.cm) && above(t.end, lv.ci, lv.cm));
  const names = (inside.length ? inside : open).map(t => t.key).reverse();
  let down = null, across = null;
  if (inside.length === 2 && whole) {
    const [low, high] = inside;
    const radixOf = t => radixProduct(radices, t.start, t.end);
    if (Number(radixOf(high)) === lv.rows && Number(radixOf(low)) === lv.cols) { down = high.key; across = low.key; }
  }
  return { names, whole: whole && inside.length > 0, down, across };
}

/** A grid coordinate as a key: decimal while short, hex once long (a long decimal is slow to write). */
export function coordKey(v) {
  return v < 1n << 512n ? v.toString() : `x${v.toString(16)}`;
}

const BLOCKS_KEPT = 384;   // blockAt's answers kept per layout
const CLIMB = 48;          // how far up blockAt looks for a block it already knows

/**
 * The block under level-l grid cell (X, Y): its run [lo, hi) of volumes, or
 * null past the room. Recent answers are kept, so a cell whose parent (or a
 * near ancestor) was asked for is a step or two down from it: walking down
 * from the top every time costs a long multiply per level, which at the bottom
 * of a room 100,000 levels deep is seconds a call.
 */
export function blockAt(layout, l, X, Y) {
  if (X < 0n || Y < 0n || X >= layout.W[l] || Y >= layout.H[l]) return null;
  if (l === 0) return { lo: 0n, hi: layout.total };
  const memo = layout.blocks;
  const hit = memo.get(`${l}|${coordKey(X)}|${coordKey(Y)}`);
  if (hit) return hit;
  // Look a little way up for an ancestor already known.
  const chain = [];
  let a = l, ax = X, ay = Y, from = null;
  while (a > 0 && chain.length < CLIMB) {
    chain.push([ax, ay]);
    const lv = layout.levels[a - 1];
    ax /= lv.colsB; ay /= lv.rowsB; a--;
    from = a === 0 ? { lo: 0n, hi: layout.total } : memo.get(`${a}|${coordKey(ax)}|${coordKey(ay)}`);
    if (from) break;
  }
  if (!from) return blockFromTop(layout, l, X, Y);
  let { lo, hi } = from;
  for (let k = chain.length - 1; k >= 0; k--) {
    const [cx, cy] = chain[k];
    const lv = layout.levels[a];
    const idx = Number(cy % lv.rowsB) * lv.cols + Number(cx % lv.colsB);
    const child = lv.child;
    const start = lo + BigInt(idx) * child;
    if (start >= hi) return null;
    lo = start;
    hi = start + child < hi ? start + child : hi;
    a++;
    keepBlock(memo, `${a}|${coordKey(cx)}|${coordKey(cy)}`, { lo, hi });
  }
  return { lo, hi };
}

function keepBlock(memo, key, block) {
  if (memo.size >= BLOCKS_KEPT) memo.delete(memo.keys().next().value);
  memo.set(key, block);
}

// No ancestor known: the cell's index at every level, bottom up, then the walk
// down — keeping the last few blocks, which the next cell over will ask for.
function blockFromTop(layout, l, X, Y) {
  const cx = new Array(l), cy = new Array(l), at = new Map();
  for (let i = l - 1; i >= 0; i--) {
    const lv = layout.levels[i];
    if (l - i <= 4) at.set(i + 1, [X, Y]);
    cx[i] = Number(X % lv.colsB); cy[i] = Number(Y % lv.rowsB);
    X /= lv.colsB; Y /= lv.rowsB;
  }
  let lo = 0n, hi = layout.total;
  for (let i = 0; i < l; i++) {
    const lv = layout.levels[i];
    const child = lv.child;
    const start = lo + BigInt(cy[i] * lv.cols + cx[i]) * child;
    if (start >= hi) return null;
    lo = start;
    hi = start + child < hi ? start + child : hi;
    const c = at.get(i + 1);
    if (c) keepBlock(layout.blocks, `${i + 1}|${coordKey(c[0])}|${coordKey(c[1])}`, { lo, hi });
  }
  return { lo, hi };
}

/** The level-l cell holding a volume: the inverse of blockAt. */
export function cellOfVolume(layout, volume, l = layout.D) {
  let X = 0n, Y = 0n, lo = 0n;
  const v = BigInt(volume);
  for (let i = 0; i < l; i++) {
    const lv = layout.levels[i];
    const idx = Number((v - lo) / lv.child);
    X = X * lv.colsB + BigInt(idx % lv.cols);
    Y = Y * lv.rowsB + BigInt(Math.floor(idx / lv.cols));
    lo += BigInt(idx) * lv.child;
  }
  return { X, Y };
}

// ── Reading ────────────────────────────────────────────────────────

/** The machines a level-l cell is coloured by, in the order the map draws them. */
export function samplesOf(layout, l, X, Y, block, count) {
  if (block.hi - block.lo === 1n) return [block.lo];
  const below = seededBelow(`${layout.id}|${l}|${coordKey(X)}|${coordKey(Y)}`);
  return Array.from({ length: count }, () => block.lo + below(block.hi - block.lo));
}

/** r's digits in base b, low first, into out[lo … hi): halves split by b^half, short runs peeled. */
function baseDigits(out, r, b, lo, hi) {
  if (hi - lo <= 32) {
    for (let i = lo; i < hi; i++) { out[i] = Number(r % b); r /= b; }
    return;
  }
  const mid = (lo + hi) >> 1;
  const P = b ** BigInt(mid - lo);
  baseDigits(out, r % P, b, lo, mid);
  baseDigits(out, r / P, b, mid, hi);
}

/**
 * A room's classifier for the map: volume → index into cellClassesOf(wing),
 * or UNKNOWN. A DFA is decoded straight into flat arrays — its number is the
 * accept bits, then δ in base n — and classed by flatLanguageClass; every
 * other wing goes through classifyBody.
 */
export function mapClassifier(wing, params) {
  const keys = cellClassesOf(wing).map(c => c.key);
  const indexOf = k => { const i = keys.indexOf(k); return i < 0 ? UNKNOWN : i; };
  const shape = roomShape(wing, params);
  const [n, k] = params;
  if (wing.type === 'DFA' && n >= 2) {
    const cls = flatLanguageClass(n, k);
    const ix = { e: indexOf('e'), u: indexOf('u'), f: indexOf('f'), c: indexOf('f'), o: indexOf('o') };
    const N = BigInt(n), mask = (1n << N) - 1n, m = n * k;
    const delta = n <= 255 ? new Uint8Array(m) : new Int32Array(m), acc = new Uint8Array(n);
    // δ's digits in base n: through toString where a base that big exists
    // (36), else split in halves like the shape engine — the generic path
    // built the whole document per sample, a second a tile in a 100-state room.
    const readDelta = n <= 36
      ? r => {
        const s = r.toString(n);
        for (let i = 0; i < m; i++) {
          const c = i < s.length ? s.charCodeAt(s.length - 1 - i) : 48;
          delta[i] = c <= 57 ? c - 48 : c - 87;
        }
      }
      : r => baseDigits(delta, r, N, 0, m);
    // A tile's volumes are a run of consecutive numbers, and at the bottom of
    // the room they differ only in F, the low digits: δ is decoded once for
    // them all, not once each (512 decodes a tile in a 100-state room).
    let lastHigh = null;
    return v => {
      const bits = (v & mask).toString(2);
      for (let q = 0; q < n; q++) acc[q] = q < bits.length && bits.charCodeAt(bits.length - 1 - q) === 49 ? 1 : 0;
      const high = v >> N;
      if (high !== lastHigh) { readDelta(high); lastHigh = high; }
      return ix[cls(delta, acc)];
    };
  }
  return v => {
    try { return indexOf(classifyBody(wing, params, valueAt(shape, v).value)); } catch { return UNKNOWN; }
  };
}

/**
 * One tile: the cols × rows children of level-a block (TX, TY), each read
 * `samples` times (once at the bottom level, where a cell is one volume).
 * Samples are sorted, so a cell drawn as stripes reads as a small census.
 */
export function readTile(layout, a, TX, TY, classify, samples) {
  const lv = layout.levels[a];
  const n = lv.cols * lv.rows;
  const spp = a === layout.D - 1 ? 1 : samples;
  const cells = new Uint8Array(n * spp).fill(VOID);
  const parent = blockAt(layout, a, TX, TY);
  if (!parent) return { cells, spp, lo: null, hi: null };
  const got = new Array(spp);
  for (let i = 0; i < n; i++) {
    const lo = parent.lo + BigInt(i) * lv.child;
    if (lo >= parent.hi) break;
    const hi = lo + lv.child < parent.hi ? lo + lv.child : parent.hi;
    const X = TX * lv.colsB + BigInt(i % lv.cols), Y = TY * lv.rowsB + BigInt(Math.floor(i / lv.cols));
    const vols = samplesOf(layout, a + 1, X, Y, { lo, hi }, spp);
    for (let s = 0; s < spp; s++) got[s] = classify(vols[s]);
    if (spp > 1) got.sort((x, y) => x - y);
    for (let s = 0; s < spp; s++) cells[i * spp + s] = got[s];
  }
  // The block's run comes back with its cells: the page finds a cell's volumes
  // from it, rather than walking down from the top of a deep room itself.
  return { cells, spp, lo: parent.lo, hi: parent.hi };
}

// ── An endless room's shelf ────────────────────────────────────────

/**
 * The volumes an endless room's size is coloured by on its shelf: `count`
 * drawn from that size, seeded by the room and the size, as room numbers. The
 * shelf is the endless room's top level — one cell a size — and the page shows
 * the same volumes in its reading pane as the worker classified.
 */
export function stripSamples(wing, params, s, count) {
  const shape = roomShape(wing, params);
  const c = shape.count(s);
  if (!(c > 0n)) return [];
  const base = volumesBefore(shape, s);
  if (c === 1n) return [base];
  const below = seededBelow(`${roomId(wing, params)}|size|${s}`);
  return Array.from({ length: count }, () => base + below(c));
}

/** The shelf's sizes from … from + n − 1, read `samples` machines each (sorted, as a tile's cells are). */
export function readStrip(wing, params, from, n, classify, samples) {
  const cells = new Uint8Array(n * samples).fill(VOID);
  for (let i = 0; i < n; i++) {
    const vols = stripSamples(wing, params, from + i, samples);
    if (!vols.length) continue;
    const got = vols.map(v => classify(v)).sort((x, y) => x - y);
    for (let k = 0; k < samples; k++) cells[i * samples + k] = got[Math.min(k, got.length - 1)];
  }
  return { cells, spp: samples };
}

/** The most common class among a cell's samples; ties go to the class listed first. */
export function majorityOf(cells, i, spp) {
  if (spp === 1) return cells[i];
  let best = VOID, bestN = 0, run = 0;
  for (let s = 0; s < spp; s++) {
    const k = cells[i * spp + s];
    run = s && cells[i * spp + s - 1] === k ? run + 1 : 1;
    if (k !== VOID && run > bestN) { best = k; bestN = run; }
  }
  return best;
}

// ── The camera ─────────────────────────────────────────────────────

function floorDiv(a, b) {
  const q = a / b;
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q;
}

const cellH = (layout, L, s) => s / layout.aspect[L];
const minDim = (layout, L, s) => Math.min(s, cellH(layout, L, s));

/**
 * The level-1 cell width at which the whole room fits the view — clear of
 * `view.inset` px at each side, which is where the painter puts its rail.
 */
function fitScale(layout, view) {
  const asp = layout.aspect[1];
  const w = Math.max(40, view.w - 2 * (view.inset || 0));
  const fit = 0.94 * Math.min(w / Number(layout.W[1]), (view.h * asp) / Number(layout.H[1]));
  return Math.max(fit, MAP_FLOOR * Math.max(1, asp));
}

/**
 * The smallest cell width at level L: the whole room, fitted. The fitted room
 * is often drawn a level or two down (its level-1 cells are large enough to
 * show their children), so the limit has to hold at every level, not only at
 * level 1 — held there alone, zooming out from the whole room went past it
 * and snapped back.
 */
function minScaleAt(layout, view, L) {
  // fitScale over the columns of levels 1 … L−1, by their logs: a loop over
  // them ran on every step of normalize, quadratic in a deep room's depth.
  return fitScale(layout, view) * 10 ** (layout.lW[1] - layout.lW[L]);
}

function maxScale(layout) {
  return MAP_MAX_CELL * Math.min(1, layout.aspect[layout.D]);
}

export function makeCamera(layout, view) {
  const cam = { L: 1, AX: 0n, AY: 0n, ox: 0, oy: 0, s: 1 };
  fitCamera(cam, layout, view);
  return cam;
}

/** The whole room, centred. */
export function fitCamera(cam, layout, view) {
  const W = layout.W[1], H = layout.H[1];
  cam.L = 1;
  cam.AX = W / 2n; cam.ox = W % 2n ? 0.5 : 0;
  cam.AY = H / 2n; cam.oy = H % 2n ? 0.5 : 0;
  cam.s = fitScale(layout, view);
  normalize(cam, layout, view);
}

export function normalize(cam, layout, view) {
  const { levels, D } = layout;
  leap(cam, layout, view);
  for (let guard = 0; guard < 4 * D + 16; guard++) {
    const ix = Math.floor(cam.ox), iy = Math.floor(cam.oy);
    if (ix) { cam.AX += BigInt(ix); cam.ox -= ix; }
    if (iy) { cam.AY += BigInt(iy); cam.oy -= iy; }
    cam.s = Math.max(cam.s, minScaleAt(layout, view, cam.L));
    if (cam.L === D) cam.s = Math.min(cam.s, maxScale(layout));
    if (cam.L < D && minDim(layout, cam.L + 1, cam.s / levels[cam.L].cols) >= MAP_FLOOR) {
      const { cols, rows, colsB, rowsB } = levels[cam.L];
      const fx = cam.ox * cols, fy = cam.oy * rows;
      const gx = Math.min(cols - 1, Math.floor(fx)), gy = Math.min(rows - 1, Math.floor(fy));
      cam.AX = cam.AX * colsB + BigInt(gx); cam.AY = cam.AY * rowsB + BigInt(gy);
      cam.ox = fx - gx; cam.oy = fy - gy;
      cam.s /= cols; cam.L++;
    } else if (cam.L > 1 && minDim(layout, cam.L, cam.s) < MAP_FLOOR) {
      const { cols, rows, colsB, rowsB } = levels[cam.L - 1];
      const px = floorDiv(cam.AX, colsB), py = floorDiv(cam.AY, rowsB);
      cam.ox = (Number(cam.AX - px * colsB) + cam.ox) / cols;
      cam.oy = (Number(cam.AY - py * rowsB) + cam.oy) / rows;
      cam.AX = px; cam.AY = py; cam.s *= cols; cam.L--;
    } else break;
  }
  // Keep the centre over the room.
  const W = layout.W[cam.L], H = layout.H[cam.L];
  if (cam.AX < 0n) { cam.AX = 0n; cam.ox = 0; }
  if (cam.AY < 0n) { cam.AY = 0n; cam.oy = 0; }
  if (cam.AX >= W) { cam.AX = W - 1n; cam.ox = 0.999999; }
  if (cam.AY >= H) { cam.AY = H - 1n; cam.oy = 0.999999; }
}

const LEAP_FROM = 24;           // levels: closer than this, normalize walks
const SCALE = 2n ** 53n;

/**
 * A move across many levels at once — the rail dragged from top to bottom, a
 * long fly — in one step. normalize walks a level at a time, multiplying or
 * dividing the camera's cell by a level's grid each step, which in a room
 * 90,000 levels deep is 90,000 operations on numbers as long as its volumes
 * (nine seconds back to the top). The walk's arithmetic on the scale is done
 * in floats to find where it ends, the cell is moved there by the product of
 * the grids between, and normalize finishes the last few levels as before.
 */
function leap(cam, layout, view) {
  const { levels, D } = layout;
  // Where the walk ends, and the scale it carries at each level on the way.
  let L = cam.L, s = cam.s;
  const path = [];
  for (let guard = 0; guard < 4 * D + 16; guard++) {
    s = Math.max(s, minScaleAt(layout, view, L));
    if (L === D) s = Math.min(s, maxScale(layout));
    if (L < D && minDim(layout, L + 1, s / levels[L].cols) >= MAP_FLOOR) { s /= levels[L].cols; L++; }
    else if (L > 1 && minDim(layout, L, s) < MAP_FLOOR) { s *= levels[L - 1].cols; L--; }
    else break;
    path.push(s);
  }
  if (path.length <= LEAP_FROM) return;
  // Land a few levels short of the end, and let the walk do the rest exactly.
  const steps = path.length - 8;
  const target = cam.L + (L > cam.L ? steps : -steps);
  const s2 = path[steps - 1];
  if (target > cam.L) {
    const Wr = radixProduct(layout.colsRow, cam.L, target), Hr = radixProduct(layout.rowsRow, cam.L, target);
    const fx = BigInt(Math.floor(cam.ox * 2 ** 53)) * Wr, fy = BigInt(Math.floor(cam.oy * 2 ** 53)) * Hr;
    cam.AX = cam.AX * Wr + fx / SCALE; cam.ox = Number(fx % SCALE) / 2 ** 53;
    cam.AY = cam.AY * Hr + fy / SCALE; cam.oy = Number(fy % SCALE) / 2 ** 53;
  } else {
    const Wr = radixProduct(layout.colsRow, target, cam.L), Hr = radixProduct(layout.rowsRow, target, cam.L);
    const up = (A, o, R) => {
      const P = floorDiv(A, R);
      return [P, Number(((A - P * R) * SCALE) / R) / 2 ** 53 + o / Number(R)];
    };
    [cam.AX, cam.ox] = up(cam.AX, cam.ox, Wr);
    [cam.AY, cam.oy] = up(cam.AY, cam.oy, Hr);
  }
  cam.L = target;
  cam.s = s2;
}

/** Zoom by `factor` about a point of the view, which stays where it is. */
export function zoomAt(cam, layout, view, factor, px, py) {
  const dx = (px - view.w / 2) / cam.s, dy = (py - view.h / 2) / cellH(layout, cam.L, cam.s);
  cam.ox += dx * (1 - 1 / factor);
  cam.oy += dy * (1 - 1 / factor);
  cam.s *= factor;
  normalize(cam, layout, view);
}

export function panBy(cam, layout, view, dx, dy) {
  cam.ox -= dx / cam.s;
  cam.oy -= dy / cellH(layout, cam.L, cam.s);
  normalize(cam, layout, view);
}

/** How deep the view is, as one number across levels: log10 of volumes per square CSS pixel. */
export function depthOf(cam, layout) {
  return -(layout.lW[cam.L] + Math.log10(cam.s));
}

/**
 * The depths of the whole room and of the largest single volume. Depth is
 * minus log10 of the room's width on screen, so it falls by one per tenfold
 * zoom and is the same either side of a level change. (Volumes per pixel is
 * not: a level whose grid has empty cells — 46 children in 7 × 7 — would
 * jump at every hand-over, and the rail's thumb with it.)
 */
export function depthRange(layout, view) {
  return {
    top: -(layout.lW[1] + Math.log10(fitScale(layout, view))),
    bottom: -(layout.lW[layout.D] + Math.log10(maxScale(layout)))
  };
}

/** The depth at which level l's cells reach the floor: where the rail marks the level. */
export function levelDepth(layout, l) {
  return -(layout.lW[l] + Math.log10(MAP_FLOOR * Math.max(1, layout.aspect[l])));
}

/** Screen geometry of the current level. */
export function screenOf(cam, layout, view) {
  const ch = cellH(layout, cam.L, cam.s);
  return {
    cw: cam.s, ch,
    x: X => view.w / 2 + (Number(X - cam.AX) - cam.ox) * cam.s,
    y: Y => view.h / 2 + (Number(Y - cam.AY) - cam.oy) * ch
  };
}

/** The current level's cell under a point of the view. */
export function cellAt(cam, layout, view, px, py) {
  const ch = cellH(layout, cam.L, cam.s);
  return {
    X: cam.AX + BigInt(Math.floor(cam.ox + (px - view.w / 2) / cam.s)),
    Y: cam.AY + BigInt(Math.floor(cam.oy + (py - view.h / 2) / ch))
  };
}

/** The current level's cells in view, clamped to the room. */
export function visibleCells(cam, layout, view) {
  const ch = cellH(layout, cam.L, cam.s);
  const W = layout.W[cam.L], H = layout.H[cam.L];
  const clamp = (v, hi) => (v < 0n ? 0n : v > hi ? hi : v);
  return {
    X0: clamp(cam.AX + BigInt(Math.floor(cam.ox - view.w / 2 / cam.s)), W - 1n),
    X1: clamp(cam.AX + BigInt(Math.ceil(cam.ox + view.w / 2 / cam.s)), W - 1n),
    Y0: clamp(cam.AY + BigInt(Math.floor(cam.oy - view.h / 2 / ch)), H - 1n),
    Y1: clamp(cam.AY + BigInt(Math.ceil(cam.oy + view.h / 2 / ch)), H - 1n)
  };
}

/** The tiles that draw the current level: its parents' blocks in view, with their screen rectangles. */
export function visibleTiles(cam, layout, view) {
  const a = cam.L - 1, lv = layout.levels[a];
  const { X0, X1, Y0, Y1 } = visibleCells(cam, layout, view);
  const sc = screenOf(cam, layout, view);
  const out = [];
  for (let TY = Y0 / lv.rowsB; TY <= Y1 / lv.rowsB; TY++) {
    for (let TX = X0 / lv.colsB; TX <= X1 / lv.colsB; TX++) {
      out.push({ a, TX, TY, key: `${a}|${coordKey(TX)}|${coordKey(TY)}`, x: sc.x(TX * lv.colsB), y: sc.y(TY * lv.rowsB), w: lv.cols * sc.cw, h: lv.rows * sc.ch });
    }
  }
  return out;
}
