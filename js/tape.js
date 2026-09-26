// ══════════════════════════════════════════════════════════════════
//  THE TAPE
// ══════════════════════════════════════════════════════════════════
//  Where the head may go is a property of the *tape*, not of the
//  machine driving it. Determinism, tape count and end markers are
//  already independent axes; whether cell −1 exists is a fourth, and
//  it was the one with nowhere to live — so it was written out three
//  times as `if (head < 0) head = 0`, once per simulator, and the two
//  nondeterministic ones got a fourth copy in their config key.
//
//  That clamp is not a tape model. A bounded-left tape should refuse
//  to move left, or halt; re-reading cell 0 forever is neither, and
//  since the loop detector then calls it a rejection, a machine that
//  scans off the front of its input is decided *wrongly* rather than
//  refused. JFLAP's tape is two-way infinite, so every Turing machine
//  imported from a .jff hit exactly that.
//
//  So the tape is an object with the boundedness inside it, and the
//  simulators move a head without knowing which kind they hold. One
//  implementation serves all three: cells live in a Map keyed by
//  integer, which has no least index; a bounded tape is that Map plus a
//  floor at 0; and an LBA's is that plus a ceiling and two cells that
//  refuse to be written.
//
//  `move()` and `write()` *report* a refusal rather than acting on one,
//  because the callers disagree about what it means — a bounded TM
//  re-reads the cell and carries on, an LBA rejects. Baking one answer
//  into the tape would just move the old duplication somewhere new.
//
//  This module imports nothing so it stays a leaf, and takes `blank`
//  as an argument rather than reading `App.config` — a tape is worth
//  testing without a machine around it.
// ══════════════════════════════════════════════════════════════════

// ── the fingerprint's arithmetic ───────────────────────────────────
// Two primes below 2^31, and a multiply that stays exact in a double: split
// the second factor into 16-bit halves so no partial product passes 2^47.
const FP_M1 = 2147483647, FP_M2 = 2147483629;
const FP_B1 = 911382323, FP_B2 = 972663749;

function mulmod(a, b, m) {
  return (((a * Math.floor(b / 65536)) % m) * 65536 + a * (b % 65536)) % m;
}

function powmod(b, e, m) {
  let r = 1;
  b %= m;
  while (e > 0) {
    if (e % 2 === 1) r = mulmod(r, b, m);
    b = mulmod(b, b, m);
    e = Math.floor(e / 2);
  }
  return r;
}

// B^pos for both moduli, pos any integer (a two-way tape has negative cells):
// by Fermat, B^(m-1) = 1, so the exponent is taken mod m-1.
const powCache = new Map();
function posPow(pos) {
  let hit = powCache.get(pos);
  if (hit) return hit;
  if (powCache.size > 65536) powCache.clear();
  const e1 = ((pos % (FP_M1 - 1)) + (FP_M1 - 1)) % (FP_M1 - 1);
  const e2 = ((pos % (FP_M2 - 1)) + (FP_M2 - 1)) % (FP_M2 - 1);
  hit = [powmod(FP_B1, e1, FP_M1), powmod(FP_B2, e2, FP_M2)];
  powCache.set(pos, hit);
  return hit;
}

const symCache = new Map();
function symHash(sym) {
  let hit = symCache.get(sym);
  if (hit) return hit;
  let h = 2166136261;
  for (let i = 0; i < sym.length; i++) h = Math.imul(h ^ sym.charCodeAt(i), 16777619) >>> 0;
  const g = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  hit = [1 + (h % (FP_M1 - 1)), 1 + (g % (FP_M2 - 1))];
  symCache.set(sym, hit);
  return hit;
}

// Add (sign 1) or remove (sign -1) one cell's term. A cell holding the blank
// contributes nothing, exactly as it reads in key().
function fpCell(fp, pos, sym, blank, sign) {
  if (sym === blank) return;
  const s = symHash(String(sym));
  const p = posPow(pos);
  const t1 = mulmod(s[0], p[0], FP_M1);
  const t2 = mulmod(s[1], p[1], FP_M2);
  fp.h1 = sign > 0 ? (fp.h1 + t1) % FP_M1 : (fp.h1 - t1 + FP_M1) % FP_M1;
  fp.h2 = sign > 0 ? (fp.h2 + t2) % FP_M2 : (fp.h2 - t2 + FP_M2) % FP_M2;
}

// The leftmost stored cell, stored blanks included — snapshot() counts them.
function leastKey(cells) {
  let min = Infinity;
  for (const k of cells.keys()) if (k < min) min = k;
  return min;
}

export class Tape {
  /**
   * @param {string[]} tokens  initial cells, laid down from index 0
   * @param {string}   blank   the symbol an unwritten cell reads as
   * @param {boolean}  twoWay  false floors the head at cell 0
   * @param {{rightBound?: number|null, immutable?: Set<string>|null}} opts
   *        `rightBound` caps the tape on the right as well — the LBA, whose
   *        tape is exactly its input between two end markers. `immutable`
   *        names symbols that cannot be overwritten, which is what makes
   *        those markers markers.
   */
  constructor(tokens = [], blank = '⊔', twoWay = false, opts = {}) {
    this.blank = blank;
    this.twoWay = !!twoWay;
    this.rightBound = opts.rightBound ?? null;
    this.immutable = opts.immutable || null;
    this.head = 0;
    this.cells = new Map();
    tokens.forEach((sym, i) => this.cells.set(i, sym));
  }

  read() {
    return this.cells.has(this.head) ? this.cells.get(this.head) : this.blank;
  }

  /**
   * @returns {boolean} false when the cell refused the write, which is how
   *          an end marker stays a marker.
   */
  write(sym) {
    if (this.immutable && this.immutable.has(this.read())) return false;
    const fp = this._fp;
    if (fp) {
      const had = this.cells.get(this.head);
      if (had !== undefined) fpCell(fp, this.head, had, this.blank, -1);
    }
    // A blank is the absence of a cell, not a cell holding a blank, or a
    // tape scrubbed back to empty would keep every cell it ever touched
    // and no two such configurations would ever compare equal.
    if (sym === this.blank) this.cells.delete(this.head);
    else this.cells.set(this.head, sym);
    if (fp) {
      if (sym !== this.blank) {
        fpCell(fp, this.head, sym, this.blank, 1);
        if (this.head < fp.min) fp.min = this.head;
      } else if (this.head === fp.min) {
        fp.min = leastKey(this.cells);
      }
    }
    return true;
  }

  /**
   * Keep a fingerprint of `key()` up to date from here on, and return this.
   *
   * `key()` is what the deterministic deciders detect a loop with, and it
   * costs the whole tape: a snapshot of the window, joined into a string, on
   * every step — so deciding a word was quadratic in how far the head
   * travelled. The fingerprint is the same fact kept current in O(1) per
   * write: a polynomial hash of the non-blank cells under two prime moduli,
   * normalised to the left edge of key()'s window so that it is exactly as
   * origin-independent as key() is, plus the head's offset into that window.
   *
   * Equal keys give equal fingerprints. The converse is overwhelmingly likely
   * rather than certain, so a caller that finds a repeat confirms it against
   * key() before believing it — see `makeRepeatDetector` in the TM family.
   */
  trackFingerprint() {
    const fp = { h1: 0, h2: 0, min: leastKey(this.cells) };
    for (const [pos, sym] of this.cells) fpCell(fp, pos, sym, this.blank, 1);
    this._fp = fp;
    return this;
  }

  /** key()'s fingerprint; trackFingerprint() must have been called. */
  fingerprint() {
    const fp = this._fp;
    // The same left edge snapshot() takes: the head or the leftmost stored
    // cell on a two-way tape, cell 0 on a bounded one.
    const lo = this.twoWay ? Math.min(this.head, fp.min) : 0;
    let n1 = fp.h1, n2 = fp.h2;
    if (lo !== 0) {
      const inv = posPow(-lo);
      n1 = mulmod(n1, inv[0], FP_M1);
      n2 = mulmod(n2, inv[1], FP_M2);
    }
    return `${this.head - lo}|${n1}|${n2}`;
  }

  /**
   * Moves the head. 'L'/'R'/'S'; anything else stays put.
   *
   * @returns {boolean} false when the tape refused the move, leaving the
   *          head where it was.
   *
   * What that refusal *means* is the machine's business, not the tape's,
   * and the two callers disagree: a bounded TM shrugs and re-reads the
   * cell, an LBA rejects. That is exactly why this reports rather than
   * decides — the old code baked one answer into each simulator.
   */
  move(dir) {
    const delta = dir === 'R' ? 1 : dir === 'L' ? -1 : 0;
    const next = this.head + delta;
    if (!this.twoWay && next < 0) return false;
    if (this.rightBound !== null && next > this.rightBound) return false;
    this.head = next;
    return true;
  }

  /**
   * The written span as a plain array, plus the head's index into it —
   * what the step-through UI draws and what the config key is built from.
   * A bounded tape always starts its window at cell 0 so the input keeps
   * the position the reader put it in.
   */
  snapshot() {
    const keys = [...this.cells.keys()];
    // A bounded tape's window always starts at cell 0, so the input keeps
    // the position the reader put it in. A two-way tape's starts at
    // whichever is furthest left of the head and the written cells — and
    // pointedly *not* at cell 0, which would anchor the window to an
    // origin the machine cannot see and make key() origin-dependent.
    const lo = this.twoWay ? Math.min(this.head, ...keys) : 0;
    // A right-bounded tape is exactly as long as its bound says, however
    // much of it is currently blank — its length is part of the machine.
    const hi = this.rightBound !== null
      ? this.rightBound
      : Math.max(this.head, ...keys, lo);
    const tape = [];
    for (let i = lo; i <= hi; i++) tape.push(this.cells.has(i) ? this.cells.get(i) : this.blank);
    return { tape, head: this.head - lo, origin: lo };
  }

  /**
   * The window, plus the shape of the tape it is a window *onto*.
   *
   * The snapshot above says what the cells hold; it does not say whether
   * the head could keep going. That is the one fact separating TM from
   * ITM from LBA from a read-only two-way head, and until this existed it
   * was the one fact the tracker could not draw — four different tapes
   * rendered as the same flat row of boxes. It comes from here rather
   * than from a machine-name branch in the renderer for the same reason
   * the clamp does: where the head may go is a property of the tape.
   *
   * Bounds are absolute cell numbers, not window offsets, and `null`
   * means "no wall on this side" — which is what the drawing has to
   * distinguish, since a bounded end and an unbounded one that happens
   * to be blank look identical cell for cell.
   */
  view() {
    const { tape, head, origin } = this.snapshot();
    return {
      kind: 'tape',
      cells: tape,
      head,
      origin,
      leftBound: this.twoWay ? null : 0,
      rightBound: this.rightBound,
      // Symbols, not positions — an end marker is a marker by being
      // unwritable, which is a fact about the symbol here.
      markers: this.immutable ? [...this.immutable] : [],
      blank: this.blank,
      readOnly: false
    };
  }

  /**
   * A string identifying this configuration for loop detection.
   *
   * It is built from the snapshot, so it is *origin-independent*: a
   * two-way tape that has grown leftward renumbers every cell, and a key
   * carrying absolute indices would call two identical configurations
   * different and never detect the loop. Trailing blanks are trimmed for
   * the same reason — a head that ran right over blank tape and came back
   * is in the configuration it started from.
   */
  key() {
    const { tape, head } = this.snapshot();
    let end = tape.length;
    // Only an unbounded tape may trim: there, a trailing blank is tape the
    // head has not reached yet. On a right-bounded one it is a cell the
    // machine wrote a blank into, and trimming would call two different
    // configurations the same.
    if (this.rightBound === null) {
      while (end > head + 1 && tape[end - 1] === this.blank) end--;
    }
    return `${head}|${tape.slice(0, end).join('')}`;
  }

  clone() {
    // Every part of the tape model has to travel, not just the cells — a
    // branch that forgot its bound or its markers would be a different
    // tape from the one it forked off.
    const copy = new Tape([], this.blank, this.twoWay, {
      rightBound: this.rightBound,
      immutable: this.immutable
    });
    copy.cells = new Map(this.cells);
    copy.head = this.head;
    if (this._fp) copy._fp = { ...this._fp };
    return copy;
  }
}

/** Convenience for the multi-tape machine: k tapes, input on the first. */
export function makeTapes(k, tokens, blank, twoWay) {
  return Array.from({ length: k }, (_, i) => new Tape(i === 0 ? tokens : [], blank, twoWay));
}

/** The config key for a whole multi-tape configuration. */
export function tapesKey(state, tapes) {
  return `${state}|${tapes.map(t => t.key()).join('')}`;
}
