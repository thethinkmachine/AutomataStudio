import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';
import { readFileSync } from 'node:fs';

// A transition's tooltip, laid out in columns.
//
// It matters more than it looks: with the large-machine profile on, the edge
// labels are not drawn at all, so hover is how a transition is read. The two
// renderings — the grid a reader sees and the prose a screen reader hears — are
// generated side by side so neither can quietly stop describing the other.

const { App } = context;
const TAB = String.fromCharCode(9);

function edge(machine, t) {
  createHarness();
  App.machine = machine;
  App.sigma = new Set(['a', 'b']);
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 200, y: 0 }];
  App.startId = 's0';
  App.transitions = [{ id: 't0', from: 's0', to: 's1', ...t }];
  context.invalidateStateIndex();
  return App.transitions[0];
}

const rows = s => s.split('\n');
const cells = r => r.split(TAB);

test('every machine gets a labelled key column', () => {
  const cases = [
    ['DFA', { symbol: 'a' }, ['Read']],
    ['NFA', { symbol: 'a' }, ['Read']],
    ['TM', { symbol: 'a', write: 'b', dir: 'R' }, ['Read', 'Write', 'Move']],
    ['LBA', { symbol: 'a', write: 'b', dir: 'L' }, ['Read', 'Write', 'Move']],
    ['NPDA', { symbol: 'a', pop: 'Z', push: 'AZ' }, ['Read', 'Pop', 'Push']],
    ['QA', { symbol: 'a', pop: 'X', push: 'Y' }, ['Read', 'Dequeue', 'Enqueue']],
    ['Counter', { symbol: 'a', pop: 'Z', push: 'ZZ' }, ['Read', 'Test', 'Counter']],
    ['2DFA', { symbol: 'a', dir: 'R' }, ['Read', 'Move']],
    ['Mealy', { symbol: 'a', output: '1' }, ['Read', 'Print']],
    ['PFA', { symbol: 'a', weight: 0.5 }, ['Read', 'Probability']]
  ];
  for (const [machine, t, keys] of cases) {
    const tip = context.transTipRows(edge(machine, t));
    assert.deepEqual(rows(tip).map(r => cells(r)[0]), keys, `${machine} tooltip keys`);
    for (const r of rows(tip)) {
      assert.ok(cells(r).length >= 2, `${machine}: every row is a key and a value`);
    }
  }
});

test('a multi-tape transition is a table with a header, not a sentence', () => {
  const t = edge('MTM', {
    tapeSyms: ['#', 'a', 'f'], tapeWrites: ['#', 'b', 'f'], tapeDirs: ['R', 'S', 'L']
  });
  App.tapeCount = 3;
  const r = rows(context.transTipRows(t));
  assert.deepEqual(cells(r[0]), ['Tape', 'Read', 'Write', 'Move']);
  assert.deepEqual(cells(r[1]), ['1', '#', '#', 'Right']);
  assert.deepEqual(cells(r[2]), ['2', 'a', 'b', 'Stay']);
  assert.deepEqual(cells(r[3]), ['3', 'f', 'f', 'Left']);
  assert.equal(r.length, 4, 'one header and one row per tape, nothing else');
  // The wall of text this replaced.
  assert.ok(!context.transTipRows(t).includes(' | '));
});

test('the edge tooltip says which edge it is before what it does', () => {
  const t = edge('TM', { symbol: 'a', write: 'b', dir: 'R' });
  const r = rows(context.edgeTipFor([t]));
  assert.equal(r[0], 'q0 → q1', 'an unlabelled arrow has to name its endpoints');
  assert.equal(r[1], '---');
  assert.equal(cells(r[2])[0], 'Read');
});

test('a self-loop is marked as one rather than repeating the state', () => {
  const t = edge('DFA', { symbol: 'a' });
  t.to = 's0';
  assert.equal(rows(context.edgeTipFor([t]))[0], 'q0 ↺');
});

test('several transitions on one arrow are separated by a rule', () => {
  edge('DFA', { symbol: 'a' });
  const ts = [
    { id: 't0', from: 's0', to: 's1', symbol: 'a' },
    { id: 't1', from: 's0', to: 's1', symbol: 'b' }
  ];
  const r = rows(context.edgeTipFor(ts));
  assert.equal(r.filter(x => x === '---').length, 2,
    'one rule under the heading, one between the two rules on the arrow');
  assert.deepEqual(r.filter(x => x.includes(TAB)).map(x => cells(x)[1]), ['a', 'b']);
});

test('an empty edge produces nothing rather than a bare heading', () => {
  createHarness();
  assert.equal(context.edgeTipFor([]), '');
  assert.equal(context.edgeTipFor(null), '');
});

test('the prose form is untouched, because it is the accessible name', () => {
  const t = edge('TM', { symbol: 'a', write: 'b', dir: 'R' });
  const prose = context.transLabelDescriptive(t);
  // A screen reader should hear a sentence, not a table read left to right.
  assert.equal(prose, "Read 'a', Write 'b', Move Right");
  assert.ok(!prose.includes(TAB));
});

test('both forms describe the same transition', () => {
  // The two are generated side by side and must not drift: every value the
  // prose quotes has to appear in the grid.
  for (const [machine, t] of [
    ['TM', { symbol: 'a', write: 'b', dir: 'L' }],
    ['NPDA', { symbol: 'a', pop: 'Z', push: 'AZ' }],
    ['Mealy', { symbol: 'a', output: '1' }]
  ]) {
    const tr = edge(machine, t);
    const grid = context.transTipRows(tr);
    for (const quoted of context.transLabelDescriptive(tr).match(/'([^']*)'/g) || []) {
      const v = quoted.slice(1, -1);
      assert.ok(grid.includes(v), `${machine}: the grid dropped ${quoted}`);
    }
  }
});

// ── bounds ────────────────────────────────────────────────────────
//
// Nothing here is trimmed for size. The box is what is bounded — see the section
// below — and TIP_MAX_ROWS is a ceiling on a pathological edge rather than a cap
// a reader ever meets.

test('an uncapped edge says nothing extra', () => {
  const t = edge('DFA', { symbol: 'a' });
  assert.ok(!context.edgeTipFor([t]).includes('more'));
});


test('the first transition is shown whatever it costs', () => {
  // A tooltip that showed no transition at all — because the only one was
  // taller than the budget — would be worse than a long one.
  createHarness();
  App.machine = 'MTM';
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 9, y: 0 }];
  App.transitions = [{
    id: 't0', from: 's0', to: 's1',
    tapeSyms: Array(40).fill('a'), tapeWrites: Array(40).fill('b'), tapeDirs: Array(40).fill('R')
  }];
  context.invalidateStateIndex();
  const r = rows(context.edgeTipFor(App.transitions));
  assert.ok(r.some(x => cells(x)[0] === '1'), 'tape 1 is drawn');
  assert.ok(!r.some(x => x.startsWith('+') && x.includes('on this edge')));
});

// ── reaching a tooltip that did not fit ───────────────────────────
//
// js/tooltip.js is an IIFE of document listeners with no exports, so these read
// the source the way tests/canvas-overlays.test.js reads the stylesheet. What
// they protect is a set of exemptions that are invisible to break: each of the
// global dismiss listeners fires for events that happen *inside* the tooltip,
// and any one of them left unexempted closes the thing at the first attempt to
// read it.

test('taking the pointer is measured, and only while shown', () => {
  const css = readFileSync(new URL('../css/modals.css', import.meta.url), 'utf8');
  const rule = css.match(/\.tooltip\.is-reachable[^{]*\{[^}]*\}/);
  assert.ok(rule, '.tooltip.is-reachable rule not found');
  assert.match(rule[0], /pointer-events:\s*auto/);
  // A fading-out tooltip is still painted; one that took the pointer on the way
  // out would intercept a click nobody can see it intercepting.
  assert.match(rule[0].split('{')[0], /\.show/);

  const js = readFileSync(new URL('../js/tooltip.js', import.meta.url), 'utf8');
  // From what actually overflowed, never from the content's kind — an ordinary
  // tooltip must not block the canvas on the chance that it might have. Measured
  // on the body, since that is the box that scrolls.
  assert.match(js, /is-reachable',\s*[\s\S]{0,40}bodyEl\.scrollHeight > bodyEl\.clientHeight/);
});

test('every global dismisser exempts events from inside the tooltip', () => {
  const js = readFileSync(new URL('../js/tooltip.js', import.meta.url), 'utf8');
  for (const [evt, why] of [
    ['pointerdown', 'a press on its own scrollbar'],
    ['scroll', 'the scroll that press produces']
  ]) {
    const at = js.indexOf(`addEventListener('${evt}'`);
    assert.notEqual(at, -1, `${evt} listener not found`);
    assert.match(js.slice(at, at + 140), /inTip\(e\.target\)/,
      `${evt} closes the tooltip on ${why}`);
  }
  // Moving from the anchor into the tooltip is not leaving.
  assert.match(js, /inTip\(e\.relatedTarget\)/);
  // And crossing the gap between them is a pointerout that has to be forgiven.
  assert.match(js, /HIDE_GRACE/);
});

// ── everything is present; the box is what is bounded ─────────────

test('every transition on an edge is in the tooltip', () => {
  // "+5 more" with no way to reach them is a worse answer than a long tooltip:
  // the reader can see something is withheld and has nothing to do about it.
  // On a large machine, where the labels are not drawn, those five may be the
  // whole reason the edge was hovered. The box scrolls instead.
  edge('DFA', { symbol: 'a' });
  const ts = 'abcdefghijklmnop'.split('').map((c, i) => ({ id: 't' + i, from: 's0', to: 's1', symbol: c }));
  const r = rows(context.edgeTipFor(ts));
  assert.deepEqual(r.filter(x => x.includes(TAB)).map(x => cells(x)[1]), 'abcdefghijklmnop'.split(''));
  assert.ok(!r.some(x => x.includes('more on this edge')));
});

test('every tape is in the table, however many there are', () => {
  const n = 40;
  const t = edge('MTM', {
    tapeSyms: Array.from({ length: n }, (_, i) => 'a'),
    tapeWrites: Array.from({ length: n }, () => 'b'),
    tapeDirs: Array.from({ length: n }, () => 'R')
  });
  const r = rows(context.transTipRows(t));
  assert.equal(r.length, n + 1, 'a header and a row per tape');
  assert.equal(cells(r[n])[0], String(n));
  assert.ok(!r.some(x => x.includes('more tapes')));
});

test('a pathological edge is still bounded, and says it was', () => {
  // The ceiling exists only so hover cannot build an unbounded grid. It is far
  // past anything a reader meets, and when it trims it says so.
  edge('DFA', { symbol: 'a' });
  const ts = Array.from({ length: 400 }, (_, i) => ({ id: 't' + i, from: 's0', to: 's1', symbol: 'a' }));
  const r = rows(context.edgeTipFor(ts));
  assert.ok(r.length <= 122, `${r.length} rows`);
  assert.match(r[r.length - 1], /^\+\d+ more on this edge$/);
});

test('the box is measured from a neutral offset, not from the last hover', () => {
  // A position: fixed box with `left` set and `right: auto` shrink-to-fits
  // against `viewport - left`. Measuring while the previous hover's offset is
  // still on the element squeezes the width, and that squeezed width computes
  // the next offset — so a table hovered near the right edge came back
  // permanently narrow, breaking "Write" into "Wri/te".
  const js = readFileSync(new URL('../js/tooltip.js', import.meta.url), 'utf8');
  const at = js.indexOf('function place(');
  const body = js.slice(at, js.indexOf('const tw = el.offsetWidth', at));
  assert.match(body, /el\.style\.left = '0px'/, 'width measured against a stale offset');
});

test('a table is bounded by the window, never by a prose measure', () => {
  const css = readFileSync(new URL('../css/modals.css', import.meta.url), 'utf8');
  const grid = css.match(/\.tooltip\.is-grid \{[^}]*\}/)[0];
  // The prose caps (260/300px) are a line length chosen so a sentence reads
  // well; a column of "Write" narrowed to a measure does not read better.
  assert.match(grid, /max-width:\s*calc\(100vw - 24px\)/);
  assert.ok(!/max-width:[^;]*\d+px\s*,/.test(grid), 'a fixed pixel cap is back');

  const cell = css.match(/\.tooltip-cell \{[^}]*\}/)[0];
  assert.match(cell, /white-space:\s*nowrap/, 'cells inherit normal and wrap mid-word without this');

  // The scroll is on the body, never on .tooltip: a scrollbar's gutter is
  // painted without clipping to its own element's border-radius, so a scrolling
  // tooltip came back with two square corners down the side it was on. The outer
  // box keeps the radius and clips to it; the inner box scrolls.
  const base = css.match(/\n\.tooltip \{[^}]*\}/)[0];
  assert.ok(!/overflow:/.test(base), 'the box carrying the radius must not be the scroller');
  assert.match(grid, /overflow:\s*hidden/, 'nothing clips the body to the radius');

  // Both axes explicitly, and the horizontal one is `hidden`: the columns are
  // max-content, so the body shrink-to-fits to exactly the table's width and the
  // vertical scrollbar then takes 7px out of it — a horizontal scrollbar on a
  // table that fits, every time one is tall enough to scroll at all.
  const body = css.match(/\.tooltip\.is-grid \.tooltip-body \{[^}]*\}/)[0];
  assert.match(body, /overflow:\s*hidden auto/);
  assert.match(body, /max-height:/, 'the box is what is bounded');
});
