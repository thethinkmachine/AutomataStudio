// ══════════════════════════════════════════════════════════════════
//  WHAT A STEP REMEMBERS — the half that is not a tape
// ══════════════════════════════════════════════════════════════════
// js/tape-log.js makes the case for the tape machines: a run is tens of
// thousands of steps, so anything a step holds that grows with the run is
// quadratic in the run. That was true of every machine that is *not* a tape
// machine too, in two directions at once, and it was the largest single cost
// in the app.
//
//   `remaining` was `tokens.slice(i)` — a fresh suffix copy per step, so a
//   word of length n allocated n arrays totalling n²/2 cells. Measured: a
//   16,000-symbol word retained 1,036 MB, and a 100,000-symbol one exhausted
//   a 4 GB heap. The step budget does not bound it, because a streamed run
//   retains its steps as it goes.
//
//   `outToks` was `[...outputs]` — the same quadratic seen from the other
//   end, a fresh copy of a *growing* array per step.
//
// Neither is information the step owns. `remaining` is a suffix of the one
// shared token array, so a position describes it completely. `outToks` is a
// prefix of one growing output, so a length describes it — or, where a
// search branches, a pointer into a shared cons list, which is what lets two
// branches share the prefix they agree on instead of copying it apart.
//
// Both are exposed as **getters on a shared prototype**, exactly as
// `tapeStep` does it, so no reader changed: the tape tracker, the trace log,
// the minimap and StateMate's projection still say `step.remaining` and
// `step.outToks`. The rule from tape-log.js carries over unchanged — a step
// must not carry either as an own property, and tests/step-log.test.js is
// what says so rather than leaving it to be re-noticed.
//
// Three prototypes rather than one, and the split is load-bearing. A getter
// always answers, so a single prototype would give every step an `outToks`
// of `[]` — and `simulation.js` decides whether to draw the Output row on
// `step.outToks !== undefined`, while `tokIdx` falls back to the cursor when
// a step has no `remaining`. A machine gets the shape it actually has.

// ── the growing output, as a shared cons list ─────────────────────
// Appending is O(1) and allocates one node, so a search that branches n ways
// after k steps holds k + n nodes rather than n copies of k elements.

/** The empty output. `undefined` means "this machine does not emit". */
export const OUT_EMPTY = null;

export function outPush(node, piece) {
  return { piece, prev: node, len: node ? node.len + 1 : 1 };
}

export function outArray(node) {
  const n = node ? node.len : 0;
  const out = new Array(n);
  for (let c = node, i = n - 1; c; c = c.prev, i--) out[i] = c.piece;
  return out;
}

/** How many pieces this output holds, without building the array. */
export function outLength(node) {
  return node ? node.len : 0;
}

// ── the prototypes ────────────────────────────────────────────────
// Written as descriptors rather than object literals because the three are
// composed: `Object.assign` would *invoke* a getter and copy its value,
// which is the one mistake that would put the copies straight back.

const remainingDesc = {
  get() { return this.tokens.slice(this.pos); },
  enumerable: false,
  configurable: true
};

const outToksDesc = {
  get() { return outArray(this.outNode); },
  enumerable: false,
  configurable: true
};

const wordProto = Object.defineProperties({}, { remaining: remainingDesc });
const outProto = Object.defineProperties({}, { outToks: outToksDesc });
const wordOutProto = Object.defineProperties({}, { remaining: remainingDesc, outToks: outToksDesc });

/** A step that reads an input word: carries `tokens` + `pos`. */
export function wordStep(props) {
  return Object.assign(Object.create(wordProto), props);
}

/** A step that emits: carries `outNode`. */
export function outStep(props) {
  return Object.assign(Object.create(outProto), props);
}

/** Both — a pushdown transducer. */
export function wordOutStep(props) {
  return Object.assign(Object.create(wordOutProto), props);
}
