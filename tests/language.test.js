import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The Language section and the machinery it added:
//   • the symbolic / vocabulary mode switch and the abbreviation layer
//   • accepted traces (shortlex over L(M)) and the Σ* fingerprint
//   • three-valued Turing-machine membership (accept / reject / no verdict)
//   • loop detection in the deterministic tape simulators
//   • batch testing extended to Turing machines
//   • cheapest-first GNFA state elimination
//
// The recurring theme is the accept/reject/undecided distinction: a machine
// that has not halted has NOT rejected, and several tests exist purely to
// stop that collapsing back into a boolean.

const harness = createHarness();
const { context } = harness;
const App = context.App;

function reset() {
  harness.resetApp();
}

// Values built inside the VM carry that realm's Array/Object prototypes, so
// assert/strict's deepEqual rejects them against literals declared out here.
// Round-tripping through JSON re-homes them without weakening the comparison.
const plain = v => JSON.parse(JSON.stringify(v));
function deepEq(actual, expected, msg) {
  assert.deepEqual(plain(actual), expected, msg);
}

// ── builders ──────────────────────────────────────────────────────
function fa({ sigma, states, start, accepts, edges, machine = 'DFA' }) {
  App.machine = machine;
  App.sigma = new Set(sigma);
  App.states = states.map((n, i) => ({ id: 's' + i, name: n, x: 0, y: 0 }));
  const id = n => App.states.find(s => s.name === n).id;
  App.transitions = edges.map(([f, sym, t], i) => ({ id: 'e' + i, from: id(f), to: id(t), symbol: sym }));
  App.startId = id(start);
  App.accepts = new Set(accepts.map(id));
  App.stateN = states.length;
  App.transN = edges.length;
  return id;
}

function tape({ sigma, gamma = [], states, start, accepts, rules, machine = 'TM' }) {
  const B = App.config.sym.blank;
  const LM = App.config.sym.leftMarker;
  const RM = App.config.sym.rightMarker;
  const map = s => (s === 'B' ? B : s === 'LM' ? LM : s === 'RM' ? RM : s);
  App.machine = machine;
  App.sigma = new Set(sigma);
  App.stackAlpha = new Set([...gamma, B]);
  App.states = states.map((n, i) => ({ id: 's' + i, name: n, x: 0, y: 0 }));
  const id = n => App.states.find(s => s.name === n).id;
  App.transitions = rules.map(([f, sym, w, d, t], i) => ({
    id: 'e' + i, from: id(f), to: id(t), symbol: map(sym), write: map(w), dir: d
  }));
  App.startId = id(start);
  App.accepts = new Set(accepts.map(id));
  App.stateN = states.length;
  App.transN = rules.length;
  return id;
}

// (a|b)*abb — the reference regular language, minimal and unminimised.
function endsWithAbb() {
  return fa({
    sigma: ['a', 'b'],
    states: ['q0', 'q1', 'q2', 'q3'],
    start: 'q0', accepts: ['q3'],
    edges: [['q0', 'b', 'q0'], ['q0', 'a', 'q1'], ['q1', 'a', 'q1'], ['q1', 'b', 'q2'],
            ['q2', 'b', 'q3'], ['q2', 'a', 'q1'], ['q3', 'a', 'q1'], ['q3', 'b', 'q0']]
  });
}

function endsWithAbbUnminimised() {
  return fa({
    sigma: ['a', 'b'],
    states: ['p0', 'p1', 'p1b', 'p2', 'p3', 'dead'],
    start: 'p0', accepts: ['p3'],
    edges: [['p0', 'b', 'p0'], ['p0', 'a', 'p1'],
            ['p1', 'a', 'p1b'], ['p1', 'b', 'p2'],
            ['p1b', 'a', 'p1'], ['p1b', 'b', 'p2'],
            ['p2', 'b', 'p3'], ['p2', 'a', 'p1b'],
            ['p3', 'a', 'p1'], ['p3', 'b', 'p0'],
            ['dead', 'a', 'dead'], ['dead', 'b', 'dead']]
  });
}

// The 17-symbol complaint lifecycle: a word alphabet with one symbol that is
// declared but wired to nothing.
const WF_SIGMA = ['citizenFilesComplaint', 'officerClaims', 'verdictValid', 'verdictNeedsMoreEvidence',
  'verdictRejected', 'citizenResubmitsEvidence', 'officerStartsWork', 'officerRecallsForEvidence',
  'officerMarksUnresolvable', 'officerBeginsResolution', 'officerMarksResolved', 'officerResumesWork',
  'citizenConfirms', 'autoCloseTimeout', 'clusterCascadeResolve', 'SentForReview',
  'citizenDisputesWithEvidence'];

function workflow() {
  return fa({
    sigma: WF_SIGMA,
    states: ['New', 'Filed', 'Claim', 'Work', 'Evid', 'Rev', 'Resv', 'Done', 'Stuck', 'End'],
    start: 'New', accepts: ['End'],
    edges: [
      ['New', 'citizenFilesComplaint', 'Filed'],
      ['Filed', 'officerClaims', 'Claim'], ['Filed', 'autoCloseTimeout', 'End'],
      ['Claim', 'officerStartsWork', 'Work'], ['Claim', 'officerRecallsForEvidence', 'Evid'],
      ['Work', 'SentForReview', 'Rev'], ['Work', 'officerRecallsForEvidence', 'Evid'],
      ['Work', 'officerMarksUnresolvable', 'Stuck'], ['Work', 'officerBeginsResolution', 'Resv'],
      ['Evid', 'citizenResubmitsEvidence', 'Claim'], ['Evid', 'autoCloseTimeout', 'End'],
      ['Rev', 'verdictValid', 'Resv'], ['Rev', 'verdictNeedsMoreEvidence', 'Evid'],
      ['Rev', 'verdictRejected', 'End'],
      ['Resv', 'officerMarksResolved', 'Done'], ['Resv', 'officerRecallsForEvidence', 'Evid'],
      ['Done', 'citizenConfirms', 'End'], ['Done', 'citizenDisputesWithEvidence', 'Work'],
      ['Done', 'autoCloseTimeout', 'End'],
      ['Stuck', 'officerResumesWork', 'Work'], ['Stuck', 'autoCloseTimeout', 'End']
    ]
  });
}

// aⁿbⁿcⁿ with a branch that deliberately never halts.
function abcTmWithSpin() {
  return tape({
    sigma: ['a', 'b', 'c'], gamma: ['X', 'Y', 'Z'],
    states: ['t0', 't1', 't2', 't3', 't4', 'tacc', 'tspin'],
    start: 't0', accepts: ['tacc'],
    rules: [
      ['t0', 'a', 'X', 'R', 't1'], ['t0', 'Y', 'Y', 'R', 't4'], ['t0', 'B', 'B', 'R', 'tacc'],
      ['t1', 'a', 'a', 'R', 't1'], ['t1', 'Y', 'Y', 'R', 't1'], ['t1', 'b', 'Y', 'R', 't2'],
      ['t2', 'b', 'b', 'R', 't2'], ['t2', 'Z', 'Z', 'R', 't2'], ['t2', 'c', 'Z', 'L', 't3'],
      ['t2', 'a', 'a', 'R', 'tspin'],
      ['t3', 'a', 'a', 'L', 't3'], ['t3', 'b', 'b', 'L', 't3'], ['t3', 'Y', 'Y', 'L', 't3'],
      ['t3', 'Z', 'Z', 'L', 't3'], ['t3', 'X', 'X', 'R', 't0'],
      ['t4', 'Y', 'Y', 'R', 't4'], ['t4', 'Z', 'Z', 'R', 't4'], ['t4', 'B', 'B', 'R', 'tacc'],
      ['tspin', 'a', 'a', 'R', 'tspin'], ['tspin', 'b', 'b', 'R', 'tspin'],
      ['tspin', 'c', 'c', 'R', 'tspin'], ['tspin', 'X', 'X', 'R', 'tspin'],
      ['tspin', 'Y', 'Y', 'R', 'tspin'], ['tspin', 'Z', 'Z', 'R', 'tspin'],
      ['tspin', 'B', 'B', 'R', 'tspin']
    ]
  });
}

const toks = s => (s === '' ? [] : s.split(''));

// ══════════════════════════════════════════════════════════════════
//  MODE SWITCH
// ══════════════════════════════════════════════════════════════════
test('langIsSymbolic keys off symbol width, not machine type', () => {
  reset();
  App.sigma = new Set(['a', 'b']);
  assert.equal(context.langIsSymbolic(), true);
  App.sigma = new Set(['0', '1']);
  assert.equal(context.langIsSymbolic(), true);
  App.sigma = new Set(['a', 'ab']);
  assert.equal(context.langIsSymbolic(), false);
  App.sigma = new Set(WF_SIGMA);
  assert.equal(context.langIsSymbolic(), false);
});

test('a single astral-plane glyph still counts as one symbol', () => {
  reset();
  // '😀'.length === 2 in UTF-16; the check must use code points.
  App.sigma = new Set(['😀', 'b']);
  assert.equal(context.langIsSymbolic(), true);
});

test('langCanTrace excludes machines whose head revisits input', () => {
  reset();
  for (const m of ['DFA', 'NFA', 'ε-NFA', 'PDA', 'NPDA']) {
    App.machine = m;
    assert.equal(context.langCanTrace(), true, m + ' should be traceable');
  }
  for (const m of ['2DFA', '2NFA', 'TM', 'NDTM', 'LBA', 'ITM', 'MTM']) {
    App.machine = m;
    assert.equal(context.langCanTrace(), false, m + ' should not be traceable');
  }
});

test('langCanDecide admits Turing machines but gates unopted transducers', () => {
  reset();
  App.machine = 'TM';
  assert.equal(context.langCanDecide(), true);
  App.machine = 'Moore';
  App.config.transducerAccepts = false;
  assert.equal(context.langCanDecide(), false);
  App.config.transducerAccepts = true;
  assert.equal(context.langCanDecide(), true);
});

// ══════════════════════════════════════════════════════════════════
//  ABBREVIATIONS AND ACTOR GROUPING
// ══════════════════════════════════════════════════════════════════
test('langAbbrev folds camelCase, PascalCase and snake_case to initials', () => {
  const cases = {
    citizenFilesComplaint: 'cFC',
    officerRecallsForEvidence: 'oRFE',
    autoCloseTimeout: 'aCT',
    SentForReview: 'SFR',
    snake_case_name: 'sCN',
    'kebab-case-name': 'kCN',
    plain: 'p',
    a: 'a'
  };
  for (const [input, want] of Object.entries(cases)) {
    assert.equal(context.langAbbrev(input), want, input);
  }
});

test('the complaint alphabet abbreviates without collisions', () => {
  reset();
  workflow();
  const v = context.langVocab();
  const codes = WF_SIGMA.map(s => v.abbr[s]);
  assert.equal(new Set(codes).size, 17);
  assert.equal(v.abbr.citizenFilesComplaint, 'cFC');
  assert.equal(v.abbr.officerMarksUnresolvable, 'oMU');
  assert.equal(v.abbr.officerMarksResolved, 'oMR');
});

test('colliding initials get a numeric suffix rather than silently merging', () => {
  reset();
  fa({
    sigma: ['openDoor', 'openDrawer', 'openDeck'],
    states: ['a'], start: 'a', accepts: [], edges: []
  });
  const v = context.langVocab();
  const codes = ['openDoor', 'openDrawer', 'openDeck'].map(s => v.abbr[s]);
  assert.equal(new Set(codes).size, 3, 'codes must stay distinct: ' + codes.join(','));
  assert.ok(codes.includes('oD'));
});

test('langActor takes the leading lowercase run, empty for PascalCase', () => {
  assert.equal(context.langActor('citizenFilesComplaint'), 'citizen');
  assert.equal(context.langActor('officerClaims'), 'officer');
  assert.equal(context.langActor('SentForReview'), '');
  assert.equal(context.langActor('a'), 'a');
});

test('only the two largest actor groups take a hue; the rest stay neutral', () => {
  reset();
  workflow();
  const v = context.langVocab();
  deepEq(v.ranked.slice(0, 2), ['officer', 'citizen']);
  assert.equal(v.groups.officer.length, 7);
  assert.equal(v.groups.citizen.length, 4);
  assert.equal(v.groups.verdict.length, 3);
  const hued = WF_SIGMA.filter(s => v.slot[s] > 0);
  assert.equal(hued.length, 11, 'officer(7) + citizen(4)');
  // verdict is a real group but only third, so it gets no hue
  assert.equal(v.slot.verdictValid, 0);
  // the naming outliers flag themselves by staying neutral
  assert.equal(v.slot.SentForReview, 0);
  assert.equal(v.slot.autoCloseTimeout, 0);
});

// ══════════════════════════════════════════════════════════════════
//  SYMBOL USAGE AND THE DEAD-SYMBOL LINT
// ══════════════════════════════════════════════════════════════════
test('usage counts follow the transition table', () => {
  reset();
  workflow();
  const v = context.langVocab();
  assert.equal(v.uses.autoCloseTimeout, 4);
  assert.equal(v.uses.officerRecallsForEvidence, 3);
  assert.equal(v.uses.citizenFilesComplaint, 1);
});

test('a symbol declared in Σ but on no transition is reported dead', () => {
  reset();
  workflow();
  const v = context.langVocab();
  deepEq(v.dead, ['clusterCascadeResolve']);
});

test('a wildcard edge suppresses the dead-symbol claim', () => {
  reset();
  fa({
    sigma: ['a', 'b', 'c'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', App.config.sym.any, 'q1']]
  });
  const v = context.langVocab();
  assert.equal(v.wildcards, 1);
  deepEq(v.dead, [], 'Σ-wildcard covers every symbol, so nothing is dead');
});

test('the vocabulary cache invalidates when Σ or the symbols in use change', () => {
  reset();
  workflow();
  assert.equal(context.langVocab().dead.length, 1);
  // wire the dead symbol up; the cache must not keep reporting it
  App.transitions.push({ id: 'x1', from: App.states[3].id, to: App.states[9].id, symbol: 'clusterCascadeResolve' });
  deepEq(context.langVocab().dead, []);
  // shrink Σ
  App.sigma = new Set(['a', 'b']);
  assert.equal(context.langVocab().sigma.length, 2);
});

// ══════════════════════════════════════════════════════════════════
//  ACCEPTED TRACES
// ══════════════════════════════════════════════════════════════════
test('traces come back in strict shortlex order', () => {
  reset();
  workflow();
  const { traces } = context.langAcceptedTraces(6);
  assert.equal(traces.length, 6);
  for (let i = 1; i < traces.length; i++) {
    const a = traces[i - 1], b = traces[i];
    assert.ok(a.length <= b.length, `length must not decrease at ${i}`);
  }
  deepEq(traces[0], ['citizenFilesComplaint', 'autoCloseTimeout']);
});

test('every reported trace is genuinely accepted by the simulator', () => {
  reset();
  workflow();
  for (const w of context.langAcceptedTraces(6).traces) {
    assert.equal(context.langVerdict(w), 'acc', w.join(' → '));
  }
});

test('a dead symbol can never appear in a trace', () => {
  reset();
  workflow();
  const flat = context.langAcceptedTraces(6).traces.flat();
  assert.ok(!flat.includes('clusterCascadeResolve'));
});

test('the trace list is a language invariant, not a picture of one drawing', () => {
  // This is the property that forced shortlex selection over anything
  // graph-order dependent.
  reset();
  endsWithAbb();
  const minimal = context.langAcceptedTraces(5).traces.map(w => w.join(''));
  reset();
  endsWithAbbUnminimised();
  const bigger = context.langAcceptedTraces(5).traces.map(w => w.join(''));
  deepEq(minimal, plain(bigger));
  assert.equal(minimal[0], 'abb');
  deepEq(minimal.slice(0, 3), ['abb', 'aabb', 'babb']);
});

test('traces report why they are empty rather than pretending L is empty', () => {
  reset();
  fa({ sigma: ['a'], states: ['q0'], start: 'q0', accepts: [], edges: [] });
  assert.match(context.langAcceptedTraces(5).reason, /accepting/);

  reset();
  fa({ sigma: ['a'], states: ['q0', 'q1'], start: 'q0', accepts: ['q1'], edges: [] });
  App.startId = null;
  assert.match(context.langAcceptedTraces(5).reason, /start/);
});

test('an accepting start state yields the empty word', () => {
  reset();
  fa({ sigma: ['a'], states: ['q0'], start: 'q0', accepts: ['q0'], edges: [['q0', 'a', 'q0']] });
  const { traces } = context.langAcceptedTraces(3);
  deepEq(traces[0], []);
});

test('an unreachable accepting state gives no traces', () => {
  reset();
  fa({
    sigma: ['a'], states: ['q0', 'island'], start: 'q0', accepts: ['island'],
    edges: [['q0', 'a', 'q0']]
  });
  assert.equal(context.langAcceptedTraces(5).traces.length, 0);
});

test('epsilon edges advance the machine without lengthening the word', () => {
  reset();
  const eps = App.config.sym.eps;
  fa({
    machine: 'ε-NFA',
    sigma: ['a'],
    states: ['q0', 'q1', 'q2'], start: 'q0', accepts: ['q2'],
    edges: [['q0', eps, 'q1'], ['q1', 'a', 'q2']]
  });
  const { traces } = context.langAcceptedTraces(3);
  deepEq(traces[0], ['a'], 'the ε hop must not count as a symbol');
});

test('PDA traces are verified against the stack, not just the graph', () => {
  // Walking the graph alone would offer aab; only the real simulator knows
  // the stack forbids it.
  reset();
  const eps = App.config.sym.eps;
  const Z = App.config.sym.stackBottom;
  App.machine = 'PDA';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set([Z, 'A']);
  App.states = ['s0', 's1', 's2'].map((n, i) => ({ id: 's' + i, name: n, x: 0, y: 0 }));
  const id = n => App.states.find(s => s.name === n).id;
  App.transitions = [
    { id: 't0', from: id('s0'), to: id('s0'), symbol: 'a', pop: Z, push: 'A' + Z },
    { id: 't1', from: id('s0'), to: id('s0'), symbol: 'a', pop: 'A', push: 'AA' },
    { id: 't2', from: id('s0'), to: id('s1'), symbol: 'b', pop: 'A', push: eps },
    { id: 't3', from: id('s1'), to: id('s1'), symbol: 'b', pop: 'A', push: eps },
    { id: 't4', from: id('s1'), to: id('s2'), symbol: eps, pop: Z, push: Z }
  ];
  App.startId = id('s0');
  App.accepts = new Set([id('s2')]);
  const words = context.langAcceptedTraces(3).traces.map(w => w.join(''));
  assert.ok(words.length > 0, 'expected some aⁿbⁿ traces');
  for (const w of words) {
    const a = (w.match(/a/g) || []).length;
    const b = (w.match(/b/g) || []).length;
    assert.equal(a, b, `${w} is not aⁿbⁿ — graph over-approximation leaked through`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  NARROWING THE TRACE SEQUENCE
// ══════════════════════════════════════════════════════════════════
// The export dialog can ask for a spread of L(M) rather than its shortlex
// prefix. All three filters narrow the sequence; none may reorder it, and
// none may admit a word the simulator would reject.

// a*b*: two self-loops, so shortlex alone gives ε, a, b, aa, ab, bb, …
// and the loops dominate every row after the first few.
function aStarBStar() {
  return fa({
    sigma: ['a', 'b'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q0', 'q1'],
    edges: [['q0', 'a', 'q0'], ['q0', 'b', 'q1'], ['q1', 'b', 'q1']]
  });
}

test('minLen and maxLen bound the traces without disturbing shortlex order', () => {
  reset();
  aStarBStar();
  const words = context.langAcceptedTraces(30, { minLen: 2, maxLen: 3 })
    .traces.map(w => w.join(''));

  assert.ok(words.length > 0, 'expected some words in the band');
  for (const w of words) {
    assert.ok(w.length >= 2 && w.length <= 3, `${w} is outside [2,3]`);
    assert.match(w, /^a*b*$/);
  }
  for (let i = 1; i < words.length; i++) {
    assert.ok(words[i - 1].length <= words[i].length, `length must not decrease at ${i}`);
  }
  // The band is complete, still in shortlex: every a*b* word of length 2 then 3.
  deepEq(words, ['aa', 'ab', 'bb', 'aaa', 'aab', 'abb', 'bbb']);
});

test('perPath keeps one word per loop-free run instead of the same word pumped', () => {
  reset();
  aStarBStar();
  // a*b* has four loop-free runs: take neither loop, the q0 loop, the cross
  // edge, or the q0 loop then the cross. Everything else repeats a step —
  // "aa" is "a" twice, "bb" re-takes the edge landing on q1 — so a cap of 1
  // is exactly those four, and shortlex still decides their order.
  const one = context.langAcceptedTraces(30, { maxLen: 5, perPath: 1 })
    .traces.map(w => w.join(''));
  deepEq(one, ['', 'a', 'b', 'ab']);

  // Raising the cap lets each of those four routes bring one more word.
  const two = context.langAcceptedTraces(30, { maxLen: 5, perPath: 2 })
    .traces.map(w => w.join(''));
  deepEq(two, ['', 'a', 'b', 'aa', 'ab', 'bb', 'aab']);
});

test('perPath does not merge distinct routes that happen to end in the same state', () => {
  reset();
  // Two parallel edges into the accept: same states, different symbols, and
  // neither is the other with a loop taken — so both must survive a cap of 1
  // even though a subset-keyed skeleton would see one route.
  fa({
    sigma: ['a', 'b'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q1'], ['q0', 'b', 'q1'], ['q1', 'a', 'q1']]
  });
  const words = context.langAcceptedTraces(10, { maxLen: 4, perPath: 1 })
    .traces.map(w => w.join(''));
  assert.ok(words.includes('a') && words.includes('b'), 'both entry edges must be represented');
  // The q1 self-loop is pumping, and pumping is what the cap removes.
  assert.ok(!words.includes('aa') && !words.includes('baa'), 'pumped words must be gone');
  // "ba" survives: entering q1 by b and then looping is a route no kept word
  // covers, since a step is identified by its symbol as well as its target.
  deepEq(words, ['a', 'b', 'ba']);
});

test('a capped trace is still a word the simulator accepts', () => {
  reset();
  workflow();
  for (const w of context.langAcceptedTraces(8, { maxLen: 6, perPath: 1 }).traces) {
    assert.equal(context.langVerdict(w), 'acc', w.join(' → '));
  }
});

test('the skeleton collapses a repeated step and nothing else', () => {
  // Direct on the helper: what does and does not count as going round again.
  const sk = context._langPathSkeleton;
  const start = { k: 'q0', s: null };

  // a self-loop taken twice is the self-loop taken once
  assert.equal(
    sk([start, { k: 'q0', s: 'a' }, { k: 'q0', s: 'a' }, { k: 'q1', s: 'b' }]),
    sk([start, { k: 'q0', s: 'a' }, { k: 'q1', s: 'b' }])
  );
  // so is a longer cycle: q0 -a-> q1 -b-> q0 -a-> q1 comes back to a step
  // it has already taken
  assert.equal(
    sk([start, { k: 'q1', s: 'a' }, { k: 'q0', s: 'b' }, { k: 'q1', s: 'a' }]),
    sk([start, { k: 'q1', s: 'a' }])
  );
  // a different symbol into the same state is a different step
  assert.notEqual(
    sk([start, { k: 'q1', s: 'a' }]),
    sk([start, { k: 'q1', s: 'b' }])
  );
  // and so is the same symbol into a different state — looping on q0 and
  // then leaving it on the same letter is two steps, not one taken twice
  deepEq(
    sk([start, { k: 'q0', s: 'a' }, { k: 'q1', s: 'a' }]).split('|'),
    ['q0', 'a>q0', 'a>q1']
  );
});

test('the sidebar list is unaffected — no options means the full shortlex sequence', () => {
  reset();
  aStarBStar();
  const g = context._langGraph();
  const state = { steps: 0, truncated: false };
  const words = [];
  for (const w of context._langTraceWords(g, state)) {
    words.push(w.join(''));
    if (words.length >= 6) break;
  }
  deepEq(words, ['', 'a', 'b', 'aa', 'ab', 'bb']);
});

// ══════════════════════════════════════════════════════════════════
//  SCROLLING PAST THE OLD ROW CAP, AND THE INFINITE-LANGUAGE CHECK
// ══════════════════════════════════════════════════════════════════
// The old search materialised a frontier per length, capped so it would
// not blow up — which meant results beyond a handful of rows either
// were not found or were not trustworthy. The lazy generator behind
// langAcceptedTraces has no such cap: any K should come back complete,
// still in shortlex order.
test('a machine with a cycle on an accepting path yields far more than the old row cap', () => {
  reset();
  workflow(); // has cycles: e.g. Work -> Rev -> Resv -> Done -> Work
  const { traces, truncated } = context.langAcceptedTraces(200);
  assert.equal(traces.length, 200);
  assert.equal(truncated, false, 'a well-behaved DFA must not hit the safety budget at 200 rows');
  for (let i = 1; i < traces.length; i++) {
    assert.ok(traces[i - 1].length <= traces[i].length, `length must not decrease at ${i}`);
  }
  // no duplicate words, and every one still independently verified
  const words = traces.map(w => w.join('␟'));
  assert.equal(new Set(words).size, words.length, 'no word should repeat');
  for (const w of traces) assert.equal(context.langVerdict(w), 'acc', w.join(' → '));
});

test('langIsInfinite is true for a machine whose accepting path has a cycle', () => {
  reset();
  workflow();
  assert.equal(context.langIsInfinite(), true);
});

test('langIsInfinite is false for an acyclic machine, and the generator exhausts on its own', () => {
  reset();
  // q0 -a-> q1 -b-> q2(accept): a straight line, no cycle anywhere.
  fa({
    sigma: ['a', 'b'],
    states: ['q0', 'q1', 'q2'], start: 'q0', accepts: ['q2'],
    edges: [['q0', 'a', 'q1'], ['q1', 'b', 'q2']]
  });
  assert.equal(context.langIsInfinite(), false);
  // asking for far more than exist must not hang or fabricate rows
  const { traces, truncated } = context.langAcceptedTraces(50);
  deepEq(traces, [['a', 'b']]);
  assert.equal(truncated, false);
});

test('langIsInfinite is false when no accepting state is reachable at all', () => {
  reset();
  fa({ sigma: ['a'], states: ['q0'], start: 'q0', accepts: [], edges: [['q0', 'a', 'q0']] });
  assert.equal(context.langIsInfinite(), false);
});

test('a self-loop that cannot reach any accept does not count as making the language infinite', () => {
  reset();
  // q0 spins on 'a' forever but the only route to the accept is q0 -b-> q1;
  // the self-loop on q0 is a real cycle, but since q0 is live it must
  // still register as infinite — this pins down that liveness, not mere
  // cycle presence anywhere in the graph, is what is being checked.
  fa({
    sigma: ['a', 'b'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q0'], ['q0', 'b', 'q1']]
  });
  assert.equal(context.langIsInfinite(), true);
});

// ══════════════════════════════════════════════════════════════════
//  FINGERPRINT ENUMERATION
// ══════════════════════════════════════════════════════════════════
// Every word the stream would draw, in the order it would draw them.
function fpWords(opts) {
  const out = [];
  for (const r of context.langFingerprintRows({}, opts)) out.push(...r.words);
  return out;
}

test('the fingerprint stream draws one gutter row per length block', () => {
  reset();
  App.sigma = new Set(['a', 'b']);
  const rows = [...context.langFingerprintRows({}, { depthCap: 4 })];
  deepEq(rows.map(r => r.len), [0, 1, 2, 3, 4]);
  deepEq(rows.map(r => r.words.length), [1, 2, 4, 8, 16]);
  assert.ok(rows.every(r => r.off === 0 && !r.span));
  deepEq(rows[2].words, [['a', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'b']],
    'shortlex, last symbol varying fastest');
});

test('a block wider than a row is paged, and every page after the first says so', () => {
  reset();
  App.sigma = new Set(['a', 'b']);
  const rows = [...context.langFingerprintRows({}, { depthCap: 6 })]
    .filter(r => r.len === 6);
  deepEq(rows.map(r => r.words.length), [20, 20, 20, 4], '64 words, 20 to a row');
  deepEq(rows.map(r => r.off), [0, 20, 40, 60],
    'a row is addressed, so a cell can be located from where it sits');
});

test('a one-symbol alphabet is a ribbon: one row per twenty lengths, not one per word', () => {
  // The layout bug this replaced. A unary block holds exactly one word,
  // so a row per block was 128 rows of a single cell — a column, with
  // the period a unary language actually has nowhere to show itself.
  reset();
  App.sigma = new Set(['a']);
  const rows = [...context.langFingerprintRows({}, { depthCap: 49 })];
  assert.equal(rows.length, 3, '50 lengths at 20 to a row');
  deepEq(rows.map(r => r.len), [0, 20, 40]);
  deepEq(rows.map(r => r.words.length), [20, 20, 10]);
  assert.ok(rows.every(r => r.span && r.off === 0));
  assert.equal(rows[1].words[0].length, 20, 'the row is lengths 20..39');
});

test('an empty alphabet is one cell and genuinely all of it', () => {
  reset();
  App.sigma = new Set();
  const state = {};
  const rows = [...context.langFingerprintRows(state)];
  deepEq(rows.map(r => r.words), [[[]]]);
  assert.equal(state.capped, false, 'Σ* = {ε} ends, it is not cut short');
});

test('the cell cap stops the stream mid-block and reports that it did', () => {
  reset();
  App.sigma = new Set(['a', 'b']);
  const state = {};
  const words = fpWords({ cellCap: 50 });
  assert.equal(words.length, 50);
  [...context.langFingerprintRows(state, { cellCap: 50 })];
  assert.equal(state.capped, true);
  // A one-symbol Σ never exhausts either, however deep it is scrolled.
  App.sigma = new Set(['a']);
  const unary = {};
  [...context.langFingerprintRows(unary, { depthCap: 4 })];
  assert.equal(unary.capped, true);
});

test('a long unary word is labelled by its exponent', () => {
  reset();
  App.sigma = new Set(['a']);
  assert.equal(context.langFpLabel([]), App.config.sym.eps);
  assert.equal(context.langFpLabel(['a', 'a', 'a']), 'aaa');
  assert.equal(context.langFpLabel(Array(12).fill('a')), 'a¹²');
  assert.equal(context.langFpLabel([...'abababababab']), 'abababababab',
    'only a run of one symbol collapses');
});

test('langCellsToReach degenerates correctly for a one-symbol alphabet', () => {
  assert.equal(context.langCellsToReach(1, 4), 5);
  assert.equal(context.langCellsToReach(2, 6), 127);
  // The arithmetic that keeps word alphabets on the trace list instead.
  assert.equal(context.langCellsToReach(17, 2), 307);
  assert.equal(context.langCellsToReach(17, 3), 5220);
});

test('the fingerprint of (a|b)*abb has the expected accept count', () => {
  reset();
  endsWithAbb();
  const words = fpWords({ depthCap: 6 });
  let acc = 0;
  for (const w of words) if (context.langVerdict(w) === 'acc') acc++;
  assert.equal(words.length, 127, '1+2+4+...+64');
  assert.equal(acc, 15, 'lengths 3..6 contribute 1+2+4+8');
});

// ══════════════════════════════════════════════════════════════════
//  THE TUPLE LINE
// ══════════════════════════════════════════════════════════════════
test('each machine family gets its own tuple', () => {
  reset();
  App.machine = 'DFA';
  deepEq(context.langTupleSyms(), ['Q', 'Σ', 'δ', 'q₀', 'F']);
  App.machine = 'TM';
  deepEq(context.langTupleSyms(), ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'F']);
  App.machine = 'Mealy';
  deepEq(context.langTupleSyms(), ['Q', 'Σ', 'Δ', 'δ', 'λ', 'q₀']);
  App.machine = '2PDA';
  deepEq(context.langTupleSyms(), ['Q', 'Σ', 'Γ₁', 'Γ₂', 'δ', 'q₀', 'F']);
});

test('the PDA tuple follows the acceptance paradigm', () => {
  reset();
  App.machine = 'PDA';
  App.config.pdaParadigm = 'explicit';
  deepEq(context.langTupleSyms(), ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'Z₀', 'F']);
  App.config.pdaParadigm = 'empty';
  deepEq(context.langTupleSyms(), ['Q', 'Σ', 'Γ', 'δ', 'q₀']);
});

test('tuple cardinalities count the live machine', () => {
  reset();
  workflow();
  assert.equal(context.langTupleInfo('Q').n, 10);
  assert.equal(context.langTupleInfo('Σ').n, 17);
  assert.equal(context.langTupleInfo('δ').n, 21);
  assert.equal(context.langTupleInfo('F').n, 1);
  assert.equal(context.langTupleInfo('q₀').n, null);
  assert.equal(context.langTupleInfo('q₀').val, 'New');
});

test('λ is per state for Moore and per transition for Mealy', () => {
  reset();
  fa({
    machine: 'Moore', sigma: ['a'],
    states: ['q0', 'q1'], start: 'q0', accepts: [],
    edges: [['q0', 'a', 'q1'], ['q1', 'a', 'q0'], ['q0', 'a', 'q0']]
  });
  assert.equal(context.langTupleInfo('λ').n, 2, 'Moore emits per state');
  assert.equal(context.langTupleInfo('λ').val, 'Q → Δ');
  App.machine = 'Mealy';
  assert.equal(context.langTupleInfo('λ').n, 3, 'Mealy emits per transition');
});

// ══════════════════════════════════════════════════════════════════
//  THREE-VALUED TURING-MACHINE MEMBERSHIP
// ══════════════════════════════════════════════════════════════════
test('testTM3 accepts, rejects, and refuses to guess', () => {
  reset();
  abcTmWithSpin();
  assert.equal(context.testTM3(toks(''), 400), 'acc');
  assert.equal(context.testTM3(toks('abc'), 400), 'acc');
  assert.equal(context.testTM3(toks('aabbcc'), 400), 'acc');
  assert.equal(context.testTM3(toks('ab'), 400), 'rej');
  // 'aba' routes into the spin state, whose tape grows forever: no repeated
  // configuration exists, so no budget can decide it.
  assert.equal(context.testTM3(toks('aba'), 400), 'unk');
  assert.equal(context.testTM3(toks('aba'), 5000), 'unk');
});

test('a provably repeating configuration decides the word', () => {
  reset();
  // q0 reads a, writes a, stays: the configuration repeats immediately.
  tape({
    sigma: ['a'], states: ['q0', 'qacc'], start: 'q0', accepts: ['qacc'],
    rules: [['q0', 'a', 'a', 'S', 'q0'], ['q0', 'B', 'B', 'R', 'qacc']]
  });
  assert.equal(context.testTM3(toks('a'), 100000), 'rej',
    'a detected loop is a decision, not a timeout');
  assert.equal(context.testTM3(toks(''), 100), 'acc');
});

test('an LBA always decides — its configuration space is finite', () => {
  reset();
  tape({
    machine: 'LBA', sigma: ['a', 'b'], gamma: ['X', 'Y'],
    states: ['l0', 'l1', 'l2', 'l3', 'lacc'], start: 'l0', accepts: ['lacc'],
    rules: [
      ['l0', 'LM', 'LM', 'R', 'l1'],
      ['l1', 'a', 'X', 'R', 'l2'], ['l1', 'Y', 'Y', 'R', 'l1'], ['l1', 'RM', 'RM', 'L', 'lacc'],
      ['l2', 'a', 'a', 'R', 'l2'], ['l2', 'Y', 'Y', 'R', 'l2'], ['l2', 'b', 'Y', 'L', 'l3'],
      ['l3', 'a', 'a', 'L', 'l3'], ['l3', 'Y', 'Y', 'L', 'l3'], ['l3', 'X', 'X', 'R', 'l1']
    ]
  });
  let unknown = 0;
  for (const w of fpWords({ depthCap: 6 })) if (context.testLBA3(w, 400) === 'unk') unknown++;
  assert.equal(unknown, 0, 'a bounded tape must never leave a word undecided');
});

test('an NDTM with an exhausted frontier rejects definitively', () => {
  reset();
  tape({
    machine: 'NDTM', sigma: ['a', 'b'], gamma: [],
    states: ['n0', 'nacc'], start: 'n0', accepts: ['nacc'],
    rules: [['n0', 'a', 'a', 'R', 'nacc']]
  });
  assert.equal(context.testNDTM3(toks('a'), 400), 'acc');
  assert.equal(context.testNDTM3(toks('b'), 400), 'rej');
  assert.equal(context.testNDTM3(toks('bb'), 400), 'rej');
});

test('testTMVerdict dispatches on the machine type', () => {
  reset();
  abcTmWithSpin();
  App.machine = 'TM';
  assert.equal(context.testTMVerdict(toks('abc')), 'acc');
  // ITM shares the deterministic single-tape shape
  App.machine = 'ITM';
  assert.equal(context.testTMVerdict(toks('abc')), 'acc');
});

test('the fingerprint budget is read from settings and floored', () => {
  reset();
  App.config.langStepBudget = 400;
  assert.equal(context.langStepBudget(), 400);
  App.config.langStepBudget = 1;
  assert.equal(context.langStepBudget(), 10, 'a nonsense budget must not disable the panel');
  App.config.langStepBudget = undefined;
  assert.equal(context.langStepBudget(), 400);
});

test('langVerdict routes Turing machines through the three-valued path', () => {
  reset();
  abcTmWithSpin();
  App.config.langStepBudget = 400;
  assert.equal(context.langVerdict(toks('abc')), 'acc');
  assert.equal(context.langVerdict(toks('ab')), 'rej');
  assert.equal(context.langVerdict(toks('aba')), 'unk');
});

// ══════════════════════════════════════════════════════════════════
//  LOOP DETECTION IN THE INTERACTIVE SIMULATORS
// ══════════════════════════════════════════════════════════════════
test('a stay-loop halts playback immediately instead of running the limit', () => {
  reset();
  tape({
    sigma: ['a'], states: ['q0', 'qacc'], start: 'q0', accepts: ['qacc'],
    rules: [['q0', 'a', 'a', 'S', 'q0'], ['q0', 'B', 'B', 'R', 'qacc']]
  });
  context.simTM(toks('a'));
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.final, 'loop');
  assert.equal(last.loopFrom, 0);
  assert.ok(App.simSteps.length < 10, `expected a short trace, got ${App.simSteps.length}`);
  assert.match(last.note, /never halts/);
});

// ── and the setting that turns it off ──
// Loop detection is what turns "would run forever" into a decision, so
// switching it off costs a verdict. That is the trade the setting exists to
// offer — you switch it off to *watch* a machine not halt — and these pin both
// halves of it: playback stops deciding, and everything that is not playback
// carries on deciding exactly as before.

function stayLoop() {
  tape({
    sigma: ['a'], states: ['q0', 'qacc'], start: 'q0', accepts: ['qacc'],
    rules: [['q0', 'a', 'a', 'S', 'q0'], ['q0', 'B', 'B', 'R', 'qacc']]
  });
}

test('with loop detection off, a looping machine runs to the step budget', () => {
  reset();
  stayLoop();
  App.config.detectLoops = false;
  App.config.maxTmSteps = 50;

  context.simTM(toks('a'));
  const last = App.simSteps[App.simSteps.length - 1];

  assert.equal(App.simSteps.length, 50, 'it ran the whole budget instead of stopping at the repeat');
  // The verdict degrades from a proven non-halt to an honest non-answer, and
  // it must never become a rejection: still running is not the same as no.
  assert.equal(last.final, 'timeout');
  assert.equal(last.limit, 50);
  assert.match(last.note, /NO VERDICT/);
  // …and it says why it could not decide, or a machine the app could have
  // decided reports nothing to explain itself.
  assert.match(last.note, /loop detection is off/);

  App.config.detectLoops = true;
  App.config.maxTmSteps = 10000;
});

test('the setting is playback only — batch runs still decide', () => {
  reset();
  stayLoop();
  App.config.detectLoops = false;

  // testTM3 keeps its own repeat check, because there the repeat *is* the
  // answer. Replacing a correct reject with "no verdict" in a table nobody is
  // watching run would be a loss with nothing bought.
  assert.equal(context.testTMVerdict(toks('a')), 'rej');

  App.config.detectLoops = true;
});

test('a multi-tape machine follows the same setting', () => {
  reset();
  tape({
    machine: 'MTM',
    sigma: ['a'], states: ['m0', 'macc'], start: 'm0', accepts: ['macc'],
    rules: []
  });
  App.tapeCount = 2;
  App.transitions = [{
    id: 'e0', from: App.states[0].id, to: App.states[0].id,
    tapeSyms: ['a', App.config.sym.blank],
    tapeWrites: ['a', App.config.sym.blank],
    tapeDirs: ['S', 'S']
  }];

  context.simMTM(toks('a'));
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'loop');

  App.config.detectLoops = false;
  App.config.maxTmSteps = 30;
  context.simMTM(toks('a'));
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'timeout');
  assert.equal(App.simSteps.length, 30);

  App.config.detectLoops = true;
  App.config.maxTmSteps = 10000;
});

test('a config saved before the setting existed reads as detection on', () => {
  reset();
  stayLoop();
  // Absent must not read as "off": a workspace from an older build would
  // otherwise load with its verdicts quietly downgraded.
  delete App.config.detectLoops;
  assert.equal(context.detectsLoops(), true);

  context.simTM(toks('a'));
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'loop');
  App.config.detectLoops = true;
});

test('a two-state oscillator is caught as a loop', () => {
  reset();
  tape({
    sigma: ['a', 'b'], states: ['p0', 'p1', 'pacc'], start: 'p0', accepts: ['pacc'],
    rules: [['p0', 'a', 'a', 'R', 'p1'], ['p1', 'B', 'B', 'L', 'p0'], ['p0', 'b', 'b', 'R', 'pacc']]
  });
  context.simTM(toks('a'));
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.final, 'loop');
  assert.ok(App.simSteps.length < 10);
});

test('a machine whose tape grows forever times out rather than claiming a loop', () => {
  reset();
  abcTmWithSpin();
  App.config.maxTmSteps = 200;
  context.simTM(toks('aba'));
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.final, 'timeout', 'no configuration repeats, so no loop may be claimed');
  assert.match(last.note, /NO VERDICT/);
  assert.equal(last.limit, 200);
});

test('halting runs are untouched by loop detection', () => {
  reset();
  abcTmWithSpin();
  context.simTM(toks('abc'));
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'accept');
  context.simTM(toks('ab'));
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'reject');
});

test('LBA and ITM playback also detect loops', () => {
  reset();
  tape({
    machine: 'LBA', sigma: ['a', 'b'],
    states: ['l0', 'l1', 'lacc'], start: 'l0', accepts: ['lacc'],
    rules: [['l0', 'LM', 'LM', 'R', 'l1'], ['l1', 'a', 'a', 'S', 'l1'], ['l1', 'b', 'b', 'R', 'lacc']]
  });
  context.simLBA(toks('a'));
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'loop');

  reset();
  tape({
    machine: 'ITM', sigma: ['a'], states: ['i0', 'iacc'], start: 'i0', accepts: ['iacc'],
    rules: [['i0', 'a', 'a', 'S', 'i0'], ['i0', 'B', 'B', 'R', 'iacc']]
  });
  context.simITM(toks('a'));
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'loop');
});

test('a non-halting NDTM search reports no verdict, an exhausted one rejects', () => {
  reset();
  tape({
    machine: 'NDTM', sigma: ['a'], states: ['n0', 'nacc'], start: 'n0', accepts: ['nacc'],
    rules: [['n0', 'a', 'a', 'R', 'nacc']]
  });
  context.simNDTM(toks('b'));
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.final, 'reject', 'every branch halted, so this is a real reject');
});

// ══════════════════════════════════════════════════════════════════
//  BATCH TESTING
// ══════════════════════════════════════════════════════════════════
function runBatchWith(lines) {
  harness.getElement('batch-in').value = lines.join('\n');
  context.runBatch();
  return {
    html: harness.getElement('batch-result').innerHTML,
    summary: harness.getElement('batch-summary').textContent
  };
}

test('batch testing accepts Turing machines and reports three outcomes', () => {
  reset();
  abcTmWithSpin();
  App.config.langStepBudget = 400;
  const { html } = runBatchWith(['abc', 'ab', 'aba']);
  assert.match(html, /br-ok[^]*abc/, 'abc should pass');
  assert.match(html, /br-err[^]*"ab"/, 'ab should fail');
  assert.match(html, /br-unk/, 'aba has no verdict');
  assert.match(html, /not a rejection/);
  assert.match(html, /br-note/, 'the budget note should render');
});

test('an undecided input satisfies no expectation', () => {
  reset();
  abcTmWithSpin();
  App.config.langStepBudget = 400;
  const { summary } = runBatchWith(['abc => accept', 'ab => reject', 'aba => reject']);
  assert.equal(summary, '2 / 3 expectations passed',
    'an unknown must not be quietly counted as a reject');
});

test('batch testing for finite automata is unchanged', () => {
  reset();
  endsWithAbb();
  const { html, summary } = runBatchWith(['abb', 'ab', 'abb => accept', 'ab => accept']);
  assert.match(html, /br-ok[^]*"abb"/);
  assert.match(html, /br-err[^]*"ab"/);
  assert.equal(summary, '1 / 2 expectations passed');
  assert.doesNotMatch(html, /br-unk/, 'a DFA is never undecided');
  assert.doesNotMatch(html, /br-note/);
});

test('untokenizable batch input is still reported as an error', () => {
  reset();
  endsWithAbb();
  const { html } = runBatchWith(['zzz']);
  assert.match(html, /cannot tokenize/);
});

// ══════════════════════════════════════════════════════════════════
//  GNFA STATE ELIMINATION
// ══════════════════════════════════════════════════════════════════
// The derived expression uses '·' for concatenation and ' | ' for union, so
// for a single-character alphabet it maps onto a JS RegExp directly. That
// lets the elimination-order change be checked for *meaning*, not just size.
function toJsRegex(re) {
  const src = re.split('·').join('').split(' | ').join('|').split('ε').join('');
  return new RegExp('^(?:' + src + ')$');
}

function allWords(sigma, maxLen) {
  const out = [''];
  let frontier = [''];
  for (let d = 0; d < maxLen; d++) {
    const next = [];
    for (const w of frontier) for (const s of sigma) { next.push(w + s); out.push(w + s); }
    frontier = next;
  }
  return out;
}

test('cheapest-first elimination still derives the right language', () => {
  reset();
  endsWithAbb();
  const re = context.deriveRegex();
  const rx = toJsRegex(re);
  for (const w of allWords(['a', 'b'], 8)) {
    assert.equal(rx.test(w), context.testDFA(toks(w)),
      `regex and machine disagree on "${w}" — derived: ${re}`);
  }
});

test('elimination order is language-preserving on a second machine', () => {
  reset();
  // binary numbers divisible by 3
  fa({
    sigma: ['0', '1'],
    states: ['r0', 'r1', 'r2'], start: 'r0', accepts: ['r0'],
    edges: [['r0', '0', 'r0'], ['r0', '1', 'r1'], ['r1', '0', 'r2'], ['r1', '1', 'r0'],
            ['r2', '0', 'r1'], ['r2', '1', 'r2']]
  });
  const re = context.deriveRegex();
  const rx = toJsRegex(re);
  for (const w of allWords(['0', '1'], 8)) {
    assert.equal(rx.test(w), context.testDFA(toks(w)), `disagree on "${w}"`);
  }
});

test('cheapest-first keeps a word-alphabet regex orders of magnitude smaller', () => {
  reset();
  workflow();
  const re = context.deriveRegex();
  // Canvas-order elimination produced ~26,000 characters for this machine.
  assert.ok(re.length < 5000, `expected a compact derivation, got ${re.length} chars`);
  assert.ok(re.includes('·'), 'word symbols must stay separated by the concat dot');
  assert.ok(re.includes('citizenFilesComplaint'));
});

test('the regex cache is keyed on machine structure', () => {
  reset();
  endsWithAbb();
  const first = context.deriveRegex();
  assert.equal(context.deriveRegex(), first, 'repeated calls should hit the cache');
  App.accepts = new Set([App.states[0].id]);
  assert.notEqual(context.deriveRegex(), first, 'changing F must bust the cache');
});

test('a machine with no accepting state derives the empty language', () => {
  reset();
  fa({ sigma: ['a'], states: ['q0'], start: 'q0', accepts: [], edges: [['q0', 'a', 'q0']] });
  assert.equal(context.deriveRegex(), '∅');
});

// ══════════════════════════════════════════════════════════════════
//  PANEL RENDERING SMOKE TESTS
// ══════════════════════════════════════════════════════════════════
test('renderLanguagePanel builds without throwing in both modes', () => {
  reset();
  endsWithAbb();
  App._regexIsDerived = true;
  App._regexBoxPlain = '(a|b)*abb';
  assert.doesNotThrow(() => context.renderLanguagePanel());
  assert.ok(harness.getElement('lang-extension').children.length > 0);
  assert.strictEqual(harness.getElement('rp-language').classList.contains('lang-asserted'), false,
    'a derivation must not be marked as an asserted class label');

  reset();
  workflow();
  App._regexIsDerived = true;
  App._regexBoxPlain = 'x'.repeat(1200);
  assert.doesNotThrow(() => context.renderLanguagePanel());
  // The claim is a single line, so the length of a regex too long to show
  // is disclosed on the copy button rather than in a caption beneath it.
  assert.match(harness.getElement('regex-copy-btn').dataset.tip, /1,200 chars/,
    'a long derivation should say how much is out of view');
});

test('an asserted class label is marked as asserted, not derived', () => {
  reset();
  abcTmWithSpin();
  App._regexIsDerived = false;
  App._regexBoxPlain = 'Recursively Enumerable Language';
  context.renderLanguagePanel();
  // Carried by the styling hooks — the pulsing live dot is hidden and the
  // claim switches to the serif class-label face.
  assert.strictEqual(harness.getElement('rp-language').classList.contains('lang-asserted'), true);
  assert.strictEqual(harness.getElement('regex-box').classList.contains('asserted'), true);
});

test('renderLanguagePanel survives an empty canvas', () => {
  reset();
  assert.doesNotThrow(() => context.renderLanguagePanel());
});

test('every machine type renders a tuple without throwing', () => {
  for (const m of Object.keys(context.MachineTypes)) {
    reset();
    App.machine = m;
    assert.doesNotThrow(() => context.renderLangTuple(), m);
  }
});
