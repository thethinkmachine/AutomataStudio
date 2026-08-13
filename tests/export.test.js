import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Export, interop, and the batch-runner split.
//
// The formats are pure functions over the machine IR, so most of this is
// "build a machine, emit, check the string". The parts worth stating
// outright:
//
//   • escaping is per-format and load-bearing — a state named `a"b` must
//     not be able to end a DOT label or a CSV cell early
//   • the δ matrix and the flat edge list are different shapes for
//     different machines, and choosing wrong loses information
//   • negative examples are the reason exportSampleWords exists; an
//     undecided word is not a rejected one
//   • JFLAP's <type> names a family, not a determinism, so the specific
//     machine type has to be read off the transitions

const harness = createHarness();
const { context } = harness;
const App = context.App;

function reset() { harness.resetApp(); }

// Values built inside the VM carry that realm's Array/Object prototypes, so
// assert/strict's deepEqual rejects them against literals declared out here.
// Round-tripping through JSON re-homes them without weakening the comparison.
const plain = v => JSON.parse(JSON.stringify(v));
function deepEq(actual, expected, msg) {
  assert.deepEqual(plain(actual), expected, msg);
}

// Top-level `const` in the loaded scripts is a lexical binding, not a
// property of the VM's global object — reaching ExportFormats/ExportUI
// needs an eval inside that realm.

// ── builders ──────────────────────────────────────────────────────
function fa({ sigma, states, start, accepts, edges, machine = 'DFA' }) {
  App.machine = machine;
  App.sigma = new Set(sigma);
  App.states = states.map((n, i) => ({ id: 's' + i, name: n, x: i * 100, y: 0 }));
  const id = n => App.states.find(s => s.name === n).id;
  App.transitions = edges.map(([f, sym, t], i) => ({ id: 'e' + i, from: id(f), to: id(t), symbol: sym }));
  App.startId = id(start);
  App.accepts = new Set(accepts.map(id));
  App.stateN = states.length;
  App.transN = edges.length;
  return id;
}

// Accepts exactly the binary strings ending in "01".
function endsIn01() {
  return fa({
    sigma: ['0', '1'],
    states: ['q0', 'q1', 'q2'],
    start: 'q0', accepts: ['q2'],
    edges: [
      ['q0', '0', 'q1'], ['q0', '1', 'q0'],
      ['q1', '0', 'q1'], ['q1', '1', 'q2'],
      ['q2', '0', 'q1'], ['q2', '1', 'q0']
    ]
  });
}

// ══════════════════════════════════════════════════════════════════
//  IR
// ══════════════════════════════════════════════════════════════════
test('buildMachineIR resolves names, flags, and rendered edge labels', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();

  assert.equal(ir.machine, 'DFA');
  assert.equal(ir.states.length, 3);
  assert.equal(ir.states.filter(s => s.isStart).length, 1);
  assert.equal(ir.states.find(s => s.isStart).name, 'q0');
  deepEq(ir.acceptNames, ['q2']);
  // Edges carry both endpoints by name so no format has to re-resolve ids.
  const e = ir.transitions[0];
  assert.equal(e.fromName, 'q0');
  assert.equal(e.toName, 'q1');
  assert.equal(e.label, '0');
  assert.equal(ir.isSymbolic, true);
});

test('IR reports a word-length alphabet as non-symbolic', () => {
  reset();
  fa({
    sigma: ['open', 'close'],
    states: ['idle', 'busy'], start: 'idle', accepts: ['idle'],
    edges: [['idle', 'open', 'busy'], ['busy', 'close', 'idle']]
  });
  const ir = context.buildMachineIR();
  assert.equal(ir.isSymbolic, false);
  // Words must be separated or "openclose" reads as a single token.
  assert.equal(context.exportWordText(['open', 'close'], ir), 'open close');
  assert.equal(context.exportWordText([], ir), 'ε');
});

// ══════════════════════════════════════════════════════════════════
//  GRAPHVIZ
// ══════════════════════════════════════════════════════════════════
test('DOT export marks start and accepting states', () => {
  reset();
  endsIn01();
  const dot = context.exportToDot(context.buildMachineIR(), {});

  assert.match(dot, /^digraph DFA \{/);
  assert.match(dot, /rankdir=LR;/);
  // The start marker is an invisible node with an arrow into q0.
  assert.match(dot, /__start \[shape=none/);
  assert.match(dot, /__start -> q0;/);
  assert.match(dot, /q2 \[label="q2", shape=doublecircle\]/);
  assert.match(dot, /q0 -> q1 \[label="0"\]/);
});

test('DOT merges parallel edges into one arrow', () => {
  reset();
  fa({
    sigma: ['a', 'b'],
    states: ['p', 'q'], start: 'p', accepts: ['q'],
    edges: [['p', 'a', 'q'], ['p', 'b', 'q']]
  });
  const ir = context.buildMachineIR();

  const merged = context.exportToDot(ir, { mergeParallel: true });
  assert.match(merged, /p -> q \[label="a, b"\]/);
  assert.equal((merged.match(/p -> q/g) || []).length, 1);

  const split = context.exportToDot(ir, { mergeParallel: false });
  assert.equal((split.match(/p -> q/g) || []).length, 2);
});

test('DOT escapes quotes in state names so a label cannot end early', () => {
  reset();
  fa({
    sigma: ['a'],
    states: ['say "hi"', 'end'], start: 'say "hi"', accepts: ['end'],
    edges: [['say "hi"', 'a', 'end']]
  });
  const dot = context.exportToDot(context.buildMachineIR(), {});
  assert.match(dot, /label="say \\"hi\\""/);
  // The node id is sanitised separately from the label it displays, so the
  // quotes survive in one place and cannot terminate the string in the other.
  assert.match(dot, /^ {2}say__hi_ \[label=/m);
  assert.match(dot, /__start -> say__hi_;/);
});

// ══════════════════════════════════════════════════════════════════
//  TikZ
// ══════════════════════════════════════════════════════════════════
test('TikZ export styles initial/accepting nodes and loops self-edges', () => {
  reset();
  fa({
    sigma: ['a'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q0'], ['q0', 'a', 'q1']]
  });
  const tex = context.exportToTikz(context.buildMachineIR(), {});

  assert.match(tex, /\\begin\{tikzpicture\}/);
  assert.match(tex, /\\node\[state,initial\] \(q0\)/);
  assert.match(tex, /\\node\[state,accepting\] \(q1\)/);
  assert.match(tex, /edge \[loop above\]/);
  assert.match(tex, /\\end\{tikzpicture\}/);
  assert.doesNotMatch(tex, /documentclass/);
});

test('TikZ standalone mode wraps a compilable document', () => {
  reset();
  endsIn01();
  const tex = context.exportToTikz(context.buildMachineIR(), { standalone: true });
  assert.match(tex, /\\documentclass\[border=6pt\]\{standalone\}/);
  assert.match(tex, /\\usetikzlibrary\{automata, positioning, arrows\.meta\}/);
  assert.match(tex, /\\end\{document\}$/);
});

test('TikZ maps Unicode automata symbols to math-mode commands', () => {
  reset();
  fa({
    sigma: ['a'],
    states: ['q_0', 'q1'], start: 'q_0', accepts: ['q1'],
    machine: 'ε-NFA',
    edges: [['q_0', 'ε', 'q1']]
  });
  const tex = context.exportToTikz(context.buildMachineIR(), {});
  // A bare ε breaks a pdflatex run that has no Unicode setup.
  assert.match(tex, /\$\\varepsilon\$/);
  // An underscore in a state name is a subscript unless escaped.
  assert.match(tex, /q\\_0/);
});

// ══════════════════════════════════════════════════════════════════
//  CSV / MARKDOWN
// ══════════════════════════════════════════════════════════════════
test('CSV cells quote separators, escape quotes, and defuse formulas', () => {
  assert.equal(context.csvCell('plain'), 'plain');
  assert.equal(context.csvCell('a,b'), '"a,b"');
  assert.equal(context.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(context.csvCell('line\nbreak'), '"line\nbreak"');
  // A cell a spreadsheet would evaluate as a formula is quoted instead.
  assert.equal(context.csvCell('=1+1'), '"=1+1"');
  assert.equal(context.csvCell('-1'), '"-1"');
});

test('transition matrix marks start/accept and brackets NFA target sets', () => {
  reset();
  fa({
    sigma: ['a', 'b'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    machine: 'NFA',
    edges: [['q0', 'a', 'q0'], ['q0', 'a', 'q1'], ['q1', 'b', 'q1']]
  });
  const csv = context.exportTransitionTable(context.buildMachineIR(), { shape: 'matrix', format: 'csv' });
  const lines = csv.split('\r\n');

  assert.equal(lines[0], 'State,a,b');
  // → start, * accepting; a nondeterministic cell is a set.
  assert.match(lines[1], /^→q0,"\{q0, q1\}",—$/);
  assert.match(lines[2], /^\*q1,—,q1$/);
});

test('stack machines fall back to the edge list, which keeps pop/push', () => {
  reset();
  App.machine = 'DPDA';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['Z', 'A']);
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }];
  App.transitions = [{ id: 'e0', from: 's0', to: 's0', symbol: 'a', pop: 'Z', push: 'AZ' }];
  App.startId = 's0';
  App.accepts = new Set(['s0']);

  const ir = context.buildMachineIR();
  // A δ matrix keyed on the input symbol alone cannot represent a stack edge.
  assert.equal(context.exportSupportsMatrix(ir), false);

  const csv = context.exportTransitionTable(ir, { shape: 'matrix', format: 'csv' });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'From,Read,Pop,Push,To');
  assert.equal(lines[1], 'q0,a,Z,AZ,q0');
});

test('Markdown table escapes pipes so columns cannot break', () => {
  reset();
  fa({
    sigma: ['|'],
    states: ['q0'], start: 'q0', accepts: ['q0'],
    edges: [['q0', '|', 'q0']]
  });
  const md = context.exportTransitionTable(context.buildMachineIR(), { shape: 'matrix', format: 'markdown' });
  assert.match(md, /\\\|/);
  assert.match(md, /\| --- \|/);
});

// ══════════════════════════════════════════════════════════════════
//  LANGUAGE SAMPLES
// ══════════════════════════════════════════════════════════════════
test('sampling separates accepted from rejected words', () => {
  reset();
  endsIn01();
  const s = context.exportSampleWords({ accepted: 4, rejected: 4, maxLength: 6 });

  assert.equal(s.decidable, true);
  assert.ok(s.accepted.length > 0, 'expected accepted words');
  assert.ok(s.rejected.length > 0, 'expected rejected words');
  // Every accepted word really ends in 01, and no rejected one does.
  s.accepted.forEach(w => assert.match(w.join(''), /01$/, `accepted ${w.join('')}`));
  s.rejected.forEach(w => assert.doesNotMatch(w.join(''), /01$/, `rejected ${w.join('')}`));
  // Shortlex: the shortest accepted word is "01" itself.
  assert.equal(s.accepted[0].join(''), '01');
});

// The three narrowing options. The dialog's "Max length" used to reach only
// the Σ* walk behind the rejected column, so on exactly the machines that
// can be traced — DFA, NFA, ε-NFA, PDA — it did nothing to the accepted one.
test('max length bounds the accepted column, not just the rejected one', () => {
  reset();
  endsIn01();
  const s = context.exportSampleWords({ accepted: 20, rejected: 5, maxLength: 4 });
  assert.ok(context.langCanTrace(), 'endsIn01 must take the graph-walk path');
  assert.ok(s.accepted.length > 1, 'expected several accepted words');
  s.accepted.forEach(w => assert.ok(w.length <= 4, `accepted ${w.join('')} exceeds max length`));
  s.rejected.forEach(w => assert.ok(w.length <= 4, `rejected ${w.join('')} exceeds max length`));
});

test('min length lifts the floor on both columns', () => {
  reset();
  endsIn01();
  const s = context.exportSampleWords({ accepted: 6, rejected: 6, minLength: 3, maxLength: 5 });
  assert.ok(s.accepted.length > 0 && s.rejected.length > 0);
  [...s.accepted, ...s.rejected].forEach(w => assert.ok(w.length >= 3, `${w.join('')} is too short`));
  // and it is a filter, not a reordering
  assert.equal(s.accepted[0].join(''), '001');
});

test('a min length above the max clamps instead of exporting nothing', () => {
  reset();
  endsIn01();
  // The two spinners are set one at a time, so min > max is a half-finished
  // edit. Clamping to [3,3] beats handing back a mysteriously empty file.
  const s = context.exportSampleWords({ accepted: 5, rejected: 5, minLength: 9, maxLength: 3 });
  assert.equal(s.decidable, true);
  assert.ok(s.accepted.length > 0, 'expected the clamped band, not an empty one');
  [...s.accepted, ...s.rejected].forEach(w => assert.equal(w.length, 3, `${w.join('')} left the clamped band`));
});

test('the loop switch is what the dialog sets, and on is the old behaviour', () => {
  reset();
  endsIn01();
  const opts = { accepted: 8, rejected: 0, maxLength: 5 };
  const on = context.exportSampleWords({ ...opts, expandLoops: true });
  const off = context.exportSampleWords({ ...opts, expandLoops: false });

  // Loops on must be indistinguishable from not passing the option at all.
  deepEq(on.accepted, plain(context.exportSampleWords(opts).accepted));
  assert.ok(off.accepted.length < on.accepted.length, 'turning loops off must drop rows');
  // "0101" is "01" round the loop again; "001" is a route of its own.
  const words = off.accepted.map(w => w.join(''));
  assert.ok(words.includes('01'));
  assert.ok(!words.includes('0101'), 'a pumped word must not survive');
  off.accepted.forEach(w => assert.equal(context.langVerdict(w), 'acc'));
});

test('words per path stops one self-loop from filling the accepted column', () => {
  reset();
  // (0|1)* with everything accepting: shortlex hands back ε, 0, 1, 00, 01, …
  // all of which are the start state's self-loops taken more times.
  fa({
    sigma: ['0', '1'],
    states: ['q0'], start: 'q0', accepts: ['q0'],
    edges: [['q0', '0', 'q0'], ['q0', '1', 'q0']]
  });
  const uncapped = context.exportSampleWords({ accepted: 8, rejected: 0, maxLength: 5 });
  assert.equal(uncapped.accepted.length, 8, 'the default must still be the shortlex prefix');

  const capped = context.exportSampleWords({ accepted: 8, rejected: 0, maxLength: 5, perPath: 1 });
  assert.ok(capped.accepted.length < uncapped.accepted.length, 'the cap must remove rows');
  // The five loop-free routes of a one-state machine with two self-loops:
  // the empty run, each loop once, and each ordered pair of them. Every
  // longer word repeats a step it has already taken — "00" is "0" twice,
  // "010" returns to a step it has used — so none of them earns a row.
  deepEq(capped.accepted.map(w => w.join('')), ['', '0', '1', '01', '10']);
  // Still genuinely accepted, and still in shortlex order.
  capped.accepted.forEach(w => assert.equal(context.langVerdict(w), 'acc'));
});

test('the cap is not silently applied to machines sampled through the Σ* walk', () => {
  reset();
  // A Moore machine is outside langCanTrace, so its samples come from the Σ*
  // walk and there is no run skeleton to cap — perPath must be ignored
  // rather than emptying the column.
  App.config.transducerAccepts = true;
  fa({
    sigma: ['a'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q1']], machine: 'Moore'
  });
  assert.equal(context.langCanTrace(), false);
  assert.equal(context.langCanDecide(), true);
  const s = context.exportSampleWords({ accepted: 3, rejected: 3, maxLength: 4, perPath: 1 });
  deepEq(s.accepted.map(w => w.join('')), ['a']);
});

test('sampling reports a transducer with no accept notion as undecidable', () => {
  reset();
  App.machine = 'Moore';
  App.config.transducerAccepts = false;
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0, output: '1' }];
  App.startId = 's0';
  const s = context.exportSampleWords({ accepted: 3, rejected: 3 });
  assert.equal(s.decidable, false);
  assert.equal(s.accepted.length, 0);
});

test('batch-format samples round-trip into the Batch Test panel syntax', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();
  const s = context.exportSampleWords({ accepted: 2, rejected: 2, maxLength: 5 });
  const txt = context.exportSamplesText(s, ir, { format: 'batch' });

  txt.split('\n').forEach(line => {
    assert.match(line, / => (accept|reject)$/);
    // parseBatchLine is what the panel uses; the generated line must survive it.
    const parsed = context.parseBatchLine(line);
    assert.ok(parsed.expect === 'accept' || parsed.expect === 'reject');
  });
});

test('sample CSV carries word, verdict, and length', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();
  const s = context.exportSampleWords({ accepted: 2, rejected: 2, maxLength: 5 });
  const csv = context.exportSamplesText(s, ir, { format: 'csv' });
  assert.match(csv.split('\r\n')[0], /^word,verdict,length$/);
  assert.match(csv, /,accept,/);
  assert.match(csv, /,reject,/);
});

// ══════════════════════════════════════════════════════════════════
//  TRANSITION COVERAGE
// ══════════════════════════════════════════════════════════════════
// The mode exists because no filter over the sample words can promise edge
// coverage: q1-b->q1 below is indistinguishable from q0-b->q1 by symbol and
// destination, and q2-a->q0 can only be reached by re-entering q1 the way
// the shorter word already did. Both are missing from the samples export at
// any setting; both must appear here.
function loopyDfa() {
  return fa({
    sigma: ['a', 'b', 'c'],
    states: ['q0', 'q1', 'q2'], start: 'q0', accepts: ['q1', 'q2'],
    edges: [
      ['q0', 'a', 'q0'], ['q0', 'b', 'q1'], ['q1', 'b', 'q1'],
      ['q1', 'c', 'q2'], ['q2', 'a', 'q0']
    ]
  });
}

// Independent of the exporter: walk the word and report what it did.
function walk(word) {
  let cur = App.startId;
  const used = [];
  for (const sym of word) {
    const t = App.transitions.find(t => t.from === cur && t.symbol === sym);
    if (!t) return { used, end: null };
    used.push(t.id);
    cur = t.to;
  }
  return { used, end: cur };
}

test('every transition gets a word, and every word runs through its own edge', () => {
  reset();
  loopyDfa();
  const cov = context.exportCoverageWords();
  assert.equal(cov.rows.length, App.transitions.length, 'all five edges must be covered');
  assert.equal(cov.uncovered.length, 0);

  for (const r of cov.rows) {
    const { used, end } = walk(r.word);
    assert.ok(used.includes(r.id), `${r.word.join('')} does not run through ${r.from}-${r.symbol}->${r.to}`);
    assert.ok(App.accepts.has(end), `${r.word.join('')} does not end in an accept state`);
    assert.equal(context.langVerdict(r.word), 'acc');
    // the reported accept state is the one the word actually reaches
    assert.equal(r.accept, App.states.find(s => s.id === end).name);
  }
});

test('coverage reaches the two edges no sample-word setting can', () => {
  reset();
  loopyDfa();
  const covered = context.exportCoverageWords().rows.map(r => `${r.from}-${r.symbol}->${r.to}`);
  assert.ok(covered.includes('q1-b->q1'));
  assert.ok(covered.includes('q2-a->q0'));

  const samples = context.exportSampleWords({ accepted: 500, rejected: 0, maxLength: 8, expandLoops: false });
  const sampled = new Set(samples.accepted.flatMap(w => walk(w).used));
  const q1loop = App.transitions.find(t => t.symbol === 'b' && t.from === t.to);
  assert.ok(!sampled.has(q1loop.id), 'the premise: samples really do miss this edge');
});

test('an edge that no accepted word can use is reported, not invented', () => {
  reset();
  // q0 -c-> dead goes nowhere, and the island pair is unreachable from q0.
  fa({
    sigma: ['a', 'b', 'c'],
    states: ['q0', 'q1', 'dead', 'island'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q1'], ['q0', 'c', 'dead'], ['island', 'b', 'q1']]
  });
  const cov = context.exportCoverageWords();
  deepEq(cov.rows.map(r => r.word.join('')), ['a']);

  const why = Object.fromEntries(cov.uncovered.map(r => [`${r.from}-${r.symbol}->${r.to}`, r.reason]));
  assert.match(why['q0-c->dead'], /cannot reach an accept/);
  assert.match(why['island-b->q1'], /unreachable/);
});

test('a route the stack forbids is reported uncovered rather than exported', () => {
  reset();
  // The graph offers q0 -a-> q1 -b-> q2, but the b edge pops B while the a
  // edge pushed A, so no word runs either edge. L is empty and the export
  // must say so instead of shipping "ab" as a covering word.
  const eps = App.config.sym.eps;
  const Z = App.config.sym.stackBottom;
  App.machine = 'PDA';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set([Z, 'A', 'B']);
  App.states = ['q0', 'q1', 'q2'].map((n, i) => ({ id: 's' + i, name: n, x: 0, y: 0 }));
  const id = n => App.states.find(s => s.name === n).id;
  App.transitions = [
    { id: 't0', from: id('q0'), to: id('q1'), symbol: 'a', pop: Z, push: 'A' + Z },
    { id: 't1', from: id('q1'), to: id('q2'), symbol: 'b', pop: 'B', push: eps }
  ];
  App.startId = id('q0');
  App.accepts = new Set([id('q2')]);

  const cov = context.exportCoverageWords();
  assert.equal(cov.rows.length, 0, 'nothing may be claimed as covered');
  assert.equal(cov.uncovered.length, 2);
  cov.uncovered.forEach(r => assert.match(r.reason, /no accepted word/));
});

test('an edge with no symbol to spend cannot end up inside another route', () => {
  reset();
  // A wildcard stands for every symbol in Σ, so with Σ emptied it stands for
  // none and the edge is not traversable. The guard used to sit only on the
  // edge being covered, so a wildcard in the *prefix* put a hole in the word:
  // the export claimed q1-a->q2 was covered by "a" at length 2, and the
  // simulator agreed because the hole matched the wildcard on the way past.
  const ANY = App.config.sym.any;
  App.machine = 'DFA';
  App.sigma = new Set();
  App.states = ['q0', 'q1', 'q2'].map((n, i) => ({ id: 's' + i, name: n, x: 0, y: 0 }));
  App.transitions = [
    { id: 't0', from: 's0', to: 's1', symbol: ANY },
    { id: 't1', from: 's1', to: 's2', symbol: 'a' }
  ];
  App.startId = 's0';
  App.accepts = new Set(['s2']);

  const cov = context.exportCoverageWords();
  assert.equal(cov.rows.length, 0, 'no edge is reachable, so none may be claimed');
  for (const r of cov.rows) {
    assert.ok(r.word.every(s => s !== undefined && s !== null), `${JSON.stringify(r.word)} has a hole`);
  }
  // and the depth estimate must not count a route it could not spell either
  assert.equal(context.langRouteDepth(), 0);

  // The rendered word and the reported length always describe each other.
  const ir = context.buildMachineIR();
  context.exportCoverageText(cov, ir, { format: 'csv' })
    .split('\r\n').slice(1).filter(Boolean)
    .forEach(row => {
      const [, , , word, len] = row.split(',');
      if (len) assert.equal([...word].length, Number(len), `"${word}" is not ${len} long`);
    });
});

test('ε edges cost nothing in a coverage route', () => {
  reset();
  const eps = App.config.sym.eps;
  fa({
    sigma: ['a'],
    states: ['q0', 'q1', 'q2'], start: 'q0', accepts: ['q2'],
    edges: [['q0', eps, 'q1'], ['q1', 'a', 'q2']], machine: 'ε-NFA'
  });
  const cov = context.exportCoverageWords();
  assert.equal(cov.uncovered.length, 0);
  // the ε edge is covered by "a" — the ε contributes no symbol
  deepEq(cov.rows.map(r => r.word.join('')), ['a', 'a']);
});

test('coverage declines the machines where a graph path is not a word', () => {
  reset();
  // A tape head revisits cells, so an edge does not correspond to a symbol
  // of the input and the whole edge/word pairing would be fiction.
  App.machine = 'TM';
  App.sigma = new Set(['a']);
  App.states = ['q0', 'q1'].map((n, i) => ({ id: 's' + i, name: n, x: 0, y: 0 }));
  App.transitions = [{ id: 't0', from: 's0', to: 's1', symbol: 'a', write: 'a', dir: 'R' }];
  App.startId = 's0';
  App.accepts = new Set(['s1']);

  assert.equal(context.langCanTrace(), false);
  const out = context.ExportFormats.coverage.build(context.buildMachineIR(), { format: 'csv' });
  assert.match(out, /^#/, 'must explain rather than emit an empty table');
  assert.match(out, /outside that set/);
});

test('coverage emits CSV, Markdown, JSON and runnable batch input', () => {
  reset();
  loopyDfa();
  const ir = context.buildMachineIR();
  const cov = context.exportCoverageWords();

  const csv = context.exportCoverageText(cov, ir, { format: 'csv' });
  assert.equal(csv.split('\r\n')[0], 'from,symbol,to,word,length,accept,status');
  assert.equal(csv.split('\r\n').filter(Boolean).length, 6, 'header plus one row per edge');

  const md = context.exportCoverageText(cov, ir, { format: 'markdown' });
  assert.match(md, /5 of 5 transitions covered/);

  const json = JSON.parse(context.exportCoverageText(cov, ir, { format: 'json' }));
  assert.equal(json.transitions, 5);
  assert.equal(json.covered.length, 5);

  const batch = context.exportCoverageText(cov, ir, { format: 'batch' });
  batch.split('\n').forEach(line => {
    assert.match(line, / => accept$/);
    assert.equal(context.parseBatchLine(line).expect, 'accept');
  });
});

test('uncovered edges can be left out of the table but never faked', () => {
  reset();
  fa({
    sigma: ['a', 'c'],
    states: ['q0', 'q1', 'dead'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q1'], ['q0', 'c', 'dead']]
  });
  const ir = context.buildMachineIR();
  const cov = context.exportCoverageWords();
  const withThem = context.exportCoverageText(cov, ir, { format: 'csv' });
  const without = context.exportCoverageText(cov, ir, { format: 'csv', includeUncovered: false });
  assert.match(withThem, /cannot reach an accept/);
  assert.doesNotMatch(without, /cannot reach an accept/);
  // the covered row survives either way, and no word is invented for `dead`
  assert.match(without, /q0,a,q1,a,1,q1,covered/);
  assert.doesNotMatch(without, /dead/);
});

// ══════════════════════════════════════════════════════════════════
//  CEILINGS: WHAT BOUND THE OUTPUT, AND WHERE THE BOUND COMES FROM
// ══════════════════════════════════════════════════════════════════
// One `truncated` boolean used to answer four different questions. A test
// suite built from a silently truncated list is missing cases, so each
// column now says what stopped it — and `null` means the list is complete.
test('a complete column reports no limit at all', () => {
  reset();
  // A finite language: three words, and a length bound well past the longest.
  fa({
    sigma: ['a'],
    states: ['q0', 'q1', 'q2'], start: 'q0', accepts: ['q1', 'q2'],
    edges: [['q0', 'a', 'q1'], ['q1', 'a', 'q2']]
  });
  const s = context.exportSampleWords({ accepted: 50, rejected: 0, maxLength: 12 });
  deepEq(s.accepted.map(w => w.join('')), ['a', 'aa']);
  assert.equal(s.limits.accepted, null, 'nothing bound this — it is all of L');
  assert.equal(s.limits.rejected, null, 'no rejects were asked for');
});

test('each column names the ceiling that bound it', () => {
  reset();
  loopyDfa();

  // filled the row count
  const rows = context.exportSampleWords({ accepted: 3, rejected: 3, maxLength: 8 });
  assert.equal(rows.limits.accepted, 'rows');
  assert.equal(rows.limits.rejected, 'rows');

  // ran out of length: an infinite language always has longer words
  const len = context.exportSampleWords({ accepted: 500, rejected: 500, maxLength: 3 });
  assert.ok(len.accepted.length < 500);
  assert.equal(len.limits.accepted, 'length');
  assert.equal(len.limits.rejected, 'length');

  // ran out of Σ* budget before filling the rejected quota
  const budget = context.exportSampleWords({ accepted: 0, rejected: 500, maxLength: 8, budget: 12 });
  assert.equal(budget.limits.rejected, 'word-budget');
});

test('the limit note travels in the file, not just the return value', () => {
  reset();
  loopyDfa();
  const ir = context.buildMachineIR();

  const cut = context.exportSampleWords({ accepted: 3, rejected: 0, maxLength: 8 });
  assert.match(context.exportSamplesText(cut, ir, { format: 'markdown' }), /accepted: incomplete — the requested word count/);
  assert.equal(JSON.parse(context.exportSamplesText(cut, ir, { format: 'json' })).limits.accepted, 'rows');

  reset();
  fa({ sigma: ['a'], states: ['q0', 'q1'], start: 'q0', accepts: ['q1'], edges: [['q0', 'a', 'q1']] });
  const whole = context.exportSampleWords({ accepted: 50, rejected: 0, maxLength: 9 });
  assert.match(context.exportSamplesText(whole, context.buildMachineIR(), { format: 'markdown' }), /^Complete:/m);
});

test('max length defaults to the machine, not to a constant', () => {
  reset();
  loopyDfa();
  // The longest coverage word on this machine is "bcab"; below 4 some edge
  // could not appear in any exported word.
  assert.equal(context.langRouteDepth(), 4);
  assert.equal(context.exportDefaultMaxLength(), 4);
  assert.equal(context.exportDefaultOpts('samples').maxLength, 4);

  // A longer chain moves the default with it.
  reset();
  fa({
    sigma: ['a'],
    states: ['q0', 'q1', 'q2', 'q3'], start: 'q0', accepts: ['q3'],
    edges: [['q0', 'a', 'q1'], ['q1', 'a', 'q2'], ['q2', 'a', 'q3']]
  });
  assert.equal(context.exportDefaultMaxLength(), 3);

  // Nothing to derive from falls back rather than producing 0.
  reset();
  assert.equal(context.langRouteDepth(), 0);
  assert.equal(context.exportDefaultMaxLength(), context.EXPORT_FALLBACK_LENGTH);
});

test('the row ceilings are output size, and the length ceiling is the search cap', () => {
  reset();
  loopyDfa();
  const byId = Object.fromEntries(context.ExportFormats.samples.options.map(o => [o.id, o]));
  // 500 was arbitrary; cost is bounded by the budgets, not by the row count.
  assert.ok(byId.accepted.max >= 10000);
  assert.ok(byId.rejected.max >= 10000);
  // and the length spinner now reaches as far as the search itself will go
  const resolve = v => (typeof v === 'function' ? v() : v);
  assert.equal(resolve(byId.maxLength.max), context.LANG_TRACE_DEPTH_CAP);
  assert.equal(resolve(byId.minLength.max), context.LANG_TRACE_DEPTH_CAP);
});

test('deferred schema fields are never read at module scope', () => {
  // language.js imports export-ui.js, so a const of theirs evaluated while
  // the registry object is being built would be a TDZ error on one of the two
  // load orders. Both must be functions, not values.
  const byId = Object.fromEntries(context.ExportFormats.samples.options.map(o => [o.id, o]));
  assert.equal(typeof byId.maxLength.max, 'function');
  assert.equal(typeof byId.minLength.max, 'function');
  assert.equal(typeof byId.maxLength.def, 'function');
  assert.equal(typeof byId.origin.choices, 'function');
});

// ══════════════════════════════════════════════════════════════════
//  ROUTING FROM A CHOSEN ORIGIN
// ══════════════════════════════════════════════════════════════════
// Asking for words "from q1" is asking about L(M_q1), so the simulators that
// verify each candidate have to agree about where the start is. They read
// App.startId, so the origin is installed for the duration of the read — and
// the thing most worth pinning down is that it never survives the call.
test('a chosen origin changes the language the samples describe', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;

  const fromStart = context.exportSampleWords({ accepted: 6, rejected: 0, maxLength: 4 });
  const fromQ1 = context.exportSampleWords({ accepted: 6, rejected: 0, maxLength: 4, origin: id('q1') });

  // From q0 the shortest accepted word is "b"; q1 is itself accepting, so
  // from there the empty word is in the language and "b" means the self-loop.
  assert.equal(fromStart.accepted[0].join(''), 'b');
  deepEq(fromQ1.accepted.slice(0, 3).map(w => w.join('')), ['', 'b', 'c']);
  assert.equal(fromQ1.origin, 'q1');
  assert.equal(fromStart.origin, 'q0');
});

test('the origin is restored even when the computation throws', () => {
  reset();
  loopyDfa();
  const before = App.startId;
  const id = n => App.states.find(s => s.name === n).id;

  context.exportSampleWords({ accepted: 3, rejected: 3, maxLength: 3, origin: id('q2') });
  assert.equal(App.startId, before, 'a normal call must leave the start state alone');

  // Force a throw from inside the swap. _langGraph iterates App.transitions
  // as its first act, which is well inside withOrigin's try.
  const real = App.transitions;
  const booby = [];
  Object.defineProperty(booby, Symbol.iterator, { value: () => { throw new Error('boom'); } });
  App.transitions = booby;
  try {
    assert.throws(
      () => context.exportSampleWords({ accepted: 3, rejected: 3, maxLength: 3, origin: id('q2') }),
      /boom/
    );
  } finally {
    App.transitions = real;
  }
  assert.equal(App.startId, before, 'a throw must not strand the swapped start state');
});

test('an origin that is not a state falls back to the real start', () => {
  reset();
  loopyDfa();
  const good = context.exportSampleWords({ accepted: 4, rejected: 0, maxLength: 3 });
  const bogus = context.exportSampleWords({ accepted: 4, rejected: 0, maxLength: 3, origin: 'deleted-state-id' });
  deepEq(bogus.accepted, plain(good.accepted));
  assert.equal(bogus.origin, 'q0');
  assert.equal(context.exportResolveOrigin(''), App.startId);
});

test('coverage routes its prefixes from the chosen origin', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  const cov = context.exportCoverageWords({ origin: id('q1') });
  assert.equal(cov.origin, 'q1');

  const byEdge = Object.fromEntries(cov.rows.map(r => [`${r.from}-${r.symbol}->${r.to}`, r.word.join('')]));
  // From q1 the q1 self-loop needs no prefix at all, where from q0 it took "b".
  assert.equal(byEdge['q1-b->q1'], 'b');
  // And every word must run from q1, not q0.
  for (const r of cov.rows) {
    let cur = id('q1');
    for (const sym of r.word) {
      const t = App.transitions.find(t => t.from === cur && t.symbol === sym);
      assert.ok(t, `${r.word.join('')} is not a run from q1`);
      cur = t.to;
    }
    assert.ok(App.accepts.has(cur));
  }
});

test('an end state narrows the route to words that finish there', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  const endsAt = w => {
    let cur = App.startId;
    for (const sym of w) cur = App.transitions.find(t => t.from === cur && t.symbol === sym).to;
    return App.states.find(s => s.id === cur).name;
  };

  const any = context.exportSampleWords({ accepted: 6, rejected: 0, maxLength: 5 });
  assert.deepEqual([...new Set(any.accepted.map(endsAt))].sort(), ['q1', 'q2']);

  const q2 = context.exportSampleWords({ accepted: 6, rejected: 0, maxLength: 5, target: id('q2') });
  deepEq(q2.accepted.map(w => w.join('')), ['bc', 'abc', 'bbc', 'aabc', 'abbc', 'bbbc']);
  q2.accepted.forEach(w => assert.equal(endsAt(w), 'q2'));
  assert.equal(q2.target, 'q2');
  assert.equal(any.target, null, 'the default must not name a state');
});

test('the end state need not be an accepting one', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  // q0 is the start and accepts nothing; "words that reach q0" is still a
  // sensible question, and ε is its shortest answer.
  const s = context.exportSampleWords({ accepted: 4, rejected: 0, maxLength: 5, target: id('q0') });
  deepEq(s.accepted.map(w => w.join('')), ['', 'a', 'aa', 'aaa']);
});

test('the same node at both ends asks for round trips, and gets them', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  const walk = (from, w) => {
    let cur = from;
    for (const sym of w) {
      const t = App.transitions.find(t => t.from === cur && t.symbol === sym);
      if (!t) return null;
      cur = t.to;
    }
    return cur;
  };

  const s = context.exportSampleWords({ accepted: 6, rejected: 0, maxLength: 6, origin: id('q1'), target: id('q1') });
  deepEq(s.accepted.map(w => w.join('') || 'ε'), ['ε', 'b', 'bb', 'bbb', 'cab', 'bbbb']);
  s.accepted.forEach(w => assert.equal(walk(id('q1'), w), id('q1'), `${w.join('')} does not return to q1`));

  // With the loop cap on, what is left is one word per distinct cycle: stay
  // put, the self-loop, or the long way round through q2 and q0.
  const cycles = context.exportSampleWords({
    accepted: 20, rejected: 0, maxLength: 6, origin: id('q1'), target: id('q1'), expandLoops: false
  });
  deepEq(cycles.accepted.map(w => w.join('') || 'ε'), ['ε', 'b', 'cab']);

  // Coverage still reaches every edge, each by a route that comes home.
  const cov = context.exportCoverageWords({ origin: id('q1'), target: id('q1') });
  assert.equal(cov.rows.length, App.transitions.length);
  cov.rows.forEach(r => assert.equal(walk(id('q1'), r.word), id('q1')));
});

test('the swapped accept set is restored, including when the run throws', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  const before = [...App.accepts];

  context.exportSampleWords({ accepted: 3, rejected: 3, maxLength: 3, target: id('q2') });
  deepEq([...App.accepts], before, 'a normal call must leave the accept set alone');

  const real = App.transitions;
  const booby = [];
  Object.defineProperty(booby, Symbol.iterator, { value: () => { throw new Error('boom'); } });
  App.transitions = booby;
  try {
    assert.throws(() => context.exportSampleWords({ accepted: 3, rejected: 0, maxLength: 3, target: id('q2') }), /boom/);
  } finally {
    App.transitions = real;
  }
  deepEq([...App.accepts], before, 'a throw must not strand the swapped accept set');
  assert.equal(App.startId, id('q0'));
});

test('coverage aims every route at the chosen end state', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  const cov = context.exportCoverageWords({ origin: id('q1'), target: id('q2') });
  assert.equal(cov.origin, 'q1');
  assert.equal(cov.target, 'q2');
  assert.equal(cov.rows.length, App.transitions.length);

  for (const r of cov.rows) {
    let cur = id('q1');
    for (const sym of r.word) {
      const t = App.transitions.find(t => t.from === cur && t.symbol === sym);
      assert.ok(t, `${r.word.join('')} is not a run from q1`);
      cur = t.to;
    }
    assert.equal(cur, id('q2'), `${r.word.join('')} does not end at q2`);
    assert.equal(r.accept, 'q2');
  }
  assert.match(context.exportCoverageText(cov, context.buildMachineIR(), { format: 'markdown' }), /routed from q1 to q2/);
});

test('an unreachable end state is reported as the end state, not as "an accept"', () => {
  reset();
  // q2 accepts, but nothing leads to q3 — asking to end there must say so in
  // the terms the user asked in.
  fa({
    sigma: ['a'],
    states: ['q0', 'q1', 'q3'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q1']]
  });
  const id = n => App.states.find(s => s.name === n).id;
  const cov = context.exportCoverageWords({ target: id('q3') });
  assert.equal(cov.rows.length, 0);
  assert.match(cov.uncovered[0].reason, /cannot reach the end state q3/);

  // and with no end state chosen the wording goes back to the accept set
  const plain = context.exportCoverageWords();
  assert.equal(plain.uncovered.length, 0);
});

test('the batch warning appears only when it applies, and says which end moved', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  const spec = context.ExportFormats.samples;
  const base = context.exportDefaultOpts('samples');

  // maxLength is held clear of the route-depth warning, which has its own test.
  const roomy = { ...base, maxLength: 12, rejected: 0 };
  const only = o => { const w = spec.warn({ ...roomy, ...o }); return w.length === 1 ? w[0] : w; };

  // Silent by default, and silent for every format that is not batch.
  deepEq(spec.warn(base), []);
  deepEq(spec.warn({ ...roomy, origin: id('q1') }), [], 'CSV records the route in itself');
  deepEq(spec.warn({ ...roomy, format: 'json', target: id('q2') }), []);
  deepEq(spec.warn({ ...roomy, format: 'batch' }), [], 'default route round-trips fine');

  // Fires for batch, and names the end that moved.
  assert.match(only({ format: 'batch', origin: id('q1') }), /^Start from is off the default/);
  assert.match(only({ format: 'batch', target: id('q2') }), /^End at is off the default/);
  assert.match(only({ format: 'batch', origin: id('q1'), target: id('q2') }), /^Start from and End at are off/);

  // It reaches the dialog, and only then.
  const quiet = context.exportCodeOptionsHtml(spec, base);
  const loud = context.exportCodeOptionsHtml(spec, { ...roomy, format: 'batch', origin: id('q1') });
  assert.ok(!quiet.includes('exp-warn'));
  assert.match(loud, /<div class="exp-warn"><p>/);
  assert.match(loud, /will fail/);
});

// Each of these combinations is legal and does exactly what it says. The
// warning exists because what it says is not what a reader assumes, and every
// one of them was found by auditing the controls against each other rather
// than by anything failing.
test('an End state changes what "rejected" means, and the dialog says so', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  const s = context.exportSampleWords({ accepted: 0, rejected: 6, maxLength: 3, target: id('q2') });

  // "b" ends at q1, which is an accepting state — the machine accepts it, and
  // the export files it under rejected because it does not finish at q2.
  const words = s.rejected.map(w => w.join(''));
  assert.ok(words.includes('b'));
  assert.equal(context.langVerdict(['b']), 'acc', 'the premise: the machine really accepts it');

  const warn = context.ExportFormats.samples.warn({
    ...context.exportDefaultOpts('samples'), maxLength: 12, target: id('q2'), rejected: 6
  });
  assert.ok(warn.some(w => /including words the machine itself accepts/.test(w)));
  // and not when no rejects were asked for
  const none = context.ExportFormats.samples.warn({
    ...context.exportDefaultOpts('samples'), maxLength: 12, target: id('q2'), rejected: 0
  });
  assert.ok(!none.some(w => /machine itself accepts/.test(w)));
});

test('a min length under a loop cap keeps a pumped word instead of a plain one', () => {
  reset();
  loopyDfa();
  // The quota is one word per route, and the shortest word on a route takes
  // its loops fewest times. Skipping the short ones hands the quota to a
  // pumped word — "bbb" is "b" round the q1 self-loop twice.
  const plain = context.exportSampleWords({ accepted: 20, rejected: 0, maxLength: 6, expandLoops: false });
  deepEq(plain.accepted.map(w => w.join('')), ['b', 'ab', 'bc', 'abc']);

  const floored = context.exportSampleWords({ accepted: 20, rejected: 0, maxLength: 6, minLength: 3, expandLoops: false });
  assert.ok(floored.accepted.map(w => w.join('')).includes('bbb'), 'the premise: a pumped word survives');

  const warn = context.ExportFormats.samples.warn({
    ...context.exportDefaultOpts('samples'), maxLength: 12, rejected: 0, minLength: 3, expandLoops: false
  });
  assert.ok(warn.some(w => /already been round a loop/.test(w)));
});

test('the loop switch admits it does nothing where there is no graph walk', () => {
  reset();
  App.config.transducerAccepts = true;
  fa({
    sigma: ['a'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q1'], ['q1', 'a', 'q1']], machine: 'Moore'
  });
  assert.equal(context.exportCanTrace(), false);
  const on = context.exportSampleWords({ accepted: 4, rejected: 0, maxLength: 4 });
  const off = context.exportSampleWords({ accepted: 4, rejected: 0, maxLength: 4, expandLoops: false });
  deepEq(off.accepted, plain(on.accepted), 'the premise: the switch is inert here');

  const warn = context.ExportFormats.samples.warn({
    ...context.exportDefaultOpts('samples'), maxLength: 12, rejected: 0, expandLoops: false
  });
  assert.ok(warn.some(w => /Expand loops does nothing/.test(w)));
});

test('a re-aimed route can outgrow the max length that was defaulted for another', () => {
  reset();
  loopyDfa();
  const id = n => App.states.find(s => s.name === n).id;
  // The default is computed when the dialog opens, for the machine's own
  // route. Re-aiming afterwards does not move the spinner.
  assert.equal(context.exportDefaultMaxLength(), 4);
  assert.equal(context.exportRouteDepth({ origin: id('q1'), target: id('q2') }), 5);

  const warn = context.ExportFormats.samples.warn({
    ...context.exportDefaultOpts('samples'), rejected: 0, origin: id('q1'), target: id('q2')
  });
  assert.ok(warn.some(w => /Max length 4 is below the 5/.test(w)));
  // Raising it past the route's depth silences it.
  const raised = context.ExportFormats.samples.warn({
    ...context.exportDefaultOpts('samples'), rejected: 0, maxLength: 5, origin: id('q1'), target: id('q2')
  });
  assert.ok(!raised.some(w => /Max length/.test(w)));
});

test('a format that can warn declares a probe so the modal cannot jump', () => {
  // sizeExportCodeOptions locks the options block to the tallest format. It
  // measures defaults, and no default fires a warning — so any format with a
  // `warn` has to hand it an option set that does, or the block outgrows the
  // height it was locked to the moment the warning appears.
  for (const [key, spec] of Object.entries(context.ExportFormats)) {
    if (typeof spec.warn !== 'function') continue;
    assert.ok(spec.warnProbe, `${key} declares warn() but no warnProbe`);
    const probed = { ...context.exportDefaultOpts(key), ...spec.warnProbe };
    assert.ok(spec.warn(probed).length, `${key}'s warnProbe does not actually fire its warning`);
  }
});

test('the origin picker offers every state, and the default means the start', () => {
  reset();
  loopyDfa();
  const spec = context.ExportFormats.samples;
  for (const [id, head] of [['origin', 'Start state'], ['target', 'Any accept state']]) {
    const opt = spec.options.find(o => o.id === id);
    assert.equal(opt.def, '', `${id} must not pin a state id`);
    deepEq(opt.choices(), [['', head], ...App.states.map(s => [s.id, s.name])]);
  }

  // A state name is user text and lands in innerHTML; it must be escaped.
  App.states[0].name = '<img src=x onerror=alert(1)>';
  const html = context.exportCodeOptionsHtml(spec, context.exportDefaultOpts('samples'));
  assert.ok(!html.includes('<img'), 'a state name must not inject markup');
  assert.match(html, /&lt;img/);
});

// ══════════════════════════════════════════════════════════════════
//  BATCH: COMPUTE / RENDER SPLIT
// ══════════════════════════════════════════════════════════════════
test('computeBatchResults scores expectations without touching the DOM', () => {
  reset();
  endsIn01();
  const batch = context.computeBatchResults(['01 => accept', '11 => reject', '101 => reject']);

  assert.equal(batch.results.length, 3);
  assert.equal(batch.expected, 3);
  // "101" ends in 01, so expecting a reject is a failure — 2 of 3 pass.
  assert.equal(batch.passCount, 2);
  assert.equal(batch.allPassed, false);
  assert.equal(batch.results[0].verdict, 'accept');
  assert.equal(batch.results[2].verdict, 'accept');
});

test('a batch with no expectations reports no pass/fail verdict', () => {
  reset();
  endsIn01();
  const batch = context.computeBatchResults(['01', '11']);
  assert.equal(batch.expected, 0);
  assert.equal(batch.allPassed, false);
  assert.equal(batch.results[0].verdict, 'accept');
  assert.equal(batch.results[1].verdict, 'reject');
});

test('batch results export as CSV, JSON, and Markdown', () => {
  reset();
  endsIn01();
  const batch = context.computeBatchResults(['01 => accept', '11 => reject']);

  const csv = context.exportBatchText(batch, { format: 'csv' });
  assert.equal(csv.split('\r\n')[0], 'input,expected,verdict,pass,output');
  // The stored input is the parsed string, not the raw "=> accept" line.
  assert.equal(csv.split('\r\n')[1], '01,accept,accept,true,');

  const json = JSON.parse(context.exportBatchText(batch, { format: 'json' }));
  assert.equal(json.expectations, 2);
  assert.equal(json.passed, 2);
  assert.equal(json.results.length, 2);

  const md = context.exportBatchText(batch, { format: 'markdown' });
  assert.match(md, /2 \/ 2 expectations passed/);
  assert.match(md, /\| --- \|/);
});

// ══════════════════════════════════════════════════════════════════
//  IDENTIFIERS
// ══════════════════════════════════════════════════════════════════
test('identifier sanitising keeps distinct states distinct', () => {
  assert.equal(context.exportIdent('q0'), 'q0');
  assert.equal(context.exportIdent('q 0'), 'q_0');
  assert.equal(context.exportIdent('0start'), '_0start');
  assert.equal(context.exportIdent('', 'fallback'), 'fallback');

  // "q0" and "q 0" both sanitise to a name starting q_0 — they must not
  // collapse onto one another.
  const states = [{ id: 'a', name: 'q-0' }, { id: 'b', name: 'q_0' }, { id: 'c', name: 'q 0' }];
  const map = context.exportUniqueIdents(states);
  assert.equal(new Set([...map.values()]).size, 3);
});

// ══════════════════════════════════════════════════════════════════
//  JFLAP IMPORT
// ══════════════════════════════════════════════════════════════════
const JFF_DFA = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<structure>
  <type>fa</type>
  <automaton>
    <state id="0" name="q0"><x>90.0</x><y>120.0</y><initial/></state>
    <state id="1" name="q1"><x>250.0</x><y>120.0</y><final/></state>
    <transition><from>0</from><to>1</to><read>a</read></transition>
    <transition><from>1</from><to>1</to><read>b</read></transition>
  </automaton>
</structure>`;

test('JFLAP import maps states, positions, start and accept flags', () => {
  reset();
  const data = context.jflapToWorkspace(context.jflapParseXML(JFF_DFA));

  assert.equal(data.machine, 'DFA');
  assert.equal(data.states.length, 2);
  assert.equal(data.states[0].name, 'q0');
  assert.equal(data.states[0].x, 90);
  assert.equal(data.states[0].y, 120);
  assert.equal(data.startId, data.states[0].id);
  deepEq(data.accepts, [data.states[1].id]);
  deepEq(data.sigma.sort(), ['a', 'b']);
  assert.equal(data.transitions.length, 2);
  assert.equal(data.transitions[0].symbol, 'a');
});

test('JFLAP import produces a workspace the app will actually load', () => {
  reset();
  const data = context.jflapToWorkspace(context.jflapParseXML(JFF_DFA));
  // validateSchema is the same gate a dropped .json file passes through.
  assert.equal(context.validateSchema(data), true);
});

test('JFLAP <type>fa</type> resolves to DFA, NFA, or ε-NFA by its transitions', () => {
  reset();
  const nfa = `<structure><type>fa</type><automaton>
    <state id="0" name="q0"><initial/></state>
    <state id="1" name="q1"><final/></state>
    <transition><from>0</from><to>0</to><read>a</read></transition>
    <transition><from>0</from><to>1</to><read>a</read></transition>
  </automaton></structure>`;
  assert.equal(context.jflapToWorkspace(context.jflapParseXML(nfa)).machine, 'NFA');

  // An empty <read/> is JFLAP's lambda.
  const enfa = `<structure><type>fa</type><automaton>
    <state id="0" name="q0"><initial/></state>
    <state id="1" name="q1"><final/></state>
    <transition><from>0</from><to>1</to><read/></transition>
  </automaton></structure>`;
  const parsed = context.jflapToWorkspace(context.jflapParseXML(enfa));
  assert.equal(parsed.machine, 'ε-NFA');
  assert.equal(parsed.transitions[0].symbol, 'ε');
  // ε is not a member of Σ.
  deepEq(parsed.sigma, []);
});

test('JFLAP pushdown import keeps pop/push and seeds the stack alphabet', () => {
  reset();
  const jff = `<structure><type>pda</type><automaton>
    <state id="0" name="q0"><initial/><final/></state>
    <transition><from>0</from><to>0</to><read>a</read><pop>Z</pop><push>AZ</push></transition>
  </automaton></structure>`;
  const data = context.jflapToWorkspace(context.jflapParseXML(jff));

  assert.equal(data.machine, 'DPDA');
  assert.equal(data.transitions[0].pop, 'Z');
  assert.equal(data.transitions[0].push, 'AZ');
  assert.ok(data.stackAlpha.includes('A'));
  assert.ok(data.stackAlpha.includes('Z'));
});

test('JFLAP Turing import keeps write and move', () => {
  reset();
  const jff = `<structure><type>turing</type><automaton>
    <state id="0" name="q0"><initial/></state>
    <state id="1" name="q1"><final/></state>
    <transition><from>0</from><to>1</to><read>a</read><write>b</write><move>R</move></transition>
  </automaton></structure>`;
  const data = context.jflapToWorkspace(context.jflapParseXML(jff));

  assert.equal(data.machine, 'TM');
  assert.equal(data.transitions[0].symbol, 'a');
  assert.equal(data.transitions[0].write, 'b');
  assert.equal(data.transitions[0].dir, 'R');
});

test('JFLAP Moore import carries per-state output', () => {
  reset();
  const jff = `<structure><type>moore</type><automaton>
    <state id="0" name="q0"><initial/><output>OPEN</output></state>
    <transition><from>0</from><to>0</to><read>a</read></transition>
  </automaton></structure>`;
  const data = context.jflapToWorkspace(context.jflapParseXML(jff));

  assert.equal(data.machine, 'Moore');
  assert.equal(data.states[0].output, 'OPEN');
  assert.ok(data.outputAlpha.includes('OPEN'));
});

test('JFLAP import decodes XML entities in names', () => {
  reset();
  const jff = `<structure><type>fa</type><automaton>
    <state id="0" name="a&amp;b"><initial/><final/></state>
    <transition><from>0</from><to>0</to><read>&lt;</read></transition>
  </automaton></structure>`;
  const data = context.jflapToWorkspace(context.jflapParseXML(jff));
  assert.equal(data.states[0].name, 'a&b');
  assert.equal(data.transitions[0].symbol, '<');
});

test('JFLAP import rejects files it cannot honestly convert', () => {
  reset();
  assert.throws(() => context.jflapToWorkspace(context.jflapParseXML('<html><body>no</body></html>')),
    /no <structure> element/);

  assert.throws(() => context.jflapToWorkspace(context.jflapParseXML(
    '<structure><type>grammar</type><production/></structure>')),
    /grammar files are not supported/);

  // A dangling transition endpoint would otherwise import a broken machine.
  assert.throws(() => context.jflapToWorkspace(context.jflapParseXML(
    `<structure><type>fa</type><automaton>
       <state id="0" name="q0"><initial/></state>
       <transition><from>0</from><to>99</to><read>a</read></transition>
     </automaton></structure>`)),
    /state that is not in the file/);
});

// ══════════════════════════════════════════════════════════════════
//  EXPORT DIALOG WIRING
// ══════════════════════════════════════════════════════════════════
test('every declared format builds a non-empty string for a plain DFA', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();

  Object.entries(context.ExportFormats).forEach(([key, spec]) => {
    if (spec.available && !spec.available()) return; // batch needs a prior run
    const opts = {};
    (spec.options || []).forEach(o => { opts[o.id] = o.def; });
    const out = spec.build(ir, opts);
    assert.equal(typeof out, 'string', `${key} must emit a string`);
    assert.ok(out.length > 0, `${key} emitted nothing`);
  });
});

test('the batch format stays unavailable until a batch has been run', () => {
  reset();
  endsIn01();
  App.lastBatch = null;
  assert.equal(context.ExportFormats.batch.available(), false);

  App.lastBatch = context.computeBatchResults(['01 => accept']);
  assert.equal(context.ExportFormats.batch.available(), true);
});

test('the sample narrowing options reach build() from the dialog', () => {
  reset();
  endsIn01();
  context.selectExportFormat('samples', true);
  const ui = context.ExportUI;
  // Defaults must leave the format as it was before the options existed.
  assert.equal(ui.opts.minLength, 0);
  assert.equal(ui.opts.expandLoops, true);

  context.setExportCodeOpt('minLength', '4', 'number');
  context.setExportCodeOpt('expandLoops', false, 'check');
  assert.equal(ui.opts.minLength, 4, 'the spinner must store a number, not a string');
  assert.equal(ui.opts.expandLoops, false);

  const csv = context.ExportFormats.samples.build(context.buildMachineIR(), ui.opts);
  const words = csv.split('\r\n').slice(1).filter(Boolean).map(r => r.split(',')[0]);
  assert.ok(words.length > 0);
  words.forEach(w => assert.ok(w.length >= 4, `${w} slipped under the min length`));
  assert.ok(!words.includes('0101'), 'the cleared checkbox must reach the search');
});

test('selecting a format resets its options to declared defaults', () => {
  reset();
  endsIn01();
  context.selectExportFormat('tikz', true);
  const ui = context.ExportUI;
  assert.equal(ui.format, 'tikz');
  assert.equal(ui.opts.standalone, false);
  assert.equal(ui.opts.mergeParallel, true);
});

test('filename extension follows the chosen sub-format', () => {
  reset();
  endsIn01();
  context.selectExportFormat('samples', true);
  const ui = context.ExportUI;
  ui.opts.format = 'json';
  assert.match(context.exportCodeFilename(), /\.json$/);
  ui.opts.format = 'batch';
  assert.match(context.exportCodeFilename(), /\.txt$/);
});
