// ══════════════════════════════════════════════════════════════════
//  THE MACHINE, AS SOMETHING YOU CAN POST TO A WORKER
// ══════════════════════════════════════════════════════════════════
// A worker has its own module registry, so it has its own `App`. Deciding a
// word there means putting the machine into that copy first.
//
// This is deliberately *not* getWorkspaceData() from js/persistence.js. That
// one is the save format: it carries the camera, notes, dividers, the info
// card and the workspace tabs, none of which change a verdict, and it lives
// in a DOM-bound module. This carries exactly what js/machines/** reads and
// nothing else — the list below was taken by grepping the machine layer for
// `App.`, and tests/parallel.test.js re-derives it so a simulator that starts
// reading a new field fails here rather than silently deciding differently on
// a worker than on the main thread.
//
// Everything here is structured-cloneable: plain objects, arrays and strings.
// The four Set-valued fields are the only conversion.
import { App } from '../state.js';

// App fields the machine layer reads. Sets are listed separately because they
// are the only members that do not survive a structured clone as themselves.
const SET_FIELDS = ['sigma', 'outputAlpha', 'stackAlpha', 'accepts'];
// `simStart` deliberately does *not* ride along, and its absence is the point:
// a worker only ever decides, and deciding is about the machine. decideMachine()
// in js/machines/index.js lifts the run-box override for exactly the same reason
// on the main thread, so a verdict computed on a worker is the verdict computed
// here — which is the whole contract this snapshot exists to keep.
const PLAIN_FIELDS = ['machine', 'tapeCount', 'startId'];

/** Everything a worker needs to decide a word on the machine now on screen. */
export function snapshotMachine() {
  const snap = { states: App.states, transitions: App.transitions };
  for (const k of PLAIN_FIELDS) snap[k] = App[k];
  for (const k of SET_FIELDS) snap[k] = [...(App[k] || [])];
  // config is plain data and is read for the symbol table, the step budgets,
  // detectLoops, twoWayTape, pdaParadigm, pfaCutPoint and transducerAccepts.
  // Copied whole rather than field by field: it is small, and an allow-list
  // here would be a third place to remember when a setting is added.
  snap.config = App.config;
  return snap;
}

/**
 * The inverse, run inside a worker. Writes straight onto that worker's own
 * `App` — which no renderer, store subscriber or autosave is watching, because
 * none of them exist there.
 */
export function hydrateMachine(snap) {
  for (const k of PLAIN_FIELDS) App[k] = snap[k];
  for (const k of SET_FIELDS) App[k] = new Set(snap[k] || []);
  App.states = snap.states || [];
  App.transitions = snap.transitions || [];
  App.config = snap.config;
  // A worker never scrubs a trace; clearing these keeps a stale run from a
  // previous job out of any simulator that happens to read them.
  App.simSteps = [];
  App.simIdx = 0;
}

export { SET_FIELDS, PLAIN_FIELDS };
