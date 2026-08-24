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
    // A blank is the absence of a cell, not a cell holding a blank, or a
    // tape scrubbed back to empty would keep every cell it ever touched
    // and no two such configurations would ever compare equal.
    if (sym === this.blank) this.cells.delete(this.head);
    else this.cells.set(this.head, sym);
    return true;
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
