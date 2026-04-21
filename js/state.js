// ══════════════════════════════════════════════════════════════════
//  CORE CONFIGURATION
// ══════════════════════════════════════════════════════════════════
const MachineTypes = {
  'DFA': { label: 'DFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-dfa', file: 'dfa' },
  'NFA': { label: 'NFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-nfa', file: 'nfa' },
  'ε-NFA': { label: 'ε-NFA', category: 'fa', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-enfa', file: 'enfa' },
  '2DFA': { label: '2DFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, hasEndMarkers: true, isTransducer: false, badge: 'bd-2dfa', file: 'twdfa' },
  '2NFA': { label: '2NFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, hasEndMarkers: true, isTransducer: false, badge: 'bd-2nfa', file: 'twnfa' },

  'DPDA': { label: 'DPDA', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-dpda', file: 'pda' },
  'NPDA': { label: 'NPDA', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-npda', file: 'npda' },
  'QA': { label: 'Queue Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-qa', file: 'queue' },
  'Counter': { label: 'Counter Machine', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-counter', file: 'counter' },
  '2PDA': { label: '2-Stack PDA', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-2pda', file: 'twopda' },

  'TM': { label: 'TM (DTM)', category: 'tm', implemented: true, hasEpsilon: true, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-tm', file: 'tm' },
  'NDTM': { label: 'NDTM', category: 'tm', implemented: true, hasEpsilon: true, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-ndtm', file: 'ndtm' },
  'MTM': { label: 'MTM', category: 'tm', implemented: true, hasEpsilon: true, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-mtm', file: 'mtm' },
  'LBA': { label: 'LBA', category: 'tm', implemented: true, hasEpsilon: true, hasStack: true, hasTape: true, hasEndMarkers: true, isTransducer: false, badge: 'bd-lba', file: 'lba' },
  'ITM': { label: '2-Way Infinite TM', category: 'tm', implemented: true, hasEpsilon: true, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-itm', file: 'ittm' },

  'Moore': { label: 'Moore', category: 'special', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-moore', file: 'moore' },
  'Mealy': { label: 'Mealy', category: 'special', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-mealy', file: 'mealy' },
  'FST': { label: 'FST', category: 'special', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-fst', file: 'fst' }
};

const MachineCategories = [
  { id: 'fa', label: 'Finite Automata', machines: ['DFA', 'NFA', 'ε-NFA', '2DFA', '2NFA'] },
  { id: 'mem', label: 'Memory Automata', machines: ['DPDA', 'NPDA', 'QA', 'Counter', '2PDA'] },
  { id: 'tm', label: 'Turing Machines', machines: ['TM', 'NDTM', 'MTM', 'LBA', 'ITM'] },
  { id: 'special', label: 'Transducers', machines: ['Moore', 'Mealy', 'FST'] }
];

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
    transducerAccepts: false,
    maxPdaSteps: 2000,
    maxTmSteps: 10000,
    autoSpeed: 500,
    radius: 30,
    zoom: { min: 0.2, max: 3, step: 0.1 },
    layout: { minRadius: 80, nodeSpacing: 35 },
    gridSnap: 20,
    sym: { eps: 'ε', any: 'Σ', blank: '⊔', leftMarker: '⊢', rightMarker: '⊣', stackBottom: 'Z', lambda: 'λ' },
    pdaParadigm: 'explicit',
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
    exportRes: 2,
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
  transFrom: null, ctxId: null, ctxEdge: null, ctxMode: null, editId: null,
  spacePan: false,
  toolbarDock: null,
  toolbarDragging: null,
  toolbarPreviewDock: null,
  transEditId: null, transModalMode: 'add', transModalIds: [],
  // Simulation
  simSteps: [], simIdx: 0, autoTimer: null,
  // Grammar
  grammar: { vars: new Set(['S']), start: 'S', productions: [] },
  // Current algo
  currentAlgo: 'table',
  // DOM Cache for performance
  domCache: { states: new Map(), transitions: new Map(), startArrow: null },
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

// ══════════════════════════════════════════════════════════════════
//  WORKSPACES
// ══════════════════════════════════════════════════════════════════
let Workspaces = [];
let activeWorkspaceId = null;

function exportWorkspaceState() {
  return {
    machine: App.machine,
    sigma: [...App.sigma],
    outputAlpha: [...App.outputAlpha],
    stackAlpha: [...App.stackAlpha],
    tapeCount: App.tapeCount,
    states: JSON.parse(JSON.stringify(App.states)),
    transitions: JSON.parse(JSON.stringify(App.transitions)),
    startId: App.startId,
    accepts: [...App.accepts],
    stateN: App.stateN,
    transN: App.transN,
    cam: { ...App.cam },
    history: App.history.map(h => JSON.parse(JSON.stringify(h))),
    future: App.future.map(h => JSON.parse(JSON.stringify(h))),
    grammar: {
      vars: [...App.grammar.vars],
      start: App.grammar.start,
      productions: JSON.parse(JSON.stringify(App.grammar.productions))
    },
    config: JSON.parse(JSON.stringify(App.config))
  };
}

function importWorkspaceState(data) {
  App.machine = data.machine || 'DFA';
  App.sigma = new Set(data.sigma || ['a', 'b']);
  App.outputAlpha = new Set(data.outputAlpha || ['0', '1']);
  App.stackAlpha = new Set(data.stackAlpha || ['Z']);
  App.tapeCount = data.tapeCount || 2;
  App.states = data.states || [];
  App.transitions = data.transitions || [];
  App.startId = data.startId || null;
  App.accepts = new Set(data.accepts || []);
  App.stateN = data.stateN || 0;
  App.transN = data.transN || 0;
  App.cam = data.cam || { x: 0, y: 0, z: 1 };
  App.history = data.history || [];
  App.future = data.future || [];
  if (data.grammar) {
    App.grammar.vars = new Set(data.grammar.vars);
    App.grammar.start = data.grammar.start;
    App.grammar.productions = data.grammar.productions || [];
  } else {
    App.grammar = { vars: new Set(['S']), start: 'S', productions: [] };
  }
  if (data.config) {
    const { sym, ...loadedConfig } = data.config;
    App.config = { ...App.config, ...loadedConfig, sym: { ...App.config.sym, ...(sym || {}) } };
  }

  if (typeof normalizeBoundarySymbolsForMachine === 'function') {
    normalizeBoundarySymbolsForMachine(App.machine);
  }
}

// ══════════════════════════════════════════════════════════════════
//  STATE MIGRATIONS
// ══════════════════════════════════════════════════════════════════
function migrateSystemSymbols(oldSyms, newSyms) {
  const needsMigration = ['eps', 'any', 'blank', 'stackBottom', 'leftMarker', 'rightMarker'].some(k => oldSyms[k] !== newSyms[k]);
  if (!needsMigration) return;

  App.transitions.forEach(t => {
    // Identify character map replacements strictly
    if (t.symbol === oldSyms.eps) t.symbol = newSyms.eps;
    if (t.symbol === oldSyms.any) t.symbol = newSyms.any;
    if (t.symbol === oldSyms.blank) t.symbol = newSyms.blank;
    if (t.symbol === oldSyms.leftMarker) t.symbol = newSyms.leftMarker;
    if (t.symbol === oldSyms.rightMarker) t.symbol = newSyms.rightMarker;
    
    // Abstract mapping for PDA edge actions
    if (t.pop === oldSyms.eps) t.pop = newSyms.eps;
    if (t.pop === oldSyms.any) t.pop = newSyms.any;
    if (t.pop === oldSyms.stackBottom) t.pop = newSyms.stackBottom;
    
    if (t.push) {
      if (t.push === oldSyms.eps) t.push = newSyms.eps;
      else if (t.push === oldSyms.any) t.push = newSyms.any;
      else if (oldSyms.stackBottom !== newSyms.stackBottom) {
        // Enforce strict character parsing corresponding to standard PDA architectures (no substring mutation)
        t.push = t.push.split('').map(c => c === oldSyms.stackBottom ? newSyms.stackBottom : c).join('');
      }
    }
    
    // Abstract mapping for TM/MTM
    if (t.write === oldSyms.eps) t.write = newSyms.eps;
    if (t.write === oldSyms.any) t.write = newSyms.any;
    if (t.write === oldSyms.blank) t.write = newSyms.blank;
    if (t.write === oldSyms.leftMarker) t.write = newSyms.leftMarker;
    if (t.write === oldSyms.rightMarker) t.write = newSyms.rightMarker;
    
    if (t.tapeSyms) {
      t.tapeSyms = t.tapeSyms.map(s => s === oldSyms.eps ? newSyms.eps : s === oldSyms.any ? newSyms.any : s === oldSyms.blank ? newSyms.blank : s);
    }
    if (t.tapeWrites) {
      t.tapeWrites = t.tapeWrites.map(s => s === oldSyms.eps ? newSyms.eps : s === oldSyms.any ? newSyms.any : s === oldSyms.blank ? newSyms.blank : s);
    }
  });

  if (oldSyms.stackBottom !== newSyms.stackBottom && App.stackAlpha) {
    if (App.stackAlpha.has(oldSyms.stackBottom)) App.stackAlpha.delete(oldSyms.stackBottom);
    App.stackAlpha.add(newSyms.stackBottom);
  }
}
