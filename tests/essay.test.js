import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArticle, readingMinutes, renderArticle } from '../js/library/article.js';
import { drawStandardFigure, growthSvg, runStandard, spacetimeSvg } from '../js/library/article-figures.js';
import { SPACETIME_MAX_STEPS, essayFacts, essayFigureSpec, essayLinkTarget } from '../js/library/essay.js';
import { normalizeIndex } from '../js/library/index-model.js';
import { INDEX_FORMAT } from '../js/library/config.js';

// An essay is the author's words around answers the library computed. What is
// pinned here is the line between the two — a {{fact}} is read off the index
// and never typed, a figure is drawn from the machine and its arguments are
// bounded — and the one thing an essay must never do, which is put an
// author's markup on the page.

const BB2 = '1RB1LB_1LA1RZ';
const entry = (over = {}) => ({
  id: 'turing/busy-beaver/bb2', title: 'BB(2) champion', category: 'tm', standard: BB2,
  stats: { states: 3, transitions: 4 }, behaviour: { verdict: 'halts', steps: 6, ones: 4, cells: 4 }, ...over
});
const index = { entries: [entry(), entry({ id: 'turing/x', title: 'X', behaviour: { verdict: 'halts', steps: 47176870, ones: 4098 } })], collections: [{ id: 'busy-beavers', title: 'BB' }] };

// ── Markdown ──────────────────────────────────────────────────────

test('an essay\'s blocks: headings, lists, tables, math, code, figures, notes', () => {
  const { blocks, notes } = parseArticle([
    '# One', 'A paragraph', 'that wraps.', '', '- a', '- b', '', '1. x', '2. y', '',
    '| A | B |', '| --- | ---: |', '| 1 | 2 |', '', '$$ x^2 $$', '', '```', 'code *not em*', '```', '',
    '> quoted', '', '::: spacetime steps=40', 'Its caption.', ':::', '', '[^n]: A note', '  that continues.'
  ].join('\n'));
  assert.deepEqual(blocks.map(b => b.kind), ['heading', 'para', 'list', 'list', 'table', 'math', 'code', 'quote', 'figure']);
  assert.equal(blocks[0].level, 2, 'a page has one title and it is the entry\'s, so # is a section');
  assert.equal(blocks[1].text, 'A paragraph that wraps.');
  assert.equal(blocks[3].ordered, true);
  assert.deepEqual(blocks[4].align, ['', 'num']);
  assert.deepEqual(blocks[8], { kind: 'figure', name: 'spacetime', args: { _: [], steps: '40' }, caption: 'Its caption.' });
  assert.equal(notes.get('n'), 'A note that continues.');
});

test('nothing an author writes reaches the page as markup', () => {
  const { html, warnings } = renderArticle([
    'Hello <script>alert(1)</script> & <img src=x onerror=alert(1)>',
    '',
    '[bad](javascript:alert(1)) [data](data:text/html,x) [ok](https://example.org/a?b=1&c=2)',
    '',
    '| <b>x</b> |', '| --- |', '| "quoted" |'
  ].join('\n'));
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &lt;img/);
  assert.doesNotMatch(html, /href="(javascript|data):/, 'only http(s), # and lib: links become links');
  assert.match(html, /href="https:\/\/example\.org\/a\?b=1&amp;c=2"/);
  assert.equal(warnings.filter(w => /neither http/.test(w)).length, 2);
});

test('code and math are set aside before emphasis, so neither is rewritten', () => {
  const { html } = renderArticle('Run `a*b*c {{steps}}` and $a*b*c$ but *this* is emphasis.', { fact: () => ({ value: '6', say: '' }) });
  assert.match(html, /<code>a\*b\*c \{\{steps\}\}<\/code>/, 'a code span is literal: no emphasis, no fact');
  assert.match(html, /\$a\*b\*c\$/, 'math reaches KaTeX untouched');
  assert.match(html, /<em>this<\/em>/);
});

test('a fact the library knows is printed and marked; one it does not is visible and reported', () => {
  const { html, warnings } = renderArticle('It runs {{steps}} steps, {{colour}} and {{steps turing/x}}.', { fact: essayFacts(index, entry()) });
  assert.match(html, /<span class="fact" title="Steps from a blank tape to the halt, counted by the library running BB\(2\) champion">6<\/span>/);
  assert.match(html, /<span class="fact is-missing">\[\[colour\?\]\]<\/span>/);
  assert.match(html, />47,176,870</, 'another entry, by id');
  assert.deepEqual(warnings, ['{{colour}} is not a fact the library knows.']);
});

test('a fact name is looked up as the library\'s own, never as an object\'s', () => {
  const fact = essayFacts(index, entry());
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(fact(name), null, name);
  assert.equal(fact('steps', 'no/such/entry'), null);
  assert.equal(essayFacts(index, null)('steps'), null, 'a collection\'s essay has no machine of its own');
  assert.equal(essayFacts(index, entry({ behaviour: { verdict: 'never' } }))('steps'), null, 'no halt, no step count');
});

test('footnotes are numbered in the order they are cited, and a missing one is reported', () => {
  const { html, warnings } = renderArticle('First[^b], then[^a], again[^b], and[^gone].\n\n[^a]: Note A.\n[^b]: Note B.');
  const refs = [...html.matchAll(/class="fn-ref"[^>]*><a href="#fn-(\w+)">(\d)</g)].map(m => `${m[1]}${m[2]}`);
  assert.deepEqual(refs, ['b1', 'a2', 'b1']);
  assert.match(html, /<li id="fn-b">Note B\.[\s\S]*<li id="fn-a">Note A\./);
  assert.deepEqual(warnings, ['Footnote [^gone] has no text.']);
});

test('every id carries the prefix, and only web links open a new tab', () => {
  const { html, toc } = renderArticle('## Start here\n\nSee[^1] [out](https://x.org) and [in](#lib-essay-start-here).\n\n::: f\n:::\n\n[^1]: n', {
    figure: () => ({ html: '<svg/>' }), idPrefix: 'lib-essay-', newTab: true
  });
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.sort(), ['lib-essay-figure-1', 'lib-essay-fn-1', 'lib-essay-fnref-1', 'lib-essay-start-here']);
  assert.equal(toc[0].id, 'lib-essay-start-here');
  assert.match(html, /href="https:\/\/x\.org" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /href="#lib-essay-start-here" target/);
});

test('figures are numbered by the ones drawn; one that cannot be drawn is skipped and reported', () => {
  const { html, figures, warnings } = renderArticle('::: a\nFirst.\n:::\n\n::: nope\nGone.\n:::\n\n::: a\nSecond.\n:::', {
    figure: name => (name === 'a' ? { html: '<svg/>' } : null)
  });
  assert.equal(figures, 2);
  assert.match(html, /Figure 1\.<\/span> First\.[\s\S]*Figure 2\.<\/span> Second\./);
  assert.doesNotMatch(html, /Gone/);
  assert.deepEqual(warnings, ['::: nope is not a figure this machine can draw.']);
});

test('the contents list takes the headings without their footnote markers', () => {
  const { toc } = renderArticle('## Why[^1]\n\n### Detail\n\n[^1]: n');
  assert.deepEqual(toc.map(t => [t.level, t.html]), [[2, 'Why'], [3, 'Detail']]);
});

test('reading time counts the words, not the figures or the display math', () => {
  assert.equal(readingMinutes(''), 1);
  assert.equal(readingMinutes(Array(460).fill('word').join(' ')), 2);
  assert.equal(readingMinutes(`${Array(230).fill('w').join(' ')}\n::: f\n${Array(900).fill('c').join(' ')}\n:::\n$$ ${Array(900).fill('x').join(' ')} $$`), 1);
});

// ── Figures ───────────────────────────────────────────────────────

test('the figures\' simulator agrees with the library on a busy beaver', () => {
  assert.deepEqual(runStandard(BB2), { steps: 6, ones: 4, halted: true, lo: -2, hi: 1 });
  assert.deepEqual(runStandard('1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA', { maxSteps: 10000 }).halted, false, 'bounded: BB(5) is not run to its halt here');
  assert.equal(runStandard('nonsense'), null);
});

test('a space-time diagram draws the head only when every step has its row', () => {
  assert.match(spacetimeSvg(BB2, { steps: 6, h: 420 }), /class="st-head"/);
  const sampled = spacetimeSvg('1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA', { steps: 4000, h: 400 });
  assert.doesNotMatch(sampled, /st-head/, 'sampled rows would join positions many steps apart');
  assert.doesNotMatch(sampled, /fill="#|stroke="#/, 'inked by classes, never a baked colour');
});

test('a growth chart marks the halt, on a log scale by default', () => {
  const svg = growthSvg(BB2);
  assert.match(svg, /class="gr-end"/);
  assert.match(svg, /steps on a log scale/);
  assert.match(growthSvg(BB2, { yScale: 'log' }), /class="gr-line"/);
  assert.equal(drawStandardFigure('pie', BB2), null);
});

test('a figure\'s arguments are parsed and bounded before anything is drawn', () => {
  const e = entry();
  assert.deepEqual(essayFigureSpec('spacetime', { _: [], steps: '4029', h: '440' }, e).opts, { steps: 4029, w: 680, h: 440 });
  assert.equal(essayFigureSpec('spacetime', { _: [], steps: '1e12' }, e).opts.steps, SPACETIME_MAX_STEPS);
  assert.equal(essayFigureSpec('spacetime', { _: [], h: '99999' }, e).opts.h, 900);
  assert.equal(essayFigureSpec('spacetime', { _: [], steps: 'lots' }, e).opts.steps, 2000, 'not a number: the default');
  assert.deepEqual(essayFigureSpec('growth', { _: [], y: 'log' }, e).opts, { maxSteps: 1e8, scale: 'log', yScale: 'log' });
  assert.equal(essayFigureSpec('growth', { _: [] }, entry({ standard: null })), null, 'a machine with no standard code has no run to draw');
  assert.equal(essayFigureSpec('diagram', { _: [] }, null), null);
  assert.equal(essayFigureSpec('teapot', { _: [] }, e), null);
});

test('a lib: link names an entry or a collection, or nothing', () => {
  assert.deepEqual(essayLinkTarget(index, 'turing/x'), { kind: 'entry', id: 'turing/x' });
  assert.deepEqual(essayLinkTarget(index, 'busy-beavers'), { kind: 'collection', id: 'busy-beavers' });
  assert.equal(essayLinkTarget(index, 'turing/y'), null);
});

// ── The index ─────────────────────────────────────────────────────

test('the index keeps an essay only where one could be', () => {
  const raw = e => normalizeIndex({ format: INDEX_FORMAT, entries: [{ id: 'a/b', essay: e }], collections: [{ id: 'c', essay: e }] });
  const ok = raw({ path: 'machines/a/b.md', hash: 'abc', minutes: 5 });
  assert.deepEqual(ok.entries[0].essay, { path: 'machines/a/b.md', hash: 'abc', minutes: 5 });
  assert.deepEqual(ok.collections[0].essay, { path: 'machines/a/b.md', hash: 'abc', minutes: 5 });
  for (const path of ['../secret.md', 'machines//b.md', 'machines/a/b.automaton', 'machines/a b.md', 'https://evil.test/x.md']) {
    assert.equal(raw({ path, hash: 'abc' }).entries[0].essay, null, path);
  }
  assert.equal(raw(undefined).entries[0].essay, null);
  assert.equal(raw({ path: 'm/x.md', minutes: 1e9 }).entries[0].essay.minutes, 240);
});
