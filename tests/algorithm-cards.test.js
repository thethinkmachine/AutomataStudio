import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
// Safe after harness.js, which installs the DOM stub before any real module.
import { html, raw } from '../js/text/html.js';
import { thompsonBuild, thompsonSteps } from '../js/algorithms/thompson.js';

// A state name and a symbol that are markup. Every card prints both, and the
// machines they come from can be someone else's: a share link, the library.
const EVIL_NAME = '<b>evil</b>';
const EVIL_SYM = '<i>';

function hostile(h, machine) {
  h.resetApp();
  const App = h.context.App;
  App.machine = machine;
  App.sigma = new Set(['a', EVIL_SYM]);
  App.states = [
    { id: 's0', name: 'q0', x: 0, y: 0, output: '0' },
    { id: 's1', name: EVIL_NAME, x: 0, y: 0, output: EVIL_SYM }
  ];
  App.transitions = [
    { id: 't0', from: 's0', to: 's1', symbol: EVIL_SYM, output: EVIL_SYM, write: EVIL_SYM, dir: 'R', pop: 'Z', push: 'Z' },
    { id: 't1', from: 's1', to: 's1', symbol: 'a', output: '1', write: 'a', dir: 'L', pop: 'Z', push: 'Z' },
    { id: 't2', from: 's1', to: 's0', symbol: 'a', output: '1', write: 'a', dir: 'R', pop: 'Z', push: 'Z' }
  ];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
  App.stateN = 2; App.transN = 3;
  return App;
}

test('html escapes what it interpolates, and only that', () => {
  assert.equal(String(html`<td>${'<b>'}</td>`), '<td>&lt;b&gt;</td>');
  assert.equal(String(html`<p class="${'a" onclick="x'}">`), '<p class="a&quot; onclick=&quot;x">');
  // Nested markup and raw constants pass through once, not twice.
  assert.equal(String(html`<ul>${['<1>', '2'].map(x => html`<li>${x}</li>`)}</ul>`), '<ul><li>&lt;1&gt;</li><li>2</li></ul>');
  assert.equal(String(html`${raw('<svg/>')}`), '<svg/>');
  // Absent parts print nothing, so `cond && html`…`` reads as it should.
  assert.equal(String(html`[${null}${undefined}${false}${0}]`), '[0]');
});

test('no algorithm card prints a state name or a symbol as markup, under any machine it reads', () => {
  const h = createHarness();
  const algos = ['table', 'nfa2dfa', 'minimize', 'equiv', 'nfa2re', 'enfa2nfa', 'complement', 'product',
    'isEmpty', 'isFinite', 'isUniversal', 'fullEquiv', 'star', 'reversal', 'union2', 'intersect', 'concat2',
    'npda', 'ndtm', 'mooreTable', 'mealyTable', 'moore2mealy', 'mealy2moore', 'mtmTable',
    'minimizeVisual', 'tm2grammar', 'epsClosure', 'dfa2rg', 'deadStates'];
  const machines = ['DFA', 'NFA', 'ε-NFA', 'Moore', 'Mealy', 'NPDA', 'NDTM', 'TM', 'MTM'];
  for (const machine of machines) {
    for (const algo of algos) {
      const App = hostile(h, machine);
      // The binary cards need an M₂; give them the same machine.
      App.workspaceB = { machine, states: App.states, transitions: App.transitions, startId: 's0', accepts: ['s1'], sigma: [...App.sigma] };
      h.context.renderAlgo(algo);
      const out = h.getElement('algo-content').innerHTML;
      assert.ok(!out.includes(EVIL_NAME), `${algo} on ${machine} printed the state name as markup`);
      assert.ok(!out.includes(`>${EVIL_SYM}<`) && !out.includes(`'${EVIL_SYM}'`), `${algo} on ${machine} printed the symbol as markup`);
      assert.ok(!out.includes('style="'), `${algo} on ${machine} wrote an inline style`);
    }
  }
});

test('the nondeterministic simulators escape the names in their branch logs', () => {
  const h = createHarness();
  hostile(h, 'NPDA');
  h.context.renderAlgo('npda');
  h.getElement('npda-input').value = EVIL_SYM;
  h.context.runNPDASim();
  const npda = h.getElement('npda-result').innerHTML;
  assert.match(npda, /&lt;b&gt;evil/);
  assert.ok(!npda.includes(EVIL_NAME));

  hostile(h, 'NDTM');
  h.context.renderAlgo('ndtm');
  h.getElement('ndtm-input').value = EVIL_SYM;
  h.context.runNDTMSim();
  const ndtm = h.getElement('ndtm-result').innerHTML;
  assert.match(ndtm, /&lt;b&gt;evil/);
  assert.ok(!ndtm.includes(EVIL_NAME));
});

test('a parse error is the reader\'s text too', () => {
  const h = createHarness();
  h.context.renderAlgo('re2nfa');
  h.getElement('re-input').value = '<img>)';
  h.context.doThompson();
  const out = h.getElement('re-result').innerHTML;
  assert.match(out, /Parse error/);
  assert.ok(!out.includes('<img>'));
});

test('a{n,} is n copies and then a star, not n copies alone', () => {
  const nfa = thompsonBuild('a{2,}');
  const accepts = word => {
    const step = (set, sym) => new Set(nfa.trans.filter(t => set.has(t.from) && t.sym === sym).map(t => t.to));
    const close = set => { let n; do { n = set.size; set = new Set([...set, ...step(set, 'ε')]); } while (set.size !== n); return set; };
    let cur = close(new Set([nfa.start]));
    for (const ch of word) cur = close(step(cur, ch));
    return cur.has(nfa.accept);
  };
  assert.equal(accepts('a'), false);
  assert.equal(accepts('aa'), true);
  assert.equal(accepts('aaaa'), true);
});

test('the narrated Thompson construction builds the same machine as the silent one', () => {
  for (const re of ['a', '(a|b)*abb', 'a+b?', '[a-c]{1,3}', 'ab{2,}']) {
    assert.deepEqual(thompsonSteps(re).nfa, thompsonBuild(re), re);
  }
});

test('equivalence names ε when the empty word is what tells the machines apart', () => {
  const h = createHarness();
  const App = h.context.App;
  h.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }];
  App.transitions = [{ id: 't0', from: 's0', to: 's0', symbol: 'a' }];
  App.startId = 's0';
  App.accepts = new Set(['s0']);
  // M₂ accepts nothing; M₁ accepts ε and everything after it.
  App.workspaceB = { machine: 'DFA', states: [{ id: 'p0', name: 'p0' }], transitions: [{ id: 'u0', from: 'p0', to: 'p0', symbol: 'a' }], startId: 'p0', accepts: [], sigma: ['a'] };
  h.context.renderAlgo('fullEquiv');
  h.context.runFullEquivCheck();
  assert.match(h.getElement('full-equiv-result').innerHTML, /Distinguishing string: ε/);
});

test('step-by-step minimisation starts at its first step', () => {
  const h = createHarness();
  const App = h.context.App;
  h.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's0', name: 'A', x: 0, y: 0 }, { id: 's1', name: 'B', x: 0, y: 0 }];
  App.transitions = [{ id: 't0', from: 's0', to: 's1', symbol: 'a' }, { id: 't1', from: 's1', to: 's1', symbol: 'a' }];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
  h.context.renderAlgo('minimizeVisual');
  assert.ok(!h.getElement('min-vis-table-wrap').innerHTML.includes('✗'), 'nothing is marked before the first step');
  h.context.minVisStep(1);
  assert.match(h.getElement('min-vis-status').innerHTML, /Step 1\//);
  assert.match(h.getElement('min-vis-table-wrap').innerHTML, /✗/, 'the base case marks the accepting pair');
});
