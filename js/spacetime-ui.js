// ══════════════════════════════════════════════════════════════════
//  THE SPACE-TIME SECTION — a whole run, in a window over the canvas
// ══════════════════════════════════════════════════════════════════
//  A right-panel section like any other (`rp-spacetime` in the section
//  registry), and built to be pulled out: the tracker's header carries a
//  button that opens it straight into a window, because a diagram of a
//  whole run wants more width than a sidebar has. Docked, it is a short
//  strip; floating, it takes whatever the window is given.
//
//  What is drawn is js/spacetime.js's business. This module is the part
//  with a page attached: the canvas and its viewport, the player it follows,
//  the pointer and keyboard, and the export dialog.
//
//  Three rules it keeps.
//
//  • **The canvas is the size of the viewport, never of the diagram.** A
//    ten-thousand-step run at 8px a row is 80,000px tall — past every
//    browser's canvas limit, and a bitmap the size of a poster to scroll
//    through. A spacer gives the scroller the diagram's size and the canvas
//    repaints the window onto it, so a paint costs what is on screen.
//
//  • **It reads the reachable prefix and never pulls.** `reachableCount()`
//    is the scrubber's own answer, so a block run's diagram stops where the
//    block did, and a streaming run's grows as it plays. Computing the rest
//    is a button, and a drain in slices — the same one ⏭ uses.
//
//  • **It follows the playhead, and the playhead follows it.** The row on
//    screen is the tracker's step; clicking or dragging a row scrubs there.
//    The two are one control seen two ways, never two cursors.
//
//  Listeners are attached at creation and nothing is reached from an `on*`
//  attribute, so the whole feature adds nothing to bridge.js.
// ══════════════════════════════════════════════════════════════════

import { $, App, getMachineConfig, getState } from './state.js';
import { isAnyPDA, isCounterMachine, isQueueAutomaton, isSingleTapeTM, isTwoStackPDA, showStatus } from './utils.js';
import { getTransition, transLabel } from './states-transitions.js';
import {
  CELL_SIZES, FINAL_SAY, GLYPH_MIN, PRINT_STYLE, SYMBOL_PALETTE, acceptingBranch,
  estimateSvgElements, hitSpaceTime, makeOverview, makeSpaceTime, overviewColors,
  overviewGeometry, overviewGrid, overviewImage, paintOverviewStrip, paintSpaceTime, renderOverviewBase,
  paintWholeRun, spaceTimeCSV, spaceTimeLayout, spaceTimeSVG, spaceTimeText,
  svgContext, transparentStyle, wholeRunBins, wholeRunLayout
} from './spacetime.js';
import { tapeModelSay } from './tape-view.js';
import {
  computeRestOfRun, reachableCount, runIsComplete, scrubSim,
  stepBack, stepFwd, stepToEnd, stepToStart
} from './simulation.js';
import { floatLayerRect, floatSection, floatingEnabled, raiseFloat, syncPanelEmpty } from './panel-float.js';
import { isSectionFloating } from './panel-sections.js';
import { setRPSectionCollapsed } from './ui.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { exportBaseName, exportCopyText, exportDownload } from './export-core.js';
import { Change, subscribe } from './store.js';

export const SPACETIME_SECTION = 'rp-spacetime';

const CELL_KEY = 'automata-spacetime-cell';
const PATH_KEY = 'automata-spacetime-path';
const OVERVIEW_KEY = 'automata-spacetime-overview';

/** The largest cell "fit" will choose; past this a short run is just big. */
const FIT_MAX = 20;

/**
 * What kind of diagram this machine has.
 *
 *   'tape'    one row per step, and a column per cell — every machine whose
 *             run is one timeline of one or more tapes
 *   'store'   a pushdown machine: the input, and its stack, queue, counter or
 *             second stack, each drawn as a row whose bottom is a wall and
 *             whose top is the head — so the head's path is the store's
 *             height over time. PDT adds its output.
 *   'branch'  NDTM: the search visits branches in turn, so consecutive steps
 *             are unrelated and there is no one timeline to draw — until one
 *             accepts, and then the branch that did is exactly such a timeline
 *   null      nothing that is a store of symbols over time
 *
 * The EPDA is left out on purpose: its store is a stack of stacks, and a row
 * of cells would claim a single stack it does not have.
 */
export function spaceTimeKind(m = App.machine) {
  if (m === 'NDTM') return 'branch';
  if (m === 'MTM' || isSingleTapeTM(m)) return 'tape';
  if (isAnyPDA(m)) return 'store';
  return null;
}

/** The rows of a pushdown machine's diagram, read off each step. */
function storeTracks(m) {
  const queue = isQueueAutomaton(m);
  const tokensOf = s => s.tokens || App.currentTokens || [];
  const stackOf = field => s => {
    const st = s[field] || [];
    return {
      cells: st,
      // A stack's head is its top; a queue is read at its front.
      head: queue ? (st.length ? 0 : -1) : st.length - 1,
      origin: 0, leftBound: 0, rightBound: null, markers: [], blank: undefined, readOnly: false
    };
  };
  const tracks = [{
    unit: 'symbol',
    label: 'Input',
    viewOf: s => {
      const t = tokensOf(s);
      const pos = typeof s.pos === 'number' ? s.pos : -1;
      return {
        cells: t,
        // The symbol about to be read; past the end there is nothing under it.
        head: pos >= 0 && pos < t.length ? pos : -1,
        origin: 0, leftBound: 0, rightBound: Math.max(0, t.length - 1), markers: [], blank: undefined, readOnly: true
      };
    }
  }];
  const two = isTwoStackPDA(m);
  const name = queue ? 'Queue' : isCounterMachine(m) ? 'Counter' : 'Stack';
  tracks.push({ unit: queue ? 'position' : 'depth', label: two ? 'Stack 1' : name, say: queue ? 'front at left' : 'bottom at left', viewOf: stackOf('stack') });
  if (two) tracks.push({ unit: 'depth', label: 'Stack 2', say: 'bottom at left', viewOf: stackOf('stack2') });
  if (getMachineConfig(m).isTransducer) {
    tracks.push({
      unit: 'position',
      label: 'Output',
      say: 'written left to right',
      viewOf: s => {
        const o = s.outToks || [];
        return { cells: o, head: o.length - 1, origin: 0, leftBound: 0, rightBound: null, markers: [], blank: undefined, readOnly: false };
      }
    });
  }
  return tracks;
}

// ── which row the player is on, and the way back ──
//  For a tape or a store, row i is step i. For an NDTM's accepting branch a
//  row is one configuration of the search, and most search steps are on no
//  row at all — the player can stand on a branch the diagram does not draw.

function playheadRow() {
  if (model && model.kind === 'branch') {
    const r = model.branch.rowOfStep.get(App.simIdx);
    return r === undefined ? null : r;
  }
  return App.simIdx;
}

function scrubToRow(row) {
  if (model && model.kind === 'branch') {
    const i = model.branch.stepOfRow[row];
    if (i !== undefined && i !== App.simIdx) scrubSim(i);
    return;
  }
  if (row !== App.simIdx) scrubSim(row);
}

/** What a row is called in the readout: "T2", "Stack", or nothing. */
function trackName(m, t) {
  if (m.trackSpecs) return m.trackSpecs[t].label;
  return m.tapes.length > 1 ? `T${t + 1}` : 'Tape';
}

// ── module state ──────────────────────────────────────────────────

let built = false;
let els = null;
let model = null;
let layout = null;
let layoutKey = '';
let style = null;
let raf = 0;
let hover = null;
let lastPlayhead = -1;
let lastLo = null;
let dragging = false;

let cellPref = readPref(CELL_KEY, 'fit');
let headPath = readPref(PATH_KEY, '1') !== '0';
let overviewPref = readPref(OVERVIEW_KEY, '1') !== '0';

// The overview strip: its model, the pictures built from it, and what the
// last paint of it measured — the pointer handlers read the geometry back.
let overview = null;
let ovGrids = [];
let ovBase = null;
let ovBaseKey = '';
let ovMadeAt = 0;
let ovBuilt = -1;
let ovBuiltAt = 0;
let ovStyleKey = '';
let ovTimer = 0;
let stripOn = false;
let stripGeom = null;
let stripView = null;
let stripDrag = null;

// A traced cell — "who wrote this?" — and what the NDTM's search has to say
// when there is no branch to draw.
let trace = null;
let branchNote = null;

function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* private mode */ }
}

/** Test hook: everything here is module state that would survive a reset. */
export function resetSpaceTime() {
  cancelGlide();
  built = false; els = null; exportWired = false;
  model = null; layout = null; layoutKey = ''; style = null; hover = null;
  overview = null; ovGrids = []; ovBase = null; ovBaseKey = ''; ovMadeAt = 0; ovBuilt = -1; ovBuiltAt = 0; ovStyleKey = '';
  if (ovTimer) { clearTimeout(ovTimer); ovTimer = 0; }
  stripOn = false; stripGeom = null; stripView = null; stripDrag = null;
  wholeCache = null;
  trace = null; branchNote = null;
  lastPlayhead = -1; lastLo = null; dragging = false;
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  raf = 0;
}

// ══════════════════════════════════════════════════════════════════
//  STYLE
// ══════════════════════════════════════════════════════════════════

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "'DM Sans', system-ui, sans-serif";

/**
 * The diagram in the colours of the theme on screen.
 *
 * Read from the CSS variables at paint time rather than kept as a table, so a
 * theme added to js/themes.js is picked up with no entry here. Only the symbol
 * palette is not the theme's: those are identities, and the steps that keep
 * eight of them apart were chosen per mode rather than per theme.
 */
function themeStyle() {
  let cs = null;
  try { cs = getComputedStyle(document.documentElement); } catch (e) { /* test DOM */ }
  const v = (name, fallback) => {
    const got = cs && typeof cs.getPropertyValue === 'function' ? cs.getPropertyValue(name).trim() : '';
    return got || fallback;
  };
  const schemeRaw = (cs && (cs.colorScheme || v('color-scheme', ''))) || 'dark';
  const scheme = String(schemeRaw).includes('light') ? 'light' : 'dark';
  return {
    scheme,
    bg: v('--bg3', scheme === 'light' ? '#ffffff' : '#131928'),
    gutterBg: v('--bg2', scheme === 'light' ? '#f4f6f9' : '#0d1220'),
    rulerBg: v('--bg2', scheme === 'light' ? '#f4f6f9' : '#0d1220'),
    ink: v('--text', scheme === 'light' ? '#16324a' : '#c8d4f0'),
    ink2: v('--text2', '#7a8ab0'),
    ink3: v('--text3', '#4a5878'),
    grid: v('--border', 'rgba(100,130,200,0.12)'),
    rule: v('--border2', 'rgba(100,130,200,0.22)'),
    accent: v('--accent', '#4fc3f7'),
    good: v('--green', '#69f0ae'),
    bad: v('--red', '#ff6b6b'),
    warn: v('--gold', '#ffd54f'),
    wallBg: v('--surface2', '#1c2438'),
    wallInk: v('--border2', 'rgba(100,130,200,0.22)'),
    palette: SYMBOL_PALETTE[scheme],
    other: '#8a8f98',
    mono: MONO,
    sans: SANS
  };
}

function currentStyle() {
  if (!style) style = themeStyle();
  return style;
}

// ══════════════════════════════════════════════════════════════════
//  THE MODEL, AND WHAT IS SAID ABOUT IT
// ══════════════════════════════════════════════════════════════════

/** Σ first, so the input's symbols get the palette's most separable slots. */
function alphabetOrder() {
  const out = [];
  const add = s => { if (s !== undefined && s !== null && !out.includes(s)) out.push(s); };
  if (App.sigma) [...App.sigma].forEach(add);
  if (App.stackAlpha) [...App.stackAlpha].forEach(add);
  return out;
}

function stateName(id) {
  if (id === undefined || id === null) return '';
  return getState(id)?.name ?? String(id);
}

function runComplete() {
  return App.simStopAt != null || runIsComplete();
}

function freshModel() {
  layoutKey = '';
  lastLo = null;
  lastPlayhead = -1;
  trace = null;
}

/** The model for the run on screen, grown to the reachable prefix. */
function syncModel() {
  const steps = App.simSteps;
  const kind = spaceTimeKind();
  branchNote = null;
  if (!kind || !steps || !steps.length) { model = null; return null; }
  if (kind === 'branch') return syncBranchModel(steps);
  if (!model || model.source !== steps || model.kind !== kind) {
    const specs = kind === 'store' ? storeTracks(App.machine) : null;
    model = makeSpaceTime(steps, { alphabet: alphabetOrder(), tracks: specs || undefined });
    model.source = steps;
    model.kind = kind;
    model.trackSpecs = specs;
    freshModel();
  }
  model.extend(reachableCount());
  return model.supported && model.rows ? model : null;
}

/**
 * An NDTM's accepting branch, once there is one. Until the search finishes
 * there is nothing to draw — a branch not yet found cannot be told from one
 * that never will be — and a search that ends without accepting has no single
 * computation to show at all. `branchNote` says which of those it is.
 */
function syncBranchModel(steps) {
  if (!runComplete()) { model = null; branchNote = 'searching'; return null; }
  if (!model || model.source !== steps || model.sourceLen !== steps.length) {
    const path = acceptingBranch(steps);
    if (!path) {
      model = null;
      branchNote = steps[steps.length - 1]?.final === 'timeout' ? 'limit' : 'none';
      return null;
    }
    model = makeSpaceTime(path.steps, { alphabet: alphabetOrder() });
    model.source = steps;
    model.sourceLen = steps.length;
    model.kind = 'branch';
    model.branch = path;
    model.trackSpecs = null;
    freshModel();
  }
  model.extend(model.steps.length);
  return model.supported && model.rows ? model : null;
}

function tapeLabels(m) {
  if (m.trackSpecs) {
    return m.trackSpecs.map((spec, i) => {
      if (spec.say) return `${spec.label} · ${spec.say}`;
      const n = m.tapes[i].hi - m.tapes[i].lo + 1;
      return spec.label === 'Input' ? `Input · |w| = ${m.rows ? (m.steps[0].tokens || []).length : n}` : spec.label;
    });
  }
  const multi = m.tapes.length > 1;
  return m.tapes.map((t, i) => {
    const say = tapeModelSay({
      leftBound: t.leftBound, rightBound: t.rightBound, readOnly: t.readOnly, markers: t.markers
    });
    const name = multi ? `T${i + 1}` : 'Tape';
    return say && say.badge ? `${name} · ${say.badge}` : name;
  });
}

function verdictOf(m) {
  if (!m || !runComplete()) return null;
  return FINAL_SAY[m.finalAt(m.rows - 1)] || null;
}

/** "TM · input 1011+11 · ACCEPT after 42 steps", for captions and the footer. */
function runSummary(m) {
  const cfg = getMachineConfig(App.machine);
  const word = App.simInput === null || App.simInput === undefined ? '' : String(App.simInput);
  const steps = m.rows - 1;
  const fin = verdictOf(m);
  let ending = fin
    ? `${fin.text} after ${steps.toLocaleString()} step${steps === 1 ? '' : 's'}`
    : `${m.rows.toLocaleString()} steps so far`;
  if (m.kind === 'branch') {
    ending = `accepting branch of ${steps.toLocaleString()} step${steps === 1 ? '' : 's'}, found after exploring ${m.branch.explored.toLocaleString()} configurations`;
  }
  return `${cfg?.label || App.machine} · input "${word || App.config.sym.eps}" · ${ending}`;
}

function captionTitle() {
  return (App.meta && App.meta.title) || exportBaseName().replace(/-/g, ' ');
}

// ══════════════════════════════════════════════════════════════════
//  BUILDING THE SECTION
// ══════════════════════════════════════════════════════════════════

const ICON_MINUS = '<svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128Z"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></svg>';
const ICON_FIT = '<svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM88,40H48a8,8,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z"/></svg>';
const ICON_PATH = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M5 1.5 L10 5 L6 8.5 L11 12 L8 14.5"/></svg>';
const ICON_OVERVIEW = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2"/><path d="M10.25 1.75v12.5"/><rect x="11.35" y="4.6" width="1.8" height="3.6" rx=".6" fill="currentColor" stroke="none"/></svg>';
const ICON_EXPORT = '<svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor"><path d="M224,152v56a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V152a8,8,0,0,1,16,0v56H208V152a8,8,0,0,1,16,0ZM93.66,85.66,120,59.31V152a8,8,0,0,0,16,0V59.31l26.34,26.35a8,8,0,0,0,11.32-11.32l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,93.66,85.66Z"/></svg>';

/** The glyph on the tracker's button: a grid with a head's path through it. */
export const SPACETIME_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor">'
  + '<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" stroke-width="1.3"/>'
  + '<path d="M1.75 6h12.5M1.75 10h12.5M6 1.75v12.5M10 1.75v12.5" stroke-width=".8" opacity=".5"/>'
  + '<path d="M4 3.8 8 8 5.2 12.2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function button(cls, act, html, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset.act = act;
  b.innerHTML = html;
  if (label) {
    b.setAttribute('aria-label', label);
    b.setAttribute('data-tip', label);
  }
  return b;
}

function ensureBuilt() {
  if (built) return !!els;
  const body = $('st-body');
  if (!body || typeof body.appendChild !== 'function') return false;
  built = true;
  // A body that already has content was built by an earlier copy of this
  // module — a hot reload in development. Taking it over would mean adopting
  // nodes wired to the old copy's state, so it is cleared and built fresh.
  if (typeof body.replaceChildren === 'function') body.replaceChildren();

  const toolbar = document.createElement('div');
  toolbar.className = 'st-toolbar';

  const zoom = document.createElement('div');
  zoom.className = 'st-zoom';
  zoom.setAttribute('role', 'group');
  zoom.setAttribute('aria-label', 'Zoom');
  const zoomOut = button('st-tbtn', 'zoom-out', ICON_MINUS, 'Zoom out');
  const zoomVal = document.createElement('span');
  zoomVal.className = 'st-zoom-val';
  zoomVal.setAttribute('aria-live', 'polite');
  const zoomIn = button('st-tbtn', 'zoom-in', ICON_PLUS, 'Zoom in');
  const fit = button('st-tbtn', 'fit', ICON_FIT, 'Fit the tape to the width');
  zoom.append(zoomOut, zoomVal, zoomIn, fit);

  const path = button('st-tbtn st-toggle', 'path', ICON_PATH + '<span>Head</span>', 'Draw the head’s path');
  const ovBtn = button('st-tbtn st-toggle', 'overview', ICON_OVERVIEW + '<span>Overview</span>',
    'Overview of the whole run — shown beside the diagram once the run is taller than two screens');
  const grow = document.createElement('span');
  grow.className = 'st-grow';
  const exp = button('st-tbtn st-tbtn-label', 'export', ICON_EXPORT + '<span>Export</span>', 'Export as PNG, SVG, text or CSV');
  toolbar.append(zoom, path, ovBtn, grow, exp);

  const view = document.createElement('div');
  view.className = 'st-view';
  view.tabIndex = 0;
  view.setAttribute('role', 'img');
  view.setAttribute('aria-label', 'Space-time diagram. Up and down step through the run; plus and minus zoom.');
  const scroll = document.createElement('div');
  scroll.className = 'st-scroll';
  const size = document.createElement('div');
  size.className = 'st-size';
  scroll.appendChild(size);
  const canvas = document.createElement('canvas');
  canvas.className = 'st-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('div');
  tip.className = 'st-tip';
  tip.hidden = true;
  const empty = document.createElement('div');
  empty.className = 'st-empty';
  // The overview: a canvas of its own down the right edge, where a scrollbar
  // would be — it is the better scrollbar. Hidden until the run is long enough
  // for a map to be worth the width.
  const strip = document.createElement('canvas');
  strip.className = 'st-ov';
  strip.hidden = true;
  strip.setAttribute('role', 'scrollbar');
  strip.setAttribute('aria-orientation', 'vertical');
  strip.setAttribute('aria-label', 'Overview of the whole run. Click to go there; double-click to move the playhead there.');
  view.append(scroll, canvas, strip, tip, empty);

  const foot = document.createElement('div');
  foot.className = 'st-foot';
  const legend = document.createElement('div');
  legend.className = 'st-legend';
  const meta = document.createElement('div');
  meta.className = 'st-meta';
  const more = button('st-more', 'more', 'Compute the rest', 'Compute the rest of the run without moving the playhead');
  more.hidden = true;
  foot.append(legend, meta, more);

  // "Who wrote this?" — a line between the diagram and its legend, present
  // only while a cell is being traced.
  const traceBar = document.createElement('div');
  traceBar.className = 'st-trace';
  traceBar.hidden = true;
  traceBar.setAttribute('role', 'status');
  traceBar.addEventListener('click', onTraceClick);

  body.append(toolbar, view, traceBar, foot);
  els = { body, toolbar, zoomOut, zoomVal, zoomIn, fit, path, ovBtn, exp, view, scroll, size, canvas, strip, tip, empty, traceBar, foot, legend, meta, more };

  toolbar.addEventListener('click', onToolbarClick);
  more.addEventListener('click', () => {
    if (computeRestOfRun()) showStatus('Computing the rest of the run…');
  });
  scroll.addEventListener('scroll', () => { hideTip(); requestPaint(); }, { passive: true });
  scroll.addEventListener('pointerdown', onPointerDown);
  scroll.addEventListener('pointermove', onPointerMove);
  scroll.addEventListener('pointerup', onPointerUp);
  scroll.addEventListener('pointercancel', onPointerUp);
  scroll.addEventListener('pointerleave', () => { if (!dragging) { hover = null; hideTip(); requestPaint(); } });
  scroll.addEventListener('wheel', onWheel, { passive: false });
  // A reader who takes hold of the diagram has it; a glide in flight lets go.
  scroll.addEventListener('pointerdown', cancelGlide, { capture: true });
  view.addEventListener('keydown', onKeyDown);
  strip.addEventListener('pointerdown', onStripDown);
  strip.addEventListener('pointermove', onStripMove);
  strip.addEventListener('pointerup', onStripUp);
  strip.addEventListener('pointercancel', onStripUp);
  strip.addEventListener('pointerleave', () => { if (!stripDrag) hideTip(); });
  strip.addEventListener('dblclick', onStripDoubleClick);
  strip.addEventListener('wheel', onStripWheel, { passive: false });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { layoutKey = ''; requestPaint(); }).observe(view);
  }
  // A theme change repaints the page from CSS; the canvas has to be told.
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => { style = null; requestPaint(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }
  syncToolbar();
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  VISIBILITY
// ══════════════════════════════════════════════════════════════════

/**
 * Shows the section on the machines that have a tape and hides it on the
 * rest — the same rule `applyMachineSwitch` applies to the stack and output
 * sections, and like them it works unchanged on a section that is floating,
 * so the window's place is kept across a DFA→TM→DFA round trip.
 */
export function syncSpaceTimeSection() {
  const el = $(SPACETIME_SECTION);
  if (!el || !el.style) return;
  const want = spaceTimeKind() ? '' : 'none';
  if (el.style.display === want) return;
  el.style.display = want;
  syncPanelEmpty('rpanel');
  if (want === '') refreshSpaceTime();
}

subscribe(Change.GRAPH, syncSpaceTimeSection);

function sectionShowing() {
  const el = $(SPACETIME_SECTION);
  if (!el || !els) return false;
  if (el.style && el.style.display === 'none') return false;
  if (el.classList && el.classList.contains('collapsed')) return false;
  return (els.scroll.clientHeight || 0) > 0;
}

/**
 * Open the diagram: out of the panel and into a window where windows are
 * available, expanded, raised and focused.
 *
 * The first window is placed rather than popped from the panel's own size —
 * a strip the width of the sidebar is not what anyone opening a diagram of a
 * whole run is asking for.
 */
export function openSpaceTime() {
  const el = $(SPACETIME_SECTION);
  if (!el) return;
  ensureBuilt();
  el.style.display = '';
  if (el.classList.contains('collapsed')) setRPSectionCollapsed(SPACETIME_SECTION, false, true);
  if (floatingEnabled() && !isSectionFloating(SPACETIME_SECTION)) {
    const r = floatLayerRect();
    let geom;
    if (r && r.width > 0 && r.height > 0) {
      const w = Math.round(Math.min(760, Math.max(420, r.width * 0.52)));
      const h = Math.round(Math.min(600, Math.max(320, r.height * 0.7)));
      geom = { x: Math.max(16, Math.round(r.width - w - 24)), y: 20, w, h };
    }
    floatSection(SPACETIME_SECTION, geom);
  } else if (!isSectionFloating(SPACETIME_SECTION) && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest' });
  }
  raiseFloat(el);
  layoutKey = '';
  lastPlayhead = -1;
  requestPaint();
  if (els && typeof els.view.focus === 'function') {
    try { els.view.focus({ preventScroll: true }); } catch (e) { els.view.focus(); }
  }
}

// ══════════════════════════════════════════════════════════════════
//  PAINTING
// ══════════════════════════════════════════════════════════════════

/**
 * The player moved, or the run changed. Called from `renderSimStep` and
 * `resetSim`; coalesced to one paint a frame, because playback at 5× and a
 * drain of five hundred steps a slice both call it far more often than that.
 */
export function refreshSpaceTime() {
  if (!built && !$('st-body')) return;
  ensureBuilt();
  requestPaint();
}

function requestPaint() {
  if (!els) return;
  if (raf) return;
  if (typeof requestAnimationFrame !== 'function') { paint(); return; }
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

/** The cell size in use: a number, or the one "fit" works out. */
function resolveCell(m, width) {
  if (cellPref !== 'fit') {
    const n = Number(cellPref);
    return CELL_SIZES.includes(n) ? n : 8;
  }
  const avail = Math.max(60, width);
  for (let i = CELL_SIZES.length - 1; i >= 0; i--) {
    const c = CELL_SIZES[i];
    if (c > FIT_MAX) continue;
    const L = spaceTimeLayout(m, { cell: c, stateName, tapeLabels: tapeLabels(m), complete: runComplete() });
    if (L.width <= avail) return c;
  }
  return CELL_SIZES[0];
}

function syncLayout(m, vw) {
  const complete = runComplete();
  const cell = resolveCell(m, vw);
  const key = `${m.rows}|${m.version}|${cell}|${complete}|${m.tapes.length}`;
  if (key !== layoutKey || !layout) {
    layout = spaceTimeLayout(m, { cell, stateName, tapeLabels: tapeLabels(m), complete });
    layoutKey = key;
  }
  return layout;
}

function paint() {
  if (!els) return;
  // Nothing is indexed for a section nobody can see. Playback calls this every
  // tick whether or not the diagram is open; expanding or floating the section
  // resizes the view, and the observer on it brings the paint back.
  const sec = $(SPACETIME_SECTION);
  if (!sec || (sec.style && sec.style.display === 'none') || (sec.classList && sec.classList.contains('collapsed'))) return;
  const m = syncModel();
  renderChrome(m);
  // No run — a reset, a search still going, a machine switched out from under
  // the diagram. The chrome has put up its sentence and hidden the diagram;
  // the strip is a canvas of its own and has to be put away with it, or it
  // goes on showing the run that was reset.
  if (!m) { dropStrip(); return; }
  if (!sectionShowing()) return;

  const { scroll, canvas, size } = els;
  let vw = scroll.clientWidth;
  const vh = scroll.clientHeight;
  if (!vw || !vh) return;

  const prevCell = layout ? layout.cell : null;
  const prevX = layout && layout.tapes[0] ? layout.tapes[0].x : null;
  let L = syncLayout(m, vw);
  // The strip takes width from the diagram, which under "fit" can change the
  // cell size, which changes how tall the diagram is — so the test has two
  // thresholds, or a diagram near the line would flicker the strip on and off.
  const wantStrip = overviewPref && stripWorthIt(L, vh);
  if (wantStrip !== stripOn || (stripOn && els.strip.style.width !== stripWidth(m) + 'px')) {
    setStrip(wantStrip, m);
    vw = scroll.clientWidth;
    L = syncLayout(m, vw);
  }
  size.style.width = L.width + 'px';
  size.style.height = L.height + 'px';
  fitViewTo(L);
  // Here rather than in renderChrome, which runs before the first layout
  // exists: the readout would otherwise stay blank until the next repaint.
  els.zoomVal.textContent = `${L.cell}px${cellPref === 'fit' ? ' · fit' : ''}`;

  // A two-way tape that grew leftward moved every column right by what it
  // grew. Scroll by the same amount, or the diagram slides under the reader.
  const lo = m.tapes[0].lo;
  if (lastLo !== null && lo < lastLo && prevCell === L.cell) {
    scroll.scrollLeft += (lastLo - lo) * L.cell;
  } else if (prevX !== null && prevCell === L.cell && L.tapes[0] && L.tapes[0].x !== prevX && lastLo === lo) {
    scroll.scrollLeft += L.tapes[0].x - prevX;
  }
  lastLo = lo;

  follow(m, L, vw, vh);

  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  const pw = Math.round(vw * dpr);
  const ph = Math.round(vh * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  // Scroll offsets are fractional on a high-density screen or a zoomed page;
  // snapped, every cell edge lands on a device pixel instead of between two.
  const snap = v => Math.round(v * dpr) / dpr;
  paintSpaceTime(ctx, m, L, currentStyle(), {
    sx: snap(scroll.scrollLeft),
    sy: snap(scroll.scrollTop),
    vw,
    vh,
    playhead: playheadRow(),
    hover,
    headPath,
    trace: traceMark(),
    clip: true
  });
  if (stripOn) paintStrip(m, L, vw, vh);
}

/**
 * Tells a window how tall the diagram is.
 *
 * The view is a scroll viewport — everything in it is absolutely placed — so
 * it has no height of its own, and a window fitting its content had nothing to
 * fit: a six-step run drew six rows at the top of a view the height of the
 * window. `--st-fit` is the diagram's height plus the view's own frame and a
 * horizontal scrollbar when there is one, which the stylesheet reads only for
 * a floating section. Docked, the view keeps its fixed strip.
 *
 * Written only when it changes: the observer on the view repaints on a resize,
 * and a write per paint would be a layout per frame of playback.
 */
function fitViewTo(L) {
  const { view, scroll } = els;
  const frame = (view.offsetHeight || 0) - (view.clientHeight || 0);
  const bar = (scroll.offsetHeight || 0) - (scroll.clientHeight || 0);
  const h = Math.ceil(L.height + Math.max(0, frame) + Math.max(0, bar));
  const value = h + 'px';
  if (view.style.getPropertyValue && view.style.getPropertyValue('--st-fit') === value) return;
  if (view.style.setProperty) view.style.setProperty('--st-fit', value);
}

// ══════════════════════════════════════════════════════════════════
//  THE OVERVIEW STRIP
// ══════════════════════════════════════════════════════════════════
//  The whole run in the height of the window: symbol colour averaged into
//  bins, the head's path through them, a box for what the diagram shows and
//  the playhead as a line. js/spacetime.js builds and draws it; this is when,
//  where, and what a press on it means.

function stripWidth(m) {
  return Math.round(Math.min(124, 60 + 16 * ((m.tapes ? m.tapes.length : 1) - 1)));
}

function stripWorthIt(L, vh) {
  const ratio = (L.height - L.top) / Math.max(1, vh - L.top);
  return stripOn ? ratio > 1.5 : ratio > 2;
}

/**
 * Put the strip away and forget what it was built from. The overview and its
 * picture belong to one run; kept past it they are memory holding a diagram
 * nothing will show again, and a strip left visible is that diagram on screen.
 */
function dropStrip() {
  if (ovTimer) { clearTimeout(ovTimer); ovTimer = 0; }
  overview = null;
  ovGrids = [];
  ovBuilt = -1;
  ovBaseKey = '';
  stripGeom = null;
  stripView = null;
  stripDrag = null;
  if (!els) return;
  // Hidden from what is on the page, not from the flag: if the two ever
  // disagree, a strip left showing is the one outcome worth ruling out.
  els.strip.hidden = true;
  els.scroll.style.right = '';
  if (stripOn) layoutKey = '';
  stripOn = false;
}

function setStrip(on, m) {
  stripOn = on;
  const w = stripWidth(m);
  els.strip.hidden = !on;
  els.strip.style.width = w + 'px';
  els.scroll.style.right = on ? w + 'px' : '';
  layoutKey = '';
  if (!on) { stripGeom = null; stripView = null; }
}

/**
 * The bin counts that fit this strip: never more bins than device pixels, in
 * either direction, or the per-pixel sampling would have to drop some. Even,
 * because time bins merge in pairs.
 */
function stripBins(m, W, H, dpr) {
  const k = Math.max(1, m.tapes.length);
  const tw = Math.max(6, Math.floor((W - 12 - 4 * (k - 1)) / k));
  return {
    binsX: Math.max(8, Math.floor(tw * dpr)),
    binsY: Math.max(64, Math.floor(Math.max(10, H - 12) * dpr)) & ~1
  };
}

function gridCanvas(grid, colors) {
  const img = overviewImage(grid, colors);
  const c = document.createElement('canvas');
  c.width = Math.max(1, img.width);
  c.height = Math.max(1, img.height);
  const cx = typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (cx && typeof ImageData === 'function' && img.width && img.height) {
    cx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  }
  return c;
}

/**
 * Bring the strip's pictures up to date. While a run streams in, at most a
 * few times a second: a paint per playback tick would rebuild pictures that
 * differ by one row, and nobody can see that.
 */
function syncStripImages(m, S, complete, W, H, dpr) {
  // Sized to the strip. A resize changes the size wanted, and a rebuild is a
  // pass over the whole run — cheap, but not every frame of a window drag, so
  // it waits for the size to settle and the old picture stands in meanwhile.
  const want = stripBins(m, W, H, dpr);
  const now = Date.now();
  const fits = overview && overview.model === m && overview.BY === want.binsY && overview.binsX === want.binsX;
  if (!overview || overview.model !== m || (!fits && now - ovMadeAt > 150)) {
    overview = makeOverview(m, want);
    ovMadeAt = now;
    ovBuilt = -1;
  } else if (!fits && !ovTimer) {
    ovTimer = setTimeout(() => { ovTimer = 0; requestPaint(); }, 160);
  }
  overview.extend();
  const key = `${S.scheme}|${S.bg}`;
  if (overview.version === ovBuilt && key === ovStyleKey) return;
  if (!complete && ovBuilt >= 0 && key === ovStyleKey && now - ovBuiltAt < 120) {
    if (!ovTimer) ovTimer = setTimeout(() => { ovTimer = 0; requestPaint(); }, 130);
    return;
  }
  ovGrids = m.tapes.map((_, t) => overviewGrid(overview, t));
  ovBuilt = overview.version;
  ovBuiltAt = now;
  ovStyleKey = key;
  ovBaseKey = '';
}

/** The strip's still picture, rebuilt only when what it shows has changed. */
function stripBase(S, G, dpr, complete) {
  const key = `${ovBuilt}|${ovStyleKey}|${G.W}|${G.H}|${dpr}|${complete}|${headPath}|${G.scaleRows}`;
  if (ovBase && key === ovBaseKey) return ovBase;
  if (!ovBase) ovBase = document.createElement('canvas');
  ovBase.width = Math.round(G.W * dpr);
  ovBase.height = Math.round(G.H * dpr);
  const bctx = typeof ovBase.getContext === 'function' ? ovBase.getContext('2d', { willReadFrequently: true }) : null;
  if (!bctx) return null;
  renderOverviewBase(bctx, ovGrids, overviewColors(S), S, G, dpr, { headPath });
  ovBaseKey = key;
  return ovBase;
}

/** The rows and, per tape, the cells the diagram is showing. */
function visibleRange(m, L, vw, vh) {
  const { scroll } = els;
  const sx = scroll.scrollLeft;
  const sy = scroll.scrollTop;
  const last = Math.max(0, m.rows - 1);
  const row0 = Math.max(0, Math.min(last, L.rowFrom + Math.floor(sy / L.cell)));
  const row1 = Math.max(row0, Math.min(last, L.rowFrom + Math.floor((sy + vh - L.top) / L.cell)));
  const cols = L.tapes.map(e => {
    const c0 = Math.max(e.lo, e.lo + Math.floor((L.gutterW + sx - e.x) / L.cell));
    const c1 = Math.min(e.hi, e.lo + Math.floor((sx + vw - e.x) / L.cell));
    return c0 <= c1 ? [c0, c1] : null;
  });
  return { row0, row1, cols };
}

/** A loop's span, a block's boundary, and how the run ended. */
function stripMarks(m, complete) {
  const marks = [];
  const last = m.rows - 1;
  const step = m.steps[last];
  if (complete && step && typeof step.loopFrom === 'number') marks.push({ from: step.loopFrom, to: last, tone: 'warn' });
  if (m.kind !== 'branch') {
    if (App.simPauseAt != null && App.simPauseAt <= last) marks.push({ from: App.simPauseAt, to: App.simPauseAt, tone: 'accent' });
    if (App.simStopAt != null && App.simStopAt <= last) marks.push({ from: App.simStopAt, to: App.simStopAt, tone: 'accent' });
  }
  const fin = verdictOf(m);
  if (fin) marks.push({ from: last, to: last, tone: fin.tone });
  return marks;
}

function paintStrip(m, L, vw, vh) {
  const S = currentStyle();
  const complete = runComplete();
  const { strip } = els;
  const W = stripWidth(m);
  const H = vh;
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  syncStripImages(m, S, complete, W, H, dpr);
  if (strip.width !== Math.round(W * dpr)) strip.width = Math.round(W * dpr);
  if (strip.height !== Math.round(H * dpr)) strip.height = Math.round(H * dpr);
  strip.style.height = H + 'px';
  const ctx = typeof strip.getContext === 'function' ? strip.getContext('2d') : null;
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const G = overviewGeometry(overview, W, H, complete);
  stripGeom = G;
  stripView = visibleRange(m, L, vw, vh);
  paintOverviewStrip(ctx, overview, stripBase(S, G, dpr, complete), S, G, {
    complete,
    view: stripView,
    playhead: playheadRow(),
    marks: stripMarks(m, complete)
  });
  strip.setAttribute('aria-valuemin', '0');
  strip.setAttribute('aria-valuemax', String(m.rows - 1));
  strip.setAttribute('aria-valuenow', String(stripView.row0));
}

function stripPoint(e) {
  const r = els.strip.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Put a row (and, given one, a cell of a tape) in the middle of the diagram. */
function centerOn(row, tape, cell, smooth) {
  const L = layout;
  if (!L) return;
  const sc = els.scroll;
  const vh = sc.clientHeight;
  const vw = sc.clientWidth;
  const ty = (row - L.rowFrom) * L.cell - (vh - L.top) / 2 + L.cell / 2;
  let tx = sc.scrollLeft;
  const e = tape !== null && tape !== undefined ? L.tapes[tape] : null;
  if (e && cell !== null && cell !== undefined) {
    tx = e.x + (cell - e.lo) * L.cell - L.gutterW - (vw - L.gutterW) / 2 + L.cell / 2;
  }
  if (smooth) glideTo(tx, ty);
  else {
    cancelGlide();
    sc.scrollLeft = Math.max(0, tx);
    sc.scrollTop = Math.max(0, ty);
  }
}

function stripHit(p) {
  const G = stripGeom;
  if (!G || !G.rows) return null;
  const row = G.rowAt(p.y);
  const tape = G.tapeAt(p.x);
  return { row, tape: tape ? tape.t : null, cell: tape ? G.cellAt(tape, p.x) : null };
}

function onStripDown(e) {
  if (e.button !== 0) return;
  const hit = stripHit(stripPoint(e));
  if (!hit) return;
  e.preventDefault();
  hideTip();
  // Pressing inside the box picks it up where it was pressed, so dragging it
  // does not first jump it to centre on the pointer; pressing anywhere else
  // goes there.
  const v = stripView;
  const inBox = v && hit.row >= v.row0 && hit.row <= v.row1;
  const cols = v && hit.tape !== null ? v.cols[hit.tape] : null;
  const grab = {
    dRow: inBox ? hit.row - (v.row0 + v.row1) / 2 : 0,
    dCell: inBox && cols && hit.cell !== null ? hit.cell - (cols[0] + cols[1]) / 2 : 0
  };
  if (!inBox) centerOn(hit.row, hit.tape, hit.cell, true);
  stripDrag = { id: e.pointerId, grab, moved: false };
  try { els.strip.setPointerCapture(e.pointerId); } catch (err) { /* stub */ }
}

function onStripMove(e) {
  const p = stripPoint(e);
  const hit = stripHit(p);
  if (stripDrag && e.pointerId === stripDrag.id) {
    if (!hit) return;
    stripDrag.moved = true;
    const cell = hit.cell !== null ? Math.round(hit.cell - stripDrag.grab.dCell) : null;
    centerOn(Math.round(hit.row - stripDrag.grab.dRow), hit.tape, cell, false);
    return;
  }
  if (!hit || !model) { hideTip(); return; }
  const { tip, view } = els;
  tip.innerHTML = `<div><b>step ${hit.row.toLocaleString()}</b><span class="st-tip-st">${escapeText(stateName(model.stateAt(hit.row)))}</span></div>`;
  tip.hidden = false;
  const w = tip.offsetWidth || 120;
  const vw = view.clientWidth || 0;
  const x = Math.max(4, vw - stripWidth(model) - w - 8);
  const y = Math.max(4, Math.min((view.clientHeight || 0) - 40, p.y - 12));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function onStripUp(e) {
  if (!stripDrag || e.pointerId !== stripDrag.id) return;
  stripDrag = null;
  try { els.strip.releasePointerCapture(e.pointerId); } catch (err) { /* stub */ }
}

function onStripDoubleClick(e) {
  const hit = stripHit(stripPoint(e));
  if (hit) scrubToRow(hit.row);
}

function onStripWheel(e) {
  // The strip is a map, not a place to scroll to: the wheel over it moves the
  // diagram, a screen at a time the way it would over the diagram itself.
  e.preventDefault();
  cancelGlide();
  els.scroll.scrollTop += e.deltaY;
  els.scroll.scrollLeft += e.deltaX;
}

/**
 * Keep the step on screen in view, and the head in it.
 *
 * Only when the playhead has *moved* — a reader who scrolled away to look at
 * step 3 while paused must not be dragged back by a repaint — and not while
 * they are dragging through the rows, where the row is under their pointer
 * by construction.
 */
function follow(m, L, vw, vh) {
  const idx = playheadRow();
  if (idx === lastPlayhead || dragging) { lastPlayhead = idx; return; }
  lastPlayhead = idx;
  if (idx === null || idx < L.rowFrom || idx > L.rowTo) return;
  const { scroll } = els;
  const bodyH = vh - L.top;
  const rowY = (idx - L.rowFrom) * L.cell;
  const sy = scroll.scrollTop;
  // Judged against where a glide in flight is *going*, not where it has got
  // to, or every tick of fast playback would restart it from mid-air.
  const cur = glideTarget();
  const margin = Math.min(L.cell * 2, bodyH / 4);
  let ty = cur.y;
  let tx = cur.x;
  if (rowY < cur.y + margin || rowY + L.cell > cur.y + bodyH - margin) {
    ty = Math.max(0, rowY - bodyH * 0.4);
  }
  const e = L.tapes[0];
  const h = m.headAt(0, idx);
  if (e && h !== null) {
    const hx = e.x + (h - e.lo) * L.cell;
    const pad = Math.min(L.cell * 3, (vw - L.gutterW) / 4);
    if (hx < cur.x + L.gutterW + pad || hx + L.cell > cur.x + vw - pad) {
      tx = Math.max(0, hx - L.gutterW - (vw - L.gutterW) / 2);
    }
  }
  if (tx !== cur.x || ty !== cur.y) glideTo(tx, ty);
}

// ── the glide ─────────────────────────────────────────────────────
//  Following the playhead eases rather than jumps: at 1× a row leaving the
//  band every few seconds and the whole diagram snapping under the reader
//  is exactly the kind of motion that loses their place. Short, so it keeps
//  up with 5× playback; skipped outright under reduced motion, and for a
//  jump of several screens, where a glide is only a blur on the way.

const GLIDE_MS = 200;
let glide = null;

function motionOk() {
  try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
}

function glideTarget() {
  const { scroll } = els;
  return glide ? { x: glide.tx, y: glide.ty } : { x: scroll.scrollLeft, y: scroll.scrollTop };
}

export function cancelGlide() {
  if (!glide) return;
  if (glide.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(glide.raf);
  glide = null;
}

function glideTo(x, y) {
  const { scroll } = els;
  const maxX = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  const maxY = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const tx = Math.max(0, Math.min(maxX, x));
  const ty = Math.max(0, Math.min(maxY, y));
  cancelGlide();
  const far = Math.abs(ty - scroll.scrollTop) > scroll.clientHeight * 3
    || Math.abs(tx - scroll.scrollLeft) > scroll.clientWidth * 3;
  if (far || !motionOk() || typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') {
    scroll.scrollLeft = tx;
    scroll.scrollTop = ty;
    return;
  }
  const g = { fx: scroll.scrollLeft, fy: scroll.scrollTop, tx, ty, t0: performance.now(), raf: 0 };
  glide = g;
  const tick = now => {
    if (glide !== g) return;
    const p = Math.min(1, (now - g.t0) / GLIDE_MS);
    const k = 1 - Math.pow(1 - p, 3);
    scroll.scrollLeft = g.fx + (g.tx - g.fx) * k;
    scroll.scrollTop = g.fy + (g.ty - g.fy) * k;
    if (p < 1) g.raf = requestAnimationFrame(tick);
    else glide = null;
  };
  g.raf = requestAnimationFrame(tick);
}

// ── the chrome around the canvas ──────────────────────────────────

function renderChrome(m) {
  const { empty, legend, meta, more, zoomVal } = els;
  const kind = spaceTimeKind();
  let message = '';
  if (!m) {
    if (branchNote === 'searching') {
      message = 'The search is still running. A nondeterministic run is a tree, so there is no one timeline to draw until a branch accepts — then that branch is drawn, step by step.';
    } else if (branchNote === 'none') {
      message = `No branch accepted. Every branch halted without accepting, so there is no single computation to draw — ${(App.simSteps || []).length.toLocaleString()} configurations were explored.`;
    } else if (branchNote === 'limit') {
      message = 'The search reached its limit before any branch accepted, so there is no accepting branch to draw. Raise the step budget in Settings › Turing to search further.';
    } else if (kind === 'branch') {
      message = 'Run a word to search for an accepting branch. When one is found, the diagram draws that branch: the computation that accepted, one row per step.';
    } else if (kind === 'store') {
      message = 'Run a word to draw its space-time diagram: the input and the store, one row per step. The store’s top is its head, so the head’s path is its height over time.';
    } else {
      message = 'Run a word to draw its space-time diagram: every configuration of the tape, one row per step, with the head’s path through them.';
    }
  }
  empty.textContent = message;
  empty.hidden = !message;
  els.scroll.hidden = !!message;
  els.canvas.hidden = !!message;
  els.exp.disabled = !m;
  els.toolbar.classList.toggle('is-idle', !m);
  els.view.classList.toggle('is-idle', !!message);

  if (!m) {
    legend.innerHTML = '';
    legend.dataset.key = '';
    meta.textContent = '';
    more.hidden = branchNote !== 'searching';
    // A row with nothing in it is still a row, and under the sentence it was
    // a strip of blank at the foot of the window.
    els.foot.hidden = more.hidden;
    zoomVal.textContent = '—';
    renderTraceBar();
    return;
  }
  els.foot.hidden = false;

  // The legend is always there: past the third symbol colour alone does not
  // keep them apart for every reader, and below the glyph size the cells do
  // not print what they hold.
  const S = currentStyle();
  const key = m.symbols.join('\u0000') + '|' + S.scheme;
  if (legend.dataset.key !== key) {
    legend.dataset.key = key;
    legend.innerHTML = '';
    for (const sym of m.symbols) {
      const slot = m.slotOf(sym);
      const chip = document.createElement('span');
      chip.className = 'st-chip';
      const sw = document.createElement('i');
      sw.style.background = slot < 8 ? S.palette[slot] : S.other;
      const t = document.createElement('span');
      t.textContent = sym;
      chip.append(sw, t);
      legend.appendChild(chip);
    }
    if (!m.symbols.length) {
      const none = document.createElement('span');
      none.className = 'st-chip is-none';
      none.textContent = 'blank tape';
      legend.appendChild(none);
    }
  }

  const complete = runComplete();
  const fin = verdictOf(m);
  const cols = m.tapes.map(t => `${t.lo}…${t.hi}`).join(' · ');
  meta.textContent = m.kind === 'branch'
    ? `accepting branch · ${m.rows.toLocaleString()} rows · found after ${m.branch.explored.toLocaleString()} configurations`
      + (playheadRow() === null ? ' · the player is on a branch not drawn here' : '')
    : `${m.rows.toLocaleString()} ${m.rows === 1 ? 'row' : 'rows'}${complete ? '' : '+'} · ${m.kind === 'store' ? 'extent' : 'cells'} ${cols}`
      + (fin ? ` · ${fin.text}` : '');
  meta.className = 'st-meta' + (fin ? ` is-${fin.tone}` : '');
  more.hidden = complete;
}

function syncToolbar() {
  if (!els) return;
  els.path.classList.toggle('on', headPath);
  els.path.setAttribute('aria-pressed', headPath ? 'true' : 'false');
  els.ovBtn.classList.toggle('on', overviewPref);
  els.ovBtn.setAttribute('aria-pressed', overviewPref ? 'true' : 'false');
  els.fit.classList.toggle('on', cellPref === 'fit');
  els.fit.setAttribute('aria-pressed', cellPref === 'fit' ? 'true' : 'false');
}

// ══════════════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════════════

function onToolbarClick(e) {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case 'zoom-in': zoomBy(1); break;
    case 'zoom-out': zoomBy(-1); break;
    case 'fit': setCell('fit'); break;
    case 'path':
      headPath = !headPath;
      writePref(PATH_KEY, headPath ? '1' : '0');
      syncToolbar();
      requestPaint();
      break;
    case 'overview':
      overviewPref = !overviewPref;
      writePref(OVERVIEW_KEY, overviewPref ? '1' : '0');
      syncToolbar();
      layoutKey = '';
      requestPaint();
      break;
    case 'export': openSpaceTimeExport(); break;
  }
}

/**
 * Change the cell size, holding the diagram point under `anchor` still.
 *
 * The anchor is kept as a fraction of a cell from the first tape's origin and
 * the top row, because the gutter changes width as the zoom crosses the size
 * at which state names are printed — a fixed pixel offset would jump.
 */
function setCell(next, anchor) {
  if (!els || !layout) {
    cellPref = String(next);
    writePref(CELL_KEY, cellPref);
    syncToolbar();
    requestPaint();
    return;
  }
  cancelGlide();
  const { scroll } = els;
  const L0 = layout;
  const ax = anchor ? anchor.x : scroll.clientWidth / 2;
  const ay = anchor ? anchor.y : Math.max(L0.top, scroll.clientHeight / 2);
  const e0 = L0.tapes[0];
  const fx = e0 ? (scroll.scrollLeft + ax - e0.x) / L0.cell : 0;
  const fy = (scroll.scrollTop + ay - L0.top) / L0.cell;

  cellPref = String(next);
  writePref(CELL_KEY, cellPref);
  syncToolbar();
  layoutKey = '';
  const m = syncModel();
  if (!m) { requestPaint(); return; }
  const L = syncLayout(m, scroll.clientWidth);
  els.size.style.width = L.width + 'px';
  els.size.style.height = L.height + 'px';
  const e = L.tapes[0];
  if (e) scroll.scrollLeft = Math.max(0, fx * L.cell + e.x - ax);
  scroll.scrollTop = Math.max(0, fy * L.cell + L.top - ay);
  lastPlayhead = playheadRow();
  requestPaint();
}

function zoomBy(dir, anchor) {
  const cur = layout ? layout.cell : 8;
  let i = CELL_SIZES.indexOf(cur);
  if (i < 0) i = CELL_SIZES.findIndex(c => c >= cur);
  const next = CELL_SIZES[Math.max(0, Math.min(CELL_SIZES.length - 1, i + dir))];
  if (next === cur && cellPref !== 'fit') return;
  setCell(next, anchor);
}

function localPoint(e) {
  const r = els.scroll.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Where a pointer is, in diagram coordinates, allowing for the pinned bands. */
function hitAt(p) {
  if (!layout) return null;
  const { scroll } = els;
  if (p.y < layout.top) return null;
  const x = p.x < layout.gutterW ? p.x : p.x + scroll.scrollLeft;
  const hit = hitSpaceTime(layout, x, p.y + scroll.scrollTop);
  if (!hit) return null;
  if (p.x < layout.gutterW) hit.tape = -1, hit.col = null;
  return hit;
}

function onPointerDown(e) {
  if (e.button !== 0 || !layout) return;
  const p = localPoint(e);
  // Past the right or bottom edge is the scrollbar, which is the scroller's.
  if (p.x >= els.scroll.clientWidth || p.y >= els.scroll.clientHeight) return;
  const hit = hitAt(p);
  if (!hit) return;
  // Alt-click asks who wrote the cell rather than moving the playhead to it.
  if (e.altKey && hit.tape >= 0 && hit.col !== null) {
    e.preventDefault();
    setTrace(hit.tape, hit.col, hit.row);
    return;
  }
  scrubToRow(hit.row);
  // A finger's drag is a scroll — the diagram is taller than any phone — so
  // touch picks a row on the tap and leaves the gesture to the scroller.
  if (e.pointerType === 'touch') return;
  dragging = true;
  try { els.scroll.setPointerCapture(e.pointerId); } catch (err) { /* stub */ }
  try { els.view.focus({ preventScroll: true }); } catch (err) { els.view.focus(); }
  e.preventDefault();
}

function onPointerMove(e) {
  if (!layout) return;
  const p = localPoint(e);
  const hit = hitAt(p);
  if (dragging) {
    // Dragging scrubs through time; rows past the drawn range clamp to it.
    if (hit) scrubToRow(hit.row);
    else if (p.y >= layout.top) {
      scrubToRow(Math.max(layout.rowFrom, Math.min(layout.rowTo,
        layout.rowFrom + Math.floor((p.y + els.scroll.scrollTop - layout.top) / layout.cell))));
    }
  }
  const prev = hover;
  hover = hit;
  if (!prev || !hit || prev.row !== hit.row || prev.col !== hit.col || prev.tape !== hit.tape) requestPaint();
  showTip(hit, p);
}

function onPointerUp(e) {
  if (!dragging) return;
  dragging = false;
  try { els.scroll.releasePointerCapture(e.pointerId); } catch (err) { /* stub */ }
}

function onWheel(e) {
  cancelGlide();
  // Ctrl/⌘ + wheel zooms, around the pointer — the same gesture as a pinch on
  // a trackpad, which the browser reports as a ctrl-wheel. A plain wheel is
  // the scroller's, and scrolls.
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1 : -1, localPoint(e));
}

function onKeyDown(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  let handled = true;
  const branch = model && model.kind === 'branch';
  const row = playheadRow();
  switch (e.key) {
    case 'ArrowDown': case 'j':
      if (branch) scrubToRow(Math.min(model.rows - 1, row === null ? 0 : row + 1)); else stepFwd();
      break;
    case 'ArrowUp': case 'k':
      if (branch) scrubToRow(Math.max(0, row === null ? 0 : row - 1)); else stepBack();
      break;
    case 'Home': if (branch) scrubToRow(0); else stepToStart(); break;
    case 'End': if (branch) scrubToRow(model.rows - 1); else stepToEnd(); break;
    case 'Escape':
      // Only when there is a trace to drop — otherwise Escape belongs to
      // whatever else in the app answers it.
      if (trace) clearTrace(); else handled = false;
      break;
    case '+': case '=': zoomBy(1); break;
    case '-': case '_': zoomBy(-1); break;
    case '0': setCell('fit'); break;
    default: handled = false;
  }
  if (handled) {
    // The canvas's own shortcuts listen on the document; an arrow here is a
    // step, and must not also nudge whatever states are selected.
    e.preventDefault();
    e.stopPropagation();
  }
}

// ══════════════════════════════════════════════════════════════════
//  WHO WROTE THIS CELL
// ══════════════════════════════════════════════════════════════════
//  Alt-click a cell and the diagram marks every row that wrote it, and the
//  stretch since the write that put its current symbol there; the bar under
//  the diagram names that write — the step, the state it left and the
//  transition it took — and goes there. "Earlier" walks the cell's history
//  back one write at a time. The question debugging a machine keeps asking
//  is "where did this X come from?", and the journal the diagram already
//  reads has the answer.

function setTrace(tape, col, row) {
  if (!model) return;
  trace = { tape, col, row, info: model.lastWrite(tape, row, col) };
  renderTraceBar();
  requestPaint();
}

function clearTrace() {
  trace = null;
  renderTraceBar();
  requestPaint();
}

function traceMark() {
  if (!trace) return null;
  return { tape: trace.tape, col: trace.col, row: trace.row, from: trace.info ? trace.info.row : null };
}

/** "right → left on x → 1, R" — the move out of row `by`. */
function writerSay(m, by) {
  const a = m.steps[by];
  const b = m.steps[by + 1];
  if (!a || !b) return '';
  const tid = b.tid !== undefined && b.tid !== null ? b.tid : b.via;
  const t = tid !== undefined && tid !== null ? getTransition(tid) : null;
  return t ? `${stateName(a.state)} on ${transLabel(t)}, to ${stateName(b.state)}` : `${stateName(a.state)}, to ${stateName(b.state)}`;
}

function renderTraceBar() {
  if (!els) return;
  const bar = els.traceBar;
  if (!trace || !model) { bar.hidden = true; bar.innerHTML = ''; return; }
  const m = model;
  const tr = m.tapes[trace.tape];
  const sym = m.cursor(trace.tape, trace.row, trace.col, trace.col).cells[0];
  const where = `${trackName(m, trace.tape)} ${tr.unit} ${trace.col}`;
  const holds = sym === undefined ? 'is empty' : sym === tr.blank ? 'is blank' : `holds <code>${escapeText(sym)}</code>`;
  let said;
  let go = '';
  let earlier = '';
  if (tr.readOnly) {
    said = 'this row is read-only, so nothing ever wrote it — it is the input';
  } else if (!trace.info) {
    said = sym === undefined || sym === tr.blank
      ? 'nothing has written here since the run began'
      : 'it has held that since the run began — it is part of the input';
  } else {
    const { row, by } = trace.info;
    said = `written at step ${row.toLocaleString()} by <b>${escapeText(writerSay(m, by))}</b>`;
    go = `<button type="button" class="st-trace-btn" data-trace="go">Go to step ${row.toLocaleString()}</button>`;
    earlier = `<button type="button" class="st-trace-btn" data-trace="earlier" data-tip="The write before this one">Earlier</button>`;
  }
  bar.innerHTML = `<span class="st-trace-text"><span class="st-trace-where">${escapeText(where)}</span> ${holds} at step ${trace.row.toLocaleString()} — ${said}.</span>`
    + `<span class="st-trace-actions">${go}${earlier}<button type="button" class="st-trace-x" data-trace="close" aria-label="Stop tracing" data-tip="Stop tracing (Esc)">×</button></span>`;
  bar.hidden = false;
}

function onTraceClick(e) {
  const b = e.target.closest && e.target.closest('[data-trace]');
  if (!b || !trace) return;
  const act = b.dataset.trace;
  if (act === 'close') clearTrace();
  else if (act === 'go' && trace.info) {
    // The row the write first shows on: arriving there highlights, on the
    // state diagram, the transition that made it.
    scrubToRow(trace.info.row);
    lastPlayhead = -1;
  } else if (act === 'earlier' && trace.info) {
    const before = trace.info.by;
    const info = model.lastWrite(trace.tape, before, trace.col);
    if (!info) { showStatus('That was the first write to this cell'); return; }
    trace = { ...trace, row: before, info };
    renderTraceBar();
    scrollRowIntoView(info.row);
    requestPaint();
  }
}

function scrollRowIntoView(row) {
  if (!layout || !els) return;
  const vh = els.scroll.clientHeight;
  const y = (row - layout.rowFrom) * layout.cell;
  const sy = els.scroll.scrollTop;
  if (y < sy || y + layout.cell > sy + vh - layout.top) glideTo(els.scroll.scrollLeft, Math.max(0, y - (vh - layout.top) * 0.4));
}

// ── the hover readout ─────────────────────────────────────────────

function showTip(hit, p) {
  const { tip, view } = els;
  if (!hit || !model || dragging) { hideTip(); return; }
  const parts = [`<div><b>step ${hit.row}</b><span class="st-tip-st">${escapeText(stateName(model.stateAt(hit.row)))}</span></div>`];
  if (hit.tape >= 0 && hit.col !== null) {
    const tr = model.tapes[hit.tape];
    const cur = model.cursor(hit.tape, hit.row, hit.col, hit.col);
    const sym = cur.cells[0];
    const isHead = model.headAt(hit.tape, hit.row) === hit.col;
    const name = model.tapes.length > 1 || model.trackSpecs ? `${trackName(model, hit.tape)} ` : '';
    const shown = sym === undefined ? '<em>empty</em>'
      : sym === tr.blank ? `${escapeText(sym)} <em>blank</em>` : escapeText(sym);
    parts.push(`<div>${escapeText(name)}${tr.unit} ${hit.col}: <code>${shown}</code>${isHead ? ' <i>◂ head</i>' : ''}</div>`);
    if (!tr.readOnly) parts.push('<div class="st-tip-hint">Alt-click: who wrote this</div>');
  }
  tip.innerHTML = parts.join('');
  tip.hidden = false;
  const vw = view.clientWidth || 0;
  const w = tip.offsetWidth || 160;
  const x = Math.min(Math.max(4, p.x + 14), Math.max(4, vw - w - 6));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y + 16)}px)`;
}

function hideTip() {
  if (els && els.tip) els.tip.hidden = true;
}

function escapeText(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════════
//  A dialog of its own rather than an entry in `ExportFormats`: that
//  registry builds from the *machine's* IR, and this is a picture of a
//  *run*. The file is drawn by the same painter as the window, so what is
//  exported is what was on screen — minus the playhead, unless asked.

const MAX_PNG_SIDE = 32000;
const MAX_PNG_AREA = 64e6;
const MAX_SVG_ELEMENTS = 600000;
const MAX_TEXT_CHARS = 60e6;

export const SpaceTimeExportOpts = {
  format: 'png',
  range: 'all',
  from: 0,
  to: 0,
  cell: 'view',
  // 'cells' draws every cell at a size; 'whole' averages the run into one
  // bounded picture — the only way a ten-thousand-step run fits in a file.
  size: 'cells',
  scale: 2,
  colours: 'theme',
  transparent: false,
  caption: true,
  playhead: false
};

registerModal('spacetime-export-modal', {
  dismissOnBackdrop: true,
  submit: () => downloadSpaceTime()
});

let exportWired = false;

function wireExport() {
  if (exportWired) return;
  const body = $('st-export-body');
  const shell = $('spacetime-export-modal');
  if (!body || !shell) return;
  exportWired = true;
  body.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-opt]');
    if (!b || b.tagName === 'INPUT') return;
    setExportOpt(b.dataset.opt, b.dataset.val);
  });
  body.addEventListener('change', e => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.opt) return;
    setExportOpt(t.dataset.opt, t.type === 'checkbox' ? t.checked : t.value);
  });
  shell.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-st-export]');
    if (!b) return;
    const act = b.dataset.stExport;
    if (act === 'cancel') closeModal('spacetime-export-modal');
    else if (act === 'copy') copySpaceTime();
    else if (act === 'download') downloadSpaceTime();
  });
}

export function openSpaceTimeExport() {
  const m = syncModel();
  if (!m) { showStatus('Run a word first — there is no diagram to export yet'); return; }
  wireExport();
  const o = SpaceTimeExportOpts;
  o.from = 0;
  o.to = m.rows - 1;
  if (o.range !== 'all') o.range = 'all';
  // A run too big to draw cell by cell opens on the picture that fits it,
  // rather than on a refusal.
  if ((o.format === 'png' || o.format === 'svg') && o.size === 'cells' && !exportPlan(m).ok) o.size = 'whole';
  renderExportDialog();
  showOverlay('spacetime-export-modal');
}

function setExportOpt(key, value) {
  const o = SpaceTimeExportOpts;
  if (!(key in o)) return;
  if (key === 'scale' || key === 'from' || key === 'to') value = Math.round(Number(value) || 0);
  if (key === 'caption' || key === 'transparent' || key === 'playhead') value = value === true || value === 'true';
  if (key === 'cell' && value !== 'view') value = Number(value);
  o[key] = value;
  if (key === 'from' || key === 'to') o.range = 'span';
  renderExportDialog();
}

function exportCell() {
  const o = SpaceTimeExportOpts;
  if (o.cell !== 'view' && CELL_SIZES.includes(o.cell)) return o.cell;
  return layout ? layout.cell : 8;
}

function exportRange(m) {
  const o = SpaceTimeExportOpts;
  if (o.range === 'all') return [0, m.rows - 1];
  const a = Math.max(0, Math.min(m.rows - 1, o.from));
  const b = Math.max(a, Math.min(m.rows - 1, o.to));
  return [a, b];
}

function exportStyle() {
  const o = SpaceTimeExportOpts;
  const base = o.colours === 'print' ? PRINT_STYLE : currentStyle();
  return o.transparent ? transparentStyle(base) : base;
}

function exportLayout(m) {
  const o = SpaceTimeExportOpts;
  const [from, to] = exportRange(m);
  return spaceTimeLayout(m, {
    cell: exportCell(),
    rowFrom: from,
    rowTo: to,
    stateName,
    tapeLabels: tapeLabels(m),
    complete: runComplete() && to === m.rows - 1,
    caption: o.caption ? { title: captionTitle(), sub: runSummary(m) } : null,
    legend: true
  });
}

function exportText(m, range) {
  const o = SpaceTimeExportOpts;
  const [from, to] = range || exportRange(m);
  const common = {
    rowFrom: from,
    rowTo: to,
    stateName,
    tapeLabels: tapeLabels(m),
    complete: runComplete() && to === m.rows - 1
  };
  if (o.format === 'csv') return spaceTimeCSV(m, common);
  return spaceTimeText(m, o.caption ? { ...common, title: captionTitle(), sub: runSummary(m) } : common);
}

// The whole-run picture is built once per run, range and caption, and its
// images once per colour scheme: the dialog re-plans on every option clicked.
let wholeCache = null;

function wholeRun(m) {
  const o = SpaceTimeExportOpts;
  const [from, to] = exportRange(m);
  const complete = runComplete() && to === m.rows - 1;
  const key = `${m.rows}|${m.version}|${from}|${to}|${o.caption}|${complete}`;
  if (!wholeCache || wholeCache.key !== key || wholeCache.model !== m) {
    const ov = makeOverview(m, { fixed: true, rowFrom: from, rowTo: to, ...wholeRunBins(m, from, to) });
    ov.extend();
    const grids = m.tapes.map((_, t) => overviewGrid(ov, t));
    const EL = wholeRunLayout(grids, {
      caption: o.caption ? { title: captionTitle(), sub: runSummary(m) } : null,
      tapeLabels: tapeLabels(m),
      legend: true,
      rowFrom: from
    });
    wholeCache = { key, model: m, grids, EL, complete, imgs: {} };
  }
  return wholeCache;
}

function wholeImages(whole, S) {
  const key = `${S.scheme}|${S.palette.join()}`;
  if (!whole.imgs[key]) {
    const colors = overviewColors(S);
    whole.imgs[key] = whole.grids.map(g => (g ? gridCanvas(g, colors) : null));
  }
  return whole.imgs[key];
}

function paintWhole(ctx, m, whole, S) {
  paintWholeRun(ctx, m, whole.grids, wholeImages(whole, S), S, whole.EL, {
    headPath, legend: true, complete: whole.complete
  });
}

/** What the chosen output would be, and whether it can be made. */
function exportPlan(m) {
  const o = SpaceTimeExportOpts;
  const [from, to] = exportRange(m);
  const rows = to - from + 1;
  const image = o.format === 'png' || o.format === 'svg';
  if (image && o.size === 'whole') {
    const whole = wholeRun(m);
    const { EL } = whole;
    const k = o.format === 'png' ? o.scale : 1;
    const w = Math.round(EL.width * k);
    const h = Math.round(EL.height * k);
    const ok = w <= MAX_PNG_SIDE && h <= MAX_PNG_SIDE && w * h <= MAX_PNG_AREA;
    const g = whole.grids[0];
    const squeeze = g && g.binRows > 1 ? `, ${g.binRows} steps a pixel row` : '';
    return {
      ok, whole,
      dim: `${w.toLocaleString()} × ${h.toLocaleString()}${o.format === 'png' ? ' px' : ''}, the whole run${squeeze}`,
      why: ok ? '' : 'Too large for one image. Lower the resolution.'
    };
  }
  if (o.format === 'text' || o.format === 'csv') {
    const cols = m.tapes.reduce((n, t) => n + (t.hi - t.lo + 1), 0);
    const chars = rows * (cols * (o.format === 'csv' ? 2 : 4) + 24);
    const ok = chars <= MAX_TEXT_CHARS;
    return {
      ok,
      dim: `${rows.toLocaleString()} line${rows === 1 ? '' : 's'} · about ${formatBytes(chars)}`,
      why: ok ? '' : 'Too much text for one file. Export a range of steps.'
    };
  }
  const L = exportLayout(m);
  if (o.format === 'svg') {
    const n = estimateSvgElements(m, L);
    const ok = n <= MAX_SVG_ELEMENTS;
    return {
      ok, L,
      dim: `${Math.round(L.width)} × ${Math.round(L.height)}, ${L.cell}px cells, about ${Math.round(n).toLocaleString()} shapes`,
      why: ok ? '' : 'Too many cells for a vector file to stay usable. Choose Whole run, a smaller cell size or a range of steps.'
    };
  }
  const w = Math.round(L.width * o.scale);
  const h = Math.round(L.height * o.scale);
  const ok = w <= MAX_PNG_SIDE && h <= MAX_PNG_SIDE && w * h <= MAX_PNG_AREA;
  return {
    ok, L,
    dim: `${w.toLocaleString()} × ${h.toLocaleString()} px, ${L.cell}px cells`,
    why: ok ? '' : 'Too large for one image cell by cell. Choose Whole run, lower the resolution or the cell size, or export a range of steps.'
  };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderExportDialog() {
  const body = $('st-export-body');
  const m = syncModel();
  if (!body || !m) return;
  const o = SpaceTimeExportOpts;
  const image = o.format === 'png' || o.format === 'svg';
  const seg = (key, val, label, on) =>
    `<button type="button" class="exp-seg${on ? ' on' : ''}" data-opt="${key}" data-val="${val}">${label}</button>`;
  const check = (key, label, hint) =>
    `<label class="exp-check"><input type="checkbox" data-opt="${key}" ${o[key] ? 'checked' : ''}><span>${label}${hint ? `<em>${hint}</em>` : ''}</span></label>`;
  const [from, to] = exportRange(m);
  const viewCell = layout ? layout.cell : 8;
  const plan = exportPlan(m);

  body.innerHTML = `
    <div class="exp-row">
      <span class="exp-lbl">Format</span>
      <div class="exp-segs">
        ${seg('format', 'png', 'PNG', o.format === 'png')}
        ${seg('format', 'svg', 'SVG', o.format === 'svg')}
        ${seg('format', 'text', 'Text', o.format === 'text')}
        ${seg('format', 'csv', 'CSV', o.format === 'csv')}
      </div>
    </div>
    <div class="exp-row">
      <span class="exp-lbl">Steps</span>
      <div class="exp-segs">
        ${seg('range', 'all', `All ${m.rows.toLocaleString()}${runComplete() ? '' : ' so far'}`, o.range === 'all')}
        ${seg('range', 'span', 'Range', o.range !== 'all')}
      </div>
    </div>
    ${o.range !== 'all' ? `
    <div class="exp-row">
      <span class="exp-lbl">From</span>
      <div class="st-range">
        <input class="inp exp-num" type="number" min="0" max="${m.rows - 1}" value="${from}" data-opt="from" aria-label="First step">
        <span>to</span>
        <input class="inp exp-num" type="number" min="0" max="${m.rows - 1}" value="${to}" data-opt="to" aria-label="Last step">
      </div>
    </div>` : ''}
    ${image ? `
    <div class="exp-row">
      <span class="exp-lbl">Size</span>
      <div class="exp-segs">
        ${seg('size', 'cells', 'Every cell', o.size === 'cells')}
        ${seg('size', 'whole', 'Whole run', o.size === 'whole')}
      </div>
    </div>
    ${o.size === 'cells' ? `
    <div class="exp-row">
      <span class="exp-lbl">Cell</span>
      <div class="exp-segs">
        ${seg('cell', 'view', 'As shown', o.cell === 'view')}
        ${[4, 8, 13, 20].filter(c => c !== viewCell).map(c => seg('cell', c, `${c}px`, o.cell === c)).join('')}
      </div>
    </div>` : ''}
    ${o.format === 'png' ? `
    <div class="exp-row">
      <span class="exp-lbl">Resolution</span>
      <div class="exp-segs">${[1, 2, 3].map(n => seg('scale', n, n + '×', o.scale === n)).join('')}</div>
    </div>` : ''}
    <div class="exp-row">
      <span class="exp-lbl">Colours</span>
      <div class="exp-segs">
        ${seg('colours', 'theme', 'Theme', o.colours === 'theme')}
        ${seg('colours', 'print', 'Print', o.colours === 'print')}
      </div>
    </div>` : ''}
    <div class="exp-row exp-row-stack">
      <span class="exp-lbl">Include</span>
      <div class="exp-checks">
        ${o.format === 'csv' ? '' : check('caption', o.format === 'text' ? 'Header' : 'Caption', 'machine, input and verdict')}
        ${image ? check('playhead', 'Current step', 'the highlighted row') : ''}
        ${image ? check('transparent', 'Transparent background') : ''}
      </div>
    </div>
    ${!image ? '' : o.size === 'whole'
      ? '<div class="exp-note">Every step in one picture: each pixel is the most common symbol in its patch of the run, and the head\u2019s path is kept as the span it swept.</div>'
      : (o.cell !== 'view' || viewCell >= GLYPH_MIN ? ''
        : '<div class="exp-note">Cells this small are drawn as colour only. Pick 13px or larger to print each symbol in its cell.</div>')}
    <div class="exp-dim${plan.ok ? '' : ' is-bad'}">${plan.ok ? `Output — <strong>${plan.dim}</strong>` : escapeText(plan.why)}</div>
  `;

  const dl = document.querySelector && document.querySelector('#spacetime-export-modal [data-st-export="download"]');
  if (dl) dl.disabled = !plan.ok;
  const cp = document.querySelector && document.querySelector('#spacetime-export-modal [data-st-export="copy"]');
  if (cp) {
    cp.disabled = !plan.ok || (o.format === 'png' && !(typeof ClipboardItem === 'function' && navigator.clipboard && navigator.clipboard.write));
    cp.textContent = o.format === 'png' ? 'Copy image' : 'Copy';
  }
  renderExportPreview(m, plan);
}

/** A thumbnail of the file, drawn by the same painter the file will be. */
function renderExportPreview(m, plan) {
  const canvas = $('st-export-canvas');
  const pre = $('st-export-text');
  const note = $('st-export-note');
  const o = SpaceTimeExportOpts;
  if (!canvas || !pre) return;
  const image = o.format === 'png' || o.format === 'svg';
  canvas.hidden = !image;
  pre.hidden = image;
  if (!image) {
    // The first forty rows of the real output, not a mock-up of it.
    const [from, to] = exportRange(m);
    const shown = Math.min(to, from + 40);
    pre.textContent = exportText(m, [from, shown]);
    if (note) note.textContent = to > shown ? `Preview shows the first ${shown - from + 1} of ${(to - from + 1).toLocaleString()} rows.` : '';
    return;
  }
  const D = plan.whole ? plan.whole.EL : (plan.L || exportLayout(m));
  const box = canvas.parentNode;
  const bw = Math.max(200, (box && box.clientWidth) || 360);
  const bh = Math.max(160, (box && box.clientHeight) || 280);
  // Fit the width and crop the height: a run is long and a strip shrunk to fit
  // the box whole is a smear of colour. Only a very wide diagram is cropped on
  // the right too, and then not past the scale where a row is still a row.
  const k = Math.max(0.35, Math.min(1, (bw - 2) / D.width));
  const vw = Math.min(D.width, (bw - 2) / k);
  const vh = Math.min(D.height, (bh - 2) / k);
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  canvas.width = Math.round(vw * k * dpr);
  canvas.height = Math.round(vh * k * dpr);
  canvas.style.width = Math.round(vw * k) + 'px';
  canvas.style.height = Math.round(vh * k) + 'px';
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return;
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  if (plan.whole) paintWhole(ctx, m, plan.whole, exportStyle());
  else {
    paintSpaceTime(ctx, m, D, exportStyle(), {
      vw, vh, headPath, playhead: o.playhead ? playheadRow() : null
    });
  }
  canvas.classList.toggle('is-transparent', !!o.transparent);
  if (note) {
    note.textContent = vw < D.width ? 'Preview shows the top-left of the diagram.'
      : vh < D.height ? 'Preview shows the top of the diagram.' : '';
  }
}

function exportName(ext) {
  return `${exportBaseName()}-spacetime.${ext}`;
}

/** Paint the whole diagram onto a fresh canvas. */
function renderPNG(m, plan) {
  const o = SpaceTimeExportOpts;
  const D = plan.whole ? plan.whole.EL : plan.L;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(D.width * o.scale);
  canvas.height = Math.round(D.height * o.scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(o.scale, o.scale);
  if (plan.whole) paintWhole(ctx, m, plan.whole, exportStyle());
  else {
    paintSpaceTime(ctx, m, D, exportStyle(), {
      vw: D.width, vh: D.height, headPath, playhead: o.playhead ? playheadRow() : null
    });
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function renderSVG(m, plan) {
  const o = SpaceTimeExportOpts;
  if (plan.whole) {
    const { EL } = plan.whole;
    const ctx = svgContext(EL.width, EL.height);
    paintWhole(ctx, m, plan.whole, exportStyle());
    return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + ctx.toString();
  }
  const S = o.colours === 'print' ? PRINT_STYLE : currentStyle();
  return spaceTimeSVG(m, plan.L, S, {
    headPath, transparent: o.transparent, playhead: o.playhead ? playheadRow() : null
  });
}

export function downloadSpaceTime() {
  const m = syncModel();
  if (!m) return;
  const o = SpaceTimeExportOpts;
  const plan = exportPlan(m);
  if (!plan.ok) { showStatus(plan.why); return; }
  if (o.format === 'png') {
    renderPNG(m, plan).then(blob => {
      if (!blob) { showStatus('Could not draw the image'); return; }
      exportDownload(exportName('png'), blob);
      showStatus('Exported the space-time diagram as PNG');
    });
  } else if (o.format === 'svg') {
    exportDownload(exportName('svg'), renderSVG(m, plan), 'image/svg+xml;charset=utf-8');
    showStatus('Exported the space-time diagram as SVG');
  } else if (o.format === 'csv') {
    exportDownload(exportName('csv'), exportText(m), 'text/csv;charset=utf-8');
    showStatus('Exported the space-time diagram as CSV');
  } else {
    exportDownload(exportName('txt'), exportText(m), 'text/plain;charset=utf-8');
    showStatus('Exported the space-time diagram as text');
  }
  closeModal('spacetime-export-modal');
}

export function copySpaceTime() {
  const m = syncModel();
  if (!m) return;
  const o = SpaceTimeExportOpts;
  const plan = exportPlan(m);
  if (!plan.ok) { showStatus(plan.why); return; }
  if (o.format === 'png') {
    if (typeof ClipboardItem !== 'function' || !navigator.clipboard || !navigator.clipboard.write) {
      showStatus('This browser cannot copy images — download instead');
      return;
    }
    // The item is handed a promise, so the write starts inside the click that
    // asked for it — Safari refuses a clipboard write that begins after one.
    navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPNG(m, plan) })])
      .then(() => showStatus('Copied the diagram as an image'))
      .catch(() => showStatus('Copy failed — clipboard access blocked'));
    return;
  }
  const text = o.format === 'svg' ? renderSVG(m, plan) : exportText(m);
  exportCopyText(text, `Copied the diagram as ${o.format === 'svg' ? 'SVG' : o.format === 'csv' ? 'CSV' : 'text'}`);
}

// Test seam: the pieces worth asserting on without a real canvas.
export const _spaceTimeTests = {
  get stripOn() { return stripOn; },
  get overview() { return overview; },
  get els() { return els; },
  syncModel, exportPlan, exportText, themeStyle, storeTracks, setTrace, clearTrace, playheadRow,
  get trace() { return trace; },
  get branchNote() { return branchNote; },
  get model() { return model; },
  get layout() { return layout; }
};
