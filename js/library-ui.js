// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY — MACHINES OTHER PEOPLE BUILT
// ══════════════════════════════════════════════════════════════════
//  The fourth auxiliary view. Everything a reader can do with a published
//  machine starts here: find it, try it without opening it, open it, keep it
//  offline, drop it into their own machine as a block, remix it, and send
//  their own back.
//
//  What makes it more than a folder of files is that every claim on a listing
//  was *computed* — by js/library/analyze.js, in the library's CI — and the
//  "try it" box runs the machine itself, here, before anything is loaded. A
//  badge on a card is an answer the app got by asking the machine.
//
//  Layout is the Reference view's: a nav rail and a content pane, inside the
//  shared aux overlay. Pages are built as nodes with listeners attached at
//  creation, the way reference.js and statemate-ui.js do it, so the view adds
//  nothing to bridge.js — setView('library') is already there.
//
//  Pages: discover · browse · entry/<id> · collections · collection/<id> ·
//         mine · submit · about

import { $, App, activeWorkspaceId, getMachineConfig } from './state.js';
import { applyDocument, getWorkspaceData } from './persistence.js';
import { canonicalCodeOf, machineIdOf } from './library/hash.js';
import { codeSearchText } from './library/code-search.js';
import { exportCopyText, exportDownload } from './export-core.js';
import { setView } from './view.js';
import { showStatus } from './utils.js';
import { bbchallengeUrl } from './interop/standard-tm.js';
import { renderExampleCard } from './machine-card.js';
import { setCardSourcePainter } from './card-source.js';
import { setLibraryRequestHandler } from './library/requests.js';
import {
  FRONTIS_NOTE, MAST_LEDE, cardPicture, figureSvg, frontispieceWhat, plateCaption, plateDate, plateMarks, rankBadges, standardSize
} from './library/card-html.js';
import { drawLanguage, drawRun, drawSketch, framesFromStandard, languageRows, sketchAspect, unpackSketch } from './library/sketch.js';
import { freeSpotForBlock, placeBlockDefinition } from './blocks-ui.js';
import { machineSupportsBlocks } from './machines/index.js';
import { machineTargetFromApp, withMachine } from './exercise/grade.js';
import { buildFormalDefLatex } from './render.js';
import { triggerMath } from './reference.js';
import { hasTex } from './tex.js';
import {
  LIBRARY_REPO, entryPageUrl, libraryBase, libraryIsOverridden, libraryUrl, parseLibraryHash, parseLibraryProtocolUrl,
  parseLibrarySourceHash, repoUrl, setLibraryOverride, sourceUrl, webAppLink
} from './library/config.js';
import {
  BADGES, DIFFICULTIES, LIBRARY_FAMILIES, SORTS, dfaAccepts, entryById, libraryFacets, queryLibrary,
  pickFrontispiece, recentEntries, remixAncestry, resolveSort, sameLanguageAs, wasUpdated
} from './library/index-model.js';
import {
  cachedLibrary, fetchEntryText, listMyLibrary, loadLibrary, noteRecentlyOpened, recentLibraryIds, removeFromMyLibrary,
  saveToMyLibrary, sourceIsOutdated, stampSource, updatesFor
} from './library/client.js';
import {
  LIBRARY_LICENSES, decideRaw, languageFingerprint, liveDiagram, minimalDfaOf, namedDiagram, runFramesOf, targetFromDoc, traceWord
} from './library/analyze.js';
import { precheckSubmission, rememberLogin, submissionDefaults, submissionLink } from './library/submit.js';

// ── State ─────────────────────────────────────────────────────────

const L = {
  route: { page: 'discover', id: null },
  back: [],
  lib: null,          // loadLibrary()'s answer: { index, fetchedAt, stale, error }
  loading: null,
  query: '',
  sort: 'relevance',
  dir: null,          // 'asc' | 'desc'; null is the sort's own (index-model resolveSort)
  filters: {},
  canvasMatch: null,  // { machineId, fingerprint, dfa } of the machine on the canvas, while matching
  saved: [],
  savedIds: new Set(),
  submit: null,       // the submit form's fields while it is open
  submitFor: null,    // which machine those fields were read from
  submitCheck: null,
  docs: new Map(),    // hash → { text, target, doc }
  runTimer: null,     // Try it's playback on the diagram
  shown: null         // Browse's { key, n }: how many plates are out, for the search they were shown for
};

/**
 * Browse draws this many plates, then this many more per "Show more". Every
 * plate is an SVG, and a search redraws on each keystroke, so drawing every
 * match stops being affordable long before the library stops growing.
 */
export const BROWSE_BATCH = 48;

const NAV = [
  { page: 'discover', label: 'Discover' },
  { page: 'browse', label: 'Browse & search' },
  { page: 'collections', label: 'Collections' },
  { group: 'Yours' },
  { page: 'mine', label: 'My Library' },
  { page: 'submit', label: 'Submit a machine' },
  { page: 'about', label: 'How it works' }
];

// Which rail item a page lights up.
const NAV_OF = { entry: 'browse', collection: 'collections' };

/** Test seam. */
export function _resetLibraryUiForTests() {
  L.route = { page: 'discover', id: null };
  L.back = [];
  L.lib = null;
  L.loading = null;
  L.query = '';
  L.sort = 'relevance';
  L.dir = null;
  L.filters = {};
  L.canvasMatch = null;
  L.shown = null;
  L.saved = [];
  L.savedIds = new Set();
  L.submit = null;
  L.submitFor = null;
  L.submitCheck = null;
  L.docs.clear();
  clearInterval(L.runTimer);
  L.runTimer = null;
}

export function libraryRoute() {
  return { ...L.route };
}

// ── Nodes ─────────────────────────────────────────────────────────

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else if (k === 'data') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      else if (k === 'style') node.setAttribute('style', v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, kids);
  return node;
}

function append(node, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) append(node, kid);
    else if (typeof kid === 'string' || typeof kid === 'number') node.append(document.createTextNode(String(kid)));
    else node.append(kid);
  }
}

function button(label, onClick, cls = 'btn-g', extra = {}) {
  return h('button', { type: 'button', class: cls, on: { click: onClick }, ...extra }, label);
}

function link(label, href, cls = 'lib-link') {
  return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, label);
}

function img(src, cls, alt = '') {
  const node = h('img', { class: cls, src, alt, loading: 'lazy', decoding: 'async' });
  // A picture that failed to load leaves a broken-image glyph on every card;
  // an empty frame reads as "no picture", which is the truth.
  node.addEventListener('error', () => { node.style.visibility = 'hidden'; });
  return node;
}

function section(title, ...kids) {
  return h('section', { class: 'lib-sec' }, h('h3', { class: 'lib-sec-title', text: title }), ...kids);
}

function paragraphs(text, cls = 'lib-prose') {
  const parts = String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return parts.length ? typeset(h('div', { class: cls }, parts.map(p => h('p', { text: p })))) : null;
}

/**
 * An author's words may carry LaTeX — `$a^n b^n$`, `$$…$$`, `\(…\)`, `\[…\]` —
 * typeset in place by KaTeX. The text goes in as a text node first, so nothing
 * an author writes is ever parsed as markup; KaTeX's own `trust: false` default
 * refuses \href and friends.
 */
function typeset(node) {
  if (node && hasTex(node.textContent || Array.from(node.children || [], c => c.textContent).join(' '))) triggerMath(node);
  return node;
}

/** A line of an author's text, typeset. */
function texLine(tag, cls, text) {
  return typeset(h(tag, { class: cls, text }));
}

function relTime(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = Math.round((Date.now() - t) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.round(d / 30)} month${Math.round(d / 30) === 1 ? '' : 's'} ago`;
  return `${Math.round(d / 365)} year${Math.round(d / 365) === 1 ? '' : 's'} ago`;
}

function machineLabel(m) {
  return getMachineConfig(m)?.label || m;
}

function familyLabel(id) {
  return LIBRARY_FAMILIES.find(f => f.id === id)?.label || id;
}

function reducedMotion() {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
}

// ── The view ──────────────────────────────────────────────────────

/** setView('library') calls this. */
export function renderLibraryView() {
  buildNav();
  renderPage();
  ensureLoaded();
}

function buildNav() {
  const nav = $('lib-nav-list');
  if (!nav || nav.dataset.libBuilt === '1') return syncNav();
  nav.innerHTML = '';
  for (const item of NAV) {
    if (item.group) { nav.append(h('div', { class: 'ref-nav-group', text: item.group })); continue; }
    nav.append(h('a', {
      class: 'ref-nav-link lib-nav-link', href: '#library', data: { libPage: item.page },
      on: { click: e => { e.preventDefault(); go(item.page, null, { reset: true }); } }
    }, item.label));
  }
  nav.dataset.libBuilt = '1';
  syncNav();
}

function syncNav() {
  const active = NAV_OF[L.route.page] || L.route.page;
  document.querySelectorAll('#lib-nav-list .lib-nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.libPage === active);
  });
}

/** Move to a page. `reset` empties the back stack — a rail click is a new trail. */
export function go(page, id = null, { reset = false, push = true } = {}) {
  if (reset) L.back = [];
  else if (push && (L.route.page !== page || L.route.id !== id)) L.back.push({ ...L.route });
  L.route = { page, id };
  if (App.view !== 'library') setView('library');
  else { syncNav(); renderPage(); }
  const content = $('lib-content');
  if (content?.scrollTo) content.scrollTo({ top: 0 });
}

function goBack() {
  const prev = L.back.pop();
  if (prev) { L.route = prev; syncNav(); renderPage(); }
  else go('discover', null, { reset: true });
}

function ensureLoaded(force = false) {
  if (L.loading) return L.loading;
  if (L.lib && !force) return Promise.resolve(L.lib);
  L.loading = Promise.all([loadLibrary({ force }), refreshSaved()]).then(([res]) => {
    L.lib = res;
    L.loading = null;
    if (App.view === 'library') renderPage();
    renderExampleCardIfLibrary();
    return res;
  }, () => { L.loading = null; });
  return L.loading;
}

/** Point the view at another source: forget what it showed, fetch afresh. */
function switchSource(url) {
  setLibraryOverride(url || null);
  L.lib = null;
  L.docs.clear();
  L.canvasMatch = null;
  ensureLoaded(true);
  renderPage();
}

async function refreshSaved() {
  try {
    L.saved = await listMyLibrary();
    L.savedIds = new Set(L.saved.map(r => r.id));
  } catch { /* the shelf is optional */ }
}

// The index this view shows: its own load, or one something else already
// fetched — StateMate's /library, the update check — so opening the view after
// either never shows a spinner for a copy already in memory.
function index() {
  if (!L.lib?.index && cachedLibrary()?.index) L.lib = cachedLibrary();
  return L.lib?.index || null;
}

function renderPage() {
  const host = $('lib-content');
  if (!host) return;
  host.innerHTML = '';
  const idx = index();
  host.append(statusBar());
  if (!idx && L.route.page !== 'about' && L.route.page !== 'submit' && L.route.page !== 'mine') {
    host.append(L.lib?.error ? offlineNotice() : skeleton());
    return;
  }
  const page = PAGES[L.route.page] || PAGES.discover;
  try {
    host.append(page(L.route.id));
  } catch (e) {
    console.error(e);
    host.append(h('div', { class: 'lib-empty', text: `This page could not be drawn: ${e.message}` }));
  }
}

function statusBar() {
  const bar = h('div', { class: 'lib-status' });
  if (L.back.length) bar.append(button('← Back', goBack, 'lib-textbtn lib-back'));
  const say = [];
  if (L.lib?.index) {
    say.push(`${L.lib.index.entries.length} machines`);
    if (L.lib.fetchedAt) say.push(`checked ${relTime(new Date(L.lib.fetchedAt).toISOString())}`);
  }
  if (L.lib?.stale) say.push('offline — showing the last copy');
  if (L.lib?.index?.emulator) say.push(`local emulator · ${libraryBase()}`);
  else if (libraryIsOverridden()) say.push(`source: ${libraryBase()}`);
  bar.append(h('span', { class: 'lib-status-text', text: say.join(' · ') }));
  bar.append(button('Refresh', () => { L.lib = null; ensureLoaded(true); renderPage(); }, 'lib-textbtn lib-refresh', { 'aria-label': 'Fetch the library index again' }));
  return bar;
}

function offlineNotice() {
  return emptyState('The library could not be reached', `${L.lib.error} Machines you saved to My Library still open without the network.`,
    button('Open My Library', () => go('mine', null, { reset: true }), 'btn-p'),
    button('Try again', () => { L.lib = null; ensureLoaded(true); renderPage(); }, 'btn-g'));
}

// ── Figures ───────────────────────────────────────────────────────
//  Every picture of a machine is drawn here from what the index carries
//  (js/library/sketch.js): its shape, its minimal DFA, its standard code. They
//  are inked by the stylesheet from the theme, so a figure sits on the page
//  the way a figure sits in a book. The build's SVG files are only the fallback
//  for a machine too large to carry a sketch.

/** An SVG string drawn by sketch.js → a node. Every string it makes escapes its text. */
function svgFigure(svg, cls = '') {
  const box = h('div', { class: `lib-fig${cls ? ` ${cls}` : ''}` });
  box.innerHTML = svg;
  return box;
}

/** The one picture a machine is known by: a Turing machine's run, else its diagram. */
function figureOf(e, { w = 320, h = 200 } = {}) {
  const f = figureSvg(e, { w, h });
  if (f) return svgFigure(f.svg, f.run ? 'is-run' : '');
  const box = h('div', { class: 'lib-fig is-img' });
  const pic = cardPicture(e);
  if (pic) box.append(img(libraryUrl(pic.path), 'lib-fig-img', `Diagram of ${e.title}`));
  return box;
}

// The plate's caption and marks are card-html.js's (plateCaption, plateMarks),
// so a machine reads the same here and on the library's website.

/** One machine in a catalogue: its figure, its name, one line of facts, what was checked. */
/** `when`: 'added' or 'updated', on a list ordered by that date — the plate says it. */
function plate(e, { when = null } = {}) {
  const node = h('article', {
    class: 'lib-plate', data: { family: e.category || 'special' },
    on: { click: () => go('entry', e.id) }
  });
  const fig = figureOf(e);
  if (L.savedIds.has(e.id)) fig.append(h('span', { class: 'lib-plate-saved', title: 'In My Library', 'aria-label': 'In My Library' }));
  const marks = plateMarks(e);
  node.append(fig, h('div', { class: 'lib-plate-body' },
    // The title is the plate's keyboard stop: the rest of it is a larger
    // target for the same click, not a second control.
    h('button', { type: 'button', class: 'lib-plate-title', on: { click: ev => { ev.stopPropagation(); go('entry', e.id); } } }, e.title),
    h('div', { class: 'lib-plate-cap' }, h('i', { class: 'lib-dot', 'aria-hidden': 'true' }), plateCaption(e)),
    marks.length ? h('div', { class: 'lib-plate-marks', title: marks.map(m => m.say).join('\n') }, marks.map(m => m.label).join(' · ')) : null,
    when && plateDate(e, when) ? h('div', { class: 'lib-plate-when', text: plateDate(e, when) }) : null));
  return node;
}

function grid(entries, empty = null) {
  if (!entries.length) return empty || emptyState('Nothing here yet', 'When machines are added, they appear here.');
  return h('div', { class: 'lib-plates' }, entries.map(plate));
}

/** A section's heading: a title on a hairline, and what else there is to say or do. */
function sectionHead(title, aside = null) {
  return h('div', { class: 'lib-sechead' }, h('h3', { class: 'lib-sechead-title', text: title }), aside);
}

/** A titled handful of plates, with the way to the rest. */
function shelf(title, entries, more = null, total = null, { when = null } = {}) {
  if (!entries.length) return null;
  return h('section', { class: 'lib-shelf' },
    sectionHead(title, more ? button(total ? `All ${total} →` : 'All →', more, 'lib-textbtn') : null),
    h('div', { class: 'lib-plates' }, entries.map(e => plate(e, { when }))));
}

// ── Loading and empty ─────────────────────────────────────────────

/** The page's shape while the index loads, so nothing jumps when it arrives. */
function skeleton() {
  const card = () => h('div', { class: 'lib-skel-card' },
    h('div', { class: 'lib-skel-art lib-shimmer' }), h('div', { class: 'lib-skel-line lib-shimmer' }), h('div', { class: 'lib-skel-line is-short lib-shimmer' }));
  return h('div', { class: 'lib-page', 'aria-busy': 'true' },
    h('span', { class: 'lib-sr', text: 'Loading the library…' }),
    h('div', { class: 'lib-skel-hero lib-shimmer' }),
    h('div', { class: 'lib-grid' }, Array.from({ length: 8 }, card)));
}

/** Two states and an edge nobody has drawn yet — the empty state's picture. */
function emptyArt() {
  const svg = document.createElementNS?.('http://www.w3.org/2000/svg', 'svg') || h('span');
  svg.setAttribute('viewBox', '0 0 120 64');
  svg.setAttribute('class', 'lib-empty-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="24" cy="32" r="14"/><circle cx="24" cy="32" r="9.5"/><circle cx="96" cy="32" r="14" class="d"/><path d="M40 32 H74" class="d"/><path d="M69 26 l7 6 -7 6" class="d"/>';
  return svg;
}

function emptyState(title, body, ...actions) {
  return h('div', { class: 'lib-empty lib-empty-state' }, emptyArt(), h('strong', { text: title }), body ? h('span', { class: 'lib-muted', text: body }) : null,
    actions.length ? h('div', { class: 'lib-actions' }, actions) : null);
}

// ── Pages ─────────────────────────────────────────────────────────

const PAGES = {
  discover: pageDiscover,
  browse: pageBrowse,
  entry: pageEntry,
  collections: pageCollections,
  collection: pageCollection,
  mine: pageMine,
  submit: pageSubmit,
  about: pageAbout
};

function pageDiscover() {
  const idx = index();
  const page = h('div', { class: 'lib-page lib-discover' });
  const verified = idx.entries.filter(x => x.badges.some(b => b.id === 'tested' || b.id === 'halts' || b.id === 'never-halts')).length;
  // The website's masthead: the statement beside one machine drawn large.
  const front = pickFrontispiece(idx, { drawable: e => !!e.sketch });
  page.append(h('div', { class: `lib-mast${front ? ' has-frontis' : ''}` },
    h('div', { class: 'lib-mast-text' },
      h('p', { class: 'lib-kicker', text: 'The Library' }),
      h('h2', { class: 'lib-display' }, 'A catalogue of automata,', h('br'), h('em', { text: 'tested before they’re listed.' })),
      h('p', { class: 'lib-lede lib-mast-lede', text: MAST_LEDE }),
      searchBox({ autofocus: false, onSubmit: q => { L.query = q; go('browse'); } }),
      h('p', { class: 'lib-mast-meta' },
        `${idx.entries.length} machines · ${idx.collections.length} collections · ${verified} verified by running · `,
        button('How it works', () => go('about'), 'lib-textbtn'))),
    front ? frontispiece(front) : null));

  // The families as a catalogue's index: a name, a count, and the types in it.
  const families = h('nav', { class: 'lib-families', 'aria-label': 'Families' });
  for (const f of LIBRARY_FAMILIES) {
    const members = idx.entries.filter(e => e.category === f.id);
    const types = [...new Set(members.map(e => e.machine))].sort((a, b) => a.localeCompare(b));
    families.append(h('button', {
      type: 'button', class: 'lib-family', data: { family: f.id },
      on: { click: () => { L.filters = { family: f.id }; L.query = ''; go('browse'); } }
    },
      h('span', { class: 'lib-family-head' }, h('i', { class: 'lib-dot', 'aria-hidden': 'true' }), h('span', { class: 'lib-family-name', text: f.label }), h('span', { class: 'lib-family-count', text: String(members.length) })),
      h('span', { class: 'lib-family-types', text: types.join(' · ') || '—' })));
  }
  page.append(families);

  // What is new comes before what is chosen: a returning reader looks here first.
  const byDate = which => () => { L.sort = which; L.dir = 'desc'; L.query = ''; L.filters = {}; go('browse'); };
  // append(), not page.append(): an empty shelf is null, which the DOM would print.
  append(page, [
    shelf('Recently added', recentEntries(idx, 'added', 4), byDate('added'), idx.entries.length, { when: 'added' }),
    shelf('Recently updated', recentEntries(idx, 'updated', 4), byDate('updated'), null, { when: 'updated' })
  ]);
  // The collections the library chose to feature (library.config.json).
  for (const cid of idx.featured || []) {
    const c = idx.collections.find(x => x.id === cid);
    if (!c) continue;
    const list = c.entries.map(x => entryById(idx, x)).filter(Boolean);
    append(page, [shelf(c.title, list.slice(0, 4), () => go('collection', c.id), list.length)]);
  }
  if (idx.collections.length) {
    page.append(h('section', { class: 'lib-shelf' },
      sectionHead('Collections', button(`All ${idx.collections.length} →`, () => go('collections'), 'lib-textbtn')),
      h('div', { class: 'lib-colls' }, idx.collections.slice(0, 6).map(collectionRow))));
  }
  const recent = recentLibraryIds().map(id => entryById(idx, id)).filter(Boolean);
  append(page, [shelf('Opened recently', recent.slice(0, 4))]);
  return page;
}

/**
 * The machine Discover opens on, drawn large, as the website's home page draws
 * it: the index's sketch at once, then — once the file arrives — the drawing
 * with its names and labels (analyze.js namedDiagram), in the same proportions.
 * The index names it (`frontispiece`, chosen by the build), so both faces open
 * on the same machine.
 */
function frontispiece(e) {
  const sk = unpackSketch(e.sketch);
  const H = sk ? Math.round(640 / sketchAspect(sk)) : 400;
  const well = svg => {
    const f = svgFigure(svg, 'is-frontis');
    f.style.setProperty('--fig-aspect', `640 / ${H}`);
    return f;
  };
  const open = () => go('entry', e.id);
  let fig = sk ? well(drawSketch(sk, { w: 640, h: H })) : figureOf(e, { w: 640, h: H });
  const link = h('button', { type: 'button', class: 'lib-frontis-link', 'aria-label': e.title, on: { click: open } }, fig);
  entryDoc(e).then(d => {
    let named;
    try { named = namedDiagram(d.target, { w: 640, h: H }); } catch { return; }
    const next = well(named.svg);
    if (fig.parentNode === link) { link.replaceChild(next, fig); fig = next; }
  }, () => { /* the index's sketch stands */ });
  return h('figure', { class: 'lib-frontis', data: { family: e.category || 'special' } }, link,
    h('figcaption', { class: 'lib-figcaption-text' },
      button(e.title, open, 'lib-textbtn lib-frontis-title'), `, ${frontispieceWhat(e)}. ${FRONTIS_NOTE}`));
}

function searchBox({ onSubmit, onInput, autofocus = true } = {}) {
  const input = h('input', {
    class: 'lib-search', type: 'search', value: L.query,
    placeholder: 'Search by name, or type:DFA · accepts:0110 · by:login · a TM code',
    'aria-label': 'Search the library', autocomplete: 'off', spellcheck: 'false'
  });
  input.value = L.query;
  let timer = null;
  input.addEventListener('input', () => {
    if (!onInput) return;
    clearTimeout(timer);
    timer = setTimeout(() => onInput(input.value), 140);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); (onSubmit || onInput || (() => {}))(input.value); }
  });
  if (autofocus) setTimeout(() => input.focus?.(), 0);
  const glass = document.createElementNS?.('http://www.w3.org/2000/svg', 'svg') || h('span');
  glass.setAttribute('viewBox', '0 0 24 24');
  glass.setAttribute('class', 'lib-searchbar-icon');
  glass.setAttribute('aria-hidden', 'true');
  glass.innerHTML = '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 L21 21"/>';
  return h('label', { class: 'lib-searchbar' }, glass, input);
}

/** Whether an entry is the canvas's machine, or recognises its language. */
function matchesCanvas(e, m) {
  if (m.machineId && e.machineId === m.machineId) return true;
  return !!m.dfa && sameLanguage(e, m);
}

/** Whether an entry recognises the language `m` names: by the table itself where the index has it. */
function sameLanguage(e, m) {
  if (!e.fingerprint || e.fingerprint !== m.fingerprint) return false;
  return !e.dfa || JSON.stringify([e.dfa.sigma, e.dfa.acc, e.dfa.delta]) === JSON.stringify([m.dfa.sigma, m.dfa.acc, m.dfa.delta]);
}

function pageBrowse() {
  const idx = index();
  const page = h('div', { class: 'lib-page lib-browse' });
  const results = h('div', { class: 'lib-results' });

  const draw = () => {
    results.innerHTML = '';
    const s = resolveSort(L.sort, L.dir);
    let list = queryLibrary(idx, codeSearchText(L.query, App.config.sym), { sort: s.key, dir: s.dir, filters: L.filters });
    if (L.canvasMatch) list = list.filter(e => matchesCanvas(e, L.canvasMatch));
    const sort = h('select', { class: 'lib-sort', 'aria-label': 'Sort by' });
    for (const [k, def] of Object.entries(SORTS)) sort.append(h('option', { value: k }, def.label));
    sort.value = s.key;
    // A new field starts in its own direction: "Date added" means newest first.
    sort.addEventListener('change', () => { L.sort = sort.value; L.dir = null; draw(); });
    let dir = null;
    if (s.dir) {
      dir = h('select', { class: 'lib-sort', 'aria-label': 'Order' });
      for (const [d, label] of Object.entries(SORTS[s.key].say)) dir.append(h('option', { value: d }, label));
      dir.value = s.dir;
      dir.addEventListener('change', () => { L.dir = dir.value; draw(); });
    }
    const note = /\b(accepts|rejects):/.test(L.query) ? ' — word search covers the finite automata, whose minimal DFA the library publishes' : '';
    results.append(h('div', { class: 'lib-resulthead' },
      h('span', { class: 'lib-count', text: `${list.length} of ${idx.entries.length} machines${note}` }),
      h('label', { class: 'lib-sortlabel' }, 'Sort ', sort, dir)));
    if (L.canvasMatch) {
      const m = L.canvasMatch;
      const exact = list.filter(e => m.machineId && e.machineId === m.machineId);
      // Two claims of different strength, said separately: "is" this entry,
      // and "recognises the same language as" — which only finite automata
      // can be asked, since only they have a canonical minimal form.
      const say = [];
      if (exact.length) say.push(`The machine on your canvas is ${exact.length === 1 ? `“${exact[0].title}”` : `in ${exact.length} entries`}.`);
      const lang = list.length - exact.length;
      if (lang) say.push(exact.length
        ? `It recognises the same language as ${lang === 1 ? 'one more' : `${lang} more`}.`
        : `The machine on your canvas recognises the same language as ${lang === 1 ? 'this entry' : `these ${lang} entries`}.`);
      results.append(h('div', { class: 'lib-callout' },
        say.length
          ? say.join(' ')
          : m.dfa
            ? 'No entry is this machine or recognises its language — it may be a new one.'
            : 'No entry is this machine — it may be a new one. (Matching by language works for finite automata.)',
        ' ', button('Clear', () => { L.canvasMatch = null; renderPage(); }, 'lib-textbtn'),
        list.length ? null : button('Submit it', () => go('submit'), 'lib-textbtn')));
    }
    if (!list.length) {
      results.append(emptyState(
        L.query ? `No machine matches “${L.query}”` : 'No machine matches these filters',
        'Try fewer words or clear a filter — or build it and submit it, and it will be the first.',
        Object.keys(L.filters).length ? button('Clear filters', () => { L.filters = {}; renderPage(); }, 'btn-g') : null,
        button('Submit a machine', () => go('submit'), 'btn-g')));
      return;
    }
    // A batch at a time. A new search starts again at one batch; the same
    // search — back from a listing, say — picks up where it was.
    const key = JSON.stringify([L.query, s.key, s.dir, L.filters, L.canvasMatch?.machineId || null, L.canvasMatch?.fingerprint || null]);
    const when = s.key === 'added' || s.key === 'updated' ? s.key : null;
    const want = L.shown?.key === key ? L.shown.n : BROWSE_BATCH;
    const plates = h('div', { class: 'lib-plates' });
    const shownNote = h('span', { class: 'lib-showmore-note' });
    const more = h('button', {
      type: 'button', class: 'btn-g lib-showmore-btn',
      on: { click: () => { fill(BROWSE_BATCH)?.querySelector?.('.lib-plate-title')?.focus?.(); } }
    });
    const row = h('div', { class: 'lib-showmore' }, more, shownNote);
    let shown = 0;
    function fill(n) {
      const next = list.slice(shown, shown + n).map(e => plate(e, { when }));
      plates.append(...next);
      shown += next.length;
      L.shown = { key, n: shown };
      const left = list.length - shown;
      row.hidden = left <= 0;
      more.textContent = `Show ${Math.min(BROWSE_BATCH, left)} more`;
      shownNote.textContent = `${shown} of ${list.length} shown`;
      return next[0] || null;
    }
    fill(want);
    results.append(plates, row);
  };

  page.append(h('div', { class: 'lib-pagehead' },
    h('p', { class: 'lib-kicker', text: 'Browse' }),
    h('div', { class: 'lib-searchrow' },
      searchBox({ onInput: q => { L.query = q; draw(); } }),
      button('Match my canvas', matchCanvas, 'btn-g lib-match', { 'data-tip': 'Find the machine on your canvas in the library — the same machine, or for a finite automaton the same language' }))));
  page.append(h('div', { class: 'lib-browse-body' }, refinePanel(idx, () => { renderPage(); }), results));
  draw();
  return page;
}

/**
 * The catalogue's "refine by": each facet a short list with its counts, the
 * chosen value marked. Composes with the typed query rather than replacing it.
 */
function refinePanel(idx, redraw) {
  const facets = libraryFacets(idx.entries);
  const panel = h('aside', { class: 'lib-refine', 'aria-label': 'Refine' });
  const item = (key, value, label, count) => {
    const on = L.filters[key] === value;
    return h('button', {
      type: 'button', class: `lib-refine-item${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
      data: key === 'family' ? { family: value } : {},
      on: { click: () => { if (on) delete L.filters[key]; else L.filters[key] = value; redraw(); } }
    }, key === 'family' ? h('i', { class: 'lib-dot', 'aria-hidden': 'true' }) : null, h('span', { class: 'lib-refine-name', text: label }), h('span', { class: 'lib-refine-n', text: String(count) }));
  };
  const group = (title, items) => items.length ? h('section', { class: 'lib-refine-group' }, h('h4', { class: 'lib-refine-title', text: title }), items) : null;
  panel.append(group('Family', facets.family.map(([id, n]) => item('family', id, familyLabel(id), n))));
  panel.append(group('Verified', facets.badge.map(([b, n]) => item('badge', b, BADGES[b]?.label || b, n))));
  panel.append(group('Type', facets.machine.map(([m, n]) => item('machine', m, m, n))));
  panel.append(group('Level', DIFFICULTIES.filter(d => facets.level.some(([x]) => x === d)).map(d => item('level', d, d[0].toUpperCase() + d.slice(1), facets.level.find(([x]) => x === d)[1]))));
  panel.append(group('Tags', facets.tag.slice(0, 14).map(([t, n]) => item('tag', t, t, n))));
  if (Object.keys(L.filters).length) panel.append(button('Clear all', () => { L.filters = {}; redraw(); }, 'lib-textbtn lib-clear'));
  return panel;
}

/**
 * Look for the canvas machine in the index: the same machine, by its machine
 * id, for any kind of machine — and for a finite automaton the same language
 * too, by its minimal DFA.
 */
export function matchCanvas() {
  const target = machineTargetFromApp();
  target.config = { ...(target.config || {}), sym: App.config.sym };
  let dfa = null;
  try { dfa = minimalDfaOf(target); } catch { dfa = null; }
  const machineId = (App.states || []).length ? machineIdOf(getWorkspaceData()) : null;
  if (!dfa && !machineId) {
    showStatus('Draw a machine, with a start state, to look for it in the library.');
    return;
  }
  L.canvasMatch = { machineId, fingerprint: dfa ? languageFingerprint(dfa) : null, dfa };
  L.query = '';
  L.filters = {};
  if (L.route.page !== 'browse') go('browse');
  else renderPage();
}

// ── An entry ──────────────────────────────────────────────────────

async function entryDoc(e) {
  const key = e.hash || e.id;
  const kept = L.docs.get(key);
  if (kept) return kept;
  let text, offline = false;
  try {
    text = await fetchEntryText(e, index());
  } catch (err) {
    if (err?.message === 'offline-copy' && err.text) { text = err.text; offline = true; }
    else throw err;
  }
  const doc = JSON.parse(text);
  const target = targetFromDoc(JSON.parse(text));
  const out = { text, doc, target, offline };
  // An offline copy is an older version than the one the listing describes,
  // so it is not kept under that version's hash: the next look, online, gets
  // the real file.
  if (!offline) L.docs.set(key, out);
  return out;
}

// A listing reads like a page of a catalogue raisonné: the machine's name set
// large, its figure, its formal definition typeset from the machine itself,
// and what the library checked, in words. Try it sits under the figure and
// paints the run on it, from the machine's own trace (analyze.js traceWord), so
// the path shown is the path the canvas would show.

function pageEntry(id) {
  const idx = index();
  const e = entryById(idx, id);
  if (!e) return h('div', { class: 'lib-empty', text: `There is no machine “${id}” in the library.` });
  const page = h('article', { class: 'lib-page lib-entry', data: { family: e.category || 'special' } });

  page.append(h('nav', { class: 'lib-crumbs', 'aria-label': 'Where this is' },
    button('Library', () => go('discover', null, { reset: true }), 'lib-textbtn'), h('span', { text: '/' }),
    button(familyLabel(e.category), () => { L.filters = { family: e.category }; L.query = ''; go('browse'); }, 'lib-textbtn'), h('span', { text: '/' }),
    h('span', { text: e.machine })));

  const byline = [];
  if (e.author.login) {
    byline.push(button(e.author.name ? `${e.author.name} (@${e.author.login})` : `@${e.author.login}`,
      () => { L.query = `by:${e.author.login}`; L.filters = {}; go('browse'); }, 'lib-textbtn lib-author', { title: `Everything by @${e.author.login}` }));
  }
  byline.push(`version ${e.version}`);
  if (LIBRARY_LICENSES[e.license]) byline.push(e.license.replace(/-/g, ' ').replace(' 4.0', ' 4.0').replace('CC BY', 'CC BY'));
  if (e.added) byline.push(`added ${relTime(e.added)}`);
  if (wasUpdated(e)) byline.push(`updated ${relTime(e.updated)}`);

  page.append(h('div', { class: 'lib-entry-head' },
    h('p', { class: 'lib-kicker' }, h('i', { class: 'lib-dot', 'aria-hidden': 'true' }), [machineLabel(e.machine), e.languageClass].filter(Boolean).join(' · ')),
    h('h2', { class: 'lib-display lib-entry-title', text: e.title }),
    h('p', { class: 'lib-byline' }, byline.map((b, i) => [i ? h('span', { class: 'lib-sep', text: '·' }) : null, b])),
    e.blurb ? texLine('p', 'lib-lede', e.blurb) : null,
    entryActions(e)));

  if (e.duplicateOf) {
    const orig = entryById(idx, e.duplicateOf);
    page.append(h('p', { class: 'lib-callout' }, 'Recognises the same language as ',
      orig ? button(orig.title, () => go('entry', orig.id), 'lib-textbtn') : e.duplicateOf, ', which was listed first.'));
  }

  const stage = entryStage(e);
  const aside = h('aside', { class: 'lib-entry-aside' });
  const math = h('div', { class: 'lib-math', 'aria-label': 'Formal definition' });
  aside.append(h('section', { class: 'lib-aside-sec' }, h('h4', { class: 'lib-aside-title', text: 'Definition' }), math));
  const verified = verifiedList(e);
  if (verified) aside.append(h('section', { class: 'lib-aside-sec' }, h('h4', { class: 'lib-aside-title', text: 'Verified by the library' }), verified));
  aside.append(factsTable(e));
  // The machine's canonical code, filled in when the file arrives: the text
  // that names this machine anywhere — pasted on a canvas it opens it, pasted
  // into the search box it finds it again.
  const codeText = h('code', { class: 'lib-code-text' });
  const codeSec = h('section', { class: 'lib-aside-sec lib-machine-code', hidden: true },
    h('h4', { class: 'lib-aside-title', text: 'Machine code' }), codeText,
    h('div', { class: 'lib-standard-actions' },
      button('Copy', () => exportCopyText(codeText.textContent, 'Machine code copied — paste it on any canvas to open it'), 'lib-textbtn')));
  aside.append(codeSec);
  page.append(h('div', { class: 'lib-entry-body' }, h('div', { class: 'lib-entry-main' }, stage.node, tryIt(e, stage)), aside));

  // A Turing machine is known by what it does from a blank tape.
  if (e.behaviour || e.standard) page.append(behaviourSection(e));
  const notes = h('div', { class: 'lib-prose' });
  page.append(h('section', { class: 'lib-shelf lib-notes', hidden: true }, sectionHead('Notes'), notes));
  const related = relatedSection(e, idx);
  if (related) page.append(related);

  // What needs the file: the definition, the author's notes, a run for a TM
  // the standard notation cannot write.
  entryDoc(e).then(d => {
    const code = d.doc?.exercise ? null : canonicalCodeOf(d.doc);
    if (code) { codeText.textContent = code; codeSec.removeAttribute('hidden'); }
    try {
      const latex = withMachine(d.target, () => buildFormalDefLatex());
      math.textContent = latex;
      triggerMath(math);
    } catch { math.textContent = ''; }
    const text = paragraphs(d.doc?.meta?.library?.readme);
    // Typeset where the paragraphs end up: KaTeX may still be loading, and a
    // retry aimed at the emptied wrapper would typeset nothing.
    if (text) { notes.append(...Array.from(text.children)); typeset(notes); notes.closest('section')?.removeAttribute('hidden'); }
  }, () => {
    math.append(h('span', { class: 'lib-muted', text: 'The definition is drawn from the machine’s file, which could not be fetched.' }));
  });
  return page;
}

/** What the library checked, in sentences, each with its detail. */
function verifiedList(e) {
  if (!e.badges.length) return null;
  return h('ul', { class: 'lib-verified' }, rankBadges(e.badges).map(b => h('li', { class: `is-${b.id}`, title: BADGES[b.id].say },
    h('span', { class: 'lib-verified-mark', 'aria-hidden': 'true', text: b.id === 'never-halts' ? '∞' : '✓' }),
    h('span', {}, h('strong', { text: BADGES[b.id].label }), b.detail ? h('span', { class: 'lib-verified-detail', text: ` — ${b.detail}` }) : null))));
}

// ── The figure: the pictures, and the run painted on the diagram ──

function entryStage(e) {
  const frame = h('div', { class: 'lib-stage-frame' });
  const runbar = h('div', { class: 'lib-runbar', 'aria-live': 'polite' });
  runbar.setAttribute('hidden', '');
  const switcher = h('div', { class: 'lib-figswitch', role: 'tablist', 'aria-label': 'Pictures of this machine' });
  const caption = h('span', { class: 'lib-figcaption-text' });
  const node = h('figure', { class: 'lib-stage' }, frame, runbar, h('figcaption', { class: 'lib-figcaption' }, caption, switcher));
  const stage = { node, frame, runbar, switcher, caption, live: null, pending: null, pictures: new Map() };

  // The diagram from the index at once; the addressable one, with names and
  // labels, once the file arrives.
  // The figure takes the machine's own proportions, from the index's sketch —
  // the same ones the file's drawing will have when it replaces it.
  const sk = unpackSketch(e.sketch);
  const H = sk ? Math.round(640 / sketchAspect(sk)) : 400;
  frame.style.setProperty('--fig-aspect', `640 / ${H}`);
  stage.pictures.set('diagram', { label: 'Diagram', say: `The machine as drawn — ${e.stats.states} state${e.stats.states === 1 ? '' : 's'}, ${e.stats.transitions} transition${e.stats.transitions === 1 ? '' : 's'}.`, node: sk ? svgFigure(drawSketch(sk, { w: 640, h: H }), 'is-stage') : figureOf(e, { w: 640, h: H }) });
  const rows = languageRows(e.dfa);
  if (rows) stage.pictures.set('language', { label: 'Language', say: `Every word up to length ${rows.length - 1}, one row per length in shortlex order, inked where it is accepted.`, node: svgFigure(drawLanguage(rows, { w: 640, h: H }), 'is-stage is-lang') });
  for (const [kind, p] of stage.pictures) {
    frame.append(p.node);
    p.node.dataset.kind = kind;
    if (stage.pictures.size > 1) {
      switcher.append(h('button', { type: 'button', class: 'lib-figswitch-btn', role: 'tab', data: { kind }, on: { click: () => showPicture(stage, kind) } }, p.label));
    }
  }
  showPicture(stage, 'diagram');

  entryDoc(e).then(d => {
    let live;
    try { live = liveDiagram(d.target, { w: 640, h: H }); } catch { return; }
    const holder = svgFigure(live.svg, 'is-stage lib-live');
    holder.setAttribute('role', 'img');
    holder.setAttribute('aria-label', `Diagram of ${e.title}`);
    holder.dataset.kind = 'diagram';
    const old = stage.pictures.get('diagram').node;
    holder.hidden = old.hidden;
    frame.replaceChild(holder, old);
    stage.pictures.get('diagram').node = holder;
    stage.live = { ...live, el: holder, nodes: null, edges: null };
    if (stage.pending) { const p = stage.pending; stage.pending = null; playRun(stage, p.trace, p.verdict); }
  }, () => { /* the index's sketch stands */ });
  return stage;
}

/** Show one of the figure's pictures, by kind. */
export function showPicture(stage, kind) {
  if (!stage.pictures.has(kind)) return;
  for (const [k, p] of stage.pictures) p.node.hidden = k !== kind;
  stage.caption.textContent = stage.pictures.get(kind).say;
  Array.from(stage.switcher?.children || []).forEach(t => {
    const on = t.dataset?.kind === kind;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function liveParts(live) {
  if (!live.nodes) {
    live.nodes = new Map();
    live.edges = new Map();
    for (const n of live.el.querySelectorAll?.('[data-s]') || []) live.nodes.set(n.dataset.s, n);
    for (const n of live.el.querySelectorAll?.('[data-e]') || []) live.edges.set(n.dataset.e, n);
  }
  return live;
}

/** Light step `i` of a trace on the live diagram, and in the strip under it. */
export function paintRunStep(stage, trace, i) {
  const live = stage.live;
  if (live?.el) {
    const { nodes, edges } = liveParts(live);
    for (const n of nodes.values()) n.classList.remove('is-lit');
    for (const n of edges.values()) n.classList.remove('is-lit');
    const st = trace.steps[i];
    const rootsOf = step => new Set((step?.states || []).map(s => live.rootOf.get(s) || s));
    const here = rootsOf(st);
    for (const r of here) nodes.get(r)?.classList.add('is-lit');
    if (st?.tid != null) edges.get(live.edgeOf.get(st.tid))?.classList.add('is-lit');
    else if (i > 0) {
      // A set run (an NFA) names no single transition: light every drawn
      // edge from a state it was in to a state it is in now.
      for (const a of rootsOf(trace.steps[i - 1])) for (const b of here) edges.get(`${a}|${b}`)?.classList.add('is-lit');
    }
    const last = i === trace.steps.length - 1 && !trace.cut;
    live.el.classList.toggle('is-acc', last && trace.final === 'accept');
    live.el.classList.toggle('is-rej', last && trace.final === 'reject');
  }
  Array.from(stage.runbar.querySelectorAll?.('.lib-run-s') || []).forEach(c => c.classList.toggle('is-on', Number(c.dataset.i) === i));
}

const STRIP_MAX = 48;

function stepName(stage, step) {
  const names = stage.live?.names;
  const one = s => names?.get(s) ?? s;
  if (!step.states.length) return '∅';
  return step.states.length === 1 ? one(step.states[0]) : `{${step.states.map(one).join(',')}}`;
}

/** Draw a run's strip and play it on the diagram. */
function playRun(stage, trace, verdict) {
  clearInterval(L.runTimer);
  L.runTimer = null;
  if (!stage.live) { stage.pending = { trace, verdict }; }
  else showPicture(stage, 'diagram');
  const bar = stage.runbar;
  bar.innerHTML = '';
  bar.removeAttribute('hidden');
  const strip = h('div', { class: 'lib-run-strip' });
  const shown = trace.steps.slice(0, STRIP_MAX);
  let i0 = 0;
  const jump = i => { clearInterval(L.runTimer); L.runTimer = null; i0 = i; paintRunStep(stage, trace, i); };
  shown.forEach((st, i) => {
    if (i) strip.append(h('span', { class: 'lib-run-a', text: st.read != null ? `${st.read}→` : '→' }));
    strip.append(h('button', { type: 'button', class: 'lib-run-s', data: { i: String(i) }, on: { click: () => jump(i) } }, stepName(stage, st)));
  });
  if (trace.steps.length > STRIP_MAX || trace.cut) {
    strip.append(h('span', { class: 'lib-run-a', text: trace.cut ? ` … first ${trace.steps.length - 1} steps` : ` … ${trace.steps.length - 1} steps` }));
  }
  const v = verdict?.verdict;
  const say = v === 'acc' ? 'Accepted' : v === 'rej' ? 'Rejected' : v === 'err' ? verdict.error : trace.cut ? 'Still running' : 'No verdict';
  bar.append(strip, h('span', { class: `lib-run-v${v === 'acc' ? ' is-acc' : v === 'rej' ? ' is-rej' : ''}`, text: say }),
    button('Replay', () => start(), 'lib-textbtn lib-run-replay', { 'aria-label': 'Play the run again' }));
  const n = trace.steps.length;
  // One pass takes about six seconds whatever the length, and a step never
  // flashes by faster than a reader can follow or drags slower than a beat.
  const delay = Math.max(70, Math.min(420, Math.round(6000 / Math.max(n, 1))));
  function start() {
    clearInterval(L.runTimer);
    i0 = 0;
    paintRunStep(stage, trace, 0);
    if (reducedMotion() || typeof setInterval !== 'function' || n < 2) { paintRunStep(stage, trace, n - 1); return; }
    L.runTimer = setInterval(() => {
      if (!stage.node.isConnected && stage.node.isConnected !== undefined) { clearInterval(L.runTimer); L.runTimer = null; return; }
      i0++;
      paintRunStep(stage, trace, Math.min(i0, n - 1));
      if (i0 >= n - 1) { clearInterval(L.runTimer); L.runTimer = null; }
    }, delay);
    if (typeof L.runTimer?.unref === 'function') L.runTimer.unref();
  }
  start();
}

// ── Actions: one main button, the rest in a menu ──

let moreMenuListening = false;

function entryActions(e) {
  const bar = h('div', { class: 'lib-actions' });
  bar.append(button('Open in a new tab', () => openEntry(e), 'btn-p', { 'data-tip': 'Open it on a canvas of its own' }));
  const saved = L.savedIds.has(e.id);
  bar.append(button(saved ? 'Saved' : 'Save', () => toggleSaved(e), `btn-g${saved ? ' is-saved' : ''}`,
    { 'aria-pressed': saved ? 'true' : 'false', 'data-tip': saved ? 'In My Library — opens offline' : 'Keep a copy that opens offline' }));

  const menu = h('div', { class: 'lib-more-menu', role: 'menu' });
  const more = h('details', { class: 'lib-more' },
    h('summary', { class: 'btn-g lib-more-btn', 'aria-label': 'More actions', title: 'More actions' }, 'More'), menu);
  const item = (label, fn) => menu.append(h('button', {
    type: 'button', class: 'lib-more-item', role: 'menuitem',
    on: { click: () => { more.removeAttribute('open'); fn(); } }
  }, label));
  const hrefItem = (label, href) => menu.append(h('a', {
    class: 'lib-more-item', role: 'menuitem', href, target: '_blank', rel: 'noopener noreferrer',
    on: { click: () => more.removeAttribute('open') }
  }, label));
  if (getMachineConfig(e.machine) && machineSupportsBlocks(App.machine) && machineSupportsBlocks(e.machine)) {
    item(`Insert into my ${App.machine} as a block`, () => insertAsBlock(e));
  }
  item('Download the .automaton file', async () => {
    try {
      const d = await entryDoc(e);
      exportDownload(`${e.id.split('/').pop()}.automaton`, d.text, 'application/x-automatastudio+json');
    } catch (err) { showStatus(`Could not download: ${err.message}`); }
  });
  item('Copy link', () => exportCopyText(webAppLink({ action: 'show', id: e.id }), 'Link to this machine copied'));
  hrefItem('Its page on the web ↗', entryPageUrl(e.id, index()?.site || undefined));
  hrefItem('Source on GitHub ↗', sourceUrl(e.path, index()?.repo || LIBRARY_REPO));
  bar.append(more);

  if (!moreMenuListening && globalThis.document?.addEventListener) {
    moreMenuListening = true;
    document.addEventListener('pointerdown', ev => {
      for (const d of document.querySelectorAll?.('.lib-more[open]') || []) if (!d.contains(ev.target)) d.removeAttribute('open');
    });
  }
  return bar;
}

async function toggleSaved(e) {
  if (L.savedIds.has(e.id)) {
    await removeFromMyLibrary(e.id);
    showStatus(`Removed “${e.title}” from My Library`);
  } else {
    try {
      const d = await entryDoc(e);
      await saveToMyLibrary(e, d.text);
      showStatus(`Saved “${e.title}” to My Library — it opens without the network now`);
    } catch (err) { showStatus(`Could not save: ${err.message}`); return; }
  }
  await refreshSaved();
  renderPage();
}

// ── Try it ──

function tryIt(e, stage) {
  const cfg = getMachineConfig(e.machine) || {};
  const input = h('input', {
    class: 'lib-try-input', type: 'text', spellcheck: 'false', autocomplete: 'off',
    placeholder: cfg.isOmega ? 'an ω-word u(v), e.g. ab(a)' : e.stats.tapes > 1 ? 'input for tape 1' : `a word over { ${e.stats.sigma.join(', ')} } — empty for ε`,
    'aria-label': 'Word to run'
  });
  const out = h('div', { class: 'lib-try-out', 'aria-live': 'polite' });
  const examples = h('div', { class: 'lib-try-examples' });
  const run = async () => {
    out.textContent = 'Running…';
    try {
      const d = await entryDoc(e);
      const got = decideRaw(d.target, input.value);
      out.innerHTML = '';
      out.append(verdictChip(input.value, got));
      if (got.verdict !== 'err') {
        const trace = traceWord(d.target, input.value);
        if (!trace.error && trace.steps.length) playRun(stage, trace, got);
      }
    } catch (err) {
      // The published minimal DFA answers without the file, which is exactly
      // what an offline reader with a finite automaton needs.
      const v = dfaAccepts(e.dfa, input.value);
      out.innerHTML = '';
      if (v !== null) out.append(verdictChip(input.value, { verdict: v ? 'acc' : 'rej', output: null }), h('span', { class: 'lib-muted', text: ' from the published minimal DFA — offline' }));
      else out.textContent = `Could not run: ${err.message}`;
    }
  };
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } });
  entryDoc(e).then(d => {
    const rows = Array.isArray(d.doc?.meta?.inputs) ? d.doc.meta.inputs : [];
    if (!rows.length) return;
    const list = h('div', { class: 'lib-chips' });
    for (const r of rows) {
      const got = decideRaw(d.target, r.w);
      const chip = verdictChip(r.w, got, r);
      chip.addEventListener('click', () => { input.value = r.w; run(); });
      list.append(chip);
    }
    examples.append(h('span', { class: 'lib-try-label', text: 'The author’s examples' }), list);
  }, () => { /* offline and unsaved: the box still answers from the DFA */ });
  return h('section', { class: 'lib-try' },
    h('div', { class: 'lib-try-row' }, h('span', { class: 'lib-try-label', text: 'Try it' }), input, button('Run', run, 'btn-p lib-try-run')),
    out, examples);
}

function verdictChip(word, got, expected = null) {
  const w = word === '' ? 'ε' : word;
  let cls = 'lib-verdict', text;
  if (got.verdict === 'err') { cls += ' is-err'; text = `${w} — ${got.error}`; }
  else {
    const v = got.verdict === 'acc' ? 'accept' : got.verdict === 'rej' ? 'reject' : 'no verdict';
    cls += got.verdict === 'acc' ? ' is-acc' : got.verdict === 'rej' ? ' is-rej' : ' is-unk';
    text = `${w} → ${v}`;
    if (got.output !== null && got.output !== undefined && String(got.output) !== '') text += ` · output ${Array.isArray(got.output) ? got.output.join('') : got.output}`;
  }
  if (expected) {
    const want = expected.expect === 'accept' ? 'acc' : expected.expect === 'reject' ? 'rej' : null;
    if (want && want !== got.verdict) cls += ' is-wrong';
  }
  return h('button', { type: 'button', class: cls, title: expected?.label || '' }, text);
}

// ── Facts, behaviour, and what else is related ──

function factsTable(e) {
  const rows = [
    ['Size', `${e.stats.states} states · ${e.stats.transitions} transitions${e.stats.tapes > 1 ? ` · ${e.stats.tapes} tapes` : ''}${e.stats.blocks ? ` · ${e.stats.blocks} blocks` : ''}`],
    e.difficulty ? ['Level', e.difficulty[0].toUpperCase() + e.difficulty.slice(1)] : null,
    e.chapter ? ['Source', e.chapter] : null,
    ['Licence', LIBRARY_LICENSES[e.license] || e.license || '—']
  ].filter(Boolean);
  const table = h('dl', { class: 'lib-facts' });
  for (const [k, v] of rows) table.append(h('dt', { text: k }), h('dd', { text: v }));
  if (e.tags.length) {
    table.append(h('dt', { text: 'Tags' }), h('dd', {}, e.tags.map(t => button(t, () => { L.filters = { tag: t }; L.query = ''; go('browse'); }, 'lib-tag'))));
  }
  return table;
}

const METHOD_LABEL = {
  simulation: 'run to its halt',
  cycler: 'a configuration repeats exactly (a cycler)',
  translated: 'the run repeats, shifted along fresh tape (a translated cycler)',
  backward: 'backward reasoning — no halting configuration is reachable'
};

function behaviourSection(e) {
  const b = e.behaviour;
  let line;
  if (!b) line = null;
  else if (b.verdict === 'halts') line = h('p', { class: 'lib-behaviour-say' }, 'Halts from a blank tape after ', h('strong', { text: Number(b.steps).toLocaleString('en-US') }), ` steps${b.ones !== undefined ? `, leaving ${Number(b.ones).toLocaleString('en-US')} non-blank cells` : ''}.`);
  else if (b.verdict === 'never') line = h('p', { class: 'lib-behaviour-say' }, 'Never halts from a blank tape. Proven: ', METHOD_LABEL[b.method] || b.method, b.period ? `, period ${b.period}.` : '.');
  else line = h('p', { class: 'lib-behaviour-say', text: 'Whether it halts from a blank tape was not settled within the library’s step budget.' });
  const text = h('div', { class: 'lib-behaviour-text' }, line);
  if (e.standard) {
    text.append(h('div', { class: 'lib-standard' },
      h('span', { class: 'lib-aside-title', text: 'Standard format' }),
      h('code', { class: 'lib-code-text', text: e.standard }),
      h('div', { class: 'lib-standard-actions' },
        button('Copy', () => exportCopyText(e.standard, 'Machine code copied — paste it on any canvas to open it'), 'lib-textbtn'),
        link('View on bbchallenge.org ↗', bbchallengeUrl(e.standard, { halts: b?.verdict === 'halts' }), 'lib-textbtn'))));
  }
  const fig = h('figure', { class: 'lib-behaviour-fig' });
  const frames = e.standard ? framesFromStandard(e.standard, 90) : null;
  const drawFrames = f => {
    if (!f?.length) return;
    fig.innerHTML = '';
    fig.append(svgFigure(drawRun(f, { w: 360, h: 240 }), 'is-run'), h('figcaption', { class: 'lib-figcaption-text', text: 'The first steps from a blank tape: one row per step, time running down; the outlined cell is the head.' }));
  };
  if (frames) drawFrames(frames);
  else entryDoc(e).then(d => drawFrames(runFramesOf(d.target, 90)), () => {});
  return h('section', { class: 'lib-shelf lib-behaviour' }, sectionHead('Behaviour'), h('div', { class: 'lib-behaviour-body' }, fig, text));
}

function relatedSection(e, idx) {
  const ancestry = remixAncestry(idx, e.id);
  const kids = e.remixes.map(r => entryById(idx, r)).filter(Boolean);
  const same = sameLanguageAs(idx, e.fingerprint, e.id);
  if (!ancestry.length && !kids.length && !same.length) return null;
  const sec = h('section', { class: 'lib-shelf lib-related' }, sectionHead('Related'));
  if (ancestry.length) {
    sec.append(h('p', { class: 'lib-tree-line' }, 'Remixed from ',
      [...ancestry].reverse().map((a, i) => [i ? ' → ' : '', button(a.title, () => go('entry', a.id), 'lib-textbtn')]),
      ' → ', h('strong', { text: e.title })));
  }
  if (kids.length) sec.append(h('h4', { class: 'lib-aside-title', text: 'Remixes of this machine' }), grid(kids));
  if (same.length) sec.append(h('h4', { class: 'lib-aside-title', text: 'The same language, drawn differently' }), grid(same));
  return sec;
}

// ── Doing things with an entry ────────────────────────────────────

/** Download, stamp and open an entry in a tab. Resolves whether it opened. */
export async function openEntry(e, { quiet = false } = {}) {
  let text, offline = false;
  try {
    text = await fetchEntryText(e, index());
  } catch (err) {
    if (err?.message === 'offline-copy' && err.text) { text = err.text; offline = true; }
    else { showStatus(`Could not open “${e.title}”: ${err.message}`); return false; }
  }
  let doc;
  try { doc = stampSource(text, e); }
  catch (err) { showStatus(`“${e.title}” is not a readable machine: ${err.message}`); return false; }
  const ok = applyDocument(JSON.stringify(doc), `${e.id.split('/').pop()}.automaton`, { tabName: e.title });
  if (!ok) return false;
  noteRecentlyOpened(e.id);
  if (App.view !== 'build') setView('build');
  if (!quiet) showStatus(offline ? `Opened your saved copy of “${e.title}” — the library is offline` : `Opened “${e.title}” from the library`);
  return true;
}

export async function openLibraryEntryById(id) {
  const res = await ensureLoaded();
  const e = entryById(res?.index, id);
  if (e) return openEntry(e);
  // Offline with no index at all: a copy in My Library still opens.
  const saved = L.saved.find(r => r.id === id);
  if (saved?.entry) return openEntry({ ...saved.entry, hash: saved.hash });
  showStatus(res?.index ? `There is no machine “${id}” in the library.` : `The library could not be reached to open “${id}”.`);
  return false;
}

/**
 * A library machine as a building block: its states laid out around the
 * origin, entered at its start state, left from its accepting states — which is
 * what a block definition already means, so nothing about blocks changes.
 */
export function blockDefinitionFromDoc(doc, name) {
  const t = targetFromDoc(doc);
  const xs = t.states.map(s => s.x || 0), ys = t.states.map(s => s.y || 0);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return {
    name,
    machine: t.machine,
    states: t.states.map(s => ({ ...s, x: (s.x || 0) - cx, y: (s.y || 0) - cy })),
    transitions: t.transitions,
    blocks: t.blocks,
    startId: t.startId,
    entry: t.startId,
    accepts: t.accepts,
    sigma: t.sigma,
    stackAlpha: t.stackAlpha,
    sym: t.config.sym
  };
}

async function insertAsBlock(e) {
  try {
    const d = await entryDoc(e);
    const def = blockDefinitionFromDoc(JSON.parse(d.text), e.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 24) || 'block');
    const block = placeBlockDefinition(def, freeSpotForBlock());
    if (block) setView('build');
  } catch (err) {
    showStatus(`Could not insert “${e.title}”: ${err.message}`);
  }
}

// ── Collections ───────────────────────────────────────────────────

/** A collection as one row of a list: three of its figures, its name, what it holds. */
function collectionRow(c) {
  const idx = index();
  const row = h('button', { type: 'button', class: 'lib-coll', on: { click: () => go('collection', c.id) } });
  const strip = h('div', { class: 'lib-coll-strip', 'aria-hidden': 'true' });
  c.entries.slice(0, 3).map(id => entryById(idx, id)).filter(Boolean).forEach(e => strip.append(figureOf(e, { w: 160, h: 100 })));
  row.append(strip, h('div', { class: 'lib-coll-text' },
    h('span', { class: 'lib-coll-title', text: c.title }),
    c.blurb ? texLine('span', 'lib-coll-blurb', c.blurb) : null,
    h('span', { class: 'lib-coll-meta', text: `${c.entries.length} machine${c.entries.length === 1 ? '' : 's'}${c.curator ? ` · curated by @${c.curator}` : ''}` })));
  return row;
}

function pageCollections() {
  const idx = index();
  return h('div', { class: 'lib-page' },
    h('div', { class: 'lib-pagehead' },
      h('p', { class: 'lib-kicker', text: 'Collections' }),
      h('h2', { class: 'lib-display', text: 'Machines gathered the way a course or a question gathers them.' })),
    idx.collections.length ? h('div', { class: 'lib-colls is-wide' }, idx.collections.map(collectionRow)) : h('div', { class: 'lib-empty', text: 'No collections yet.' }));
}

function pageCollection(id) {
  const idx = index();
  const c = idx.collections.find(x => x.id === id);
  if (!c) return h('div', { class: 'lib-empty', text: `There is no collection “${id}”.` });
  const entries = c.entries.map(x => entryById(idx, x)).filter(Boolean);
  return h('div', { class: 'lib-page' },
    h('nav', { class: 'lib-crumbs' }, button('Collections', () => go('collections', null, { reset: true }), 'lib-textbtn'), h('span', { text: '/' })),
    h('div', { class: 'lib-pagehead' },
      h('p', { class: 'lib-kicker', text: `Collection · ${entries.length} machine${entries.length === 1 ? '' : 's'}${c.curator ? ` · curated by @${c.curator}` : ''}` }),
      h('h2', { class: 'lib-display', text: c.title }),
      c.blurb ? texLine('p', 'lib-lede', c.blurb) : null,
      h('div', { class: 'lib-actions' },
        button('Save all offline', async () => {
          let n = 0;
          for (const e of entries) {
            try { const d = await entryDoc(e); await saveToMyLibrary(e, d.text); n++; } catch { /* keep going */ }
          }
          await refreshSaved();
          showStatus(`Saved ${n} of ${entries.length} to My Library`);
          renderPage();
        }, 'btn-g'),
        button('Copy link', () => exportCopyText(webAppLink({ action: 'collection', id: c.id }), 'Link to this collection copied'), 'btn-g'))),
    behaviourTable(entries),
    h('section', { class: 'lib-shelf' }, sectionHead('The machines'), grid(entries)));
}

/**
 * The table a collection of Turing machines is read by: size, steps, ones and
 * the code, one row each. Drawn only when most of the collection has a halting
 * answer or a code — a table of dashes on a collection of DFAs would be noise.
 */
function behaviourTable(entries) {
  const rows = entries.filter(e => e.behaviour || e.standard);
  if (rows.length < 2 || rows.length < entries.length / 2) return null;
  const table = h('table', { class: 'lib-board lib-bb-table' },
    h('thead', {}, h('tr', {}, ['Machine', 'Size', 'Steps', 'Non-blank', 'Standard format', ''].map((t, i) => h('th', { text: t, class: i === 2 || i === 3 ? 'lib-num' : null })))));
  const body = h('tbody');
  for (const e of rows) {
    const b = e.behaviour || {};
    const size = standardSize(e.standard);
    const steps = b.verdict === 'halts' ? Number(b.steps).toLocaleString('en-US') : b.verdict === 'never' ? '∞' : '?';
    body.append(h('tr', {},
      h('td', {}, button(e.title, () => go('entry', e.id), 'lib-textbtn lib-board-name')),
      h('td', { text: size ? `${size.states} × ${size.symbols}` : '', title: 'states × symbols', class: 'lib-mono' }),
      h('td', { text: steps, class: 'lib-num' }),
      h('td', { text: b.ones !== undefined ? Number(b.ones).toLocaleString('en-US') : '', class: 'lib-num' }),
      h('td', {}, e.standard ? h('code', { class: 'lib-code-text', text: e.standard }) : ''),
      h('td', { class: 'lib-row-actions' },
        button('Open', () => openEntry(e), 'lib-textbtn'),
        e.standard ? link('bbchallenge ↗', bbchallengeUrl(e.standard, { halts: b.verdict === 'halts' }), 'lib-textbtn') : null)));
  }
  table.append(body);
  return h('section', { class: 'lib-shelf' }, sectionHead('At a glance'), h('div', { class: 'lib-table-wrap' }, table));
}

// ── My Library ────────────────────────────────────────────────────

function pageMine() {
  const idx = index();
  const page = h('div', { class: 'lib-page' },
    h('div', { class: 'lib-pagehead' },
      h('p', { class: 'lib-kicker', text: 'Yours' }),
      h('h2', { class: 'lib-display', text: 'My Library' }),
      h('p', { class: 'lib-lede', text: 'Machines you saved open without the network. When a newer version is published, it says so here.' })));
  const updates = updatesFor(L.saved, idx);
  const outdated = new Set(updates.map(u => u.saved.id));
  if (!L.saved.length) page.append(h('div', { class: 'lib-empty', text: 'Nothing saved yet — use Save on any machine.' }));
  const list = h('div', { class: 'lib-mine' });
  for (const r of L.saved) {
    const e = r.entry || { id: r.id, title: r.id, machine: '' };
    const fresh = entryById(idx, r.id);
    list.append(h('div', { class: 'lib-mine-row' },
      h('div', { class: 'lib-mine-text' },
        h('div', { class: 'lib-mine-title', text: e.title }),
        h('div', { class: 'lib-muted', text: [e.machine, `saved ${relTime(new Date(r.savedAt).toISOString())}`].filter(Boolean).join(' · ') }),
        outdated.has(r.id) ? h('div', { class: 'lib-update', text: `Version ${fresh?.version || ''} is published — yours is older.` }) : null),
      h('div', { class: 'lib-actions' },
        button('Open', () => openEntry(fresh && !outdated.has(r.id) ? fresh : { ...e, hash: r.hash }), 'btn-p'),
        outdated.has(r.id) ? button('Update', async () => {
          try {
            const text = await fetchEntryText(fresh, idx);
            await saveToMyLibrary(fresh, text);
            await refreshSaved();
            showStatus(`Updated “${fresh.title}”`);
            renderPage();
          } catch (err) { showStatus(`Could not update: ${err.message}`); }
        }, 'btn-g') : null,
        fresh ? button('Details', () => go('entry', r.id), 'btn-g') : null,
        button('Remove', async () => { await removeFromMyLibrary(r.id); await refreshSaved(); renderPage(); }, 'btn-g'))));
  }
  page.append(list);
  if (idx) {
    const recent = recentLibraryIds().map(id => entryById(idx, id)).filter(Boolean);
    if (recent.length) page.append(section('Opened recently', grid(recent)));
  }
  return page;
}

// ── Submitting ────────────────────────────────────────────────────

function field(label, control, hint) {
  return h('label', { class: 'lib-field' }, h('span', { class: 'lib-field-label', text: label }), control, hint ? h('span', { class: 'lib-field-hint', text: hint }) : null);
}

/**
 * How a field's text will read on its listing, typeset — shown only while the
 * text holds some LaTeX, since plain words look the same either way. `update`
 * is handed the text on every keystroke and redraws a moment after typing
 * stops: KaTeX re-typesets the whole preview each time.
 */
function texPreview(cls) {
  const box = h('div', { class: `lib-tex-preview ${cls}`, 'aria-live': 'polite', hidden: true });
  let timer = null;
  const draw = text => {
    box.innerHTML = '';
    if (!hasTex(text)) { box.setAttribute('hidden', ''); return; }
    box.removeAttribute('hidden');
    box.append(h('span', { class: 'lib-tex-preview-label', text: 'Preview' }));
    const body = paragraphs(text, 'lib-tex-preview-body');
    if (body) { box.append(body); typeset(body); }
  };
  box.update = (text, now = false) => {
    clearTimeout(timer);
    if (now) draw(text || '');
    else timer = setTimeout(() => draw(text || ''), 250);
  };
  return box;
}

/**
 * The form's fields, read from the machine on the canvas — again whenever that
 * is a different machine than the one they were read from, so a tab switch
 * never files one machine under another's title.
 */
function submitFields() {
  const key = `${activeWorkspaceId}|${App.meta?.library?.source?.id || ''}`;
  if (!L.submit || L.submitFor !== key) {
    L.submit = submissionDefaults();
    L.submitFor = key;
    L.submitCheck = null;
  }
  return L.submit;
}

function pageSubmit() {
  const f = submitFields();
  const idx = index();
  const page = h('div', { class: 'lib-page lib-submit' },
    h('div', { class: 'lib-pagehead' },
      h('p', { class: 'lib-kicker', text: 'Yours' }),
      h('h2', { class: 'lib-display', text: 'Submit a machine' }),
      h('p', { class: 'lib-lede', text: 'Sends the machine on your canvas to the library as a GitHub issue. The library’s CI runs the same checks you can run here, opens a pull request, and a maintainer merges it. You need a GitHub account; you are credited by it.' })));
  if (!App.states.length) {
    page.append(h('div', { class: 'lib-empty', text: 'There is no machine on the canvas to submit. Build one, or open one from the library to remix it.' }));
    return page;
  }
  const bind = (key, node, ev = 'input', then = null) => {
    node.value = f[key] ?? '';
    node.addEventListener(ev, () => { f[key] = node.type === 'checkbox' ? node.checked : node.value; L.submitCheck = null; then?.(node.value); });
    return node;
  };
  const blurbPreview = texPreview('lib-lede');
  const readmePreview = texPreview('lib-prose');
  const title = bind('title', h('input', { class: 'inp', type: 'text', maxlength: '70', placeholder: 'e.g. Binary divisibility by 7' }));
  const blurb = bind('blurb', h('textarea', { class: 'inp', rows: '3', maxlength: '400', placeholder: 'One or two sentences: what it does and why it is interesting.' }), 'input', blurbPreview.update);
  const readme = bind('readme', h('textarea', { class: 'inp', rows: '5', maxlength: '4000', placeholder: 'Optional. How it works, where it comes from, what to try.' }), 'input', readmePreview.update);
  blurbPreview.update(f.blurb, true);
  readmePreview.update(f.readme, true);
  const tags = bind('tags', h('input', { class: 'inp', type: 'text', placeholder: 'busy-beaver, textbook, parity' }));
  const level = h('select', { class: 'inp' }, h('option', { value: '' }, '—'), DIFFICULTIES.map(d => h('option', { value: d }, d)));
  bind('difficulty', level, 'change');
  const chapter = bind('chapter', h('input', { class: 'inp', type: 'text', placeholder: 'e.g. Sipser §1.2' }));
  const forkOf = bind('forkOf', h('input', { class: 'inp', type: 'text', placeholder: 'library id, e.g. finite/dfa/divisible-by-5' }));
  const login = bind('login', h('input', { class: 'inp', type: 'text', placeholder: 'your GitHub username', autocomplete: 'username' }));
  const name = bind('name', h('input', { class: 'inp', type: 'text', placeholder: 'optional — how to credit you' }));
  const license = h('select', { class: 'inp' }, Object.entries(LIBRARY_LICENSES).map(([k, v]) => h('option', { value: k }, v)));
  bind('license', license, 'change');
  const agree = h('input', { type: 'checkbox' });
  agree.checked = !!f.agreed;
  agree.addEventListener('change', () => { f.agreed = agree.checked; L.submitCheck = null; });
  const kind = h('select', { class: 'inp' }, h('option', { value: 'machine' }, 'A machine'), App.exercise ? h('option', { value: 'exercise' }, 'An exercise (keeps its checker)') : null);
  bind('kind', kind, 'change');
  const source = App.meta?.library?.source;
  const forkHint = f.forkOf && source?.id === f.forkOf
    ? 'Filled in because you opened this from the library. If the entry is yours, submitting updates it instead.'
    : '';

  page.append(h('div', { class: 'lib-form' },
    field('Title', title), field('Description', blurb, 'Shown on the card and in search results. LaTeX between $…$ is typeset.'),
    blurbPreview,
    field('Write-up', readme, 'Blank lines separate paragraphs. LaTeX is typeset: $…$ inline, $$…$$ displayed.'),
    readmePreview,
    h('div', { class: 'lib-form-row' }, field('Tags', tags), field('Level', level), field('Chapter', chapter)),
    field('Remix of', forkOf, forkHint),
    h('div', { class: 'lib-form-row' }, field('GitHub username', login), field('Display name', name), field('Submitting', kind)),
    field('Licence', license),
    h('label', { class: 'lib-agree' }, agree, ' I made this (or have the right to share it) and release it under the licence above.')));

  const results = h('div', { class: 'lib-check' });
  const drawCheck = () => {
    results.innerHTML = '';
    const c = L.submitCheck;
    if (!c) return;
    if (c.errors.length) results.append(h('div', { class: 'lib-check-bad' }, h('strong', { text: 'Fix before submitting:' }), h('ul', {}, c.errors.map(x => h('li', { text: x })))));
    if (c.update) results.append(h('div', { class: 'lib-check-ok' }, `Updates your entry “${c.update.title}”.`));
    if (c.duplicates.length) {
      results.append(h('div', { class: 'lib-check-warn' },
        h('strong', { text: 'Already in the library: ' }),
        c.duplicates.map((d, i) => [i ? ', ' : '', button(d.title, () => go('entry', d.id), 'btn-g lib-inline')]),
        ' recognise the same language. A different construction is still welcome — say what it adds in the write-up.'));
    }
    if (c.warnings.length) results.append(h('div', { class: 'lib-check-warn' }, h('ul', {}, c.warnings.map(x => h('li', { text: x })))));
    const badges = c.analysis.facts?.badges || [];
    if (badges.length) {
      results.append(h('div', { class: 'lib-check-ok' }, h('strong', { text: 'The library will verify: ' }),
        badges.map(b => h('span', { class: `lib-badge-pill is-${b.id}`, title: BADGES[b.id].say }, `${BADGES[b.id].icon} ${BADGES[b.id].label}`))));
    }
    if (c.ok) results.append(h('div', { class: 'lib-muted', text: 'Everything checks out. The CI may add a halting badge that needs a longer run than this dialog does.' }));
  };

  const check = () => {
    rememberLogin(f.login);
    try { L.submitCheck = precheckSubmission(f, idx); }
    catch (err) { L.submitCheck = { errors: [err.message], warnings: [], duplicates: [], analysis: { facts: null }, ok: false }; }
    drawCheck();
    return L.submitCheck;
  };
  const send = async () => {
    const c = check();
    if (!c.ok) { showStatus('Fix the problems listed before submitting'); return; }
    // The form carries what the check decided: which entry this updates, and
    // the remix it really is (an update is not a remix of itself).
    const filed = { ...f, updates: c.update?.id || '', forkOf: c.doc.meta.library.forkOf || '' };
    const res = await submissionLink(filed, c.doc, index()?.repo || undefined, index()?.submit || null);
    if (!res.included) exportCopyText(res.link, 'The machine is too large for the form’s address — its link is on your clipboard: paste it into “Machine”');
    window.open(res.url, '_blank', 'noopener');
  };
  page.append(h('div', { class: 'lib-actions' },
    button('Check', check, 'btn-g'),
    button('Submit on GitHub', send, 'btn-p'),
    button('Download file', () => {
      const c = check();
      if (!c.errors.filter(x => !/Tick the box/.test(x)).length) exportDownload(`${(f.title || 'machine').replace(/[^\p{L}\p{N}_-]+/gu, '-').toLowerCase()}.automaton`, JSON.stringify(c.doc, null, 2), 'application/x-automatastudio+json');
    }, 'btn-g', { 'data-tip': 'For a machine too large for a link — drag the file into the issue instead' })));
  page.append(results);
  drawCheck();
  return page;
}

// ── How it works ──────────────────────────────────────────────────

function pageAbout() {
  const idx = index();
  const source = h('input', { class: 'inp', type: 'url', placeholder: 'https://…/ (a fork, or a local build)' });
  source.value = libraryIsOverridden() ? libraryBase() : '';
  return h('div', { class: 'lib-page' },
    h('div', { class: 'lib-pagehead' },
      h('p', { class: 'lib-kicker', text: 'How it works' }),
      h('h2', { class: 'lib-display', text: 'Every badge is an answer the machine gave.' })),
    paragraphs(`Every machine in the library is a file in a public GitHub repository. When one is added or changed, the library's CI loads it with this app's own engine and checks it: it runs every example the author wrote on the machine's card, checks determinism with the editor's own rule, minimises finite automata, and proves whether Turing machines halt. What it finds becomes the badges.

Nothing on a listing is taken on trust except the words the author wrote. A badge is an answer the CI got from the machine; an entry the CI could not analyse carries no badge rather than a guess.

Submitting files a GitHub issue from a form this app fills in. The CI turns the issue into a pull request and posts its report; a maintainer merges it, and the website and the index rebuild. You are credited by the GitHub account that opened the issue.`),
    section('What the library checks', h('dl', { class: 'lib-facts lib-badge-list' }, Object.entries(BADGES).map(([, b]) => [h('dt', { text: b.label }), h('dd', { text: b.say })]))),
    section('Links', h('div', { class: 'lib-actions' },
      link('Repository', repoUrl(idx?.repo || LIBRARY_REPO), 'btn-g lib-a'),
      link('Website', idx?.site || libraryBase(), 'btn-g lib-a'),
      link('Open in the web app', webAppLink({ action: 'browse' }), 'btn-g lib-a'))),
    section('Source',
      h('p', { class: 'lib-muted', text: `The library is read from ${libraryBase()}. Point it at a fork or a local build to try changes before they are published.` }),
      h('div', { class: 'lib-try' }, source,
        button('Use', () => {
          const v = source.value.trim();
          if (v && !/^https?:\/\//.test(v)) { showStatus('That is not an http(s) address'); return; }
          switchSource(v);
        }, 'btn-g'),
        button('Reset', () => switchSource(null), 'btn-g'))));
}

// ── The card's "from the library" line ────────────────────────────

function paintSource(lib) {
  const source = lib?.source;
  if (!source?.id && !lib?.forkOf) return null;
  const line = h('div', { class: 'example-card-source' });
  if (source?.id) {
    line.append(h('button', { type: 'button', class: 'lib-inline-link', on: { click: () => go('entry', source.id) } }, 'From the library'));
  }
  if (lib.author?.login) line.append(` · @${lib.author.login}`);
  if (!source?.id && lib.forkOf) line.append(h('span', { text: `remix of ${lib.forkOf}` }));
  const idx = cachedLibrary()?.index;
  if (source && sourceIsOutdated(source, idx)) {
    const e = entryById(idx, source.id);
    line.append(' · ', h('button', {
      type: 'button', class: 'lib-inline-link is-update', on: { click: () => e && openEntry(e) },
      'data-tip': 'A newer version is published — opens it in a new tab'
    }, 'Update available'));
  }
  return line;
}

setCardSourcePainter(paintSource);

function renderExampleCardIfLibrary() {
  if (App.meta?.library?.source) renderExampleCard();
}

/**
 * Soon after boot, if the tab on screen came from the library, ask whether a
 * newer version is out — one small fetch, and only for a reader who has a
 * library machine open.
 */
export function checkLibraryUpdatesSoon(delay = 4000) {
  if (!App.meta?.library?.source) return;
  const t = setTimeout(() => { ensureLoaded(); }, delay);
  if (typeof t?.unref === 'function') t.unref();
}

// ── Deep links ────────────────────────────────────────────────────

/** Act on `#lib=…` and friends. Resolves whether the request was one. */
export async function handleLibraryRequest(req) {
  if (!req) return false;
  if (req.action === 'browse') { go('discover', null, { reset: true }); return true; }
  if (req.action === 'show') { go('entry', req.id, { reset: true }); return true; }
  if (req.action === 'collection') { go('collection', req.id, { reset: true }); return true; }
  if (req.action === 'open') return openLibraryEntryById(req.id);
  return false;
}

/**
 * At boot, once the workspaces are restored: start acting on library links —
 * the one in the address bar, and any automata-studio:// link the desktop app
 * received while booting.
 */
export async function startLibraryLinks() {
  setLibraryRequestHandler(url => handleLibraryProtocolUrl(url));
  return loadLibraryLinkFromURL();
}

/** At boot and on hashchange: read a library link from the address bar, then clear it. */
export async function loadLibraryLinkFromURL() {
  const source = parseLibrarySourceHash(globalThis.location?.hash);
  if (source) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* not in a browser */ }
    showStatus(`Library: reading ${source}`);
    L.route = { page: 'discover', id: null };
    L.back = [];
    switchSource(source);
    if (App.view !== 'library') setView('library');
    return true;
  }
  const req = parseLibraryHash(globalThis.location?.hash);
  if (!req) return false;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* not in a browser */ }
  // Not awaited: opening fetches over the network, and boot should not wait
  // on a CDN to show the reader their canvas.
  handleLibraryRequest(req).catch(e => console.error(e));
  return true;
}

/** The desktop app's automata-studio:// links arrive here from electron-bridge.js. */
export function handleLibraryProtocolUrl(url) {
  return handleLibraryRequest(parseLibraryProtocolUrl(url));
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('hashchange', () => { loadLibraryLinkFromURL(); });
}

// `/` jumps to the search box anywhere in the Library, the way it does on most
// sites with one — unless the reader is already typing somewhere.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', ev => {
    if (ev.key !== '/' || App.view !== 'library' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const box = document.querySelector?.('#lib-content .lib-search');
    if (!box) return;
    ev.preventDefault();
    box.focus();
    box.select?.();
  });
}

// ── For StateMate ─────────────────────────────────────────────────

/** Open the Library on a search — StateMate's `/library <words>`. */
export function browseLibrary(query = '') {
  L.query = String(query || '');
  L.filters = {};
  L.canvasMatch = null;
  go(L.query ? 'browse' : 'discover', null, { reset: true });
}

/** Search results for `/library`, from the index in memory — fetching it if need be. */
export async function searchLibrary(query, limit = 8) {
  const res = await ensureLoaded();
  return res?.index ? queryLibrary(res.index, query).slice(0, limit) : [];
}
