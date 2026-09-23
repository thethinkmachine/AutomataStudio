import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { context, resetApp } from './harness.js';
import { parseJsLiteral, extractMachineLiteral } from '../js/interop/objlit.js';
import { parseXml } from '../js/interop/xml.js';
import { StatechartError, readStatechart, statechartKindOf } from '../js/interop/statechart.js';
import { enumerateWords, exactFiniteEquivalence, machineTargetFromApp, withMachine } from '../js/exercise/grade.js';

const sym = () => context.App.config.sym;

function loadExample(name) {
  resetApp();
  context.loadData(JSON.parse(readFileSync(new URL(`../js/examples/${name}.json`, import.meta.url), 'utf8')), true);
}

const byName = (m, name) => m.states.find(s => s.name === name)?.id;
const edges = (m, from) => m.transitions.filter(t => t.from === byName(m, from))
  .map(t => `${t.symbol}->${m.states.find(s => s.id === t.to).name}`).sort();

// ── the readers ───────────────────────────────────────────────────

test('an object literal is read as data, and code inside it is kept as text, never run', () => {
  const src = `{
    // a comment
    id: 'fetch', initial: "idle", /* another */
    count: -2.5e1,
    states: { idle: { on: { GO: { target: 'busy', actions: assign({ n: (ctx) => ctx.n + 1 }), } } }, },
    label: \`plain\`,
    tpl: \`has \${code}\`,
    shorthand,
    list: [1, 'two', true, null,],
  }`;
  const { value } = parseJsLiteral(src);
  assert.equal(value.id, 'fetch');
  assert.equal(value.count, -25);
  assert.equal(value.label, 'plain');
  assert.deepEqual(value.list, [1, 'two', true, null]);
  assert.match(value.states.idle.on.GO.actions.__expr, /^assign\(/);
  assert.ok(value.tpl.__expr);
  assert.deepEqual(value.shorthand, { __expr: 'shorthand' });
});

test('the config is found inside createMachine(…), setup(…).createMachine(…) and an export', () => {
  assert.equal(extractMachineLiteral(`import { createMachine } from 'xstate';\nexport const m = createMachine({ initial: 'a', states: { a: {} } });`).initial, 'a');
  assert.equal(extractMachineLiteral(`setup({ actions: { x: () => {} } }).createMachine({ initial: 'b', states: { b: {} } })`).initial, 'b');
  assert.equal(extractMachineLiteral(`// banner\nexport const machine = { "initial": "c", "states": { "c": {} } };`).initial, 'c');
});

test('the XML reader decodes entities and CDATA and refuses a mismatched tag', () => {
  const doc = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b>t &lt; u<![CDATA[<raw>]]></b><c/></a>');
  assert.equal(doc.attrs.x, '1 & 2');
  assert.equal(doc.children[0].text, 't < u<raw>');
  assert.equal(doc.children.length, 2);
  assert.throws(() => parseXml('<a><b></a>'), /does not close/);
});

// ── the exporters' output comes back as the same machine ──────────

for (const [label, codegen, kind] of [['XState', 'codegenXState', 'xstate'], ['SCXML', 'codegenSCXML', 'scxml']]) {
  test(`a DFA exported as ${label} imports as a DFA for the same language`, () => {
    loadExample('dfa');
    const original = machineTargetFromApp();
    const text = context[codegen](context.buildMachineIR());
    const back = readStatechart(kind, text, sym());
    assert.equal(back.machine, 'DFA');
    assert.deepEqual(back.warnings, []);
    const r = exactFiniteEquivalence(original, { kind: 'machine', ...back }, original.sigma, sym());
    assert.equal(r.equal, true, JSON.stringify(r));
  });

  test(`a Mealy machine exported as ${label} imports with its outputs`, () => {
    loadExample('mealy');
    const original = machineTargetFromApp();
    const back = { kind: 'machine', ...readStatechart(kind, context[codegen](context.buildMachineIR()), sym()) };
    assert.equal(back.machine, 'Mealy');
    const { words } = enumerateWords(original.sigma, 3, 500);
    const run = m => withMachine(m, () => words.map(w => JSON.stringify(context.decideWord('Mealy', w))));
    assert.deepEqual(run(back), run(original));
  });
}

test('a Moore machine exported as XState imports with its state outputs', () => {
  loadExample('moore');
  const back = readStatechart('xstate', context.codegenXState(context.buildMachineIR()), sym());
  assert.equal(back.machine, 'Moore');
  const outs = context.App.states.map(s => s.output ?? '').sort();
  assert.deepEqual(back.states.map(s => s.output).sort(), outs);
});

// ── hierarchy ─────────────────────────────────────────────────────

const TRAFFIC = `
import { createMachine, assign } from 'xstate';
export const light = createMachine({
  id: 'light',
  initial: 'green',
  on: { POWER_OUT: '#light.off' },          // every state inherits this
  states: {
    green: { on: { TIMER: 'yellow' } },
    yellow: { on: { TIMER: 'red' } },
    red: {
      initial: 'walk',
      on: { TIMER: 'green' },
      states: {
        walk: { on: { COUNTDOWN: 'wait' } },
        wait: { on: { COUNTDOWN: 'stop', TIMER: '#light.yellow' } },  // overrides red's TIMER
        stop: { tags: ['accepting'] }
      }
    },
    off: { type: 'final', entry: assign({ lamps: 0 }) }
  }
});`;

test('a hierarchical XState machine flattens to its leaves, inheriting and overriding edges', () => {
  resetApp();
  const m = readStatechart('xstate', TRAFFIC, sym());
  assert.equal(m.machine, 'DFA');
  assert.deepEqual(m.states.map(s => s.name).sort(), ['green', 'off', 'red.stop', 'red.wait', 'red.walk', 'yellow']);
  assert.equal(m.states.find(s => s.id === m.startId).name, 'green');
  assert.deepEqual(edges(m, 'yellow'), ['POWER_OUT->off', 'TIMER->red.walk']);
  assert.deepEqual(edges(m, 'red.walk'), ['COUNTDOWN->red.wait', 'POWER_OUT->off', 'TIMER->green']);
  assert.deepEqual(edges(m, 'red.wait'), ['COUNTDOWN->red.stop', 'POWER_OUT->off', 'TIMER->yellow']);
  assert.deepEqual(edges(m, 'off'), [], 'a final state has no way out');
  assert.deepEqual(m.accepts.map(id => m.states.find(s => s.id === id).name).sort(), ['off', 'red.stop']);
  assert.ok(m.warnings.some(w => /Actions other than output/.test(w)));
});

test('guards make a choice, and eventless transitions become ε', () => {
  resetApp();
  const m = readStatechart('xstate', `{
    initial: 'a',
    states: {
      a: { on: { GO: [{ target: 'b', guard: 'ok' }, { target: 'c' }] } },
      b: { always: 'c' },
      c: {}
    }
  }`, sym());
  assert.equal(m.machine, 'ε-NFA');
  assert.deepEqual(edges(m, 'a'), ['GO->b', 'GO->c']);
  assert.deepEqual(edges(m, 'b'), [`${sym().eps}->c`]);
  assert.ok(m.warnings.some(w => /Guards/.test(w)));
  assert.ok(m.warnings.some(w => /ε-moves/.test(w)));
});

test('a parallel state is refused with a sentence, not flattened', () => {
  assert.throws(
    () => readStatechart('xstate', `{ type: 'parallel', states: { x: {}, y: {} } }`, sym()),
    e => e instanceof StatechartError && /parallel/.test(e.message)
  );
  assert.throws(
    () => readStatechart('xstate', `{ initial: 'a', states: { a: { on: { GO: 'nowhere' } } } }`, sym()),
    e => e instanceof StatechartError && /nowhere/.test(e.message)
  );
});

test('SCXML: nested states, <initial>, a deep initial id, event lists and <final>', () => {
  resetApp();
  const m = readStatechart('scxml', `<?xml version="1.0"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="inner2">
  <state id="outer">
    <initial><transition target="inner1"/></initial>
    <transition event="reset" target="outer"/>
    <state id="inner1"><transition event="a b" target="inner2"/></state>
    <state id="inner2"><transition event="a" target="done"><log label="note" expr="'x'"/></transition></state>
  </state>
  <final id="done"/>
</scxml>`, sym());
  assert.equal(m.states.find(s => s.id === m.startId).name, 'outer.inner2', 'a deep initial id is honoured');
  assert.deepEqual(edges(m, 'outer.inner1'), ['a->outer.inner2', 'b->outer.inner2', 'reset->outer.inner1']);
  assert.deepEqual(edges(m, 'outer.inner2'), ['a->done', 'reset->outer.inner1']);
  assert.deepEqual(m.accepts.map(id => m.states.find(s => s.id === id).name), ['done']);
  assert.ok(m.warnings.some(w => /Actions/.test(w)));
});

test('a file is recognised as a statechart by its name, or a .json by its shape', () => {
  assert.equal(statechartKindOf('light.scxml', ''), 'scxml');
  assert.equal(statechartKindOf('light.machine.ts', ''), 'xstate');
  assert.equal(statechartKindOf('x.json', '{"initial":"a","states":{"a":{}}}'), 'xstate');
  assert.equal(statechartKindOf('x.json', '{"format":"automata-studio","states":[],"transitions":[]}'), null);
  assert.equal(statechartKindOf('x.automaton', '{}'), null);
});

test('an imported statechart opens through the ordinary document path', () => {
  resetApp();
  const ok = context.applyDocument(TRAFFIC, 'light.js');
  assert.equal(ok, true);
  const App = context.App;
  assert.equal(App.machine, 'DFA');
  assert.equal(App.states.length, 6);
  assert.ok(App.sigma.has('TIMER'));
  assert.match(App.meta?.blurb || '', /Actions other than output/);
});
