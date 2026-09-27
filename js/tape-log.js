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
// and per step the head position and the single cell that step wrote, and
// rebuilds the window for whichever step is being looked at.
//
// **And then nothing needs a stored step either.** That fixed the tape and left
// the step: an object per step, its fields, and the closure that formatted its
// note came to 250 bytes, which is 10.6 GiB over the 47 million steps of the
// five-state busy beaver. Everything in those 250 bytes is a small number — a
// head that moved by one, a symbol out of a handful, a state, the transition
// taken — so the log keeps them as byte columns (js/machines/columns.js), and
// `makeStepColumns` below builds a step from them when one is read. The run
// (js/machines/run.js) drops each step object once the next one arrives. BB(5)
// to its halt is now a few bytes a step.
//
// **A jump costs a tape's width, not the run's length.** There used to be no
// checkpoints, deliberately: a copy of the tape was a Map clone, forty bytes a
// cell, and a jump back replayed every write from the start instead — 23
// million of them to reach the middle of BB(5). Now a copy is a byte a cell
// (a DenseTape of codes), so the log keeps cost-spaced checkpoints for about a
// byte a step, and stepping *back* is one write, the same as stepping forward:
// what a cell held before a step wrote it is the symbol that step read. The
// reader's cursor reaches any step by the cheapest of four routes — on from
// where it is, either way, or from the checkpoint either side of the target —
// so playing or scrubbing in either direction costs a write a step, and a jump
// anywhere costs at most about one tape-width of writes.
//
// A leaf: its one import, js/machines/columns.js, is import-free. A log is a
// journal of writes against a window rule; it has no business knowing about
// App, the page, or which machine is driving the tape.

import { BITS, CodeColumn, DenseTape, HeadColumn, JUMP, MASK, makeInterner } from './machines/columns.js';

// A write column's codes: none, a deleted cell, or a symbol's code + 1.
const NO_WRITE = 0;
const DELETED = 1;

// The fewest steps between checkpoints; a wide tape spaces them further — see
// `begin`. Each costs an object as well as its cells, so a floor this high
// keeps a narrow tape's checkpoints to a fraction of a byte a step.
export const CHECKPOINT_MIN = 1024;

// Which way a reader's cursor reaches a step: 'auto' picks the cheapest;
// 'near' goes on from where it is (forwards, or backwards by undoing writes),
// 'before' from the checkpoint before, 'after' backwards from the one after.
//
// Not a debugging leftover, for the reason `setLabelKernel` is not one: 'auto'
// takes whichever route is cheapest, so on a small tape it loads a checkpoint
// where a long run would undo, and the route it passes over is one no test
// would otherwise reach. tests/tape-jumps.test.js forces each in turn and
// holds all four to the same tape.
let jumpRoute = 'auto';

export function setJumpRoute(route) {
  jumpRoute = route === 'near' || route === 'before' || route === 'after' ? route : 'auto';
  return jumpRoute;
}

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

  const syms = makeInterner();
  const vals = syms.values;
  const blankCode = syms.code(blank);
  const heads = new HeadColumn();   // absolute head position at the start of step i
  const reads = new CodeColumn();   // the symbol under it then (0 if not recorded)
  const writes = new CodeColumn();  // what step i left in the cell it wrote — see NO_WRITE
  // The cell a step writes is the one under its head, so it is not stored — a
  // write anywhere else is kept here, exactly, rather than assumed.
  let strayCells = null;

  // ── undoing a step ──────────────────────────────────────────────
  // What a cell held before step i wrote it is, nearly always, what step i
  // read there: the write lands under the head. So stepping *back* is one
  // write, the same as stepping forward, and costs no column of its own. Where
  // the read does not say — a cell holding an explicit blank from the input
  // (the blank is otherwise the absence of a cell), a write away from the head,
  // a producer that did not record its read — the true prior code is kept
  // here, found from the producer's copy of the tape below.
  let undoExceptions = null;

  // ── checkpoints ─────────────────────────────────────────────────
  // The producer's side keeps its own copy of the tape as codes (`live`), one
  // store per write, and at `begin` copies it out when enough steps have gone
  // by — spaced by what a copy costs, the rule the space-time diagram used: the
  // steps since the last checkpoint are at least the cells this one copies. So
  // the copies sum to about a byte a step whatever the tape does, and a jump
  // anywhere replays at most about one tape-width of writes, forward from the
  // checkpoint before it or backward from the one after. The diagram reads the
  // same checkpoints through `journal()`, so opening it copies nothing again.
  const live = new DenseTape();
  for (const [x, v] of initial) live.set(x, syms.code(v));
  const checkpoints = [];
  let nextCheckpoint = 0;

  // ── the reader's copy ───────────────────────────────────────────
  // `cur` is the tape as it stands before step `curI`: what step curI shows.
  // One, because one step is displayed at a time and every reader of a step
  // (its tape, its head, its view, its note) asks about the same one.
  const cur = new DenseTape();
  let curI = -1;
  let frameI = -1, frame = null;
  let replayed = 0;

  // Apply the writes of steps from..to-1. It walks the columns a chunk at a
  // time, so a row is one typed-array load per column, and carries the head
  // along rather than looking it up, since the cell a step wrote is its head.
  function forward(from, to) {
    if (from >= to) return;
    replayed += to - from;
    const stray = strayCells;
    const wChunks = writes.chunks, dChunks = heads.deltas;
    let h = heads.get(from);
    let k = from;
    let wa = wChunks[k >>> BITS], da = dChunks[k >>> BITS];
    for (;;) {
      const w = wa[k & MASK];
      if (w !== NO_WRITE) cur.set(stray !== null && stray.has(k) ? stray.get(k) : h, w === DELETED ? 0 : w - 1);
      if (++k >= to) return;
      if ((k & MASK) === 0) { wa = wChunks[k >>> BITS]; da = dChunks[k >>> BITS]; }
      const d = da[k & MASK];
      h = d === JUMP ? heads.jumps.get(k) : h + d;
    }
  }

  // Undo the writes of steps from-1 down to `to`, leaving the tape as it stood
  // before step `to`. The head is carried backwards: head(k) is head(k+1) less
  // the movement stored at k+1.
  function backward(from, to) {
    if (from <= to) return;
    replayed += from - to;
    const stray = strayCells, exc = undoExceptions;
    let k = from - 1;
    let h = heads.get(k);
    for (;;) {
      if (writes.get(k) !== NO_WRITE) {
        let prior;
        if (exc !== null && exc.has(k)) prior = exc.get(k);
        else { const r = reads.get(k); prior = r === blankCode ? 0 : r; }
        cur.set(stray !== null && stray.has(k) ? stray.get(k) : h, prior);
      }
      if (--k < to) return;
      const d = heads.deltas[(k + 1) >>> BITS][(k + 1) & MASK];
      h = d === JUMP ? heads.get(k) : h - d;
    }
  }

  // Bring `cur` to step i by whichever way is cheapest: on from where it is,
  // either way; or from the checkpoint before i, forwards; or from the one
  // after, backwards. A copy is weighed as a fraction of a write a cell — it is
  // a memcpy, not a loop.
  function moveTo(i) {
    if (i === curI) return;
    let lo = 0, hi = checkpoints.length - 1, a = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (checkpoints[mid].row <= i) { a = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const A = checkpoints[a], B = checkpoints[a + 1];
    const clear = cur.lo <= cur.hi ? cur.hi - cur.lo + 1 : 0;
    const load = cp => (cp.codes.length + clear) / 32;
    let how = 0, cost = A ? (i - A.row) + load(A) : Infinity;
    if (curI >= 0 && Math.abs(i - curI) <= cost) { how = 1; cost = Math.abs(i - curI); }
    if (B && (B.row - i) + load(B) < cost) how = 2;
    // A route forced by setJumpRoute, where it can be taken.
    if (jumpRoute === 'near' && curI >= 0) how = 1;
    else if (jumpRoute === 'after' && B) how = 2;
    else if (jumpRoute === 'before' && A) how = 0;
    if (how === 1) { if (curI < i) forward(curI, i); else backward(curI, i); }
    else if (how === 2) { cur.load(B); backward(B.row, i); }
    else { cur.load(A); forward(A.row, i); }
    curI = i;
  }

  /** The drawn window for step i: its cells, the head's index within them, and
   *  which absolute cell the window starts at. */
  function frameAt(i) {
    if (i === frameI) return frame;
    moveTo(i);
    const head = heads.get(i) ?? 0;
    const ends = cur.extent();

    // The same window rule as Tape.snapshot().
    let lo = 0;
    if (twoWay) {
      lo = head;
      if (ends && ends[0] < lo) lo = ends[0];
    }
    let hi;
    if (rightBound !== null) hi = rightBound;
    else {
      hi = head > lo ? head : lo;
      if (ends && ends[1] > hi) hi = ends[1];
    }

    const buf = cur.buf, base = cur.base, n = buf.length;
    const arr = [];
    for (let x = lo; x <= hi; x++) {
      const k = x - base;
      const c = k >= 0 && k < n ? buf[k] : 0;
      arr.push(c === 0 ? blank : vals[c]);
    }
    frame = { tape: arr, head: head - lo, origin: lo };
    frameI = i;
    return frame;
  }

  const cellOf = i => {
    if (writes.get(i) === NO_WRITE) return undefined;
    const c = strayCells?.get(i);
    return c === undefined ? heads.get(i) : c;
  };
  const symOf = i => {
    const w = writes.get(i);
    return w <= DELETED ? undefined : vals[w - 1];
  };

  const log = {
    /** The step columns reading this log, if a producer attached them. */
    cols: null,

    /**
     * Open step i. Returns its index, which is what a step is addressed by.
     * `read` is the symbol under the head, which the step's note names and
     * stepping back restores; a caller that leaves it out has it found when it
     * is asked for.
     */
    begin(head, read) {
      const i = heads.length;
      if (i >= nextCheckpoint) {
        const cp = live.snapshot(i);
        checkpoints.push(cp);
        nextCheckpoint = i + Math.max(CHECKPOINT_MIN, cp.codes.length);
      }
      heads.push(head);
      reads.push(read === undefined ? 0 : syms.code(read));
      writes.push(NO_WRITE);
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
      const now = cells.has(cell) ? syms.code(cells.get(cell)) : 0;
      writes.set(i, now === 0 ? DELETED : now + 1);
      const stray = cell !== heads.get(i);
      if (stray) (strayCells ??= new Map()).set(i, cell);
      // What stepping back to i must put back, where the read does not say it.
      const prior = live.get(cell);
      const r = reads.get(i);
      if (stray || prior !== (r === blankCode ? 0 : r)) (undoExceptions ??= new Map()).set(i, prior);
      live.set(cell, now);
    },

    frameAt,

    /** The absolute head position at step i. */
    headAt: i => heads.get(i),

    /** The symbol under the head at step i. */
    readAt(i) {
      const r = reads.get(i);
      if (r !== 0) return vals[r];
      moveTo(i);
      const c = cur.get(heads.get(i));
      return c === 0 ? blank : vals[c];
    },

    /** How many writes have been applied or undone to answer reads, for the tests. */
    replayed: () => replayed,

    /**
     * The log itself, for a reader that wants every step rather than one.
     *
     * A space-time diagram (js/spacetime.js) is the whole run at once, and
     * asking it of `frameAt` would build a window array per row — the
     * O(steps × window) this module exists to avoid, paid again on read. So a
     * reader replays the journal itself, one write per row: `head(i)` is where
     * step i's head was, `cell(i)` the cell it wrote (undefined for none), and
     * `sym(i)` what that cell held afterwards (undefined: deleted, i.e. blank).
     * `checkpoints` are the tape before their `row`, as codes over cells
     * `lo`.., and `symbol(code)` names a code (0 is blank). It is live — the
     * producer is still appending while a streaming run plays — so `length`
     * is read, not kept.
     */
    journal() {
      // Row i as a diagram reads it: where the head is, and the write that
      // step i - 1 made on the way in. One call rather than three, because it
      // is asked once per row of a million-row diagram, and the object is
      // reused, so the caller reads it before asking again.
      //
      // Rows are nearly always asked for in order, so it keeps its own place —
      // the last row and its head — and reads the next row's movement straight
      // out of the chunk. Going through the columns' own `get` per row cost
      // ~25ns a row, which on a million-row diagram was most of indexing it.
      // `code` is the symbol's number in this log (0: the cell was deleted),
      // for a reader that keeps its own table rather than hashing the string.
      const row = { head: undefined, cell: undefined, sym: undefined, code: 0 };
      let ri = -1, rh = 0;
      return {
        initial, blank, twoWay, rightBound, markers, checkpoints,
        leftBound: twoWay ? null : 0,
        get length() { return heads.length; },
        head: i => heads.get(i),
        cell: cellOf,
        sym: symOf,
        symbol: c => (c === 0 ? blank : vals[c]),
        into(i) {
          let h, hp;
          if (i === ri + 1 && i > 0 && i < heads.length) {
            hp = rh;
            const d = heads.deltas[i >>> BITS][i & MASK];
            h = d === JUMP ? heads.jumps.get(i) : hp + d;
          } else {
            hp = i > 0 ? heads.get(i - 1) : undefined;
            h = heads.get(i);
          }
          if (h !== undefined) { ri = i; rh = h; }
          row.head = h;
          row.cell = row.sym = undefined;
          row.code = 0;
          if (i > 0 && i <= writes.length) {
            const k = i - 1;
            const w = writes.chunks[k >>> BITS][k & MASK];
            if (w !== NO_WRITE) {
              row.cell = strayCells !== null && strayCells.has(k) ? strayCells.get(k) : hp;
              if (w !== DELETED) { row.sym = vals[w - 1]; row.code = w - 1; }
            }
          }
          return row;
        }
      };
    },

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
    },

    /** Bytes the log holds — columns, checkpoints and working copies — for the tests and the benchmark. */
    bytes: () => heads.bytes() + reads.bytes() + writes.bytes() + live.bytes() + cur.bytes() +
      checkpoints.reduce((b, cp) => b + cp.codes.byteLength, 0)
  };
  return log;
}

// ── steps as columns ──────────────────────────────────────────────
// A step is `{ _log, _i }` (or `{ _logs, _i }` for k tapes in lockstep) over
// a prototype whose every field is a read: the tape and the view from the log,
// the state, the transition and the word from the step columns, and the note
// formatted from those. So a step object holds nothing a column does not, and
// dropping it loses nothing — which is what lets the run keep columns instead
// of objects. Whatever a producer *adds* — `final`, `loopFrom`, a note it
// appended to — is an own property, and a step carrying one is kept whole.
//
// The accessors are non-enumerable, so `for…in` over a step sees exactly its
// own fields; that is how `plain` tells a step it can rebuild from one it
// cannot, without allocating a key list per step.

const colsOf = s => (s._log || s._logs[0]).cols;

const ownNote = (step, v) => Object.defineProperty(step, 'note', { value: v, writable: true, enumerable: true, configurable: true });

const FIELDS = {
  state: { get() { return colsOf(this).stateAt(this._i); }, configurable: true },
  tid: { get() { return colsOf(this).tidAt(this._i); }, configurable: true },
  tokens: { get() { return colsOf(this).tokens; }, configurable: true },
  // The note is formatted each time it is read, which is once per render of
  // that step. Written to — `step.note += ' — ACCEPT'` — it becomes the step's
  // own, and the step is kept whole from then on.
  note: {
    get() { const c = colsOf(this); return c.noteAt(this._i, c); },
    set(v) { ownNote(this, v); },
    configurable: true
  }
};

const TAPE_STEP = Object.create(Object.prototype, {
  ...FIELDS,
  tape: { get() { return this._log.frameAt(this._i).tape; }, configurable: true },
  head: { get() { return this._log.frameAt(this._i).head; }, configurable: true },
  view: { get() { return this._log.viewAt(this._i); }, configurable: true }
});

const MULTI_TAPE_STEP = Object.create(Object.prototype, {
  ...FIELDS,
  tapes: { get() { return this._logs.map(l => l.frameAt(this._i).tape); }, configurable: true },
  heads: { get() { return this._logs.map(l => l.frameAt(this._i).head); }, configurable: true },
  views: { get() { return this._logs.map(l => l.viewAt(this._i)); }, configurable: true }
});

/**
 * The fields a tape step has besides its tapes, as columns beside the logs.
 *
 * @param logs   the run's tape logs, one per tape, advancing in lockstep
 * @param tokens the word, the same array for every step
 * @param noteAt (i, columns) → step i's note, from what the columns and logs
 *               say — the producer's, since only it knows which machine is
 *               speaking. It lives as long as the run, so it must not close
 *               over the producer's live tape.
 * @param multi  steps read as `tapes`/`heads`/`views` rather than one tape —
 *               the multi-tape machine's shape, whatever its arity
 */
export function makeStepColumns(logs, tokens, noteAt, multi = false) {
  const states = makeInterner();
  const tids = makeInterner();
  const stateCol = new CodeColumn();
  const tidCol = new CodeColumn();

  function build(i) {
    const s = Object.create(multi ? MULTI_TAPE_STEP : TAPE_STEP);
    if (multi) s._logs = logs; else s._log = logs[0];
    s._i = i;
    return s;
  }

  const cols = {
    tokens,
    noteAt,
    stateAt: i => states.value(stateCol.get(i)),
    tidAt: i => { const c = tidCol.get(i); return c === 0 ? null : tids.value(c); },
    // Every state the run has been in, in the order it first was — the
    // interner's own list, so asking costs |Q| and recording cost nothing.
    // Live; index 0 is the empty code.
    statesSeen: () => states.values,

    /** Record step i — the producer's next — and hand back its step. */
    step(i, state, tid) {
      stateCol.push(states.code(state));
      tidCol.push(tid === null || tid === undefined ? 0 : tids.code(tid));
      return build(i);
    },

    /** Step i, built again from the columns. */
    at: build,

    /**
     * Whether `step` holds nothing `at(i)` would not rebuild: its own fields
     * are its address and nothing else.
     */
    plain(step, i) {
      if (step._i !== i || colsOf(step) !== cols) return false;
      let n = 0;
      for (const k in step) {
        if (k !== '_i' && k !== '_log' && k !== '_logs') return false;
        n++;
      }
      return n === 2;
    },

    bytes: () => stateCol.bytes() + tidCol.bytes() + logs.reduce((b, l) => b + l.bytes(), 0)
  };
  logs[0].cols = cols;
  return cols;
}

/** The step columns a step was built from, or null for any other step. */
export function stepColumnsOf(step) {
  const p = step && Object.getPrototypeOf(step);
  return p === TAPE_STEP || p === MULTI_TAPE_STEP ? colsOf(step) : null;
}

/**
 * The journals behind a step, or null for a step that stores its tape.
 *
 * Here rather than read off `_log`/`_logs` by the caller, because those are
 * this module's representation and the one place that may know it.
 */
export function stepJournals(step) {
  if (!step) return null;
  if (Array.isArray(step._logs)) return step._logs.map(l => l.journal());
  if (step._log) return [step._log.journal()];
  return null;
}

/** Which log entry a logged step reads — its row in its journal. */
export function stepLogIndex(step) {
  return step && typeof step._i === 'number' ? step._i : -1;
}
