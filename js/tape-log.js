// ══════════════════════════════════════════════════════════════════
//  THE TAPE LOG — what a step changed, rather than what it looked like
// ══════════════════════════════════════════════════════════════════
// A tape machine's step used to carry a full copy of the tape window, twice
// over: `step.tape` from snapshot() and `step.view.cells` from view(), which
// calls snapshot() again. That is O(steps × window) memory, and the window is
// how far the head has travelled — so a machine that walks off down its tape
// costs the square of its run. Measured at the default maxTmSteps of 10,000:
// **921 MB**, reachable with default settings, because a head crossing fresh
// blank tape never repeats a configuration and so the loop detector never
// fires. A machine whose head stays in a small region cost 11 MB, which is why
// this went unnoticed — the pathological case is exactly the runaway machine a
// teaching tool gets pointed at on purpose.
//
// The observation that fixes it: **the tracker only ever draws one step**. So
// nothing needs a stored tape per step. This module keeps the initial cells,
// and per step the head position and the single cell that step wrote — about
// 50 bytes against ~96,000 — and rebuilds the window for whichever step is
// being looked at. The same run measures ~0.6 MB.
//
// **There are no checkpoints, deliberately.** Replay is a Map.set per step, so
// rebuilding step 10,000 from scratch is well under a millisecond; and the
// cursor below means playing forward — the common case by far — applies one
// write per step rather than replaying anything. Checkpoints would have bought
// a bounded backward scrub at the cost of a periodic full Map clone, which is
// most of the memory this exists to avoid.
//
// Import-free. A log is a journal of writes against a window rule; it has no
// business knowing about App, the page, or which machine is driving the tape.

/**
 * @param tape the live Tape the steps will be produced from, read once for its
 *        initial cells and the rules that decide its window.
 */
export function makeTapeLog(tape) {
  const blank = tape.blank;
  const twoWay = tape.twoWay;
  const rightBound = tape.rightBound;
  const markers = tape.immutable ? [...tape.immutable] : [];
  const initial = new Map(tape.cells);

  // Three parallel arrays rather than an object per step: a run is tens of
  // thousands of these and an object header each is most of what they weigh.
  const heads = [];   // absolute head position at the start of step i
  const wCell = [];   // the cell step i wrote, or undefined if it wrote none
  const wSym = [];    // what that cell holds afterwards; undefined means deleted

  // One entry, because one step is displayed at a time and every reader of a
  // step (its tape, its head, its view) asks about the same one. `cells` is the
  // tape as it stands *before* step `i`, which is what step i shows.
  let cache = null;

  function apply(cells, k) {
    const c = wCell[k];
    if (c === undefined) return;
    if (wSym[k] === undefined) cells.delete(c);
    else cells.set(c, wSym[k]);
  }

  function cellsAt(i) {
    let cells, from;
    if (cache && cache.i <= i) { cells = cache.cells; from = cache.i; }
    else { cells = new Map(initial); from = 0; }
    for (let k = from; k < i; k++) apply(cells, k);
    return cells;
  }

  /** The drawn window for step i: its cells, the head's index within them, and
   *  which absolute cell the window starts at. */
  function frameAt(i) {
    if (cache && cache.i === i && cache.frame) return cache.frame;
    const cells = cellsAt(i);
    const head = heads[i] ?? 0;

    // The same window rule as Tape.snapshot(), written without the spread —
    // `Math.min(head, ...keys)` on a tape this module exists to make large is
    // an argument list the engine has a limit on.
    let lo = 0;
    if (twoWay) {
      lo = head;
      for (const k of cells.keys()) if (k < lo) lo = k;
    }
    let hi;
    if (rightBound !== null) hi = rightBound;
    else {
      hi = head > lo ? head : lo;
      for (const k of cells.keys()) if (k > hi) hi = k;
    }

    const arr = [];
    for (let x = lo; x <= hi; x++) arr.push(cells.has(x) ? cells.get(x) : blank);
    const frame = { tape: arr, head: head - lo, origin: lo };
    cache = { i, cells, frame };
    return frame;
  }

  return {
    /** Open step i. Returns its index, which is what a step is addressed by. */
    begin(head) {
      const i = heads.length;
      heads.push(head);
      wCell.push(undefined);
      wSym.push(undefined);
      return i;
    },

    /**
     * Record what step i left in the cell it wrote.
     *
     * The *resulting content* rather than the intended symbol, so a write the
     * tape refused (an LBA's end markers) and a blank write (which deletes the
     * cell rather than storing a blank) both replay to exactly what happened.
     */
    noteWrite(i, cell, cells) {
      wCell[i] = cell;
      wSym[i] = cells.has(cell) ? cells.get(cell) : undefined;
    },

    frameAt,

    viewAt(i) {
      const f = frameAt(i);
      return {
        kind: 'tape',
        // The same array the step's own `tape` is, not a second copy of it —
        // which is the other half of the old cost. Nothing mutates either;
        // every reader copies first if it needs to.
        cells: f.tape,
        head: f.head,
        origin: f.origin,
        leftBound: twoWay ? null : 0,
        rightBound,
        markers,
        blank,
        readOnly: false
      };
    }
  };
}

// A step's tape, head and view are derived rather than stored, and they come
// off a shared prototype rather than being defined per object — accessors
// installed one instance at a time would cost more than the arrays they save.
const TAPE_STEP = {
  get tape() { return this._log.frameAt(this._i).tape; },
  get head() { return this._log.frameAt(this._i).head; },
  get view() { return this._log.viewAt(this._i); }
};

const MULTI_TAPE_STEP = {
  get tapes() { return this._logs.map(l => l.frameAt(this._i).tape); },
  get heads() { return this._logs.map(l => l.frameAt(this._i).head); },
  get views() { return this._logs.map(l => l.viewAt(this._i)); }
};

/**
 * A step over one tape. `fields` carries everything that is genuinely per-step
 * — state, tokens, the transition taken, the note — and deliberately not
 * `tape`, `head` or `view`, which are reads of the log and would throw on
 * assignment because the prototype gives them no setter.
 */
export function tapeStep(log, i, fields) {
  const s = Object.create(TAPE_STEP);
  s._log = log;
  s._i = i;
  return Object.assign(s, fields);
}

/** The same, for a machine whose k tapes advance in lockstep and so share i. */
export function multiTapeStep(logs, i, fields) {
  const s = Object.create(MULTI_TAPE_STEP);
  s._logs = logs;
  s._i = i;
  return Object.assign(s, fields);
}
