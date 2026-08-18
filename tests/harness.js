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
import * as anim from '../js/anim.js';
import * as canvas from '../js/canvas.js';
import * as codegen from '../js/codegen.js';
import * as dividers from '../js/dividers.js';
import * as dropdown from '../js/dropdown.js';
import * as exportCore from '../js/export-core.js';
import * as exportFormats from '../js/export-formats.js';
import * as exportRegistry from '../js/export-registry.js';
import * as exportUi from '../js/export-ui.js';
import * as geometry from '../js/geometry.js';
import * as history from '../js/history.js';
import * as importJflap from '../js/import-jflap.js';
import * as language from '../js/language.js';
import * as markdown from '../js/markdown.js';
import * as minimap from '../js/minimap.js';
import * as modal from '../js/modal.js';
import * as notes from '../js/notes.js';
import * as persistence from '../js/persistence.js';
import * as render from '../js/render.js';
import * as simulation from '../js/simulation.js';
import * as state from '../js/state.js';
import * as statesTransitions from '../js/states-transitions.js';
import * as statemate from '../js/statemate.js';
import * as statemateCompile from '../js/statemate-compile.js';
import * as statemateLint from '../js/statemate-lint.js';
import * as statematePrompt from '../js/statemate-prompt.js';
import * as statemateProvider from '../js/statemate-provider.js';
import * as statemateSpec from '../js/statemate-spec.js';
import * as statemateUi from '../js/statemate-ui.js';
import * as store from '../js/store.js';
import * as suggest from '../js/suggest.js';
import * as themes from '../js/themes.js';
import * as reference from '../js/reference.js';
import * as ui from '../js/ui.js';
import * as utils from '../js/utils.js';
import * as view from '../js/view.js';
import * as quickSettings from '../js/quick-settings.js';
import * as workspace from '../js/workspace.js';

const NAMESPACES = [
  state, store, themes, exportRegistry, dropdown, modal, utils, anim, geometry, statesTransitions,
  canvas, render, notes, dividers, simulation, suggest, language, alphabet, markdown,
  view, history, persistence, exportCore, exportFormats, exportUi, codegen,
  importJflap, algorithmsFa, algorithmsCfg, reference, workspace, quickSettings, minimap, ui,
  statemateSpec, statemateProvider, statemateCompile, statemateLint, statematePrompt,
  statemate, statemateUi
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
  App.domCache.notes.clear();
  App.domCache.dividers.clear();
  App.domCache.startArrow = null;
  // Eased drawing keeps a track per edge quantity between paints. The tracks are
  // keyed "fromId|toId", and resetApp hands back the same ids, so a test would
  // otherwise start out easing from the previous test's geometry. (Animation is
  // inert under the stub anyway — dom-stub runs rAF synchronously, which anim.js
  // detects and treats as "always snap" — but the reset keeps that a property of
  // the harness rather than a coincidence.)
  anim.resetAnim();
  // The minimap's eased frame survives a resetApp the same way — it is module
  // state, not App state — so a test would start out gliding in from the
  // previous test's diagram.
  minimap.resetMinimapFrame();
  // StateMate holds an abort controller, a one-turn follow-up slot, a
  // few-shot cache and the console's own transcript between calls. All four
  // survive resetApp, and a live controller leaking into the next test is
  // exactly the kind of thing that makes a suite flaky.
  statemate.resetStateMateRuntime();
  statemateProvider.resetStateMateSettings();
  statematePrompt._clearFewShotCache();
  statemateUi._resetPaletteForTests();
  // The info card holds a pending auto-hide timer and the meta it describes.
  persistence._resetExampleCardForTests();
}

export function resetApp() {
  App.machine = 'DFA';
  App.tool = 'move';
  App.view = 'build';
  App.sigma = new Set(['a', 'b']);
  App.outputAlpha = new Set(['0', '1']);
  App.stackAlpha = new Set([baseConfig.sym.stackBottom]);
  App.tapeCount = 2;
  App.states = [];
  App.transitions = [];
  App.startId = null;
  App.accepts = new Set();
  App.selectedStates = new Set();
  App.selectedTransitions = new Set();
  App.stateN = 0;
  App.transN = 0;
  App.notes = [];
  App.noteN = 0;
  App.dividers = [];
  App.dividerN = 0;
  // The info card's text. App state since it became editable, so it is
  // App state a test can leak — a described machine in one test would
  // otherwise hand the next one a card it never asked for.
  App.meta = null;
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
