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

  assert.equal(h.context.isModalOpen('statemate-modal'), true,
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
    assert.equal(h.context.isModalOpen('statemate-modal'), false,
      'and the console gets out of the way');
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

  assert.equal(h.context.isModalOpen('statemate-modal'), true);
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
  assert.match(deepText(card), /Even number of a's/);

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
  assert.match(deepText(actions), /Undo/);
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

  const chip = () => h.getElement('sm-status').children
    .find(c => /^(ask|propose|auto)$/.test(deepText(c)));
  assert.equal(deepText(chip()), 'propose', 'the safe default is the default');

  chip().onclick();
  assert.equal(deepText(chip()), 'auto');
  chip().onclick();
  assert.equal(deepText(chip()), 'ask');
  assert.match(logText(h), /Read-only/, 'and the change says what it means');

  // Authority is a standing decision, so reopening the dialog must not quietly
  // reset it to the default.
  h.context.closeModal('statemate-modal');
  h.context.openStateMate();
  assert.equal(deepText(chip()), 'ask');
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
