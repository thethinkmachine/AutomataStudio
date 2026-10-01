import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARTICLE_MAX_CHARS, CALLOUT_ALIAS, HTML_OK, balanceHtml, readingMinutes, renderArticle } from '../js/library/article.js';
import { GUIDE_SAMPLE, renderGuide } from '../js/library/essay-guide.js';
import { drawStandardFigure, growthSvg, runStandard, spacetimeSvg } from '../js/library/article-figures.js';
import { ESSAY_FACTS, GROWTH_MAX_STEPS, SPACETIME_MAX_STEPS, essayFacts, essayFigureSpec, essayLinkTarget } from '../js/library/essay.js';
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

const render = (md, opts = {}) => renderArticle(md, { fact: n => ({ value: n.toUpperCase(), say: '' }), figure: () => ({ html: '<svg/>' }), ...opts });

test('all of Markdown: CommonMark, GitHub\'s extensions and the rest', () => {
  const { html } = render([
    'Some *em*, **strong**, ~~gone~~, ==marked==, H~2~O, x^2^, "quoted" and https://example.org.', '',
    '- [ ] todo', '- [x] done', '  - nested', '', '3. three', '4. four', '',
    'Term', ': its definition', '', '> quoted', '', '---', '',
    '| left | right | mid |', '|:--|--:|:-:|', '| a | 1 | m |', '',
    '```js', 'const x = 1 < 2;', '```', '', '    indented code', '',
    '![a picture](https://example.org/p.png "its title")', '',
    'A line  ', 'broken by two spaces.'
  ].join('\n'));
  for (const piece of [
    '<em>em</em>', '<strong>strong</strong>', '<s>gone</s>', '<mark>marked</mark>', 'H<sub>2</sub>O', 'x<sup>2</sup>', '“quoted”',
    '<a href="https://example.org" class="textlink-inline">https://example.org</a>',
    '<li class="task-item"><input class="task-box" type="checkbox" disabled> todo</li>',
    '<input class="task-box" type="checkbox" disabled checked> done', '<li>nested</li>', '<ol start="3">',
    '<dt>Term</dt>', '<dd>its definition</dd>', '<blockquote>', '<hr>',
    '<div class="table-wrap"><table class="board essay-table">', '<th class="num">right</th>', '<td class="center">m</td>',
    '<pre class="essay-code"><code class="language-js">const x = 1 &lt; 2;', '<pre class="essay-code"><code>indented code',
    '<img src="https://example.org/p.png" alt="a picture" title="its title" loading="lazy" referrerpolicy="no-referrer" class="essay-img">',
    'A line<br>'
  ]) assert.ok(html.includes(piece), piece);
});

test('Obsidian\'s habits: callouts, folds, [[links]] and # headings', () => {
  const { html, toc } = render([
    '# Top', '', '> [!tip] A good idea', '> With a body.', '', '> [!warning]- Folded', '> Hidden until opened.', '',
    '> [!faq]+', '> Open by default, titled by its kind.', '', '## Below', '', 'See [[turing/x|that one]] and [[turing/x]].'
  ].join('\n'), { link: id => (id === 'turing/x' ? '#library=turing/x' : null) });
  assert.match(html, /<div class="callout callout-tip"><div class="callout-title">A good idea<\/div><div class="callout-body">\s*<p>With a body\.<\/p>/);
  assert.match(html, /<details class="callout callout-warning"><summary class="callout-title">Folded<\/summary>/);
  assert.match(html, /<details class="callout callout-question" open><summary class="callout-title">Faq<\/summary>/);
  assert.match(html, /<a class="textlink-inline" href="#library=turing\/x">that one<\/a> and <a class="textlink-inline" href="#library=turing\/x">turing\/x<\/a>/);
  assert.deepEqual(toc.map(t => [t.level, t.html]), [[2, 'Top'], [3, 'Below']], 'the shallowest heading is an h2: the page\'s h1 is the entry\'s title');
  assert.match(html, /<h2 id="top" class="essay-h2">Top<\/h2>/);
});

test('nothing an author writes reaches the page as markup', () => {
  const { html, warnings } = renderArticle([
    'Hello <script>alert(1)</script> & <img src=x onerror=alert(1)> <a href="https://x.org">raw</a>',
    '',
    '[bad](javascript:alert(1)) [data](data:text/html,x) [ok](https://example.org/a?b=1&c=2) <kbd>Ctrl</kbd>',
    '',
    '![tracker](http://evil.test/p.gif) ![local](p.png)',
    '',
    '<div onclick="alert(1)">x</div>',
    '',
    '| <b>x</b> |', '| --- |', '| "quoted" |'
  ].join('\n'));
  assert.doesNotMatch(html, /<script|<img src="?x|onerror="|onclick="|<a href="https:\/\/x\.org"|href="(javascript|data):|<img[^>]*evil/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &lt;img/);
  assert.match(html, /href="https:\/\/example\.org\/a\?b=1&amp;c=2"/);
  assert.match(html, /<kbd>Ctrl<\/kbd>/, 'a bare tag from the short list is kept');
  assert.match(html, /<b>x<\/b>/);
  assert.equal(warnings.filter(w => /neither http/.test(w)).length, 2);
  assert.equal(warnings.filter(w => /not an https:\/\/ address/.test(w)).length, 2, 'an image must be https, so it cannot be a tracker on a plain connection or a local file');
  assert.ok(warnings.some(w => /HTML <div onclick/.test(w)));
});

test('an author\'s unbalanced HTML stays inside the essay', () => {
  assert.equal(balanceHtml('<p>a</div></p>'), '<p>a</p>', 'a closing tag with nothing to close is dropped');
  assert.equal(balanceHtml('<details><summary>x</summary><p>y'), '<details><summary>x</summary><p>y</p></details>', 'what is left open is closed');
  assert.equal(balanceHtml('<p>a<br>b<img src="https://x"><svg><rect/></svg></p>'), '<p>a<br>b<img src="https://x"><svg><rect/></svg></p>');
  const { html } = renderArticle('Open <details><summary>more</summary> and never closed.\n\nThen a paragraph.\n\n</div></section>');
  assert.equal(html.split('<details>').length - 1, html.split('</details>').length - 1);
  assert.doesNotMatch(html, /<\/section>/, 'a </section> the essay never opened cannot close the page\'s');
});

test('code and math are set aside before emphasis, so neither is rewritten', () => {
  const { html } = render('Run `a*b*c {{steps}}` and $a_1 * b_2$ and \\(x_i\\) but *this* is emphasis; $5 and $10 are prices.\n\n$$\n\\sum_{i=1}^n i\n$$');
  assert.match(html, /<code>a\*b\*c \{\{steps\}\}<\/code>/, 'a code span is literal: no emphasis, no fact');
  assert.match(html, /\$a_1 \* b_2\$/, 'math reaches KaTeX untouched');
  assert.match(html, /\\\(x_i\\\)/);
  assert.match(html, /<em>this<\/em>/);
  assert.match(html, /<span class="md-dollar">\$<\/span>5 and <span class="md-dollar">\$<\/span>10 are prices/,
    'a price is not math — and each of its dollars is in an element of its own, so KaTeX\'s auto-render, which reads one run of text at a time, cannot pair them either');
  assert.match(render('A written \\$3.').html, /A written <span class="md-dollar">\$<\/span>3\./, '\\$ is a dollar sign');
  assert.match(html, /<div class="essay-math">\$\$\n\\sum_\{i=1\}\^n i\n\$\$<\/div>/);
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

test('footnotes are numbered in the order they are cited, written once, and a missing one is reported', () => {
  const { html, warnings } = render('First[^b], then[^a], again[^b], and[^gone].\n\n::: f\nA caption.\n:::\n\n> [!note] A title\n> body\n\n[^a]: Note A.\n[^b]: Note B.');
  const refs = [...html.matchAll(/class="fn-ref" id="fnref-([\d-]+)"><a href="#fn-(\d+)">/g)].map(m => `${m[1]}>${m[2]}`);
  assert.deepEqual(refs, ['1>1', '2>2', '1-1>1']);
  assert.match(html, /<li id="fn-1"><p>Note B\.[\s\S]*<li id="fn-2"><p>Note A\./);
  assert.equal(html.split('essay-notes').length - 1, 1, 'the list is written at the foot, not after every caption');
  assert.deepEqual(warnings, ['Footnote [^gone] has no text.']);
});

test('every id carries the prefix, and only web links open a new tab', () => {
  const { html, toc } = render('## Start here\n\nSee[^1] [out](https://x.org) and [in](#start-here).\n\n::: f\n:::\n\n[^1]: n', { idPrefix: 'lib-essay-', newTab: true });
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.sort(), ['lib-essay-figure-1', 'lib-essay-fn-1', 'lib-essay-fnref-1', 'lib-essay-start-here']);
  assert.equal(toc[0].id, 'lib-essay-start-here');
  assert.match(html, /href="https:\/\/x\.org" class="textlink-inline" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="#lib-essay-start-here" class="textlink-inline">in<\/a>/, 'an in-page link keeps its tab, and reaches the prefixed heading');
});

test('figures are numbered by the ones drawn; one that cannot be drawn is skipped and reported', () => {
  const { html, figures, warnings } = renderArticle('::: a\nFirst, with **bold**.\n:::\n\n::: nope\nGone.\n:::\n\n::: a\nSecond.\n:::', {
    figure: name => (name === 'a' ? { html: '<svg/>' } : null)
  });
  assert.equal(figures, 2);
  assert.match(html, /Figure 1\.<\/span> First, with <strong>bold<\/strong>\.[\s\S]*Figure 2\.<\/span> Second\./);
  assert.doesNotMatch(html, /Gone/);
  assert.deepEqual(warnings, ['::: nope is not a figure this machine can draw.']);
});

test('the contents list takes the headings without their footnote markers', () => {
  const { toc } = render('## Why[^1]\n\n### Detail\n\n[^1]: n');
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

// ── The writing guide ─────────────────────────────────────────────
// essay-guide.md is the documentation for all of the above, and these hold it
// to the code: every example in it renders cleanly, and every fact, figure,
// callout kind, HTML tag and limit the code has is in it.

const GUIDE = readFileSync(new URL('../js/library/essay-guide.md', import.meta.url), 'utf8');
const guideFigure = (name, args) => {
  const spec = essayFigureSpec(name, args, GUIDE_SAMPLE);
  if (!spec || spec.kind === 'diagram') return null;
  const svg = drawStandardFigure(spec.kind, spec.code, spec.opts);
  return svg && { html: svg };
};

test('the writing guide renders, examples and all, with nothing the library cannot answer', () => {
  const g = renderGuide(GUIDE, { figure: guideFigure });
  assert.deepEqual(g.warnings, []);
  assert.ok(g.examples >= 12, 'every kind of thing is shown, not only described');
  assert.match(g.html, /<div class="essay-example"><pre class="essay-code essay-example-src"[^>]*><code>/);
  assert.match(g.html, /It halts after <span class="fact"[^>]*>6<\/span> steps/, 'an example\'s facts are the sample machine\'s');
  assert.ok(g.toc.length >= 15);
});

test('the writing guide documents everything the renderer accepts, and its real limits', () => {
  for (const name of Object.keys(ESSAY_FACTS)) assert.ok(GUIDE.includes(`{{${name}}}`), `the fact {{${name}}}`);
  for (const kind of ['spacetime', 'growth', 'diagram', 'machines']) assert.ok(GUIDE.includes(`::: ${kind}`), `the figure ::: ${kind}`);
  for (const kind of new Set([...Object.keys(CALLOUT_ALIAS), ...Object.values(CALLOUT_ALIAS), 'note', 'info', 'todo', 'bug', 'example'])) {
    assert.ok(GUIDE.includes(`\`${kind}\``), `the callout kind ${kind}`);
  }
  for (const tag of HTML_OK) assert.ok(GUIDE.includes(`<${tag}>`), `the HTML tag <${tag}>`);
  assert.ok(GUIDE.includes(ARTICLE_MAX_CHARS.toLocaleString('en-US')), 'the length limit');
  assert.ok(GUIDE.includes(SPACETIME_MAX_STEPS.toLocaleString('en-US')), 'the space-time limit');
  assert.ok(GUIDE.includes(`${GROWTH_MAX_STEPS / 1e6} million`), 'the growth chart\'s budget');
  assert.equal(essayFigureSpec('spacetime', { _: [] }, GUIDE_SAMPLE).opts.steps, 2000);
  assert.ok(/2,000 unless you say/.test(GUIDE) && /\(420; 160 to 900\)/.test(GUIDE), 'the defaults it states are the defaults');
});

test('a #heading link reaches the heading, whatever the ids are prefixed with', () => {
  const { html } = renderArticle('## Far below\n\nSee [it](#far-below).', { idPrefix: 'lib-essay-' });
  assert.match(html, /id="lib-essay-far-below"/);
  assert.match(html, /href="#lib-essay-far-below"/);
  const g = renderGuide('## Target\n\n```example\n[back up](#target)\n```', { idPrefix: 'g-' });
  assert.match(g.html, /href="#g-target"/, 'a guide example\'s link reaches the guide\'s heading');
});
