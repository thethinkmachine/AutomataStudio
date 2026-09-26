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

// ── a stack, as a shared and interned cons list ───────────────────
// A search over a pushdown machine used to give every configuration its own
// copy of the stack and name it by joining the copy into a string, so each
// configuration cost the depth of its stack twice over, and a search whose
// stacks grow with the word was quadratic in the word before it had branched
// once. A move only changes the top of a stack, so a stack is a node — its
// top symbol and the node under it — and a move builds O(|push|) new nodes on
// top of what it did not touch.
//
// **The nodes are interned, and that is what makes them a key.** Pushing a
// symbol onto a node returns the child already made for that symbol if there
// is one, so within one trie two stacks with the same contents are the same
// node, and `node.id` names the contents exactly: no hash, no collision, no
// join. Each search starts its own trie with `stackRoot()`, so a finished
// search's nodes go with it.
//
// A node carries `length`, so code that asked a stack array how deep it was
// asks a node the same way. A symbol may be anything a Map can key — the
// EPDA's store is a stack whose symbols are stack nodes — and `size` is the
// total depth of the stacks below, for exactly that store. Ids count up from
// 0 per trie, so a search can pack them into integer keys (ConfigSet).

export function stackRoot() {
  return { sym: undefined, below: null, length: 0, size: 0, id: 0, kids: null, arr: null, trie: { next: 1 } };
}

export function stackPush(node, sym) {
  let kids = node.kids;
  if (kids === null) kids = node.kids = new Map();
  let child = kids.get(sym);
  if (child === undefined) {
    const weight = sym !== null && typeof sym === 'object' ? sym.length : 1;
    child = { sym, below: node, length: node.length + 1, size: node.size + weight, id: node.trie.next++, kids: null, arr: null, trie: node.trie };
    kids.set(sym, child);
  }
  return child;
}

/** Bottom-first array of a stack node. Cached on the node; do not mutate it. */
export function stackArray(node) {
  if (node.arr !== null) return node.arr;
  const out = new Array(node.length);
  for (let c = node, i = node.length - 1; i >= 0; c = c.below, i--) out[i] = c.sym;
  node.arr = out;
  return out;
}

/**
 * A transducer's output so far, as a key: the interned node reached by
 * pushing `piece` onto `node` a character at a time. Per character, so that
 * "a" then "b" and "ab" at once reach the same node — the output a search
 * tells configurations apart by is the string, not how it was emitted.
 */
export function outputKeyAfter(node, piece) {
  for (let i = 0; i < piece.length; i++) node = stackPush(node, piece[i]);
  return node;
}

/** A store as the array a step shows: an array stays one, a node is spelled out. */
export function storeArray(store) {
  return Array.isArray(store) ? store : stackArray(store);
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

// A pushdown step holds its store as `stackRef` (a node, or a queue's array)
// and the arrays readers know as `stack` / `stack2` / `store` are spelled out
// on demand — the same trade as `remaining`: the path shares its stacks' nodes
// rather than holding a copy per step.
const stackDesc = {
  get() { return this.stackRef === undefined ? undefined : storeArray(this.stackRef); },
  enumerable: false,
  configurable: true
};

const stack2Desc = {
  get() { return this.stackRef2 === undefined ? undefined : storeArray(this.stackRef2); },
  enumerable: false,
  configurable: true
};

// The EPDA's store is a stack of stack nodes: `store` is its stacks bottom
// first, `stack` the top one.
const storeDesc = {
  get() { return stackArray(this.storeRef).map(stackArray); },
  enumerable: false,
  configurable: true
};

const topStackDesc = {
  get() { const top = this.storeRef.sym; return top ? stackArray(top) : []; },
  enumerable: false,
  configurable: true
};

const wordProto = Object.defineProperties({}, { remaining: remainingDesc });
const outProto = Object.defineProperties({}, { outToks: outToksDesc });
const wordOutProto = Object.defineProperties({}, { remaining: remainingDesc, outToks: outToksDesc });
const pdaProto = Object.defineProperties({}, { remaining: remainingDesc, stack: stackDesc, stack2: stack2Desc });
const pdaOutProto = Object.defineProperties({}, { remaining: remainingDesc, outToks: outToksDesc, stack: stackDesc, stack2: stack2Desc });
const epdaProto = Object.defineProperties({}, { remaining: remainingDesc, store: storeDesc, stack: topStackDesc });

// ── a note written only if it is read ─────────────────────────────
// A streamed run builds a step per step of the machine, and its note — the
// state's name looked up and a sentence formatted around it — was a third of
// what a step cost, for a line the trace log shows only for the last
// screenful. A stream may therefore pass the note as a function, in the
// argument after the step's fields: the step then comes from a variant of its
// prototype whose `note` calls it on first read and keeps the string.
// `step.note += ' — ACCEPT'` still works (read, then write), and a step given a
// plain string is built exactly as before. The function is stored directly
// rather than passed through Object.assign, which would call the setter and
// fall off its fast path.
//
// Whatever the function reads it must have captured as it was at that step —
// a stream's loop variables have moved on by the time anyone reads the note.

const noteDesc = {
  get() {
    const n = this._note;
    return typeof n === 'function' ? (this._note = n()) : n;
  },
  set(v) { this._note = v; },
  enumerable: false,
  configurable: true
};

const lazyVariants = new WeakMap();

/** `proto`, with `note` resolved lazily. */
export function lazyNoteProto(proto) {
  let v = lazyVariants.get(proto);
  if (!v) lazyVariants.set(proto, v = Object.create(proto, { note: noteDesc }));
  return v;
}

/** A step that reads an input word: carries `tokens` + `pos`. */
export function wordStep(props, noteOf) {
  if (noteOf === undefined) return Object.assign(Object.create(wordProto), props);
  const s = Object.assign(Object.create(lazyNoteProto(wordProto)), props);
  s._note = noteOf;
  return s;
}

/** A step that emits: carries `outNode`. */
export function outStep(props, noteOf) {
  if (noteOf === undefined) return Object.assign(Object.create(outProto), props);
  const s = Object.assign(Object.create(lazyNoteProto(outProto)), props);
  s._note = noteOf;
  return s;
}

/** Both. */
export function wordOutStep(props) {
  return Object.assign(Object.create(wordOutProto), props);
}

/** A pushdown step: `stackRef` (and `stackRef2`) read back as `stack` (and `stack2`). */
export function pdaStep(props) {
  return Object.assign(Object.create(props.outNode !== undefined ? pdaOutProto : pdaProto), props);
}

/** An EPDA step: `storeRef` reads back as `store` and `stack`. */
export function epdaStep(props) {
  return Object.assign(Object.create(epdaProto), props);
}
