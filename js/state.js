// ══════════════════════════════════════════════════════════════════
//  CORE STATE
// ══════════════════════════════════════════════════════════════════
const App = {
  machine: 'DFA', tool: 'move', view: 'build',
  sigma: new Set(['a', 'b']),
  stackAlpha: new Set(['Z', 'A', 'B']),
  states: [], transitions: [],
  startId: null, accepts: new Set(),
  stateN: 0, transN: 0,
  // Camera
  cam: { x: 0, y: 0, z: 1 },
  // Undo/Redo
  history: [], future: [],
  // Interaction
  drag: null, dragOff: { x: 0, y: 0 },
  transFrom: null, ctxId: null, editId: null,
  // Simulation
  simSteps: [], simIdx: 0, autoTimer: null,
  // Grammar
  grammar: { vars: new Set(['S']), start: 'S', productions: [] },
  // Current algo
  currentAlgo: 'table',
  // Workspace B (M₂ for binary operations)
  workspaceB: null,
};
const SVG_NS = 'http://www.w3.org/2000/svg', R = 30;
const $ = id => document.getElementById(id);

