import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

// The complexity profile: js/complexity.js (inputs, measuring, the growth
// reading) and js/complexity-ui.js (the section).
//
// The measurement is the part a reader takes on trust, so it is checked
// against the run the player would show for the same word; the growth
// reading is checked on curves whose answer is known.

const harness = createHarness();
const { context } = harness;

function loadExample(name) {
  harness.resetApp();
  context.loadData(JSON.parse(readFileSync(new URL(`../js/examples/${name}.json`, import.meta.url), 'utf8')), true);
}

/**
 * A TM that accepts aⁿ by crossing off one a per pass and walking to the end
 * of the word and back each time — about n² steps, which is the point.
 */
function crossOff() {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  const B = App.config.sym.blank;
  App.states.push(
    { id: 'q0', name: 'take', x: 0, y: 0 },
    { id: 'q1', name: 'out', x: 0, y: 0 },
    { id: 'q2', name: 'back', x: 0, y: 0 },
    { id: 'h', name: 'done', x: 0, y: 0 }
  );
  App.startId = 'q0';
  App.accepts.add('h');
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', 'X', B]);
  App.transitions.push(
    { id: '1', from: 'q0', to: 'q1', symbol: 'a', write: 'X', dir: 'R' },
    { id: '2', from: 'q0', to: 'h', symbol: B, write: B, dir: 'S' },
    { id: '3', from: 'q1', to: 'q1', symbol: 'a', write: 'a', dir: 'R' },
    { id: '4', from: 'q1', to: 'q2', symbol: B, write: B, dir: 'L' },
    { id: '5', from: 'q2', to: 'q2', symbol: 'a', write: 'a', dir: 'L' },
    { id: '6', from: 'q2', to: 'q0', symbol: 'X', write: 'X', dir: 'R' }
  );
}

test('a family pattern expands the way it reads', () => {
  const { expandFamily } = context;
  assert.equal(expandFamily('a^n b^n', 3), 'aaa bbb');
  assert.equal(expandFamily('(ab)^{2n}', 2), 'abababab');
  assert.equal(expandFamily('1^n+1^{n+1}', 2), '11+111');
  assert.equal(expandFamily('0^{2n-1}', 0), '', 'a count below zero is none');
  assert.equal(expandFamily('((ab)^n c)^2', 1), 'ab cab c');
  assert.equal(expandFamily('x^3y^n', 2), 'xxxyy', 'a fixed count and a variable one');
});

test('a pattern that cannot be read says what is wrong with it', () => {
  const { parseFamily } = context;
  const says = (p, re) => assert.throws(() => parseFamily(p), e => re.test(e.message), p);
  says('', /pattern such as/);
  says('ab', /never uses n/);
  says('a^', /After \^/);
  says('(ab^n', /no \)/);
  says('ab)^n', /no \(/);
  says('a^{n*2}', /not a count/);
  says('^n', /nothing before it/);
});

test('every word of a length, or a fair and repeatable sample', () => {
  const { wordsOfLength } = context;
  const all = wordsOfLength(['a', 'b'], 3, 64);
  assert.equal(all.length, 8);
  assert.equal(new Set(all).size, 8);
  assert.ok(all.includes('aba'));

  const sample = wordsOfLength(['a', 'b', 'c'], 8, 20);
  assert.equal(sample.length, 20);
  assert.equal(new Set(sample).size, 20);
  assert.ok(sample.includes('aaaaaaaa') && sample.includes('cccccccc'), 'the one-symbol words are always in');
  assert.deepEqual(wordsOfLength(['a', 'b', 'c'], 8, 20), sample, 'the same sample twice');

  assert.deepEqual(wordsOfLength(['go', 'stop'], 2, 64), ['go go', 'go stop', 'stop go', 'stop stop'],
    'symbols longer than a character are spaced, the way the run box splits them');
  assert.deepEqual(wordsOfLength(['a'], 0, 64), ['']);
});

test('a measured run is the run the player would show', () => {
  loadExample('tm');
  const { App, measureWord, streamMachine, parseMachineInput } = context;
  for (const word of ['1011+11', '10+1', '1+1']) {
    const r = measureWord(App.machine, word);
    const run = streamMachine(App.machine, parseMachineInput(App.machine, word).input);
    run.drain();
    assert.equal(r.steps, run.steps.length - 1, `${word}: steps`);
    assert.equal(r.verdict, run.steps[run.steps.length - 1].final, `${word}: verdict`);
    const heads = run.steps.map(s => s.view.origin + s.view.head);
    assert.equal(r.space, Math.max(...heads) - Math.min(...heads) + 1, `${word}: cells visited`);
  }
  assert.ok(measureWord(App.machine, 'zz').error, 'a word outside Σ is an error, not a run');
});

test('a store is measured by how tall it got', () => {
  loadExample('pda');
  const { App, measureWord, streamMachine, parseMachineInput } = context;
  const word = '{[()()]}';
  const r = measureWord(App.machine, word, 'store');
  const run = streamMachine(App.machine, parseMachineInput(App.machine, word).input);
  run.drain();
  assert.equal(r.space, Math.max(...run.steps.map(s => s.stack.length)));
  assert.equal(r.verdict, 'accept');
});

test('growth is read off the curve, and the reading says what it is', () => {
  const { growthEstimate } = context;
  const pts = f => Array.from({ length: 10 }, (_, i) => ({ n: i + 1, v: f(i + 1) }));
  assert.equal(growthEstimate(pts(n => 3 * n + 2)).label, 'linear');
  assert.equal(growthEstimate(pts(n => n * n + n)).label, 'quadratic');
  assert.equal(growthEstimate(pts(n => n ** 3)).label, 'cubic');
  const e = growthEstimate(pts(n => 2 ** n));
  assert.equal(e.kind, 'exponential');
  assert.ok(Math.abs(e.base - 2) < 0.05);
  assert.equal(growthEstimate(pts(() => 7)).kind, 'constant');
  assert.equal(growthEstimate(pts(n => n).slice(0, 3)), null, 'three points are not enough to say');
  // A point that hit the budget is a lower bound, not a value, and is left out.
  const capped = pts(n => n * n).map(p => (p.n > 7 ? { ...p, v: 50, limited: true } : p));
  assert.equal(growthEstimate(capped).label, 'quadratic');
});

test('a profile of a quadratic machine reads as quadratic, and leaves the player alone', () => {
  crossOff();
  const { App, profileRun, growthEstimate, runSim, getElement } = { ...context, getElement: harness.getElement };
  getElement('sim-in').value = 'aa';
  runSim();
  const before = [App.simSteps, App.simIdx, App.simRun];

  const rows = [];
  for (const v of profileRun('TM', { mode: 'all', from: 1, to: 12, cap: 8, symbols: ['a'], space: 'cells' })) {
    if (v.done) rows.push(v.row);
  }
  assert.equal(rows.length, 12);
  rows.forEach(r => {
    assert.equal(r.count, 1, 'one word of each length over {a}');
    assert.equal(r.verdicts.accept, 1);
    assert.equal(r.worstWord, 'a'.repeat(r.n));
    assert.equal(r.spaceWorst, r.n + 1, 'it visits the word and the blank after it');
  });
  assert.ok(rows[11].worst > rows[5].worst * 3, 'twice the length, about four times the work');
  const est = growthEstimate(rows.map(r => ({ n: r.n, v: r.worst })));
  assert.equal(est.label, 'quadratic', est.detail);
  const space = growthEstimate(rows.map(r => ({ n: r.n, v: r.spaceWorst })));
  assert.equal(space.label, 'linear', space.detail);

  assert.deepEqual([App.simSteps, App.simIdx, App.simRun], before, 'the run on screen is untouched');
});

test('a family profile runs one word per length', () => {
  loadExample('tm');
  const { App, profileRun } = context;
  const rows = [];
  for (const v of profileRun(App.machine, { mode: 'family', pattern: '1^n+1^n', from: 1, to: 5, space: 'cells' })) {
    if (v.done) rows.push(v.row);
  }
  assert.deepEqual(rows.map(r => r.worstWord), ['1+1', '11+11', '111+111', '1111+1111', '11111+11111']);
  assert.ok(rows.every(r => r.verdicts.accept === 1), 'the adder accepts every sum');
});

test('the section is offered where a run has a length worth charting', () => {
  harness.resetApp();
  const { setMachine, syncComplexitySection, PANEL_SECTIONS } = context;
  const sec = harness.getElement('rp-complexity');
  const entry = PANEL_SECTIONS.rpanel.sections.find(s => s.id === 'rp-complexity');
  assert.equal(entry.fill, '.cx-charts');
  for (const [m, shown] of [['TM', true], ['MTM', true], ['LBA', true], ['DPDA', true], ['QA', true], ['DFA', false], ['NDTM', false], ['EPDA', false]]) {
    setMachine(m);
    syncComplexitySection();
    assert.equal(sec.style.display, shown ? '' : 'none', m);
  }
});

test('the plan says what is wrong with it before anything runs', () => {
  harness.resetApp();
  const { _complexityTests: t } = context;
  Object.assign(t.plan, { mode: 'all', from: 5, to: 3, cap: 32 });
  assert.match(t.planProblem(), /larger than the first/);
  Object.assign(t.plan, { from: 1, to: 99 });
  assert.match(t.planProblem(), /from 0 to 40/);
  Object.assign(t.plan, { to: 8, mode: 'family', pattern: 'ab' });
  assert.match(t.planProblem(), /never uses n/);
  Object.assign(t.plan, { pattern: 'a^n b^n' });
  assert.equal(t.planProblem(), '');
});
