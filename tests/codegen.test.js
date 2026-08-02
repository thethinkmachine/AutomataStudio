const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createHarness } = require('./harness');

// Code generation.
//
// The load-bearing tests here are differential: the generated JavaScript is
// executed and checked against the app's own simulator over every word up to
// a given length. A recogniser that merely *looks* right is worthless — the
// only claim worth making is that it decides the same language the canvas
// does, and that is a claim you can run.
//
// The other theme is refusal. Code generation covers the models whose runtime
// semantics translate faithfully; for the rest it must emit an explanation,
// never a plausible-looking approximation.

const harness = createHarness();
const { context } = harness;
const App = context.App;

function reset() { harness.resetApp(); }
const inVM = expr => harness.evalInContext(expr);

// ── builders ──────────────────────────────────────────────────────
function fa({ sigma, states, start, accepts, edges, machine = 'DFA' }) {
  App.machine = machine;
  App.sigma = new Set(sigma);
  App.states = states.map((n, i) => ({ id: 's' + i, name: n, x: i * 90, y: 0 }));
  const id = n => App.states.find(s => s.name === n).id;
  App.transitions = edges.map(([f, sym, t, out], i) => {
    const tr = { id: 'e' + i, from: id(f), to: id(t), symbol: sym };
    if (out !== undefined) tr.output = out;
    return tr;
  });
  App.startId = id(start);
  App.accepts = new Set(accepts.map(id));
  App.stateN = states.length;
  App.transN = edges.length;
  return id;
}

function endsIn01() {
  return fa({
    sigma: ['0', '1'],
    states: ['q0', 'q1', 'q2'], start: 'q0', accepts: ['q2'],
    edges: [
      ['q0', '0', 'q1'], ['q0', '1', 'q0'],
      ['q1', '0', 'q1'], ['q1', '1', 'q2'],
      ['q2', '0', 'q1'], ['q2', '1', 'q0']
    ]
  });
}

// Every word over `sigma` up to `maxLen`, shortest first.
function* allWords(sigma, maxLen) {
  let frontier = [[]];
  for (let len = 0; len <= maxLen; len++) {
    for (const w of frontier) yield w;
    const next = [];
    for (const w of frontier) for (const s of sigma) next.push(w.concat([s]));
    frontier = next;
  }
}

// Refusal messages are emitted as wrapped comments, so a phrase can land
// across two lines. Strip the comment markers and collapse whitespace before
// matching, or the assertions become hostage to the wrap column.
const unwrap = s => s
  .replace(/^\s*(\/\/|#|\/\*|<!--)\s?/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

// Runs generated CommonJS source and hands back its exports.
function runJS(src) {
  const sandbox = { module: { exports: {} }, console, Set, Map, Array, JSON };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'generated.js' });
  return sandbox.module.exports;
}

// Asserts the generated recogniser agrees with the simulator everywhere.
function assertAgrees(sigma, maxLen, label, style) {
  const ir = context.buildMachineIR();
  const src = context.codegenJavaScript(ir, style ? { style } : {});
  const { accepts } = runJS(src);
  assert.equal(typeof accepts, 'function', `${label}: no accepts() exported`);

  let checked = 0;
  for (const word of allWords(sigma, maxLen)) {
    const expected = context.langVerdict(word) === 'acc';
    const actual = accepts(word.join(''));
    assert.equal(actual, expected,
      `${label}: disagreement on "${word.join('') || 'ε'}" — simulator ${expected}, generated ${actual}`);
    checked++;
  }
  return checked;
}

// ══════════════════════════════════════════════════════════════════
//  DIFFERENTIAL: GENERATED CODE vs SIMULATOR
// ══════════════════════════════════════════════════════════════════
test('generated DFA recogniser matches the simulator on every word to length 10', () => {
  reset();
  endsIn01();
  const n = assertAgrees(['0', '1'], 10, 'DFA');
  assert.ok(n > 2000, `expected a broad sweep, checked ${n}`);
});

test('generated NFA recogniser matches the simulator (subset simulation)', () => {
  reset();
  // Classic: the third symbol from the end is 'a'.
  fa({
    machine: 'NFA',
    sigma: ['a', 'b'],
    states: ['q0', 'q1', 'q2', 'q3'], start: 'q0', accepts: ['q3'],
    edges: [
      ['q0', 'a', 'q0'], ['q0', 'b', 'q0'], ['q0', 'a', 'q1'],
      ['q1', 'a', 'q2'], ['q1', 'b', 'q2'],
      ['q2', 'a', 'q3'], ['q2', 'b', 'q3']
    ]
  });
  assertAgrees(['a', 'b'], 9, 'NFA');
});

test('generated ε-NFA recogniser matches the simulator (ε-closure)', () => {
  reset();
  // a* then b*, joined by an ε edge.
  fa({
    machine: 'ε-NFA',
    sigma: ['a', 'b'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q0'], ['q0', 'ε', 'q1'], ['q1', 'b', 'q1']]
  });
  assertAgrees(['a', 'b'], 9, 'ε-NFA');
});

test('generated recogniser handles a word-length alphabet', () => {
  reset();
  fa({
    sigma: ['open', 'close'],
    states: ['idle', 'busy'], start: 'idle', accepts: ['idle'],
    edges: [['idle', 'open', 'busy'], ['busy', 'close', 'idle']]
  });
  const { accepts } = runJS(context.codegenJavaScript(context.buildMachineIR()));
  // Multi-character symbols must be split on whitespace, not per character.
  assert.equal(accepts('open close'), true);
  assert.equal(accepts('open'), false);
  assert.equal(accepts('open close open close'), true);
  assert.equal(accepts(''), true);
});

test('generated Mealy transducer matches the simulator output', () => {
  reset();
  fa({
    machine: 'Mealy',
    sigma: ['0', '1'],
    states: ['even', 'odd'], start: 'even', accepts: [],
    edges: [
      ['even', '0', 'even', 'E'], ['even', '1', 'odd', 'O'],
      ['odd', '0', 'odd', 'O'], ['odd', '1', 'even', 'E']
    ]
  });
  App.outputAlpha = new Set(['E', 'O']);
  const { transduce } = runJS(context.codegenJavaScript(context.buildMachineIR()));

  for (const word of allWords(['0', '1'], 8)) {
    assert.equal(transduce(word.join('')), context.getMealyOutput(word),
      `Mealy disagreement on "${word.join('') || 'ε'}"`);
  }
});

test('generated Moore transducer matches the simulator output', () => {
  reset();
  fa({
    machine: 'Moore',
    sigma: ['0', '1'],
    states: ['a', 'b'], start: 'a', accepts: [],
    edges: [['a', '0', 'a'], ['a', '1', 'b'], ['b', '0', 'b'], ['b', '1', 'a']]
  });
  App.states[0].output = 'X';
  App.states[1].output = 'Y';
  App.outputAlpha = new Set(['X', 'Y']);
  const { transduce } = runJS(context.codegenJavaScript(context.buildMachineIR()));

  for (const word of allWords(['0', '1'], 8)) {
    assert.equal(transduce(word.join('')), context.getMooreOutput(word),
      `Moore disagreement on "${word.join('') || 'ε'}"`);
  }
});

test('generated code survives a state name that would break a string literal', () => {
  reset();
  fa({
    sigma: ['a'],
    states: ['say "hi"\\x', 'end'], start: 'say "hi"\\x', accepts: ['end'],
    edges: [['say "hi"\\x', 'a', 'end']]
  });
  const { accepts } = runJS(context.codegenJavaScript(context.buildMachineIR()));
  assert.equal(accepts('a'), true);
  assert.equal(accepts('aa'), false);
});

// ══════════════════════════════════════════════════════════════════
//  REFUSALS
// ══════════════════════════════════════════════════════════════════
test('stack and tape machines are refused, not approximated', () => {
  for (const machine of ['DPDA', 'NPDA', 'TM', 'NDTM', 'QA', '2PDA', 'LBA']) {
    reset();
    App.machine = machine;
    App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }];
    App.startId = 's0';
    App.accepts = new Set(['s0']);
    App.transitions = [];

    const ir = context.buildMachineIR();
    assert.equal(context.codegenSupport(ir).ok, false, `${machine} must be refused`);

    const js = context.codegenJavaScript(ir);
    assert.match(js, /Cannot generate code/, `${machine} should explain itself`);
    // The refusal must not smuggle out something runnable-looking.
    assert.doesNotMatch(js, /function accepts/, `${machine} emitted a recogniser anyway`);
  }
});

test('unsupported C and SCXML output uses closed block comments', () => {
  reset();
  App.machine = 'TM';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }];
  App.startId = 's0';
  App.accepts = new Set(['s0']);
  App.transitions = [];
  const ir = context.buildMachineIR();

  const c = context.codegenC(ir);
  assert.match(c, /^\/\*[\s\S]*\*\/$/);

  const scxml = context.codegenSCXML(ir);
  assert.match(scxml, /^<!--[\s\S]*-->$/);
});
test('an empty canvas and a machine with no start state are both refused', () => {
  reset();
  assert.equal(context.codegenSupport(context.buildMachineIR()).ok, false);

  reset();
  fa({ sigma: ['a'], states: ['q0'], start: 'q0', accepts: ['q0'], edges: [] });
  App.startId = null;
  const s = context.codegenSupport(context.buildMachineIR());
  assert.equal(s.ok, false);
  assert.match(s.reason, /no start state/);
});

// ══════════════════════════════════════════════════════════════════
//  C
// ══════════════════════════════════════════════════════════════════
test('C emits a dense transition table with -1 for dead edges', () => {
  reset();
  endsIn01();
  const c = context.codegenC(context.buildMachineIR());

  assert.match(c, /#include <stdbool\.h>/);
  assert.match(c, /#define STATE_COUNT 3/);
  assert.match(c, /#define SYMBOL_COUNT 2/);
  assert.match(c, /static const int DELTA\[STATE_COUNT\]\[SYMBOL_COUNT\]/);
  assert.match(c, /bool automaton_accepts\(const char \*input\)/);

  // q0 --0--> q1 (index 1), q0 --1--> q0 (index 0); symbols sort to ['0','1'].
  const rows = [...c.matchAll(/\{\s*(-?\d+),\s*(-?\d+)\},/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(rows[0], [1, 0]);
  assert.deepEqual(rows[1], [1, 2]);
  assert.deepEqual(rows[2], [1, 0]);
});

test('C escapes quotes, backslashes, and ASCII control symbols', () => {
  reset();
  fa({
    sigma: ["'", '\\', '\n', '\t', '\0', '\x1f'],
    states: ['q0'], start: 'q0', accepts: ['q0'],
    edges: []
  });
  const c = context.codegenC(context.buildMachineIR());
  assert.ok(c.includes("'\\''"), 'apostrophe should use a C quote escape');
  assert.ok(c.includes("'\\\\'"), 'backslash should use a C slash escape');
  assert.ok(c.includes("'\\n'"));
  assert.ok(c.includes("'\\t'"));
  assert.ok(c.includes("'\\0'"));
  assert.ok(c.includes("'\\x1f'"));
});
test('C marks a missing transition as dead rather than inventing one', () => {
  reset();
  fa({
    sigma: ['a', 'b'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q1']] // nothing on 'b', nothing out of q1
  });
  const c = context.codegenC(context.buildMachineIR());
  const rows = [...c.matchAll(/\{\s*(-?\d+),\s*(-?\d+)\},/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(rows[0], [1, -1]);
  assert.deepEqual(rows[1], [-1, -1]);
});

test('C declines nondeterminism and multi-byte alphabets', () => {
  reset();
  fa({
    machine: 'NFA', sigma: ['a'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q0'], ['q0', 'a', 'q1']]
  });
  assert.match(unwrap(context.codegenC(context.buildMachineIR())), /deterministic finite automata only/);

  reset();
  fa({
    sigma: ['open', 'close'],
    states: ['q0'], start: 'q0', accepts: ['q0'],
    edges: [['q0', 'open', 'q0']]
  });
  assert.match(unwrap(context.codegenC(context.buildMachineIR())), /single ASCII character/);
});

// ══════════════════════════════════════════════════════════════════
//  XSTATE / SCXML
// ══════════════════════════════════════════════════════════════════
test('XState config keeps accepting as metadata, not a final state', () => {
  reset();
  endsIn01();
  const src = context.codegenXState(context.buildMachineIR());
  // Anchor on the assignment: the banner above it mentions Σ = {0, 1}, so the
  // first `{` in the file is not the start of the config.
  const start = src.indexOf('=', src.indexOf('export const machine')) + 1;
  const json = JSON.parse(src.slice(start, src.lastIndexOf('}') + 1));

  assert.equal(json.initial, 'q0');
  assert.equal(json.states.q0.on['0'], 'q1');
  assert.equal(json.states.q0.on['1'], 'q0');
  assert.equal(json.states.q2.meta.accepting, true);
  // `final` would halt the machine; an accepting state can still be left.
  assert.equal(json.states.q2.type, undefined);
  assert.equal(json.states.q0.meta, undefined);
});

test('XState declines a nondeterministic machine and says how to fix it', () => {
  reset();
  fa({
    machine: 'NFA', sigma: ['a'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', 'a', 'q0'], ['q0', 'a', 'q1']]
  });
  const src = context.codegenXState(context.buildMachineIR());
  assert.match(src, /nondeterministic/);
  assert.match(src, /subset construction/);
});

test('SCXML emits transitions per state and escapes attributes', () => {
  reset();
  fa({
    sigma: ['<', '&'],
    states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
    edges: [['q0', '<', 'q1'], ['q1', '&', 'q0']]
  });
  const xml = context.codegenSCXML(context.buildMachineIR());

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<scxml [^>]*initial="q0"/);
  assert.match(xml, /event="&lt;"/);
  assert.match(xml, /event="&amp;"/);
  assert.match(xml, /<\/scxml>$/);
  // Accepting states remain <state>; <final> would end the run.
  assert.doesNotMatch(xml, /<final/);
  assert.match(xml, /<data id="accepting" expr="true"\/>/);

  // Every opened state element is closed.
  const opens = (xml.match(/<state [^/>]*>/g) || []).length;
  const closes = (xml.match(/<\/state>/g) || []).length;
  assert.equal(opens, closes);
});

// ══════════════════════════════════════════════════════════════════
//  TEST-SUITE GENERATION
// ══════════════════════════════════════════════════════════════════
test('Jest suite asserts membership using words drawn from the machine', () => {
  reset();
  endsIn01();
  const src = context.codegenJest(context.buildMachineIR(), { accepted: 5, rejected: 5, maxLength: 6 });

  assert.match(src, /require\("\.\/automaton"\)/);
  assert.match(src, /expect\(accepts\(word\)\)\.toBe\(true\)/);
  assert.match(src, /expect\(accepts\(word\)\)\.toBe\(false\)/);

  // Words asserted as accepted must genuinely be in L(M).
  const block = src.slice(src.indexOf('accepts %j') - 400, src.indexOf('accepts %j'));
  [...block.matchAll(/"([01]*)"/g)].forEach(m => {
    assert.match(m[1], /01$/, `"${m[1]}" was asserted accepted but is not in L(M)`);
  });
});

test('generated Jest cases actually pass against the generated JavaScript', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();
  const { accepts } = runJS(context.codegenJavaScript(ir));
  const src = context.codegenJest(ir, { accepted: 8, rejected: 8, maxLength: 7 });

  // Pull the two case lists back out and run them through the recogniser —
  // the suite and the source are generated from the same machine, so a
  // disagreement here means one of the two emitters is wrong.
  const sections = src.split('test.each');
  assert.equal(sections.length, 3, 'expected an accept block and a reject block');
  const words = s => [...s.matchAll(/^\s+"([^"]*)",$/gm)].map(m => m[1]);
  words(sections[1]).forEach(w => assert.equal(accepts(w), true, `accept case "${w}" failed`));
  words(sections[2]).forEach(w => assert.equal(accepts(w), false, `reject case "${w}" failed`));
});

test('pytest suite is importable-looking and parametrised', () => {
  reset();
  endsIn01();
  const src = context.codegenPytest(context.buildMachineIR(), { accepted: 4, rejected: 4, maxLength: 6 });

  assert.match(src, /^import pytest$/m);
  assert.match(src, /^from automaton import accepts$/m);
  assert.match(src, /@pytest\.mark\.parametrize\('word', \[/);
  assert.match(src, /assert accepts\(word\) is True/);
  assert.match(src, /assert accepts\(word\) is False/);
  // `from ./automaton.py import` would not be valid Python.
  assert.doesNotMatch(src, /from \.\//);
});

test('test generation is refused for a transducer with no accept notion', () => {
  reset();
  fa({
    machine: 'Moore', sigma: ['0'],
    states: ['a'], start: 'a', accepts: [], edges: [['a', '0', 'a']]
  });
  App.config.transducerAccepts = false;
  assert.match(unwrap(context.codegenJest(context.buildMachineIR(), {})), /no accept\/reject notion/);
  assert.match(unwrap(context.codegenPytest(context.buildMachineIR(), {})), /no accept\/reject notion/);
});

// ══════════════════════════════════════════════════════════════════
//  REGISTRY
// ══════════════════════════════════════════════════════════════════
test('code and test formats are registered in the export dialog', () => {
  const formats = inVM('ExportFormats');
  ['code-js', 'code-py', 'code-java', 'code-c', 'code-xstate', 'code-scxml', 'test-jest', 'test-pytest']
    .forEach(k => assert.ok(formats[k], `${k} is not registered`));

  assert.equal(formats['code-js'].group, 'Code');
  assert.equal(formats['test-jest'].group, 'Tests');
  // Tier 1's formats must survive the extension.
  assert.ok(formats.dot, 'dot was clobbered');
  assert.ok(formats.samples, 'samples was clobbered');
});

test('every registered format emits a string for a supported machine', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();
  Object.entries(inVM('ExportFormats')).forEach(([key, spec]) => {
    if (spec.available && !spec.available()) return;
    const opts = {};
    (spec.options || []).forEach(o => { opts[o.id] = o.def; });
    const out = spec.build(ir, opts);
    assert.equal(typeof out, 'string', `${key} must emit a string`);
    assert.ok(out.trim().length > 0, `${key} emitted nothing`);
  });
});

test('every registered format degrades gracefully on an unsupported machine', () => {
  reset();
  App.machine = 'TM';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['⊔']);
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }];
  App.startId = 's0';
  App.accepts = new Set(['s0']);
  App.transitions = [{ id: 'e0', from: 's0', to: 's0', symbol: 'a', write: 'a', dir: 'R' }];

  const ir = context.buildMachineIR();
  Object.entries(inVM('ExportFormats')).forEach(([key, spec]) => {
    if (spec.available && !spec.available()) return;
    const opts = {};
    (spec.options || []).forEach(o => { opts[o.id] = o.def; });
    // No emitter may throw: a Turing machine still exports as DOT, TikZ and
    // a transition list, and the code targets explain why they cannot.
    const out = spec.build(ir, opts);
    assert.equal(typeof out, 'string', `${key} threw or returned non-string`);
  });
});

test('Java class name is sanitised into a legal identifier', () => {
  reset();
  endsIn01();
  const src = context.codegenJava(context.buildMachineIR(), { className: '2 my class!' });
  assert.match(src, /public final class _2_my_class_/);
  assert.match(src, /^import java\.util\.\*;$/m);
});

test('Python output is syntactically plausible and uses the right containers', () => {
  reset();
  endsIn01();
  const src = context.codegenPython(context.buildMachineIR());
  assert.match(src, /^DELTA = \{$/m);
  assert.match(src, /^START = 'q0'$/m);
  assert.match(src, /^ACCEPTING = frozenset\(\{'q2'\}\)$/m);
  assert.match(src, /^def accepts\(text\):$/m);
  // Tabs would be a syntax error mixed with the 4-space indentation used here.
  assert.doesNotMatch(src, /\t/);
});
