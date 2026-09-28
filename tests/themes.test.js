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

// The base `:root` block IS the dark theme; every other theme is an override.
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
    '94,161,255': '--accent / --blue',
    '77,202,139': '--green',
    '240,193,75': '--gold',
    '242,109,109': '--red',
    '214,140,242': '--purple',
    '139,147,255': '--indigo',
    '245,154,69': '--orange',
    '167,139,250': '--violet',
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
    ['--accent', '--state-active-fill'],
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

test('the minimap viewport frame is its own theme\'s accent', () => {
  // The minimap paints from the `Themes` registry rather than from CSS, so
  // this is the value on screen -- there is no `--minimap-viewport` to read.
  // Same reasoning as the soft/border pairs above: retune --accent and the
  // frame drifts off the theme it is framing.
  for (const id of [DEFAULT_THEME, ...cssThemeIds]) {
    const stroke = Themes[id].export.viewportStroke;
    const channels = stroke.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    assert.ok(channels, `${id} viewportStroke should be an rgba() of --accent`);
    assert.deepEqual(channels.slice(1, 4).map(Number), rgbOf(themeBlock(id).vars['--accent']),
      `${id}: viewportStroke must be derived from --accent`);
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

// ── The design rules in js/themes.js, enforced ───────────────────────
// Four colours are semantic on the canvas (accent = the state the run is in,
// green = start, gold = accepting, red = rejection), and the ink colours are
// legibility floors. These held only as prose until every theme was rebuilt
// against them; a borrowed palette dropped in without checking breaks one of
// them almost every time, so they are tests now.

const allThemes = () => [DEFAULT_THEME, ...cssThemeIds].map(id => ({ id, ...themeBlock(id) }));

// OKLCH hue, which is what "far apart in hue" means to an eye. HSL hue is
// badly non-uniform: it puts Solarized's cyan and blue 30deg apart when they
// read as clearly different, and olive and mustard 23deg apart when they
// read as nearly the same.
const oklchHue = hex => {
  const [r, g, b] = rgbOf(hex).map(v => v / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360;
};
const hueGap = (x, y) => { const d = Math.abs(oklchHue(x) - oklchHue(y)) % 360; return d > 180 ? 360 - d : d; };

test('the four semantic colours are at least 30deg apart in hue', () => {
  // Closer than this and a machine misreads: an accepting state looks
  // active, or a start state looks accepting. Several borrowed palettes
  // fail it as shipped -- Ayu's accent *is* its gold, Everforest's accent
  // *is* its green -- which is why a port maps its colours onto these
  // four roles rather than copying the upstream accent.
  const roles = ['--accent', '--green', '--gold', '--red'];
  for (const { id, vars } of allThemes()) {
    for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
      const gap = hueGap(vars[roles[i]], vars[roles[j]]);
      assert.ok(gap >= 30, `${id}: ${roles[i]} and ${roles[j]} are ${gap.toFixed(0)}deg apart`);
    }
  }
});

test('rings and highlight strokes reach 3:1 on the canvas and on both node fills', () => {
  // A node is --surface at rest and --surface2 under the pointer, and sits
  // on --bg. Accent is easy to forget here because it is mostly thought of
  // as chrome, and it is the one that stops a pastel theme from having an
  // invisible active state. Purple is selection, indigo the incoming-edge
  // highlight.
  for (const { id, vars } of allThemes()) {
    for (const k of ['--accent', '--green', '--gold', '--red', '--purple', '--indigo']) {
      for (const on of ['--bg', '--surface', '--surface2']) {
        const ratio = contrast(rgbOf(vars[k]), rgbOf(vars[on]));
        assert.ok(ratio >= 3, `${id}: ${k} is ${ratio.toFixed(2)}:1 on ${on}`);
      }
    }
  }
});

test('ink meets its floors: text 7:1, text2 4.5:1, text3 3:1', () => {
  // text3 is also the edge stroke, so it is a legibility floor rather than a
  // hint colour. text2 is set on cards as well as on the chrome.
  const floors = [['--text', 7, ['--bg', '--bg2']], ['--text2', 4.5, ['--bg', '--bg2', '--surface']],
    ['--text3', 3, ['--bg', '--bg2']]];
  for (const { id, vars } of allThemes()) {
    for (const [k, min, planes] of floors) for (const on of planes) {
      const ratio = contrast(rgbOf(vars[k]), rgbOf(vars[on]));
      assert.ok(ratio >= min, `${id}: ${k} is ${ratio.toFixed(2)}:1 on ${on} (needs ${min})`);
    }
  }
});

test('button labels on the accent reach 4.5:1', () => {
  for (const { id, vars } of allThemes()) {
    const ratio = contrast(rgbOf(vars['--on-accent']), rgbOf(vars['--accent']));
    assert.ok(ratio >= 4.5, `${id}: --on-accent is ${ratio.toFixed(2)}:1 on --accent`);
  }
});

test('a rejected state is visibly washed', () => {
  // --state-reject-fill is red over the node fill. In a theme whose surfaces
  // lean red the wash can vanish into the fill it tints.
  for (const { id, vars } of allThemes()) {
    const [, r, g, b, a] = vars['--state-reject-fill'].match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)/).map(Number);
    const fill = rgbOf(vars['--surface']);
    const washed = flatten([r, g, b, a], fill);
    const dist = Math.hypot(...washed.map((v, i) => v - fill[i]));
    assert.ok(dist >= 18, `${id}: the reject wash moves the fill by only ${dist.toFixed(1)}`);
  }
});

test('the export palette is the stylesheet\'s own colours', () => {
  // The minimap, the PNG export and the picker's preview paint from
  // Themes[id].export, the live canvas from CSS. When the two were written
  // by hand they drifted -- half the registry exported --surface2 as the
  // node fill while the canvas drew --surface -- so each field is pinned to
  // the variable the canvas actually paints that part with.
  const map = { bg: '--bg', nodeFill: '--surface', nodeStroke: '--border2', startStroke: '--green',
    accStroke: '--gold', actFill: '--state-active-fill', actStroke: '--accent', edgeStroke: '--text3',
    textFill: '--text2', nodeTextFill: '--text' };
  const norm = v => v.toLowerCase().replace(/\s+/g, '');
  for (const { id, vars } of allThemes()) {
    for (const [field, cssVar] of Object.entries(map)) {
      assert.equal(norm(Themes[id].export[field]), norm(vars[cssVar]),
        `${id}.export.${field} should be its ${cssVar}`);
    }
  }
});
