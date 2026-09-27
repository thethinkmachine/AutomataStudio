// ══════════════════════════════════════════════════════════════════
//  COLUMNS — a long run's per-step numbers, a byte or so apiece
// ══════════════════════════════════════════════════════════════════
// A run of the five-state busy beaver is 47,176,870 steps. Held as a JS object
// per step it kept 250 bytes each — 10.6 GiB, past any tab — and held as plain
// arrays of numbers it is still eight bytes per slot, since an array element is
// a tagged pointer. Almost every number a deterministic tape step records is
// small: a head that moved by one, a symbol out of a handful, a state out of a
// few dozen. So they are stored as typed arrays of the narrowest width that
// holds them, and the step objects are built again when a step is read (see
// js/tape-log.js and js/machines/run.js).
//
// **Chunked, never reallocated.** A reader holds a column by reference while
// the producer is still appending to it — the space-time diagram indexes a
// streaming run as it plays — so growing by copying into a bigger buffer would
// strand whoever held the old one. A chunk list only ever gains chunks, and a
// chunk is small enough that a ten-step run does not pay for a million.
//
// Import-free, like the rest of what js/machines/** reads.

// Exported for the replay loops that walk a column a chunk at a time (see
// `replay` in js/tape-log.js) — the layout is this module's, but a loop that
// asks for one row at a time pays for the asking on every row.
export const BITS = 12;
const SIZE = 1 << BITS;
export const MASK = SIZE - 1;

// Each column class reads its own chunks with its own code, rather than all of
// them sharing one `get`: a typed-array load that sees Int8, Uint8 and Int32
// arrays is polymorphic, and the replay loops that read these are the hottest
// thing a scrub or a space-time diagram does. Measured, the shared version cost
// a backward scrub 75% more than the plain arrays it replaced.

const newChunk = (Type, list) => { const c = new Type(SIZE); list.push(c); return c; };

/**
 * Unsigned codes, stored a byte apiece until one needs more.
 *
 * Widening converts the chunks already written; it happens at most twice in a
 * column's life (8 → 16 → 32 bits), and only on a machine with more than 255
 * states or symbols, so the common case never pays for the check's other arm.
 */
export class CodeColumn {
  constructor() {
    this.Type = Uint8Array;
    this.max = 0xff;
    this.chunks = [];
    this.length = 0;
  }

  push(v) {
    if (v > this.max) this.widen(v);
    const i = this.length++;
    const c = this.chunks[i >>> BITS] || newChunk(this.Type, this.chunks);
    c[i & MASK] = v;
  }

  get(i) { return this.chunks[i >>> BITS][i & MASK]; }

  set(i, v) {
    if (v > this.max) this.widen(v);
    this.chunks[i >>> BITS][i & MASK] = v;
  }

  widen(v) {
    const Type = v <= 0xffff ? Uint16Array : Uint32Array;
    this.chunks = this.chunks.map(c => Type.from(c));
    this.Type = Type;
    this.max = Type === Uint16Array ? 0xffff : 0xffffffff;
  }

  /** What the column holds, in bytes — for the tests and the benchmark. */
  bytes() { return this.chunks.length * SIZE * this.Type.BYTES_PER_ELEMENT; }
}

/**
 * Head positions, as a byte of movement per step.
 *
 * A tape head moves by one or not at all, so the delta from the step before
 * fits a signed byte with room to spare; an absolute position is kept every
 * SPAN steps so a random read replays at most SPAN - 1 deltas. A delta that
 * does not fit — nothing the app produces today, but a head is a number and
 * a producer could jump it — is marked with -128 and kept exactly beside the
 * column.
 *
 * Reads walk from a one-entry cursor, since every reader of a head column walks
 * rows in order (a diagram's viewport, a replay, a measurement).
 */
export const SPAN = 64;
export const JUMP = -128;

export class HeadColumn {
  constructor() {
    this.deltas = [];    // Int8Array chunks
    this.anchors = [];   // Int32Array chunks, one entry per SPAN steps
    this.nAnchors = 0;
    this.jumps = null;
    this.length = 0;
    this.last = 0;
    this.ci = -1;
    this.cv = 0;
  }

  push(v) {
    const i = this.length++;
    const dc = this.deltas[i >>> BITS] || newChunk(Int8Array, this.deltas);
    // The delta is kept at an anchor's row as well, so a forward walk never
    // has to ask which rows are anchors: they are only where a random read
    // starts.
    if (i % SPAN === 0) {
      const a = this.nAnchors++;
      (this.anchors[a >>> BITS] || newChunk(Int32Array, this.anchors))[a & MASK] = v;
    }
    const d = i === 0 ? 0 : v - this.last;
    if (d > JUMP && d <= 127) dc[i & MASK] = d;
    else {
      dc[i & MASK] = JUMP;
      (this.jumps ??= new Map()).set(i, v);
    }
    this.last = v;
  }

  anchor(k) {
    const a = k / SPAN;
    return this.anchors[a >>> BITS][a & MASK];
  }

  /** The head at step k, given the head at step k - 1: one row of a replay. */
  after(k, prev) {
    const d = this.deltas[k >>> BITS][k & MASK];
    return d === JUMP ? this.jumps.get(k) : prev + d;
  }

  get(i) {
    if (i === this.ci + 1 && i < this.length && i > 0) {
      this.cv = this.after(i, this.cv);
      this.ci = i;
      return this.cv;
    }
    if (!(i >= 0 && i < this.length)) return undefined;
    if (i === this.ci) return this.cv;
    if (i === this.length - 1) return this.last;
    const start = i - (i % SPAN);
    // Backwards within a block too, since a reverse scan ("who last wrote this
    // cell?") would otherwise restart from the anchor on every row.
    if (this.ci > i && this.ci - i < i - start && this.ci < start + SPAN && this.jumps === null) {
      let v = this.cv;
      for (let k = this.ci; k > i; k--) v -= this.deltas[k >>> BITS][k & MASK];
      this.ci = i;
      this.cv = v;
      return v;
    }
    let k, v;
    if (this.ci >= start && this.ci < i) { k = this.ci; v = this.cv; }
    else { k = start; v = this.anchor(start); }
    while (k < i) v = this.after(++k, v);
    this.ci = i;
    this.cv = v;
    return v;
  }

  bytes() { return (this.deltas.length + this.anchors.length * 4) * SIZE; }
}

/**
 * A tape as a dense array of codes: `get(x)` is cell x's code, 0 for a cell
 * holding nothing. A byte a cell where a Map of symbols was ~40, a write is a
 * store, and a copy of it is one `slice`.
 *
 * It grows at whichever end a write lands past, with room to spare on that
 * side, so a head walking off down its tape reallocates log(n) times. `lo`..`hi`
 * are the cells ever given a code — a superset of the ones holding one now,
 * since a cell cleared back to 0 does not shrink them; `extent()` finds the
 * exact ends when they are wanted.
 */
const CODE_MAX = [0, 0xff, 0xffff, 0, 0xffffffff];

export class DenseTape {
  constructor() {
    this.buf = new Uint8Array(0);
    this.base = 0;
    this.lo = Infinity;
    this.hi = -Infinity;
  }

  get(x) {
    const i = x - this.base;
    return i >= 0 && i < this.buf.length ? this.buf[i] : 0;
  }

  set(x, code) {
    let i = x - this.base;
    if (i < 0 || i >= this.buf.length) {
      if (code === 0) return;   // clearing a cell that was never given a code
      this.ensure(x, x);
      i = x - this.base;
    }
    if (code > CODE_MAX[this.buf.BYTES_PER_ELEMENT]) this.widen(code);
    this.buf[i] = code;
    if (code !== 0) {
      if (x < this.lo) this.lo = x;
      if (x > this.hi) this.hi = x;
    }
  }

  /** Make cells lo..hi addressable, keeping every code where it is. */
  ensure(lo, hi) {
    const len = this.buf.length;
    if (len && lo >= this.base && hi < this.base + len) return;
    const a = len ? Math.min(this.base, lo) : lo;
    const b = len ? Math.max(this.base + len - 1, hi) : hi;
    const cap = Math.max(64, 2 * (b - a + 1));
    const spare = cap - (b - a + 1);
    // The slack goes on the side that grew: that is where the next write is.
    const grewLeft = len && lo < this.base, grewRight = len && hi >= this.base + len;
    const base = a - (grewLeft ? (grewRight ? spare >> 1 : spare) : 0);
    const buf = new this.buf.constructor(cap);
    if (len) buf.set(this.buf, this.base - base);
    this.buf = buf;
    this.base = base;
  }

  widen(code) {
    const Type = code <= 0xffff ? Uint16Array : Uint32Array;
    this.buf = Type.from(this.buf);
  }

  /** A copy of the cells ever given a code, as `{ row, lo, codes }`. */
  snapshot(row) {
    if (this.lo > this.hi) return { row, lo: 0, codes: new Uint8Array(0) };
    return { row, lo: this.lo, codes: this.buf.slice(this.lo - this.base, this.hi - this.base + 1) };
  }

  /** Become exactly the tape a snapshot was taken of. */
  load(cp) {
    if (this.lo <= this.hi) this.buf.fill(0, this.lo - this.base, this.hi - this.base + 1);
    this.lo = Infinity;
    this.hi = -Infinity;
    const n = cp.codes.length;
    if (!n) return;
    this.ensure(cp.lo, cp.lo + n - 1);
    if (cp.codes.BYTES_PER_ELEMENT > this.buf.BYTES_PER_ELEMENT) this.widen(CODE_MAX[cp.codes.BYTES_PER_ELEMENT]);
    this.buf.set(cp.codes, cp.lo - this.base);
    this.lo = cp.lo;
    this.hi = cp.lo + n - 1;
  }

  /** The first and last cells holding a code, or null for an empty tape. */
  extent() {
    const buf = this.buf, base = this.base;
    let a = this.lo, b = this.hi;
    while (a <= b && buf[a - base] === 0) a++;
    if (a > b) return null;
    while (buf[b - base] === 0) b--;
    return [a, b];
  }

  bytes() { return this.buf.length * this.buf.BYTES_PER_ELEMENT; }
}

/**
 * Values ↔ small codes. Code 0 is reserved and never handed out, so a column
 * of codes can use it for "none" without a second column saying so.
 */
export function makeInterner() {
  const codes = new Map();
  const values = [undefined];
  return {
    /** Code → value, as an array a hot loop can index directly. Live. */
    values,
    code(v) {
      let c = codes.get(v);
      if (c === undefined) { c = values.length; codes.set(v, c); values.push(v); }
      return c;
    },
    value: c => values[c]
  };
}
