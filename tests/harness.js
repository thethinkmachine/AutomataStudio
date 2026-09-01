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
import { clearElements, dispatchDocumentEvent, getElement } from './dom-stub.js';

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
import * as machineCard from '../js/machine-card.js';
import * as render from '../js/render.js';
import * as exportFonts from '../js/export-fonts.js';
import * as glyphs from '../js/glyphs.js';
import * as panelState from '../js/panel-state.js';
import * as panelSections from '../js/panel-sections.js';
import * as panelList from '../js/panel-list.js';
import * as panelSectionsUi from '../js/panel-sections-ui.js';
import * as simulation from '../js/simulation.js';
import * as tape from '../js/tape.js';
import * as tapeLog from '../js/tape-log.js';
import * as tapeView from '../js/tape-view.js';
// The machine layer: the registry, the shared runtime, and one module per
// family. Imported here for the same reason as every other namespace — the
// tests reach the machines' own functions (simTM, testFST, decideMachine)
// through `context`, and those functions moved out of simulation.js when
// the machines stopped being an if-chain inside it.
import * as machineRegistry from '../js/machines/registry.js';
import * as machineRuntime from '../js/machines/runtime.js';
import * as machines from '../js/machines/index.js';
import * as machineFinite from '../js/machines/finite.js';
import * as machineWeighted from '../js/machines/weighted.js';
import * as machineOmega from '../js/machines/omega.js';
import * as machinePushdown from '../js/machines/pushdown.js';
import * as machineTuring from '../js/machines/turing.js';
import * as machineTransducer from '../js/machines/transducer.js';
import * as machineTwoWay from '../js/machines/twoway.js';
import * as machinePredicates from '../js/machines/predicates.js';
import * as machineBatch from '../js/machines/batch.js';
import * as machinePaint from '../js/machines/paint.js';
import * as machineRun from '../js/machines/run.js';
import * as parallelPool from '../js/parallel/pool.js';
import * as parallelSnapshot from '../js/parallel/snapshot.js';
import * as parallelCore from '../js/parallel/decide-core.js';
import * as state from '../js/state.js';
import * as statesTransitions from '../js/states-transitions.js';
import * as statemate from '../js/statemate.js';
import * as statemateAgent from '../js/statemate-agent.js';
import * as statemateCompile from '../js/statemate-compile.js';
import * as statemateLint from '../js/statemate-lint.js';
import * as statematePrompt from '../js/statemate-prompt.js';
import * as statemateProvider from '../js/statemate-provider.js';
import * as statemateSpec from '../js/statemate-spec.js';
import * as statemateUi from '../js/statemate-ui.js';
import * as store from '../js/store.js';
import * as suggest from '../js/suggest.js';
import * as themes from '../js/themes.js';
import * as viewport from '../js/viewport.js';
import * as reference from '../js/reference.js';
import * as ui from '../js/ui.js';
import * as utils from '../js/utils.js';
import * as view from '../js/view.js';
import * as quickSettings from '../js/quick-settings.js';
import * as workspace from '../js/workspace.js';
import * as wizard from '../js/wizard.js';
import * as wizardCopy from '../js/wizard-copy.js';
import * as wizardUi from '../js/wizard-ui.js';

const NAMESPACES = [
  state, store, themes, exportRegistry, dropdown, modal, utils, anim, viewport, geometry, statesTransitions,
  canvas, render, panelState, panelSections, panelSectionsUi, panelList, notes, dividers,
  machineRegistry, machineRuntime, machineFinite, machineWeighted, machineOmega,
  machinePushdown, machineTuring, machineTransducer, machineTwoWay, machines,
  machinePredicates, machineBatch, machinePaint, machineRun, parallelPool, parallelSnapshot, parallelCore,
  simulation, tape, tapeLog, tapeView, suggest, language, alphabet, markdown,
  view, history, persistence, exportCore, exportFormats, exportUi, codegen,
  importJflap, algorithmsFa, algorithmsCfg, reference, workspace, quickSettings, minimap, ui,
  statemateSpec, statemateProvider, statemateCompile, statemateLint, statematePrompt, statemateAgent,
  statemate, statemateUi, wizardCopy, wizard, wizardUi
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
  'setInterval', 'clearInterval', 'ResizeObserver', 'IntersectionObserver',
  // The share-link reader takes its payload off location.hash and clears it
  // through history.replaceState, so a test that wants to open a link has to be
  // able to install both.
  'location', 'history'
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
  state.invalidateStateIndex();
  // The layout pass caches its edge grouping against the state index; both are
  // validated rather than invalidated, and a test can replace the model in a way
  // the validators coincide on (an empty array for an empty array).
  geometry.invalidateLayoutGroups();
  viewport.invalidateCull();
  state.setWorkspaces([]);
  state.setActiveWorkspaceId(null);
  state.setR(baseConfig.radius);
  panelState.resetPanelTabs();
  panelSectionsUi.resetSectionReorder();
  // Both memoise a *failure* as well as a success — a glyph face that could not
  // be fetched, and font bytes that could not be — so that one refusal does not
  // cost a request per export. That makes them exactly the state a test would
  // otherwise inherit, and the inheriting test would pass while exercising the
  // fallback rather than the thing it names.
  glyphs.resetGlyphCache();
  exportFonts.resetFontCache();
  // What the formal-definition box last painted. It exists so an unchanged
  // machine does not re-typeset its tuple, which means a test that rebuilds the
  // same machine would otherwise inherit a cache saying the box is already
  // correct — and the box belongs to the previous test's document.
  render._resetDefBoxPainted();
  // Same shape, for the Language panel's paint guard.
  language._resetLangPanelPainted();
  // ... the two lists in the left panel ...
  render._resetLpanelPainted();
  // ... and the machine card, whose guard exists to skip a forced reflow.
  machineCard._resetMetaPainted();
  ui.setSaveState('saved');
  // Whether the large-machine profile was on last time anything looked. Held
  // across a reset it would swallow the announcement for the next test's
  // machine, or announce one for a machine that never crossed the line.
  ui.resetLargeMachineProfileWatch();
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
  // The worker pool holds live workers, a job epoch and — the one that would
  // actually corrupt a run — a latched `disabled` flag set the first time a
  // worker cannot be constructed. See resetPool().
  parallelPool.resetPool();
  // The two left-panel lists hold their data, their scroll listener and their
  // measured row pitch per host element. clearElements() replaces the hosts, so
  // without this a list would keep a listener on a detached node and reuse a
  // pitch measured against the previous test's rows.
  panelList.resetPanelLists();
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
  // The machine card (js/machine-card.js, re-exported here through
  // persistence.js) holds a pending auto-hide timer, a half-typed field and
  // the nodes of the last render.
  persistence._resetExampleCardForTests();
  // The wizard's draft deliberately outlives its dialog, so it also outlives
  // a test unless it is cleared here.
  wizard.resetWizard();
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
  App.selectedNotes.clear();
  App.selectedDividers.clear();
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
  // Stopped, not just forgotten. Playback is a real setInterval, and runSim()
  // starts one on every run — so any test that runs a word (a card chip is the
  // one gesture that does it through the UI) leaves one ticking. Nulling the
  // handle here orphans it: the next tick finds a reset App, reads
  // `simIdx >= simSteps.length - 1`, calls stopAutoPlay, and that returns early
  // because `App.autoTimer` is already null. The interval then fires every
  // 500ms for the life of the process, doing nothing but holding the event loop
  // open — the whole file passes and node never exits.
  if (App.autoTimer) clearInterval(App.autoTimer);
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

export { dispatchDocumentEvent, getElement };

// Kept so the per-test `const h = createHarness()` call sites read the same as
// before. There is only ever one module graph now, so this resets it and hands
// back the same facade rather than building an isolated one.
export function createHarness() {
  resetApp();
  return { context, getElement, resetApp, dispatchDocumentEvent };
}
