import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The engine's four hot spots, and the promise each fix had to keep: **the
// same answers, faster.** Each test here pins a new implementation against the
// old one — rewritten in this file as the reference — rather than against
// expectations of its own, because "it agrees with itself" is not the claim.
//
//   1. δ is indexed by source state (transitionsFrom), not scanned per step.
//   2. The tokenizer is a table, not a recursion that copied its tail.
//   3. The breadth-first searches dequeue in O(1), and the NPDA decider does
//      not narrate a search nobody reads.
//   4. The deterministic tape deciders detect loops by fingerprint, confirmed
//      by key, rather than by stringifying the tape every step.

const harness = createHarness();
const { context } = harness;

let seed = 1;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = xs => xs[Math.floor(rnd() * xs.length)];

// ── 1. the δ index ──────────────────────────────────────────────────

test('transitionsFrom lists what the old filter found, in the same order', () => {
  harness.resetApp();
  const { App, transitionsFrom } = context;
  App.transitions = [];
  for (let i = 0; i < 400; i++) App.transitions.push({ id: 't' + i, from: 's' + Math.floor(rnd() * 20), to: 's0', symbol: pick(['a', 'b']) });
  for (let s = 0; s < 21; s++) {
    const id = 's' + s;
    assert.deepEqual(transitionsFrom(id), App.transitions.filter(t => t.from === id));
  }
});

test('the index follows the list: a push, a removal, a reassignment', () => {
  harness.resetApp();
  const { App, transitionsFrom } = context;
  App.transitions = [{ id: 't1', from: 'a', to: 'b', symbol: 'x' }];
  assert.equal(transitionsFrom('a').length, 1);
  App.transitions.push({ id: 't2', from: 'a', to: 'a', symbol: 'y' });
  assert.equal(transitionsFrom('a').length, 2, 'a push is seen');
  App.transitions = App.transitions.filter(t => t.id !== 't1');
  assert.deepEqual(transitionsFrom('a').map(t => t.id), ['t2'], 'a filter is seen');
  App.transitions[0].symbol = 'z';
  assert.equal(transitionsFrom('a')[0].symbol, 'z', 'every field but `from` is read live off the object');
});

test('reversing an edge in place re-indexes it', () => {
  // ctxReverseTrans rewrites `from` on the transition objects themselves,
  // which leaves the array, its length and its ends exactly as they were.
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('DFA');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 100, y: 0 });
  App.startId = 's0';
  App.accepts.add('s1');
  App.sigma = new Set(['a']);
  App.transitions.push({ id: 't0', from: 's1', to: 's0', symbol: 'a' });
  assert.equal(context.decideMachine('DFA', ['a']).verdict, 'rej');
  App.ctxEdge = { transitionIds: ['t0'] };
  context.ctxReverseTrans();
  assert.equal(App.transitions[0].from, 's0');
  assert.equal(context.decideMachine('DFA', ['a']).verdict, 'acc', 'the run sees the edge where it now starts');
});

// ── 2. the tokenizer ────────────────────────────────────────────────

/** The recursive search tokenize() replaced, verbatim in its choices. */
function oldTokenize(str, sigma, eps) {
  if (str === '' || !str) return [];
  const syms = [...sigma].filter(s => s !== eps).sort((a, b) => b.length - a.length);
  const bt = segment => {
    const rec = pos => {
      if (pos === segment.length) return [];
      for (const s of syms) {
        if (segment.startsWith(s, pos)) {
          const rest = rec(pos + s.length);
          if (rest !== null) return [s, ...rest];
        }
      }
      return null;
    };
    return rec(0);
  };
  const segments = str.split(/[,\s]+/).filter(seg => seg.length > 0);
  if (segments.length === 0) return [];
  const tokens = [];
  for (const segment of segments) {
    const t = bt(segment);
    if (t === null) return null;
    tokens.push(...t);
  }
  return tokens;
}

test('the tokenizer splits every word exactly as the backtracking search did', () => {
  harness.resetApp();
  const eps = context.App.config.sym.eps;
  // Ambiguous alphabets are the point: 'a','aa','aab' can split one string
  // several ways, and the search took the first in longest-first order.
  const alphabets = [['a', 'b'], ['a', 'aa', 'aab', 'b'], ['0', '1', '10', '01'], ['ab', 'a', 'ba', 'b', 'bab']];
  for (const sigma of alphabets) {
    const chars = [...new Set(sigma.join(''))];
    for (let i = 0; i < 400; i++) {
      const len = Math.floor(rnd() * 14);
      let w = Array.from({ length: len }, () => pick(chars)).join('');
      if (rnd() < 0.2) w = w.slice(0, len / 2) + ' ' + w.slice(len / 2);
      assert.deepEqual(context.tokenize(w, new Set(sigma)), oldTokenize(w, new Set(sigma), eps), `Σ={${sigma}} w="${w}"`);
    }
  }
});

test('a long word typed without separators tokenizes, and in linear time', () => {
  harness.resetApp();
  const w = 'ab'.repeat(100000);
  // The recursion overflowed the stack well before this length.
  const t0 = performance.now();
  const toks = context.tokenize(w, new Set(['a', 'b', 'ab']));
  assert.equal(toks.length, 100000);
  assert.ok(toks.every(s => s === 'ab'), 'longest first, as before');
  assert.ok(performance.now() - t0 < 2000, 'and not quadratically');
});

// ── 3. the searches ─────────────────────────────────────────────────

test('the queue is first in, first out, across its own compaction', () => {
  const q = new context.Fifo([0]);
  const out = [];
  for (let i = 1; i < 5000; i++) { q.push(i); if (i % 3 === 0) out.push(q.shift(), q.shift()); }
  while (q.length) out.push(q.shift());
  assert.deepEqual(out, Array.from({ length: 5000 }, (_, i) => i));
  assert.equal(q.shift(), undefined);
});

test('the NPDA decider answers what the narrated search answers', () => {
  // ww^R: the example machine, on words it accepts and words it does not.
  harness.resetApp();
  const { App } = context;
  context.setMachine('NPDA');
  App.config.pdaParadigm = 'explicit';
  App.sigma = new Set(['a', 'b']);
  App.states.push({ id: 's1', name: 'push', x: 0, y: 0 }, { id: 's2', name: 'pop', x: 1, y: 0 }, { id: 's3', name: 'ok', x: 2, y: 0 });
  App.startId = 's1';
  App.accepts.add('s3');
  const Z = App.config.sym.stackBottom, eps = App.config.sym.eps;
  App.transitions.push(
    { id: 't1', from: 's1', to: 's1', symbol: 'a', pop: eps, push: 'a' },
    { id: 't2', from: 's1', to: 's1', symbol: 'b', pop: eps, push: 'b' },
    { id: 't3', from: 's1', to: 's2', symbol: eps, pop: eps, push: eps },
    { id: 't4', from: 's2', to: 's2', symbol: 'a', pop: 'a', push: eps },
    { id: 't5', from: 's2', to: 's2', symbol: 'b', pop: 'b', push: eps },
    { id: 't6', from: 's2', to: 's3', symbol: eps, pop: Z, push: Z });
  for (let i = 0; i < 60; i++) {
    const half = Array.from({ length: Math.floor(rnd() * 6) }, () => pick(['a', 'b']));
    const w = rnd() < 0.5 ? [...half, ...[...half].reverse()] : Array.from({ length: Math.floor(rnd() * 10) }, () => pick(['a', 'b']));
    const narrated = context.exploreNPDA(w);
    assert.equal(context.testNPDA(w), narrated.accepted, w.join(''));
    assert.ok(narrated.log.length <= context.NPDA_LOG_KEEP, 'the narration stops where its reader does');
  }
});

// ── 4. the tape deciders ────────────────────────────────────────────

/** testTM3 as it was: the whole tape stringified into a Set every step. */
function oldTestTM3(tokens, budget, twoWay) {
  const { App, Tape, getSingleTapeDeterministicTransition, runStartId } = context;
  const any = App.config.sym.any;
  const tape = new Tape(tokens, App.config.sym.blank, twoWay);
  let state = runStartId();
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    if (App.accepts.has(state)) return 'acc';
    const key = `${state}|${tape.key()}`;
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const sym = tape.read();
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) return 'rej';
    tape.write((!t.write || t.write === any) ? sym : t.write);
    tape.move(t.dir);
    state = t.to;
  }
  return 'unk';
}

function randomTM(nStates) {
  harness.resetApp();
  const { App } = context;
  context.setMachine('TM');
  const B = App.config.sym.blank;
  App.sigma = new Set(['a', 'b']);
  for (let i = 0; i < nStates; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: i, y: 0 });
  App.startId = 's0';
  if (rnd() < 0.5) App.accepts.add('s' + (nStates - 1));
  let k = 0;
  for (let i = 0; i < nStates; i++) {
    for (const sym of ['a', 'b', B]) {
      if (rnd() < 0.12) continue;   // some missing: the machine may halt
      App.transitions.push({ id: 't' + k++, from: 's' + i, to: 's' + Math.floor(rnd() * nStates), symbol: sym, write: pick(['a', 'b', B]), dir: pick(['L', 'R', 'R', 'S']) });
    }
  }
  return App;
}

test('the TM decider reaches the verdict the key-per-step decider did', () => {
  let loops = 0;
  for (const twoWay of [false, true]) {
    for (let m = 0; m < 150; m++) {
      const App = randomTM(2 + Math.floor(rnd() * 3));
      App.config.twoWayTape = twoWay;
      for (let w = 0; w < 6; w++) {
        const tokens = Array.from({ length: Math.floor(rnd() * 6) }, () => pick(['a', 'b']));
        const want = oldTestTM3(tokens, 400, twoWay);
        assert.equal(context.testTM3(tokens, 400), want, `twoWay=${twoWay} machine ${m} word "${tokens.join('')}"`);
        if (want === 'rej') loops++;
      }
    }
  }
  assert.ok(loops > 100, 'and the sample exercised the loop verdict, not just halts');
});

test('a two-way loop that only translates is still found', () => {
  // key() is origin-independent on a two-way tape, so a configuration that
  // recurs shifted one cell left is a repeat. A fingerprint that hashed
  // absolute positions would miss exactly this and run to the budget.
  harness.resetApp();
  const { App } = context;
  context.setMachine('TM');
  App.config.twoWayTape = true;
  const B = App.config.sym.blank;
  App.sigma = new Set(['a']);
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  // Carry one 'a' leftward forever: erase it, step left, write it again.
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: 'a', write: B, dir: 'L' });
  App.transitions.push({ id: 't1', from: 's0', to: 's0', symbol: B, write: 'a', dir: 'S' });
  assert.equal(oldTestTM3(['a'], 1000, true), 'rej');
  assert.equal(context.testTM3(['a'], 1000), 'rej');
});

test('deciding a long run costs per step, not per step per cell', () => {
  // A head that sweeps a growing tape is the case the old key made quadratic.
  harness.resetApp();
  const { App } = context;
  context.setMachine('TM');
  const B = App.config.sym.blank;
  App.sigma = new Set(['a']);
  App.states.push({ id: 's0', name: 'r', x: 0, y: 0 }, { id: 's1', name: 'l', x: 1, y: 0 });
  App.startId = 's0';
  App.transitions.push(
    { id: 't0', from: 's0', to: 's0', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't1', from: 's0', to: 's1', symbol: B, write: 'a', dir: 'L' },
    { id: 't2', from: 's1', to: 's1', symbol: 'a', write: 'a', dir: 'L' },
    { id: 't3', from: 's1', to: 's0', symbol: B, write: B, dir: 'R' });
  App.config.twoWayTape = true;
  const t0 = performance.now();
  assert.equal(context.testTM3(['a'], 200000), 'unk', 'it never repeats: the tape grows every sweep');
  assert.ok(performance.now() - t0 < 3000, `200k steps took ${Math.round(performance.now() - t0)}ms`);
});
