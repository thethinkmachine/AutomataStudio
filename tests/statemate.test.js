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

test('the caveat is optional, trimmed, and bounded', () => {
  const h = createHarness();

  assert.equal(h.context.validateSpec(dfaSpec()).caveat, '',
    'an answer that is exactly what was asked for says nothing extra');

  const flagged = h.context.validateSpec(dfaSpec({
    caveat: '  aⁿbⁿ is not regular; this DFA is correct only for n ≤ 3.  '
  }));
  assert.equal(flagged.caveat, 'aⁿbⁿ is not regular; this DFA is correct only for n ≤ 3.');

  // It renders in a four-line list beside the linter's findings, so a model
  // that writes an essay gets cut rather than taking the card over.
  const long = h.context.validateSpec(dfaSpec({ caveat: 'x'.repeat(900) }));
  assert.equal(long.caveat.length, h.context.MAX_CAVEAT_CHARS);

  // Severity is the app's to assign: it drives the repair loop, and a model
  // that could mark its own answer fatal could burn round trips at will.
  const spoofed = h.context.validateSpec(dfaSpec({ caveat: { severity: 'repair', text: 'nope' } }));
  assert.equal(spoofed.caveat, '');
});

test('a caveat that narrates the repair instead of the machine is discarded', () => {
  const h = createHarness();
  const caveatOf = text => h.context.validateSpec(dfaSpec({ caveat: text })).caveat;

  // What a model actually returns on the round after a failed check. It tells
  // the user nothing — they are looking at one machine and never saw another —
  // and it takes a line on the card a real finding could have used.
  assert.equal(caveatOf('The machine was corrected to accurately reflect the language it recognizes'), '');
  assert.equal(caveatOf('Fixed the missing transition from my previous answer.'), '');
  assert.equal(caveatOf('I have repaired the nondeterminism.'), '');

  // A caveat about the machine survives, including one that says it is wrong.
  assert.match(
    caveatOf('This DFA accepts only n ≤ 3, because aⁿbⁿ is not regular.'),
    /not regular/
  );
  assert.match(
    caveatOf('Σ was widened to include c, which the request did not mention.'),
    /widened/
  );
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
  assert.deepEqual(failures[0], { kind: 'verdict', word: 'a', expected: 'accept', actual: 'reject' });

  // The same failure, said twice, because it has two audiences. The model is
  // told its own prediction was wrong; the reader — who predicted nothing and
  // never saw the prediction — is told what the machine does.
  assert.match(h.context.failureForModel(failures[0]), /"a" you predicted accept, it REJECTED/);
  assert.match(h.context.failureForUser(failures[0]), /“a” should be accepted, but this machine rejects it/);
  assert.ok(!/you predicted/.test(h.context.failureForUser(failures[0])));
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
  const failure = h.context.describeFailures(wrong, bad, 'Mealy')[0];
  assert.deepEqual(failure, { kind: 'output', word: 'ab', expected: '01', actual: '10' });
  assert.match(h.context.failureForModel(failure), /emitted "10"/);
  assert.match(h.context.failureForUser(failure), /“ab” should emit “01”, but this machine emits “10”/);
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

  // fetch() rejects identically for a dead host and a CORS refusal, so the
  // actionable half is the provider's own note. Compared against the registry
  // rather than quoted, so rewording the copy is not a test failure.
  await assert.rejects(
    () => h.context.callModel({ system: 'S', user: 'U' }),
    err => err.code === 'network' && err.detail === h.context.PROVIDERS.compatible.browserNote
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

test('the prompt tells the model it can change the model', async () => {
  const h = createHarness();
  const system = await h.context.buildSystemPrompt('DFA');

  assert.match(system, /YOU CAN CHANGE THE MODEL/);
  assert.match(system, /TM — .*\(\+ write, move\)/, 'a switch target arrives with the fields it needs');
  assert.match(system, /DPDA — .*\(\+ pop, push\)/);
  assert.ok(!/^\s+DFA — /m.test(system), 'the current model is not offered as somewhere to switch to');

  // The refusal this fixes was "I build only DFAs, I cannot construct Turing
  // machines" — a buildable request declined for a limit that does not exist.
  assert.match(system, /Never claim you can only build DFAs/);
});

test('the prompt offers a caveat for the request it cannot honour', async () => {
  const h = createHarness();
  const system = await h.context.buildSystemPrompt('DFA');

  assert.match(system, /"caveat"/, 'the field is in the schema block');
  assert.match(system, /IF YOU CANNOT DO EXACTLY WHAT WAS ASKED/);
  assert.match(system, /not recognisable by a DFA/, 'the motivating case is named for this machine');
  assert.match(system, /Omit "caveat" entirely/, 'a correct answer must not carry one');
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

  const withCanvas = h.context.buildUserMessage({ prompt: 'add a trap', intent: 'edit', canvasSpec: spec });
  assert.match(withCanvas, /MACHINE CURRENTLY ON THE CANVAS/);
  assert.match(withCanvas, /keep the names of every state you are not changing/);

  const without = h.context.buildUserMessage({ prompt: 'build one', intent: 'build' });
  assert.ok(!/CURRENTLY ON THE CANVAS/.test(without));
  assert.match(without, /REQUEST: build one/);
});

test('edit mode names a subject, not an instruction to modify', () => {
  const h = createHarness();
  const spec = { machine: 'DFA', states: [{ name: 'q', start: true }], transitions: [] };
  const message = h.context.buildUserMessage({ prompt: 'why does it reject aab?', intent: 'edit', canvasSpec: spec });

  // Both halves have to be present. Told only to modify, the model answers a
  // question by rebuilding the diagram the question was about.
  assert.match(message, /If the request asks for a change, return the modified machine/);
  assert.match(message, /only asks a question about this machine, answer it with a reply and change nothing/);
  assert.ok(!/— modify this/.test(message), 'the old unconditional imperative is gone');
});

test('the reply rules make room for a question about the canvas', async () => {
  const h = createHarness();
  const system = await h.context.buildSystemPrompt('DFA');

  assert.match(system, /a question about the machine already on the canvas/);
  assert.match(system, /Answering is not declining/);
  // …without opening the escape hatch the reply branch has always been.
  assert.match(system, /If the request names any change to make, however small, build or edit rather than reply/);
  assert.match(system, /merely hard, vague, or impossible to satisfy exactly/);
});

test('a question in edit mode answers and leaves the machine alone', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });

  // Build something first, so there is a machine to ask about.
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a', intent: 'build' });
  const before = h.context.exportWorkspaceState();
  assert.ok(App.states.length, 'there is a machine on the canvas');

  h.context.fetch = fakeFetch(() => replyTurn('It rejects "aab" because the run ends in q1, which is not accepting.'));
  const result = await h.context.runStateMate({ prompt: 'why does it reject aab?', intent: 'edit' });

  assert.equal(result.kind, 'reply');
  assert.match(result.reply, /not accepting/);
  // The whole point of the mode: asking about a diagram must not redraw it.
  assert.deepEqual(h.context.exportWorkspaceState(), before,
    'a question changed nothing on the canvas');
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
    () => h.context.runStateMate({ prompt: 'even number of a', intent: 'edit' }),
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
  const result = await h.context.runStateMate({ prompt: 'even number of a', intent: 'build' });

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

// ══════════════════════════════════════════════════════════════════
//  THE CONVERSATION
// ══════════════════════════════════════════════════════════════════
//  Two properties carry this feature. A reply turn writes nothing — pinned
//  the same way the pipeline's other failure modes are, by comparing the
//  serialized workspace either side of it. And the thread sends intent, never
//  machines, because the canvas is the state and there must only ever be one
//  candidate for "the machine" in front of the model.

const replyTurn = text => anthropicReply({ kind: 'reply', text });

test('the thread carries what was asked and a summary of what was built', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6 });
  const fetchStub = fakeFetch(() => anthropicReply(dfaSpec()));
  h.context.fetch = fetchStub;

  await h.context.runStateMate({ prompt: 'even number of a' });

  const thread = h.context.getThread();
  assert.deepEqual(thread.map(t => t.role), ['user', 'assistant']);
  assert.equal(thread[0].text, 'even number of a');
  assert.equal(thread[1].kind, 'machine');
  assert.match(thread[1].text, /Even number of a's — 2 states, 4 transitions/);

  await h.context.runStateMate({ prompt: 'now make it reject the empty string' });

  // The second request opens with the first exchange, so "it" resolves.
  const sent = fetchStub.calls[1].body.messages;
  assert.equal(sent.length, 3);
  assert.equal(sent[0].content, 'even number of a');
  assert.match(sent[1].content, /^\[built: Even number of a's/);
  assert.match(sent[2].content, /now make it reject the empty string/);
});

test('past machines are never replayed — only the live canvas is', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6, attachCanvas: true
  });
  const fetchStub = fakeFetch(() => anthropicReply(dfaSpec()));
  h.context.fetch = fetchStub;

  await h.context.runStateMate({ prompt: 'even number of a' });
  await h.context.runStateMate({ prompt: 'add a trap state' });

  const sent = fetchStub.calls[1].body.messages;
  const history = sent.slice(0, -1).map(m => m.content).join('\n');

  // Exactly one machine reaches the model, and it is the one on the canvas
  // right now — attached to the live turn, not remembered from the last one.
  assert.ok(!/"transitions"/.test(history), 'the history holds no machine JSON');
  assert.match(sent[sent.length - 1].content, /MACHINE CURRENTLY ON THE CANVAS/);
});

test('depth 0 sends nothing but still keeps the exchange on screen', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 0 });
  const fetchStub = fakeFetch(() => anthropicReply(dfaSpec()));
  h.context.fetch = fetchStub;

  await h.context.runStateMate({ prompt: 'even number of a' });
  await h.context.runStateMate({ prompt: 'again' });

  assert.equal(fetchStub.calls[1].body.messages.length, 1, 'strict one-shot, as before the thread existed');
  assert.equal(h.context.getThread().length, 4, 'both exchanges are still on screen');
});

test('the conversation does not survive a change of machine', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6 });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  await h.context.runStateMate({ prompt: 'even number of a' });
  assert.equal(h.context.getThread().length, 2);

  // The exchange is about a machine that is no longer the one on screen.
  h.context.App.machine = 'DPDA';
  assert.deepEqual(h.context.getThread(), []);
});

test('naming a different model switches the canvas to it', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', verify: false });

  h.context.fetch = fakeFetch(() => anthropicReply({
    kind: 'machine',
    machine: 'TM',
    title: 'Appends a 1',
    sigma: ['0', '1'],
    stackAlpha: ['0', '1', '⊔'],
    states: [{ name: 'scan', start: true }, { name: 'done', accept: true }],
    transitions: [
      { from: 'scan', to: 'scan', on: '0', write: '0', move: 'R' },
      { from: 'scan', to: 'scan', on: '1', write: '1', move: 'R' },
      { from: 'scan', to: 'done', on: '⊔', write: '1', move: 'S' }
    ],
    tests: [{ w: '01', expect: 'accept' }]
  }));

  const result = await h.context.runStateMate({ prompt: 'make a turing machine that appends a 1' });

  assert.equal(result.status, 'applied');
  assert.equal(App.machine, 'TM', 'the request needed another model, so the canvas became one');
  assert.equal(App.states.length, 2);
  assert.equal(h.context.App.transitions[0].dir, 'R', 'the tape fields survived the compile');
});

test('a reply is an answer, and it draws absolutely nothing', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });

  // Something on the canvas to lose.
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a' });
  const before = JSON.stringify(h.context.exportWorkspaceState());

  h.context.fetch = fakeFetch(() => replyTurn('A DFA cannot count, so there is no machine here to build.'));
  const result = await h.context.runStateMate({ prompt: 'what is the difference between a DFA and an NFA?' });

  assert.equal(result.status, 'replied');
  assert.equal(result.kind, 'reply');
  assert.match(result.reply, /cannot count/);
  assert.equal(result.candidate, undefined, 'no candidate is ever compiled');
  assert.equal(
    JSON.stringify(h.context.exportWorkspaceState()), before,
    'the workspace is byte-identical — a reply passes nowhere near apply'
  );
  assert.equal(App.states.length, 2, 'the machine that was there is still there');
});

test('a reply is remembered verbatim, unlike a machine', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6 });
  h.context.fetch = fakeFetch(() => replyTurn('That language is not regular.'));

  await h.context.runStateMate({ prompt: 'a DFA for aⁿbⁿ' });
  const thread = h.context.getThread();
  assert.equal(thread[1].kind, 'reply');
  assert.equal(thread[1].text, 'That language is not regular.');
  assert.deepEqual(
    h.context.threadMessages(thread)[1],
    { role: 'assistant', content: 'That language is not regular.' },
    'a reply travels as itself; only a machine turn is reduced to a summary'
  );
});

test('a model cannot talk its way out of a repair', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', verify: true, repairAttempts: 1
  });

  // A machine whose own predictions are wrong, then an attempt to escape the
  // correction with prose. The escape must not be accepted as an answer.
  const wrong = dfaSpec({ tests: [{ w: 'a', expect: 'accept' }, { w: 'aa', expect: 'reject' }] });
  const fetchStub = fakeFetch((url, init, n) =>
    n === 1 ? anthropicReply(wrong) : replyTurn('On reflection this is quite hard.'));
  h.context.fetch = fetchStub;

  await assert.rejects(
    () => h.context.runStateMate({ prompt: 'even number of a' }),
    err => err.code === 'schema' && /not a correction/.test(err.message)
  );
  assert.equal(fetchStub.calls.length, 2, 'the repair round happened');
  assert.equal(h.context.App.states.length, 0, 'and nothing was drawn');
});

test('a reply is only offered on the first attempt', () => {
  const h = createHarness();
  const raw = { kind: 'reply', text: 'I would rather not.' };

  assert.equal(h.context.parseTurn(raw, { allowReply: true }).kind, 'reply');
  assert.throws(
    () => h.context.parseTurn(raw, { allowReply: false }),
    err => err.code === 'schema'
  );
});

test('a missing kind is a machine, because that is the strictly gated path', () => {
  const h = createHarness();

  const turn = h.context.parseTurn(dfaSpec());
  assert.equal(turn.kind, 'machine');
  assert.equal(turn.spec.states.length, 2);

  // An unknown kind falls through to the machine gate rather than being
  // waved past as some third thing, so it fails with a real complaint.
  assert.throws(
    () => h.context.parseTurn({ kind: 'question', text: 'hm?' }),
    err => err.code === 'schema' && /no states/.test(err.message)
  );

  // An empty reply is not a reply.
  assert.throws(
    () => h.context.parseTurn({ kind: 'reply', text: '   ' }),
    err => err.code === 'schema'
  );
});

test('the thread reaches none of the workspace serializers', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6 });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  await h.context.runStateMate({ prompt: 'a memorable and distinctive request' });
  assert.ok(h.context.getThread().length);

  // Same reasoning as the API key: a log of what someone was trying to build
  // must not end up in a tab snapshot, an autosave blob or a saved file.
  const written = [
    JSON.stringify(h.context.exportWorkspaceState()),
    JSON.stringify(h.context.getWorkspaceData ? h.context.getWorkspaceData() : {}),
    JSON.stringify(h.context.getBackupPayload ? h.context.getBackupPayload() : {})
  ].join('\n');
  assert.ok(!/memorable and distinctive/.test(written));
});

// ══════════════════════════════════════════════════════════════════
//  RESULT NOTES
// ══════════════════════════════════════════════════════════════════
//  The card renders only the first few of these, so which ones survive the
//  cut is a correctness question, not a styling one.

const fix = message => ({ rule: 'r', severity: 'fix', message });
const warn = message => ({ rule: 'r', severity: 'warn', message });

test('a failed check outranks the fixes applied on the way through', () => {
  const h = createHarness();
  const notes = h.context.resultNotes({
    lint: {
      fixed: [fix('Extended Σ'), fix('Added the end markers'), fix('No start state'), fix('Normalised weights')],
      warnings: [warn('2 states are unreachable')]
    },
    failures: ['"a" you predicted accept, it REJECTED']
  });

  // Five findings ahead of it used to push the one line that matters off the
  // end of the card's four-item budget.
  assert.match(notes[0].message, /1 check failed/);
  assert.equal(notes[0].severity, 'fail');
  assert.equal(notes[1].severity, 'warn');
  assert.equal(notes.slice(2).every(n => n.severity === 'fix'), true);
  assert.equal(notes.length, 6, 'nothing is dropped here — the card does the slicing');
});

test('equal severities keep the order the pipeline produced them in', () => {
  const h = createHarness();
  const notes = h.context.resultNotes({
    lint: { fixed: [], warnings: [warn('first'), warn('second'), warn('third')] }
  });
  assert.deepEqual(notes.map(n => n.message), ['first', 'second', 'third']);
});

test('the model\'s caveat is shown as a warning, below what the app verified', () => {
  const h = createHarness();
  const result = {
    spec: { caveat: 'aⁿbⁿ is not regular; this DFA is correct only for n ≤ 3.' },
    lint: { fixed: [], warnings: [warn('2 states are unreachable')] },
    failures: ['"aaaabbbb" you predicted reject, it ACCEPTED']
  };
  const notes = h.context.resultNotes(result);

  assert.equal(notes[0].severity, 'fail');
  // A claim the model makes ranks with the warnings, never above the evidence
  // the app gathered itself.
  assert.deepEqual(notes.slice(1).map(n => n.severity), ['warn', 'warn']);
  assert.match(notes.map(n => n.message).join(' '), /not regular/);

  assert.equal(h.context.hasWarnings(result), true);
  assert.equal(h.context.hasWarnings({ spec: { caveat: 'only for n ≤ 3' }, lint: { warnings: [] } }), true,
    'a caveat alone is enough to tone the card as a warning');
});

test('a clean run has nothing to say', () => {
  const h = createHarness();
  assert.deepEqual(h.context.resultNotes({ spec: { caveat: '' }, lint: { fixed: [], warnings: [] }, failures: [] }), []);
  assert.deepEqual(h.context.resultNotes(null), []);
});

// ══════════════════════════════════════════════════════════════════
//  THE CONSOLE
// ══════════════════════════════════════════════════════════════════
//  The dialog is built entirely in JS, so "does it render" is a real
//  question rather than a matter of markup. What these pin is the one
//  property the redesign exists for: ⏎ in the composer means exactly one
//  thing, and the only thing that ever takes it back says so on screen.

// The console assembles lines from nested spans, so the stub keeps each piece
// of text on the node that owns it — reading an entry means walking it.
function deepText(node) {
  if (!node || typeof node !== 'object') return '';
  const own = typeof node.textContent === 'string' ? node.textContent : '';
  const kids = (node.children || []).map(deepText).join(' ');
  return `${own} ${kids}`.trim();
}

function findAll(node, cls) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach(child => {
      if (String(child.className || '').includes(cls)) out.push(child);
      walk(child);
    });
  })(node);
  return out;
}

const logText = h => deepText(h.getElement('sm-log'));
const statusText = h => deepText(h.getElement('sm-status'));
const menuLabels = h => h.getElement('sm-menu').children.map(deepText);
const entryKinds = h => h.getElement('sm-log').children.map(c => String(c.className || ''));

// Typing, the way the composer receives it.
function type(h, text) {
  const input = h.getElement('sm-input');
  input.value = text;
  input.oninput();
  return input;
}

const enter = (input, extra = {}) =>
  input.onkeydown({ key: 'Enter', preventDefault() { }, ...extra });

test('the console opens on a transcript that says what ⏎ does', () => {
  const h = createHarness();
  h.context.openStateMate();

  const input = h.getElement('sm-input');
  assert.equal(input.value, '');

  // With no key the console is the example picker it has always also been:
  // the placeholder names the way in, and the examples are listed rather than
  // hidden behind a command nobody has been told about.
  assert.match(input.placeholder, /\/examples/);
  assert.match(logText(h), /needs an API key/);
  assert.match(statusText(h), /Set up StateMate/);
  assert.ok(findAll(h.getElement('sm-log'), 'sm-listrow').length,
    'the bundled machines are reachable with no model configured');
});

test('a refusal keeps the prompt on screen rather than eating it', async () => {
  const h = createHarness();
  // Off, rather than merely unconfigured: the two refusals are the same shape
  // and only one of them used to record the turn.
  h.context.saveStateMateSettings({ enabled: false, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  await enter(type(h, 'even number of a'));

  assert.match(logText(h), /even number of a/,
    'submitComposer clears the composer before send runs, and the error card '
    + 'does not print the prompt it is handed — so the transcript is the only '
    + 'place the sentence can survive');
  assert.match(logText(h), /switched off/);
});

test('⏎ sends what was typed — no modifier, no highlighted row', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  const input = type(h, 'even number of a');
  assert.equal(h.getElement('sm-menu').hidden, true, 'a sentence is not a command');
  await enter(input);

  const text = logText(h);
  assert.match(text, /even number of a/, 'the turn is recorded');
  assert.match(text, /Even number of a's/, 'and so is what came back');
  assert.match(text, /\+2 states/);
  assert.match(text, /3\/3 checks/);
  // The console defaults to propose, so the machine is built and checked but
  // waiting on the reader rather than already drawn.
  assert.match(text, /Apply/, 'with the decision left to the reader');

  assert.equal(h.context.getActivePanelTab('rpanel'), 'statemate',
    'the console stays open — the next prompt is usually a correction to this one');
  assert.equal(input.value, '', 'and the composer is ready for it');
});

test('a slash opens the command menu, and only it takes ⏎ back', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  const input = type(h, '/exa');
  assert.equal(h.getElement('sm-menu').hidden, false);
  assert.ok(menuLabels(h).some(l => /\/examples/.test(l)));

  // ⏎ on a command that takes arguments completes it and waits, rather than
  // guessing which example was meant.
  await enter(input);
  assert.equal(input.value, '/examples ');
  const rows = menuLabels(h);
  assert.ok(rows.length, 'the examples themselves are the completions now');
  assert.ok(!rows.some(l => /^\/examples/.test(l)));

  // And the moment the line stops being a command, the menu stops competing.
  type(h, 'binary numbers divisible by 3');
  assert.equal(h.getElement('sm-menu').hidden, true);
});

test('/settings completes over the settings dialog’s own tab strip', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  // The tab strip is read from the markup the way the algorithm list is, so a
  // tab added to index.html is completable without an edit to the console.
  const strip = [['general', 'Workspace'], ['rendering', 'Canvas & Layout'], ['', 'Unlabelled']]
    .map(([tab, label]) => {
      const node = h.context.document.createElement('div');
      node.dataset.tab = tab;
      node.textContent = label;
      return node;
    });
  const realQuery = h.context.document.querySelectorAll;
  h.context.document.querySelectorAll = sel =>
    (sel === '#settings-tabs .modal-tab' ? strip : []);

  try {
    const input = type(h, '/settings ');
    assert.deepEqual(menuLabels(h).map(l => l.split(' Open')[0]), ['Workspace', 'Canvas & Layout'],
      'a tab with no data-tab is simply not offered');

    type(h, '/settings canvas');
    assert.deepEqual(menuLabels(h).map(l => l.split(' Open')[0]), ['Canvas & Layout']);

    await enter(input);
    // Observed through the app's own mechanism: switchSettingsTab marks the
    // panel it reveals, rather than the test asserting on a stubbed call.
    assert.ok(h.getElement('tab-rendering').classList.contains('active'),
      'picking a completion opens that tab');
    assert.equal(h.context.getActivePanelTab('rpanel'), 'statemate',
      'and the panel stays selected: a dialog covers it anyway, and stowing '
      + 'first would hand the closing focus to the Inspector tab');
  } finally {
    h.context.document.querySelectorAll = realQuery;
  }
});

test('/model goes to StateMate’s own settings, /settings to the app’s', () => {
  const h = createHarness();
  h.context.openStateMate();

  type(h, '/');
  const names = menuLabels(h).map(l => l.split(' ')[0]);
  assert.ok(names.includes('/model'), 'the model has a name of its own now');
  assert.ok(names.includes('/settings'), 'and no longer shares one with the app');

  h.context.openStateMateSettings();
  assert.ok(h.getElement('tab-ai').classList.contains('active'),
    '/model lands on the StateMate tab');
});

test('an unknown command is reported, not sent to a language model', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  let modelCalls = 0;
  h.context.fetch = async (url, init) => {
    if (init) modelCalls++;
    return jsonResponse({});
  };

  const input = type(h, '/wat');
  await enter(input);

  assert.match(logText(h), /Unknown command/);
  assert.equal(modelCalls, 0);
});

test('the exact construction is offered without taking the keystroke', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  // The algorithm catalogue is read from the markup at runtime, so the stub
  // supplies one. "minimize" is something the app does exactly.
  const realQuery = h.context.document.querySelectorAll;
  h.context.document.querySelectorAll = sel => sel === '.algo-item'
    ? [{ dataset: { algo: 'minimize' }, textContent: 'DFA Minimize' }]
    : [];
  try {
    const input = type(h, 'minimise');
    assert.match(deepText(h.getElement('sm-nudge')), /DFA Minimize/,
      'the real construction is offered');

    // …but the sentence being typed still owns ⏎. That is the whole difference
    // between offering a tool and reinterpreting the request.
    await enter(input);
    assert.match(logText(h), /Even number of a's/);
    assert.equal(deepText(h.getElement('sm-nudge')), '', 'and the offer clears with the line');
  } finally {
    h.context.document.querySelectorAll = realQuery;
  }
});

test('the status bar states the canvas and is where it is switched', () => {
  const h = createHarness();
  const { App } = h.context;
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }, { id: 's2', name: 'q1', x: 90, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  const chip = h.getElement('sm-status').children.find(c => /canvas/.test(deepText(c)));
  assert.ok(chip, 'the context that decides what the next ⏎ does is stated');
  assert.match(deepText(chip), /2 states, 1 transition/);
  assert.equal(chip.getAttribute('aria-pressed'), 'true');

  chip.onclick();
  const after = h.getElement('sm-status').children.find(c => /canvas/.test(deepText(c)));
  assert.equal(after.getAttribute('aria-pressed'), 'false');
  // Switching it is a turn in the conversation, not a silent mode change.
  assert.match(logText(h), /stays out of your next prompt/);
});

test('the transcript outlives the dialog, and /clear forgets it', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a' });

  // The run happened outside the console, so what it shows on opening comes
  // from the retained thread rather than from anything it recorded itself.
  h.context.openStateMate();
  assert.match(logText(h), /even number of a/);
  assert.match(logText(h), /Even number of a's — 2 states/);

  const input = type(h, '/clear');
  await enter(input);
  assert.deepEqual(h.context.getThread(), []);
  assert.ok(!entryKinds(h).some(c => c.includes('is-user')), 'the transcript goes with it');
  // The machine the run drew is still on the canvas, so the empty state opens
  // in chat + edit — it offers to talk about that machine, not to replace it.
  assert.match(logText(h), /Ask about this DFA, or ask for a change/,
    'and the console is back to its empty state');
});

test('a reply lands in the transcript, because nothing was drawn', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  h.context.fetch = fakeFetch(() => replyTurn('There is no machine for that.'));
  const input = type(h, 'what is a DFA?');
  await enter(input);

  assert.equal(h.context.getActivePanelTab('rpanel'), 'statemate');
  assert.match(logText(h), /There is no machine for that/);
  assert.ok(entryKinds(h).some(c => c.includes('is-reply')));
  assert.equal(input.value, '', 'the composer is cleared and ready for the next turn');
});

test('a reply is rendered as markdown, and its markup is not', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  h.context.fetch = fakeFetch(() => replyTurn([
    'A **DFA** cannot count, because:',
    '',
    '- it has finitely many states',
    '- `aⁿbⁿ` needs unboundedly many',
    '',
    'See <script>alert(1)</script> for why.'
  ].join('\n')));

  const input = type(h, 'why can a DFA not do aⁿbⁿ?');
  await enter(input);

  const findAllIn = (node, want) => {
    const out = [];
    (function walk(n) {
      (n.children || []).forEach(c => {
        if (c.tagName && String(c.tagName).toLowerCase() === want) out.push(c);
        walk(c);
      });
    })(node);
    return out;
  };
  const log = h.getElement('sm-log');

  assert.equal(findAllIn(log, 'strong').length, 1, 'the reply is parsed, not printed');
  assert.equal(findAllIn(log, 'li').length, 2);
  assert.equal(findAllIn(log, 'code').length, 1);
  // The reply is text from a remote service; the renderer builds nodes and
  // never assigns markup, so a <script> in it is characters on the screen.
  assert.equal(findAllIn(log, 'script').length, 0);
  assert.match(logText(h), /<script>alert\(1\)<\/script>/);
});

test('a prompt with no key configured never reaches a provider', async () => {
  const h = createHarness();
  h.context.openStateMate();

  let modelCalls = 0;
  h.context.fetch = async (url, init) => {
    if (init) modelCalls++;
    return jsonResponse({});
  };

  const input = type(h, 'binary numbers divisible by 3');
  await enter(input);

  assert.equal(modelCalls, 0);
  assert.match(logText(h), /API key/);
});

// ══════════════════════════════════════════════════════════════════
//  THE INFO CARD
// ══════════════════════════════════════════════════════════════════
//  It lives over the canvas now, not in the Simulate panel, and it shows
//  itself after a run before folding back into the button at the corner.

test('a result opens the card over the canvas and leaves a way back to it', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  await h.context.runStateMate({ prompt: 'even number of a' });

  const card = h.getElement('example-card');
  const btn = h.getElement('canvas-info-btn');
  assert.ok(card.classList.contains('is-open'), 'the card opened itself');
  assert.equal(btn.hidden, true, 'the button it springs from is out of the way while it is open');
  // The title is the field you edit, so it is a value rather than text — see
  // the header of tests/machine-card.test.js.
  const titleField = (function find(node) {
    for (const child of node.children || []) {
      if (String(child.className || '').split(/\s+/).includes('example-card-title')) return child;
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  })(card);
  assert.match(titleField?.value || '', /Even number of a's/);

  // The auto-hide is a timer, so the collapse is asserted directly rather than
  // by waiting thirteen seconds for it.
  h.context.hideExampleCard();
  assert.equal(card.classList.contains('is-open'), false);
  assert.equal(btn.hidden, false, 'and the button comes back, because there is still something to read');

  h.context.toggleExampleCard();
  assert.ok(card.classList.contains('is-open'), 'the button reopens it');
});

test('nothing to say means no card and no button', () => {
  const h = createHarness();
  h.context.showExampleCard({ title: 'Something', blurb: 'anything' });
  assert.equal(h.getElement('canvas-info-btn').hidden, true, 'hidden because the card is open over it');

  h.context.showExampleCard(null);
  assert.equal(h.getElement('example-card').classList.contains('is-open'), false);
  assert.equal(h.getElement('canvas-info-btn').hidden, true,
    'an info button that opens an empty card is worse than no button');

  // And it cannot be talked into opening on nothing.
  h.context.toggleExampleCard();
  assert.equal(h.getElement('example-card').classList.contains('is-open'), false);
});

test('a failed check is reported to the reader, not to the model', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', verify: true, repairAttempts: 0
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({
    tests: [{ w: 'a', expect: 'accept' }, { w: 'aa', expect: 'accept' }]
  })));

  const result = await h.context.runStateMate({ prompt: 'even number of a' });
  h.context.decorateResultCard(result);

  const text = deepText(h.getElement('example-card'));
  assert.match(text, /1 check failed/);
  assert.match(text, /“a” should be accepted, but this machine rejects it/);
  // The reader predicted nothing and never saw a prediction. Addressing them
  // in the second person about one is the bug this pins.
  assert.ok(!/you predicted/.test(text), 'the model-facing phrasing stays in the repair message');
});

test('the result strip reports the diff, the verdict and a way back', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  const result = await h.context.runStateMate({ prompt: 'even number of a' });
  h.context.decorateResultCard(result);

  const card = h.getElement('example-card');
  const classAt = i => String(card.children[i]?.className || '');

  // The machine's own name leads the card; what changed is a line under it,
  // and what you can do about it is a footer. A strip of diff chips above the
  // title reads as the card's heading and buries the name in the middle.
  assert.match(classAt(0), /example-card-head/);
  assert.match(classAt(1), /sm-result-strip/);

  const strip = card.children[1];
  assert.match(deepText(strip), /StateMate/);
  assert.match(deepText(strip), /3\/3 checks/);
  assert.match(deepText(strip), /\+2 states/);
  assert.ok(!/Undo/.test(deepText(strip)), 'the actions are no longer wedged in beside the chips');

  const actions = card.children.find(c => String(c.className).includes('sm-result-actions'));
  assert.ok(actions, 'they are a footer of their own');
  // "Revert", not "Undo": the turn carries a checkpoint, so the way back is
  // exact rather than "pop whatever is on top of the history stack".
  assert.match(deepText(actions), /Revert/);
  assert.match(deepText(actions), /Regenerate/);
});

// ══════════════════════════════════════════════════════════════════
//  WRITE AUTHORITY
// ══════════════════════════════════════════════════════════════════
//  Three modes over one branch at step 7. What each test pins is the same
//  question asked three ways: did the canvas change, and was that the mode's
//  promise?

async function buildSomething(h) {
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });
  return h.context.exportWorkspaceState();
}

test('propose builds and checks a machine without drawing it', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  const before = h.context.exportWorkspaceState();

  const result = await h.context.runStateMate({ prompt: 'even number of a', authority: 'propose' });

  assert.equal(result.status, 'proposed');
  assert.equal(result.hold, 'propose');
  assert.deepEqual(h.context.exportWorkspaceState(), before, 'nothing reached the canvas');
  // The point of proposing rather than asking: it is a finished, verified
  // machine, so the diff and the checks are real before you decide.
  assert.ok(result.batch.allPassed, 'the checks ran anyway');
  assert.deepEqual(result.summary, ['+2 states', '+4 transitions']);
  assert.ok(result.pending, 'and it is kept, ready to draw');
});

test('applying a proposal draws exactly what was proposed', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  const proposed = await h.context.runStateMate({ prompt: 'even number of a', authority: 'propose' });
  const applied = h.context.applyPending(proposed);

  assert.equal(applied.status, 'applied');
  assert.equal(applied.pending, null);
  assert.deepEqual(h.context.App.states.map(s => s.name).sort(), ['even', 'odd']);
  assert.equal(h.context.App.transitions.length, 4);
});

test('ask never writes, whatever comes back', async () => {
  const h = createHarness();
  const before = await buildSomething(h);

  // Even if the model ignores the read-only instruction and returns a machine,
  // the pipeline refuses to draw it. The mode is enforced, not requested.
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({
    title: 'Something else', states: [{ name: 'x', start: true, accept: true }],
    transitions: [{ from: 'x', to: 'x', on: 'a' }, { from: 'x', to: 'x', on: 'b' }]
  })));
  const result = await h.context.runStateMate({ prompt: 'what does this accept?', authority: 'ask' });

  assert.equal(result.status, 'proposed');
  assert.equal(result.hold, 'ask');
  assert.deepEqual(h.context.exportWorkspaceState(), before, 'ask mode is read-only');
});

test('the prompt tells ask mode it is read-only', () => {
  const h = createHarness();
  const spec = { machine: 'DFA', states: [{ name: 'q', start: true }], transitions: [] };
  const asked = h.context.buildUserMessage({ prompt: 'is this minimal?', intent: 'edit', canvasSpec: spec, authority: 'ask' });
  assert.match(asked, /THIS TURN IS READ-ONLY/);
  assert.match(asked, /describe the one you would build/);

  const auto = h.context.buildUserMessage({ prompt: 'add a trap', intent: 'edit', canvasSpec: spec, authority: 'auto' });
  assert.ok(!/READ-ONLY/.test(auto));
});

test('auto holds back an edit that removes most of the machine', async () => {
  const h = createHarness();
  await buildSomething(h);
  const before = h.context.exportWorkspaceState();

  // Four states in, one state out: an "edit" that is really a replacement.
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({
    title: 'Collapsed',
    states: [{ name: 'only', start: true, accept: true }],
    transitions: [{ from: 'only', to: 'only', on: 'a' }, { from: 'only', to: 'only', on: 'b' }],
    tests: [{ w: 'a', expect: 'accept' }, { w: 'b', expect: 'accept' }, { w: 'ε', expect: 'accept' }]
  })));
  const result = await h.context.runStateMate({ prompt: 'simplify it', intent: 'edit', authority: 'auto' });

  assert.equal(result.status, 'proposed', 'auto stopped to ask');
  assert.equal(result.hold, 'scope');
  assert.match(result.holdDetail, /removes 2 of the 2 states/);
  assert.deepEqual(h.context.exportWorkspaceState(), before, 'and drew nothing meanwhile');
});

test('a build over existing work is a replacement, not an overreach', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', newTabForBuild: false
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });

  // Building removes every state the old machine had — that is the request,
  // so the guard must not read it as an edit gone wrong.
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({
    title: 'Ends in b',
    states: [{ name: 'no', start: true }, { name: 'yes', accept: true }],
    transitions: [
      { from: 'no', to: 'yes', on: 'b' }, { from: 'no', to: 'no', on: 'a' },
      { from: 'yes', to: 'no', on: 'a' }, { from: 'yes', to: 'yes', on: 'b' }
    ],
    tests: [{ w: 'b', expect: 'accept' }, { w: 'a', expect: 'reject' }, { w: 'ab', expect: 'accept' }]
  })));
  const result = await h.context.runStateMate({ prompt: 'a DFA for strings ending in b', intent: 'build', authority: 'auto' });

  assert.equal(result.status, 'applied');
  assert.deepEqual(h.context.App.states.map(s => s.name).sort(), ['no', 'yes']);
});

test('the turn subject is inferred, and /new overrides it for one turn', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', newTabForBuild: false
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  h.context.openStateMate();
  type(h, '/mode auto');
  await enter(h.getElement('sm-input'));

  // Nothing on the canvas: the turn can only be a build, and there is no
  // switch to get wrong.
  let input = type(h, 'even number of a');
  await enter(input);
  assert.ok(App.states.length, 'and it built one');

  // Now there is a machine, so an unqualified turn is about it.
  const sent = () => JSON.parse(h.context.fetch.calls.at(-1).init.body).messages.at(-1).content;
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  input = type(h, 'add a trap state');
  await enter(input);
  assert.match(sent(), /MACHINE CURRENTLY ON THE CANVAS/, 'the canvas is the subject');

  // …unless this one turn says otherwise. /new is an override, not a mode: it
  // carries its own prompt and leaves nothing switched on behind it.
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  input = type(h, '/new a DFA for strings ending in b');
  await enter(input);
  assert.match(sent(), /FOR CONTEXT/, 'the canvas is context, not the thing being edited');
  assert.match(sent(), /REQUEST: a DFA for strings ending in b/,
    'and the text after the command is the prompt, not dropped');

  // The next turn is about the canvas again, with nothing to switch back.
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  input = type(h, 'rename the states');
  await enter(input);
  assert.match(sent(), /MACHINE CURRENTLY ON THE CANVAS/);
});

test('detaching the canvas is what makes a turn a fresh build', () => {
  const h = createHarness();
  const { App } = h.context;
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }];
  App.startId = 's1';
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  // One switch, not two. The old build/edit toggle had to be kept in step
  // with this one by hand, and "edit the machine I am not sending you" was a
  // reachable state.
  assert.match(h.getElement('sm-input').placeholder, /Ask about or change/);

  const chip = h.getElement('sm-status').children.find(c => /canvas/.test(deepText(c)));
  chip.onclick();
  assert.match(h.getElement('sm-input').placeholder, /to build/);
});

test('the console defaults to propose and cycles with the status chip', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  // Compared against the registry rather than quoted, so renaming the modes on
  // screen is a copy change and not a test failure.
  const COPY = h.context.AUTHORITY_COPY;
  const labels = new Set(Object.values(COPY).map(c => c.label));
  const chip = () => h.getElement('sm-status').children
    .find(c => labels.has(deepText(c).trim()));
  assert.equal(deepText(chip()), COPY.propose.label, 'the safe default is the default');

  chip().onclick();
  assert.equal(deepText(chip()), COPY.auto.label);
  chip().onclick();
  assert.equal(deepText(chip()), COPY.ask.label);
  assert.match(logText(h), /Read-only/, 'and the change says what it means');

  // Authority is a standing decision, so reopening the dialog must not quietly
  // reset it to the default.
  h.context.stowStateMate();
  h.context.openStateMate();
  assert.equal(deepText(chip()), COPY.ask.label);
});

test('a replacing edit reads as one chip per dimension, not four', () => {
  const h = createHarness();
  // The shape in the screenshot that prompted this: an edit that came back as
  // a replacement. "+4 states −7 states +8 transitions −14 transitions" is the
  // same two facts said twice, in four pills that wrap to say it.
  const chips = h.context.summarizeDiff({
    machineChanged: false,
    statesAdded: ['a', 'b', 'c', 'd'],
    statesRemoved: ['p', 'q', 'r', 's', 't', 'u', 'v'],
    statesRenamed: [],
    transitionsAdded: 8,
    transitionsRemoved: 14,
    sigmaAdded: []
  });
  assert.deepEqual(chips, ['+4 −7 states', '+8 −14 transitions']);

  const oneWay = h.context.summarizeDiff({
    machineChanged: false,
    statesAdded: ['a'], statesRemoved: [], statesRenamed: [],
    transitionsAdded: 0, transitionsRemoved: 0, sigmaAdded: []
  });
  assert.deepEqual(oneWay, ['+1 state'], 'a one-sided diff still reads as it always did');
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

// ══════════════════════════════════════════════════════════════════
//  ERROR CLASSIFICATION
// ══════════════════════════════════════════════════════════════════
//  The status code is not the diagnosis. Three failures lie about themselves —
//  quota arrives as a rate limit, an overlong prompt as a bad request, an
//  unknown model as either — and each one wants a different sentence and a
//  different button. Classifying them off the body is what makes the Retry
//  button mean something.

test('quota is not a rate limit, whatever status it arrives with', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'openai', apiKey: 'sk-test', maxRetries: 0 });
  h.context.fetch = fakeFetch(() => jsonResponse(
    { error: { type: 'insufficient_quota', message: 'You exceeded your current quota.' } },
    { ok: false, status: 429 }
  ));

  // Read as a rate limit this got a Retry button, and no amount of retrying
  // could ever clear it. The action is the account, not the button.
  await assert.rejects(
    () => h.context.callModel({ system: 'S', user: 'U' }),
    err => err.code === 'credit' && /quota/i.test(err.message)
  );
  assert.equal(h.context.isRetriableError({ code: 'credit' }), false);
  assert.equal(h.context.describeError({ code: 'credit' }).action, 'settings');
});

test('the provider says what went wrong, and that is what is shown', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.fetch = fakeFetch(() => jsonResponse(
    { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: must be ≥ 1' } },
    { ok: false, status: 400 }
  ));

  await assert.rejects(
    () => h.context.callModel({ system: 'S', user: 'U' }),
    err => err.code === 'bad-request' && /must be ≥ 1/.test(err.message)
  );
  // describeError prefers the thrown message over its own generic copy, so
  // reading the body improves every error at once.
  assert.match(h.context.describeError(new h.context.ProviderError('http', 'Model foo is retired.')).text, /retired/);
});

test('overload, context length and an unknown model are told apart', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });

  const cases = [
    [529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'overloaded'],
    [400, { error: { message: 'prompt is too long: 250000 tokens > 200000' } }, 'context-length'],
    [400, { error: { message: 'model claude-nope does not exist' } }, 'not-found'],
    [402, { error: { message: 'Payment required' } }, 'credit']
  ];
  for (const [status, body, code] of cases) {
    h.context.fetch = fakeFetch(() => jsonResponse(body, { ok: false, status }));
    await assert.rejects(
      () => h.context.callModel({ system: 'S', user: 'U' }),
      err => err.code === code,
      `HTTP ${status} ${JSON.stringify(body)} should be ${code}`
    );
  }
  // Only the transient one is worth asking again about.
  assert.equal(h.context.isRetriableError({ code: 'overloaded' }), true);
  assert.equal(h.context.isRetriableError({ code: 'context-length' }), false);
});

test('retry-after is read as seconds or as a date, and never as a promise to wait forever', () => {
  const h = createHarness();
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  assert.equal(h.context.parseRetryAfter('12'), 12);
  assert.equal(h.context.parseRetryAfter(''), 0);
  assert.equal(h.context.parseRetryAfter(null), 0);
  assert.equal(h.context.parseRetryAfter('not a number'), 0);
  // A provider asking for ten minutes is telling us to give up, not to sleep
  // through the user's afternoon.
  assert.equal(h.context.parseRetryAfter('9999'), 60);
  assert.equal(h.context.parseRetryAfter(new Date(now + 5000).toUTCString(), now), 5);
  assert.equal(h.context.parseRetryAfter(new Date(now - 5000).toUTCString(), now), 0);
});

// ══════════════════════════════════════════════════════════════════
//  RETRY
// ══════════════════════════════════════════════════════════════════

test('a transient failure is retried and a settled one is not', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'openai', apiKey: 'sk-test' });
  const slept = [];
  const sleep = async ms => { slept.push(ms); };

  const flaky = fakeFetch((_u, _i, n) => n < 3
    ? jsonResponse({ error: { message: 'upstream boom' } }, { ok: false, status: 503 })
    : jsonResponse({ choices: [{ message: { content: '{"machine":"DFA"}' } }] }));
  h.context.fetch = flaky;

  const out = await h.context.callModel({ system: 'S', user: 'U', maxRetries: 2, sleep });
  assert.equal(flaky.calls.length, 3);
  assert.equal(out.text, '{"machine":"DFA"}');
  // Exponential with jitter: each window is twice the last and never zero, so
  // a "retry" is a pause rather than a busy loop that happened to sleep.
  assert.equal(slept.length, 2);
  assert.ok(slept[0] >= 300 && slept[0] <= 600, `first wait ${slept[0]}`);
  assert.ok(slept[1] >= 600 && slept[1] <= 1200, `second wait ${slept[1]}`);

  const denied = fakeFetch(() => jsonResponse({ error: { message: 'bad key' } }, { ok: false, status: 401 }));
  h.context.fetch = denied;
  await assert.rejects(
    () => h.context.callModel({ system: 'S', user: 'U', maxRetries: 3, sleep }),
    e => e.code === 'auth'
  );
  assert.equal(denied.calls.length, 1, 'a rejected key is a fact about the request');
});

test('a retry is announced, and the provider\'s own window wins over the backoff', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'openai', apiKey: 'sk-test' });

  const waits = [];
  const seen = [];
  h.context.fetch = fakeFetch((_u, _i, n) => n === 1
    ? {
      ok: false,
      status: 429,
      headers: { get: name => (name === 'retry-after' ? '7' : null) },
      json: async () => ({}),
      text: async () => JSON.stringify({ error: { message: 'slow down' } })
    }
    : jsonResponse({ choices: [{ message: { content: '{}' } }] }));

  await h.context.callModel({
    system: 'S', user: 'U', maxRetries: 1,
    sleep: async ms => { waits.push(ms); },
    onRetry: info => seen.push(info)
  });

  assert.deepEqual(waits, [7000], 'the provider knows when its own window reopens');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].error.code, 'rate-limit');
  // A silent eight-second stall is indistinguishable from a hang, and the
  // user's only move is to abandon a request that was about to succeed.
  assert.equal(seen[0].attempt, 1);
  assert.equal(seen[0].of, 1);
});

test('a backoff wait is interrupted by a cancel, not waited out', async () => {
  const h = createHarness();
  const controller = new AbortController();
  const waited = h.context.delay(5000, controller.signal);
  controller.abort();
  await assert.rejects(() => waited, e => e.code === 'cancelled');

  // An already-aborted signal never arms a timer at all.
  await assert.rejects(() => h.context.delay(5000, controller.signal), e => e.code === 'cancelled');
});

test('an answer cut off at the cap is not a malformed answer', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.fetch = fakeFetch(() => jsonResponse({
    content: [{ type: 'text', text: '{"plan":"Track par' }],
    stop_reason: 'max_tokens',
    usage: { input_tokens: 5, output_tokens: 4000 }
  }));

  // Reported as bad JSON this burnt a repair round at the same cap, which
  // could only fail the same way.
  await assert.rejects(
    () => h.context.callModel({ system: 'S', user: 'U' }),
    err => err.code === 'truncated' && err.maxTokens === 4000
  );
});

test('every error code the pipeline throws still has a sentence and a button', () => {
  const h = createHarness();
  const codes = [
    'credit', 'overloaded', 'bad-request', 'offline', 'truncated',
    'context-length', 'refusal'
  ];
  for (const code of codes) {
    const info = h.context.describeError({ code, message: '' });
    assert.ok(info.text && info.text.length > 3, `${code} has no message`);
    assert.ok(['settings', 'retry', 'none'].includes(info.action), `${code} has no action`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  TIMING
// ══════════════════════════════════════════════════════════════════

test('a streamed answer is timed and a buffered one is not pretended to be', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.fetch = async () => sseResponse([
    'data: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{}"}}\n\n',
    'data: {"type":"message_delta","usage":{"output_tokens":300}}\n\n'
  ]);
  const streamed = await h.context.callModel({ system: 'S', user: 'U' });
  assert.equal(streamed.timing.streamed, true);
  assert.ok(streamed.timing.firstTokenAt >= streamed.timing.startedAt);

  h.context.fetch = fakeFetch(() => jsonResponse({ content: [{ type: 'text', text: '{}' }] }));
  const buffered = await h.context.callModel({ system: 'S', user: 'U' });
  assert.equal(buffered.timing.streamed, false);
  // A rate computed over a response that arrived all at once is fiction.
  assert.equal(h.context.throughput({ usage: { output: 300 }, timing: buffered.timing }).tps, null);
});

test('the meta line reports the rate and the wait separately', () => {
  const h = createHarness();
  const bits = h.context.resultMetaBits({
    model: 'claude-sonnet-5',
    usage: { input: 1200, output: 300 },
    timing: { startedAt: 0, firstTokenAt: 500, finishedAt: 2500, streamed: true },
    retries: [{ code: 'overloaded' }]
  });

  assert.ok(bits.includes('claude-sonnet-5'));
  assert.ok(bits.includes('1200 in / 300 out'));
  // 300 tokens over the two seconds it took to arrive — the half-second wait
  // before it started is the other number, not part of this one.
  assert.ok(bits.includes('150.0 tok/s'), bits.join(' · '));
  assert.ok(bits.includes('0.5s to first token'));
  assert.ok(bits.includes('1 retry'));

  // A local server answering a cached completion in three milliseconds is not
  // doing a hundred thousand tokens a second, and printing that makes every
  // other number on the line look made up too.
  const instant = h.context.throughput({
    usage: { output: 420 },
    timing: { startedAt: 0, firstTokenAt: 1, finishedAt: 7, streamed: true }
  });
  assert.equal(instant.tps, null, 'a window that short is measurement error, not a rate');
  assert.equal(instant.ttftMs, 1, 'the wait is still real and still reported');
});

// ══════════════════════════════════════════════════════════════════
//  STREAMING A REPLY
// ══════════════════════════════════════════════════════════════════

test('a string field is readable before the JSON closes', () => {
  const h = createHarness();
  const P = h.context.partialStringField;

  assert.equal(P('{"plan":"Track parity."}', 'plan'), 'Track parity.');
  assert.equal(P('{"plan":"Track par', 'plan'), 'Track par', 'still arriving');
  assert.equal(P('{"kind":"reply","text":"a \\"quoted\\" word"}', 'text'), 'a "quoted" word');
  assert.equal(P('{"text":"line\\nbreak"}', 'text'), 'line\nbreak');
  assert.equal(P('{"text":"\\u00e9"}', 'text'), 'é');
  // An escape sequence split across chunk boundaries stops rather than
  // emitting a stray backslash.
  assert.equal(P('{"text":"trailing\\', 'text'), 'trailing');
  assert.equal(P('{"text":"half \\u00', 'text'), 'half ');
  assert.equal(P('{"machine":"DFA"}', 'plan'), null, 'absent is null, not empty');
});

test('a reply streams, and a machine\'s own notes are not mistaken for one', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', writeNotes: true });

  const reply = '{"kind":"reply","text":"A DFA cannot count."}';
  h.context.fetch = async () => sseResponse([
    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(reply.slice(0, 34))}}}\n\n`,
    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(reply.slice(34))}}}\n\n`
  ]);

  const deltas = [];
  await h.context.runStateMate({
    prompt: 'can a DFA count?',
    onEvent: e => { if (e.type === 'reply-delta') deltas.push(e.text); }
  });
  assert.ok(deltas.length >= 1, 'the answer was shown as it arrived');
  assert.equal(deltas.at(-1), 'A DFA cannot count.');

  // A machine answer carrying canvas notes has a "text" of its own, and
  // streaming it would put the first note on screen as if it were a reply.
  const machine = JSON.stringify(dfaSpec({
    kind: 'machine',
    notes: [{ text: 'The state is the parity.', anchor: 'even' }]
  }));
  h.context.fetch = async () => sseResponse([
    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(machine)}}}\n\n`
  ]);
  const seen = [];
  await h.context.runStateMate({
    prompt: 'even number of a',
    authority: 'auto',
    onEvent: e => { if (e.type === 'reply-delta') seen.push(e.text); }
  });
  assert.deepEqual(seen, [], 'the kind is declared, so it is not guessed at');
});

// ══════════════════════════════════════════════════════════════════
//  THE DIFF, LINE BY LINE
// ══════════════════════════════════════════════════════════════════

test('the diff says what changed, not only how much', () => {
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
  const said = op => diff.lines.filter(l => l.op === op).map(l => l.text);

  assert.ok(said('+').includes('Σ  b'));
  assert.ok(said('-').includes('state  gone'));
  assert.ok(said('+').some(t => /^state  odd/.test(t)));
  // The arrows read as arrows, in the machine's own fields.
  assert.ok(said('+').includes('even --a--> odd'));
  assert.ok(said('-').includes('even --a--> gone'));
  // An accepting mark appearing on a state that survived is structurally
  // invisible in the counts, and is usually the whole point of the edit.
  assert.ok(said('~').some(t => /^state  even .*accepting/.test(t)), said('~').join(' | '));
});

test('a renamed state reads as a rename, and two identical arrows as two arrows', () => {
  const h = createHarness();

  const before = {
    ...emptyMachine(),
    sigma: ['a'],
    states: [{ id: 's1', name: 'p', x: 0, y: 0 }],
    transitions: [
      { id: 't1', from: 's1', to: 's1', symbol: 'a' },
      { id: 't2', from: 's1', to: 's1', symbol: 'a' }
    ],
    startId: 's1', accepts: []
  };
  const dropped = h.context.computeDiff(before, { ...before, transitions: [before.transitions[0]] });
  assert.equal(dropped.lines.filter(l => l.op === '-').length, 1,
    'reporting one of a duplicated pair as removed would be a lie');

  const renamed = h.context.computeDiff(
    before,
    { ...before, states: [{ id: 's1', name: 'parity', x: 0, y: 0 }] },
    { reused: new Set(['s1']) }
  );
  assert.ok(renamed.lines.some(l => l.op === '~' && /"p" → "parity"/.test(l.text)));
});

test('a machine change is one line, and the diff is bounded', () => {
  const h = createHarness();
  const wide = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, name: `q${i}`, x: i * 10, y: 0 }));
  const before = {
    ...emptyMachine(),
    sigma: ['a'],
    states: wide,
    transitions: wide.map((s, i) => ({ id: `t${i}`, from: s.id, to: wide[(i + 1) % wide.length].id, symbol: 'a' })),
    startId: 's0', accepts: []
  };
  const diff = h.context.computeDiff(before, { ...emptyMachine('NPDA'), sigma: ['a'] });

  assert.ok(diff.lines.some(l => l.kind === 'machine' && /DFA → NPDA/.test(l.text)));
  // Nobody reads past the first screen, and the counts are the honest summary.
  assert.ok(diff.lines.length <= 201, `${diff.lines.length} lines`);
  assert.equal(diff.lines.at(-1).kind, 'more');
});

// ══════════════════════════════════════════════════════════════════
//  THE SELECTION AS CONTEXT
// ══════════════════════════════════════════════════════════════════
//  attachCanvas is all-or-nothing, so on a forty-state machine there was no
//  way to say "why does *this* state reject". These pin the two properties
//  that make the answer safe: it is a pointer into the machine rather than a
//  replacement for it, and it is resolved to names.

test('a selection is described to the model by name, never by id', () => {
  const h = createHarness();
  const { App } = h.context;
  App.states = [{ id: 's1', name: 'even', x: 0, y: 0 }, { id: 's2', name: 'odd', x: 90, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';

  const focus = h.context.resolveContextRefs([
    { kind: 'states', ids: ['s1', 's2'] },
    { kind: 'transitions', ids: ['t1'] },
    { kind: 'states', ids: ['s404'] },
    { kind: 'word', w: '' }
  ]);

  assert.deepEqual(focus.states, ['even', 'odd']);
  assert.deepEqual(focus.transitions, ['even --a--> odd']);
  assert.deepEqual(focus.words, ['ε']);
  // Refs resolve late, so one that stops resolving is counted rather than
  // guessed at or sent as a token the model has never seen.
  assert.equal(focus.missing, 1);
  assert.ok(!JSON.stringify(focus).includes('s1'), 'no canvas id reaches the prompt');
  assert.equal(h.context.focusIsEmpty(h.context.resolveContextRefs([])), true);
});

test('a transition reads as one line, in the machine\'s own fields', () => {
  const h = createHarness();
  const L = h.context.specTransitionLabel;
  assert.equal(L({ from: 'p', to: 'q', on: 'a' }, 'DFA'), 'p --a--> q');
  assert.equal(L({ from: 'p', to: 'q', on: 'a', pop: 'Z', push: 'AZ' }, 'NPDA'), 'p --a, Z/AZ--> q');
  assert.equal(L({ from: 'p', to: 'q', on: 'a', write: 'b', move: 'R' }, 'TM'), 'p --a → b, R--> q');
  assert.equal(L({ from: 'p', to: 'q', on: 'a', out: '1' }, 'Mealy'), 'p --a / 1--> q');
});

test('the focus block points into the machine rather than replacing it', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });

  const odd = App.states.find(s => s.name === 'odd');
  const stub = fakeFetch(() => replyTurn('Because the run ends there.'));
  h.context.fetch = stub;
  await h.context.runStateMate({
    prompt: 'why does this reject a?',
    intent: 'edit',
    authority: 'ask',
    context: [{ kind: 'states', ids: [odd.id] }]
  });

  const sent = stub.calls[0].body.messages.at(-1).content;
  assert.match(sent, /THESE PARTS OF THE MACHINE/);
  assert.match(sent, /states: odd/);
  assert.ok(!sent.includes(odd.id), 'the canvas id never leaves the app');
  // The point of a focus is that it qualifies the machine, not that it stands
  // in for it: almost no question about one state is answerable without the rest.
  assert.match(sent, /MACHINE CURRENTLY ON THE CANVAS/);

  const without = h.context.buildUserMessage({ prompt: 'x', intent: 'build' });
  assert.ok(!/THESE PARTS OF THE MACHINE/.test(without));
});

// ══════════════════════════════════════════════════════════════════
//  SELF-HEALING
// ══════════════════════════════════════════════════════════════════
//  Two failures that are about the request being the wrong size rather than
//  the answer being wrong, so neither spends a repair attempt — and both are
//  reported, because both changed what was asked.

test('a truncated answer is asked again with more room, once, and says so', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', repairAttempts: 0, maxRetries: 0
  });
  const stub = fakeFetch((_u, _i, n) => n === 1
    ? jsonResponse({ content: [{ type: 'text', text: '{"plan":"cut' }], stop_reason: 'max_tokens' })
    : anthropicReply(dfaSpec()));
  h.context.fetch = stub;

  const result = await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });

  assert.equal(stub.calls.length, 2);
  assert.ok(stub.calls[1].body.max_tokens > stub.calls[0].body.max_tokens, 'the cap was raised');
  assert.equal(result.grewCap, true);
  assert.equal(result.status, 'applied');
  assert.ok(h.context.resultNotes(result).some(n => /cut off/.test(n.message)),
    'a change the reader cannot see is one they cannot distrust');
});

test('a request too long is retried without the conversation, and says so', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6,
    repairAttempts: 0, maxRetries: 0
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });

  const stub = fakeFetch((_u, _i, n) => n === 1
    ? jsonResponse({ error: { message: 'prompt is too long: 250000 tokens' } }, { ok: false, status: 400 })
    : anthropicReply(dfaSpec()));
  h.context.fetch = stub;
  const result = await h.context.runStateMate({ prompt: 'add a trap state', intent: 'edit', authority: 'auto' });

  assert.equal(stub.calls.length, 2);
  assert.ok(stub.calls[0].body.messages.length > 1, 'the first try carried the history');
  assert.equal(stub.calls[1].body.messages.length, 1, 'the retry carried the request alone');
  assert.ok(!/CURRENTLY ON THE CANVAS/.test(stub.calls[1].body.messages[0].content),
    'and not the attached machine either');
  assert.equal(result.trimmed, true);
  assert.ok(h.context.resultNotes(result).some(n => /too long/.test(n.message)));
});

// ══════════════════════════════════════════════════════════════════
//  CHECKPOINTS
// ══════════════════════════════════════════════════════════════════
//  Why undo() was not enough: it pops the top of App.history, which is this
//  turn only until the next edit and one of *those* afterwards. The tooltip
//  saying "undo everything StateMate just did" was simply false.

test('a checkpoint restores the machine however much happened since', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0, newTabForBuild: false
  });

  App.states = [{ id: 's9', name: 'mine', x: 5, y: 6 }];
  App.startId = 's9';
  const before = JSON.stringify(h.context.exportWorkspaceState().states);

  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  const result = await h.context.runStateMate({ prompt: 'even number of a', intent: 'build', authority: 'auto' });
  assert.ok(result.checkpoint && h.context.hasCheckpoint(result.checkpoint));

  // Three unrelated edits, so the top of the undo stack is no longer this turn.
  h.context.commit(() => { App.states.push({ id: 'sx', name: 'extra', x: 1, y: 1 }); });
  h.context.commit(() => { App.states.push({ id: 'sy', name: 'extra2', x: 2, y: 2 }); });
  h.context.commit(() => { App.sigma.add('c'); });

  assert.equal(h.context.restoreCheckpoint(result.checkpoint), true);
  assert.equal(JSON.stringify(h.context.exportWorkspaceState().states), before);

  // …and the restore is itself one undoable step, not a rewriting of history.
  h.context.undo();
  assert.ok(App.states.some(s => s.name === 'extra2'));
});

test('a build into its own tab records no checkpoint, because it replaced nothing', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createTab('First');
  App.states = [{ id: 's9', name: 'keep', x: 0, y: 0 }];
  App.startId = 's9';

  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0, newTabForBuild: true
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  const result = await h.context.runStateMate({ prompt: 'even number of a', intent: 'build', authority: 'auto' });

  assert.equal(result.openedNewTab, true);
  // A "restore" here would be a promise to undo an empty canvas.
  assert.equal(result.checkpoint, '');
});

test('a checkpoint lives outside the workspace it snapshots', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  const result = await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });

  // Same reason as the API key and the thread: exportWorkspaceState deep-copies
  // into every tab and getBackupPayload writes to IndexedDB, so a checkpoint in
  // App.config would put a copy of every past machine in the autosave blob.
  assert.ok(!JSON.stringify(h.context.exportWorkspaceState()).includes(result.checkpoint));
  assert.ok(!JSON.stringify(h.context.App.config).includes(result.checkpoint));
  assert.ok(!JSON.stringify(h.context.getBackupPayload()).includes(result.checkpoint));
});

// ══════════════════════════════════════════════════════════════════
//  BRANCHING
// ══════════════════════════════════════════════════════════════════
//  Retry used to append, so the next request opened with "[built: …]" and then
//  asked for the same thing again — the model was told to redo work it could
//  see it had already done. A correct retry truncates the thread, which is
//  exactly a branch, so the two are one feature.

test('a retry replaces a turn rather than adding to it', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6, maxRetries: 0
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });

  const first = h.context.getThread();
  assert.equal(first.length, 2);

  const stub = fakeFetch(() => anthropicReply(dfaSpec({ title: 'Second attempt' })));
  h.context.fetch = stub;
  await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto', branch: first[0].id });

  const after = h.context.getThread();
  assert.equal(after.length, 2, 'the conversation is still one exchange long');
  assert.match(after[1].text, /Second attempt/);
  assert.equal(stub.calls[0].body.messages.length, 1,
    'the rejected answer is not handed back as work already done');

  // Both attempts are still reachable, which is what makes it a branch rather
  // than a deletion.
  const { list, index } = h.context.siblingsOf(after[0].id);
  assert.equal(list.length, 2);
  assert.equal(index, 1);
  h.context.selectSibling(list[0].id);
  assert.match(h.context.getThread()[1].text, /Even number of a/);
});

test('forgetting a turn leaves the machine it drew on the canvas', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await h.context.runStateMate({ prompt: 'even number of a', authority: 'auto' });

  const drawn = App.states.length;
  assert.ok(drawn);
  assert.equal(h.context.removeTurn(h.context.getThread()[0].id), true);

  assert.deepEqual(h.context.getThread(), []);
  // Quietly reverting someone's diagram because they tidied their transcript
  // would be the worst kind of surprise. Reverting is what a checkpoint is for.
  assert.equal(App.states.length, drawn);
});

test('the retained conversation is bounded, and branches go before intent', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 2, maxRetries: 0
  });
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));

  for (let i = 0; i < 20; i++) {
    await h.context.runStateMate({ prompt: `turn ${i}`, authority: 'auto' });
  }
  const thread = h.context.getThread();
  assert.ok(thread.length <= 24, `${thread.length} turns retained`);
  // The oldest intent is dropped by detaching its successor, not by taking the
  // whole conversation with it.
  assert.equal(thread.at(-2).text, 'turn 19');
});

// ══════════════════════════════════════════════════════════════════
//  THE CONSOLE'S NEW SURFACES
// ══════════════════════════════════════════════════════════════════

const exactly = (node, cls) => findAll(node, cls).filter(n => String(n.className) === cls);

// The tool row is glyph-only, so its buttons are found the way a screen reader
// finds them — by accessible name, which is also what the tooltip says.
const tool = (node, name) =>
  findAll(node, 'sm-tool').find(b => b.getAttribute('aria-label') === name);

test('every turn carries the time it happened', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const stamps = findAll(h.getElement('sm-log'), 'sm-stamp');
  assert.ok(stamps.length >= 2, 'the prompt and the answer are both stamped');
  assert.match(deepText(stamps[0]), /^\d{2}:\d{2}$/);
});

test('the machine card offers the diff, expanded while it is a proposal', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const details = exactly(h.getElement('sm-log'), 'sm-diff')[0];
  assert.ok(details, 'the card offers it');
  // The console defaults to propose, and in propose mode the diff is the thing
  // being approved rather than a record of something already done.
  assert.equal(details.open, true);
  const texts = findAll(details, 'sm-diff-text').map(deepText);
  assert.ok(texts.includes('even --a--> odd'), texts.join(' | '));
  assert.ok(texts.some(t => /^state  odd/.test(t)));
});

test('retry from the transcript replaces the turn on screen and in the thread', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6, maxRetries: 0
  });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({ title: 'Second attempt' })));
  const retry = tool(h.getElement('sm-log'), 'Retry');
  assert.ok(retry, 'a sent turn can be asked again');
  await retry.onclick();

  const text = logText(h);
  assert.match(text, /Second attempt/);
  assert.ok(!/Even number of a's/.test(text), 'the replaced answer is not left beside its replacement');
  assert.equal(h.context.getThread().length, 2);

  // …and the stepper is how you get back to it.
  const at = findAll(h.getElement('sm-log'), 'sm-branch-at')[0];
  assert.equal(deepText(at), '2/2');
});

test('deleting a turn clears it from the transcript, not from the canvas', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  // Accept the proposal first, so there is something drawn to lose.
  findAll(h.getElement('sm-log'), 'sm-btn').find(b => deepText(b) === 'Apply').onclick();
  const drawn = h.context.App.states.length;
  assert.ok(drawn);

  const del = tool(h.getElement('sm-log'), 'Delete turn');
  assert.ok(del);
  del.onclick();

  assert.ok(!/even number of a/.test(logText(h)));
  assert.equal(h.context.App.states.length, drawn,
    'tidying a transcript is not an undo — reverting is what a checkpoint is for');
});

test('a selection becomes context, rides with the prompt, and is spent', async () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  App.states = [{ id: 's1', name: 'even', x: 0, y: 0 }, { id: 's2', name: 'odd', x: 90, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';
  App.selectedStates = new Set(['s2']);

  h.context.askStateMateAboutSelection();
  const chips = findAll(h.getElement('sm-context'), 'sm-ctxchip-name');
  assert.equal(chips.length, 1);
  assert.equal(deepText(chips[0]), 'odd');

  const stub = fakeFetch(() => replyTurn('Because it is not accepting.'));
  h.context.fetch = stub;
  await enter(type(h, 'why does this reject a?'));

  assert.match(stub.calls[0].body.messages.at(-1).content, /states: odd/);
  // The basket described *that* sentence. Left armed it would silently qualify
  // every prompt after it.
  assert.equal(findAll(h.getElement('sm-context'), 'sm-ctxchip').length, 0);
});

test('the right-click menu is a way into StateMate', () => {
  const h = createHarness();
  const { App } = h.context;
  App.states = [{ id: 's1', name: 'even', x: 0, y: 0 }, { id: 's2', name: 'odd', x: 90, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';

  // Right-clicking an unselected state acts on it alone…
  App.ctxMode = 'state';
  App.ctxId = 's2';
  h.context.ctxAddToStateMateContext();
  h.context.openStateMate();
  assert.deepEqual(findAll(h.getElement('sm-context'), 'sm-ctxchip-name').map(deepText), ['odd']);

  // …and on one that is part of a selection, on the selection — the same rule
  // the note anchors follow, through the same helper.
  h.context.clearStateMateContext();
  App.selectedStates = new Set(['s1', 's2']);
  App.ctxMode = 'state';
  App.ctxId = 's1';
  h.context.ctxAddToStateMateContext();
  assert.deepEqual(findAll(h.getElement('sm-context'), 'sm-ctxchip-name').map(deepText), ['even, odd']);
});

test('copy hands over the source, not what is on the screen', async () => {
  const h = createHarness();
  const copied = [];
  h.context.navigator.clipboard.writeText = async text => { copied.push(text); };

  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => replyTurn('A **DFA** cannot count.'));
  await enter(type(h, 'can a DFA count?'));

  // Scoped to the reply's own entry: the prompt above it has a copy button too,
  // and it is the one that comes first in the transcript.
  const replyEntry = findAll(h.getElement('sm-log'), 'is-reply')[0];
  const copy = tool(replyEntry, 'Copy answer');
  assert.ok(copy);
  copy.onclick();
  await Promise.resolve();

  // The reply is built as DOM and never as markup, so reading it back off the
  // page would hand over prose with its formatting silently flattened.
  assert.equal(copied[0], 'A **DFA** cannot count.');
});

// ══════════════════════════════════════════════════════════════════
//  THE DOCK
// ══════════════════════════════════════════════════════════════════
//  The console is docked to the bottom because the machine is drawn on the
//  canvas behind it. That premise only pays off if the canvas is *usable*
//  while it is open — which is what these pin, along with the reading
//  behaviours a transcript that rebuilt itself on every event could not have.

test('the StateMate tab keeps the canvas live rather than blocking it', () => {
  const h = createHarness();
  // Whatever an earlier test left open: this asserts on the stack.
  h.context.ModalStack.slice().forEach(id => h.context.closeModal(id));
  h.context.document.body.classList.remove('modal-open');

  h.context.openStateMate();

  assert.equal(h.context.getActivePanelTab('rpanel'), 'statemate');
  assert.equal(h.context.ModalStack.includes('statemate-panel'), false,
    'a tabpanel never enters the modal stack');
  // A full-viewport overlay made the diagram a picture of itself: no clicking
  // a state, no panning, no running a word, and a click on it was a dismissal.
  assert.equal(h.context.anyModalOpen(), false, 'canvas shortcuts keep working');
  assert.equal(h.context.document.body.classList.contains('modal-open'), false,
    'and the page is not scroll-locked behind a panel that is not blocking');

  assert.equal(h.context.ModalRegistry['statemate-panel'], undefined,
    'and no modal registration shadows the native panel state');
});

test('the transcript is diffed, not rebuilt', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const log = h.getElement('sm-log');
  const firstTurn = log.children[0];
  const details = exactly(log, 'sm-diff')[0];
  assert.ok(details, 'the machine card offers its diff');
  details.open = false;                     // the reader collapses it

  // Anything happening in the console — a note, a stage event, a second turn —
  // used to clear the container and build every entry again, which collapsed
  // whatever was open under the reader and re-typeset every past reply.
  await enter(type(h, '/help'));

  assert.strictEqual(log.children[0], firstTurn, 'a settled turn keeps its node');
  assert.equal(details.open, false, 'so the diff the reader collapsed stays collapsed');
  assert.match(logText(h), /\/examples/, 'and the new entry is there all the same');
});

test('a reader who has scrolled up is not dragged back to the tail', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const log = h.getElement('sm-log');
  const jump = h.getElement('sm-jump');
  assert.equal(jump.hidden, true, 'nothing to jump to while the tail is in view');

  // Scrolled well away from the end — reading an earlier turn.
  log.scrollHeight = 2000;
  log.clientHeight = 300;
  log.scrollTop = 40;
  log.onscroll();
  assert.equal(jump.hidden, false, 'the way back is offered rather than forced');

  await enter(type(h, '/help'));
  assert.equal(log.scrollTop, 40, 'and the next entry leaves the reader where they are');

  jump.onclick();
  assert.equal(log.scrollTop, 2000, 'until they ask for the tail back');
  assert.equal(jump.hidden, true);
});

test('the send button is the stop button while a run is in flight', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();

  const sendBtn = h.getElement('sm-send');
  assert.equal(sendBtn.getAttribute('aria-label'), 'Send to StateMate');

  h.context.fetch = async () => {
    // Escape has always interrupted, but a keystroke named in a placeholder is
    // not a control. The button the reader just pressed is.
    assert.equal(sendBtn.classList.contains('is-stop'), true);
    assert.equal(sendBtn.disabled, false, 'live throughout — it just does the opposite thing');
    assert.equal(sendBtn.getAttribute('aria-label'), 'Stop StateMate');
    sendBtn.onclick();
    return anthropicReply(dfaSpec());
  };
  await enter(type(h, 'even number of a'));

  assert.match(logText(h), /Interrupted/);
  assert.equal(sendBtn.classList.contains('is-stop'), false, 'and then it is the send button again');
});

// ── stowing ──
//  StateMate is the right panel's second tab, not a dock over the canvas, so
//  putting it away is selecting the Inspector — and unlike the ✕ that used to
//  sit beside the minimize, that is not destructive. These pin the one exit,
//  the one thing the tab can still say, and the run that survives it.

const stowed = h => h.context.getActivePanelTab('rpanel') !== 'statemate';
const badge = h => {
  const b = h.getElement('sm-tab-badge');
  return b.hidden ? '' : String(b.textContent || '');
};
const tabActive = (h, name) =>
  h.getElement(`panel-tab-${name}`).classList.contains('active');

test('stowing hands the panel to the Inspector without ending the session', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  assert.equal(tabActive(h, 'statemate'), true, 'the tab says which panel is showing');
  assert.equal(tabActive(h, 'inspector'), false);

  h.context.showPanelTab('inspector');
  assert.equal(stowed(h), true);
  assert.equal(tabActive(h, 'inspector'), true);

  h.context.showPanelTab('statemate');
  assert.equal(stowed(h), false);
  // Nothing about the session lives in the DOM, so the transcript comes back
  // as it was rather than being rebuilt from the thread.
  assert.match(logText(h), /even number of a/);
  assert.match(logText(h), /Apply/, 'including the proposal still waiting on the reader');
});

test('coming back to the tab resumes; opening StateMate goes to the newest line', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  // There has to be a turn to scroll away from: on an empty transcript
  // renderLog() takes the welcome branch and force-pins, so the premise below
  // would not be true and the assertions would pass or fail for the wrong
  // reason.
  await enter(type(h, 'even number of a'));

  const log = h.getElement('sm-log');
  log.scrollHeight = 900;
  log.clientHeight = 300;
  log.scrollTop = 40;
  log.onscroll();                       // the reader scrolled up to re-read a turn

  h.context.showPanelTab('inspector');
  h.context.showPanelTab('statemate');
  assert.equal(log.scrollTop, 40,
    'stepping over to the Inspector and back is one session, so the place is kept');

  h.context.showPanelTab('inspector');
  h.context.openStateMate();
  assert.equal(log.scrollTop, 900,
    'but the sparkle button, ⌘K and "ask about this selection" are openings');
});

test('a render that force-pins does not overrule a resumption', () => {
  // renderLog() force-pins on an empty transcript, which is right — there is
  // no place to keep — but openStateMate used to read `Session.pinned` back
  // *after* rendering, so any force-pin during a render silently cancelled the
  // caller's resume. Harmless here; a genuine bug on the first other path that
  // force-pins, where a reader mid-transcript would be slammed to the tail.
  const h = createHarness();
  h.context.openStateMate();
  const log = h.getElement('sm-log');
  log.scrollHeight = 900;
  log.clientHeight = 300;
  log.scrollTop = 40;
  log.onscroll();

  h.context.stowStateMate();
  h.context.openStateMate({ resume: true });
  assert.equal(log.scrollTop, 40,
    'the resume decision is made before the render, not read back off it');
});

test('the tab strip is wired at creation, so it adds no name to bridge.js', () => {
  const h = createHarness();
  h.context.initPanelTabs();
  h.context.openStateMate();

  h.getElement('panel-tab-inspector')._listeners.click();
  assert.equal(stowed(h), true, 'clicking the Inspector tab stows StateMate');
  h.getElement('panel-tab-statemate')._listeners.click();
  assert.equal(stowed(h), false);
});

test('selecting the Inspector does not pin a panel the reader left unpinned', () => {
  const h = createHarness();
  h.context.initPanelTabs();
  h.context.openStateMate();
  const panel = h.getElement('rpanel');
  panel.classList.add('unpinned');

  h.getElement('panel-tab-inspector')._listeners.click();
  assert.equal(panel.classList.contains('unpinned'), true,
    'the strip is inside the panel, so reaching it means the panel is already readable');
  h.getElement('panel-tab-statemate')._listeners.click();
  assert.equal(panel.classList.contains('unpinned'), false,
    'while a deliberate open does take the width it needs');
});

test('opening StateMate also opens the collapsed mobile right-panel sheet', () => {
  const h = createHarness();
  const oldMatchMedia = h.context.matchMedia;
  h.context.matchMedia = query => ({
    matches: query.includes('max-width: 900px'),
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  });
  const panel = h.getElement('rpanel');
  panel.dataset.mobileCollapsed = '1';

  try {
    h.context.openStateMate();
    assert.equal(panel.dataset.mobileCollapsed, '0');
    assert.equal(stowed(h), false);
  } finally {
    h.context.matchMedia = oldMatchMedia;
  }
});

test('the right-panel tabs expose one selected, keyboard-focusable panel', () => {
  const h = createHarness();
  h.context.initPanelTabs();
  h.context.openStateMate();

  assert.equal(h.getElement('rpanel').dataset.activePanel, 'statemate');
  assert.equal(h.getElement('panel-tab-statemate').getAttribute('tabindex'), '0');
  assert.equal(h.getElement('panel-tab-inspector').getAttribute('tabindex'), '-1');
  assert.equal(h.getElement('statemate-panel').getAttribute('aria-hidden'), 'false');
  assert.equal(h.getElement('statemate-panel').hidden, false);
  assert.equal(h.getElement('rpanel-content').getAttribute('aria-hidden'), 'true');

  let prevented = false;
  h.getElement('panel-tab-statemate')._listeners.keydown({
    key: 'ArrowLeft', preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(stowed(h), true);
  assert.equal(h.getElement('rpanel').dataset.activePanel, 'inspector');
});

// ── Escape, and who owns it ──
//  StateMate's Escape ladder is a document listener in the capture phase, since
//  a panel is not on ModalStack. That makes its scope load-bearing: being the
//  selected tab is a sticky state, so a listener guarded only by "StateMate is
//  showing" holds Escape app-wide for as long as the tab stays up — and a
//  capture-phase stopPropagation on document pre-empts the canvas shortcuts, the
//  symbol-suggest popover and the machine-card editor before any of them sees
//  the key. These two go through the real listener rather than calling
//  handleStateMateEscape, because the scope is the part that can break.

/**
 * A key event's target with just enough element to be scoped.
 *
 * `closest` is how both StateMate and the canvas shortcuts decide whether a
 * keystroke is theirs, so the selectors this claims to be inside are the whole
 * of what the fake needs.
 */
const keyTarget = (...inside) => ({
  tagName: 'DIV',
  closest: sel => (inside.includes(sel) ? { id: sel } : null)
});

test('Escape outside the panel belongs to the canvas, even with StateMate showing', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.openStateMate();
  assert.equal(stowed(h), false, 'the tab is up — which is not a claim on the keyboard');

  App.selectedStates = new Set(['s1']);
  App.transFrom = 's1';
  const event = h.dispatchDocumentEvent('keydown', { key: 'Escape', target: keyTarget() });

  assert.equal(App.selectedStates.size, 0, 'the canvas shortcut still sees Escape');
  assert.equal(App.transFrom, null, 'so a half-drawn transition is still cancelled');
  assert.equal(stowed(h), false, 'and the panel is not stowed by a key pressed elsewhere');
  assert.equal(event.propagationStopped, false,
    'nothing was swallowed on the way, so the popovers and the card keep theirs too');
});

test('Escape inside the panel walks StateMate’s ladder, then stows it', () => {
  const h = createHarness();
  h.context.openStateMate();
  const target = keyTarget('.rpanel');

  h.getElement('sm-head-menu-btn')._listeners.click({ stopPropagation() { } });
  const first = h.dispatchDocumentEvent('keydown', { key: 'Escape', target });
  assert.equal(h.getElement('sm-head-menu').hidden, true, 'the options menu is the first rung');
  assert.equal(stowed(h), false, 'dismissing it does not also put the panel away');
  assert.equal(first.defaultPrevented, true);

  const second = h.dispatchDocumentEvent('keydown', { key: 'Escape', target });
  assert.equal(stowed(h), true, 'and with the ladder spent, the panel itself is the last rung');
  assert.equal(second.propagationStopped, true, 'which the canvas must not also act on');

  const third = h.dispatchDocumentEvent('keydown', { key: 'Escape', target });
  assert.equal(third.propagationStopped, false, 'a stowed panel claims nothing');
});

test('StateMate keeps secondary header actions in one dismissible menu', () => {
  const h = createHarness();
  h.context.openStateMate();

  const trigger = h.getElement('sm-head-menu-btn');
  const menu = h.getElement('sm-head-menu');
  const clear = h.getElement('sm-head-clear');
  assert.equal(clear.hidden, true, 'an empty conversation has nothing destructive to offer');

  let stopped = false;
  trigger._listeners.click({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true, 'the opening click does not immediately reach outside-click dismissal');
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  const consumed = h.context.handleStateMateEscape();
  assert.equal(consumed, true, 'the menu is the first rung of StateMate’s Escape ladder');
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(stowed(h), false, 'dismissing options does not switch panels');

  let focusedSettings = false;
  h.getElement('sm-head-settings').focus = () => { focusedSettings = true; };
  let prevented = false;
  trigger._listeners.keydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(menu.hidden, false, 'an arrow opens the menu without requiring a pointer');
  assert.equal(focusedSettings, true, 'keyboard entry lands on the first available action');
  menu._listeners.keydown({ key: 'Tab', target: h.getElement('sm-head-settings') });
  assert.equal(menu.hidden, true, 'Tab continues through the header instead of trapping focus');
  h.context.stowStateMate();
});

test('the StateMate options menu opens AI settings and dismisses itself', () => {
  const h = createHarness();
  h.context.openStateMate();

  h.getElement('sm-head-menu-btn')._listeners.click({ stopPropagation() { } });
  h.getElement('sm-head-settings')._listeners.click();

  assert.equal(h.context.isModalOpen('settings-modal'), true);
  assert.ok(h.getElement('tab-ai').classList.contains('active'),
    'the local Settings action lands on StateMate’s own settings');
  assert.equal(h.getElement('sm-head-menu').hidden, true);
  // The panel stays selected. A dialog covers the whole app, so there is
  // nothing for it to be in the way of — and stowing moved the focus to the
  // Inspector tab a moment before showOverlay recorded where to put it back,
  // so closing Settings landed on the Inspector with StateMate put away.
  assert.equal(stowed(h), false, 'a dialog does not put the panel away');
  h.context.closeModal('settings-modal');
  assert.equal(stowed(h), false, 'and closing it comes back to what asked for it');
});

test('Clear conversation appears only with a thread and clears from the menu', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const clear = h.getElement('sm-head-clear');
  assert.equal(h.context.getThread().length, 2);
  assert.equal(clear.hidden, false);

  h.getElement('sm-head-menu-btn')._listeners.click({ stopPropagation() { } });
  clear._listeners.click();

  assert.equal(h.context.getThread().length, 0);
  assert.equal(clear.hidden, true, 'the destructive row disappears with its target');
  assert.equal(h.getElement('sm-head-menu').hidden, true);
  assert.match(logText(h), /Type \/ for commands/, 'the empty StateMate welcome returns');
  h.context.stowStateMate();
});

test('stowing returns focus to the Inspector tab, not the distant opener', () => {
  const h = createHarness();
  h.context.openStateMate();
  let focused = false;
  h.getElement('panel-tab-inspector').focus = () => { focused = true; };
  h.context.stowStateMate();
  assert.equal(focused, true);
});

test('leaving does not interrupt a run — only the stop control does', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();

  let attempts = 0;
  h.context.fetch = async () => {
    // The ✕ this replaced cancelled the request, which is what made minimize
    // a separate control. With one non-destructive exit there is nothing to
    // put beside: a tab switch keeps the run. Once — the tab is a toggle.
    if (++attempts === 1) {
      h.context.showPanelTab('inspector');
      assert.equal(h.context.isStateMateRunning(), true, 'the request is untouched');
      assert.equal(badge(h), '…', 'and the tab is where it is reported');
    }
    return anthropicReply(dfaSpec());
  };
  await enter(type(h, 'even number of a'));

  assert.equal(stowed(h), true, 'a finished turn does not throw the panel back open');
  assert.equal(badge(h), '1', 'it is counted where the reader can see it');

  // Opening is never a no-op: the sparkle button, ⌘K and "ask about this
  // selection" all land here, and a tab that stayed hidden would read as a
  // broken button.
  h.context.openStateMate();
  assert.equal(stowed(h), false);
  assert.equal(badge(h), '', 'and the count is spent');
});

test('Escape stows, and the ladder is one rung shorter than it was', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const esc = () => h.context.handleStateMateEscape();

  // Escape used to have a rung of its own here — minimize, *then* close —
  // because leaving was destructive and putting the panel away had to be
  // offered ahead of it. Leaving is a tab now, so the key falls straight
  // through to the panel controller, which stows the panel.
  assert.equal(esc(), false, 'not consumed: there is nothing left to dismiss first');

  h.context.stowStateMate();
  assert.equal(stowed(h), true);
  assert.match(logText(h), /Apply/, 'and the proposal is still waiting when it comes back');

  h.context.openStateMate();
  assert.match(logText(h), /even number of a/);
});

test('⌘K in the composer is the other half of the shortcut that opened it', () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  const input = h.getElement('sm-input');
  input.onkeydown({ key: 'k', metaKey: true, preventDefault() { } });
  assert.equal(stowed(h), true);

  h.context.openStateMate();
  assert.equal(stowed(h), false);
});

test('↑ and ↓ walk the prompt history, not one step of it', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'first prompt'));
  await enter(type(h, 'second prompt'));

  const input = h.getElement('sm-input');
  const up = () => input.onkeydown({ key: 'ArrowUp', preventDefault() { } });
  const down = () => input.onkeydown({ key: 'ArrowDown', preventDefault() { } });

  up();
  assert.equal(input.value, 'second prompt');
  // The gate used to be "the line is empty", which the first recall broke — so
  // the history was exactly one prompt deep and had no way forward.
  up();
  assert.equal(input.value, 'first prompt');
  up();
  assert.equal(input.value, 'first prompt', 'and it stops at the oldest');
  down();
  assert.equal(input.value, 'second prompt');
  down();
  assert.equal(input.value, '', 'stepping past the newest comes back to an empty line');
});

test('Escape dismisses the completion menu without deleting the line', () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  h.context.openStateMate();

  const input = type(h, '/exa');
  assert.equal(h.getElement('sm-menu').hidden, false);

  const consumed = h.context.handleStateMateEscape();
  assert.equal(consumed, true, 'the console gets first refusal, so the dialog stays open');
  assert.equal(h.getElement('sm-menu').hidden, true);
  assert.equal(input.value, '/exa', 'and the command being written survives');

  // The dismissal lasts exactly as long as the line does not change.
  type(h, '/exam');
  assert.equal(h.getElement('sm-menu').hidden, false);
});

test('clicking Send while rewriting replaces the turn, the way ⏎ does', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6, maxRetries: 0
  });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const edit = tool(h.getElement('sm-log'), 'Edit and resend');
  assert.ok(edit, 'a sent turn can be rewritten');
  edit.onclick();
  // ⏎ means something else while this is up, so it is on screen and not only
  // in a placeholder the first character typed covers up.
  assert.match(deepText(h.getElement('sm-editing')), /Rewriting a turn/);

  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec({ title: 'Rewritten' })));
  const input = h.getElement('sm-input');
  input.value = 'odd number of a';
  input.oninput();
  // The button used to carry its own copy of this, minus the branch — so the
  // bar above promised a replacement and the click appended a turn.
  await h.getElement('sm-send').onclick();

  assert.equal(h.context.getThread().length, 2, 'one exchange, not two');
  const text = logText(h);
  assert.match(text, /Rewritten/);
  assert.ok(!/Even number of a's/.test(text), 'the rewritten turn is replaced, not followed');
  assert.equal(deepText(h.getElement('sm-editing')), '', 'and the rewrite state is spent');
});

test('a selection made behind the console is offered to the next prompt', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k' });
  App.states = [{ id: 's1', name: 'even', x: 0, y: 0 }, { id: 's2', name: 'odd', x: 90, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's2', symbol: 'a' }];
  App.startId = 's1';
  h.context.openStateMate();

  const offer = () => h.getElement('sm-status').children.find(c => /selected/.test(deepText(c)));
  assert.equal(offer(), undefined, 'nothing selected, nothing offered');

  // Selecting a state with the console open is only possible because the dock
  // does not block the canvas — and it is the question people actually have in
  // front of a diagram.
  App.selectedStates = new Set(['s2']);
  h.context.emit(h.context.Change.CANVAS);

  const chip = offer();
  assert.ok(chip, 'the status line hears about it');
  chip.onclick();
  assert.deepEqual(findAll(h.getElement('sm-context'), 'sm-ctxchip-name').map(deepText), ['odd']);
});

test('the status line says how much of the conversation rides with the prompt', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', threadDepth: 6, maxRetries: 0
  });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => anthropicReply(dfaSpec()));
  await enter(type(h, 'even number of a'));

  const chip = () => h.getElement('sm-status').children.find(c => /recalled|one-shot/.test(deepText(c)));
  assert.match(deepText(chip()), /2 recalled/, 'the prompt and its answer');

  // threadDepth 0 is the old one-shot behaviour. It changes what the model is
  // answering, which makes it worth a word rather than a settings tab.
  h.context.saveStateMateSettings({ threadDepth: 0 });
  h.context.openStateMate();
  assert.match(deepText(chip()), /one-shot/);
});

test('a reply carries the same instrumentation the machine card does', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5', maxRetries: 0
  });
  h.context.openStateMate();
  h.context.fetch = fakeFetch(() => replyTurn('A DFA cannot count unboundedly.'));
  await enter(type(h, 'can a DFA count?'));

  // The strip lived only on the machine path, which made a reply look free —
  // it is a request to the same provider at the same price.
  const meta = findAll(h.getElement('sm-log'), 'sm-meta')[0];
  assert.ok(meta, 'the reply says what it cost');
  const text = deepText(meta);
  assert.match(text, /claude-sonnet-5/);
  assert.match(text, /\d+ in \/ \d+ out/);
});

// A streamed response, the way a provider actually delivers one: the headers
// resolve first, the frames arrive after. The non-streamed helpers above
// cannot exercise the timing, because they have no body to read.
function streamedAnthropicReply(text, { frames = 3 } = {}) {
  const parts = [];
  const size = Math.ceil(text.length / frames);
  for (let i = 0; i < text.length; i += size) {
    parts.push(`data: ${JSON.stringify({
      type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(i, i + size) }
    })}\n\n`);
  }
  parts.push(`data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 120 } })}\n\n`);

  let at = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => (at >= parts.length
          ? { done: true, value: undefined }
          : { done: false, value: new TextEncoder().encode(parts[at++]) })
      })
    }
  };
}

test('time to first token is measured from the request, not from its headers', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'k', maxRetries: 0 });

  // The wait that actually happened: the provider thought for a while before
  // sending anything at all.
  h.context.fetch = async () => {
    await new Promise(r => setTimeout(r, 80));
    return streamedAnthropicReply(JSON.stringify(dfaSpec()));
  };

  const result = await h.context.runStateMate({ prompt: 'even number of a' });
  const rate = h.context.throughput(result);

  assert.equal(result.timing.streamed, true, 'the streamed path was the one taken');
  // The clock used to start inside readStream — after `fetch` had resolved —
  // so this read as 0.0s however long the model took to say anything.
  assert.ok(rate.ttftMs >= 70,
    `time to first token came back as ${rate.ttftMs}ms after an 80ms wait`);
  assert.ok(rate.totalMs >= rate.ttftMs, 'and the total covers the wait too');
});

// ══════════════════════════════════════════════════════════════════
//  MODEL DISCOVERY AND IMAGE ATTACHMENTS
// ══════════════════════════════════════════════════════════════════
//  Two features, one property between them: the model listing is what decides
//  whether an image may be attached at all, so the reader of the list and the
//  capability check are pinned together.

test('the three /models dialects read into one shape', () => {
  const h = createHarness();
  const { readModelList } = h.context;

  // OpenAI and every compatible server: {data: [{id}]}.
  const openai = readModelList({ data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }] }, 'openai');
  assert.deepEqual(openai.map(m => m.id), ['gpt-4o']);   // the embedding model is not a chat model

  // Anthropic adds a display name.
  const anthropic = readModelList(
    { data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }] }, 'anthropic');
  assert.equal(anthropic[0].label, 'Claude Sonnet 5');

  // Google prefixes every name with `models/` and lists what each one can do.
  const google = readModelList({
    models: [
      { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-bison', supportedGenerationMethods: ['generateText'] }
    ]
  }, 'GoogleAiStudio');
  assert.deepEqual(google.map(m => m.id), ['gemini-3.7-flash']);

  // Cohere's, keyed by `name` rather than `id`.
  const cohere = readModelList({ models: [{ name: 'command-r-plus' }] }, 'cohere');
  assert.deepEqual(cohere.map(m => m.id), ['command-r-plus']);
});

test('a listing that states its modalities is believed over the name', () => {
  const h = createHarness();
  const rows = h.context.readModelList({
    data: [
      // A name the hint list would never guess, said outright by the provider.
      { id: 'acme/seer-1', architecture: { input_modalities: ['text', 'image'] } },
      // And the reverse: a name that looks like vision, listed as text only.
      { id: 'acme/gpt-4o-mini-text', architecture: { input_modalities: ['text'] } }
    ]
  }, 'openrouter_ai');
  assert.equal(rows.find(m => m.id === 'acme/seer-1').vision, true);
  assert.equal(rows.find(m => m.id === 'acme/gpt-4o-mini-text').vision, false);
});

test('supportsImages answers from the name when nothing has been listed', () => {
  const h = createHarness();
  const { supportsImages } = h.context;
  const at = (provider, model) => ({ provider, model, apiKey: 'k', enabled: true, baseUrl: '' });

  assert.equal(supportsImages('gpt-4o', at('openai')), true);
  assert.equal(supportsImages('claude-sonnet-5', at('anthropic')), true);
  assert.equal(supportsImages('Qwen2-VL-7B', at('compatible')), true);
  assert.equal(supportsImages('mistral-large-latest', at('mistralai')), false);
  assert.equal(supportsImages('', at('openai')), false);
});

test('the name table reads a family and its exceptions differently', () => {
  const h = createHarness();
  const { visionFromName } = h.context;

  // Each pair is one family split by a rule that a single alternation cannot
  // express — which is why these were wrong in both directions before. The
  // left column reads images; the right column is the sibling that does not.
  const pairs = [
    ['o3', 'o3-mini'],
    ['o1', 'o1-mini'],
    ['llama-3.2-90b', 'llama-3.2-1b'],
    ['gemma-3-27b-it', 'gemma-3-1b-it'],
    ['gpt-4-turbo', 'gpt-4-0613'],
    ['grok-4', 'grok-3']
  ];
  for (const [sees, blind] of pairs) {
    assert.equal(visionFromName(sees), true, `${sees} reads images`);
    assert.equal(visionFromName(blind), false, `${blind} does not`);
  }

  // A name nobody has a rule for is not "text only" — it is unanswered, and
  // the difference is what lets a local server be trusted about its own
  // models while a hosted one is not.
  assert.equal(visionFromName('acme-mystery-7b'), undefined);
  assert.equal(visionFromName(''), undefined);
});

test('a model nobody could answer for is trusted locally and not remotely', () => {
  const h = createHarness();
  const { supportsImages, readModelList } = h.context;
  const at = provider => ({ provider, model: '', apiKey: 'k', enabled: true, baseUrl: '' });

  // Being *in* the listing is not itself an answer: a bare list of names says
  // nothing about modalities, and reading that silence as a listed "no" is
  // what made a local server contradict the rule below for its own models.
  const rows = readModelList({ data: [{ id: 'acme-mystery-7b' }] }, 'compatible');
  assert.equal(rows[0].vision, undefined, 'the row says "nobody said", not "no"');

  assert.equal(supportsImages('acme-mystery-7b', at('compatible')), true,
    'a local endpoint\'s owner knows what they are running');
  assert.equal(supportsImages('acme-mystery-7b', at('openai')), false,
    'a hosted one would just fail the request with an error about a hidden field');
});

test('a listing that states its modalities is believed in every dialect it says it in', () => {
  const h = createHarness();
  const { readModelList } = h.context;
  const visionOf = (json, provider, id) =>
    readModelList(json, provider).find(m => m.id === id)?.vision;

  // OpenRouter's older single string, which was read as no statement at all.
  assert.equal(visionOf({ data: [{ id: 'acme/one', architecture: { modality: 'text+image->text' } }] },
    'openrouter_ai', 'acme/one'), true);
  // The boolean some local gateways publish, and the capability array others do.
  assert.equal(visionOf({ data: [{ id: 'acme/two', vision: true }] }, 'compatible', 'acme/two'), true);
  assert.equal(visionOf({ data: [{ id: 'acme/three', capabilities: ['completion', 'vision'] }] },
    'compatible', 'acme/three'), true);

  // And the point of all of it: a statement outranks the name, both ways.
  assert.equal(visionOf({ data: [{ id: 'gpt-4o-text-only', input_modalities: ['text'] }] },
    'compatible', 'gpt-4o-text-only'), false);
  // Cohere's shape reaches the same reader rather than a second copy of it.
  assert.equal(visionOf({ models: [{ name: 'command-a-vision-07-2025' }] },
    'cohere', 'command-a-vision-07-2025'), true);
});

test('the model menu is as wide as its row, not as wide as the 210px field', () => {
  // A source assertion because the failure is invisible in every other way:
  // the menu renders, the rows are right, and the names are simply cut off.
  // The whole fix is which element is the containing block, so that is what
  // is pinned — re-adding `position: relative` to the field would silently
  // clamp the menu back to the width of one settings control.
  const css = readFileSync(new URL('../css/modals.css', import.meta.url), 'utf8');
  const rule = name => {
    const at = css.indexOf(`\n${name} {`);
    assert.notEqual(at, -1, `css/modals.css declares ${name}`);
    return css.slice(at, css.indexOf('}', at));
  };

  assert.doesNotMatch(rule('.sm-model-field'), /position\s*:/,
    'the 210px field must not be the containing block');
  assert.match(rule('.modal-row:has(> .sm-model-field)'), /position\s*:\s*relative/,
    'the row is, so the menu spans the label as well as the field');
  // Left and right both anchored is what makes the row's width the menu's.
  const menu = rule('.sm-model-menu');
  assert.match(menu, /left\s*:\s*0/);
  assert.match(menu, /right\s*:\s*0/);
});

test('an image never reaches a model that cannot read one', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, apiKey: 'k', provider: 'openai',
    // No vision in the name and nothing listed, so the picture is dropped.
    model: 'mistral-large-latest', verify: false, threadDepth: 0
  });

  let sent = null;
  h.context.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: 'reply', text: 'ok' }) } }] }),
      text: async () => ''
    };
  };

  const result = await h.context.runStateMate({
    prompt: 'what is this?',
    images: [{ mime: 'image/png', data: 'AAAA' }]
  });

  assert.equal(result.imagesDropped, 1);
  // The live turn is still a plain string — no content parts anywhere.
  assert.ok(sent.messages.every(m => typeof m.content === 'string'));
  assert.ok(!JSON.stringify(sent).includes('AAAA'));
  // And it is reported rather than swallowed.
  assert.ok(h.context.resultNotes(result).some(n => n.rule === 'no-vision'));
});

test('an image reaches a vision model in that provider\'s own dialect', async () => {
  const h = createHarness();
  const call = async provider => {
    h.context.saveStateMateSettings({
      enabled: true, apiKey: 'k', provider,
      model: provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o',
      verify: false, threadDepth: 0
    });
    let sent = null;
    h.context.fetch = async (url, init) => {
      sent = JSON.parse(init.body);
      const answer = JSON.stringify({ kind: 'reply', text: 'ok' });
      return {
        ok: true,
        json: async () => (provider === 'anthropic'
          ? { content: [{ type: 'text', text: answer }] }
          : { choices: [{ message: { content: answer } }] }),
        text: async () => ''
      };
    };
    await h.context.runStateMate({
      prompt: 'read this',
      images: [{ mime: 'image/png', data: 'AAAA' }]
    });
    return sent.messages[sent.messages.length - 1].content;
  };

  const anthropic = await call('anthropic');
  assert.deepEqual(anthropic[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  assert.equal(anthropic[1].type, 'text');

  const openai = await call('openai');
  assert.deepEqual(openai[0], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  assert.equal(openai[1].type, 'text');
});

test('a turn with no image stays a plain string', async () => {
  const h = createHarness();
  h.context.saveStateMateSettings({
    enabled: true, apiKey: 'k', provider: 'compatible', model: 'local', verify: false, threadDepth: 0
  });
  let sent = null;
  h.context.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: 'reply', text: 'ok' }) } }] }),
      text: async () => ''
    };
  };
  await h.context.runStateMate({ prompt: 'hello' });
  // Enough compatible servers only accept the string form that sending an
  // array for a turn with nothing but text in it would break setups that work.
  assert.ok(sent.messages.every(m => typeof m.content === 'string'));
});
