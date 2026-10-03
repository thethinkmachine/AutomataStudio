import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The panel sections' cascade, which no assertion about the DOM can reach.
//
// Every bug pinned here drew the right DOM and the wrong picture: a filter box
// stretched to three hundred pixels tall, a grip left lit on a header nobody
// was focusing, a collapse arrow pushed past the panel edge, a table header
// framed wider than its rows. The stub computes no styles, so the rules are
// read from the stylesheet instead — the way tests/panel-float.test.js reads
// the window's.

const PANELS = readFileSync(new URL('../css/panels.css', import.meta.url), 'utf8');
const POLISH = readFileSync(new URL('../css/chrome-polish.css', import.meta.url), 'utf8');

/** Every `selector { … }` rule in a stylesheet, comments stripped. */
function rules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
}

/** A selector list's members — split on its own commas, not those inside `:is(…)`. */
function selectorList(selector) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The declarations of the rules whose selector list includes exactly `sel`. */
function bodiesFor(source, sel) {
  return rules(source)
    .filter(r => selectorList(r.selector).includes(sel))
    .map(r => r.body);
}

test('a search field does not grow unless a row asks it to', () => {
  // States Q's filter sits straight in its section body, and that body becomes
  // a flex column whenever States takes the panel's spare height (Transitions
  // folded) or is torn off into a tall window. A bare `flex: 1` on the field
  // grew it on that axis: it split the slack with the list, the input floated
  // in the middle of a 300px band, and the rows sat far below it.
  const base = bodiesFor(PANELS, '.search-field');
  assert.ok(base.length, 'the field\'s own rule is still here');
  base.forEach(body => assert.doesNotMatch(body, /flex\s*:\s*1\b|flex-grow\s*:\s*[1-9]/,
    '.search-field grows on whatever axis its parent runs'));
  assert.ok(bodiesFor(PANELS, '.lp-search-row .search-field').some(b => /flex\s*:\s*1\b/.test(b)),
    'beside the δ view switch it still takes the row');
});

test('a header\'s grip and pop-out are revealed by keyboard focus, not by any focus', () => {
  // The header is tabindex="0", so a click that folds a section also focuses
  // it, and nothing on the canvas takes focus back: on `:focus-within` the
  // grip and the pop-out stayed lit on whichever header was clicked last.
  const reveals = rules(PANELS).filter(r =>
    /section-header/.test(r.selector) && /\.panel-sec-grip|\.panel-float-btn/.test(r.selector) && /opacity\s*:\s*1/.test(r.body));
  assert.ok(reveals.length, 'the reveal rules are still here');
  reveals.forEach(r => assert.doesNotMatch(r.selector, /section-header:focus-within/,
    `${r.selector} reveals the controls on a mouse click`));
  assert.ok(reveals.some(r => /:focus-visible/.test(r.selector)), 'and a keyboard still reveals them');
});

test('the grip takes no room in the header row', () => {
  // In the row it held 18px through every moment it was invisible, which
  // pushed TRANSITIONS δ's collapse arrow past the edge at the panel's 220px
  // minimum and set every title in from the body under it.
  const grip = bodiesFor(PANELS, '.panel-sec-grip').join('\n');
  assert.match(grip, /position\s*:\s*absolute/);
  assert.match(POLISH, /\.lp-section-header,\s*\.rp-section-header\s*\{[^}]*position\s*:\s*relative/,
    'and the header it is placed against is positioned');
});

test('a narrow header gives way, the chips first and the title last', () => {
  // Shrink is shared by factor × basis, and when the factors in a row sum to
  // less than one only that fraction of the overflow is taken up — the rest
  // still spills. So the title shrinks at 1 (not below it), and the status
  // chip and the machine badge at far more than the title.
  const shrinkOf = body => {
    const flex = body.match(/flex\s*:\s*([\d.]+)\s+([\d.]+)/);
    if (flex) return Number(flex[2]);
    const fs = body.match(/flex-shrink\s*:\s*([\d.]+)/);
    return fs ? Number(fs[1]) : null;
  };
  const title = bodiesFor(PANELS, '.rp-section-title').map(shrinkOf).filter(v => v != null);
  assert.deepEqual(title, [1], 'the title shrinks, at exactly one');
  const status = bodiesFor(PANELS, '.sec-status').map(shrinkOf).filter(v => v != null);
  const badge = bodiesFor(PANELS, '.rp-section-header .badge').map(shrinkOf).filter(v => v != null);
  assert.ok(status.length && status.every(v => v >= 50), 'the status chip gives way well before the title');
  assert.ok(badge.length && badge.every(v => v >= 50), 'so does the machine badge');
  // Docked headers only: a window's title bar (`.panel-float > …`) is its own
  // layout, with its own controls.
  rules(PANELS).filter(r => !/panel-float/.test(r.selector)
    && /\.rp-section-title$|\.lp-section-header \.sec-lbl$/.test(selectorList(r.selector).at(-1)))
    .forEach(r => assert.doesNotMatch(r.body, /flex\s*:\s*1\s*;/, `${r.selector} goes back to a basis of zero`));
});

test('the δ table\'s header is framed where its rows are', () => {
  // A border on `.dt-head` is drawn outside its scrollbar gutter, and each
  // row's inside the host's, so the header ran ~10px past every row. The frame
  // is the header row's; the header's padding for the host's bar is measured
  // (js/delta-table.js) rather than reserved, which also stopped the table
  // sitting a gutter narrower than the fields above it with nothing to scroll.
  const head = bodiesFor(PANELS, '.dt-head').join('\n');
  assert.doesNotMatch(head, /border\s*:/, '.dt-head draws a frame of its own');
  assert.doesNotMatch(head, /scrollbar-gutter/);
  assert.match(bodiesFor(PANELS, '.dt-hrow').join('\n'), /border\s*:/, 'the header row draws it');
  assert.doesNotMatch(bodiesFor(PANELS, '.tlist.is-table').join('\n'), /scrollbar-gutter/);
});

test('the panel bodies reserve no gutter for a bar they rarely have', () => {
  // A reserved gutter is outside the scrollport, where nothing can paint: every
  // section rule and hover fill stopped ~10px short of the edge while the
  // panel header's rule ran the full width.
  for (const sel of ['.lpanel-content', '.rpanel-content']) {
    [...bodiesFor(POLISH, sel), ...bodiesFor(PANELS, sel)].forEach(body =>
      assert.doesNotMatch(body, /scrollbar-gutter\s*:\s*stable/, `${sel} reserves a gutter`));
  }
});

test('the docked fill grows only as far as its rows', () => {
  // It grew to the bottom of the panel whatever it held: fold Transitions and
  // five states stood over five hundred pixels of empty panel, with the folded
  // TRANSITIONS δ header pinned to the bottom edge. Content-sized now, shrinking
  // only when the rows are taller than the room — and with explicit floors,
  // because a section's automatic minimum is its whole content's height.
  const sec = bodiesFor(PANELS, ':is(.lpanel-content, .rpanel-content) > .sec.lp-collapsible.panel-dock-fill').join('\n');
  assert.match(sec, /flex\s*:\s*0\s+1\s+auto/, 'the fill section does not grow past its content');
  assert.match(sec, /min-height\s*:\s*var\(--dock-fill-min/, 'and its floor is the published one');
  const body = bodiesFor(PANELS, ':is(.lpanel-content, .rpanel-content) > .panel-dock-fill > .lp-section-body').join('\n');
  assert.match(body, /min-height\s*:\s*0/, 'the body may shrink, so the list inside it can');
  const region = bodiesFor(PANELS, ':is(.lpanel-content, .rpanel-content) > .panel-dock-fill .panel-dock-fill-region').join('\n');
  assert.doesNotMatch(region, /flex\s*:\s*1\s+1\s+0/, 'the list is not sized to the leftover alone');
  assert.match(region, /min-height\s*:\s*var\(--lw-floor/, 'its floor is the cap or its own rows, whichever is less');

  const LIST = readFileSync(new URL('../js/panel-list.js', import.meta.url), 'utf8');
  assert.match(LIST, /setProperty\('--lw-floor'/, 'panel-list publishes the list\'s floor');
  assert.match(LIST, /setProperty\('--dock-fill-min'/, 'and the section\'s');
  assert.match(LIST, /removeProperty\('--dock-fill-min'\)/,
    'measured with the old floor lifted, or a stale floor reads itself back as padding');
});

test('a card is padded the same on either side of the canvas', () => {
  // The left panel's bodies were 3px 14px 12px and the right's 4px 14px 14px.
  const docked = bodiesFor(PANELS, ':is(.lpanel-content, .rpanel-content) .lp-section-body').join('\n');
  const right = bodiesFor(PANELS, '.rp-section-body').join('\n');
  assert.match(docked, /padding\s*:\s*var\(--sec-body-pad\)/);
  assert.match(right, /padding\s*:\s*var\(--sec-body-pad\)/);
  assert.ok(rules(PANELS).some(r => /:is\(\.lpanel-content, \.rpanel-content\) :is\(\.lp-section-header, \.rp-section-header\)/.test(r.selector)
    && /padding-left\s*:\s*var\(--sec-head-pad-start\)/.test(r.body)),
    'and both panels\' headers leave the grip the same room before the title');
});

test('the chrome\'s shadow on the canvas lies over the diagram and under the controls', () => {
  // An inset shadow on .canvas-area itself would paint under the grid and the
  // diagram; the overlay casts it across them. It must take no pointer, or the
  // canvas stops receiving clicks, and must sit below the floating chrome (49
  // and up: toolbox, minimap, label editor, status), or it shades them too.
  const VIEWS = readFileSync(new URL('../css/views.css', import.meta.url), 'utf8');
  const well = bodiesFor(VIEWS, '.canvas-area::after').join('\n');
  assert.match(well, /pointer-events\s*:\s*none/);
  assert.match(well, /box-shadow\s*:[^;]*inset/);
  const z = Number((well.match(/z-index\s*:\s*(\d+)/) || [])[1]);
  assert.ok(z > 0 && z < 49, `z-index ${z} is not between the diagram and the chrome`);
  assert.match(well, /--tab-overflow-shadow/, 'its ink is the theme-tuned edge colour, not a literal');
});
