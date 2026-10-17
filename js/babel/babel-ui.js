// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — THE PAGES
// ══════════════════════════════════════════════════════════════════
// A wing of the Library view (library-ui.js registers these pages and puts
// them in its rail), holding every machine that has ever been conceived or
// ever will be. Four pages, one place each:
//
//   babel          the Entrance: a title page with one field that reads as
//                  you type, example plates under it, and the galleries — a
//                  row of hexagons per family, one per wing
//   babel-wings    a wing: its rooms as a lattice of dots beside a plate of
//                  the room under the pointer, and the rooms in the order
//                  the wing numbers them
//   babel-room     a room: its census as one bar, a map and a reading pane
//                  beside it — or plates, with the map as a minimap. A finite
//                  room's map is the deep map (deep-map-ui.js): one canvas
//                  from the whole room down to single volumes, its bar
//                  counting what is on screen. An endless room's is the
//                  census map, zoomed a click at a time.
//   babel-volume   a volume: its plate between its neighbours, its facts in
//                  the margin, and its number spelled out
//
// Every page opens with the same location bar, and the bar is the address:
// dfa-3-2/977, each part a step back up, named underneath. A volume's bar also
// shows where it sits in its room and steps along the shelf (← → too). Words
// are kept to labels and short facts; what a thing means is said in its
// tooltip, not in a paragraph beside it.
//
// Nothing on a page is written by anyone: every fact is computed from the
// volume's number.

import { App, MachineCategories, getMachineConfig } from '../core/state.js';
import { showStatus } from '../core/utils.js';
import { applyDocument } from '../io/persistence.js';
import { exportCopyText, exportDownload } from '../io/export-core.js';
import { setView } from '../ui/view.js';
import { writeStandardTM, bbchallengeUrl } from '../interop/standard-tm.js';
import { h, backButton, brandLockup, button, svgFigure } from '../library/dom.js';
import { drawSketch, sketchFromTarget, drawLanguage, languageRows } from '../library/sketch.js';
import { decideRaw, liveDiagram, targetFromDoc, traceWord } from '../library/analyze.js';
import { canonicalCodeOf, machineIdOf } from '../library/hash.js';
import { withMachine } from '../exercise/grade.js';
import { buildFormalDefLatex } from '../canvas/render.js';
import { triggerMath } from '../reference/reference.js';
import { cachedLibrary } from '../library/client.js';
import { webAppLink } from '../library/config.js';
import {
  behaviourSection, canInsertAsBlock, go, insertDocAsBlock, isInMyLibraryNow, libraryBack, libraryCanGoBack, libraryRoute,
  moreMenu, playRun, savedVolumes, toggleSavedVolume, verdictChip
} from '../library/library-ui.js';
import { formatAddress, groupDigits, numberText, parseAddress, sayCount, showNumber } from './address.js';
import { canonicalOf } from './canon.js';
import { cellClassesOf, classifyBody } from './census.js';
import { asSketchDfa, dfaOf, firstWords, languageClass, minimiseDfa, weakViolation } from './facts.js';
import { endlessSpelling, finiteTiles, neighbours, nudge, conventionsOf } from './spell.js';
import { askBabel } from './babel-client.js';
import { deepMapView, resetDeepMapsForTests } from './deep-map-ui.js';
import { deepLayout, samplesFor } from './deep-map.js';
import { findVolume, volumeNamedBy } from './find.js';
import { openVolume, randomVolume, roomId, roomShape, roomTotal, roomsOfWeight, seededBelow, wingCountUpTo, wingNumberBelow } from './volumes.js';
import { WINGS, letterName, roomProblem, wingByKey, wingIsFinite, wingOf, withReaderNames } from './wings.js';

/** A wing number is shown while it has at most 30 digits; a room's range while it starts below 10⁶⁰. */
const SHOWN_WING_NUMBER = 10n ** 30n;
const SHOWN_RANGE = 10n ** 60n;

// ── State ─────────────────────────────────────────────────────────

const B = {
  wing: 'dfa',            // the wing a bare number on the Entrance counts in
  typed: '',              // what the Entrance's field holds
  names: new Map(),       // room id → the reader's own letter names, from the Finder
  ownLetters: true,       // draw a room the reader brought letters to in those letters
  notes: new Map(),       // address → how the Finder read the machine
  view: 'map',            // a room: 'map' or 'plates'
  from: new Map(),        // room id → the first volume on the plates page
  lit: new Map(),         // room id → the census class picked on its bar
  canonicalOnly: false,
  wingRoom: new Map(),    // wing key → params last chosen on a wing's page
  verdicts: new Map(),    // address|budget → a TM's halting verdict
  census: new Map(),      // room id:lo:hi → the classes of a map's cells, as far as read
  active: null,           // the census the page on screen reads; any other stops
  current: null           // the volume on screen: { wing, params, volume, last }
};

export function resetBabelUiForTests() {
  B.wing = 'dfa'; B.typed = ''; B.names.clear(); B.ownLetters = true; B.notes.clear(); B.view = 'map';
  B.from.clear(); B.lit.clear(); B.canonicalOnly = false; B.wingRoom.clear(); B.verdicts.clear();
  B.census.clear(); B.active = null; B.current = null;
  resetDeepMapsForTests();
}

/** The census reading cells now, by key, or null: tests check a page stops the last one. */
export function activeCensusForTests() {
  return B.active;
}

/** Which rail item a Babel page lights up. */
export const BABEL_NAV_OF = { 'babel-room': 'babel-wings', 'babel-volume': 'babel-wings' };

// ── Words and marks ───────────────────────────────────────────────

const SINGULAR = { states: 'state', letters: 'letter', 'stack symbols': 'stack symbol', 'output letters': 'output letter', 'tape symbols': 'tape symbol', tapes: 'tape' };
const SHORT = { states: 'states', letters: 'letters', 'stack symbols': 'stack', 'output letters': 'outputs', 'tape symbols': 'symbols', tapes: 'tapes' };

/** [3, 2] in the DFA wing → "3 states, 2 letters". */
export function paramWords(wing, params) {
  return wing.params.map((p, i) => `${params[i]} ${params[i] === 1 ? SINGULAR[p.id] || p.id : p.id}`).join(', ');
}

/** [3, 2] → "3·2", a room's short name. */
function roomDots(params) {
  return params.join('·');
}

function fullName(wing) {
  return getMachineConfig(wing.type)?.fullName || wing.type;
}

function familyOf(wing) {
  return getMachineConfig(wing.type)?.category || 'special';
}

const ICONS = {
  hex: '<svg viewBox="0 0 72 82" aria-hidden="true"><polygon points="36,1.5 70.5,21.25 70.5,60.75 36,80.5 1.5,60.75 1.5,21.25"/></svg>'
};

/** A small inline icon: a fixed SVG string, never anything a reader wrote. */
function icon(name, cls = '') {
  const s = h('span', { class: `bab-ico is-${name}${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true' });
  s.innerHTML = ICONS[name];
  return s;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 5 digits → "10⁴": the power of ten a count reaches. */
function magnitude(n) {
  const d = BigInt(n).toString().length - 1;
  return `10${String(d).split('').map(c => SUP[Number(c)]).join('')}`;
}

/** A count short enough for a small label: in full up to nine digits, else 1.2 × 10¹². */
function shortCount(n) {
  return pretty(sayCount(n));
}

function volumeAddress(wing, params, volume) {
  return formatAddress({ key: wing.key, params, volume });
}

/** A room id → { wing, params }, or null. */
function parseRoom(id) {
  const a = parseAddress(id || '');
  if (!a || !a.params) return null;
  const wing = wingByKey(a.key);
  if (!wing || roomProblem(wing, a.params)) return null;
  return { wing, params: a.params };
}

/**
 * Fade a row of things in once, as they scroll into view. Without an
 * IntersectionObserver (a test, an old browser) they are simply there.
 */
function reveal(nodes) {
  const IO = globalThis.IntersectionObserver;
  nodes.forEach(n => n.classList.add('bab-reveal'));
  if (typeof IO !== 'function') { nodes.forEach(n => n.classList.add('is-in')); return; }
  const io = new IO(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -32px 0px' });
  nodes.forEach(n => io.observe(n));
}

// ── Where you are ─────────────────────────────────────────────────

/**
 * The location bar every Babel page opens with. It is the address itself —
 * dfa-3-2/977 — with each part a step back up and its name underneath, so
 * walking the Library teaches the one thing a reader needs to come back. On a
 * volume, its tail shows where the volume sits in its room and steps along
 * the shelf.
 */
function locationBar({ wing = null, params = null, volume = null, tail = null } = {}) {
  const bar = h('nav', { class: 'bab-loc', 'aria-label': 'Where you are in AutomataStudio Babel', data: wing ? { family: familyOf(wing) } : {} });
  if (libraryCanGoBack()) bar.append(backButton(() => libraryBack()));
  const crumb = h('div', { class: 'bab-crumb' });
  // The place, named as the catalogue's header names its own: the app's logo
  // and wordmark, then "Babel" (brandLockup in dom.js).
  const parts = [{ word: brandLockup('Babel'), cap: null, title: 'AutomataStudio Babel — the Entrance', root: true, go: () => go('babel') }];
  if (wing) parts.push({ word: wing.key, cap: 'wing', title: fullName(wing), wing: true, go: () => go('babel-wings', wing.key) });
  if (wing && params) {
    const room = params.join('-');
    parts.push({ sep: '-' }, { word: clip(room, 6, 4), cap: 'room', title: `${room} — ${paramWords(wing, params)}`, go: () => go('babel-room', roomId(wing, params)) });
  }
  if (wing && params && volume !== null) {
    // A volume's number can run to thousands of characters: the bar shows its
    // ends, the tooltip all of it, and a press copies the whole address.
    const word = numberText(volume);
    const address = volumeAddress(wing, params, volume);
    const clipped = clip(word, 8, 6);
    parts.push({ sep: '/' }, {
      word: clipped, cap: clipped === word ? 'volume' : `volume · ${groupDigits(word.length)} characters`,
      title: clipped === word ? `Volume ${groupDigits(volume)} — press to copy its address` : `${address}\nPress to copy the whole address`,
      go: () => exportCopyText(address, 'Address copied — paste it into the Entrance to come back')
    });
  }
  const last = parts.length - 1;
  parts.forEach((p, i) => {
    if (p.sep) { crumb.append(h('span', { class: 'bab-crumb-sep', 'aria-hidden': 'true', text: p.sep })); return; }
    const cls = `bab-crumb-seg${p.root ? ' is-root' : ''}${p.wing ? ' is-wing' : ''}${i === last ? ' is-here' : ''}`;
    const mark = p.wing ? h('i', { class: 'lib-dot bab-crumb-dot', 'aria-hidden': 'true' }) : null;
    const inner = [h('span', { class: 'bab-crumb-word' }, mark, p.word), p.cap ? h('span', { class: 'bab-crumb-cap', text: p.cap }) : null];
    // The page you are on is not a step back up; a volume's is a copy of its address.
    crumb.append(i === last && !(p.go && volume !== null)
      ? h('span', { class: cls, title: p.title, 'aria-current': 'page' }, inner)
      : h('button', { type: 'button', class: cls, title: p.title, 'aria-current': i === last ? 'page' : null, on: { click: p.go } }, inner));
  });
  bar.append(crumb);
  if (tail) bar.append(h('div', { class: 'bab-loc-tail' }, tail));
  return bar;
}

/** A long word's two ends, for a label: "BfbBatuO…UN3WAAA". The whole is for its tooltip. */
function clip(word, head, tail) {
  const s = String(word);
  return [...s].length > head + tail + 3 ? `${[...s].slice(0, head).join('')}…${[...s].slice(-tail).join('')}` : s;
}

/** "1.7 × 10^292" → "1.7 × 10²⁹²": a count read as a power of ten. */
function pretty(text) {
  return String(text).replace(/10\^(\d+)/g, (_, d) => `10${d.split('').map(c => SUP[Number(c)]).join('')}`);
}

/**
 * Where a volume sits in its room: "977 of 5,832" over a hairline with a mark,
 * and a step either side. An endless room has no end to measure against, so
 * it says the volume's size instead.
 */
function positionTail(wing, params, volume) {
  const shape = roomShape(wing, params);
  let at, say, title;
  if (shape.finite) {
    at = shape.total > 1n ? Number((volume * 10000n) / (shape.total - 1n)) / 10000 : 0;
    say = `${showNumber(volume).text} of ${shortCount(shape.total)}`;
    title = `Volume ${groupDigits(volume)} of ${groupDigits(shape.total)} in ${roomId(wing, params)}`;
  } else {
    const s = openVolume({ wing, params, volume }).size;
    at = Math.min(1, s / 12);
    say = `size ${s}`;
    title = `Size ${s} in an endless room: its volumes are ordered by size`;
  }
  const last = shape.finite ? shape.total - 1n : null;
  const step = d => {
    const v = volume + BigInt(d);
    if (v < 0n || (last !== null && v > last)) return;
    go('babel-volume', volumeAddress(wing, params, v), { push: false });
  };
  return [
    h('button', { type: 'button', class: 'bab-step', title: 'Previous volume (←)', 'aria-label': 'Previous volume', disabled: volume === 0n ? '' : null, on: { click: () => step(-1) } }, '‹'),
    h('div', { class: 'bab-pos', title },
      h('span', { class: 'bab-pos-say', text: say }),
      h('span', { class: 'bab-pos-track' }, h('i', { class: 'bab-pos-mark', style: `left: ${(at * 100).toFixed(2)}%` }))),
    h('button', { type: 'button', class: 'bab-step', title: 'Next volume (→)', 'aria-label': 'Next volume', disabled: last !== null && volume >= last ? '' : null, on: { click: () => step(1) } }, '›')
  ];
}

// ← and → step along the shelf on a volume's page, unless the reader is typing.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    if (App.view !== 'library' || libraryRoute().page !== 'babel-volume' || !B.current) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const { wing, params, volume, last } = B.current;
    const v = volume + (ev.key === 'ArrowLeft' ? -1n : 1n);
    if (v < 0n || (last !== null && v > last)) return;
    ev.preventDefault();
    go('babel-volume', volumeAddress(wing, params, v), { push: false });
  });
}

function errorPage(title, body) {
  return h('div', { class: 'lib-page bab-page' },
    locationBar(),
    h('div', { class: 'lib-empty lib-empty-state' }, h('strong', { text: title }), body ? h('span', { class: 'lib-muted', text: body }) : null,
      h('div', { class: 'lib-actions' }, button('To the Entrance', () => go('babel'), 'btn-g'))));
}

// ── Figures ───────────────────────────────────────────────────────

/** A volume's diagram, small: the plate's figure. */
function plateFigure(doc, { w = 200, h: ht = 120 } = {}) {
  try {
    const target = targetFromDoc(doc);
    if (target.states.length > 60) return h('div', { class: 'lib-fig bab-fig-big' }, h('span', { text: `${target.states.length} states` }));
    return svgFigure(drawSketch(sketchFromTarget(target), { w, h: ht }), 'bab-plate-fig');
  } catch {
    return h('div', { class: 'lib-fig' });
  }
}

/** What a volume says, in a few words, for a plate or a readout. */
function sayVolume(wing, params, body, letters = null) {
  if (wing.kind === 'fa') {
    const t = dfaOf(wing.type, params, body);
    if (!t) return { cls: 'x', text: 'too large to determinise here' };
    const c = languageClass(t);
    if (c === 'e') return { cls: 'e', text: '∅' };
    if (c === 'u') return { cls: 'u', text: 'Σ*' };
    const words = firstWords(t, { count: 3, maxLen: SHORT_WORD }).map(w => spellWord(w, letters));
    if (!words.length) return { cls: c === 'c' ? 'f' : c, text: `nothing under ${SHORT_WORD + 1} letters` };
    return { cls: c === 'c' ? 'f' : c, text: words.join(', ') + (c === 'f' && words.length < 3 ? '' : ', …') };
  }
  const cls = classifyBody(wing, params, body);
  const lab = cellClassesOf(wing).find(c => c.key === cls);
  return { cls, text: lab?.label || '' };
}

/** How long a word "Accepts …" looks for: firstWords is exact to this length. */
const SHORT_WORD = 10;

/** A word of letter indices, in the reader's letters when given (spaced if any is longer than one character). */
function spellWord(w, letters) {
  if (!w.length) return 'ε';
  const name = i => letters?.[i] ?? letterName(i);
  return w.map(name).join(letters?.some(s => [...String(s)].length > 1) ? ' ' : '');
}

/**
 * The reader's own letters for a room, when they brought some and have not
 * asked for the canonical ones. The number spells a, b, …; the reader who
 * looked up a machine over {x, y, z} reads it over {x, y, z}.
 */
function lettersFor(wing, params) {
  if (!B.ownLetters) return null;
  return B.names.get(roomId(wing, params)) || null;
}

/** A volume's document as the page draws it: in the reader's letters for this room, if any. */
function readerDoc(wing, params, doc) {
  const names = lettersFor(wing, params);
  return names ? withReaderNames(doc, names) : doc;
}

/** A found volume's document in the letters it was found in (the Finder's preview, the catalogue's offer). */
function foundDoc(v, found) {
  return B.ownLetters && found?.names ? withReaderNames(v.doc, found.names) : v.doc;
}

/** Remember the letters a found machine was written in, for its room. */
function keepNames(found) {
  if (found?.kind !== 'volume' || !found.names) return;
  const wing = wingByKey(found.key);
  if (wing) B.names.set(roomId(wing, found.params), found.names);
}

// ── The Entrance ──────────────────────────────────────────────────

const EXAMPLES = [
  { text: '1537', say: 'a number', wing: 'dfa' },
  { text: '(a|b)*abb', say: 'a regular expression' },
  { text: 'nba-2-2/300', say: 'an address' },
  { text: '1RB1LB_1LA0LC_1RZ1LD_1RD0RA', label: 'BB(4)', say: 'a machine code' }
];

function pageEntrance() {
  const page = h('div', { class: 'lib-page bab-page bab-entrance' });
  page.append(locationBar({ tail: h('span', { class: 'bab-loc-note', title: 'Every DFA, NFA, Büchi automaton, one-counter automaton and Turing machine, numbered — nothing stored, every page computed' },
    `${WINGS.length} wings · every machine of these kinds, numbered · works offline`) }));

  // The title page: the statement, one field, and the volume it names.
  const select = h('select', { class: 'bab-wing-select', 'aria-label': 'The wing a number counts in' });
  for (const w of WINGS) select.append(h('option', { value: w.key, text: w.type, selected: w.key === B.wing ? '' : null }));
  const input = h('input', {
    class: 'bab-typewriter', type: 'text', spellcheck: 'false', autocomplete: 'off', value: B.typed,
    placeholder: 'dfa-3-2/977', title: 'A number, an address, a regular expression, a machine code, or “canvas” for the machine on your canvas',
    'aria-label': 'A number, an address, a regular expression, a machine code, or “canvas”'
  });
  const preview = h('div', { class: 'bab-preview', 'aria-live': 'polite' });
  const update = () => {
    B.typed = input.value;
    paintPreview(preview, input.value || input.placeholder);
  };
  const open = () => followFound(findVolume(input.value || input.placeholder, { wing: B.wing }));
  select.addEventListener('change', () => { B.wing = select.value; update(); });
  input.addEventListener('input', update);
  input.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    open();
  });
  page.append(h('section', { class: 'bab-title' },
    h('h2', { class: 'lib-display bab-statement' }, 'Every machine that has ever been conceived, ', h('em', { text: 'or ever will be.' })),
    h('div', { class: 'bab-field' },
      h('div', { class: 'bab-field-line' }, input, button('Open', open, 'lib-textbtn bab-field-open', { title: 'Open (Enter)' })),
      h('div', { class: 'bab-field-under' },
        h('span', { text: 'a number, an address, a regular expression, a machine code or “canvas”' }),
        h('span', { class: 'bab-wing-pick', title: 'A bare number counts in this wing' }, 'numbers count in ', select))),
    preview));
  update();

  // Under the field: what it accepts, by example — each one a plate that opens.
  const plates = EXAMPLES.map(ex => examplePlate(ex)).filter(Boolean);
  plates.push(h('button', { type: 'button', class: 'bab-example is-random', title: 'A random volume of the wing numbers count in', on: { click: () => takeRandom() } },
    h('div', { class: 'lib-fig bab-example-fig' }, h('span', { class: 'bab-random-glyph', text: '↻' })),
    h('span', { class: 'bab-example-cap' }, h('span', { class: 'bab-example-say', text: 'any volume' }), h('span', { class: 'bab-example-k', text: 'random' }))));
  page.append(h('section', { class: 'bab-examples', 'aria-label': 'Examples' },
    h('span', { class: 'bab-kicker', text: 'Or open one of these' }),
    h('div', { class: 'bab-example-row' }, plates)));
  reveal(plates);

  const how = howSection();
  if (how) page.append(how);
  const mine = yoursSection();
  if (mine) page.append(mine);

  // The galleries: a row of hexagons per family, a hexagon per wing.
  const groups = wingGroups();
  const rows = groups.map((g, gi) => h('div', { class: `bab-gallery${gi % 2 ? ' is-offset' : ''}`, data: { family: g.family } },
    h('div', { class: 'bab-gallery-name' }, h('i', { class: 'lib-dot' }), h('span', { text: g.label })),
    h('div', { class: 'bab-hexes' }, g.wings.map(w => hexFor(w, g.family)))));
  page.append(h('section', { class: 'bab-galleries', 'aria-label': `${WINGS.length} wings` },
    h('div', { class: 'lib-sechead' },
      h('h3', { class: 'lib-sechead-title', text: `${WINGS.length} wings` }),
      h('span', { class: 'bab-gallery-key', title: 'Each hexagon is a wing. The power of ten is how many machines it holds up to size 3; ∞ marks a wing whose rooms are endless — its machines can keep growing.' },
        h('span', { class: 'lib-mono', text: '10ⁿ' }), ' machines up to size 3 · ', h('b', { text: '∞' }), ' endless rooms')),
    rows));
  return page;
}

/** An example under the field: its plate, what it is, and what kind of thing it is. */
function examplePlate(ex) {
  const found = findVolume(ex.text, { wing: ex.wing || B.wing });
  if (!found || found.kind !== 'volume') return null;
  let v;
  try { v = openVolume({ key: found.key, params: found.params, volume: found.volume }); } catch { return null; }
  const label = ex.label || ex.text;
  return h('button', { type: 'button', class: 'bab-example', data: { family: familyOf(v.wing) }, title: `${ex.text} — ${v.wing.type} ${v.address}`, on: { click: () => followFound(found) } },
    plateFigure(v.doc, { w: 220, h: 120 }),
    h('span', { class: 'bab-example-cap' },
      h('span', { class: 'bab-example-say', text: ex.say }),
      h('span', { class: 'bab-example-k', text: label })));
}

/**
 * How a machine is a number, on one volume: the machine, the parts its normal
 * form is made of, each read as a digit in its place, and the sum. It is the
 * volume page's "spelled" section in miniature, and the idea the whole
 * Library rests on.
 */
function howSection() {
  const wing = wingByKey('dfa');
  const params = [3, 2];
  const volume = 977n;
  let v, tiles;
  try { v = openVolume({ wing, params, volume }); tiles = finiteTiles(wing, params, v.body); } catch { return null; }
  if (!tiles) return null;
  const open = () => go('babel-volume', volumeAddress(wing, params, volume));
  const rule = t => `${t.key} ${String(t.value || '').startsWith('{') ? '=' : '→'} ${t.value || '—'}`;
  return h('section', { class: 'bab-how', 'aria-label': 'How a machine is a number', data: { family: familyOf(wing) } },
    h('div', { class: 'lib-sechead' }, h('h3', { class: 'lib-sechead-title', text: 'How a machine is a number' })),
    h('ol', { class: 'bab-how-steps' },
      h('li', {},
        h('span', { class: 'bab-how-n', text: '1' }),
        h('p', {}, h('strong', { text: 'One normal form. ' }), 'States are numbered from the start and letters are a, b, …, so two drawings of one machine are one book.'),
        h('button', { type: 'button', class: 'bab-how-fig', title: `Open ${v.address}`, on: { click: open } }, plateFigure(v.doc, { w: 240, h: 130 }))),
      h('li', {},
        h('span', { class: 'bab-how-n', text: '2' }),
        h('p', {}, h('strong', { text: 'Each part is a digit. ' }), 'Which states accept, and where each state goes on each letter, are digits, each in its own place.'),
        h('div', { class: 'bab-how-tiles' }, tiles.map(t => h('span', { class: 'bab-how-tile', title: `${rule(t)}: digit ${t.digit} of ${t.radix}, × ${sayCount(t.place)}` },
          h('b', { text: sayCount(t.digit * t.place) }), h('small', { text: rule(t) }))))),
      h('li', {},
        h('span', { class: 'bab-how-n', text: '3' }),
        h('p', {}, h('strong', { text: 'The sum is its number. ' }), 'It runs both ways: every number is a machine, so nothing is stored and nothing is missing.'),
        h('button', { type: 'button', class: 'bab-how-sum', title: `Open ${v.address}`, on: { click: open } },
          h('span', { class: 'bab-sum', text: `${tiles.map(t => sayCount(t.digit * t.place)).join(' + ')} =` }),
          h('span', { class: 'bab-how-num' }, h('span', { class: 'bab-number-mark', text: '№ ' }), groupDigits(volume)),
          h('span', { class: 'bab-how-addr', text: v.address })))));
}

/** The volumes kept in My Library, as plates that open without the network. */
function yoursSection() {
  const kept = savedVolumes().slice(0, 6);
  const plates = [];
  for (const r of kept) {
    let doc = null;
    try { doc = JSON.parse(r.text); } catch { continue; }
    const wing = wingOf(doc.machine);
    plates.push(h('button', { type: 'button', class: 'bab-example', data: { family: wing ? familyOf(wing) : 'special' }, title: `Open ${r.entry.babel}`, on: { click: () => go('babel-volume', r.entry.babel) } },
      plateFigure(doc, { w: 220, h: 120 }),
      h('span', { class: 'bab-example-cap' },
        h('span', { class: 'bab-example-say', text: r.entry.title }),
        h('span', { class: 'bab-example-k', text: clip(r.entry.babel, 14, 6) }))));
  }
  if (!plates.length) return null;
  reveal(plates);
  return h('section', { class: 'bab-examples bab-yours', 'aria-label': 'Your volumes' },
    h('div', { class: 'lib-sechead' },
      h('h3', { class: 'lib-sechead-title', text: 'Your volumes' }),
      button('My Library →', () => go('mine'), 'lib-textbtn')),
    h('div', { class: 'bab-example-row' }, plates));
}

const SCALE = new Map();
/** How many machines a wing holds up to size 3 — the number its hexagon carries. */
function wingScale(wing) {
  if (!SCALE.has(wing.key)) {
    let n = null;
    try { n = wingCountUpTo(wing, 3); } catch { /* past the search */ }
    SCALE.set(wing.key, n);
  }
  return SCALE.get(wing.key);
}

function hexFor(w, family) {
  const n = wingScale(w);
  const endless = !wingIsFinite(w);
  return h('button', {
    type: 'button', class: 'bab-hex bab-wing-link', data: { family },
    title: `${fullName(w)}${n !== null ? ` · ${groupDigits(n)} machines up to size 3` : ''}${endless ? ' · endless rooms' : ''}`,
    on: { click: () => go('babel-wings', w.key) }
  },
  icon('hex', 'bab-hex-shape'),
  h('span', { class: 'bab-hex-name', text: w.type }),
  n !== null ? h('span', { class: 'bab-hex-mag', text: magnitude(n) }) : null,
  endless ? h('span', { class: 'bab-hex-inf', text: '∞' }) : null);
}

function wingGroups() {
  const groups = [];
  const seen = new Set();
  for (const cat of MachineCategories || []) {
    // A type with no wing of its own (DWA, NWA read into DBA, NBA) names its
    // alias's wing, which this row may already hold: each wing is drawn once.
    const wings = [];
    for (const t of cat.machines || []) {
      const w = wingOf(t);
      if (!w || seen.has(w.key)) continue;
      seen.add(w.key);
      wings.push(w);
    }
    if (wings.length) groups.push({ label: cat.label, family: cat.id, wings });
  }
  const rest = WINGS.filter(w => !seen.has(w.key));
  if (rest.length) groups.push({ label: 'Others', family: 'special', wings: rest });
  return groups;
}

function paintPreview(box, text) {
  box.innerHTML = '';
  const found = findVolume(text, { wing: B.wing });
  if (!found) return;
  if (found.kind === 'error') { box.append(h('p', { class: 'bab-preview-err', text: found.error })); return; }
  if (found.kind !== 'volume') {
    const wing = wingByKey(found.key);
    box.append(h('p', { class: 'bab-preview-err', text: found.kind === 'room' ? `Room ${roomId(wing, found.params)} — Enter to walk in.` : `The ${wing.type} wing — Enter.` }));
    return;
  }
  let v;
  try { v = openVolume({ key: found.key, params: found.params, volume: found.volume }); }
  catch (e) { box.append(h('p', { class: 'bab-preview-err', text: e.message })); return; }
  const doc = foundDoc(v, found);
  const said = sayVolume(v.wing, v.params, v.body, doc.sigma);
  box.append(
    h('button', { type: 'button', class: 'bab-preview-card', data: { family: familyOf(v.wing) }, title: `Open ${v.address}`, on: { click: () => followFound(found) } },
      plateFigure(doc, { w: 300, h: 150 }),
      h('span', { class: 'bab-preview-cap' },
        h('i', { class: 'lib-dot' }),
        h('span', { text: `${v.wing.type} · ${paramWords(v.wing, v.params)} · № ${showNumber(v.volume).text}` })),
      h('span', { class: 'bab-preview-says', text: found.regex ? `accepts ${found.regex}` : said.text })));
}

function followFound(found) {
  if (!found) return;
  if (found.kind === 'error') { showStatus(found.error); return; }
  if (found.kind === 'wing') { go('babel-wings', found.key); return; }
  if (found.kind === 'room') { go('babel-room', roomId(wingByKey(found.key), found.params)); return; }
  keepNames(found);
  // What the Finder did to read it belongs to this lookup: an earlier one's
  // notes ("its ^ and $ were dropped") must not stay on the volume.
  if (found.notes?.length) B.notes.set(found.address, found.notes);
  else B.notes.delete(found.address);
  go('babel-volume', found.address);
}

function takeRandom() {
  const wing = wingByKey(B.wing) || WINGS[0];
  // A room near the start of the wing — a weight of 1 to 3 above the smallest —
  // then a uniform volume in it (of a small size, in an endless room).
  const weight = 1 + Math.floor(Math.random() * 3);
  const rooms = roomsOfWeight(wing, weight);
  const params = rooms[Math.floor(Math.random() * rooms.length)];
  const finite = roomShape(wing, params).finite;
  const size = finite ? null : Math.floor(Math.random() * 6);
  const volume = randomVolume(wing, params, { size }) ?? 0n;
  go('babel-volume', volumeAddress(wing, params, volume));
}

// ── A wing ────────────────────────────────────────────────────────

const LATTICE_ROWS = 7, LATTICE_COLS = 5, FLOORS = 5, FLOOR_ROOMS = 8;

/** A room's size, for its dot: digits of its count (at size 4 in an endless room). */
function roomDigits(wing, params) {
  const total = roomTotal(wing, params);
  const n = total === null ? roomShape(wing, params).count(4) : total;
  return { n, digits: n.toString().length, endless: total === null };
}

/** The wing numbers a finite room holds, or null. */
function roomRange(wing, params) {
  const total = roomTotal(wing, params);
  if (total === null || total === 0n) return null;
  try {
    // A range past SHOWN_RANGE is not worth its cost: every room as heavy as
    // this one would be built to say a number no one reads.
    const lo = wingNumberBelow(wing, params, 0n, SHOWN_RANGE);
    return lo === null ? null : { lo, hi: lo + total - 1n };
  } catch { return null; }
}

function pageWings(key) {
  const wing = wingByKey(key || B.wing) || WINGS[0];
  const fam = familyOf(wing);
  const finite = wingIsFinite(wing);
  const page = h('div', { class: 'lib-page bab-page bab-wings', data: { family: fam } });
  page.append(locationBar({ wing }));
  const siblings = wingGroups().find(g => g.wings.includes(wing))?.wings || [wing];
  page.append(h('div', { class: 'bab-wing-head' },
    h('div', { class: 'bab-wing-name' },
      h('h2', { class: 'lib-display bab-wing-title', text: wing.type }),
      h('span', { class: 'bab-wing-full', text: fullName(wing) }),
      h('span', { class: 'bab-wing-kind', title: finite ? 'Every room holds a fixed number of volumes' : 'Its machines can keep growing, so each room is counted by size' }, finite ? 'finite rooms' : '∞ endless rooms')),
    h('nav', { class: 'bab-siblings', 'aria-label': 'Wings in this family' },
      siblings.map(w => button(w.type, () => go('babel-wings', w.key, { push: false }), `bab-sibling${w === wing ? ' is-on' : ''}`, { title: fullName(w), 'aria-current': w === wing ? 'page' : null })))));

  // The rooms: a lattice over the first two sizes (the rest fixed, and changeable),
  // and a pane with a plate of the room under the pointer.
  const p0 = wing.params[0], p1 = wing.params[1];
  const chosen = B.wingRoom.get(wing.key) || wing.params.map((p, i) => p.min + (i === 0 ? 2 : i === 1 ? 1 : 0));
  const fixed = chosen.slice(2);
  const paramsAt = (r, c) => [p0.min + r, (p1?.min ?? 0) + c, ...fixed].slice(0, wing.params.length);
  const cells = [];
  let maxDigits = 1;
  for (let r = 0; r < LATTICE_ROWS; r++) for (let c = 0; c < LATTICE_COLS; c++) {
    const params = paramsAt(r, c);
    const d = roomDigits(wing, params);
    maxDigits = Math.max(maxDigits, d.digits);
    cells.push({ r, c, params, ...d });
  }
  const pane = h('aside', { class: 'bab-room-pane', 'aria-live': 'polite' });
  const show = params => paintRoomPane(pane, wing, params);
  const lattice = h('div', { class: 'bab-lattice', style: `--cols:${LATTICE_COLS + 1}`, role: 'grid', 'aria-label': `Rooms of the ${wing.type} wing` });
  lattice.append(h('span', { class: 'bab-lat-corner', title: `${p0.id} down, ${p1 ? p1.id : ''} across` }, h('span', { text: `${p1 ? SHORT[p1.id] || p1.id : ''} →` }), h('span', { text: `${SHORT[p0.id] || p0.id} ↓` })));
  for (let c = 0; c < LATTICE_COLS; c++) lattice.append(h('span', { class: 'bab-lat-head', text: String((p1?.min ?? 0) + c) }));
  lattice.append(h('span', { class: 'bab-lat-head is-more', 'aria-hidden': 'true', text: '…' }));
  const here = chosen.slice(0, 2).join('|');
  for (let r = 0; r < LATTICE_ROWS; r++) {
    lattice.append(h('span', { class: 'bab-lat-head is-row', text: String(p0.min + r) }));
    for (let c = 0; c < LATTICE_COLS; c++) {
      const cell = cells[r * LATTICE_COLS + c];
      const size = (8 + 30 * Math.sqrt(cell.digits / maxDigits)).toFixed(1);
      const btn = h('button', {
        type: 'button', class: `bab-lat-cell${cell.params.slice(0, 2).join('|') === here ? ' is-here' : ''}`,
        title: `${paramWords(wing, cell.params)} · ${groupDigits(cell.n)} volumes${cell.endless ? ' at size 4' : ''}`,
        'aria-label': `${paramWords(wing, cell.params)}: ${groupDigits(cell.n)} volumes`,
        on: {
          click: () => { B.wingRoom.set(wing.key, cell.params); go('babel-room', roomId(wing, cell.params)); },
          mouseenter: () => show(cell.params), focus: () => show(cell.params)
        }
      }, h('i', { class: 'bab-lat-dot', style: `--d:${size}px` }));
      lattice.append(btn);
    }
    lattice.append(h('span', { class: 'bab-lat-ghost', 'aria-hidden': 'true' }));
  }
  lattice.append(h('span', { class: 'bab-lat-head is-row', 'aria-hidden': 'true', text: '…' }));
  for (let c = 0; c < LATTICE_COLS; c++) lattice.append(h('span', { class: 'bab-lat-ghost', 'aria-hidden': 'true' }));
  lattice.append(h('span', { class: 'bab-lat-more', 'aria-hidden': 'true', text: 'and on' }));
  lattice.addEventListener('mouseleave', () => show(chosen));

  const inputs = wing.params.map((p, i) => h('input', { type: 'number', min: String(p.min), value: String(chosen[i] ?? p.min), class: 'bab-param', 'aria-label': p.id, title: p.id }));
  const openAny = () => {
    const params = inputs.map(x => Math.floor(Number(x.value)));
    const problem = roomProblem(wing, params);
    if (problem) { showStatus(problem); return; }
    B.wingRoom.set(wing.key, params);
    go('babel-room', roomId(wing, params));
  };
  inputs.forEach(x => x.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); openAny(); } }));
  page.append(h('section', { class: 'bab-rooms' },
    h('div', { class: 'bab-rooms-main' },
      lattice,
      h('div', { class: 'bab-open-room', title: 'The lattice stops; the wing does not. Any sizes open a room.' },
        h('span', { class: 'bab-open-label', text: 'Any room' }),
        wing.params.map((p, i) => h('label', { class: 'bab-param-label' }, inputs[i], h('span', { text: p.id }))),
        button('Walk in →', openAny, 'lib-textbtn bab-walk')),
      fixed.length ? h('span', { class: 'bab-lat-fixed', text: `with ${wing.params.slice(2).map((p, i) => `${fixed[i]} ${p.id}`).join(', ')}` }) : null),
    pane));
  show(chosen);

  page.append(floorsSection(wing, chosen));
  if (!finite) page.append(endlessBars(wing, chosen.length === wing.params.length ? chosen : wing.params.map(p => p.min)));
  return page;
}

/** The pane beside the lattice: a plate from the room, its name and its count. */
function paintRoomPane(pane, wing, params) {
  pane.innerHTML = '';
  const id = roomId(wing, params);
  const shape = roomShape(wing, params);
  let sample = null;
  try {
    const volume = randomVolume(wing, params, { size: shape.finite ? null : 2, rand: seededBelow(id) });
    if (volume !== null) sample = openVolume({ wing, params, volume });
  } catch { /* past the room */ }
  const range = roomRange(wing, params);
  pane.append(
    sample ? plateFigure(sample.doc, { w: 300, h: 150 }) : h('div', { class: 'lib-fig' }),
    sample ? h('span', { class: 'bab-pane-sample', text: `a volume from it: № ${showNumber(sample.volume).text}` }) : null,
    h('h3', { class: 'bab-pane-title', text: paramWords(wing, params) }),
    h('span', { class: 'bab-pane-count' }, shape.finite
      ? `${groupDigits(shape.total)} volumes${range ? ` · № ${shortCount(range.lo)} to ${shortCount(range.hi)}` : ''}`
      : `∞ · ${[0, 1, 2, 3].map(s => shortCount(shape.count(s))).join(', ')}, … by size`),
    button('Walk in →', () => { B.wingRoom.set(wing.key, params); go('babel-room', id); }, 'lib-textbtn bab-walk is-strong'));
}

/**
 * The rooms in the order the wing numbers its machines: by size — how far a
 * room is above the smallest — then room by room. A finite room's machines
 * hold a run of wing numbers, which is how DFA № 1,537 comes to be volume 977
 * of room 3·2.
 */
function floorsSection(wing, chosen) {
  const finite = wingIsFinite(wing);
  const sec = h('section', { class: 'bab-floors' },
    h('div', { class: 'lib-sechead', title: 'A machine’s wing number runs left to right, size by size: every machine of a smaller size comes first.' },
      h('h3', { class: 'lib-sechead-title', text: 'In the wing’s order' }),
      h('span', { class: 'bab-floors-key', text: finite ? 'wing numbers run left to right, size by size' : 'rooms by size; endless rooms count by size within' })));
  const here = chosen.join('|');
  for (let T = 0; T < FLOORS; T++) {
    const rooms = roomsOfWeight(wing, T);
    if (rooms.length > FLOOR_ROOMS) break;
    const row = h('div', { class: 'bab-floor-rooms' });
    for (const params of rooms) {
      const d = roomDigits(wing, params);
      const range = finite ? roomRange(wing, params) : null;
      row.append(h('button', {
        type: 'button', class: `bab-floor-room${params.join('|') === here ? ' is-here' : ''}`, style: `--dg:${Math.min(d.digits, 16)}`,
        title: `${paramWords(wing, params)} · ${groupDigits(d.n)} volumes${d.endless ? ' at size 4' : ''}`,
        on: { click: () => { B.wingRoom.set(wing.key, params); go('babel-room', roomId(wing, params)); } }
      },
      h('span', { class: 'bab-floor-name' }, h('b', { text: roomDots(params) }), ` · ${d.endless ? '∞' : shortCount(d.n)}`),
      range ? h('span', { class: 'bab-floor-range', text: `№ ${shortCount(range.lo)}–${shortCount(range.hi)}` }) : null));
    }
    sec.append(h('div', { class: 'bab-floor' }, h('span', { class: 'bab-floor-k', text: `size ${T}` }), row));
  }
  return sec;
}

/** An endless room's counts by size, as bars on a log scale. */
function endlessBars(wing, params) {
  const shape = roomShape(wing, params);
  const counts = Array.from({ length: 10 }, (_, s) => shape.count(s));
  const lg = c => (c === 0n ? 0 : c.toString().length - 1 + Math.log10(Number(c.toString().slice(0, 6)) / 10 ** (Math.min(6, c.toString().length) - 1)));
  const peak = Math.max(...counts.map(lg));
  return h('section', { class: 'bab-endless' },
    h('div', { class: 'lib-sechead' },
      h('h3', { class: 'lib-sechead-title', text: `Room ${roomDots(params)}, counted by size` }),
      button('Walk in →', () => go('babel-room', roomId(wing, params)), 'lib-textbtn bab-walk')),
    h('div', { class: 'bab-bars' }, counts.map((c, s) => h('div', { class: 'bab-bar', style: `--hgt:${Math.max(0.03, (lg(c) + 1) / (peak + 1)).toFixed(3)}`, title: `size ${s}: ${groupDigits(c)} volumes` },
      h('span', { class: 'bab-bar-n', text: sayCount(c) }), h('i'), h('span', { class: 'bab-bar-s', text: String(s) })))));
}

// ── A room ────────────────────────────────────────────────────────

const MAX_CELLS = 16384;
const PLATES = 24;

function pageRoom(id) {
  const r = parseRoom(id);
  if (!r) return errorPage('There is no such room', `“${id}” is not a room of AutomataStudio Babel.`);
  const { wing, params } = r;
  const shape = roomShape(wing, params);
  const page = h('div', { class: 'lib-page bab-page bab-room', data: { family: familyOf(wing) } });
  page.append(locationBar({ wing, params }));
  const range = shape.finite ? roomRange(wing, params) : null;
  const views = h('nav', { class: 'bab-views', 'aria-label': 'View' },
    ['map', 'plates'].map(v => button(v === 'map' ? 'Map' : 'Plates', () => { B.view = v; go('babel-room', id, { push: false }); },
      `bab-toggle${B.view === v ? ' is-on' : ''}`, { 'aria-current': B.view === v ? 'true' : null })));
  page.append(h('div', { class: 'bab-room-head' },
    h('div', { class: 'bab-room-name' },
      h('h2', { class: 'lib-display bab-room-title', text: paramWords(wing, params) }),
      h('span', { class: 'bab-room-count', title: range ? `${groupDigits(shape.total)} volumes: ${wing.type} № ${groupDigits(range.lo)} to № ${groupDigits(range.hi)}` : 'An endless room: its volumes are ordered by size' },
        shape.finite ? `${shape.total.toString().length > 15 ? shortCount(shape.total) : groupDigits(shape.total)} volumes` : `∞ · ${[0, 1, 2, 3].map(s => groupDigits(shape.count(s))).join(', ')}, … by size`)),
    views));
  // Every room's map is the deep map: a finite room from the whole room down,
  // an endless one from the row of its sizes down.
  if (B.view !== 'plates') {
    // The deep map reads its own tiles: a census left active (the Plates
    // view's) would otherwise go on reading the whole of its room.
    B.active = null;
    const vc = screenCensus(wing, params);
    page.append(censusBar(vc));
    page.append(deepRoomMap(wing, params, vc));
    return page;
  }
  const c = censusOf(wing, params);
  page.append(censusBar(c));
  page.append(roomPlates(wing, params, c));
  startCensus(c);
  return page;
}

// ── A room's map: the deep map ─────────────────────────────────────

/**
 * The census bar's reading of the deep map: what is on screen, every machine
 * read counted. Shaped like a room's census so censusBar draws either.
 */
function screenCensus(wing, params) {
  const shape = roomShape(wing, params);
  const samples = samplesFor(wing, shape.finite ? deepLayout(wing, params) : null);
  return {
    wing, params, id: roomId(wing, params), classes: cellClassesOf(wing), watchers: [],
    // One cell outstanding until the first count: the bar reads "reading…", not an empty screen.
    counts: new Map(), done: 0, cells: 1, block: 1n, range: {},
    unit: ' of the machines read on screen',
    note: samples > 1 ? `on screen · ${samples} machines read per block` : 'on screen',
    tally() { return { tally: this.counts, done: this.done }; }
  };
}

function deepRoomMap(wing, params, vc) {
  let pane = null;
  const screenNote = vc.note;
  const view = deepMapView(wing, params, {
    lit: B.lit.get(vc.id) || null,
    reading: info => paintDeepReading(pane, wing, params, info),
    plate: volume => deepPlate(wing, params, volume),
    open: volume => go('babel-volume', volumeAddress(wing, params, volume)),
    tally: t => {
      vc.counts = t.counts; vc.done = t.done; vc.cells = t.total;
      // At the bottom level every count is a volume's own answer, and when the
      // whole room is on screen it is the room's exact census: said as a
      // sample ("5 machines read per block"), an exact count read as a guess.
      const whole = t.exact && BigInt(t.done) === roomShape(wing, params).total;
      vc.unit = t.exact ? ' volumes on screen' : ' of the machines read on screen';
      vc.note = whole ? 'the whole room · every volume read' : t.exact ? 'on screen · every volume read' : screenNote;
      notifyCensus(vc);
    }
  });
  pane = view.pane;
  paintDeepReading(pane, wing, params, null);
  return view.el;
}

/**
 * A plate's number. Plates side by side are neighbours on one shelf, so they
 * share their leading digits and differ at the end: a long number is shown by
 * its tail (…772,991,524), whole in the tooltip. Cut at its end, as the
 * caption's overflow did, every plate at the bottom of a deep map read the same
 * "1,573,904,77…".
 */
function plateNumber(n, cls) {
  const whole = groupDigits(n);
  return h('span', { class: cls, title: `№ ${whole}`, text: whole.length > 11 ? `…${whole.slice(-11)}` : whole });
}

/** A volume at the bottom of the map, as a plate: the Plates view's, sized by the map. */
function deepPlate(wing, params, volume) {
  let o;
  try { o = openVolume({ wing, params, volume }); } catch { return h('div', { class: 'bab-deep-plate' }); }
  const said = sayVolume(wing, params, o.body, lettersFor(wing, params));
  return h('button', {
    type: 'button', class: 'bab-deep-plate', data: { cls: said.cls, kind: wing.kind },
    title: `${o.address} — ${said.text}`, on: { click: () => go('babel-volume', o.address) }
  },
  plateFigure(readerDoc(wing, params, o.doc), { w: 180, h: 110 }),
  h('span', { class: 'bab-plate-cap' },
    h('i', { class: 'bab-swatch', data: { cls: said.cls, kind: wing.kind } }),
    plateNumber(o.volume, 'bab-plate-num'),
    h('span', { class: 'bab-plate-says', text: said.text })));
}

/**
 * The reading pane beside the deep map: the block or volume under the
 * pointer, drawn as the machine its colour came from. A block shows the
 * class of every machine read from it, in the order the map stripes them.
 */
function paintDeepReading(pane, wing, params, info) {
  if (!pane) return;
  pane.innerHTML = '';
  // A browser prints append(null) as the text "null": absent parts are dropped.
  const put = (...nodes) => pane.append(...nodes.filter(Boolean));
  if (!info) {
    const endless = !roomShape(wing, params).finite;
    put(
      h('div', { class: 'lib-fig bab-reading-empty' }, h('span', { text: 'Point at the map' })),
      h('p', { class: 'bab-reading-hint', text: endless
        ? 'Each size of machine is a cell, coloured by machines drawn from it; a click goes into it. Inside, a block zooms in, and at the bottom each cell is one volume, which a click opens.'
        : 'A block is coloured by machines drawn from it; a click zooms into it. At the bottom each cell is one volume, and a click opens it.' }));
    return;
  }
  if (info.empty) {
    put(h('div', { class: 'lib-fig bab-reading-empty' }, h('span', { text: `No machine is size ${info.shelfSize}` })));
    return;
  }
  let v = null;
  try { v = openVolume({ wing, params, volume: info.volumes[0] }); } catch { /* past the room */ }
  if (!v) return;
  const lab = info.majority ? cellClassesOf(wing).find(k => k.key === info.majority) : null;
  const said = wing.kind === 'fa' ? sayVolume(wing, params, v.body, lettersFor(wing, params)).text : null;
  const many = info.classes && info.classes.length > 1;
  const cls = lab
    ? h('span', { class: 'bab-reading-cls' }, h('i', { class: 'bab-swatch', data: { cls: lab.key, kind: wing.kind } }), lab.label,
      many ? h('span', { class: 'bab-reading-of', text: `${info.classes.filter(k => k === lab.key).length} of ${info.classes.length}` }) : null)
    : h('span', { class: 'bab-reading-cls', text: 'reading…' });
  const strip = many
    ? h('span', { class: 'bab-reading-strip', title: 'Every machine read from this block, in the order the map stripes them' },
      info.classes.map(k => h('i', { class: 'bab-swatch', data: { cls: k || 'pending', kind: wing.kind } })))
    : null;
  if (info.exact) {
    let wingNo = null;
    try { const n = wingNumberBelow(wing, params, v.volume, SHOWN_WING_NUMBER); if (n !== null) wingNo = `wing № ${groupDigits(n)}`; } catch { /* past the search */ }
    put(
      plateFigure(readerDoc(wing, params, v.doc), { w: 300, h: 160 }),
      h('div', { class: `bab-reading-num${showNumber(v.volume).text.length > 14 ? ' is-long' : ''}` }, h('span', { text: `№ ${showNumber(v.volume).text}` })),
      h('span', { class: 'bab-reading-addr', title: v.address, text: `${clip(v.address, 22, 8)}${wingNo ? ` · ${wingNo}` : ''}` }),
      cls,
      said ? h('span', { class: 'bab-reading-says', text: `accepts ${said}` }) : null,
      button('Open the volume →', () => go('babel-volume', v.address), 'lib-textbtn bab-walk is-strong'));
    return;
  }
  put(
    plateFigure(readerDoc(wing, params, v.doc), { w: 300, h: 160 }),
    h('div', { class: 'bab-reading-num' }, h('span', { text: `${shortCount(info.size)} volumes` })),
    h('span', {
      class: 'bab-reading-addr', title: `${volumeAddress(wing, params, info.block.lo)}\nto ${volumeAddress(wing, params, info.block.hi - 1n)}`,
      text: `№ ${showNumber(info.block.lo).text} to № ${showNumber(info.block.hi - 1n).text}`
    }),
    cls, strip,
    said ? h('span', { class: 'bab-reading-says', text: `the one drawn accepts ${said}` }) : null,
    h('span', {
      class: 'bab-reading-note',
      text: info.strip ? `every volume of size ${info.shelfSize} · a click goes into it`
        : `${info.inSize !== null && info.inSize !== undefined ? `size ${info.inSize} · ` : ''}level ${info.level} of ${info.levels} · a click zooms in`
    }));
}

/** The range a room's map shows: the whole of a finite room, or the first few sizes of an endless one. */
function mapRange(wing, params) {
  const shape = roomShape(wing, params);
  if (shape.finite) return { lo: 0n, hi: shape.total, depth: 0 };
  let hi = 0n, s = 0;
  while (hi < 2048n && s < 400) { hi += shape.count(s); s++; }
  return { lo: 0n, hi, depth: 0, sizes: s - 1 };
}

/** Columns for a map: the room's lowest digits, so its structure lines up; else near-square. */
function mapColumns(wing, params, block, cells) {
  const shape = roomShape(wing, params);
  if (block === 1n && shape.finite && shape.radices) {
    let w = 1n;
    for (const r of shape.radices()) {
      if (w * r > 128n) break;
      w *= r;
      if (w >= 32n) break;
    }
    if (w >= 8n && w <= 128n) return Number(w);
  }
  return Math.min(96, Math.max(1, Math.ceil(Math.sqrt(cells * 1.6))));
}

/**
 * A map's cells and their classes, as far as they have been read. Kept per
 * room and range, so the census bar, the map and the minimap share one
 * reading, and switching between the map and the plates reads nothing twice.
 */
function censusOf(wing, params) {
  const id = roomId(wing, params);
  const range = mapRange(wing, params);
  const key = `${id}:${range.lo}:${range.hi}`;
  const had = B.census.get(key);
  if (had) { had.watchers = []; return had; }
  const size = range.hi - range.lo;
  const cells = Number(size < BigInt(MAX_CELLS) ? size : BigInt(MAX_CELLS));
  const block = cells ? (size + BigInt(cells) - 1n) / BigInt(cells) : 1n;
  const cols = mapColumns(wing, params, block, cells);
  const sample = seededBelow(`${id}:${range.lo}:${range.hi}`);
  const volumes = Array.from({ length: cells }, (_, i) => {
    const start = range.lo + BigInt(i) * block;
    const span = start + block > range.hi ? range.hi - start : block;
    return block === 1n ? start : start + sample(span);
  });
  const c = {
    key, id, wing, params, range, size, cells, block, cols, rows: Math.ceil(cells / cols), volumes,
    found: new Array(cells).fill(null), classes: cellClassesOf(wing), next: 0, inflight: 0, watchers: []
  };
  B.census.set(key, c);
  if (B.census.size > 24) B.census.delete(B.census.keys().next().value);
  return c;
}

function censusDone(c) {
  return c.next >= c.cells && c.inflight === 0;
}

function notifyCensus(c) {
  for (const fn of c.watchers) {
    try { fn(); } catch { /* a page that has gone */ }
  }
}

/** Read the cells: here for cheap finite-automaton rooms, in the worker otherwise. */
function startCensus(c) {
  B.active = c.key;
  if (c.next >= c.cells) { setTimeout(() => notifyCensus(c), 0); return; }
  const { wing, params } = c;
  const cheap = (wing.kind === 'fa' || wing.kind === 'omega') && c.cells <= 6000 && params[0] <= 12;
  if (cheap) {
    const sh = roomShape(wing, params);
    c.volumes.forEach((v, i) => {
      try { c.found[i] = classifyBody(wing, params, sh.finite ? sh.unrank(0, v) : openVolume({ wing, params, volume: v }).body); }
      catch { c.found[i] = 'x'; }
    });
    c.next = c.cells;
    setTimeout(() => notifyCensus(c), 0);
    return;
  }
  const CHUNK = wing.kind === 'tm' ? 128 : 256;
  const pump = () => {
    if (B.active !== c.key || c.next >= c.cells) return;
    const from = c.next;
    c.next = Math.min(c.cells, c.next + CHUNK);
    c.inflight++;
    askBabel({ type: 'classify', key: wing.key, params, volumes: c.volumes.slice(from, c.next).map(String) }).then(reply => {
      c.inflight--;
      (reply.classes || []).forEach((k, j) => { c.found[from + j] = k; });
      if (B.active !== c.key) {
        // Left mid-way: what was asked for and not answered is asked again on return.
        if (c.inflight === 0) c.next = c.found.findIndex(x => !x) < 0 ? c.cells : c.found.findIndex(x => !x);
        return;
      }
      notifyCensus(c);
      pump();
    });
  };
  while (c.inflight < 2 && c.next < c.cells) pump();
  setTimeout(() => notifyCensus(c), 0);
}

function tallyOf(c) {
  const tally = new Map();
  let done = 0;
  for (const k of c.found) if (k) { tally.set(k, (tally.get(k) || 0) + 1); done++; }
  return { tally, done };
}

/**
 * The census as one bar: a share per class, in the order the wing lists
 * them, and under it the same classes as words with their counts. The bar is
 * the legend and the filter — picking a class lights it on the map and keeps
 * only its plates.
 */
function censusBar(c) {
  const { wing, id } = c;
  const box = h('section', { class: 'bab-census', 'aria-label': 'Census of this room' });
  const lit = B.lit.get(id) || null;
  const pick = key => { B.lit.set(id, lit === key ? null : key); go('babel-room', id, { push: false }); };
  const paint = () => {
    const { tally, done } = c.tally ? c.tally() : tallyOf(c);
    box.innerHTML = '';
    const bar = h('div', { class: `bab-census-bar${lit ? ' has-lit' : ''}` });
    for (const k of c.classes) {
      const n = tally.get(k.key) || 0;
      if (!n) continue;
      bar.append(h('button', {
        type: 'button', class: `bab-census-seg bab-swatch${lit === k.key ? ' is-on' : ''}`, data: { cls: k.key, kind: wing.kind },
        style: `flex-grow:${n}`, title: `${k.label}: ${groupDigits(n)}${c.unit ?? (c.block > 1n ? ' of the cells sampled' : '')} — ${k.say}`,
        'aria-label': `${k.label}: ${groupDigits(n)}`, on: { click: () => pick(k.key) }
      }));
    }
    if (done < c.cells) bar.append(h('span', { class: 'bab-census-pending', style: `flex-grow:${c.cells - done}` }));
    const key = h('div', { class: 'bab-census-key' });
    for (const k of c.classes) {
      const n = tally.get(k.key) || 0;
      key.append(h('button', {
        type: 'button', class: `bab-census-item${lit === k.key ? ' is-on' : ''}`, title: k.say, 'aria-pressed': lit === k.key ? 'true' : 'false',
        on: { click: () => pick(k.key) }
      }, h('i', { class: 'bab-swatch', data: { cls: k.key, kind: wing.kind } }), h('span', { text: k.label }), h('span', { class: 'bab-census-n', text: groupDigits(n) })));
    }
    if (done < c.cells) key.append(h('span', { class: 'bab-census-progress', text: `reading… ${Math.round((done / c.cells) * 100)}%` }));
    else if (c.note) key.append(h('span', { class: 'bab-census-progress', text: c.note }));
    else if (c.block > 1n) key.append(h('span', { class: 'bab-census-progress', text: `one volume sampled per ${groupDigits(c.block)}` }));
    else if (c.range.sizes !== undefined) key.append(h('span', { class: 'bab-census-progress', text: `first ${groupDigits(c.size)} volumes, sizes 0–${c.range.sizes}` }));
    box.append(bar, key);
  };
  c.watchers.push(paint);
  paint();
  return box;
}

/** Resolve the map's colours from the theme: a canvas cannot read var() or color-mix(). */
function mapPalette(host, wing) {
  const resolve = name => {
    try {
      const probe = h('span', { class: 'bab-probe', style: `color: var(${name})` });
      host.append(probe);
      const col = getComputedStyle(probe).color;
      probe.remove();
      return col || null;
    } catch { return null; }
  };
  const palette = Object.fromEntries(cellClassesOf(wing).map(k => [k.key, resolve(`--bab-${wing.kind}-${k.key}`) || '#888']));
  palette.pending = resolve('--bab-pending') || 'rgba(128,128,128,.12)';
  palette.ink = resolve('--text') || '#222';
  return palette;
}

/** Paint a census's cells into a canvas; a lit class keeps its colour and the rest go quiet. */
function paintCells(canvas, c, palette, { cellW, cellH, gap = true, lit = null, frame = null }) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const dpr = globalThis.devicePixelRatio || 1;
  canvas.width = c.cols * cellW * dpr;
  canvas.height = c.rows * cellH * dpr;
  canvas.style.width = `${c.cols * cellW}px`;
  canvas.style.height = `${c.rows * cellH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const gw = gap && cellW > 4 ? 1 : 0, gh = gap && cellH > 4 ? 1 : 0;
  for (let i = 0; i < c.cells; i++) {
    const k = c.found[i];
    ctx.fillStyle = k && (!lit || k === lit) ? palette[k] || palette.pending : palette.pending;
    ctx.fillRect((i % c.cols) * cellW, Math.floor(i / c.cols) * cellH, cellW - gw, cellH - gh);
  }
  if (frame) {
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1.5;
    const [s, e] = frame;
    for (let row = Math.floor(s / c.cols); row <= Math.floor(e / c.cols); row++) {
      const x0 = row === Math.floor(s / c.cols) ? s % c.cols : 0;
      const x1 = row === Math.floor(e / c.cols) ? e % c.cols : c.cols - 1;
      ctx.strokeRect(x0 * cellW - 1, row * cellH - 1, (x1 - x0 + 1) * cellW + 2, cellH + 2);
    }
  }
}

/** Plates, a page at a time — and beside them the map as a minimap, framing the page you are on. */
function roomPlates(wing, params, c) {
  const id = roomId(wing, params);
  const shape = roomShape(wing, params);
  const from = B.from.get(id) ?? 0n;
  const lit = B.lit.get(id) || null;
  const filterable = lit && (wing.kind === 'fa' || wing.kind === 'omega');
  const wrap = h('section', { class: 'bab-plates-sec' });
  const list = [];
  let v = from;
  let scanned = 0;
  while (list.length < PLATES && scanned < 4000) {
    if (shape.finite && v >= shape.total) break;
    scanned++;
    let opened;
    try { opened = openVolume({ wing, params, volume: v }); } catch { break; }
    if (filterable) {
      let k = null;
      try { k = classifyBody(wing, params, opened.body); } catch { /* keep it */ }
      if (k && k !== lit) { v += 1n; continue; }
    }
    if (B.canonicalOnly) {
      let cc = null;
      try { cc = canonicalOf(wing, params, opened.body, { budget: 400 }); } catch { /* keep it */ }
      if (cc && cc.exact && cc.volume !== v) { v += 1n; continue; }
    }
    list.push(opened);
    v += 1n;
  }
  const last = list.length ? list[list.length - 1].volume : from;
  const prev = () => { B.from.set(id, from > BigInt(PLATES) ? from - BigInt(PLATES) : 0n); go('babel-room', id, { push: false }); };
  const next = () => { B.from.set(id, last + 1n); go('babel-room', id, { push: false }); };
  const check = h('input', { type: 'checkbox', checked: B.canonicalOnly ? '' : null });
  check.addEventListener('change', () => { B.canonicalOnly = !!check.checked; go('babel-room', id, { push: false }); });
  const litLabel = lit ? c.classes.find(k => k.key === lit)?.label : null;
  const main = h('div', { class: 'bab-plates-main' },
    h('div', { class: 'bab-plates-bar' },
      h('button', { type: 'button', class: 'bab-step', title: 'Earlier volumes', 'aria-label': 'Earlier volumes', disabled: from === 0n ? '' : null, on: { click: prev } }, '‹'),
      h('span', { class: 'bab-plates-range', text: list.length ? `${showNumber(from).text} – ${showNumber(last).text}` : 'No volumes here' }),
      h('button', { type: 'button', class: 'bab-step', title: 'Later volumes', 'aria-label': 'Later volumes', disabled: shape.finite && last + 1n >= shape.total ? '' : null, on: { click: next } }, '›'),
      filterable ? h('span', { class: 'bab-plates-lit', text: `only ${litLabel}` }) : null,
      h('label', { class: 'bab-check', title: 'Hide twins: show only the canonical copy of each machine' }, check, h('span', { text: 'Canonical only' }))));
  const grid = h('div', { class: 'bab-plates' });
  for (const o of list) {
    const said = sayVolume(wing, params, o.body);
    grid.append(h('button', {
      type: 'button', class: 'bab-plate', data: { cls: said.cls, kind: wing.kind },
      on: { click: () => go('babel-volume', o.address) }, title: `${o.address} — ${said.text}`
    },
    plateFigure(o.doc, { w: 180, h: 110 }),
    h('span', { class: 'bab-plate-cap' },
      h('i', { class: 'bab-swatch', data: { cls: said.cls, kind: wing.kind } }),
      plateNumber(o.volume, 'bab-plate-num'),
      h('span', { class: 'bab-plate-says', text: said.text }))));
  }
  main.append(grid);
  wrap.append(main);

  // The minimap: only where a cell is a volume, so the frame is the page exactly.
  if (c.block === 1n && c.range.lo === 0n && list.length && last < BigInt(c.cells)) {
    const canvas = h('canvas', { class: 'bab-minimap', role: 'img', 'aria-label': 'Where these plates are in the room' });
    const box = h('aside', { class: 'bab-minimap-box' }, h('div', { class: 'lib-fig bab-minimap-frame' }, canvas),
      h('span', { class: 'bab-minimap-say', text: 'The frame is this page; click to move.' }));
    let palette = null, cell = 2;
    const draw = () => {
      cell = Math.max(1, Math.min(4, Math.floor(180 / c.cols)));
      palette = palette || mapPalette(box, wing);
      paintCells(canvas, c, palette, { cellW: cell, cellH: cell, gap: false, lit, frame: [Number(from), Number(last)] });
    };
    canvas.addEventListener('click', ev => {
      const rect = canvas.getBoundingClientRect?.();
      if (!rect) return;
      const x = Math.floor((ev.clientX - rect.left) / cell), y = Math.floor((ev.clientY - rect.top) / cell);
      const i = y * c.cols + x;
      if (x < 0 || x >= c.cols || i < 0 || i >= c.cells) return;
      B.from.set(id, BigInt(Math.floor(i / PLATES) * PLATES));
      go('babel-room', id, { push: false });
    });
    c.watchers.push(draw);
    setTimeout(draw, 0);
    wrap.append(box);
  }
  return wrap;
}

// ── A volume ──────────────────────────────────────────────────────

function pageVolume(address) {
  const a = parseAddress(address || '');
  const wing = a && wingByKey(a.key);
  if (!wing || (!a.params && a.wingNumber === null) || (a.params && a.volume === null)) return errorPage('There is no such volume', `“${address}” is not the address of a volume.`);
  let v;
  try { v = openVolume(a.params ? { wing, params: a.params, volume: a.volume } : { wing, wingNumber: a.wingNumber }); }
  catch (e) { return errorPage('There is no such volume', e.message); }
  const { params, volume, body, doc } = v;
  const addr = v.address;
  // What the page draws, runs, opens and saves: the volume in the reader's
  // letters when they brought some. The facts and the spelling read the
  // canonical document — the number is about a, b, ….
  const own = readerDoc(wing, params, doc);
  const shape = roomShape(wing, params);
  const last = shape.finite ? shape.total - 1n : null;
  B.current = { wing, params, volume, last };
  const page = h('div', { class: 'lib-page bab-page bab-volume', data: { family: familyOf(wing) } });
  page.append(locationBar({ wing, params, volume, tail: positionTail(wing, params, volume) }));

  // The head a catalogue entry has: what kind of machine, its name — here its
  // number — what it does in a line, and the same three actions.
  const shown = showNumber(volume);
  let wingNo = null;
  try { const n = wingNumberBelow(wing, params, volume, SHOWN_WING_NUMBER); if (n !== null) wingNo = `${wing.type} № ${groupDigits(n)}`; } catch { /* past the search */ }
  const target = targetFromDoc(own);
  const said = sayLine(wing, params, body, own);
  const code = machineCodeOf(own);
  const standard = wing.kind === 'tm' ? standardOf(doc) : null;
  // A Turing machine's lede is what it does from a blank tape, which arrives
  // with the worker's verdict; every other volume's is known now.
  const lede = said ? h('p', { class: 'lib-lede bab-lede', text: said })
    : wing.kind === 'tm' ? h('p', { class: 'lib-lede bab-lede', text: 'Running it from a blank tape…' }) : null;
  page.append(h('div', { class: 'bab-vol-head' },
    h('div', { class: 'bab-vol-title' },
      h('p', { class: 'lib-kicker bab-vol-kicker' }, h('i', { class: 'lib-dot', 'aria-hidden': 'true' }), [fullName(wing), kindLine(wing, params, body)].filter(Boolean).join(' · ')),
      h('h2', { class: `bab-number${shown.long ? ' is-long' : ''}`, title: `Volume ${groupDigits(volume)}` }, h('span', { class: 'bab-number-mark', text: '№ ' }), shown.text),
      h('div', { class: 'bab-vol-sub' },
        h('span', { title: `Room ${roomId(wing, params)}`, text: paramWords(wing, params) }),
        wingNo ? h('span', { title: `Its number in the whole ${wing.type} wing`, text: wingNo }) : null,
        shown.long ? h('span', { title: 'The number is written out in full in the address and the copy' }, `${groupDigits(shown.digits)} digits · `, button('copy', () => exportCopyText(volume.toString(), 'Every digit copied'), 'lib-textbtn')) : null,
        shape.finite ? null : h('span', { title: 'An endless room orders its volumes by size', text: `size ${v.size}` })),
      lede),
    volumeActions({ v, wingNo, own, addr, shown, code })));

  // The plate between its neighbours on the shelf, and its facts in the margin.
  const stage = volumeStage(target, own);
  const figure = h('div', { class: 'bab-vol-fig' }, stage.node, tryIt(target, stage));
  const facts = h('aside', { class: 'bab-margin', 'aria-label': 'Facts' });
  page.append(h('div', { class: 'bab-vol-body' },
    h('div', { class: 'bab-shelf' }, sideVolume(wing, params, volume - 1n, last, 'prev'), figure, sideVolume(wing, params, volume + 1n, last, 'next')),
    facts));
  // A Turing machine is known by what it does from a blank tape: the section
  // arrives with the verdict, which the worker works out.
  const behaviour = wing.kind === 'tm' ? h('div', { class: 'bab-behaviour-slot' }) : null;
  const onVerdict = behaviour ? verdict => {
    behaviour.innerHTML = '';
    behaviour.append(behaviourSection({ behaviour: verdict, standard }, { target }));
    if (lede) lede.textContent = blankTapeLine(verdict);
    stage.provedBlank?.(verdict);
  } : null;
  fillFacts(facts, { wing, params, body, doc, own, volume, addr, onVerdict });
  marginSections(facts, target, code);

  if (behaviour) page.append(behaviour);
  page.append(spelledSection(wing, params, body, volume, stage));
  if (shape.finite) page.append(neighbourSection(wing, params, body, volume));
  return page;
}

/** What kind of language or behaviour, for the kicker: the line under a catalogue entry's type. */
function kindLine(wing, params, body) {
  if (wing.kind === 'fa') {
    const t = dfaOf(wing.type, params, body);
    return t ? `${CLASS_WORDS[languageClass(t)]} language` : null;
  }
  if (wing.kind === 'omega') return 'ω-regular language';
  return null;
}

/** The machine code a volume is known by anywhere: pasted on a canvas it opens, in a search it finds. */
function machineCodeOf(doc) {
  try { return canonicalCodeOf(doc) || null; } catch { return null; }
}

/** A one-tape Turing machine's standard code (bbchallenge's), from the canonical document. */
function standardOf(doc) {
  try { return writeStandardTM(doc, doc.config.sym) || null; } catch { return null; }
}

/**
 * The actions a catalogue entry has, in its words: open it, keep it, and the
 * rest in a menu. Nothing here needs the network — the volume brings its own
 * document — which is what makes the Library of Babel the offline half.
 */
function volumeActions({ v, wingNo, own, addr, shown, code }) {
  const title = wingNo || `${v.wing.type} ${addr}`;
  const file = `${addr.replace(/[^a-z0-9-]+/gi, '_').slice(0, 80)}.automaton`;
  return h('div', { class: 'lib-actions bab-vol-actions' },
    button('Open in a new tab', () => openOnCanvas(own, addr), 'btn-p', { 'data-tip': 'Open it on a canvas of its own' }),
    saveButton(v, wingNo, own),
    moreMenu([
      canInsertAsBlock(own.machine) ? { label: `Insert into my ${App.machine} as a block`, run: () => insertDocAsBlock(JSON.parse(JSON.stringify(own)), title) } : null,
      { label: 'Download the .automaton file', run: () => exportDownload(file, JSON.stringify(own, null, 2), 'application/x-automatastudio+json') },
      { label: 'Copy link', run: () => exportCopyText(webAppLink({ action: 'babel', address: addr }), 'Link to this volume copied') },
      { label: 'Copy the address', run: () => exportCopyText(addr, 'Address copied — paste it into the Entrance to come back') },
      shown.long ? { label: `Copy all ${groupDigits(shown.digits)} digits`, run: () => exportCopyText(v.volume.toString(), 'Every digit copied') } : null,
      code ? { label: 'Copy the machine code', run: () => exportCopyText(code, 'Machine code copied — paste it on any canvas to open it') } : null,
      { label: 'Submit it to the catalogue', run: () => { if (openOnCanvas(own, addr)) { setView('library'); go('submit'); } } }
    ]));
}

/**
 * What a catalogue entry's aside holds beyond the facts: the formal definition,
 * typeset from the machine itself, and the machine code with a copy.
 */
function marginSections(box, target, code) {
  const math = h('div', { class: 'lib-math bab-math', 'aria-label': 'Formal definition' });
  try {
    math.textContent = withMachine(target, () => buildFormalDefLatex());
    box.append(h('section', { class: 'lib-aside-sec bab-aside-sec' }, h('h4', { class: 'lib-aside-title', text: 'Definition' }), math));
    triggerMath(math);
  } catch { /* a machine the tuple writer cannot read: the facts stand */ }
  if (code) {
    box.append(h('section', { class: 'lib-aside-sec lib-machine-code bab-aside-sec' },
      h('h4', { class: 'lib-aside-title', text: 'Machine code' }),
      h('code', { class: 'lib-code-text', text: code }),
      h('div', { class: 'lib-standard-actions' },
        button('Copy', () => exportCopyText(code, 'Machine code copied — paste it on any canvas to open it'), 'lib-textbtn'))));
  }
}

/**
 * Save, as a catalogue entry has it: into My Library, under `babel:<address>`,
 * kept as the document the number spells, so it opens offline and lists beside
 * the catalogue's machines. The same button, the same words, the same store.
 */
function saveButton(v, wingNo, doc = v.doc) {
  const id = `babel:${v.address}`;
  const saved = isInMyLibraryNow(id);
  const entry = { id, title: wingNo || `${v.wing.type} ${v.address}`, machine: v.wing.type, babel: v.address };
  return button(saved ? 'Saved' : 'Save', () => toggleSavedVolume(entry, JSON.stringify(doc)), `btn-g${saved ? ' is-saved' : ''}`,
    { 'aria-pressed': saved ? 'true' : 'false', 'data-tip': saved ? 'In My Library — opens offline' : 'Keep a copy in My Library that opens offline' });
}

/** A neighbour on the shelf: the volume either side, quiet, one step away. */
function sideVolume(wing, params, volume, last, side) {
  if (volume < 0n || (last !== null && volume > last)) return h('div', { class: `bab-side is-${side} is-none` });
  let o;
  try { o = openVolume({ wing, params, volume }); } catch { return h('div', { class: `bab-side is-${side} is-none` }); }
  const od = readerDoc(wing, params, o.doc);
  const said = sayVolume(wing, params, o.body, od.sigma).text;
  return h('button', {
    type: 'button', class: `bab-side is-${side}`, title: `${side === 'prev' ? 'Previous' : 'Next'} volume (${side === 'prev' ? '←' : '→'}) — ${said}`,
    on: { click: () => go('babel-volume', o.address, { push: false }) }
  },
  plateFigure(od, { w: 160, h: 120 }),
  h('span', { class: 'bab-side-cap', title: groupDigits(volume) }, side === 'prev' ? `‹ ${showNumber(volume).text}` : `${showNumber(volume).text} ›`),
  h('span', { class: 'bab-side-says', text: said }));
}

/** One line of what a volume does, the first thing a reader wants to know. */
function sayLine(wing, params, body, doc) {
  if (wing.kind === 'fa') {
    const t = dfaOf(wing.type, params, body);
    if (!t) return null;
    const c = languageClass(t);
    if (c === 'e') return 'Accepts nothing.';
    if (c === 'u') return 'Accepts every word.';
    const words = firstWords(t, { count: 4, maxLen: SHORT_WORD }).map(w => spellWord(w, doc.sigma));
    // The search is exact to its length — every state a word of that length
    // reaches is visited — so no word found means none that short exists.
    if (!words.length) return `Accepts no word of ${SHORT_WORD} letters or fewer${c === 'f' ? '' : ', and infinitely many longer ones'}.`;
    return `Accepts ${words.join(', ')}${c === 'f' && words.length < 4 ? '' : ', …'}`;
  }
  if (wing.kind === 'omega') return classifyBody(wing, params, body) === 'o' ? 'Accepts some ω-word.' : 'Accepts no ω-word.';
  if (wing.kind === 'tm') return null;
  const c = classifyBody(wing, params, body);
  const lab = cellClassesOf(wing).find(x => x.key === c);
  return lab ? `${lab.label[0].toUpperCase()}${lab.label.slice(1)} of the words up to length 3.` : null;
}

/** A Turing machine's lede: what it does from a blank tape, from the worker's verdict. */
function blankTapeLine(v) {
  if (v?.verdict === 'halts') return v.steps ? `Halts from a blank tape after ${groupDigits(v.steps)} step${v.steps === 1 ? '' : 's'}.` : 'Halts at once: from a blank tape it stops before taking a single step.';
  if (v?.verdict === 'never') return 'Never halts from a blank tape.';
  return 'Whether it halts from a blank tape is not settled yet.';
}

function openOnCanvas(doc, addr) {
  const ok = applyDocument(JSON.stringify(doc), `${addr.replace(/[^a-z0-9-]+/gi, '_')}.automaton`, { tabName: addr });
  if (!ok) return false;
  if (App.view !== 'build') setView('build');
  showStatus(`Opened ${addr} from AutomataStudio Babel`);
  return true;
}

/** The figure: the live diagram (names, labels, lit by Try it), or past 60 states the transition table. */
function volumeStage(target, doc) {
  const frame = h('div', { class: 'lib-stage-frame bab-stage-frame' });
  const runbar = h('div', { class: 'lib-runbar', 'aria-live': 'polite' });
  runbar.setAttribute('hidden', '');
  const switcher = h('div', { class: 'lib-figswitch', role: 'tablist' });
  const caption = h('span', { class: 'lib-figcaption-text' });
  const node = h('figure', { class: 'lib-stage bab-stage' }, frame, runbar, h('figcaption', { class: 'lib-figcaption bab-figcaption' }, caption, switcher));
  const stage = { node, frame, runbar, switcher, caption, live: null, pending: null, pictures: new Map() };
  if (target.states.length <= 60) {
    try {
      const live = liveDiagram(target, { w: 640 });
      const holder = svgFigure(live.svg, 'is-stage lib-live');
      holder.setAttribute('role', 'img');
      holder.setAttribute('aria-label', 'This volume’s diagram');
      frame.style.setProperty('--fig-aspect', `640 / ${live.h}`);
      frame.append(holder);
      stage.live = { ...live, el: holder, nodes: null, edges: null };
      stage.pictures.set('diagram', { label: 'Diagram', say: `${target.states.length} state${target.states.length === 1 ? '' : 's'} · ${target.transitions.length} transition${target.transitions.length === 1 ? '' : 's'}`, node: holder });
    } catch { /* falls through to the table */ }
  }
  if (!stage.pictures.size) {
    const tableNode = transitionTable(doc);
    frame.append(tableNode);
    stage.pictures.set('diagram', { label: 'Table', say: `${groupDigits(target.states.length)} states — too many to sketch, so this is δ`, node: tableNode });
  }
  caption.textContent = stage.pictures.get('diagram').say;
  return stage;
}

const TABLE_ROWS = 12;

function transitionTable(doc) {
  const box = h('div', { class: 'bab-table' });
  let page = 0;
  const fields = Object.keys(doc.transitions[0] || {}).filter(k => !['id', 'from', 'to', 'curve', 'loopAngle'].includes(k));
  const names = new Map(doc.states.map(s => [s.id, s.name]));
  const paint = () => {
    box.innerHTML = '';
    const rows = doc.transitions.slice(page * TABLE_ROWS, (page + 1) * TABLE_ROWS);
    const pages = Math.max(1, Math.ceil(doc.transitions.length / TABLE_ROWS));
    box.append(h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'from' }), fields.map(f => h('th', { text: f })), h('th', { text: 'to' }))),
      h('tbody', {}, rows.map(t => h('tr', {}, h('td', { text: names.get(t.from) }), fields.map(f => h('td', { text: Array.isArray(t[f]) ? t[f].join(' ') : String(t[f] ?? '') })), h('td', { text: names.get(t.to) }))))),
    h('div', { class: 'bab-table-nav' },
      h('button', { type: 'button', class: 'bab-step', 'aria-label': 'Earlier rows', disabled: page === 0 ? '' : null, on: { click: () => { page = Math.max(0, page - 1); paint(); } } }, '‹'),
      h('span', { text: `${page * TABLE_ROWS + 1}–${Math.min(doc.transitions.length, (page + 1) * TABLE_ROWS)} of ${groupDigits(doc.transitions.length)}` }),
      h('button', { type: 'button', class: 'bab-step', 'aria-label': 'Later rows', disabled: page >= pages - 1 ? '' : null, on: { click: () => { page = Math.min(pages - 1, page + 1); paint(); } } }, '›')));
  };
  paint();
  return box;
}

function tryIt(target, stage) {
  const cfg = getMachineConfig(target.machine) || {};
  const input = h('input', {
    class: 'lib-try-input', type: 'text', spellcheck: 'false', autocomplete: 'off',
    placeholder: cfg.isOmega ? 'u(v), e.g. ab(a)' : target.tapeCount > 1 ? 'input for tape 1' : `a word over {${target.sigma.filter(s => s !== target.config?.sym?.eps).join(', ')}}`,
    'aria-label': 'Word to run'
  });
  const out = h('div', { class: 'lib-try-out', 'aria-live': 'polite' });
  // A Turing machine's run on ε is its run from a blank tape, which the
  // Behaviour section may have settled past Try it's budget. A chip reading
  // "no verdict" beside "Never halts — proven" read as the page contradicting
  // itself, so the proof answers for ε when the budget could not.
  let blank = null;
  const chipFor = (w, got) => {
    if (w !== '' || got.verdict !== 'unk' || !blank) return verdictChip(w, got);
    if (blank.verdict === 'never') return h('button', { type: 'button', class: 'lib-verdict is-rej', title: 'Proved never to halt from a blank tape, so it never accepts' }, 'ε → never halts');
    if (blank.verdict === 'halts') return h('button', { type: 'button', class: 'lib-verdict is-unk', title: 'Past the budget Try it runs; the Behaviour section ran it to the end' }, `ε → halts after ${groupDigits(blank.steps ?? 0)} steps`);
    return verdictChip(w, got);
  };
  let blankChip = null;
  stage.provedBlank = v => {
    blank = v;
    if (blankChip) { const next = chipFor('', decideRaw(target, '')); next.addEventListener('click', () => { input.value = ''; run(); }); blankChip.replaceWith(next); blankChip = next; }
    if (out.firstChild && out.dataset.word === '') { out.innerHTML = ''; out.append(chipFor('', decideRaw(target, ''))); }
  };
  const run = () => {
    const got = decideRaw(target, input.value);
    out.innerHTML = '';
    out.dataset.word = input.value;
    out.append(chipFor(input.value, got));
    if (got.verdict !== 'err' && stage.live) {
      const trace = traceWord(target, input.value);
      if (!trace.error && trace.steps.length) playRun(stage, trace, got);
    }
  };
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } });
  // A catalogue entry lists its author's examples; a volume has no author, so
  // it lists the shortest words, each run on the machine when the page is up.
  const examples = h('div', { class: 'lib-try-examples' });
  const words = sampleWords(target);
  if (words.length) {
    setTimeout(() => {
      const list = h('div', { class: 'lib-chips' });
      for (const w of words) {
        const chip = chipFor(w, decideRaw(target, w));
        chip.addEventListener('click', () => { input.value = w; run(); });
        if (w === '') blankChip = chip;
        list.append(chip);
      }
      examples.append(h('span', { class: 'lib-try-label', text: 'The shortest words' }), list);
    }, 0);
  }
  return h('section', { class: 'lib-try bab-try' },
    h('div', { class: 'lib-try-row' }, input, button('Run', run, 'lib-textbtn bab-run')),
    out, examples);
}

/** The words a volume is tried on first: ε and the shortest words over its first letters, or a few lassos. */
function sampleWords(target) {
  const cfg = getMachineConfig(target.machine) || {};
  const eps = target.config?.sym?.eps;
  const letters = (target.sigma || []).filter(s => s !== eps && s !== target.config?.sym?.blank).slice(0, 3);
  if (!letters.length || target.tapeCount > 1) return [];
  const sep = letters.some(s => [...String(s)].length > 1) ? ' ' : '';
  if (cfg.isOmega) {
    const [a, b = a] = letters;
    return [...new Set([`(${a})`, `(${b})`, `${a}(${b})`, `${b}(${a})`, `(${a}${sep}${b})`])];
  }
  const out = [''];
  let layer = [''];
  for (let len = 1; len <= 2 && out.length < 9; len++) {
    layer = layer.flatMap(w => letters.map(a => (w ? `${w}${sep}${a}` : String(a))));
    out.push(...layer);
  }
  return out.slice(0, wingOf(target.machine)?.kind === 'tm' ? 5 : 9);
}

/** A fact: a short label and its value over a hairline, with what it means in the tooltip. */
function fact(label, value, { title = '', cls = '' } = {}) {
  return h('div', { class: `bab-fact${cls ? ` ${cls}` : ''}`, title },
    h('span', { class: 'bab-fact-k', text: label }),
    h('span', { class: 'bab-fact-v' }, value));
}

const CLASS_WORDS = { e: 'empty', u: 'everything', f: 'finite', c: 'cofinite', o: 'infinite, co-infinite' };

/** The facts in the margin: one short row each, computed. */
function fillFacts(box, { wing, params, body, doc, own = doc, volume, addr, onVerdict = null }) {
  if (wing.kind === 'fa') {
    const t = dfaOf(wing.type, params, body);
    if (t) {
      const c = languageClass(t);
      const min = minimiseDfa(t);
      box.append(fact('Language', CLASS_WORDS[c], { title: 'The class of the language it accepts' }));
      box.append(fact('Minimal', wing.type === 'DFA' && min.n === params[0] ? '✓ already' : `${min.n} state${min.n === 1 ? '' : 's'}`,
        { title: wing.type === 'DFA' && min.n === params[0] ? 'No smaller DFA says this' : 'The size of its minimal DFA' }));
      const rows = languageRows(asSketchDfa(min, Array.from({ length: params[1] }, (_, i) => own.sigma?.[i] ?? letterName(i))));
      // The strip says what it is under it, not only in its tooltip: bare, it
      // read as a bar chart with no axis.
      if (rows) box.append(h('div', { class: 'bab-lang', title: 'Every word up to a length, one row per length, inked where accepted' }, svgFigure(drawLanguage(rows, { w: 260, h: 96 }), 'bab-lang-fig'),
        h('span', { class: 'bab-lang-cap', text: `every word to length ${rows.length - 1}, a row per length from ε down · inked where accepted` })));
    }
  } else if (wing.omega === 'buchi') {
    // The DWA and NWA wings were these wings under another name: a weak
    // automaton decides as Büchi does, so the page says whether this one is weak.
    // What it accepts comes first, as a finite automaton's class does; the
    // weak/not-weak line was the only fact an ω page had.
    const nonEmpty = classifyBody(wing, params, body) === 'o';
    box.append(fact('Language', nonEmpty ? 'non-empty' : 'empty', { title: nonEmpty ? 'Some ω-word has an accepting run: a lasso through F' : 'No ω-word has an accepting run: no reachable state of F lies on a cycle' }));
    const clash = weakViolation(doc);
    const names = new Map(doc.states.map(s => [s.id, s.name]));
    box.append(fact('Weak', clash ? `no — {${clash.map(q => names.get(q) || q).join(', ')}} straddles F` : '✓ yes',
      { title: `Weak: every cycle sits wholly inside F or wholly outside it. A weak automaton (${wing.type === 'DBA' ? 'DWA' : 'NWA'}) is shelved here, since it decides as a Büchi automaton does.` }));
  } else if (wing.kind === 'tm') {
    const slot = h('div', { class: 'bab-fact-slot' });
    box.append(slot);
    tmVerdict(slot, wing, params, volume, addr, 1e5, onVerdict);
    const code = (() => { try { return writeStandardTM(doc, doc.config.sym); } catch { return null; } })();
    if (code) box.append(fact('Code', h('span', {}, h('a', { class: 'lib-link bab-code', href: bbchallengeUrl(code), target: '_blank', rel: 'noopener noreferrer', text: code, title: 'Open on bbchallenge.org' })), { title: 'Its standard code' }));
  }
  const conv = conventionsOf(wing);
  if (conv.length) box.append(fact('Reads as', conv.map(c => c.split(':')[0]).join(' · '), { title: conv.join('\n') }));

  // Twins, after a tick: a search can take a moment.
  const twinVal = h('span', { text: '…' });
  box.append(fact('Twins', twinVal, { title: 'Volumes of this room that are this machine with its states renamed; the canonical copy numbers them breadth-first' }));
  setTimeout(() => {
    let c;
    try { c = canonicalOf(wing, params, body, { budget: 3000, ms: 250 }); } catch { twinVal.textContent = '—'; return; }
    twinVal.innerHTML = '';
    if (!c.exact) { twinVal.append('not settled within the budget'); return; }
    twinVal.append(c.twins === 1n ? 'none' : shortCount(c.twins));
    if (c.volume === volume) { if (c.twins !== 1n) twinVal.append(h('span', { class: 'bab-fact-note', text: ' · canonical copy' })); }
    else twinVal.append(h('span', { class: 'bab-fact-note' }, ' · canonical copy is ', button(showNumber(c.volume).text, () => go('babel-volume', volumeAddress(wing, params, c.volume)), 'bab-inline-btn')));
  }, 0);

  catalogueFact(box, wing, params, body, doc, own);
  const notes = [...(B.notes.get(addr) || [])];
  if (notes.length) box.append(h('p', { class: 'bab-note', text: notes.join(' ') }));
  const lettering = letteringNote(wing, params, doc, own, addr);
  if (lettering) box.append(lettering);
}

/**
 * Whose letters the page is in. A volume's number is over the canonical
 * a, b, …, so a machine over {x, y, z} is the same volume as its copy over
 * {a, b, c}; the page draws it in the letters the reader brought, says so,
 * and offers the canonical ones (one switch, for every room).
 */
function letteringNote(wing, params, doc, own, addr) {
  const names = B.names.get(roomId(wing, params));
  if (!names) return null;
  const pairs = [];
  const add = (mine, canon) => (mine || []).forEach((s, i) => { if (canon?.[i] !== undefined && String(s) !== String(canon[i])) pairs.push([String(s), String(canon[i])]); });
  add(names.sigma, doc.sigma);
  add(names.outputAlpha, doc.outputAlpha);
  if (!pairs.length) return null;
  const mine = pairs.map(p => p[0]).join(', '), canon = pairs.map(p => p[1]).join(', ');
  // Letters a document could not take back (a multi-character name in a
  // push string): the page stays canonical and says how they correspond.
  if (own === doc && B.ownLetters) return h('p', { class: 'bab-note', text: `Your letters ${mine} are ${canon} here.` });
  const flip = () => { B.ownLetters = !B.ownLetters; go('babel-volume', addr, { push: false }); };
  return h('p', { class: 'bab-note' },
    B.ownLetters ? `In your letters ${mine}; its number spells them ${canon}. ` : `In the Library's letters ${canon}; you wrote ${mine}. `,
    button(B.ownLetters ? `Show ${canon}` : `Show ${mine}`, flip, 'bab-inline-btn'));
}

function tmVerdict(slot, wing, params, volume, addr, budget, onVerdict = null) {
  slot.innerHTML = '';
  slot.append(fact('Blank tape', h('span', { class: 'bab-fact-note', text: 'running…' })));
  const key = `${addr}|${budget}`;
  const show = v => {
    slot.innerHTML = '';
    if (!v) { slot.append(fact('Blank tape', '—')); onVerdict?.(null); return; }
    onVerdict?.(v);
    if (v.verdict === 'halts' && !v.steps) {
      slot.append(fact('Halts', 'at once', { title: 'From a blank tape it stops before taking a single step' }));
    } else if (v.verdict === 'halts') {
      slot.append(fact('Halts', `${groupDigits(v.steps ?? 0)} step${v.steps === 1 ? '' : 's'}${v.ones !== undefined ? ` · ${groupDigits(v.ones)} cells` : ''}`, { cls: 'is-good', title: 'From a blank tape, proved by running it; cells are the non-blank cells it leaves' }));
    } else if (v.verdict === 'never') {
      slot.append(fact('Never halts', METHOD_WORDS[v.method] || v.method || 'proved', { cls: 'is-warn', title: 'Proved from a blank tape' }));
    } else {
      const next = budget < 1e7 ? 1e7 : budget < 2e8 ? 2e8 : null;
      slot.append(fact('Halts?', h('span', {}, `unknown after ${sayCount(BigInt(Math.round(budget)))} steps`,
        next ? [' · ', button('try harder', () => tmVerdict(slot, wing, params, volume, addr, next, onVerdict), 'bab-inline-btn')] : null), { cls: 'is-open' }));
    }
  };
  if (B.verdicts.has(key)) { show(B.verdicts.get(key)); return; }
  askBabel({ type: 'behaviour', key: wing.key, params, volume: volume.toString(), budget }).then(reply => {
    const v = reply.type === 'behaviour' ? reply.verdict : null;
    B.verdicts.set(key, v);
    show(v);
  });
}

const METHOD_WORDS = {
  cycler: 'a cycle', translated: 'a translated cycle', backward: 'backward reasoning', segment: 'halting segment',
  far: 'finite automata reduction', loops: 'loop decider', ngram: 'n-gram CPS', repwl: 'repeated word list', bouncers: 'bouncer'
};

/** Rename a volume's letters (and a TM's tape symbols) to another alphabet, index for index. */
function renamedLetters(doc, to) {
  const from = doc.sigma || [];
  if (from.length !== to.length) return null;
  const map = new Map(from.map((s, i) => [s, String(to[i])]));
  const re = s => (map.has(s) ? map.get(s) : s);
  return {
    ...doc,
    sigma: from.map(re),
    stackAlpha: (doc.stackAlpha || []).map(re),
    transitions: doc.transitions.map(t => ({
      ...t, symbol: re(t.symbol), ...(t.write !== undefined ? { write: re(t.write) } : {}),
      ...(Array.isArray(t.tapeSyms) ? { tapeSyms: t.tapeSyms.map(re), tapeWrites: (t.tapeWrites || []).map(re) } : {})
    }))
  };
}

/** Is this volume in the catalogue, under any names for its letters? Does a listed machine say the same? */
function catalogueFact(box, wing, params, body, doc, own = doc) {
  const index = cachedLibrary()?.index;
  const submit = button('submit it', () => {
    const b = doc.meta?.babel;
    if (openOnCanvas(own, b ? `${b.room}/${b.volume}` : 'babel')) { setView('library'); go('submit'); }
  }, 'bab-inline-btn');
  if (!index?.entries?.length) { box.append(fact('Catalogue', h('span', {}, '— · ', submit), { title: 'The catalogue is the Library’s listed machines' })); return; }
  const n = doc.states.length;
  let same = null;
  for (const e of index.entries) {
    if (!e.machineId || wingOf(e.machine) !== wing || e.stats?.states !== n) continue;
    const sigma = [...(e.stats.sigma || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const renamed = renamedLetters(doc, sigma);
    if (!renamed) continue;
    let id = null;
    try { id = machineIdOf(renamed); } catch { /* not writable */ }
    if (id && id === e.machineId) { same = e; break; }
  }
  if (same) { box.append(fact('Catalogue', button(`${same.title} →`, () => go('entry', same.id), 'bab-inline-btn'), { cls: 'is-good', title: 'This machine is listed in the catalogue' })); return; }
  if (wing.kind === 'fa') {
    const t = dfaOf(wing.type, params, body);
    const min = t && minimiseDfa(t);
    const says = min && index.entries.find(e => e.dfa && e.dfa.n === min.n && (e.dfa.sigma || []).length === min.k
      && JSON.stringify(e.dfa.delta) === JSON.stringify(Array.from(min.delta)) && JSON.stringify(e.dfa.acc) === JSON.stringify(Array.from(min.acc).flatMap((x, q) => (x ? [q] : []))));
    if (says) { box.append(fact('Same language', button(`${says.title} →`, () => go('entry', says.id), 'bab-inline-btn'), { title: `A listed machine accepts the same language, read with its letters ${says.dfa.sigma.join(', ')}` })); return; }
  }
  box.append(fact('Catalogue', h('span', {}, 'not listed · ', submit), { title: 'Not in the Library’s catalogue yet' }));
}

/**
 * The number spelled: the idea at the Library's heart — the number is the
 * machine. In a finite room each tile is one term of the sum, and one part of
 * the machine it sets; pointing at a tile lights its edge. An endless room
 * spells by size instead.
 */
function spelledSection(wing, params, body, volume, stage) {
  const shown = showNumber(volume).text;
  const sec = h('section', { class: 'bab-spelled' });
  const tiles = finiteTiles(wing, params, body);
  if (tiles) {
    // The sum is written out only where it can be read: a room's every term
    // as long as its number, for a sum that would be cut to a line anyway, was
    // most of a big room's page.
    const sum = tiles.length <= 12
      ? `${[tiles.offset, ...tiles.map(t => t.digit * t.place)].filter((x, i) => i || x).map(x => groupDigits(x)).join(' + ')} = ${groupDigits(volume)}`
      : null;
    sec.append(h('div', { class: 'lib-sechead', title: 'Each tile is one digit of the number in its place value, and the part of the machine that digit sets. ↑ and ↓ move to the volume that differs in exactly that part.' },
      h('h3', { class: 'lib-sechead-title', text: `${shown}, spelled` }),
      h('span', { class: 'bab-spelled-key', text: 'each term sets one part' })));
    const MAX = 48;
    const row = h('div', { class: 'bab-tiles' });
    tiles.slice(0, MAX).forEach((t, i) => {
      const go1 = d => go('babel-volume', volumeAddress(wing, params, nudge(tiles, volume, i, d)), { push: false });
      const rule = `${t.key} ${String(t.value || '').startsWith('{') ? '=' : '→'} ${t.value || '—'}`;
      const tile = h('div', { class: 'bab-tile', tabindex: '0', title: `${rule}: digit ${t.digit} of ${t.radix}, × ${sayCount(t.place)}` },
        tileTerm(t.digit * t.place),
        h('span', { class: 'bab-tile-rule', text: rule }),
        h('span', { class: 'bab-tile-nudge' },
          button('↑', () => go1(1), 'bab-nudge', { 'aria-label': 'Next value for this part' }),
          button('↓', () => go1(-1), 'bab-nudge', { 'aria-label': 'Previous value for this part' })));
      tile.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowUp') { ev.preventDefault(); go1(1); }
        if (ev.key === 'ArrowDown') { ev.preventDefault(); go1(-1); }
      });
      tile.addEventListener('mouseenter', () => lightTile(stage, t));
      tile.addEventListener('mouseleave', () => lightTile(stage, null));
      tile.addEventListener('focus', () => lightTile(stage, t));
      tile.addEventListener('blur', () => lightTile(stage, null));
      row.append(tile);
    });
    if (tiles.length > MAX) row.append(h('div', { class: 'bab-tile is-more', text: `+${groupDigits(tiles.length - MAX)}` }));
    sec.append(row);
    sec.append(sum && sum.length <= 96 ? h('span', { class: 'bab-sum', text: sum }) : h('span', { class: 'bab-sum', title: sum && sum.length <= 4000 ? sum : null, text: `${groupDigits(tiles.length)} terms add up to ${shown}` }));
    return sec;
  }
  const sp = endlessSpelling(wing, params, body);
  sec.append(h('div', { class: 'lib-sechead', title: 'In an endless room a volume’s number is every smaller volume first, then its rank at its own size.' },
    h('h3', { class: 'lib-sechead-title', text: `${shown}, spelled` }),
    h('span', { class: 'bab-spelled-key', text: `${groupDigits(sp.before)} smaller + rank ${groupDigits(sp.rank)} at size ${sp.size} = ${groupDigits(volume)}` })));
  sec.append(h('div', { class: 'bab-tiles is-parts' }, sp.items.slice(0, 48).map(it => h('div', { class: 'bab-tile is-part', title: `size ${it.size}` },
    h('span', { class: 'bab-tile-rule', text: it.key }), h('span', { class: 'bab-tile-val', text: it.value })))));
  sec.append(h('div', { class: 'bab-ladder', title: 'Volumes of this room at each size' }, sp.counts.slice(0, sp.size + 1).map((c, s) => h('span', { class: `bab-rung${s === sp.size ? ' is-here' : ''}` },
    h('b', { text: sayCount(c) }), h('small', { text: `size ${s}` })))));
  return sec;
}

/** A term of the sum, set to fit its tile: a long one smaller, a huge one as a power of ten. */
function tileTerm(n) {
  const text = pretty(sayCount(n));
  return h('span', { class: `bab-tile-term${[...text].length > 9 ? ' is-long' : ''}`, title: groupDigits(n), text });
}

/** Light the edge a tile is, where the wing says which edge that is. */
function lightTile(stage, tile) {
  const live = stage?.live;
  if (!live?.el) return;
  for (const n of live.el.querySelectorAll?.('.is-tile') || []) n.classList.remove('is-tile');
  if (!tile?.edge) return;
  const [from, to] = tile.edge;
  const key = `${live.rootOf?.get(`s${from}`) || `s${from}`}|${live.rootOf?.get(`s${to}`) || `s${to}`}`;
  live.el.querySelector?.(`[data-e="${key}"]`)?.classList.add('is-tile');
}

function neighbourSection(wing, params, body, volume) {
  const near = neighbours(wing, params, body, volume, { limit: 6 });
  if (!near.length) return null;
  const tiles = finiteTiles(wing, params, body);
  const sec = h('section', { class: 'bab-near' },
    h('div', { class: 'lib-sechead', title: 'Volumes that differ from this one in exactly one part' },
      h('h3', { class: 'lib-sechead-title', text: 'You might be interested in' }),
      h('span', { class: 'bab-spelled-key', text: 'one part changed' })));
  const row = h('div', { class: 'bab-near-row' });
  for (const nb of near) {
    try {
      const o = openVolume({ wing, params, volume: nb.volume });
      const od = readerDoc(wing, params, o.doc);
      const said = sayVolume(wing, params, o.body, od.sigma).text;
      const t = finiteTiles(wing, params, o.body)?.[nb.tile];
      row.append(h('button', { type: 'button', class: 'bab-near-chip', title: `${tiles[nb.tile].key}: ${t?.value || '—'} — ${said}`, on: { click: () => go('babel-volume', volumeAddress(wing, params, nb.volume)) } },
        plateFigure(od, { w: 160, h: 90 }),
        h('span', { class: 'bab-near-cap' }, plateNumber(nb.volume, 'bab-near-num'), h('span', { class: 'bab-near-change', text: `${tiles[nb.tile].key} → ${t?.value || '—'}` })),
        h('span', { class: 'bab-near-says', text: said })));
    } catch { /* past the room */ }
  }
  sec.append(row);
  reveal([...row.children]);
  return sec;
}

// ── From the catalogue ────────────────────────────────────────────

/** A search the catalogue has no machine for → the Babel volume it names (find.js's `volumeNamedBy`). */
export function babelLookup(query) {
  return volumeNamedBy(query, { wing: B.wing });
}

/**
 * What the catalogue shows when it has no machine: the Library of Babel's
 * volume for the search — or for the canvas, after Match my canvas — drawn as
 * a plate that opens it; and when the search names no machine, the way in.
 * Every machine of the kinds it numbers (DFAs, NFAs, Büchi automata, one-counter automata and Turing machines) is in the Library of
 * Babel, so a search for one that finds nothing in the catalogue has
 * somewhere to go; a machine of another kind is told so.
 */
export function babelOffer(query, { canvas = false, also = false, offline = false } = {}) {
  let found = null;
  if (canvas) {
    try { found = findVolume('canvas'); } catch { found = null; }
  } else found = babelLookup(query);
  // Beside catalogue results, only a machine the search itself names: the
  // canvas, or a regular expression (a code or an address the catalogue lists
  // is already among the results) — or why a programmer's regex names none.
  const refused = found?.kind === 'error' && found.refused;
  if (also && !refused && !(found?.kind === 'volume' && (canvas || found.regex))) return null;
  let v = null;
  if (found?.kind === 'volume') {
    try { v = openVolume({ key: found.key, params: found.params, volume: found.volume }); } catch { v = null; }
  }
  if (v) {
    let wingNo = null;
    try { const n = wingNumberBelow(v.wing, v.params, v.volume, SHOWN_WING_NUMBER); if (n !== null) wingNo = `${v.wing.type} № ${groupDigits(n)}`; } catch { /* past the search */ }
    const doc = foundDoc(v, found);
    const said = found.regex ? `accepts ${found.regex}` : sayVolume(v.wing, v.params, v.body, doc.sigma).text;
    const open = () => followFound(found);
    return h('section', { class: 'bab-offer', data: { family: familyOf(v.wing) }, 'aria-label': 'In AutomataStudio Babel' },
      h('button', { type: 'button', class: 'bab-offer-fig', title: `Open ${v.address} in AutomataStudio Babel`, 'aria-label': `Open ${v.address}`, on: { click: open } }, plateFigure(doc, { w: 300, h: 160 })),
      h('div', { class: 'bab-offer-text' },
        h('span', { class: 'bab-kicker', text: 'AutomataStudio Babel' }),
        h('p', { class: 'bab-offer-say', text: offline
          ? (canvas ? 'Your machine’s volume in AutomataStudio Babel.' : 'Its volume in AutomataStudio Babel.')
          : also
          ? (canvas ? 'No entry is your machine itself, but it has a volume in AutomataStudio Babel.' : 'The machine this expression describes has a volume in AutomataStudio Babel.')
          : (canvas ? 'Your machine is not in the catalogue, but it has a volume in AutomataStudio Babel.' : 'Not in the catalogue, but it has a volume in AutomataStudio Babel.') }),
        h('span', { class: 'bab-offer-addr', text: `${wingNo ? `${wingNo} · ` : ''}${v.address}` }),
        said ? h('span', { class: 'bab-offer-says', text: said }) : null,
        button('Open the volume →', open, 'lib-textbtn bab-walk is-strong')));
  }
  const canvasHasMachine = (App.states || []).length > 0 && !canvas && !!wingOf(App.machine);
  return h('section', { class: 'bab-offer is-plain', 'aria-label': 'AutomataStudio Babel' },
    h('div', { class: 'bab-offer-text' },
      h('span', { class: 'bab-kicker', text: 'AutomataStudio Babel' }),
      h('p', { class: 'bab-offer-say', text: refused
        ? 'AutomataStudio Babel finds a regular expression by its minimal DFA, and this is not one it can read.'
        : found?.kind === 'error' && canvas ? 'AutomataStudio Babel numbers DFAs, NFAs, Büchi automata, one-counter automata and Turing machines.'
        : 'Every machine of the kinds it numbers has a volume there.' }),
      h('span', { class: 'bab-offer-hint', text: found?.kind === 'error' && (canvas || refused) ? found.error : 'Describe it as a regular expression or a machine code, or bring the one on your canvas.' }),
      h('div', { class: 'bab-offer-actions' },
        button('Look it up in AutomataStudio Babel →', () => go('babel'), 'lib-textbtn bab-walk is-strong'),
        canvasHasMachine ? button('Find my canvas there', () => followFound(findVolume('canvas')), 'lib-textbtn') : null)));
}

// ── Links ─────────────────────────────────────────────────────────

/** `#babel=…` and automata-studio://babel/… land here. */
export function babelRequest(req) {
  if (!req?.address) { go('babel', null, { reset: true }); return true; }
  const found = findVolume(req.address, { wing: B.wing });
  if (!found || found.kind === 'error') { go('babel', null, { reset: true }); showStatus(found?.error || 'That is not an address in AutomataStudio Babel.'); return false; }
  if (found.kind === 'wing') go('babel-wings', found.key, { reset: true });
  else if (found.kind === 'room') go('babel-room', roomId(wingByKey(found.key), found.params), { reset: true });
  else go('babel-volume', found.address, { reset: true });
  return true;
}

export const BABEL_PAGES = {
  babel: pageEntrance,
  'babel-wings': pageWings,
  'babel-room': pageRoom,
  'babel-volume': pageVolume
};

/** What an address is, in a line — for StateMate and the command line. */
export function describeAddress(text) {
  const found = findVolume(text, { wing: B.wing });
  if (!found || found.kind !== 'volume') return found?.error || null;
  const v = openVolume({ key: found.key, params: found.params, volume: found.volume });
  return `${found.address}: ${sayVolume(v.wing, v.params, v.body).text}`;
}
