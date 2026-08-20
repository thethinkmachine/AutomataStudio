import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Themes, DEFAULT_THEME } from '../js/themes.js';

// Themes are declared in two places that have to agree: a
// `:root[data-theme="id"]` block in css/variables.css (what the page paints
// from) and an entry in the `Themes` registry (what the SVG canvas, the
// minimap and the PNG export paint from). Nothing at runtime cross-checks
// them, and every failure mode here is silent -- the app boots, the picker
// lists the theme, and only some corner of the UI keeps the previous
// theme's colours.
//
// The bug that motivated this file: ~60 declarations across canvas/views/
// modals hardcoded the *dark* theme's literal rgba() values while setting
// `color:` on the same rule from a themed var(). Every one of those rules
// rendered half-themed in the other 20 themes. Because the seam is
// "a colour that is right in exactly one theme", no screenshot of the
// default theme can catch it -- hence a source-level assertion.

const root = new URL('../', import.meta.url);
const readCss = name => readFileSync(fileURLToPath(new URL(`css/${name}`, root)), 'utf8');
const VARIABLES = readCss('variables.css');

// Every stylesheet except the one that declares the palette. Read from the
// directory rather than listed by hand: the list went stale the moment
// css/lpanel.css was folded into css/panels.css, which both broke this file
// and left the merged stylesheet unscanned -- the failure mode it exists to
// catch, arriving through a rename.
const THEMED_SHEETS = readdirSync(fileURLToPath(new URL('css/', root)))
  .filter(f => f.endsWith('.css') && f !== 'variables.css')
  .sort();

// The base `:root` block IS the dark theme; the other 20 are overrides.
const cssThemeIds = [...VARIABLES.matchAll(/:root\[data-theme="([^"]+)"\]/g)].map(m => m[1]);

function themeBlock(id) {
  const head = id === DEFAULT_THEME ? ':root\\s*\\{' : `:root\\[data-theme="${id}"\\]\\s*\\{`;
  const at = VARIABLES.search(new RegExp(head));
  assert.notEqual(at, -1, `css/variables.css should declare a block for "${id}"`);
  let i = VARIABLES.indexOf('{', at) + 1;
  for (let depth = 1; depth > 0; i++) {
    if (VARIABLES[i] === '{') depth++;
    else if (VARIABLES[i] === '}') depth--;
  }
  const body = VARIABLES.slice(VARIABLES.indexOf('{', at) + 1, i - 1);
  const vars = {};
  for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return { vars, colorScheme: (body.match(/color-scheme\s*:\s*([a-z]+)/) || [])[1] };
}

const rgbOf = hex => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const relLum = rgb => {
  const c = rgb.slice(0, 3).map(v => v / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// A translucent stroke over a fill, which is what the accepting ring is.
const flatten = (fg, bg) => {
  const a = fg[3] === undefined ? 1 : fg[3];
  return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
};

test('every registry theme has a stylesheet block, and vice versa', () => {
  assert.ok(Themes[DEFAULT_THEME], 'DEFAULT_THEME must name a real entry');
  // dark is the bare `:root`, so it is deliberately absent from the overrides.
  const expected = Object.keys(Themes).filter(id => id !== DEFAULT_THEME).sort();
  assert.deepEqual(cssThemeIds.slice().sort(), expected,
    'css/variables.css and the Themes registry must list the same themes');
  assert.equal(new Set(cssThemeIds).size, cssThemeIds.length, 'no duplicate theme blocks');
});

test('every theme block overrides the same variables', () => {
  // The `light` block is the reference: it lists exactly what varies per
  // theme. A theme missing one inherits dark's value and renders wrong in
  // that one spot only.
  const reference = Object.keys(themeBlock('light').vars).sort();
  for (const id of cssThemeIds) {
    assert.deepEqual(Object.keys(themeBlock(id).vars).sort(), reference,
      `theme "${id}" must override exactly the same variables as "light"`);
  }
});

test('color-scheme matches each theme\'s background', () => {
  // Wrong here means dark scrollbars and form controls on a light page.
  for (const id of [DEFAULT_THEME, ...cssThemeIds]) {
    const { vars, colorScheme } = themeBlock(id);
    const want = relLum(rgbOf(vars['--bg'])) > 0.45 ? 'light' : 'dark';
    assert.equal(colorScheme, want, `theme "${id}" declares color-scheme: ${colorScheme}`);
  }
});

test('registry entries carry a label, a two-colour swatch and a full palette', () => {
  const keys = Object.keys(Themes[DEFAULT_THEME].export);
  for (const [id, t] of Object.entries(Themes)) {
    assert.ok(t.label, `${id} needs a label`);
    assert.equal(t.swatch?.length, 2, `${id} needs a two-colour swatch`);
    assert.deepEqual(Object.keys(t.export).sort(), keys.slice().sort(),
      `${id}.export must define the same keys as ${DEFAULT_THEME}`);
    // The picker's swatch is the theme's own colours, not a hand-picked pair.
    assert.equal(t.swatch[0].toLowerCase(), t.export.bg.toLowerCase(), `${id} swatch[0] is its bg`);
    assert.equal(t.swatch[1].toLowerCase(), t.export.actStroke.toLowerCase(), `${id} swatch[1] is its actStroke`);
  }
});

test('no stylesheet hardcodes the dark theme\'s palette', () => {
  // Each of these is a *themed* variable's dark value. Finding one outside
  // variables.css means a rule that cannot follow the theme -- the exact
  // half-themed-rule bug described at the top of this file. Neutral
  // black/white literals (shadows, scrims) are theme-agnostic and allowed.
  const darkPalette = {
    '79,195,247': '--accent / --blue',
    '105,240,174': '--green',
    '255,213,79': '--gold',
    '255,107,107': '--red',
    '206,147,216': '--purple',
    '124,77,255': '--indigo / --accent2',
    '255,183,77': '--orange',
    '179,136,255': '--violet',
  };
  const offenders = [];
  for (const file of THEMED_SHEETS) {
    readCss(file).split('\n').forEach((line, n) => {
      for (const m of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
        const key = `${m[1]},${m[2]},${m[3]}`;
        if (darkPalette[key]) offenders.push(`css/${file}:${n + 1} hardcodes ${darkPalette[key]} -- use var() or color-mix()`);
      }
    });
  }
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`);
});

test('soft and border tokens derive from their own theme\'s base colour', () => {
  // --green-soft is rgba(--green, a). If a theme's base colour is retuned
  // and the derived tokens are not, the fill and the text it sits behind
  // drift apart. All 21 themes hold this today; it is cheap to keep.
  const pairs = [
    ['--green', '--green-soft'], ['--green', '--green-border'],
    ['--gold', '--gold-soft'], ['--gold', '--gold-border'],
    ['--red', '--red-soft'], ['--red', '--red-border'],
    ['--purple', '--purple-soft'], ['--purple', '--purple-border'],
    ['--blue', '--blue-soft'], ['--blue', '--blue-border'],
    ['--orange', '--orange-soft'], ['--orange', '--orange-border'],
    ['--accent', '--accent-soft'], ['--accent', '--accent-border'],
    ['--accent', '--accent-border-strong'], ['--accent', '--focus-ring'],
    ['--accent', '--state-active-fill'], ['--accent', '--minimap-viewport'],
  ];
  for (const id of [DEFAULT_THEME, ...cssThemeIds]) {
    const { vars } = themeBlock(id);
    for (const [base, derived] of pairs) {
      const channels = vars[derived].match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      assert.ok(channels, `${id} ${derived} should be an rgba() of ${base}`);
      assert.deepEqual(channels.slice(1, 4).map(Number), rgbOf(vars[base]),
        `${id}: ${derived} must be derived from ${base} (${vars[base]})`);
    }
  }
});

test('the start and accepting rings stay visible against the state fill', () => {
  // These two rings are the only thing distinguishing a start or final
  // state, and they are drawn by the canvas from the JS palette -- so a
  // low-contrast pair is invisible rather than merely subtle. 2.5:1 is
  // below the 3:1 that WCAG 1.4.11 asks of non-text UI, chosen so this
  // guards against a genuinely unusable ring without relitigating the
  // themes that sit just under 3.
  for (const [id, t] of Object.entries(Themes)) {
    const bg = rgbOf(t.export.bg);
    const node = flatten(rgbOf(t.export.nodeFill), bg);
    for (const key of ['accStroke', 'startStroke']) {
      const ratio = contrast(flatten(rgbOf(t.export[key]), node), node);
      assert.ok(ratio >= 2.5,
        `${id}.export.${key} (${t.export[key]}) is ${ratio.toFixed(2)}:1 on nodeFill -- too faint to read`);
    }
  }
});
