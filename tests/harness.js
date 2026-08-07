// Test harness for the ES-module app.
//
// The previous harness read js/*.js off disk and ran them inside a node:vm
// context, because the app was a set of classic scripts with no import/export
// and nothing could be required directly. Now the modules are real, so this
// imports them and exposes their namespaces.
//
// Two things follow from that, and they are why this file is not just a barrel:
//
//   1. dom-stub.js must be imported first. Module imports are evaluated before
//      any module body, so the browser stubs have to be installed by an earlier
//      import rather than by code here.
//   2. `context` delegates with getters instead of copying. Several exports are
//      `let` bindings that the app reassigns (saveState, Workspaces,
//      activeWorkspaceId, R); Object.assign would freeze a stale value, and
//      tests assert on the current one.
import './dom-stub.js';
import { clearElements, getElement } from './dom-stub.js';

import * as algorithmsCfg from '../js/algorithms-cfg.js';
import * as algorithmsFa from '../js/algorithms-fa.js';
import * as alphabet from '../js/alphabet.js';
import * as canvas from '../js/canvas.js';
import * as codegen from '../js/codegen.js';
import * as dividers from '../js/dividers.js';
import * as dropdown from '../js/dropdown.js';
import * as exportCore from '../js/export-core.js';
import * as exportFormats from '../js/export-formats.js';
import * as exportRegistry from '../js/export-registry.js';
import * as exportUi from '../js/export-ui.js';
import * as guards from '../js/guards.js';
import * as hierarchy from '../js/hierarchy.js';
import * as history from '../js/history.js';
import * as importJflap from '../js/import-jflap.js';
import * as language from '../js/language.js';
import * as modal from '../js/modal.js';
import * as notes from '../js/notes.js';
import * as persistence from '../js/persistence.js';
import * as render from '../js/render.js';
import * as simulation from '../js/simulation.js';
import * as state from '../js/state.js';
import * as statesTransitions from '../js/states-transitions.js';
import * as store from '../js/store.js';
import * as suggest from '../js/suggest.js';
import * as superstates from '../js/superstates.js';
import * as themes from '../js/themes.js';
import * as theory from '../js/theory.js';
import * as ui from '../js/ui.js';
import * as utils from '../js/utils.js';
import * as view from '../js/view.js';
import * as workspace from '../js/workspace.js';

const NAMESPACES = [
  state, store, themes, exportRegistry, dropdown, modal, utils, guards, statesTransitions,
  canvas, render, superstates, hierarchy, notes, dividers, simulation, suggest, language, alphabet,
  view, history, persistence, exportCore, exportFormats, exportUi, codegen,
  importJflap, algorithmsFa, algorithmsCfg, theory, workspace, ui
];

// Live view over every module export. Names are unique across modules (the
// conversion to ES modules verified that), so a flat namespace is unambiguous.
export const context = {};
for (const ns of NAMESPACES) {
  for (const key of Object.keys(ns)) {
    Object.defineProperty(context, key, {
      get: () => ns[key],
      enumerable: true,
      configurable: true
    });
  }
}

// Browser globals reachable through `context` as well, because that is what the
// vm context used to be: one object holding both the app's names and the
// environment's. Tests read them (context.localStorage.getItem) and replace them
// (context.indexedDB = fakeIndexedDB, context.matchMedia = () => ...), so these
// proxy in both directions rather than being copied.
const BROWSER_GLOBALS = [
  'document', 'localStorage', 'window', 'indexedDB', 'navigator', 'fetch',
  'Blob', 'URL', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame',
  'innerWidth', 'innerHeight', 'getComputedStyle', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'ResizeObserver', 'IntersectionObserver'
];
for (const key of BROWSER_GLOBALS) {
  Object.defineProperty(context, key, {
    get: () => globalThis[key],
    set: value => { globalThis[key] = value; },
    enumerable: true,
    configurable: true
  });
}

const { App } = state;
const baseConfig = JSON.parse(JSON.stringify(App.config));
const baseDirections = JSON.parse(JSON.stringify(App.directions));

// Module state that used to be discarded for free: the old harness built a
// fresh vm context per createHarness() call, so every module-level binding
// started out empty. Modules are singletons now, so the ones that carry state
// between tests are reset by hand.
//
// The keyed caches (_regexCache, _langVocab, _langExtCache) are deliberately
// left alone — each stores its own cache key and recomputes when the key
// changes, so a stale entry can never be served to a reset App.
function resetModuleState() {
  state.setWorkspaces([]);
  state.setActiveWorkspaceId(null);
  state.setR(baseConfig.radius);
  ui.setSaveState('saved');
  // The incremental renderer keys its live SVG nodes off App.domCache. Left
  // populated, a test would start out holding nodes built for the previous
  // test's states — the diff recovers from that on its own, but tests that
  // assert on node identity should be starting from nothing.
  App.domCache.states.clear();
  App.domCache.transitions.clear();
  App.domCache.supers.clear();
  App.domCache.notes.clear();
  App.domCache.dividers.clear();
  App.domCache.startArrow = null;
  // Derived geometry, so it is stale rather than wrong after a reset — but a
  // stale rect makes a region look like it still exists to containerAt.
  App.superRects = new Map();
  App.hiddenStates = new Set();
  // In-flight pointer gestures. A test that starts a drag and never ends one
  // leaves App.dragOffsets holding ids from a machine that no longer exists, and
  // refreshLayout() consults it on every render — so the next test measures its
  // regions against the previous test's drag set. dropTargetId is canvas.js's
  // own module-level binding, hence the exported clear rather than a field.
  App.dragOffsets = null;
  App.dragCurve = null;
  // Leaks the "this press has not moved yet" state into the next test, where it
  // makes the drop step treat a simulated drag as a plain click and skip it.
  App.dragPendingSnapshot = false;
  App.dragOriginRects = null;
  App.marquee = null;
  canvas.clearDropTarget();
}

export function resetApp() {
  App.machine = 'DFA';
  App.tool = 'move';
  App.view = 'build';
  App.sigma = new Set(['a', 'b']);
  App.outputAlpha = new Set(['0', '1']);
  App.flags = [];
  App.stackAlpha = new Set([baseConfig.sym.stackBottom]);
  App.tapeCount = 2;
  App.states = [];
  App.transitions = [];
  App.startId = null;
  App.accepts = new Set();
  // Module-level state that survives a reset is what breaks isolation here, and
  // the component tree is exactly that: leaving it populated would start the
  // next test standing inside the previous test's sub-machine.
  App.components = [];
  App.rootComponentId = null;
  App.componentPath = [];
  App.componentN = 0;
  App.selectedStates = new Set();
  App.selectedTransitions = new Set();
  App.stateN = 0;
  App.transN = 0;
  App.notes = [];
  App.noteN = 0;
  App.dividers = [];
  App.dividerN = 0;
  App.selectedDividerId = null;
  App.config = JSON.parse(JSON.stringify(baseConfig));
  App.cam = { x: 0, y: 0, z: 1 };
  App.history = [];
  App.future = [];
  App.drag = null;
  App.dragOff = { x: 0, y: 0 };
  App.transFrom = null;
  App.ctxId = null;
  App.editId = null;
  App.simSteps = [];
  App.simIdx = 0;
  App.autoTimer = null;
  if (App.grammar) {
    App.grammar.vars = new Set(['S']);
    App.grammar.start = 'S';
    App.grammar.productions = [];
  } else {
    App.grammar = { vars: new Set(['S']), start: 'S', productions: [] };
  }
  App.currentAlgo = 'table';
  App.stateClassification = null;
  App.workspaceB = null;
  App.directions = JSON.parse(JSON.stringify(baseDirections));
  // Elements first: resetModuleState calls into the app (setSaveState), which
  // should be writing to fresh stub elements, not ones a previous test dirtied.
  clearElements();
  resetModuleState();
}

resetApp();

export { getElement };

// Kept so the per-test `const h = createHarness()` call sites read the same as
// before. There is only ever one module graph now, so this resets it and hands
// back the same facade rather than building an isolated one.
export function createHarness() {
  resetApp();
  return { context, getElement, resetApp };
}
