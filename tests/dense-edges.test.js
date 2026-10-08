import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// An edge carrying many rules.
//
// A label was one row per rule, so a four-state DFA over a 36-symbol alphabet
// — 144 rules, nowhere near the large-machine profile's 700 — drew each edge as
// a tower of single characters. Crowding is per edge, so it is handled per
// edge, at any size: rules that differ only in what they read share a row,
// a long list of symbols wraps, and past LABEL_MAX_LINES the label shows what
// fits and `+k more`. One function decides it (render.js, edgeLabelLines), and
// the canvas, the layout's label sizes, the dialog's preview and the label
// editor all read it — these pin that rule, and that the readers agree.

function machine(type, rules) {
  createHarness();
  const { App } = context;
  App.machine = type;
  App.states = [{ id: 's0', x: 0, y: 0, name: 'q0' }, { id: 's1', x: 200, y: 0, name: 'q1' }];
  App.startId = 's0';
  App.transitions = rules.map((r, i) => ({ id: `t${i}`, from: 's0', to: 's1', ...r }));
  return App.transitions;
}

const lines = (ts, opts) => context.edgeLabelLines(ts, opts);
const texts = (ts, opts) => lines(ts, opts).map(l => l.text);

test('rules that differ only in the symbol read share one row', () => {
  const ts = machine('DFA', ['a', 'b', 'c'].map(symbol => ({ symbol })));
  assert.deepEqual(texts(ts), ['a, b, c']);
  assert.deepEqual(lines(ts)[0].ids, ['t0', 't1', 't2'], 'the row knows the rules it stands for');
});

test('rules that do something different keep rows of their own', () => {
  const ts = machine('TM', [
    { symbol: 'a', write: 'X', dir: 'R' },
    { symbol: 'b', write: 'X', dir: 'R' },
    { symbol: 'c', write: 'c', dir: 'L' }
  ]);
  assert.deepEqual(texts(ts), ['a, b → X, R', 'c → c, L']);
});

test('a list followed by a comma is braced, so it does not read as one more symbol', () => {
  const ts = machine('NPDA', [
    { symbol: 'a', pop: 'A', push: 'AA' },
    { symbol: 'b', pop: 'A', push: 'AA' }
  ]);
  assert.deepEqual(texts(ts), ['{a, b}, A → AA']);
});

test('a multi-tape rule reads a tuple, so it never merges on its first tape', () => {
  const ts = machine('MTM', [
    { symbol: 'a', tapeSyms: ['a', 'x'], tapeWrites: ['a', 'x'], tapeDirs: ['R', 'R'] },
    { symbol: 'b', tapeSyms: ['b', 'x'], tapeWrites: ['b', 'x'], tapeDirs: ['R', 'R'] }
  ]);
  assert.equal(lines(ts).length, 2);
});

test('a long list of symbols wraps, and every line of it stands for the whole row', () => {
  const sigma = [...'abcdefghijklmnopqrstuvwxyz'];
  const ts = machine('DFA', sigma.slice(0, 12).map(symbol => ({ symbol })));
  const ls = lines(ts);
  assert.ok(ls.length > 1, 'twelve symbols do not fit on one line');
  assert.ok(ls.every(l => l.text.length <= 32), 'each line stays near the wrap width');
  const counts = ls.map(l => l.text.split(',').filter(s => s.trim()).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'the symbols are dealt out evenly, with no orphan line');
  assert.ok(ls.every(l => l.ids.length === 12), 'a continuation line edits the same rules');
  assert.deepEqual(ls.map(l => l.text).join(' ').split(/,\s*/).map(s => s.trim()), sigma.slice(0, 12));
});

test('past the line budget the label ends in +k more, counted in rules', () => {
  const ts = machine('TM', [...'abcdefgh'].map((symbol, i) => ({ symbol, write: String(i), dir: 'R' })));
  const ls = lines(ts);
  assert.equal(ls.length, context.LABEL_MAX_LINES);
  const more = ls[ls.length - 1];
  assert.ok(more.more);
  const drawn = ls.slice(0, -1).reduce((n, l) => n + l.ids.length, 0);
  assert.equal(more.text, `+${ts.length - drawn} more`);
  assert.equal(more.ids.length + drawn, ts.length, 'every rule is on exactly one line');
});

test('the rule being edited is kept in view rather than counted', () => {
  const ts = machine('TM', [...'abcdefgh'].map((symbol, i) => ({ symbol, write: String(i), dir: 'R' })));
  const last = ts[ts.length - 1].id;
  assert.ok(lines(ts).at(-1).ids.includes(last), 'without keep, the last rule is behind +k more');
  const kept = lines(ts, { keep: last });
  assert.ok(kept.some(l => !l.more && l.ids.includes(last)), 'with keep, it is drawn');
});

test('pills merge the same rules the compact label does', () => {
  const ts = machine('TM', [
    { symbol: 'a', write: 'X', dir: 'R' },
    { symbol: 'b', write: 'X', dir: 'R' },
    { symbol: 'c', write: 'c', dir: 'L' }
  ]);
  const compact = lines(ts).map(l => l.ids.join());
  const pills = lines(ts, { pills: true }).map(l => l.ids.join());
  assert.deepEqual(pills, compact, 'one line map serves both drawings');
  assert.equal(lines(ts, { pills: true })[0].parts.find(p => p.role === 'input').text, 'a, b');
});

test('the canvas draws the merged lines and records which rules each stands for', () => {
  machine('DFA', [...'abcdefghijklmnopqrstuvwxyz0123456789'].map(symbol => ({ symbol })));
  context.renderAll();
  const node = context.App.domCache.transitions.get('s0|s1');
  const drawn = node.__parts.textEl.children.length;
  assert.ok(drawn <= context.LABEL_MAX_LINES, `36 rules drew ${drawn} lines, not a tower of 36`);
  assert.deepEqual(node.__lines.map(l => l.text), texts(context.App.transitions));
  // The label editor finds a rule's line through the same map.
  const at = context.edgeLabelLineOf('s0|s1', 't0');
  assert.equal(at.line, 0);
  assert.equal(at.lines, drawn);
});
