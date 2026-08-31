import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOutlines, planOutlines, resetGlyphCache } from '../js/glyphs.js';

// Turning an exported diagram's text into outlines.
//
// The point of the feature is that an exported file carries its own type: the
// scraped stylesheet in buildExportSVG cannot include the @font-face rules (the
// Google Fonts sheet is cross-origin, so `sheet.cssRules` throws), and PNG
// could not use them anyway, because an SVG rasterised through `img.src =
// blob:` fetches no external resources at all. A path needs no font.
//
// Two properties matter more than fidelity and are what most of this file is
// about. **A run is converted completely or not at all** -- half a label in
// outlines and half in text would be worse than either, and the count of what
// was left is what tells exportPNG it still needs to embed a face. And **the
// live tree is measured while only the clone is written**, so an export never
// disturbs what is on screen.

const SVG_NS = 'http://www.w3.org/2000/svg';

// A face table of the shape scripts/build-glyphs.mjs writes. Deliberately
// hand-made rather than loaded: these tests are about the conversion, and a
// two-glyph font makes "this character has no outline" easy to arrange.
const TABLES = new Map([
  ['mono-400', { upem: 1000, glyphs: { a: 'm0 0l100 0l0 100z', b: 'm0 0l50 0z', ' ': '' } }],
  ['mono-500', { upem: 1000, glyphs: { a: 'm0 0l120 0l0 120z', b: 'm0 0l60 0z', ' ': '' } }],
  ['sans-400', { upem: 1000, glyphs: { a: 'm0 0l90 0z' } }],
  ['math-400', { upem: 1000, glyphs: { '⊢': 'm0 0l10 0z' } }]
]);

// ── a fake SVG, just measurable enough ───────────────────────────────────────
//
// js/glyphs.js imports nothing and reads no App, so it can be handed a tree of
// plain objects. What it actually requires of one is small and worth stating:
// querySelectorAll('text'), the character-measuring half of
// SVGTextContentElement, and a computed style.

let styles = new Map();

function el(tagName, props = {}) {
  const node = {
    tagName: tagName.toUpperCase(),
    children: [],
    parentNode: null,
    textContent: '',
    _attrs: new Map(),
    ...props,
    setAttribute(name, value) { this[name] = value; this._attrs.set(name, String(value)); },
    setAttributeNS(ns, name, value) { this.setAttribute(name, value); },
    getAttribute(name) { return this[name] === undefined ? null : this[name]; },
    get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child, ref) {
      const i = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(i < 0 ? this.children.length : i, 0, child);
      child.parentNode = this;
      return child;
    },
    replaceChild(next, prev) {
      const i = this.children.indexOf(prev);
      this.children.splice(i, 1, next);
      next.parentNode = this;
      prev.parentNode = null;
    },
    replaceWith(next) { if (this.parentNode) this.parentNode.replaceChild(next, this); },
    getElementsByTagName(tag) {
      const want = tag.toUpperCase();
      const out = [];
      const walk = n => n.children.forEach(c => { if (c.tagName === want) out.push(c); walk(c); });
      walk(this);
      return out;
    },
    get firstChild() { return this.children[0] || null; },
    querySelectorAll(sel) {
      const want = sel.toUpperCase();
      const out = [];
      const walk = n => n.children.forEach(c => { if (c.tagName === want) out.push(c); walk(c); });
      walk(this);
      return out;
    }
  };
  return node;
}

// A <text> that can say where each of its characters is. The positions are a
// simple 10px pitch: nothing here depends on them being realistic, only on the
// outlines landing where the measurement said.
function text(content, style = {}, measurable = true) {
  const node = el('text', { textContent: content });
  if (measurable) {
    node.getNumberOfChars = () => content.length;
    node.getStartPositionOfChar = i => ({ x: i * 10, y: 50 });
  }
  styles.set(node, {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '11px',
    fontWeight: '400',
    fontStyle: 'normal',
    fill: 'rgb(20, 20, 20)',
    fillOpacity: '1',
    stroke: 'none',
    strokeWidth: '0',
    strokeOpacity: '1',
    strokeLinejoin: 'round',
    opacity: '1',
    paintOrder: 'normal',
    textDecorationLine: 'none',
    ...style
  });
  return node;
}

function svgWith(...texts) {
  const root = el('svg');
  texts.forEach(t => root.appendChild(t));
  return root;
}

// The clone is a structural copy that keeps the same tag order, which is what
// planOutlines pairs against. It is deliberately *not* measurable: measuring
// happens on the live tree only.
function cloneOf(root) {
  const copy = el(root.tagName);
  root.children.forEach(child => {
    const c = el(child.tagName, { textContent: child.textContent });
    for (const { name, value } of child.attributes) c.setAttribute(name, value);
    child.children.forEach(gc => {
      const g = el(gc.tagName, { textContent: gc.textContent });
      for (const { name, value } of gc.attributes) g.setAttribute(name, value);
      c.appendChild(g);
    });
    copy.appendChild(c);
  });
  return copy;
}

function setup() {
  styles = new Map();
  resetGlyphCache();
  globalThis.getComputedStyle = node => styles.get(node) || {};
  globalThis.document = {
    createElementNS: (ns, name) => el(name),
    documentElement: { dataset: {} }
  };
}

function convert(live) {
  const clone = cloneOf(live);
  const plan = planOutlines(live, clone);
  const result = applyOutlines(plan, TABLES, clone);
  return { clone, plan, result };
}

// The glyph cache is prepended to the root, so the diagram's own children start
// after it. Every assertion about what replaced what looks past it.
const kinds = root => root.children.filter(c => c.tagName !== 'DEFS').map(c => c.tagName);
const group = (root, i = 0) => root.children.filter(c => c.tagName !== 'DEFS')[i];
const uses = root => root.querySelectorAll('use');
const defs = root => root.querySelectorAll('path');

// ── what it converts ─────────────────────────────────────────────────────────

test('a label becomes outlines and stops being text', () => {
  setup();
  const { clone, result } = convert(svgWith(text('ab')));

  assert.equal(result.converted, 1);
  assert.equal(result.left, 0);
  assert.ok(!kinds(clone).includes('TEXT'), 'the <text> is gone');
  assert.equal(uses(clone).length, 2, 'one <use> per character');
});

test('a repeated character costs a reference, not a second outline', () => {
  setup();
  // Three labels, six characters, two distinct glyphs. That ratio is the whole
  // reason outlines are smaller than an embedded font on a real machine, where
  // a diagram says `q0`, `q1`, `q2` far more than it introduces new letters.
  const { clone } = convert(svgWith(text('ab'), text('ba'), text('aa')));

  assert.equal(uses(clone).length, 6);
  assert.equal(defs(clone).length, 2, 'one <path> per distinct glyph');
});

test('the glyph cache is prepended, so every <use> can reach it', () => {
  setup();
  const { clone } = convert(svgWith(text('ab')));

  // A <use> is resolved against the document it lands in, and the exporter goes
  // on to insert the stylesheet and the background rect ahead of it too.
  assert.equal(clone.children[0].tagName, 'DEFS');
  assert.equal(defs(clone).length, 2);
});

test('a glyph is placed where the browser said the character was', () => {
  setup();
  const { clone } = convert(svgWith(text('ab')));
  const [first, second] = uses(clone);

  // 11px over a 1000-unit em, and the font's y-up flipped to the document's
  // y-down. Getting either wrong puts every label somewhere else entirely.
  assert.match(first.getAttribute('transform'), /^translate\(0 50\) scale\(0\.011 -0\.011\)$/);
  assert.match(second.getAttribute('transform'), /^translate\(10 50\)/);
});

test('the outline is referenced both ways, for consumers that predate SVG 2', () => {
  setup();
  const { clone } = convert(svgWith(text('a')));
  const use = uses(clone)[0];

  assert.equal(use.getAttribute('href'), use.getAttribute('xlink:href'));
  assert.match(use.getAttribute('href'), /^#gl-mono-400-61$/);
});

test('a space is measured and draws nothing', () => {
  setup();
  // It is in the table with an empty outline, which is not the same as a
  // character the face does not have -- only the second is a reason to refuse.
  const { clone, result } = convert(svgWith(text('a b')));

  assert.equal(result.converted, 1);
  assert.equal(uses(clone).length, 2, 'the space contributes no <use>');
});

// ── what it refuses, and why that is the point ───────────────────────────────

test('a character with no outline leaves its whole label as text', () => {
  setup();
  const { clone, result } = convert(svgWith(text('a中b')));

  assert.equal(result.converted, 0);
  assert.equal(result.left, 1, 'the caller is told there is still text');
  assert.deepEqual(kinds(clone), ['TEXT'], 'the element is untouched');
  assert.equal(defs(clone).length, 0, 'and the glyphs it did resolve are not emitted');
});

test('one refused label does not stop the others', () => {
  setup();
  const { clone, result } = convert(svgWith(text('ab'), text('中'), text('ba')));

  assert.equal(result.converted, 2);
  assert.equal(result.left, 1);
  assert.deepEqual(kinds(clone), ['G', 'TEXT', 'G']);
});

test('a family with no table of its own is left alone', () => {
  setup();
  const { clone, result } = convert(svgWith(text('a', { fontFamily: 'Comic Sans MS, cursive' })));

  assert.equal(result.converted, 0);
  assert.deepEqual(kinds(clone), ['TEXT'], 'better as text than drawn in the wrong face');
});

test('collapsed white space is refused rather than mis-indexed', () => {
  setup();
  // SVG collapses white space before assigning character indices, so a run
  // whose string is longer than its addressable length would put every glyph
  // after the collapse under the wrong character.
  const node = text('a  b');
  node.getNumberOfChars = () => 3;
  const { clone, result } = convert(svgWith(node));

  assert.equal(result.converted, 0);
  assert.deepEqual(kinds(clone), ['TEXT']);
});

test('without the measuring API nothing is converted', () => {
  setup();
  // The Node test DOM, and any other environment that stubs SVG. Guessing at
  // positions would be a second implementation of text layout.
  const { clone, result } = convert(svgWith(text('ab', {}, false)));

  assert.equal(result.converted, 0);
  assert.deepEqual(kinds(clone), ['TEXT']);
});

test('trees that do not correspond are refused outright', () => {
  setup();
  const live = svgWith(text('ab'), text('ba'));
  const clone = cloneOf(live);
  clone.children[0].parentNode = null;
  clone.children.shift();

  // Pairing by index is only sound while the two are structurally identical, so
  // a caller that edited the clone first must outline nothing rather than
  // outline the wrong elements.
  const result = applyOutlines(planOutlines(live, clone), TABLES, clone);
  assert.equal(result.converted, 0);
});

test('a planned element the caller then dropped is skipped, not thrown over', () => {
  setup();
  // buildExportSVG plans before it strips notes and dividers, because the plan
  // pairs by index. What it removes afterwards has nothing left to replace.
  const live = svgWith(text('ab'), text('ba'));
  const clone = cloneOf(live);
  const plan = planOutlines(live, clone);
  clone.children[0].parentNode = null;
  clone.children.shift();

  const result = applyOutlines(plan, TABLES, clone);
  assert.equal(result.converted, 1);
});

// ── the styling the outlines have to carry over ──────────────────────────────

test('paint is resolved and written inline, never inherited from a class', () => {
  setup();
  const { clone } = convert(svgWith(text('a', { fill: 'rgb(1, 2, 3)' })));
  const ink = group(clone).children[0];

  // getComputedStyle has already turned every theme variable into a literal, and
  // the class is deliberately dropped: several canvas rules select the element
  // type (`.edge-pill text { fill: ... }`) and would stop matching anyway, while
  // a class rule from the scraped stylesheet would outrank the attribute.
  assert.equal(ink.getAttribute('fill'), 'rgb(1, 2, 3)');
});

test('a halo is a separate pass, so a glyph cannot be drawn over its neighbour', () => {
  setup();
  // .tlbl paints a halo behind an edge label so the line does not run through
  // its own caption. As a per-glyph paint-order it would lay each glyph's halo
  // over the previous glyph's fill.
  const { clone } = convert(svgWith(text('ab', {
    stroke: 'rgb(9, 9, 9)', strokeWidth: '3', paintOrder: 'stroke fill'
  })));
  const [halo, ink] = group(clone).children;

  assert.equal(halo.getAttribute('fill'), 'none');
  assert.equal(halo.getAttribute('stroke'), 'rgb(9, 9, 9)');
  assert.equal(ink.getAttribute('stroke'), null);
  assert.equal(halo.children.length, 2);
  assert.equal(ink.children.length, 2);
});

test('a weight past the heaviest master is stroked, not faked with another face', () => {
  setup();
  // JetBrains Mono is loaded at 300/400/500, so 600 and 700 are already
  // synthesised by the browser. .state-sub asks for 600 and .priority-value
  // for 700, and both have to still read as bolder than the label beside them.
  const plain = convert(svgWith(text('a', { fontWeight: '500' })));
  const bold = convert(svgWith(text('a', { fontWeight: '700' })));

  assert.equal(group(plain.clone).children[0].getAttribute('stroke'), null);
  const strokeWidth = Number(group(bold.clone).children[0].getAttribute('stroke-width'));
  assert.ok(strokeWidth > 0 && strokeWidth < 1, `expected a hairline, got ${strokeWidth}`);
});

test('the weight picks the nearest master at or below it', () => {
  setup();
  const light = convert(svgWith(text('a', { fontWeight: '400' })));
  const medium = convert(svgWith(text('a', { fontWeight: '500' })));

  assert.match(uses(light.clone)[0].getAttribute('href'), /mono-400/);
  assert.match(uses(medium.clone)[0].getAttribute('href'), /mono-500/);
});

test('italic is a shear, since there is no italic master to reach for', () => {
  setup();
  const { clone } = convert(svgWith(text('a', { fontStyle: 'italic' })));
  const transform = uses(clone)[0].getAttribute('transform');

  // Inside the y-flip, where the glyph's own baseline is y = 0 and a positive
  // shear leans the top to the right.
  assert.match(transform, /matrix\(1 0 0\.25 1 0 0\)$/);
});

test('an underline is drawn, because an outline does not carry one', () => {
  setup();
  // The browser drew this for a note's underlined run and the paths do not.
  const { clone } = convert(svgWith(text('ab', { textDecorationLine: 'underline' })));
  const rule = clone.querySelectorAll('rect')[0];

  assert.ok(rule, 'an underlined run gets a rule');
  assert.equal(rule.getAttribute('x'), 0);
  assert.ok(Number(rule.getAttribute('width')) > 0);
});

test('a family falls back per character, not per label', () => {
  setup();
  // JetBrains Mono has no U+22A2 RIGHT TACK -- which is the left end marker on
  // every LBA and two-way machine the app can draw. Refusing the label would
  // mean no tape machine ever exports outlines.
  const { clone, result } = convert(svgWith(text('a⊢')));

  assert.equal(result.converted, 1);
  const [latin, tack] = uses(clone);
  assert.match(latin.getAttribute('href'), /mono-400/);
  assert.match(tack.getAttribute('href'), /math-400/);
});

// ── the layout attributes that must not come along ───────────────────────────

test('the group keeps the element but not its text layout', () => {
  setup();
  const node = text('a');
  node.setAttribute('clip-path', 'url(#note-clip)');
  node.setAttribute('transform', 'translate(4 4)');
  node.setAttribute('text-anchor', 'middle');
  node.setAttribute('x', '100');
  node.setAttribute('font-size', '11px');
  const { clone } = convert(svgWith(node));
  const g = group(clone);

  // The clip is what keeps a long note inside its own box, and the transform is
  // the space the measured positions are in -- both have to survive. The
  // layout attributes must not: the glyphs carry their positions by now, and a
  // stray text-anchor or x on the group would move every one of them.
  assert.equal(g.getAttribute('clip-path'), 'url(#note-clip)');
  assert.equal(g.getAttribute('transform'), 'translate(4 4)');
  assert.equal(g.getAttribute('text-anchor'), null);
  assert.equal(g.getAttribute('x'), null);
  assert.equal(g.getAttribute('font-size'), null);
});

test('the live tree is never written to', () => {
  setup();
  const live = svgWith(text('ab'), text('ba'));
  const before = kinds(live);
  convert(live);

  // An export must not disturb what is on screen, and this module is handed the
  // live tree purely to measure it.
  assert.deepEqual(kinds(live), before);
  assert.deepEqual(before, ['TEXT', 'TEXT']);
});

// ── the shipped tables ───────────────────────────────────────────────────────

test('the built tables cover the symbols the app puts on a diagram', () => {
  // App.config.sym, plus what the machine families draw. A regenerated table
  // that dropped a subset would leave every tape machine exporting text, and
  // nothing else in the app would notice.
  const faces = ['mono-400', 'mono-500', 'sans-400', 'math-400']
    .map(id => JSON.parse(readFileSync(new URL(`../js/glyphs/${id}.json`, import.meta.url), 'utf8')));
  const somewhere = ch => faces.some(f => f.glyphs[ch] !== undefined);

  for (const ch of 'abqz01ελΣΓ⊔⊢⊣→⋯₀') {
    assert.ok(somewhere(ch), `no face has an outline for U+${ch.codePointAt(0).toString(16)}`);
  }
});

test('every shipped outline is a closed path in font units', () => {
  for (const id of ['mono-400', 'mono-500', 'sans-400', 'math-400']) {
    const face = JSON.parse(readFileSync(new URL(`../js/glyphs/${id}.json`, import.meta.url), 'utf8'));
    assert.ok(face.upem > 0, `${id}: no unitsPerEm`);

    for (const [ch, d] of Object.entries(face.glyphs)) {
      if (d === '') continue;                       // a space, legitimately blank
      assert.match(d, /^m/, `${id} ${ch}: does not start with a move`);
      assert.match(d, /z$/, `${id} ${ch}: is not closed`);
      // Relative commands only -- the encoding is what keeps the tables small,
      // and an absolute coordinate slipping in would be drawn from the origin.
      assert.ok(!/[MLQCZAHVS]/.test(d), `${id} ${ch}: has an absolute command`);
    }
  }
});
