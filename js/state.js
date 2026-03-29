// ══════════════════════════════════════════════════════════════════
//  CORE CONFIGURATION
// ══════════════════════════════════════════════════════════════════
const MachineTypes = {
  'DFA': { label: 'DFA', hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-dfa', file: 'dfa' },
  'NFA': { label: 'NFA', hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-nfa', file: 'nfa' },
  'ε-NFA': { label: 'ε-NFA', hasEpsilon: true, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-enfa', file: 'enfa' },
  'PDA': { label: 'PDA', hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-pda', file: 'pda' },
  'TM': { label: 'TM', hasEpsilon: true, hasStack: false, hasTape: true, isTransducer: false, badge: 'bd-tm', file: 'tm' },
  'MTM': { label: 'MTM', hasEpsilon: true, hasStack: false, hasTape: true, isTransducer: false, badge: 'bd-mtm', file: 'mtm' },
  'Moore': { label: 'Moore', hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-moore', file: 'moore' },
  'Mealy': { label: 'Mealy', hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-mealy', file: 'mealy' }
};

// ══════════════════════════════════════════════════════════════════
//  CORE STATE
// ══════════════════════════════════════════════════════════════════
const App = {
  machine: 'DFA', tool: 'move', view: 'build',
  sigma: new Set(['a', 'b']),
  outputAlpha: new Set(['0', '1']),
  stackAlpha: new Set(['Z']), // will be sync'd in init
  tapeCount: 2,
  states: [], transitions: [],
  startId: null, accepts: new Set(),
  selectedStates: new Set(),
  selectedTransitions: new Set(),
  stateN: 0, transN: 0,
  // Configuration constants
  config: {
    theme: 'dark',
    maxPdaSteps: 2000,
    maxTmSteps: 10000,
    autoSpeed: 500,
    radius: 30,
    zoom: { min: 0.2, max: 3, step: 0.1 },
    layout: { minRadius: 80, nodeSpacing: 35 },
    gridSnap: 20,
    sym: { eps: 'ε', any: 'Σ', blank: '⊔', stackBottom: 'Z', lambda: 'λ' },
    statePrefix: 'q',
    render: {
      startArrowLen: 28,
      selfLoopSize: 22,
      selfLoopOff: 12,
      selfLoopTextOff: 30,
      curveOff: 45,
      arrowHeadSize: 6,
      textMargin: 8,
      mooreTextMargin: 9
    },
    export: {
      bg: '#080c18',
      nodeFill: '#161d2e',
      nodeStroke: 'rgba(100,130,200,0.22)',
      startStroke: '#69f0ae',
      accStroke: '#ffd54f',
      actFill: 'rgba(79,195,247,.18)',
      actStroke: '#4fc3f7',
      edgeStroke: '#4a5878',
      textFill: '#7a8ab0',
      nodeTextFill: '#c8d4f0'
    }
  },
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
  // State classification overlay (null = off, Map<id → 'live'|'dead'|'unreachable'> = on)
  stateClassification: null,
  // Workspace B (M₂ for binary operations)
  workspaceB: null,
  // Head directions for TM / MTM
  directions: [
    { value: 'R', label: 'Right' },
    { value: 'L', label: 'Left' },
    { value: 'S', label: 'Stay' }
  ],
};
const SVG_NS = 'http://www.w3.org/2000/svg';
var R = App.config.radius;
const $ = id => document.getElementById(id);
