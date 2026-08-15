import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

// ══════════════════════════════════════════════════════════════════
//  MARKDOWN
// ══════════════════════════════════════════════════════════════════
//  The renderer's whole security design is that it builds nodes and never
//  assigns markup, so the tests are about node *shape* rather than about a
//  string of HTML — there is no string of HTML anywhere in the pipeline.
//
//  Its input is text from a remote model. The last group of tests is the one
//  that matters most: everything an attacker would try, arriving as content.

const h = createHarness();
const { renderMarkdown, parseBlocks, inlineNodes, safeUrl, document } = h.context;

function render(src) {
  const host = document.createElement('div');
  renderMarkdown(src, host);
  return host;
}

/** The rendered tree as `tag[.class]` strings, depth-first — text nodes skipped. */
function shape(node) {
  return (node.children || [])
    .filter(c => c.tagName)
    .map(c => {
      const tag = String(c.tagName).toLowerCase();
      const kids = shape(c);
      return kids.length ? `${tag}(${kids.join(' ')})` : tag;
    });
}

function text(node) {
  if (!node || typeof node !== 'object') return '';
  const own = typeof node.textContent === 'string' ? node.textContent : '';
  return `${own}${(node.children || []).map(text).join('')}`;
}

function tags(node, want) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach(c => {
      if (c.tagName && String(c.tagName).toLowerCase() === want) out.push(c);
      walk(c);
    });
  })(node);
  return out;
}

// ── blocks ────────────────────────────────────────────────────────

test('paragraphs, headings and rules become their own elements', () => {
  const host = render('# Title\n\nFirst para.\n\n---\n\n## Next\n\nSecond.');
  assert.deepEqual(shape(host), ['h1', 'p', 'hr', 'h2', 'p']);
  assert.equal(text(host.children[0]), 'Title');
  assert.equal(text(host.children[1]), 'First para.');
});

test('a soft break joins a line, two spaces break it', () => {
  const soft = render('one\ntwo');
  assert.equal(text(soft), 'one two');

  const hard = render('one  \ntwo');
  assert.equal(tags(hard, 'br').length, 1);
});

test('fenced code keeps its text verbatim, markers and all', () => {
  const host = render('Try:\n\n```js\nif (a && b) { return "**x**"; }\n```\n');
  assert.deepEqual(shape(host), ['p', 'pre(code)']);
  const code = tags(host, 'code')[0];
  assert.equal(code.textContent, 'if (a && b) { return "**x**"; }');
  assert.equal(code.getAttribute('data-lang'), 'js');
});

test('lists nest, and an ordered list keeps its start', () => {
  const host = render([
    '- outer',
    '    - inner one',
    '    - inner two',
    '- second'
  ].join('\n'));
  assert.deepEqual(shape(host), ['ul(li(ul(li li)) li)']);

  const ordered = render('3. three\n4. four');
  assert.equal(String(ordered.children[0].tagName).toLowerCase(), 'ol');
  assert.equal(ordered.children[0].getAttribute('start'), '3');
});

test('a tight bullet is its own text; a loose one gets paragraphs', () => {
  const tight = render('- one\n- two');
  assert.deepEqual(shape(tight), ['ul(li li)'], 'no paragraph wrapper to space it out');

  const loose = render('- one\n\n- two');
  assert.deepEqual(shape(loose), ['ul(li(p) li(p))']);
});

test('blockquotes hold blocks of their own', () => {
  const host = render('> quoted **text**\n>\n> - a bullet');
  assert.deepEqual(shape(host), ['blockquote(p(strong) ul(li))']);
});

test('a pipe table becomes a table, ragged rows padded', () => {
  const host = render([
    '| State | Accepting |',
    '|-------|:---------:|',
    '| q0    | yes       |',
    '| q1    |'
  ].join('\n'));

  assert.deepEqual(shape(host), ['div(table(thead(tr(th th)) tbody(tr(td td) tr(td td))))']);
  const table = tags(host, 'table')[0];
  assert.equal(text(tags(table, 'th')[1]), 'Accepting');
  assert.equal(tags(table, 'th')[1].style.textAlign, 'center');
  // A short row is padded rather than dropped: generated tables are ragged.
  assert.equal(text(tags(table, 'tr')[2]), 'q1');
});

// ── inline ────────────────────────────────────────────────────────

test('emphasis, strong, strike and code nest inside each other', () => {
  const host = render('**bold `code`** and *em* and ~~gone~~');
  assert.deepEqual(shape(host), ['p(strong(code) em del)']);
  assert.equal(text(host), 'bold code and em and gone');
});

test('an underscore inside a word is a character, not emphasis', () => {
  // q_0 and snake_case are ordinary text in a tool about automata — this is
  // the single most common way a naive renderer mangles a reply.
  const host = render('State q_0 moves to q_1 in some_long_name.');
  assert.deepEqual(shape(host), ['p'], 'no <em> anywhere');
  assert.equal(text(host), 'State q_0 moves to q_1 in some_long_name.');
});

test('a lone asterisk is multiplication, not an unclosed run', () => {
  const host = render('the product a * b is fine');
  assert.deepEqual(shape(host), ['p']);
  assert.equal(text(host), 'the product a * b is fine');
});

test('math is passed through verbatim, before emphasis can touch it', () => {
  // KaTeX renders this afterwards, so the delimiters have to survive — and
  // the asterisk inside must not be read as an emphasis run.
  const host = render('The language $L = \\{a^n * b_1 \\mid n > 0\\}$ is not regular.');
  assert.deepEqual(shape(host), ['p'], 'nothing was claimed as emphasis');
  assert.match(text(host), /\$L = \\\{a\^n \* b_1 \\mid n > 0\\\}\$/);

  const display = render('$$\n\\delta(q, a) = q\n$$');
  assert.match(text(display), /\$\$/);
});

test('escapes are honoured', () => {
  const host = render('literal \\*stars\\* and a \\_score\\_');
  assert.deepEqual(shape(host), ['p']);
  assert.equal(text(host), 'literal *stars* and a _score_');
});

// ── links: the only thing that can leave the page ─────────────────

test('http, https and mailto become links; everything else stays text', () => {
  assert.equal(safeUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl('/relative/path'), '', 'a relative link means nothing here');
  // Control characters are how "java\nscript:" gets past a naive check.
  assert.equal(safeUrl('java\nscript:alert(1)'), '');
  assert.equal(safeUrl('  JAVASCRIPT:alert(1)'), '');
});

test('a link carries rel and target; a rejected one renders as its text', () => {
  const ok = render('see [the docs](https://example.com/docs)');
  const a = tags(ok, 'a')[0];
  assert.equal(a.getAttribute('href'), 'https://example.com/docs');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer nofollow');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(text(a), 'the docs');

  const bad = render('see [click me](javascript:alert(document.cookie))');
  assert.equal(tags(bad, 'a').length, 0, 'no anchor is created at all');
  assert.match(text(bad), /click me/, 'the label survives as plain text');
});

test('a bare URL is linked, an autolink is linked', () => {
  assert.equal(tags(render('go to https://example.com now'), 'a').length, 1);
  assert.equal(tags(render('<https://example.com>'), 'a').length, 1);
  assert.equal(tags(render('<not a url>'), 'a').length, 0);
});

test('an image is shown as a label and a link, never as a request', () => {
  // An <img> is a request to a third party the moment it is drawn — a
  // tracking pixel a model can plant just by answering.
  const host = render('![a diagram](https://example.com/pixel.png)');
  assert.equal(tags(host, 'img').length, 0);
  assert.equal(tags(host, 'a').length, 1);
  assert.match(text(host), /a diagram/);
});

// ── the injection surface ─────────────────────────────────────────
//  Everything below arrives as content because the renderer has no HTML
//  parser to get past — there is no innerHTML assignment in the module.

test('markup in a reply is text, not markup', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://evil.test"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    '<style>body{display:none}</style>',
    '<svg/onload=alert(1)>',
    '<div onclick="alert(1)">x</div>',
    '[x](javascript&colon;alert(1))',
    '<!-- --><script>alert(1)</script>'
  ];
  for (const attack of attacks) {
    const host = render(attack);
    for (const tag of ['script', 'img', 'iframe', 'style', 'svg', 'div', 'object', 'embed']) {
      assert.equal(tags(host, tag).length, 0, `${attack} produced a <${tag}>`);
    }
    // Whatever anchors survive are anchors with a scheme that cannot execute.
    // An https address written inside literal markup still auto-links, and
    // that is fine — what must never happen is a live javascript: href.
    tags(host, 'a').forEach(a => {
      assert.match(a.getAttribute('href'), /^(https?:|mailto:)/, attack);
    });
    if (attack.includes('<')) {
      assert.ok(text(host).includes('<'), `${attack} is shown as what it is`);
    }
  }
});

test('the renderer never assigns markup', () => {
  // The property the tests above rely on, asserted at the source rather than
  // inferred: the only innerHTML in the module is the clear on entry.
  const src = readFileSync(new URL('../js/markdown.js', import.meta.url), 'utf8');
  const writes = src.match(/innerHTML\s*=\s*(.*)/g) || [];
  assert.deepEqual(writes.map(w => w.trim()), ["innerHTML = '';   // clearing only — no markup is ever assigned"]);
  assert.ok(!/insertAdjacentHTML|outerHTML|document\.write/.test(src));
});

test('malformed input terminates and renders something', () => {
  // A truncated stream is a normal way for a reply to arrive.
  const cases = [
    '```\nunclosed fence',
    '**unclosed bold',
    '| a | b\n|---',
    '- item\n  - ',
    '[link](',
    '$unclosed math',
    '#'.repeat(80),
    '> '.repeat(200)
  ];
  for (const src of cases) {
    const host = render(src);
    assert.ok(host, src);
  }
});

test('parseBlocks and inlineNodes are usable on their own', () => {
  assert.deepEqual(parseBlocks(['# a', '', 'b']).map(b => b.type), ['heading', 'para']);
  assert.equal(inlineNodes('plain').length, 1);
});
