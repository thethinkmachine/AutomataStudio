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
//   5. A search's stacks are interned nodes and its visited set holds
//      integers; a transducer's output joins the key as a node, not a string.
//   6. A deterministic run resolves each state's row of δ once.
//   7. An NFA's state set is integers, built in the order the Set version
//      built it.
//   8. The NDTM search forks a zipper tape in O(1).
//   9. A streamed step formats its note only if it is read.

import { ZipperTape } from '../js/machines/zipper-tape.js';

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

// ── 5. the stores, shared ───────────────────────────────────────────

/**
 * The pushdown search as it was: a copied array per configuration and the
 * whole store joined into its key. Same order, same dedupe — so the new search
 * must visit exactly as many configurations and reach the same answer.
 */
function oldPushdownSearch(tokens, { queue: queueMode = false, pdt = false } = {}) {
  const { App, transitionsFrom, applyPdaStoreTransition, canApplyPdaPop, pdaPeek, transducerRunContributes } = context;
  const { eps, any, stackBottom } = App.config.sym;
  const explicit = App.config.pdaParadigm === 'explicit';
  const start = { state: App.startId, pos: 0, stack: explicit ? [stackBottom] : [], out: '' };
  const key = c => `${c.state}|${c.pos}|${c.stack.join('\u0001')}|${pdt ? c.out : ''}`;
  const seen = new Set([key(start)]);
  const queue = [start];
  const outputs = new Set();
  let branches = 0, accepted = false;
  for (let h = 0; h < queue.length && branches < App.config.maxPdaSteps; h++) {
    const cfg = queue[h];
    branches++;
    const done = cfg.pos >= tokens.length;
    const acc = explicit ? App.accepts.has(cfg.state) && done : done && cfg.stack.length === 0;
    if (pdt) {
      if (done && transducerRunContributes(true, acc)) outputs.add(cfg.out);
      if (acc) accepted = true;
    } else if (acc) { accepted = true; break; }
    const top = pdaPeek(cfg.stack, queueMode);
    for (const t of transitionsFrom(cfg.state)) {
      const readOk = t.symbol === eps || (!done && (t.symbol === tokens[cfg.pos] || t.symbol === any));
      if (!readOk || !canApplyPdaPop(top, t.pop)) continue;
      const next = {
        state: t.to,
        pos: t.symbol === eps ? cfg.pos : cfg.pos + 1,
        stack: applyPdaStoreTransition(cfg.stack, t.pop || eps, t.push || eps, queueMode),
        out: cfg.out + (t.output ?? '')
      };
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return { branches, accepted, outputs };
}

function randomPushdown(type) {
  harness.resetApp();
  const { App } = context;
  context.setMachine(type);
  App.config.pdaParadigm = rnd() < 0.5 ? 'explicit' : 'empty';
  App.config.maxPdaSteps = 1500;
  const { eps, any, stackBottom } = App.config.sym;
  App.sigma = new Set(['a', 'b']);
  for (let i = 0; i < 3; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: i, y: 0 });
  App.startId = 's0';
  App.accepts.add('s' + Math.floor(rnd() * 3));
  const n = 4 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++) {
    App.transitions.push({
      id: 't' + k, from: 's' + Math.floor(rnd() * 3), to: 's' + Math.floor(rnd() * 3),
      symbol: pick(['a', 'b', eps]), pop: pick([eps, 'A', 'B', stackBottom, any]),
      push: pick([eps, 'A', 'AB', 'BA', any, stackBottom]), output: pick(['', 'x', 'yz'])
    });
  }
  return App;
}

test('the NPDA search visits what the array-and-string search visited', () => {
  let accepted = 0;
  for (let m = 0; m < 120; m++) {
    randomPushdown('NPDA');
    for (let w = 0; w < 4; w++) {
      const tokens = Array.from({ length: Math.floor(rnd() * 6) }, () => pick(['a', 'b']));
      const want = oldPushdownSearch(tokens);
      const got = context.exploreNPDA(tokens, { log: 0, witness: false });
      assert.equal(got.branches, want.branches, `machine ${m} word "${tokens.join('')}"`);
      assert.equal(got.accepted, want.accepted);
      if (want.accepted) accepted++;
    }
  }
  assert.ok(accepted > 20, 'and the sample reached acceptance, not just exhaustion');
});

test('the queue automaton keeps its arrays and its answers', () => {
  for (let m = 0; m < 60; m++) {
    randomPushdown('QA');
    for (let w = 0; w < 4; w++) {
      const tokens = Array.from({ length: Math.floor(rnd() * 6) }, () => pick(['a', 'b']));
      const want = oldPushdownSearch(tokens, { queue: true });
      const got = context.exploreNPDA(tokens, { log: 0, witness: false });
      assert.equal(got.branches, want.branches);
      assert.equal(got.accepted, want.accepted);
    }
  }
});

test('the PDT keys on its output as a string, however it was pieced together', () => {
  for (let m = 0; m < 80; m++) {
    randomPushdown('PDT');
    for (let w = 0; w < 4; w++) {
      const tokens = Array.from({ length: Math.floor(rnd() * 5) }, () => pick(['a', 'b']));
      const want = oldPushdownSearch(tokens, { pdt: true });
      const got = context.explorePDT(tokens);
      assert.equal(got.branches, want.branches, `machine ${m} word "${tokens.join('')}"`);
      assert.deepEqual([...got.outputs].sort(), [...want.outputs].sort());
    }
  }
});

test('a PDT reversing a long word finishes, and says the reverse', () => {
  // Keyed on the output string, this ran out of a 4 GB heap at 2,000 symbols.
  harness.resetApp();
  const { App } = context;
  context.setMachine('PDT');
  App.config.pdaParadigm = 'explicit';
  App.config.maxPdaSteps = 1e7;
  const { eps, stackBottom: Z } = App.config.sym;
  App.sigma = new Set(['a', 'b']);
  App.states.push({ id: 'p', name: 'p', x: 0, y: 0 }, { id: 'q', name: 'q', x: 1, y: 0 }, { id: 'f', name: 'f', x: 2, y: 0 });
  App.startId = 'p';
  App.accepts.add('f');
  App.transitions.push(
    { id: 't1', from: 'p', to: 'p', symbol: 'a', pop: eps, push: 'A', output: '' },
    { id: 't2', from: 'p', to: 'p', symbol: 'b', pop: eps, push: 'B', output: '' },
    { id: 't3', from: 'p', to: 'q', symbol: eps, pop: eps, push: eps, output: '' },
    { id: 't4', from: 'q', to: 'q', symbol: eps, pop: 'A', push: eps, output: 'a' },
    { id: 't5', from: 'q', to: 'q', symbol: eps, pop: 'B', push: eps, output: 'b' },
    { id: 't6', from: 'q', to: 'f', symbol: eps, pop: Z, push: Z, output: '' });
  const word = Array.from({ length: 600 }, () => pick(['a', 'b']));
  const t0 = performance.now();
  const r = context.explorePDT(word);
  assert.ok(r.accepted);
  assert.ok(r.outputs.has([...word].reverse().join('')));
  assert.ok(performance.now() - t0 < 5000, `took ${Math.round(performance.now() - t0)}ms`);
});

test('a pushdown step spells its stack out when read, and shares the nodes', () => {
  const App = randomPushdown('NPDA');
  App.config.pdaParadigm = 'explicit';
  const r = context.exploreNPDA(['a', 'b']);
  const steps = context.buildPdaPathSteps(r.witnessPath);
  for (const s of steps) {
    assert.equal(Object.prototype.hasOwnProperty.call(s, 'stack'), false, 'stack is a getter, not a copy');
    assert.ok(Array.isArray(s.stack));
    assert.equal(s.stack[0], App.config.sym.stackBottom);
  }
});

/** The EPDA search as it was: arrays of arrays, rebuilt per move. */
function oldExploreEPDA(tokens) {
  const { App, transitionsFrom, parseStackList, epdaSymbols, normalizeStore, epdaTop, epdaStoreBudget } = context;
  const { eps, any, stackBottom } = App.config.sym;
  const explicit = App.config.pdaParadigm === 'explicit';
  const start = { state: App.startId, pos: 0, store: [explicit ? [stackBottom] : []] };
  const key = c => `${c.state}|${c.pos}|${c.store.map(s => s.join('\u0001')).join('\u0002')}`;
  const seen = new Set([key(start)]);
  const queue = [start];
  const budget = epdaStoreBudget(tokens);
  let branches = 0, accepted = false, capped = false;
  for (let h = 0; h < queue.length && branches < App.config.maxPdaSteps; h++) {
    const cfg = queue[h];
    branches++;
    const done = cfg.pos >= tokens.length;
    if (done && (explicit ? App.accepts.has(cfg.state) : cfg.store.length === 1 && cfg.store[0].length === 0)) { accepted = true; break; }
    const top = epdaTop(cfg.store);
    for (const t of transitionsFrom(cfg.state)) {
      const readOk = t.symbol === eps || (!done && (t.symbol === tokens[cfg.pos] || t.symbol === any));
      const pop = t.pop || eps;
      if (!readOk || !(pop === eps || (top !== undefined && (pop === top || pop === any)))) continue;
      const topStack = [...(cfg.store[cfg.store.length - 1] || [])];
      let popped;
      if (pop !== eps) popped = topStack.pop();
      let pushStr = t.push && t.push !== eps ? t.push : '';
      if (pushStr === any) pushStr = popped || '';
      if (pushStr) epdaSymbols(pushStr).reverse().forEach(s => topStack.push(s));
      const store = normalizeStore([...cfg.store.slice(0, -1), ...parseStackList(t.below), topStack, ...parseStackList(t.above)]);
      const total = store.reduce((n, s) => n + s.length, 0);
      if (store.length > budget.stacks || total > budget.symbols) { capped = true; continue; }
      const next = { state: t.to, pos: t.symbol === eps ? cfg.pos : cfg.pos + 1, store };
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return { branches, accepted, capped };
}

test('the EPDA search visits what the array-of-arrays search visited', () => {
  for (let m = 0; m < 100; m++) {
    harness.resetApp();
    const { App } = context;
    context.setMachine('EPDA');
    App.config.pdaParadigm = rnd() < 0.5 ? 'explicit' : 'empty';
    App.config.maxPdaSteps = 1500;
    const { eps, any, stackBottom } = App.config.sym;
    App.sigma = new Set(['a', 'b']);
    for (let i = 0; i < 3; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: i, y: 0 });
    App.startId = 's0';
    App.accepts.add('s2');
    for (let k = 0; k < 5 + Math.floor(rnd() * 5); k++) {
      App.transitions.push({
        id: 't' + k, from: 's' + Math.floor(rnd() * 3), to: 's' + Math.floor(rnd() * 3),
        symbol: pick(['a', 'b', eps]), pop: pick([eps, 'A', 'B', stackBottom, any]),
        push: pick([eps, 'A', 'AB', any]), below: pick(['', '', 'A', 'B|A']), above: pick(['', '', 'B', 'AB'])
      });
    }
    for (let w = 0; w < 4; w++) {
      const tokens = Array.from({ length: Math.floor(rnd() * 5) }, () => pick(['a', 'b']));
      const want = oldExploreEPDA(tokens);
      const got = context.exploreEPDA(tokens, { log: 0, witness: false });
      assert.equal(got.branches, want.branches, `machine ${m} word "${tokens.join('')}"`);
      assert.equal(got.accepted, want.accepted);
      assert.equal(got.capped, want.capped);
    }
  }
});

test('the visited set holds exactly the tuples a Set of strings would', () => {
  const set = new context.ConfigSet(4);
  const ref = new Set();
  for (let i = 0; i < 50000; i++) {
    const t = [Math.floor(rnd() * 30), Math.floor(rnd() * 20) - 1, Math.floor(rnd() * 40), -1, Math.floor(rnd() * 3)];
    const k = t.join(',');
    assert.equal(set.add(...t), !ref.has(k));
    ref.add(k);
  }
  assert.equal(set.size, ref.size);
});

// ── 6. a deterministic row of δ ─────────────────────────────────────

test('a run resolves each state as getSingleTapeDeterministicTransition would', () => {
  harness.resetApp();
  const { App, singleTapeLookup, getSingleTapeDeterministicTransition } = context;
  const any = App.config.sym.any;
  const ids = ['t1', 't2', 't9', 't10', 't11', 'x', ''];
  for (let round = 0; round < 40; round++) {
    App.transitions = [];
    for (let k = 0; k < 30; k++) App.transitions.push({ id: pick(ids), from: 's' + Math.floor(rnd() * 3), to: 's0', symbol: pick(['a', 'b', 'c', any]) });
    const check = () => {
      const fires = singleTapeLookup();
      for (let s = 0; s < 4; s++) {
        for (const sym of ['a', 'b', 'c', 'd', any]) {
          assert.equal(fires('s' + s, sym), getSingleTapeDeterministicTransition('s' + s, sym), `s${s} on ${sym}`);
        }
      }
    };
    check();
    // Rows are kept between runs; an edge edited in place must not be missed.
    const t = pick(App.transitions);
    if (rnd() < 0.5) t.symbol = pick(['a', 'b', 'c', any]); else t.id = pick(ids);
    check();
  }
});

// ── 7. the NFA's set ────────────────────────────────────────────────

test('an NFA run reaches the sets, in the order, the Set version did', () => {
  for (let m = 0; m < 80; m++) {
    harness.resetApp();
    const { App, epsClosure, transitionsFrom, stateNames } = context;
    context.setMachine('ε-NFA');
    const { eps, any } = App.config.sym;
    App.sigma = new Set(['a', 'b']);
    const n = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: i, y: 0 });
    App.startId = 's0';
    App.accepts.add('s' + (n - 1));
    for (let k = 0; k < n * 3; k++) App.transitions.push({ id: 't' + k, from: 's' + Math.floor(rnd() * n), to: 's' + Math.floor(rnd() * n), symbol: pick(['a', 'b', eps, any]) });
    for (let w = 0; w < 4; w++) {
      const tokens = Array.from({ length: Math.floor(rnd() * 7) }, () => pick(['a', 'b']));
      let cur = epsClosure(new Set([App.startId]));
      const want = [stateNames(cur)];
      for (const sym of tokens) {
        const nx = new Set();
        cur.forEach(s => { for (const t of transitionsFrom(s)) if (t.symbol === sym || t.symbol === any) nx.add(t.to); });
        cur = epsClosure(nx);
        want.push(stateNames(cur));
        if (!cur.size) break;
      }
      const steps = context.traceMachine('ε-NFA', tokens).steps;
      assert.deepEqual(steps.map(s => stateNames(s.states)), want);
      assert.equal(context.testNFA(tokens), [...cur].some(id => App.accepts.has(id)));
    }
  }
});

// ── 8. the NDTM's tape ──────────────────────────────────────────────

test('a zipper tape is a Tape: same window, same key, same refusals', () => {
  const { Tape } = context;
  for (let trial = 0; trial < 150; trial++) {
    const syms = ['_', 'a', 'bb', 'c'];
    const twoWay = rnd() < 0.5;
    const init = Array.from({ length: Math.floor(rnd() * 5) }, () => pick(syms.slice(1)));
    let t = new Tape(init, '_', twoWay), z = new ZipperTape(init, '_', twoWay);
    const idOf = new Map();
    for (let i = 0; i < 400; i++) {
      assert.deepEqual(z.snapshot(), t.snapshot());
      assert.deepEqual(z.view(), t.view());
      assert.equal(z.key(), t.key());
      const id = `${z.left.id}|${z.cell}|${z.right.id}`;
      if (idOf.has(t.key())) assert.equal(idOf.get(t.key()), id, 'equal keys, equal nodes');
      idOf.set(t.key(), id);
      const w = pick(syms);
      t.write(w); z.write(w);
      const d = pick(['L', 'R', 'R', 'S']);
      assert.equal(z.move(d), t.move(d));
      if (rnd() < 0.05) { t = t.clone(); z = z.clone(); }
    }
  }
});

/** testNDTM3 as it was: a copied Tape and its key string per branch. */
function oldTestNDTM3(tokens, budget) {
  const { App, Tape, transitionsFrom } = context;
  const any = App.config.sym.any;
  const start = new Tape(tokens, App.config.sym.blank, !!App.config.twoWayTape);
  const queue = [{ state: App.startId, tape: start }];
  const seen = new Set([`${App.startId}|${start.key()}`]);
  let expanded = 0;
  for (let h = 0; h < queue.length; h++) {
    if (expanded++ >= budget) return 'unk';
    const cfg = queue[h];
    if (App.accepts.has(cfg.state)) return 'acc';
    const sym = cfg.tape.read();
    for (const tr of transitionsFrom(cfg.state).filter(x => x.symbol === sym || x.symbol === any)) {
      const next = cfg.tape.clone();
      next.write((!tr.write || tr.write === any) ? sym : tr.write);
      next.move(tr.dir);
      const k = `${tr.to}|${next.key()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ state: tr.to, tape: next });
    }
  }
  return 'rej';
}

test('the NDTM decider reaches the verdict the copying decider did', () => {
  const tally = { acc: 0, rej: 0, unk: 0 };
  for (const twoWay of [false, true]) {
    for (let m = 0; m < 80; m++) {
      const App = randomTM(2 + Math.floor(rnd() * 3));
      App.machine = 'NDTM';
      App.config.twoWayTape = twoWay;
      // Branch: a second edge on some (state, symbol) the first already reads.
      for (const t of [...App.transitions]) if (rnd() < 0.3) App.transitions.push({ ...t, id: t.id + 'b', to: 's0', dir: pick(['L', 'R']) });
      for (let w = 0; w < 4; w++) {
        const tokens = Array.from({ length: Math.floor(rnd() * 5) }, () => pick(['a', 'b']));
        const want = oldTestNDTM3(tokens, 300);
        assert.equal(context.testNDTM3(tokens, 300), want, `twoWay=${twoWay} machine ${m} word "${tokens.join('')}"`);
        tally[want]++;
      }
    }
  }
  assert.ok(tally.acc > 20 && tally.rej > 20, JSON.stringify(tally));
});

test('a snapshot of a very long tape does not overflow the argument list', () => {
  const tape = new context.Tape(Array.from({ length: 300000 }, () => 'a'), '_', true);
  assert.equal(tape.snapshot().tape.length, 300000);
});

// ── 9. the note ─────────────────────────────────────────────────────

test('a streamed step writes its note when it is read, from that step', () => {
  harness.resetApp();
  const { App } = context;
  context.setMachine('DFA');
  App.sigma = new Set(['a']);
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 1, y: 0 });
  App.startId = 's0';
  App.accepts.add('s0');
  App.transitions.push({ id: 't0', from: 's0', to: 's1', symbol: 'a' }, { id: 't1', from: 's1', to: 's0', symbol: 'a' });
  const steps = context.traceMachine('DFA', ['a', 'a', 'a']).steps;
  const mid = steps[1];
  assert.equal(Object.prototype.hasOwnProperty.call(mid, 'note'), false, 'not formatted yet');
  assert.equal(mid.note, 'Read \'a\' → q1', 'the state it moved to then, not where the run ended');
  assert.equal(steps[2].note, 'Read \'a\' → q0');
  assert.match(steps.at(-1).note, /REJECT$/, 'a verdict appended in place still lands');
});
