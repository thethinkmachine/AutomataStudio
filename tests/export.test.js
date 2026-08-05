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
