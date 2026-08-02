const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createHarness } = require('./harness');

// Output styles: table / switch / class.
//
// Style changes the shape of the generated source, never the language it
// decides. The sweep in the first section is the guarantee: every supported
// model, in every style, is executed and checked against the app's own
// simulator across the whole of Σ* up to a fixed length. A switch emitter
// that forgot a `default`, or a class whose reset() leaked state between
// runs, fails there rather than shipping.
//
// Python, Java and C cannot be executed here (no interpreter, JDK or C
// toolchain in this environment), so those are asserted structurally — with
// the assertions aimed at the mistakes each style actually invites: a bare
// name in a Python `match` case, static instead of instance fields in a Java
// class, a C dead-state that re-enters the table at -1.

const harness = createHarness();
const { context } = harness;
const App = context.App;

function reset() { harness.resetApp(); }
const inVM = expr => harness.evalInContext(expr);

const unwrap = s => s
  .replace(/^\s*(\/\/|#|\/\*|<!--)\s?/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

// Values built inside the VM carry that realm's prototypes, so
// assert/strict's deepEqual rejects them against literals declared here.
const plain = v => JSON.parse(JSON.stringify(v));
const deepEq = (actual, expected, msg) => assert.deepEqual(plain(actual), expected, msg);

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
}

function endsIn01() {
  fa({
    sigma: ['0', '1'],
    states: ['q0', 'q1', 'q2'], start: 'q0', accepts: ['q2'],
    edges: [
      ['q0', '0', 'q1'], ['q0', '1', 'q0'],
      ['q1', '0', 'q1'], ['q1', '1', 'q2'],
      ['q2', '0', 'q1'], ['q2', '1', 'q0']
    ]
  });
}

function buildMealy() {
  fa({
    machine: 'Mealy', sigma: ['0', '1'],
    states: ['even', 'odd'], start: 'even', accepts: [],
    edges: [
      ['even', '0', 'even', 'E'], ['even', '1', 'odd', 'O'],
      ['odd', '0', 'odd', 'O'], ['odd', '1', 'even', 'E']
    ]
  });
  App.outputAlpha = new Set(['E', 'O']);
}

function buildMoore() {
  fa({
    machine: 'Moore', sigma: ['0', '1'],
    states: ['a', 'b'], start: 'a', accepts: [],
    edges: [['a', '0', 'a'], ['a', '1', 'b'], ['b', '0', 'b'], ['b', '1', 'a']]
  });
  App.states[0].output = 'X';
  App.states[1].output = 'Y';
  App.outputAlpha = new Set(['X', 'Y']);
}

// One entry per model the sweep covers.
const SWEEP = {
  DFA: { sigma: ['0', '1'], build: endsIn01 },
  NFA: {
    sigma: ['a', 'b'],
    // Classic: the third symbol from the end is 'a'.
    build: () => fa({
      machine: 'NFA', sigma: ['a', 'b'],
      states: ['q0', 'q1', 'q2', 'q3'], start: 'q0', accepts: ['q3'],
      edges: [
        ['q0', 'a', 'q0'], ['q0', 'b', 'q0'], ['q0', 'a', 'q1'],
        ['q1', 'a', 'q2'], ['q1', 'b', 'q2'],
        ['q2', 'a', 'q3'], ['q2', 'b', 'q3']
      ]
    })
  },
  'ε-NFA': {
    sigma: ['a', 'b'],
    build: () => fa({
      machine: 'ε-NFA', sigma: ['a', 'b'],
      states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
      edges: [['q0', 'a', 'q0'], ['q0', 'ε', 'q1'], ['q1', 'b', 'q1']]
    })
  }
};

const STYLES = ['table', 'switch', 'class'];

function* allWords(sigma, maxLen) {
  let frontier = [[]];
  for (let len = 0; len <= maxLen; len++) {
    for (const w of frontier) yield w;
    const next = [];
    for (const w of frontier) for (const s of sigma) next.push(w.concat([s]));
    frontier = next;
  }
}

function runJS(src) {
  const sandbox = { module: { exports: {} }, console, Set, Map, Array, JSON };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'generated.js' });
  return sandbox.module.exports;
}

// ══════════════════════════════════════════════════════════════════
//  THE SWEEP
// ══════════════════════════════════════════════════════════════════
for (const [model, spec] of Object.entries(SWEEP)) {
  for (const style of STYLES) {
    test(`${model} in ${style} style decides the same language as the simulator`, () => {
      reset();
      spec.build();
      const src = context.codegenJavaScript(context.buildMachineIR(), { style });
      const { accepts } = runJS(src);
      assert.equal(typeof accepts, 'function', 'no accepts() exported');

      let checked = 0;
      for (const word of allWords(spec.sigma, 8)) {
        const expected = context.langVerdict(word) === 'acc';
        const actual = accepts(word.join(''));
        assert.equal(actual, expected,
          `${model}/${style} disagreement on "${word.join('') || 'ε'}" — simulator ${expected}, generated ${actual}`);
        checked++;
      }
      assert.ok(checked > 500, `expected a broad sweep, checked ${checked}`);
    });
  }
}

for (const style of STYLES) {
  test(`Mealy in ${style} style emits the same output as the simulator`, () => {
    reset();
    buildMealy();
    const { transduce } = runJS(context.codegenJavaScript(context.buildMachineIR(), { style }));
    for (const word of allWords(['0', '1'], 8)) {
      assert.equal(transduce(word.join('')), context.getMealyOutput(word),
        `Mealy/${style} disagreement on "${word.join('') || 'ε'}"`);
    }
  });

  test(`Moore in ${style} style emits the same output as the simulator`, () => {
    reset();
    buildMoore();
    const { transduce } = runJS(context.codegenJavaScript(context.buildMachineIR(), { style }));
    for (const word of allWords(['0', '1'], 8)) {
      assert.equal(transduce(word.join('')), context.getMooreOutput(word),
        `Moore/${style} disagreement on "${word.join('') || 'ε'}"`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════
//  STYLE SELECTION
// ══════════════════════════════════════════════════════════════════
test('an unknown or missing style falls back to the table', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();
  const table = context.codegenJavaScript(ir, { style: 'table' });
  assert.equal(context.codegenJavaScript(ir, {}), table);
  assert.equal(context.codegenJavaScript(ir, { style: 'nonsense' }), table);
  assert.equal(context.codegenStyle({ style: 'switch' }), 'switch');
  assert.equal(context.codegenStyle({}), 'table');
});

// ══════════════════════════════════════════════════════════════════
//  JAVASCRIPT
// ══════════════════════════════════════════════════════════════════
test('switch style emits no transition table at all', () => {
  reset();
  endsIn01();
  const src = context.codegenJavaScript(context.buildMachineIR(), { style: 'switch' });
  // The whole point of the style: δ is control flow, so no data literal
  // and no accepting-set literal should survive.
  assert.doesNotMatch(src, /const DELTA/);
  assert.doesNotMatch(src, /new Set\(\[/);
  assert.match(src, /switch \(state\)/);
  assert.match(src, /switch \(symbol\)/);
  assert.match(src, /function isAccepting\(state\)/);
});

test('class style exposes incremental stepping and resets cleanly', () => {
  reset();
  endsIn01();
  const { Automaton, accepts } = runJS(context.codegenJavaScript(context.buildMachineIR(), { style: 'class' }));
  assert.equal(typeof Automaton, 'function');

  const m = new Automaton();
  // "01" is in L(M); feeding it a symbol at a time must agree.
  assert.equal(m.step('0'), true);
  assert.equal(m.isAccepting, false);
  assert.equal(m.step('1'), true);
  assert.equal(m.isAccepting, true);

  // A reused instance must not carry the previous run's state.
  m.reset();
  assert.equal(m.isAccepting, false);
  assert.equal(m.accepts('11'), false);
  assert.equal(m.accepts('01'), true);
  assert.equal(m.accepts('11'), false);

  // The module-level wrapper is kept so a generated test suite works
  // against whichever style was chosen.
  assert.equal(accepts('01'), true);
  assert.equal(accepts('11'), false);
});

test('class style tracks the live subset for a nondeterministic machine', () => {
  reset();
  SWEEP['ε-NFA'].build();
  const { Automaton } = runJS(context.codegenJavaScript(context.buildMachineIR(), { style: 'class' }));
  const m = new Automaton();
  // The ε edge means the start configuration already spans both states.
  assert.deepEqual([...m.states].sort(), ['q0', 'q1']);
  assert.equal(m.isAccepting, true);
});

test('Mealy class style reports each emitted symbol from step()', () => {
  reset();
  buildMealy();
  const { Automaton } = runJS(context.codegenJavaScript(context.buildMachineIR(), { style: 'class' }));
  const m = new Automaton();
  assert.equal(m.step('1'), 'O');
  assert.equal(m.step('1'), 'E');
  assert.equal(m.transduce('11'), 'OE');
});

// ══════════════════════════════════════════════════════════════════
//  PYTHON
// ══════════════════════════════════════════════════════════════════
test('Python match style uses string-literal patterns, never bare names', () => {
  reset();
  endsIn01();
  const src = context.codegenPython(context.buildMachineIR(), { style: 'switch' });

  assert.match(src, /Requires Python 3\.10\+/);
  assert.match(src, /^    match state:$/m);
  assert.match(src, /case '0':/);
  assert.match(src, /case _:/);
  assert.doesNotMatch(src, /^DELTA = \{$/m);
  // A bare name in a case is a capture pattern: it matches anything and
  // binds, silently turning every state into an unconditional branch.
  assert.doesNotMatch(src, /case [A-Za-z][A-Za-z0-9_]*:/);
});

test('Python class style defines the class and keeps a module-level accepts()', () => {
  reset();
  endsIn01();
  const src = context.codegenPython(context.buildMachineIR(), { style: 'class' });

  assert.match(src, /^class Automaton:$/m);
  assert.match(src, /^    def reset\(self\):$/m);
  assert.match(src, /^    def step\(self, symbol\):$/m);
  assert.match(src, /^    @property$/m);
  assert.match(src, /^    def is_accepting\(self\):$/m);
  // Kept so a generated pytest suite imports the same name for any style.
  assert.match(src, /^def accepts\(text\):$/m);
  assert.doesNotMatch(src, /\t/);
});

// ══════════════════════════════════════════════════════════════════
//  JAVA
// ══════════════════════════════════════════════════════════════════
test('Java switch style switches on the state name and drops the table', () => {
  reset();
  endsIn01();
  const src = context.codegenJava(context.buildMachineIR(), { style: 'switch' });

  assert.match(src, /switch \(state\) \{/);
  assert.match(src, /case "q0":/);
  assert.match(src, /private static boolean isAccepting\(String state\)/);
  assert.doesNotMatch(src, /Map<String, Map<String/);
  assert.doesNotMatch(src, /static \{/);
});

test('Java class style has instance state plus a static accepts()', () => {
  reset();
  endsIn01();
  const src = context.codegenJava(context.buildMachineIR(), { style: 'class', className: 'Recogniser' });

  assert.match(src, /public final class Recogniser \{/);
  assert.match(src, /public Recogniser\(\) \{/);
  assert.match(src, /public Recogniser reset\(\) \{/);
  assert.match(src, /public boolean step\(String symbol\) \{/);
  assert.match(src, /public boolean isAccepting\(\) \{/);
  assert.match(src, /public static boolean accepts\(String input\) \{/);
  assert.match(src, /return new Recogniser\(\)\.run\(input\);/);
  // Instance, not static: two machines must not share a current state.
  assert.match(src, /^    private String state;$/m);
});

// ══════════════════════════════════════════════════════════════════
//  C
// ══════════════════════════════════════════════════════════════════
test('C switch style emits nested switches and no arrays', () => {
  reset();
  endsIn01();
  const src = context.codegenC(context.buildMachineIR(), { style: 'switch' });

  assert.match(src, /enum \{/);
  assert.match(src, /^    Q0 = 0,$/m);
  assert.match(src, /switch \(state\) \{/);
  assert.match(src, /case '0': state = Q1; break;/);
  assert.match(src, /default: return false;/);
  assert.doesNotMatch(src, /DELTA\[/);
  assert.doesNotMatch(src, /SYMBOLS\[/);
});

test('C struct style exposes reset/step/is_accepting over an owned handle', () => {
  reset();
  endsIn01();
  const src = context.codegenC(context.buildMachineIR(), { style: 'class' });

  assert.match(src, /typedef struct \{/);
  assert.match(src, /\} automaton_t;/);
  assert.match(src, /void automaton_reset\(automaton_t \*m\)/);
  assert.match(src, /bool automaton_step\(automaton_t \*m, char c\)/);
  assert.match(src, /bool automaton_is_accepting\(const automaton_t \*m\)/);
  assert.match(src, /bool automaton_accepts\(const char \*input\)/);
  assert.match(unwrap(src), /C has no classes/);
  // A dead run must stay dead rather than indexing the table at -1.
  assert.match(src, /if \(m->state < 0\) return false;/);
});

test('C still refuses non-DFA machines in every style', () => {
  for (const style of STYLES) {
    reset();
    fa({
      machine: 'NFA', sigma: ['a'],
      states: ['q0', 'q1'], start: 'q0', accepts: ['q1'],
      edges: [['q0', 'a', 'q0'], ['q0', 'a', 'q1']]
    });
    const src = context.codegenC(context.buildMachineIR(), { style });
    assert.match(unwrap(src), /deterministic finite automata only/, `C/${style} should refuse`);
    assert.doesNotMatch(src, /automaton_step/, `C/${style} emitted code anyway`);
  }
});

// ══════════════════════════════════════════════════════════════════
//  REGISTRY
// ══════════════════════════════════════════════════════════════════
test('each language target offers the style option', () => {
  const formats = inVM('ExportFormats');
  for (const key of ['code-js', 'code-py', 'code-java', 'code-c']) {
    const style = (formats[key].options || []).find(o => o.id === 'style');
    assert.ok(style, `${key} has no style option`);
    assert.equal(style.def, 'table');
    deepEq(style.choices.map(c => c[0]), STYLES);
  }
  // Labels follow each language's own idiom.
  assert.equal(formats['code-py'].options.find(o => o.id === 'style').choices[1][1], 'match / case');
  assert.equal(formats['code-c'].options.find(o => o.id === 'style').choices[2][1], 'Struct + functions');
});

test('every language target emits a clean non-empty string in every style', () => {
  reset();
  endsIn01();
  const ir = context.buildMachineIR();
  for (const key of ['code-js', 'code-py', 'code-java', 'code-c']) {
    for (const style of STYLES) {
      const out = inVM('ExportFormats')[key].build(ir, { style, className: 'Automaton' });
      assert.equal(typeof out, 'string', `${key}/${style} must emit a string`);
      assert.ok(out.trim().length > 0, `${key}/${style} emitted nothing`);
      // A *quoted* undefined means an interpolated name or symbol came out
      // undefined. Two forms are legitimate and are excluded first: the bare
      // `next === undefined` comparison, and the `typeof module !== 'undefined'`
      // CommonJS guard.
      const suspicious = out.replace(/typeof \w+ !== 'undefined'/g, '');
      assert.doesNotMatch(suspicious, /["']undefined["']/, `${key}/${style} leaked an undefined value`);
      assert.doesNotMatch(out, /\bNaN\b/, `${key}/${style} leaked a NaN`);
    }
  }
});

test('a state with no outgoing transitions is handled in every style', () => {
  reset();
  fa({
    sigma: ['a', 'b'],
    states: ['q0', 'sink'], start: 'q0', accepts: ['q0'],
    edges: [['q0', 'a', 'sink']] // sink has no way out
  });
  for (const style of STYLES) {
    const { accepts } = runJS(context.codegenJavaScript(context.buildMachineIR(), { style }));
    assert.equal(accepts(''), true, `${style}: empty word should be accepted`);
    assert.equal(accepts('a'), false, `${style}: "a" lands in the sink`);
    assert.equal(accepts('ab'), false, `${style}: sink has no b-edge`);
    assert.equal(accepts('b'), false, `${style}: q0 has no b-edge`);
  }
});
