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

import { roomId, roomShape } from './wings.js';
import { seededBelow } from './volumes.js';
import { cellClassesOf, classifyBody } from './census.js';
import { flatLanguageClass } from './facts.js';
import { finiteTiles } from './spell.js';
import { valueAt } from './shape.js';

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
export const MAX_LEVELS = 2500;  // the deepest room the map flies through (about 0.25 s to lay out)

/**
 * How many machines colour a block. Five where a volume is decided from its
 * table — finite automata, ω-automata, pushdown automata; one for the rooms
 * whose machines are run (Turing machines), where five would make every screen
 * five times slower to read.
 */
export function samplesFor(wing) {
  return wing.kind === 'tm' ? 1 : 5;
}

/** log10 of a positive BigInt, to a float's precision. */
export function bigLog10(b) {
  const s = BigInt(b).toString();
  return Math.log10(Number(s.slice(0, 15))) + (s.length - Math.min(15, s.length));
}

// ── The layout ─────────────────────────────────────────────────────

const layouts = new Map();

/** A finite room's deep-map layout (cached per room), or null for an endless room. */
export function deepLayout(wing, params) {
  const id = roomId(wing, params);
  let layout = layouts.get(id);
  if (layout) return layout;
  const shape = roomShape(wing, params);
  if (!shape.finite) return null;
  // Building a layout costs the square of its depth (a prefix product per
  // digit, and every level's names against every digit): 0.15 s at 2,000
  // levels, 3 s at 8,000, out of memory at dfa-300-300's 90,000. A room
  // deeper than a reader could fly through takes the census map instead.
  const radices = (shape.radices ? shape.radices() : [shape.total]).map(BigInt).filter(r => r > 1n);
  const depth = radices.reduce((s, r) => s + (r < 1n << 53n ? Math.log10(Number(r)) : bigLog10(r)), 0) / Math.log10(FAN_TARGET);
  if (depth > MAX_LEVELS) return null;
  layout = buildLayout(wing, params, shape, id, radices);
  if (!layout) return null;
  if (layouts.size > 64) layouts.clear();
  layouts.set(id, layout);
  return layout;
}

// `radices` leaves out digits with one value: they say nothing and would make empty levels.
function buildLayout(wing, params, shape, id, radices) {
  const total = shape.total;
  const places = [1n];
  for (const r of radices) places.push(places[places.length - 1] * r);
  const placeIndex = new Map(places.map((p, k) => [p, k]));

  // Block sizes from the top: sizes[0] is the room, sizes[D] is one volume.
  // Each level is laid out as it is chosen, because its grid depends on the
  // shape of the cells it cuts: `asp` is their width over their height.
  const sizes = [total], levels = [], aspect = [1];
  let asp = 1;
  const pushLevel = child => {
    const S = sizes[sizes.length - 1];
    const fan = Number((S + child - 1n) / child);
    const { cols, rows } = gridFor(fan, placeIndex.get(S), placeIndex.get(child), radices, asp);
    levels.push({ cols, rows, child, colsB: BigInt(cols), rowsB: BigInt(rows) });
    asp *= rows / cols;
    aspect.push(asp);
    sizes.push(child);
  };

  // The current block is places[i] · m — whole digits below i, and m values
  // of digit i still open (m = 1 when the block is aligned to a digit).
  let i = radices.length, m = 1n;
  for (let guard = 0; sizes[sizes.length - 1] > 1n && guard < 100000; guard++) {
    const cur = sizes[sizes.length - 1];
    if (cur <= BigInt(FAN_MAX)) { pushLevel(1n); break; }
    if (m > BigInt(FAN_MAX)) {
      // Inside a digit too big for one level: narrow it to runs of its values.
      m = (m + BigInt(NARROW) - 1n) / BigInt(NARROW);
      pushLevel(places[i] * m);
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
    if (best) { i = best.j; m = 1n; pushLevel(places[i]); continue; }
    // The next digit down is too big to take whole: open it.
    i -= 1;
    m = radices[i];
  }
  // A layout that stops short of single volumes would call its last level's
  // blocks volumes. The depth estimate keeps this from happening; if it ever
  // does, there is no deep map rather than a wrong one.
  if (sizes[sizes.length - 1] > 1n) return null;

  const W = [1n], H = [1n];
  levels.forEach((lv, l) => { W.push(W[l] * lv.colsB); H.push(H[l] * lv.rowsB); });
  const layout = {
    id, total, sizes, levels, aspect, W, H,
    D: levels.length,
    lvol: sizes.map(bigLog10),
    lW: W.map(bigLog10),   // log10 of each level's columns: the depth measure
    picks: []
  };
  layout.picks = levelPicks(wing, params, shape, layout);
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
function gridFor(fan, hiIndex, loIndex, radices, asp = 1) {
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
  let rows = Math.min(fan, Math.max(1, Math.round(Math.sqrt(fan / asp))));
  const cols = Math.ceil(fan / rows);
  rows = Math.ceil(fan / cols);
  return { cols, rows };
}

/**
 * What each level decides, named the way the volume page spells a number
 * (q9 · j, F, …): the parts whose digits lie between the level's block size
 * and its children's. `across`/`down` are set when the level is exactly two
 * parts, read as columns and rows.
 */
function levelPicks(wing, params, shape, layout) {
  // Only a wing that names its parts (q9 · j, F) has something to say here:
  // without one, every part is called by its shape ("set"), which tells the
  // reader nothing.
  let tiles = null;
  if (wing.tile) try { tiles = finiteTiles(wing, params, valueAt(shape, 0n).value); } catch { /* unnamed */ }
  return layout.levels.map((lv, l) => {
    const hi = layout.sizes[l], lo = lv.child;
    if (!tiles) return { names: [], whole: true };
    const inside = tiles.filter(t => t.radix > 1n && t.place >= lo && t.place < hi);
    const whole = inside.every(t => t.place * t.radix <= hi);
    const open = inside.length ? [] : tiles.filter(t => t.place < lo && t.place * t.radix > lo);
    const names = (inside.length ? inside : open).map(t => t.key).reverse();
    let down = null, across = null;
    if (inside.length === 2 && whole) {
      const [low, high] = inside;
      if (Number(high.radix) === lv.rows && Number(low.radix) === lv.cols) { down = high.key; across = low.key; }
    }
    return { names, whole: whole && inside.length > 0, down, across };
  });
}

/** The block under level-l grid cell (X, Y): its run [lo, hi) of volumes, or null past the room. */
export function blockAt(layout, l, X, Y) {
  if (X < 0n || Y < 0n || X >= layout.W[l] || Y >= layout.H[l]) return null;
  const cx = new Array(l), cy = new Array(l);
  for (let i = l - 1; i >= 0; i--) {
    const lv = layout.levels[i];
    cx[i] = Number(X % lv.colsB); cy[i] = Number(Y % lv.rowsB);
    X /= lv.colsB; Y /= lv.rowsB;
  }
  let lo = 0n, hi = layout.total;
  for (let i = 0; i < l; i++) {
    const lv = layout.levels[i];
    const start = lo + BigInt(cy[i] * lv.cols + cx[i]) * lv.child;
    if (start >= hi) return null;
    lo = start;
    hi = start + lv.child < hi ? start + lv.child : hi;
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
  const below = seededBelow(`${layout.id}|${l}|${X}|${Y}`);
  return Array.from({ length: count }, () => block.lo + below(block.hi - block.lo));
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
  if (wing.type === 'DFA' && n >= 2 && n <= 36) {
    const cls = flatLanguageClass(n, k);
    const ix = { e: indexOf('e'), u: indexOf('u'), f: indexOf('f'), c: indexOf('f'), o: indexOf('o') };
    const N = BigInt(n), mask = (1n << N) - 1n, m = n * k;
    const delta = new Uint8Array(m), acc = new Uint8Array(n);
    return v => {
      const bits = (v & mask).toString(2);
      for (let q = 0; q < n; q++) acc[q] = q < bits.length && bits.charCodeAt(bits.length - 1 - q) === 49 ? 1 : 0;
      const s = (v >> N).toString(n);
      for (let i = 0; i < m; i++) {
        const c = i < s.length ? s.charCodeAt(s.length - 1 - i) : 48;
        delta[i] = c <= 57 ? c - 48 : c - 87;
      }
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
  if (!parent) return { cells, spp };
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
  return { cells, spp };
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
  let s = fitScale(layout, view);
  for (let i = 1; i < L && s > 0; i++) s /= layout.levels[i].cols;
  return s;
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
      out.push({ a, TX, TY, key: `${a}|${TX}|${TY}`, x: sc.x(TX * lv.colsB), y: sc.y(TY * lv.rowsB), w: lv.cols * sc.cw, h: lv.rows * sc.ch });
    }
  }
  return out;
}
