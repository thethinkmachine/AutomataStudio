import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHarness } from './harness.js';

// The four machine families added on top of the FA/PDA/TM/transducer core.
// The example suite proves the shipped machines behave as their notes claim;
// this file pins the semantics those examples only exercise incidentally —
// cut-point comparison, Büchi's "infinitely often" (as opposed to "ends in"),
// output accumulation across ε-moves, and the two-way head's non-halting case.

const h = createHarness();
const ctx = h.context;

function machine({ type, states, start, accepts = [], transitions, sigma = ['a', 'b'], config = {} }) {
  h.resetApp();
  const App = ctx.App;
  App.machine = type;
  App.sigma = new Set(sigma);
  App.stackAlpha = new Set(['Z', 'X', 'A', 'B']);
  App.outputAlpha = new Set(['a', 'b', 'x']);
  App.states = states.map((name, i) => ({ id: `s${i + 1}`, x: 100 * i, y: 100, name }));
  App.startId = `s${states.indexOf(start) + 1}`;
  App.accepts = new Set(accepts.map(n => `s${states.indexOf(n) + 1}`));
  App.transitions = transitions.map((t, i) => ({
    ...t,
    id: `t${i + 1}`,
    from: `s${states.indexOf(t.from) + 1}`,
    to: `s${states.indexOf(t.to) + 1}`
  }));
  App.config = { ...App.config, ...config };
  return App;
}

const tok = w => ctx.tokenize(w);

// ── PFA ────────────────────────────────────────────────────────────
// Two states, and a coin flip on `a` that splits mass evenly. Accepting
// mass after one `a` is exactly 0.5, which is what makes the strictness of
// the cut-point comparison observable rather than a matter of taste.
function coinFlipPFA(cutPoint) {
  return machine({
    type: 'PFA', states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    transitions: [
      { from: 'q0', to: 'q0', symbol: 'a', weight: 0.5 },
      { from: 'q0', to: 'q1', symbol: 'a', weight: 0.5 },
      { from: 'q1', to: 'q1', symbol: 'a', weight: 1 }
    ],
    config: { pfaCutPoint: cutPoint }
  });
}

test('PFA: acceptance is strictly above the cut-point, not at it', () => {
  coinFlipPFA(0.5);
  assert.equal(ctx.testPFA(tok('a')), false, 'P = 0.5 must not clear λ = 0.5');
  coinFlipPFA(0.4);
  assert.equal(ctx.testPFA(tok('a')), true, 'P = 0.5 clears λ = 0.4');
});

test('PFA: mass accumulates across steps rather than tracking one path', () => {
  coinFlipPFA(0.5);
  // Once in q1 the machine stays; each further `a` moves another half of the
  // remaining q0 mass across, so P(aⁿ) = 1 − 2⁻ⁿ.
  const dists = ctx.runPFA(tok('aaa'));
  assert.equal(ctx.pfaAcceptMass(dists[1]), 0.5);
  assert.equal(ctx.pfaAcceptMass(dists[2]), 0.75);
  assert.equal(ctx.pfaAcceptMass(dists[3]), 0.875);
  assert.equal(ctx.testPFA(tok('aaa')), true);
});

test('PFA: total probability is conserved when every row sums to 1', () => {
  coinFlipPFA(0.5);
  for (const dist of ctx.runPFA(tok('aaaa'))) {
    const total = [...dist.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `mass ${total} should stay 1`);
  }
});

test('PFA: a row that does not sum to 1 is reported, not silently renormalised', () => {
  machine({
    type: 'PFA', states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    transitions: [
      { from: 'q0', to: 'q1', symbol: 'a', weight: 0.3 },
      { from: 'q0', to: 'q0', symbol: 'a', weight: 0.3 }
    ]
  });
  const bad = ctx.pfaMalformedRows();
  assert.equal(bad.length, 1);
  assert.ok(Math.abs(bad[0].total - 0.6) < 1e-9);
});

// ── Büchi ──────────────────────────────────────────────────────────
// "Infinitely often a": q1 is entered exactly on an a.
function infinitelyOftenA() {
  return machine({
    type: 'NBA', states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    transitions: [
      { from: 'q0', to: 'q0', symbol: 'b' },
      { from: 'q0', to: 'q1', symbol: 'a' },
      { from: 'q1', to: 'q1', symbol: 'a' },
      { from: 'q1', to: 'q0', symbol: 'b' }
    ]
  });
}

test('Büchi: acceptance needs F infinitely often, not F at the end', () => {
  infinitelyOftenA();
  // a(b) drives the run through the accepting state once and then never
  // again. A finite-word reading would accept it; Büchi must not.
  assert.equal(ctx.testNBA(tok('a'), tok('b')), false);
  assert.equal(ctx.testNBA([], tok('a')), true);
  assert.equal(ctx.testNBA([], tok('ab')), true);
  assert.equal(ctx.testNBA([], tok('b')), false);
});

test('Büchi: the prefix cannot rescue a period that avoids F', () => {
  infinitelyOftenA();
  assert.equal(ctx.testNBA(tok('aaaa'), tok('b')), false);
  assert.equal(ctx.testNBA(tok('bbbb'), tok('a')), true);
});

test('Büchi: nondeterminism is resolved by finding some accepting lasso', () => {
  // FG b — the standard language with no deterministic Büchi automaton. The
  // machine must guess when the last a has passed.
  machine({
    type: 'NBA', states: ['any', 'onlyB'], start: 'any', accepts: ['onlyB'],
    transitions: [
      { from: 'any', to: 'any', symbol: 'a' },
      { from: 'any', to: 'any', symbol: 'b' },
      { from: 'any', to: 'onlyB', symbol: 'b' },
      { from: 'onlyB', to: 'onlyB', symbol: 'b' }
    ]
  });
  assert.equal(ctx.testNBA(tok('aaa'), tok('b')), true, 'guess after the a-block');
  assert.equal(ctx.testNBA([], tok('ab')), false, 'a recurs forever');
});

test('Büchi: the witness run is a lasso whose cycle touches F', () => {
  infinitelyOftenA();
  const r = ctx.exploreNBA([], tok('ab'));
  assert.equal(r.accepted, true);
  assert.ok(r.loop.length > 0, 'an accepting run must close a cycle');
  assert.ok(r.loop.some(n => ctx.App.accepts.has(n.state)), 'the cycle visits F');
});

test('parseOmegaWord splits u(v) and rejects a word with no period', () => {
  assert.deepEqual(ctx.parseOmegaWord('ab(ba)'), { prefix: 'ab', period: 'ba' });
  assert.deepEqual(ctx.parseOmegaWord('(a)'), { prefix: '', period: 'a' });
  assert.equal(ctx.parseOmegaWord('abba'), null);
});

// ── Pushdown transducer ────────────────────────────────────────────
// Push a marker per symbol, then pop on ε-moves printing as it goes: w ↦ wᴿ.
function reversingPDT() {
  return machine({
    type: 'PDT', states: ['push', 'pop', 'done'], start: 'push', accepts: ['done'],
    transitions: [
      { from: 'push', to: 'push', symbol: 'a', pop: 'ε', push: 'A', output: '' },
      { from: 'push', to: 'push', symbol: 'b', pop: 'ε', push: 'B', output: '' },
      { from: 'push', to: 'pop', symbol: 'ε', pop: 'ε', push: 'ε', output: '' },
      { from: 'pop', to: 'pop', symbol: 'ε', pop: 'A', push: 'ε', output: 'a' },
      { from: 'pop', to: 'pop', symbol: 'ε', pop: 'B', push: 'ε', output: 'b' },
      { from: 'pop', to: 'done', symbol: 'ε', pop: 'Z', push: 'Z', output: '' }
    ],
    config: { transducerAccepts: true, pdaParadigm: 'explicit' }
  });
}

test('PDT: output accumulates across ε-moves after the input is consumed', () => {
  reversingPDT();
  assert.equal(ctx.testPDT(tok('ab')).output, 'ba');
  assert.equal(ctx.testPDT(tok('abb')).output, 'bba');
  assert.equal(ctx.testPDT(tok('aabb')).output, 'bbaa');
});

test('PDT: the stack decides membership while the output computes the relation', () => {
  // aⁿbⁿ ↦ bⁿaⁿ: unbalanced input reaches no accepting configuration.
  machine({
    type: 'PDT', states: ['a', 'b', 'ok'], start: 'a', accepts: ['ok'],
    transitions: [
      { from: 'a', to: 'a', symbol: 'a', pop: 'ε', push: 'X', output: 'b' },
      { from: 'a', to: 'b', symbol: 'b', pop: 'X', push: 'ε', output: 'a' },
      { from: 'b', to: 'b', symbol: 'b', pop: 'X', push: 'ε', output: 'a' },
      { from: 'b', to: 'ok', symbol: 'ε', pop: 'Z', push: 'Z', output: '' }
    ],
    config: { transducerAccepts: true, pdaParadigm: 'explicit' }
  });
  assert.deepEqual(
    ['ab', 'aabb', 'aaabbb'].map(w => ctx.testPDT(tok(w)).output),
    ['ba', 'bbaa', 'bbbaaa']
  );
  assert.equal(ctx.testPDT(tok('aab')).accepted, false);
  assert.equal(ctx.testPDT(tok('abb')).accepted, false);
});

test('PDT: with an acceptance condition, only accepting runs contribute output', () => {
  reversingPDT();
  const steps = ctx.App.simSteps;
  ctx.simPDT(tok('ab'));
  const last = ctx.App.simSteps[ctx.App.simSteps.length - 1];
  assert.equal(last.outSoFar, 'ba');
  // The partial pops ("", "b") are configurations the search passes through,
  // never accepting ones, so they must not appear in the transduction.
  assert.deepEqual([...ctx.explorePDT(tok('ab')).outputs], ['ba']);
  assert.ok(Array.isArray(steps));
});

// ── Two-way transducer ─────────────────────────────────────────────
function doublingDFT() {
  const L = '⊢', R = '⊣';
  return machine({
    type: '2DFT', states: ['start', 'c1', 'rew', 'c2', 'done'], start: 'start', accepts: ['done'],
    transitions: [
      { from: 'start', to: 'c1', symbol: L, dir: 'R', output: '' },
      { from: 'c1', to: 'c1', symbol: 'a', dir: 'R', output: 'a' },
      { from: 'c1', to: 'c1', symbol: 'b', dir: 'R', output: 'b' },
      { from: 'c1', to: 'rew', symbol: R, dir: 'L', output: '' },
      { from: 'rew', to: 'rew', symbol: 'a', dir: 'L', output: '' },
      { from: 'rew', to: 'rew', symbol: 'b', dir: 'L', output: '' },
      { from: 'rew', to: 'c2', symbol: L, dir: 'R', output: '' },
      { from: 'c2', to: 'c2', symbol: 'a', dir: 'R', output: 'a' },
      { from: 'c2', to: 'c2', symbol: 'b', dir: 'R', output: 'b' },
      { from: 'c2', to: 'done', symbol: R, dir: 'S', output: '' }
    ],
    config: { transducerAccepts: true }
  });
}

test('2DFT: re-reading the tape computes w ↦ ww, which no one-way FST can', () => {
  doublingDFT();
  for (const w of ['a', 'ab', 'abb', 'aabb']) {
    const r = ctx.test2DFT(tok(w));
    assert.equal(r.accepted, true, `${w} should halt in an accepting state`);
    assert.equal(r.output, w + w, `${w} doubles`);
  }
});

test('2DFT: a head that never halts reports no verdict rather than a rejection', () => {
  const L = '⊢';
  machine({
    type: '2DFT', states: ['spin'], start: 'spin', accepts: [],
    transitions: [
      { from: 'spin', to: 'spin', symbol: L, dir: 'R', output: 'x' },
      { from: 'spin', to: 'spin', symbol: 'a', dir: 'L', output: 'x' }
    ],
    config: { transducerAccepts: true, maxTmSteps: 200 }
  });
  const r = ctx.test2DFT(tok('a'));
  assert.equal(r.halted, false, 'bouncing between ⊢ and a never terminates');
  assert.equal(r.accepted, false);
});

test('2DFT: output is empty until the machine actually prints', () => {
  const L = '⊢', R = '⊣';
  machine({
    type: '2DFT', states: ['scan', 'back', 'done'], start: 'scan', accepts: ['done'],
    transitions: [
      { from: 'scan', to: 'scan', symbol: L, dir: 'R', output: '' },
      { from: 'scan', to: 'scan', symbol: 'a', dir: 'R', output: '' },
      { from: 'scan', to: 'scan', symbol: 'b', dir: 'R', output: '' },
      { from: 'scan', to: 'back', symbol: R, dir: 'L', output: '' },
      { from: 'back', to: 'back', symbol: 'a', dir: 'L', output: 'a' },
      { from: 'back', to: 'back', symbol: 'b', dir: 'L', output: 'b' },
      { from: 'back', to: 'done', symbol: L, dir: 'S', output: '' }
    ],
    config: { transducerAccepts: true }
  });
  assert.equal(ctx.test2DFT(tok('ab')).output, 'ba', 'silent pass then print on the way back');
});

// ── shared plumbing ────────────────────────────────────────────────
test('every new machine is reachable from the model picker', () => {
  const listed = new Set(ctx.MachineCategories.flatMap(c => c.machines));
  for (const m of ['PFA', 'NBA', 'PDT', '2DFT']) {
    assert.ok(listed.has(m), `${m} must appear in a MachineCategories group`);
    assert.ok(ctx.MachineTypes[m], `${m} must have a MachineTypes entry`);
  }
});

test('a saved workspace round-trips the new per-transition fields', () => {
  reversingPDT();
  const blob = ctx.exportWorkspaceState();
  h.resetApp();
  ctx.importWorkspaceState(JSON.parse(JSON.stringify(blob)));
  assert.equal(ctx.App.machine, 'PDT');
  assert.equal(ctx.testPDT(tok('ab')).output, 'ba');

  coinFlipPFA(0.5);
  const pfaBlob = ctx.exportWorkspaceState();
  h.resetApp();
  ctx.importWorkspaceState(JSON.parse(JSON.stringify(pfaBlob)));
  assert.equal(ctx.App.transitions[0].weight, 0.5, 'weights survive save/load');
});

// ── the transduction relation, shared by FST and PDT ───────────────
// One input, three complete runs: two land in F emitting different strings,
// one lands outside F. With an acceptance condition on, the relation is the
// two accepting outputs — the third is not a pair, and neither may be dropped.
function ambiguousFST() {
  return machine({
    type: 'FST', states: ['q0', 'acc1', 'acc2', 'dead'], start: 'q0',
    accepts: ['acc1', 'acc2'],
    transitions: [
      { from: 'q0', to: 'acc1', symbol: 'a', output: 'x' },
      { from: 'q0', to: 'acc2', symbol: 'a', output: 'b' },
      { from: 'q0', to: 'dead', symbol: 'a', output: 'a' }
    ],
    config: { transducerAccepts: true }
  });
}

test('FST: with acceptance on, only accepting runs enter the transduction', () => {
  ambiguousFST();
  const outs = [...ctx.exploreFST(tok('a')).outputs].sort();
  assert.deepEqual(outs, ['b', 'x'], 'the run halting outside F contributes nothing');
});

test('FST: every accepting run contributes, not just the first one found', () => {
  ambiguousFST();
  assert.equal(ctx.exploreFST(tok('a')).outputs.size, 2, 'the relation must not be truncated');
});

test('FST: with acceptance off, every complete run contributes', () => {
  ambiguousFST();
  ctx.App.config.transducerAccepts = false;
  const outs = [...ctx.exploreFST(tok('a')).outputs].sort();
  assert.deepEqual(outs, ['a', 'b', 'x'], 'without F there is nothing to filter on');
});

test('PDT: applies the same relation rule as FST', () => {
  // Same shape through the pushdown machinery: two accepting runs, one dead.
  machine({
    type: 'PDT', states: ['q0', 'acc1', 'acc2', 'dead'], start: 'q0',
    accepts: ['acc1', 'acc2'],
    transitions: [
      { from: 'q0', to: 'acc1', symbol: 'a', pop: 'ε', push: 'ε', output: 'x' },
      { from: 'q0', to: 'acc2', symbol: 'a', pop: 'ε', push: 'ε', output: 'b' },
      { from: 'q0', to: 'dead', symbol: 'a', pop: 'ε', push: 'ε', output: 'a' }
    ],
    config: { transducerAccepts: true, pdaParadigm: 'explicit' }
  });
  assert.deepEqual([...ctx.explorePDT(tok('a')).outputs].sort(), ['b', 'x']);
  ctx.App.config.transducerAccepts = false;
  assert.deepEqual([...ctx.explorePDT(tok('a')).outputs].sort(), ['a', 'b', 'x']);
});

// ── batch testing ──────────────────────────────────────────────────
// The batch panel is a second decision path, independent of runSim: it
// tokenizes its own lines and dispatches per machine. A family missing from
// that dispatch reports "cannot tokenize" for perfectly good input.
test('batch: PFA decides against the cut-point and scores expectations', () => {
  coinFlipPFA(0.4);
  const b = ctx.computeBatchResults(['a => accept', 'aa => accept']);
  assert.equal(b.expected, 2);
  assert.equal(b.passCount, 2);
  assert.ok(b.results.every(r => !r.error), 'PFA input must tokenize');
});

test('batch: Büchi accepts u(v) lines and flags a word with no period', () => {
  infinitelyOftenA();
  const b = ctx.computeBatchResults(['(a) => accept', '(b) => reject', 'a(b)', 'abab']);
  assert.equal(b.passCount, 2, 'both expectations hold');
  assert.equal(b.results[2].verdict, 'reject', 'a(b) has finitely many a');
  assert.equal(b.results[3].error, true, 'a bare finite word is not an ω-word');
});

test('batch: transducers carry their output through to the results', () => {
  reversingPDT();
  const pdt = ctx.computeBatchResults(['ab', 'abb']);
  assert.deepEqual(pdt.results.map(r => r.output), ['ba', 'bba']);

  doublingDFT();
  const dft = ctx.computeBatchResults(['ab', 'a']);
  assert.deepEqual(dft.results.map(r => r.output), ['abab', 'aa']);
});

test('batch: a 2DFT that never halts is unknown, not a rejection', () => {
  const L = '⊢';
  machine({
    type: '2DFT', states: ['spin'], start: 'spin', accepts: [],
    transitions: [
      { from: 'spin', to: 'spin', symbol: L, dir: 'R', output: 'x' },
      { from: 'spin', to: 'spin', symbol: 'a', dir: 'L', output: 'x' }
    ],
    config: { transducerAccepts: true, maxTmSteps: 200 }
  });
  const b = ctx.computeBatchResults(['a']);
  assert.equal(b.results[0].verdict, 'unknown');
  assert.equal(b.unknowns, 1);
});

test('batch results export renders for every new machine', () => {
  const cases = [coinFlipPFA.bind(null, 0.4), infinitelyOftenA, reversingPDT, doublingDFT];
  const lines = [['a'], ['(a)'], ['ab'], ['ab']];
  cases.forEach((setup, i) => {
    setup();
    const b = ctx.computeBatchResults(lines[i]);
    for (const format of ['markdown', 'csv']) {
      const txt = ctx.exportBatchText(b, { format });
      assert.ok(txt && txt.length, `${ctx.App.machine} ${format} export must produce text`);
    }
  });
});

test('a Büchi automaton yields no finite-word language samples', () => {
  infinitelyOftenA();
  const s = ctx.exportSampleWords({ accepted: 4, rejected: 4, maxLength: 3 });
  assert.equal(s.decidable, false, 'a set of infinite words has no finite-word samples');
  assert.equal(s.accepted.length + s.rejected.length, 0);
});

test('switching into every machine wires its panels without throwing', () => {
  // applyMachineSwitch touches the badge, the Γ/Δ sections, the model picker
  // and the simulate input. A machine missing from any of those lists fails
  // here rather than as a blank panel in the browser.
  for (const m of Object.keys(ctx.MachineTypes)) {
    h.resetApp();
    assert.doesNotThrow(() => ctx.applyMachineSwitch(m), `applyMachineSwitch('${m}')`);
    assert.equal(ctx.App.machine, m);
  }
});

test('the ω-automaton advertises its input format in the simulate box', () => {
  h.resetApp();
  ctx.applyMachineSwitch('NBA');
  assert.match(ctx.$('sim-in').placeholder, /u\(v\)/, 'Büchi needs the u(v) hint');
  ctx.applyMachineSwitch('DFA');
  assert.equal(ctx.$('sim-in').placeholder, ctx.App.config.sym.eps);
});

test('every bundled example survives the import validator', () => {
  // loadExample fetches straight to loadData, so this path is the only thing
  // standing between a shipped example and a user who saves one and drags it
  // back in. tm.json and ndtm.json used to fail it.
  const dir = new URL('../js/examples/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    assert.doesNotThrow(() => ctx.validateSchema(data), `${f} must pass validateSchema`);
  }
});

test('validateSchema accepts the new machines and rejects an out-of-range probability', () => {
  const base = {
    machine: 'PFA', sigma: ['a'], accepts: [],
    states: [{ id: 's1' }], startId: 's1',
    transitions: [{ id: 't1', from: 's1', to: 's1', symbol: 'a', weight: 0.5 }]
  };
  assert.doesNotThrow(() => ctx.validateSchema(base));
  assert.throws(
    () => ctx.validateSchema({ ...base, transitions: [{ ...base.transitions[0], weight: 1.7 }] }),
    /between 0 and 1/
  );
});
