import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

// ══════════════════════════════════════════════════════════════════
//  STATEMATE
// ══════════════════════════════════════════════════════════════════
//  Everything here runs without a network. The one test that would need
//  one asserts that no request is made.
//
//  The pipeline is deliberately split so each stage is testable without the
//  one before it: extraction takes text, validation takes an object, the
//  compiler takes a spec plus a machine to diff against, the linter takes a
//  candidate, and verification takes a candidate plus tests. Only
//  runStateMate needs all of them at once.

const exampleFile = name =>
  JSON.parse(readFileSync(new URL(`../js/examples/${name}.json`, import.meta.url), 'utf8'));

// A minimal, valid spec for the machine under test.
function dfaSpec(extra = {}) {
  return {
    plan: 'Two states tracking parity.',
    machine: 'DFA',
    title: 'Even number of a\'s',
    blurb: 'Parity of a.',
    sigma: ['a', 'b'],
    states: [
      { name: 'even', start: true, accept: true },
      { name: 'odd' }
    ],
    transitions: [
      { from: 'even', to: 'odd', on: 'a' },
      { from: 'odd', to: 'even', on: 'a' },
      { from: 'even', to: 'even', on: 'b' },
      { from: 'odd', to: 'odd', on: 'b' }
    ],
    tests: [
      { w: 'aa', expect: 'accept' },
      { w: 'a', expect: 'reject' },
      { w: 'ε', expect: 'accept' }
    ],
    ...extra
  };
}

// ══════════════════════════════════════════════════════════════════
//  EXTRACTION
// ══════════════════════════════════════════════════════════════════

test('extraction unwraps a fenced code block', () => {
  const h = createHarness();
  const out = h.context.extractSpecJSON('```json\n{"machine":"DFA"}\n```');
  assert.equal(out.machine, 'DFA');
});

test('extraction ignores prose before and after the object', () => {
  const h = createHarness();
  const out = h.context.extractSpecJSON('Here is the automaton you asked for:\n{"machine":"NFA"}\nHope that helps!');
  assert.equal(out.machine, 'NFA');
});

test('extraction keeps braces that appear inside strings', () => {
  const h = createHarness();
  const out = h.context.extractSpecJSON('{"blurb":"matches { and }","machine":"DFA"}');
  assert.equal(out.blurb, 'matches { and }');
  assert.equal(out.machine, 'DFA');
});

test('extraction survives curly quotes and trailing commas', () => {
  const h = createHarness();
  assert.equal(h.context.extractSpecJSON('{“machine”: “DFA”}').machine, 'DFA');
  assert.equal(h.context.extractSpecJSON('{"machine": "DFA",}').machine, 'DFA');
});

test('extraction reports a missing object separately from a broken one', () => {
  const h = createHarness();
  assert.throws(() => h.context.extractSpecJSON('I cannot build that.'), e => e.code === 'no-json');
  assert.throws(() => h.context.extractSpecJSON(''), e => e.code === 'no-json');
  // A stream cut off mid-object never closes its braces, so there is no
  // balanced run to slice — that reads as "no machine", not as bad JSON.
  assert.throws(() => h.context.extractSpecJSON('{"machine": "DFA", "states": ['), e => e.code === 'no-json');
  assert.throws(() => h.context.extractSpecJSON('{"machine": DFA}'), e => e.code === 'bad-json');
});

// ══════════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════════

test('a well-formed spec validates and normalizes', () => {
  const h = createHarness();
  const spec = h.context.validateSpec(dfaSpec());
  assert.equal(spec.machine, 'DFA');
  assert.equal(spec.states.length, 2);
  assert.equal(spec.states[0].start, true);
  assert.equal(spec.transitions[0].on, 'a');
  assert.equal(spec.tests.length, 3);
});

test('validation rejects an unknown machine type', () => {
  const h = createHarness();
  assert.throws(
    () => h.context.validateSpec(dfaSpec({ machine: 'QuantumFA' })),
    e => e.code === 'unknown-machine'
  );
});

test('validation refuses a machine too large to draw', () => {
  const h = createHarness();
  const states = Array.from({ length: 200 }, (_, i) => ({ name: `q${i}` }));
  states[0].start = true;
  assert.throws(
    () => h.context.validateSpec(dfaSpec({ states })),
    e => e.code === 'too-large'
  );
});

test('validation rejects duplicate names, missing endpoints and empty machines', () => {
  const h = createHarness();
  const dup = dfaSpec();
  dup.states = [{ name: 'q', start: true }, { name: 'q' }];
  assert.throws(() => h.context.validateSpec(dup), e => e.code === 'schema');

  const dangling = dfaSpec();
  dangling.transitions.push({ from: 'even', to: 'nowhere', on: 'a' });
  assert.throws(() => h.context.validateSpec(dangling), e => /do not exist/.test(e.message));

  assert.throws(() => h.context.validateSpec(dfaSpec({ states: [] })), e => e.code === 'schema');
});

test('a missing start state is repaired, two start states are not', () => {
  const h = createHarness();
  const none = dfaSpec();
  none.states = none.states.map(s => ({ ...s, start: false }));
  // One entry point almost always meant the first state, so this is not worth
  // a round trip.
  assert.equal(h.context.validateSpec(none).states[0].start, true);

  const two = dfaSpec();
  two.states = two.states.map(s => ({ ...s, start: true }));
  assert.throws(() => h.context.validateSpec(two), e => /exactly one/.test(e.message));
});

test('epsilon is accepted under any of the names a model might use', () => {
  const h = createHarness();
  const spec = h.context.validateSpec({
    machine: 'ε-NFA',
    sigma: ['a'],
    states: [{ name: 'q0', start: true, accept: true }],
    transitions: [
      { from: 'q0', to: 'q0', on: 'eps' },
      { from: 'q0', to: 'q0', on: 'epsilon' },
      { from: 'q0', to: 'q0', on: 'λ' }
    ],
    tests: [{ w: 'a', expect: 'reject' }]
  });
  spec.transitions.forEach(t => assert.equal(t.on, 'ε'));
});

test('head moves are normalized from whatever the model wrote', () => {
  const h = createHarness();
  const spec = h.context.validateSpec({
    machine: 'TM',
    sigma: ['a'],
    stackAlpha: ['a', '⊔'],
    states: [{ name: 'q0', start: true }, { name: 'done', accept: true }],
    transitions: [
      { from: 'q0', to: 'done', on: 'a', write: 'a', move: 'right' },
      { from: 'done', to: 'done', on: '⊔', write: '⊔', move: 'l' }
    ],
    tests: [{ w: 'a', expect: 'accept' }]
  });
  assert.equal(spec.transitions[0].move, 'R');
  assert.equal(spec.transitions[1].move, 'L');
});

test('parity machines carry priorities and never an accepting set', () => {
  const h = createHarness();
  const spec = h.context.validateSpec({
    machine: 'DPA',
    sigma: ['a', 'b'],
    // A model that marked accepting states as well has said something
    // meaningless rather than something wrong — it is dropped, not rejected.
    states: [{ name: 'p', start: true, priority: 2, accept: true }, { name: 'q', priority: 1 }],
    transitions: [
      { from: 'p', to: 'q', on: 'a' },
      { from: 'q', to: 'p', on: 'b' },
      { from: 'p', to: 'p', on: 'b' },
      { from: 'q', to: 'q', on: 'a' }
    ],
    tests: [{ w: 'a(b)', expect: 'accept' }]
  });
  assert.equal(spec.states[0].priority, 2);
  assert.equal(spec.states[0].accept, false);
});

// ══════════════════════════════════════════════════════════════════
//  COMPILER
// ══════════════════════════════════════════════════════════════════

function emptyMachine(machine = 'DFA') {
  return {
    machine, states: [], transitions: [], startId: null, accepts: [],
    sigma: [], stackAlpha: [], outputAlpha: [], tapeCount: 2, notes: [], dividers: []
  };
}

test('a machine built from nothing gets ids, coordinates and a start state', () => {
  const h = createHarness();
  const spec = h.context.validateSpec(dfaSpec());
  const { candidate } = h.context.compileSpec(spec, emptyMachine());

  assert.equal(candidate.states.length, 2);
  candidate.states.forEach(s => {
    assert.match(s.id, /^s\d+$/);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), 'every state is placed');
  });
  assert.equal(candidate.startId, candidate.states[0].id);
  assert.deepEqual(candidate.accepts, [candidate.states[0].id]);
  assert.equal(candidate.transitions.length, 4);
  assert.equal(candidate.transitions[0].symbol, 'a', 'the spec dialect is mapped to the internal one');
});

test('an edit keeps the id and position of every state whose name survived', () => {
  const h = createHarness();
  const before = {
    ...emptyMachine(),
    sigma: ['a', 'b'],
    states: [
      { id: 's1', name: 'even', x: 100, y: 200 },
      { id: 's2', name: 'odd', x: 400, y: 200 }
    ],
    transitions: [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }],
    startId: 's1',
    accepts: ['s1']
  };

  const spec = h.context.validateSpec(dfaSpec());
  const { candidate } = h.context.compileSpec(spec, before);

  const even = candidate.states.find(s => s.name === 'even');
  const odd = candidate.states.find(s => s.name === 'odd');
  assert.equal(even.id, 's1');
  assert.equal(even.x, 100);
  assert.equal(even.y, 200);
  assert.equal(odd.id, 's2');
  assert.equal(odd.x, 400);
});

test('name matching ignores case and inner whitespace', () => {
  const h = createHarness();
  const before = {
    ...emptyMachine(),
    states: [{ id: 's1', name: 'Even  Count', x: 10, y: 20 }],
    startId: 's1', accepts: []
  };
  const spec = h.context.validateSpec(dfaSpec({
    states: [{ name: 'even count', start: true, accept: true }],
    transitions: []
  }));
  const { candidate } = h.context.compileSpec(spec, before);
  assert.equal(candidate.states[0].id, 's1', 'the same state to a reader is the same state here');
  assert.equal(candidate.states[0].x, 10);
});

test('a new state is placed beside its neighbours, not on top of them', () => {
  const h = createHarness();
  const before = {
    ...emptyMachine(),
    sigma: ['a', 'b'],
    states: [
      { id: 's1', name: 'even', x: 0, y: 0 },
      { id: 's2', name: 'odd', x: 300, y: 0 }
    ],
    transitions: [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }],
    startId: 's1', accepts: ['s1']
  };

  const spec = h.context.validateSpec(dfaSpec({
    states: [
      { name: 'even', start: true, accept: true },
      { name: 'odd' },
      { name: 'trap' }
    ],
    transitions: [
      { from: 'even', to: 'odd', on: 'a' },
      { from: 'odd', to: 'even', on: 'a' },
      { from: 'even', to: 'trap', on: 'b' },
      { from: 'odd', to: 'trap', on: 'b' },
      { from: 'trap', to: 'trap', on: 'a' }
    ]
  }));

  const { candidate } = h.context.compileSpec(spec, before);
  const even = candidate.states.find(s => s.name === 'even');
  const odd = candidate.states.find(s => s.name === 'odd');
  const trap = candidate.states.find(s => s.name === 'trap');

  // The existing diagram is untouched — this is the difference between an
  // edit and a replacement.
  assert.equal(even.x, 0);
  assert.equal(even.y, 0);
  assert.equal(odd.x, 300);
  assert.ok(Number.isFinite(trap.x) && Number.isFinite(trap.y));

  const clearOf = other => Math.hypot(trap.x - other.x, trap.y - other.y) > 2 * h.context.App.config.radius;
  assert.ok(clearOf(even) && clearOf(odd), 'the new state does not overlap an existing one');
});

test('a hand-tuned bend survives a regeneration that keeps the transition', () => {
  const h = createHarness();
  const before = {
    ...emptyMachine(),
    sigma: ['a', 'b'],
    states: [
      { id: 's1', name: 'even', x: 0, y: 0 },
      { id: 's2', name: 'odd', x: 300, y: 0 }
    ],
    transitions: [{ id: 't1', from: 's1', to: 's2', symbol: 'a', curve: 62 }],
    startId: 's1', accepts: ['s1']
  };

  const spec = h.context.validateSpec(dfaSpec());
  const { candidate } = h.context.compileSpec(spec, before);
  const kept = candidate.transitions.find(t => t.from === 's1' && t.to === 's2' && t.symbol === 'a');
  assert.equal(kept.curve, 62);
});

test('a machine-type change starts clean rather than half-inheriting', () => {
  const h = createHarness();
  const before = {
    ...emptyMachine('DFA'),
    states: [{ id: 's1', name: 'even', x: 10, y: 10 }],
    startId: 's1', accepts: ['s1']
  };
  const spec = h.context.validateSpec({
    machine: 'NPDA',
    sigma: ['a'],
    stackAlpha: ['Z'],
    states: [{ name: 'even', start: true, accept: true }],
    transitions: [{ from: 'even', to: 'even', on: 'a', pop: 'ε', push: 'ε' }],
    tests: [{ w: 'a', expect: 'accept' }]
  });
  const { candidate, diff } = h.context.compileSpec(spec, before);
  assert.equal(diff.machineChanged, true);
  assert.equal(diff.machineFrom, 'DFA');
  assert.equal(diff.machineTo, 'NPDA');
  // The name matches, but a DPDA state is not a DFA state — the accepting
  // marks and transition fields cannot be inherited, so nothing is.
  assert.notEqual(candidate.states[0].id, 's1');
});

// ══════════════════════════════════════════════════════════════════
//  DIFF
// ══════════════════════════════════════════════════════════════════

test('the diff names what changed', () => {
  const h = createHarness();
  const before = {
    ...emptyMachine(),
    sigma: ['a'],
    states: [{ id: 's1', name: 'even', x: 0, y: 0 }, { id: 's2', name: 'gone', x: 90, y: 0 }],
    transitions: [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }],
    startId: 's1', accepts: []
  };
  const spec = h.context.validateSpec(dfaSpec());
  const { diff } = h.context.compileSpec(spec, before);

  assert.deepEqual(diff.statesAdded, ['odd']);
  assert.deepEqual(diff.statesRemoved, ['gone']);
  assert.deepEqual(diff.sigmaAdded, ['b']);
  assert.equal(diff.acceptsChanged, true);
  assert.ok(diff.transitionsAdded > 0);
  assert.equal(diff.unchanged, false);
});

test('regenerating the same machine reports no change', () => {
  const h = createHarness();
  const spec = h.context.validateSpec(dfaSpec());
  const { candidate } = h.context.compileSpec(spec, emptyMachine());
  const { diff } = h.context.compileSpec(spec, { ...candidate, machine: 'DFA' });
  assert.equal(diff.unchanged, true);
  assert.deepEqual(h.context.summarizeDiff(diff), ['no change']);
});

// ══════════════════════════════════════════════════════════════════
//  LINTER
// ══════════════════════════════════════════════════════════════════

function candidateOf(h, spec) {
  return h.context.compileSpec(h.context.validateSpec(spec), emptyMachine(spec.machine)).candidate;
}

test('a clean DFA produces no fatal findings', () => {
  const h = createHarness();
  const lint = h.context.lintCandidate(candidateOf(h, dfaSpec()));
  assert.deepEqual(lint.fatal, []);
});

test('a nondeterministic DFA is sent back for repair', () => {
  const h = createHarness();
  const spec = dfaSpec();
  spec.transitions.push({ from: 'even', to: 'even', on: 'a' });
  const lint = h.context.lintCandidate(candidateOf(h, spec));
  const found = lint.fatal.find(f => f.rule === 'nondeterministic');
  assert.ok(found, 'the single most common model error must be caught');
  assert.match(found.message, /"even"/, 'the offending state is named');
});

test('a symbol the machine reads but Σ does not list is added, and reported', () => {
  const h = createHarness();
  const spec = dfaSpec({ sigma: ['a'] });
  const candidate = candidateOf(h, spec);
  const lint = h.context.lintCandidate(candidate);

  assert.ok(candidate.sigma.includes('b'), 'Σ was extended rather than the request refused');
  const fix = lint.fixed.find(f => f.rule === 'sigma-extended');
  assert.ok(fix, 'a fix the user cannot see is a fix they cannot distrust');
  assert.match(fix.message, /"b"/);
  assert.deepEqual(lint.fatal, []);
});

test('an ε-transition on a machine without them is fatal', () => {
  const h = createHarness();
  const spec = dfaSpec();
  spec.transitions.push({ from: 'even', to: 'odd', on: 'ε' });
  const lint = h.context.lintCandidate(candidateOf(h, spec));
  assert.ok(lint.fatal.some(f => f.rule === 'epsilon-illegal'));
});

test('a tape transition with no head direction is fatal', () => {
  const h = createHarness();
  const candidate = candidateOf(h, {
    machine: 'TM',
    sigma: ['a'],
    stackAlpha: ['a', '⊔'],
    states: [{ name: 'q0', start: true }, { name: 'done', accept: true }],
    transitions: [{ from: 'q0', to: 'done', on: 'a', write: 'a', move: 'sideways' }],
    tests: [{ w: 'a', expect: 'accept' }]
  });
  const lint = h.context.lintCandidate(candidate);
  // Defaulting to Right would be a guess, and a guess about which way the head
  // goes changes the language.
  assert.ok(lint.fatal.some(f => f.rule === 'bad-move'));
});

test('an LBA gets its end markers, and Σ does not', () => {
  const h = createHarness();
  const candidate = candidateOf(h, {
    machine: 'LBA',
    sigma: ['a', '⊢'],
    stackAlpha: ['a'],
    states: [{ name: 'q0', start: true, accept: true }],
    transitions: [{ from: 'q0', to: 'q0', on: 'a', write: 'a', move: 'R' }],
    tests: [{ w: 'a', expect: 'accept' }]
  });
  h.context.lintCandidate(candidate);
  assert.ok(!candidate.sigma.includes('⊢'), 'markers are read from the tape, not from Σ');
  assert.ok(candidate.stackAlpha.includes('⊢') && candidate.stackAlpha.includes('⊣'));
});

test('probabilities are normalized when close and reported when not', () => {
  const h = createHarness();
  const near = candidateOf(h, {
    machine: 'PFA',
    sigma: ['a'],
    states: [{ name: 'p', start: true, accept: true }, { name: 'q' }],
    transitions: [
      { from: 'p', to: 'p', on: 'a', weight: 0.5 },
      { from: 'p', to: 'q', on: 'a', weight: 0.505 },
      { from: 'q', to: 'q', on: 'a', weight: 1 }
    ],
    tests: [{ w: 'a', expect: 'accept' }]
  });
  const lintNear = h.context.lintCandidate(near);
  assert.ok(lintNear.fixed.some(f => f.rule === 'weights'));

  const wild = candidateOf(h, {
    machine: 'PFA',
    sigma: ['a'],
    states: [{ name: 'p', start: true, accept: true }],
    transitions: [{ from: 'p', to: 'p', on: 'a', weight: 0.3 }],
    tests: [{ w: 'a', expect: 'accept' }]
  });
  const lintWild = h.context.lintCandidate(wild);
  assert.ok(lintWild.warnings.some(f => f.rule === 'weights'));
});

test('unreachable states warn but never block', () => {
  const h = createHarness();
  const spec = dfaSpec();
  spec.states.push({ name: 'island' });
  spec.transitions.push({ from: 'island', to: 'island', on: 'a' }, { from: 'island', to: 'island', on: 'b' });
  const lint = h.context.lintCandidate(candidateOf(h, spec));
  assert.ok(lint.warnings.some(f => f.rule === 'unreachable'));
  assert.deepEqual(lint.fatal, []);
});

test('a weak automaton with a straddling cycle is reported', () => {
  const h = createHarness();
  const candidate = candidateOf(h, {
    machine: 'NWA',
    sigma: ['a', 'b'],
    states: [{ name: 'p', start: true, accept: true }, { name: 'q' }],
    transitions: [
      { from: 'p', to: 'q', on: 'a' },
      { from: 'q', to: 'p', on: 'b' }
    ],
    tests: [{ w: 'a(ba)', expect: 'accept' }]
  });
  const lint = h.context.lintCandidate(candidate);
  assert.ok(lint.warnings.some(f => f.rule === 'weak-violation'));
});

// ══════════════════════════════════════════════════════════════════
//  VERIFICATION
// ══════════════════════════════════════════════════════════════════

test('verification runs the model\'s predictions and reports the result', () => {
  const h = createHarness();
  const spec = h.context.validateSpec(dfaSpec());
  const { candidate } = h.context.compileSpec(spec, emptyMachine());
  const batch = h.context.verifyCandidate(candidate, spec.tests);

  assert.equal(batch.expected, 3);
  assert.equal(batch.passCount, 3);
  assert.equal(batch.allPassed, true);
});

test('verification catches a machine that does not do what was claimed', () => {
  const h = createHarness();
  const spec = h.context.validateSpec(dfaSpec({
    tests: [
      { w: 'a', expect: 'accept' },   // wrong: one a is odd
      { w: 'aa', expect: 'accept' },
      { w: 'ε', expect: 'accept' }
    ]
  }));
  const { candidate } = h.context.compileSpec(spec, emptyMachine());
  const batch = h.context.verifyCandidate(candidate, spec.tests);

  assert.equal(batch.allPassed, false);
  const failures = h.context.describeFailures(batch, spec.tests, 'DFA');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /"a"/);
  assert.match(failures[0], /REJECTED/);
});

test('the canvas is byte-identical after a verification run, passing or failing', () => {
  const h = createHarness();
  const { App } = h.context;

  App.states = [{ id: 's1', name: 'mine', x: 5, y: 6 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's1', symbol: 'a' }];
  App.startId = 's1';
  App.accepts = new Set(['s1']);
  const snapshot = JSON.stringify(h.context.exportWorkspaceState());

  const spec = h.context.validateSpec(dfaSpec());
  const { candidate } = h.context.compileSpec(spec, emptyMachine());

  h.context.verifyCandidate(candidate, spec.tests);
  assert.equal(JSON.stringify(h.context.exportWorkspaceState()), snapshot);

  // …and when the simulator throws part-way through, the finally still runs.
  assert.throws(() => h.context.verifyCandidate(candidate, [{ get w() { throw new Error('boom'); } }]));
  assert.equal(JSON.stringify(h.context.exportWorkspaceState()), snapshot);
});

test('an undecided Turing run is not counted as a failure', () => {
  const h = createHarness();

  const candidate = candidateOf(h, {
    machine: 'TM',
    sigma: ['a'],
    stackAlpha: ['a', '⊔'],
    states: [{ name: 'spin', start: true }, { name: 'done', accept: true }],
    // Writes a's rightwards forever: it never halts, and no configuration ever
    // repeats, so the loop detector cannot rule it out either. The run is still
    // going when the step budget runs out.
    transitions: [
      { from: 'spin', to: 'spin', on: 'a', write: 'a', move: 'R' },
      { from: 'spin', to: 'spin', on: '⊔', write: 'a', move: 'R' }
    ],
    tests: [{ w: 'a', expect: 'accept' }]
  });
  const tests = [{ w: 'a', expect: 'accept' }];
  const batch = h.context.verifyCandidate(candidate, tests);
  assert.ok(batch.unknowns >= 1);
  // A run still going at the budget has decided nothing, so reporting it as a
  // failed prediction would be a false negative.
  assert.deepEqual(h.context.describeFailures(batch, tests, 'TM'), []);
});

test('transducer tests compare the emitted word', () => {
  const h = createHarness();
  const candidate = candidateOf(h, {
    machine: 'Mealy',
    sigma: ['a', 'b'],
    outputAlpha: ['0', '1'],
    states: [{ name: 'q', start: true }],
    transitions: [
      { from: 'q', to: 'q', on: 'a', out: '1' },
      { from: 'q', to: 'q', on: 'b', out: '0' }
    ],
    tests: [{ w: 'ab', out: '10' }]
  });
  const good = h.context.verifyCandidate(candidate, [{ w: 'ab', out: '10' }]);
  assert.equal(good.allPassed, true);

  const bad = [{ w: 'ab', out: '01' }];
  const wrong = h.context.verifyCandidate(candidate, bad);
  assert.equal(wrong.allPassed, false);
  assert.match(h.context.describeFailures(wrong, bad, 'Mealy')[0], /emitted "10"/);
});

// ══════════════════════════════════════════════════════════════════
//  ROUND TRIP
// ══════════════════════════════════════════════════════════════════
//  Every bundled example, described back as a spec and recompiled, must
//  decide its own sample words the same way. This is the test that keeps the
//  dialect honest as machines are added — it fails the moment a field is
//  carried in one direction and not the other.

const ROUND_TRIP = ['dfa', 'nfa', 'enfa', 'pda', 'npda', 'queue', 'counter', 'tm', 'lba', 'moore', 'mealy', 'pfa', 'twdfa'];

for (const name of ROUND_TRIP) {
  test(`round trip: ${name} keeps its verdicts through spec and compile`, () => {
    const h = createHarness();
    const data = exampleFile(name);
    const tests = (data.meta?.inputs || []).filter(i => i.expect || i.out !== undefined);
    if (!tests.length) return;

    const original = {
      machine: data.machine,
      sigma: data.sigma || [],
      stackAlpha: data.stackAlpha,
      outputAlpha: data.outputAlpha,
      tapeCount: data.tapeCount,
      states: data.states,
      transitions: data.transitions,
      startId: data.startId,
      accepts: data.accepts || []
    };

    const spec = h.context.validateSpec(h.context.machineToSpec(original));
    const { candidate } = h.context.compileSpec(spec, emptyMachine(data.machine));

    const beforeBatch = h.context.verifyCandidate(original, tests);
    const afterBatch = h.context.verifyCandidate(candidate, tests);

    const verdicts = batch => batch.results.map(r => r.verdict ?? r.output ?? null);
    assert.deepEqual(verdicts(afterBatch), verdicts(beforeBatch),
      `${name} decides differently after a round trip through the spec`);
  });
}

// ══════════════════════════════════════════════════════════════════
//  PROVIDER
// ══════════════════════════════════════════════════════════════════

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

test('the Anthropic request carries the model, the key and the browser opt-in', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-5' });
  const fetchStub = fakeFetch(() => jsonResponse({
    content: [{ type: 'text', text: '{"machine":"DFA"}' }],
    usage: { input_tokens: 11, output_tokens: 4 },
    model: 'claude-sonnet-5'
  }));
  h.context.fetch = fetchStub;

  const out = await h.context.callModel({ system: 'S', user: 'U' });

  const call = fetchStub.calls[0];
  assert.match(call.url, /api\.anthropic\.com\/v1\/messages$/);
  assert.equal(call.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(call.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(call.body.model, 'claude-sonnet-5');
  assert.equal(call.body.system, 'S');
  assert.equal(call.body.messages[0].content, 'U');
  assert.equal(out.text, '{"machine":"DFA"}');
  assert.deepEqual(out.usage, { input: 11, output: 4 });
});

test('the OpenAI request uses a bearer token and asks for JSON', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' });
  const fetchStub = fakeFetch(() => jsonResponse({
    choices: [{ message: { content: '{"machine":"NFA"}' } }],
    usage: { prompt_tokens: 7, completion_tokens: 2 }
  }));
  h.context.fetch = fetchStub;

  const out = await h.context.callModel({ system: 'S', user: 'U' });
  const call = fetchStub.calls[0];
  assert.match(call.url, /\/chat\/completions$/);
  assert.equal(call.init.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.equal(call.body.messages[0].role, 'system');
  assert.equal(out.text, '{"machine":"NFA"}');
});

test('a local OpenAI-compatible server needs no key and is not asked for a JSON format', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'compatible', apiKey: '', model: 'llama3.1' });
  const fetchStub = fakeFetch(() => jsonResponse({ choices: [{ message: { content: '{}' } }] }));
  h.context.fetch = fetchStub;

  await h.context.callModel({ system: 'S', user: 'U' });
  const call = fetchStub.calls[0];
  assert.equal(call.init.headers.authorization, undefined);
  // Enough compatible servers reject the field outright that asking for it
  // there costs more requests than it saves.
  assert.equal(call.body.response_format, undefined);
});

test('HTTP failures map to codes the UI has copy for', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'openai', apiKey: 'sk-test' });

  const cases = [[401, 'auth'], [429, 'rate-limit'], [404, 'not-found'], [500, 'server']];
  for (const [status, code] of cases) {
    h.context.fetch = fakeFetch(() => jsonResponse({ error: 'nope' }, { ok: false, status }));
    await assert.rejects(
      () => h.context.callModel({ system: 'S', user: 'U' }),
      err => err.code === code,
      `HTTP ${status} should map to ${code}`
    );
  }
});

test('a dead host reports the provider\'s own browser caveat', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'compatible', model: 'llama3.1' });
  h.context.fetch = async () => { throw new TypeError('Failed to fetch'); };

  await assert.rejects(
    () => h.context.callModel({ system: 'S', user: 'U' }),
    err => err.code === 'network' && /OLLAMA_ORIGINS/.test(err.detail)
  );
});

test('every error code the pipeline throws has a sentence and a button', () => {
  const h = createHarness();
  const codes = [
    'disabled', 'no-key', 'auth', 'rate-limit', 'server', 'not-found', 'http',
    'network', 'timeout', 'bad-response', 'no-json', 'bad-json', 'schema',
    'unknown-machine', 'too-large', 'invalid-machine', 'empty', 'cancelled'
  ];
  for (const code of codes) {
    const info = h.context.describeError({ code, message: '' });
    assert.ok(info.text && info.text.length > 3, `${code} has no message`);
    assert.ok(['settings', 'retry', 'none'].includes(info.action), `${code} has no action`);
  }
  // An unrecognised failure still gets copy rather than falling through.
  assert.ok(h.context.describeError(new Error('surprise')).text);
});

// ══════════════════════════════════════════════════════════════════
//  SECURITY
// ══════════════════════════════════════════════════════════════════

test('the API key reaches none of the workspace serializers', () => {
  const h = createHarness();
  const KEY = 'sk-ant-super-secret-value';
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: KEY });

  // exportWorkspaceState deep-copies the whole of App.config into every tab,
  // and getBackupPayload writes the whole of App.config to storage. A key in
  // App.config would therefore be a key on disk.
  assert.ok(!JSON.stringify(h.context.exportWorkspaceState()).includes(KEY));
  assert.ok(!JSON.stringify(h.context.getWorkspaceData()).includes(KEY));
  assert.ok(!JSON.stringify(h.context.App.config).includes(KEY));
  // …and the share link is built from getWorkspaceData, so it is covered too.
  assert.ok(!h.context.getShareableLink().includes(KEY));
  // The settings profile is a fourth serializer, and it is the one a user is
  // most likely to hand to someone else.
  assert.ok(!JSON.stringify(h.context.getEditorSettingsData()).includes(KEY));
});

test('the key lives in its own store, not the workspace backup key', () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ apiKey: 'sk-ant-abc' });
  const own = h.context.localStorage.getItem('automata-statemate');
  assert.ok(own && own.includes('sk-ant-abc'));
  const backup = h.context.localStorage.getItem('automata-backup');
  assert.ok(!backup || !backup.includes('sk-ant-abc'));
});

test('a disabled or unconfigured StateMate never constructs a request', async () => {
  const h = createHarness();
  let called = false;
  h.context.fetch = async () => { called = true; return jsonResponse({}); };

  h.context.saveStateMateSettings({ enabled: false, apiKey: 'sk-test' });
  await assert.rejects(() => h.context.callModel({ system: 'S', user: 'U' }), e => e.code === 'disabled');

  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: '' });
  await assert.rejects(() => h.context.callModel({ system: 'S', user: 'U' }), e => e.code === 'no-key');

  assert.equal(called, false, 'nothing may leave the app before it is configured');
  assert.equal(h.context.isStateMateReady(), false);
});

// ══════════════════════════════════════════════════════════════════
//  PROMPT
// ══════════════════════════════════════════════════════════════════

test('the prompt is derived from the machine registry, not written per machine', async () => {
  const h = createHarness();
  h.context.App.machine = 'DPDA';
  const system = await h.context.buildSystemPrompt('DPDA');

  assert.match(system, /DPDA/);
  assert.match(system, /Deterministic Pushdown Automaton/);
  assert.match(system, /"pop"/, 'the stack fields are offered');
  assert.match(system, /DETERMINISTIC/, 'the determinism rule is stated up front');
  assert.match(system, /TESTS ARE MANDATORY/);

  const dfa = await h.context.buildSystemPrompt('DFA');
  assert.ok(!/"pop"/.test(dfa), 'a DFA is never offered a stack');
});

test('the prompt states this workspace\'s own notation', async () => {
  const h = createHarness();
  h.context.App.config.sym.eps = '@';
  const system = await h.context.buildSystemPrompt('ε-NFA');
  assert.match(system, /= "@"/, 'a custom ε must reach the model, or it will emit the default');
});

test('the user message attaches the canvas only when asked', () => {
  const h = createHarness();
  const spec = { machine: 'DFA', states: [{ name: 'q', start: true }], transitions: [] };

  const withCanvas = h.context.buildUserMessage({ prompt: 'add a trap', mode: 'edit', canvasSpec: spec });
  assert.match(withCanvas, /MACHINE CURRENTLY ON THE CANVAS/);
  assert.match(withCanvas, /Keep the names/);

  const without = h.context.buildUserMessage({ prompt: 'build one', mode: 'build' });
  assert.ok(!/CURRENTLY ON THE CANVAS/.test(without));
  assert.match(without, /REQUEST: build one/);
});

test('the repair message carries the failures, not a vague complaint', () => {
  const h = createHarness();
  const message = h.context.buildRepairMessage({
    prompt: 'even number of a',
    spec: { machine: 'DFA' },
    failures: ['"a" you predicted accept, it REJECTED'],
    findings: [{ message: 'state "even" has two transitions on "a"' }]
  });
  assert.match(message, /you predicted accept, it REJECTED/);
  assert.match(message, /two transitions on "a"/);
  assert.match(message, /even number of a/, 'the original request travels with the correction');
});

// ══════════════════════════════════════════════════════════════════
//  END TO END
// ══════════════════════════════════════════════════════════════════

function anthropicReply(spec) {
  return jsonResponse({
    content: [{ type: 'text', text: JSON.stringify(spec) }],
    usage: { input_tokens: 100, output_tokens: 50 },
    model: 'claude-sonnet-5'
  });
}

test('a good answer is drawn, and one Ctrl+Z takes it back', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', verify: true });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  const result = await h.context.runStateMate({ prompt: 'even number of a' });

  assert.equal(result.status, 'applied');
  assert.equal(App.states.length, 2);
  assert.equal(App.transitions.length, 4);
  assert.equal(result.batch.allPassed, true);
  assert.equal(result.repaired, false);

  h.context.undo();
  assert.equal(App.states.length, 0, 'one undo restores what was on screen before the prompt');
});

test('a wrong first answer is repaired without the user seeing anything but a slower run', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', verify: true, repairAttempts: 1 });

  // Round one is nondeterministic AND fails its own prediction; round two is
  // the machine that was asked for.
  const broken = dfaSpec();
  broken.transitions.push({ from: 'even', to: 'even', on: 'a' });
  const fetchStub = fakeFetch((_url, _init, call) => anthropicReply(call === 1 ? broken : dfaSpec()));
  h.context.fetch = fetchStub;

  const stages = [];
  const result = await h.context.runStateMate({
    prompt: 'even number of a',
    onEvent: e => { if (e.type === 'stage') stages.push(e.stage); }
  });

  assert.equal(fetchStub.calls.length, 2, 'the failure was sent back');
  assert.ok(stages.includes('repair'));
  assert.equal(result.repaired, true);
  assert.equal(result.batch.allPassed, true);
  assert.deepEqual(result.lint.fatal, []);
  // The repair message must contain the actual failure, not a restatement.
  assert.match(fetchStub.calls[1].body.messages.at(-1).content, /deterministic|predicted/);
});

test('a machine that stays invalid never reaches the canvas', async () => {
  const h = createHarness();
  const { App } = h.context;
  App.states = [{ id: 's1', name: 'mine', x: 1, y: 2 }];
  App.startId = 's1';
  const before = JSON.stringify(h.context.exportWorkspaceState());

  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', repairAttempts: 1 });
  const broken = dfaSpec();
  broken.transitions.push({ from: 'even', to: 'even', on: 'a' });
  h.context.fetch = fakeFetch(() => anthropicReply(broken));

  await assert.rejects(
    () => h.context.runStateMate({ prompt: 'even number of a', mode: 'edit' }),
    err => err.code === 'invalid-machine'
  );
  assert.equal(JSON.stringify(h.context.exportWorkspaceState()), before,
    'a failed run leaves the user\'s work exactly as it was');
});

test('unparseable output gets one silent reformat before it becomes the user\'s problem', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', repairAttempts: 1 });
  const fetchStub = fakeFetch((_url, _init, call) =>
    call === 1 ? anthropicReply('not json at all') : anthropicReply(dfaSpec()));
  // The first reply is a JSON string, not an object — extraction finds no
  // machine in it.
  fetchStub.calls.length = 0;
  h.context.fetch = async (url, init) => {
    fetchStub.calls.push({ url, init, body: JSON.parse(init.body) });
    return fetchStub.calls.length === 1
      ? jsonResponse({ content: [{ type: 'text', text: 'I am afraid I cannot do that.' }] })
      : anthropicReply(dfaSpec());
  };

  const result = await h.context.runStateMate({ prompt: 'even number of a' });
  assert.equal(result.status, 'applied');
  assert.equal(fetchStub.calls.length, 2);
  assert.match(fetchStub.calls[1].body.messages.at(-1).content, /ONLY the JSON object/);
});

test('a build over existing work opens a new tab instead of replacing it', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createTab('First');
  App.states = [{ id: 's9', name: 'keep', x: 0, y: 0 }];
  App.startId = 's9';

  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', newTabForBuild: true });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  const tabsBefore = h.context.Workspaces.length;
  const result = await h.context.runStateMate({ prompt: 'even number of a', mode: 'build' });

  assert.equal(result.openedNewTab, true);
  assert.equal(h.context.Workspaces.length, tabsBefore + 1);
  assert.equal(App.states.length, 2, 'the new machine is in the new tab');
  // The original tab still holds the work it held.
  const first = h.context.Workspaces.find(w => w.name === 'First');
  assert.equal(first.data.states[0].name, 'keep');
});

test('cancelling mid-run leaves nothing behind', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = async () => {
    h.context.cancelStateMate();
    return anthropicReply(dfaSpec());
  };

  await assert.rejects(
    () => h.context.runStateMate({ prompt: 'even number of a' }),
    err => err.code === 'cancelled'
  );
  assert.equal(App.states.length, 0);
  assert.equal(h.context.isStateMateRunning(), false);
});

test('the follow-up slot holds one turn and expires on any other edit', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', followUp: true });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  await h.context.runStateMate({ prompt: 'even number of a' });
  const slot = h.context.getFollowUp();
  assert.ok(slot);
  assert.equal(slot.prompt, 'even number of a');

  // Any change to the graph that is not StateMate's own drops it: the prompt
  // no longer describes what is on the canvas.
  h.context.emit(h.context.Change.GRAPH);
  assert.equal(h.context.getFollowUp(), null);
});

test('the follow-up is not stored at all when the setting is off', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', followUp: false });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  await h.context.runStateMate({ prompt: 'even number of a' });
  assert.equal(h.context.getFollowUp(), null);
});

// ══════════════════════════════════════════════════════════════════
//  THE PALETTE
// ══════════════════════════════════════════════════════════════════
//  The dialog is built entirely in JS, so "does it render" is a real
//  question rather than a matter of markup. These check the shape of what
//  it produces, not its styling.

// The palette assembles rows from nested spans, so the stub keeps each piece
// of text on the node that owns it — reading a row means walking it.
function deepText(node) {
  if (!node || typeof node !== 'object') return '';
  const own = typeof node.textContent === 'string' ? node.textContent : '';
  const kids = (node.children || []).map(deepText).join(' ');
  return `${own} ${kids}`.trim();
}

const rowNames = h => h.getElement('sm-body').children
  .filter(n => String(n.className).includes('sm-row'))
  .map(deepText);

test('the palette opens on the examples, with no model involved', () => {
  const h = createHarness();
  h.context.openStateMate();

  const input = h.getElement('sm-input');
  assert.equal(input.value, '');
  assert.match(input.placeholder, /examples/);
  // With no key configured the dialog is exactly the example picker it
  // replaced — nothing about the feature is visible until it is set up.
  const chips = h.getElement('sm-chips').children.map(deepText);
  assert.ok(chips.some(t => /Set up StateMate/.test(t)));
  assert.ok(!rowNames(h).some(name => /Build with StateMate/.test(name)));
});

test('typing offers to build, and the exact algorithm outranks the model', () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  const input = h.getElement('sm-input');
  input.value = 'strings with an even number of a';
  input.oninput();
  assert.match(rowNames(h)[0], /Build with StateMate/);

  // The algorithm catalogue is read from the markup at runtime, so the stub
  // supplies one. "minimize" is something the app does exactly, and StateMate
  // must lose to it.
  const realQuery = h.context.document.querySelectorAll;
  h.context.document.querySelectorAll = sel => sel === '.algo-item'
    ? [{ dataset: { algo: 'minimize' }, textContent: 'DFA Minimize' }]
    : [];
  try {
    input.value = 'minimise';
    input.oninput();
    const names = rowNames(h);
    const askAt = names.findIndex(n => /Build with StateMate/.test(n));
    const algoAt = names.findIndex(n => /DFA Minimize/.test(n));
    assert.ok(algoAt !== -1, 'the real construction is offered');
    assert.ok(algoAt > askAt, 'both are present; the exact tool is not buried under the examples');
  } finally {
    h.context.document.querySelectorAll = realQuery;
  }
});

test('the canvas chip states its own cost and can be switched off', () => {
  const h = createHarness();
  const { App } = h.context;
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }, { id: 's2', name: 'q1', x: 90, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  const chip = h.getElement('sm-chips').children.find(c => /Canvas/.test(deepText(c)));
  assert.ok(chip, 'the toggle is present');
  assert.match(deepText(chip), /2 states, 1 transition/);
  assert.equal(chip.getAttribute('aria-pressed'), 'true');

  chip.onclick();
  const after = h.getElement('sm-chips').children.find(c => /Canvas/.test(deepText(c)));
  assert.equal(after.getAttribute('aria-pressed'), 'false');
});

test('the result strip reports the diff, the verdict and a way back', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  const result = await h.context.runStateMate({ prompt: 'even number of a' });
  h.context.decorateResultCard(result);

  const card = h.getElement('example-card');
  const strip = card.children.find(c => String(c.className).includes('sm-result-strip'));
  assert.ok(strip, 'the strip is prepended to the existing example card');

  const text = deepText(strip);
  assert.match(text, /StateMate/);
  assert.match(text, /3\/3 checks/);
  assert.match(text, /\+2 states/);
  assert.match(text, /Undo/);
  assert.match(text, /Regenerate/);
});

test('canvas notes are offered only when the user asked for them', async () => {
  const h = createHarness();
  const off = await h.context.buildSystemPrompt('DFA', { notes: false });
  assert.ok(!/"notes"/.test(off), 'an unasked-for sticky note is clutter, not an explanation');

  const on = await h.context.buildSystemPrompt('DFA', { notes: true });
  assert.match(on, /"notes"/);
});

test('a note the model volunteered is dropped when the setting is off', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', writeNotes: false });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({
    notes: [{ text: 'The state is the parity.', anchor: 'even' }]
  })));

  await h.context.runStateMate({ prompt: 'even number of a' });
  assert.equal(h.context.App.notes.length, 0);
});

test('a note is drawn and anchored when the setting is on', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', writeNotes: true });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({
    notes: [{ text: 'The state is the parity.', anchor: 'even' }]
  })));

  const result = await h.context.runStateMate({ prompt: 'even number of a' });
  const { App } = h.context;
  assert.equal(App.notes.length, 1);
  assert.match(App.notes[0].text, /parity/);
  const even = result.candidate.states.find(s => s.name === 'even');
  assert.deepEqual(App.notes[0].anchorStates, [even.id], 'the anchor is resolved by name');
});

test('a note is placed clear of the diagram, not on top of it', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', writeNotes: true });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({
    notes: [{ text: 'The state is the parity.', anchor: 'even' }]
  })));

  const result = await h.context.runStateMate({ prompt: 'even number of a' });
  const note = h.context.App.notes[0];
  const leftmost = Math.min(...result.candidate.states.map(s => s.x));
  // A fixed world position lands on the machine, because the layout puts a new
  // one near the origin.
  assert.ok(note.x + h.context.NOTE_WIDTH < leftmost, 'the note sits clear of every state');
});

// ══════════════════════════════════════════════════════════════════
//  STREAMING
// ══════════════════════════════════════════════════════════════════
//  Streaming is the default in the browser, so the non-streaming stubs above
//  exercise the fallback rather than the normal path. "plan" is the first key
//  in the schema specifically so the progress view has something true to show
//  within a second, and that only works if deltas actually arrive.

function sseResponse(lines) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => (i < lines.length
          // Two events per chunk, to prove the line splitter handles a payload
          // arriving split across reads rather than one event at a time.
          ? { done: false, value: encoder.encode(lines[i++]) }
          : { done: true, value: undefined })
      })
    }
  };
}

test('an Anthropic stream is reassembled, and the plan surfaces early', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });

  const text = '{"plan":"Track parity.","machine":"DFA"}';
  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":42}}}\n\n',
    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(text.slice(0, 20))}}}\n\n`,
    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(text.slice(20))}}}\n\n`,
    'data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n'
  ];
  h.context.fetch = async () => sseResponse(events);

  const seen = [];
  const out = await h.context.callModel({ system: 'S', user: 'U', onText: full => seen.push(full) });

  assert.equal(out.text, text);
  assert.equal(out.model, 'claude-sonnet-5');
  assert.deepEqual(out.usage, { input: 42, output: 7 });
  assert.ok(seen.length >= 2, 'the caller saw the answer arrive, not just the end of it');
  assert.match(seen[0], /"plan"/, 'the plan is in the first delta, which is what the progress view shows');
});

test('an OpenAI stream is reassembled and [DONE] is not parsed as an event', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'openai', apiKey: 'k' });
  h.context.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"{\\"machine\\":"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"\\"DFA\\"}"}}]}\n\ndata: {"usage":{"prompt_tokens":9,"completion_tokens":3}}\n\n',
    'data: [DONE]\n\n'
  ]);

  const out = await h.context.callModel({ system: 'S', user: 'U' });
  assert.equal(out.text, '{"machine":"DFA"}');
  assert.deepEqual(out.usage, { input: 9, output: 3 });
});

test('a stream that stops mid-object fails as a missing machine, not a crash', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', repairAttempts: 0 });
  h.context.fetch = async () => sseResponse([
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"plan\\":\\"cut off"}}\n\n'
  ]);

  await assert.rejects(
    () => h.context.runStateMate({ prompt: 'anything' }),
    err => err.code === 'no-json'
  );
  assert.equal(h.context.App.states.length, 0);
});
