// ══════════════════════════════════════════════════════════════════
//  CORE CONFIGURATION
// ══════════════════════════════════════════════════════════════════
export const MachineTypes = {
  'DFA': { label: 'DFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-dfa', file: 'dfa' },
  'NFA': { label: 'NFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-nfa', file: 'nfa' },
  'ε-NFA': { label: 'ε-NFA', category: 'fa', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-enfa', file: 'enfa' },
  '2DFA': { label: '2DFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, hasEndMarkers: true, isTransducer: false, badge: 'bd-2dfa', file: 'twdfa' },
  '2NFA': { label: '2NFA', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, hasEndMarkers: true, isTransducer: false, badge: 'bd-2nfa', file: 'twnfa' },

  'DPDA': { label: 'DPDA', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-dpda', file: 'pda' },
  'PDA': { label: 'PDA', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-dpda', file: 'pda' },
  'NPDA': { label: 'NPDA', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-npda', file: 'npda' },
  'QA': { label: 'Queue Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-qa', file: 'queue' },
  'Counter': { label: 'Counter Machine', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-counter', file: 'counter' },
  '2PDA': { label: '2-Stack PDA', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-2pda', file: 'twopda' },

  'TM': { label: 'TM (DTM)', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-tm', file: 'tm' },
  'NDTM': { label: 'NDTM', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-ndtm', file: 'ndtm' },
  'MTM': { label: 'MTM', category: 'tm', implemented: true, hasEpsilon: true, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-mtm', file: 'mtm' },
  'LBA': { label: 'LBA', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, hasEndMarkers: true, isTransducer: false, badge: 'bd-lba', file: 'lba' },
  'ITM': { label: '2-Way Infinite TM', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-itm', file: 'ittm' },

  // Hierarchical. Two capabilities, and the difference between them is the
  // whole point of the category:
  //
  //   hasSuperstates — a state may CONTAIN other states. Containment is a tree,
  //                    a tree cannot cycle, so the nesting is bounded and the
  //                    machine flattens to an NFA. Exactly regular.
  //   hasCallStack   — a state may REFERENCE another component by name.
  //                    Reference is a graph, a graph can cycle, so the depth is
  //                    unbounded and a stack is unavoidable. Exactly CFL.
  //
  // The stack an RSM needs is the CALL stack — built from the component tree at
  // run time, not an alphabet the user edits — so hasStack stays false (no Γ
  // panel) and hasCallStack carries the capability instead.
  'HSM': { label: 'HSM', category: 'hier', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, hasSuperstates: true, hasActions: true, isTransducer: false, badge: 'bd-hsm', file: 'hsm' },
  'RSM': { label: 'RSM', category: 'hier', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, hasSuperstates: true, hasCallStack: true, hasActions: true, isTransducer: false, badge: 'bd-rsm', file: 'rsm' },

  'Moore': { label: 'Moore', category: 'special', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-moore', file: 'moore' },
  'Mealy': { label: 'Mealy', category: 'special', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-mealy', file: 'mealy' },
  'FST': { label: 'FST', category: 'special', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-fst', file: 'fst' }
};

// Example gallery per machine: first entry is the flagship shown by default,
// the rest are alternates offered in the Load Example dropdown.
export const MachineExamples = {
  'DFA': [{ file: 'dfa', label: 'Divisible by 5' }, { file: 'dfa-classic', label: 'Classic: even number of 1s' }],
  'NFA': [{ file: 'nfa', label: 'Keyword search: cat · car · cab' }, { file: 'nfa-classic', label: 'Classic: guess the penultimate 1' }],
  'ε-NFA': [{ file: 'enfa', label: 'Float regex [+-]?d+(.d+)?' }, { file: 'enfa-classic', label: 'Classic: a* then b*' }],
  '2DFA': [{ file: 'twdfa', label: 'Two passes: even a’s, odd b’s' }, { file: 'twdfa-classic', label: 'Classic: last-letter scan' }],
  '2NFA': [{ file: 'twnfa', label: 'Déjà vu: last letter seen before' }, { file: 'twnfa-classic', label: 'Classic: guess and check' }],
  'DPDA': [{ file: 'pda', label: 'Bracket matcher ( ) [ ] { }' }, { file: 'pda-classic', label: 'Classic: aⁿbⁿ' }],
  'PDA': [{ file: 'pda', label: 'Bracket matcher ( ) [ ] { }' }, { file: 'pda-classic', label: 'Classic: aⁿbⁿ' }],
  'NPDA': [{ file: 'npda', label: 'Palindromes: guess the middle' }, { file: 'npda-classic', label: 'Classic: mirrored string w·wʳ' }],
  'QA': [{ file: 'queue', label: 'Perfect copy w#w' }, { file: 'queue-classic', label: 'Classic: enqueue then match' }],
  'Counter': [{ file: 'counter', label: 'Bank account: never overdraw' }, { file: 'counter-classic', label: 'Classic: aⁿbⁿ' }],
  '2PDA': [{ file: 'twopda', label: 'aⁿbⁿcⁿ — beyond one stack' }, { file: 'twopda-classic', label: 'Classic: two-stack handoff' }],
  'TM': [{ file: 'tm', label: 'Binary addition a+b' }, { file: 'tm-classic', label: 'Classic: binary increment' }],
  'NDTM': [{ file: 'ndtm', label: 'Composite? Guess a factor' }, { file: 'ndtm-classic', label: 'Classic: guess the last 1' }],
  'MTM': [{ file: 'mtm', label: '3-tape adder — one pass' }, { file: 'mtm-classic', label: 'Classic: aⁿbⁿcⁿ with 2 tapes' }],
  'LBA': [{ file: 'lba', label: 'Powers of two, by halving' }, { file: 'lba-classic', label: 'Classic: scan to first b' }],
  'ITM': [{ file: 'ittm', label: 'The 4-state busy beaver' }, { file: 'ittm-classic', label: 'Classic: one step left' }],
  'HSM': [
    { file: 'hsm', label: 'Guard AI: one arrow leaves the whole region' },
    { file: 'hsm-classic', label: 'Classic: one arrow out of superstate D' },
    { file: 'hsm-actions', label: 'Actions: a region is a scope' },
    { file: 'hsm-history', label: 'History: resume where you were interrupted' },
    { file: 'hsm-guards', label: 'Guards: a flag is a state you didn’t draw' },
    { file: 'hsm-parallel', label: 'Orthogonality: L(A ∥ B) = L(A) ∩ L(B)' }
  ],
  'RSM': [{ file: 'rsm', label: 'Balanced brackets: S → ( S ) S | ε' }, { file: 'rsm-classic', label: 'Classic: aⁿbⁿ from S → a S b | ε' }],
  'Moore': [{ file: 'moore', label: 'Combination lock 1101' }, { file: 'moore-classic', label: 'Classic: traffic light' }],
  'Mealy': [{ file: 'mealy', label: 'Serial binary adder' }, { file: 'mealy-classic', label: 'Classic: report each bit' }],
  'FST': [{ file: 'fst', label: 'Binary → Gray code' }, { file: 'fst-classic', label: 'Classic: nondeterministic rewriter' }]
};

export const MachineCategories = [
  { id: 'fa', label: 'Finite Automata', machines: ['DFA', 'NFA', 'ε-NFA', '2DFA', '2NFA'] },
  { id: 'mem', label: 'Memory Automata', machines: ['DPDA', 'NPDA', 'QA', 'Counter', '2PDA'] },
  { id: 'tm', label: 'Turing Machines', machines: ['TM', 'NDTM', 'MTM', 'LBA', 'ITM'] },
  { id: 'hier', label: 'Hierarchical', machines: ['HSM', 'RSM'] },
  { id: 'special', label: 'Transducers', machines: ['Moore', 'Mealy', 'FST'] }
];

// True for machines whose states may CONTAIN other states (Harel superstates).
export function hasSuperstates(m = App.machine) {
  return !!(MachineTypes[m] && MachineTypes[m].hasSuperstates);
}

// True for machines whose states may REFERENCE another component (RSM boxes).
export function hasCallStack(m = App.machine) {
  return !!(MachineTypes[m] && MachineTypes[m].hasCallStack);
}

// True for machines whose states carry entry/exit actions and whose arrows carry
// an action of their own. Deliberately NOT isTransducer: acceptance is unchanged
// and Σ is still the only thing read, so every language-class claim stands. The
// output is a side effect, which is exactly what an action is.
export function hasActions(m = App.machine) {
  return !!(MachineTypes[m] && MachineTypes[m].hasActions);
}

// Either kind of nesting — the breadcrumb, the component tree and the
// hierarchy context-menu items are shared by both.
export function hasHierarchy(m = App.machine) {
  return hasSuperstates(m) || hasCallStack(m);
}

// ══════════════════════════════════════════════════════════════════
//  CORE STATE
// ══════════════════════════════════════════════════════════════════
export const App = {
  machine: 'DFA', tool: 'move', view: 'build',
  sigma: new Set(['a', 'b']),
  outputAlpha: new Set(['0', '1']),
  // Boolean variables a guard may test and an arrow may assign. An ARRAY, not a
  // Set: declaration order is the bit order of the valuation key, so two routes
  // to the same valuation have to produce the same flat state id.
  flags: [],
  stackAlpha: new Set(['Z']), // will be sync'd in init
  tapeCount: 2,
  states: [], transitions: [],
  // Hierarchical machines — see the COMPONENTS section below. A flat machine is
  // a tree of exactly one component, so nothing else has to special-case it.
  components: [], rootComponentId: null, componentPath: [], componentN: 0,
  startId: null, accepts: new Set(),
  selectedStates: new Set(),
  selectedTransitions: new Set(),
  stateN: 0, transN: 0,
  // Canvas notes (comments), anchored to states/transitions or free-floating
  notes: [], noteN: 0,
  activeNoteId: null,
  ctxNoteId: null, editNoteId: null,
  dragNoteId: null, dragNoteOffset: { x: 0, y: 0 },
  resizeNoteId: null, resizeNoteStart: null,
  // Canvas dividers (annotation line segments that partition the canvas)
  dividers: [], dividerN: 0,
  selectedDividerId: null,
  ctxDividerId: null, editDividerId: null,
  dragDividerId: null, dragDividerOffset: null,
  dragDividerEndpoint: null,
  dividerDraft: null, dividerDraftEl: null,
  // Which shape kind the merged toolbar button draws: 'divider' (line) or
  // 'rect'. Clicking the button reactivates whichever was used last; right-
  // click (or L/R) switches it. Session-only default, persisted via localStorage.
  lastShapeTool: 'divider',
  // Directional edge highlight, kept in App state (not just as DOM classes) so
  // it survives re-renders the same way selection does. { id, direction }.
  // Deliberately one state at a time — see clearEdgeDirectionHighlight.
  edgeHighlight: null,
  // Configuration constants
  config: {
    theme: 'dark',
    transducerAccepts: false,
    maxPdaSteps: 2000,
    maxTmSteps: 10000,
    // How deep an RSM may recurse before the run is cut off. A machine with no
    // base case would otherwise explore forever; hitting this reports "is there
    // a base case?" rather than a bare reject.
    maxCallDepth: 60,
    // Ceiling on the flattened state count when a construction is a PRODUCT
    // rather than a relabelling — history memory today, orthogonal regions next.
    // Those are exponential by nature, which is the succinctness result; this is
    // what stops the exponent being paid on the simulator's hot path in silence.
    maxFlatStates: 4000,
    // Superstate containers. Their size is DERIVED from the bounding box of
    // their children rather than stored, so a container can never clip a child
    // and dragging one in or out resizes it for free. `head` is the title band,
    // which is also the only part of the container that takes pointer events —
    // the body is click-through so the states inside stay reachable.
    // `closedW`/`closedH` size a COLLAPSED region, which is sized like a box
    // rather than by its contents — the contents being exactly what it is not
    // showing. Collapsing is a view state and never reaches the flattener.
    superstate: { pad: 28, head: 24, minW: 190, minH: 120, closedW: 150, closedH: 56 },
    // Per-word budget for the Language panel's fingerprint. Deliberately
    // far smaller than maxTmSteps: the fingerprint runs one simulation per
    // cell, so this is multiplied by ~127. Words that exhaust it are drawn
    // as "no verdict" rather than as rejects.
    langStepBudget: 400,
    autoSpeed: 500,
    autosaveIntervalMs: 15000,
    radius: 30,
    zoom: { min: 0.2, max: 3, step: 0.1 },
    wheelZoom: true,
    snapToGrid: false,
    wrapStateLabels: true,
    clickHighlightMode: 'off', // 'off' | 'outgoing' | 'incoming'
    layout: { minRadius: 80, nodeSpacing: 35, algorithm: 'sugiyama' },
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
  // Per-state offsets for the drag in flight, and whether that drag has
  // actually moved yet. Both are armed on pointer-DOWN, so a press that stays
  // still is indistinguishable from a drag without the second flag — which is
  // what tells the drop step that this was a selection, not a drop. Declared
  // here rather than sprung onto App by canvas.js so a reset can clear them.
  // The region rects as they stood the instant a drag's first real movement was
  // detected, before this frame's exclusion shrinks anything. containerAt hit-tests
  // against this frozen snapshot rather than the live (exclusion-shrunk) rects, so
  // a state that only nudges within its region is not evicted the moment the
  // region's rendered box starts shrinking away from it. Populated on first
  // movement, cleared with the rest of the gesture.
  dragOffsets: null, dragCurve: null, dragPendingSnapshot: false, dragOriginRects: null,
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
  domCache: { states: new Map(), transitions: new Map(), supers: new Map(), notes: new Map(), dividers: new Map(), startArrow: null },
  // Derived superstate geometry, recomputed by the renderer once per pass and
  // read by everything that needs a node's extent — edge trimming, hit-testing
  // for drag-and-drop, the content bounds behind fit-to-screen and export.
  // Map<stateId, {x, y, w, h}>.
  superRects: new Map(),
  // What a collapsed region is currently hiding. Computed beside the rects and
  // read by the renderer, the edge projection, fit-to-screen and the minimap —
  // a hidden state keeps its absolute position, so anything that measures
  // geometry has to know it is not on screen. Set<stateId>.
  hiddenStates: new Set(),
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
export const SVG_NS = 'http://www.w3.org/2000/svg';
// Mirrors App.config.radius. ES module imports are live for reads but read-only
// for writes, so the one place that changes it (the Settings modal) goes through
// setR rather than assigning across the module boundary.
export let R = App.config.radius;
export function setR(v) { R = v; }
export const $ = id => document.getElementById(id);

// ══════════════════════════════════════════════════════════════════
//  MACHINE SHAPE PREDICATES
// ══════════════════════════════════════════════════════════════════
// These read nothing but App and MachineTypes, so they live here rather than in
// utils.js. That keeps state.js free of imports, which in turn lets it evaluate
// before every other module — the app relies on $ and App being initialised by
// the time other modules run their top-level code.
export function getMachineConfig(m) { return MachineTypes[m] || MachineTypes['DFA']; }

export function isTwoWayFA(m = App.machine) {
  return m === '2DFA' || m === '2NFA';
}

export function isEndmarkerMachine(m = App.machine) {
  return m === '2DFA' || m === '2NFA' || m === 'LBA';
}

export function isReadOnlyHeadMachine(m = App.machine) {
  return isTwoWayFA(m);
}

export function isBoundaryTapeMachine(m = App.machine) {
  return m === 'LBA';
}

export function getBoundaryMarkers() {
  return {
    left: App.config.sym.leftMarker,
    right: App.config.sym.rightMarker
  };
}

export function isBoundarySymbol(sym) {
  const { left, right } = getBoundaryMarkers();
  return sym === left || sym === right;
}

export function normalizeBoundarySymbolsForMachine(m = App.machine) {
  const { left, right } = getBoundaryMarkers();

  if (App.sigma instanceof Set) {
    App.sigma = new Set([...App.sigma].filter(sym => sym !== left && sym !== right));
  }

  if (!(App.stackAlpha instanceof Set)) return;
  const symbols = [...App.stackAlpha].filter(sym => sym !== left && sym !== right);
  App.stackAlpha = isBoundaryTapeMachine(m)
    ? new Set([left, ...symbols, right])
    : new Set(symbols);
}

// ══════════════════════════════════════════════════════════════════
//  COMPONENTS
// ══════════════════════════════════════════════════════════════════
// A hierarchical machine is a set of components. Exactly one is on the canvas
// at a time, and App.states/transitions/startId/accepts ARE that component's
// live working copy — so the renderer, the algorithms, and the ~26 sites that
// reassign App.states wholesale all keep meaning exactly what they meant.
//
// The invariant that makes that safe:
//
//   The live arrays are authoritative for the active component.
//   App.components[active] is a cache, valid only after flushActiveComponent().
//   READERS FLUSH, WRITERS DON'T.
//
// The readers are the four places that need the whole tree at once: snapshot(),
// exportWorkspaceState(), the compiler, and descend/ascend. Every writer is
// left alone.
//
// Flushing from a store subscriber instead would be tidier to write and harder
// to reason about: commit() is snapshot() + emit(), so the subscriber runs
// *after* snapshot has serialized. Having each reader flush on its own line
// makes the ordering local and obvious rather than a property of subscriber
// registration order.

export function newComponentId() { return 'c' + (++App.componentN); }

export function getComponent(id) { return App.components.find(c => c.id === id); }

export function activeComponentId() {
  return App.componentPath[App.componentPath.length - 1] || App.rootComponentId;
}

export function activeComponent() { return getComponent(activeComponentId()); }

// Writes the live arrays back into the component they belong to. The arrays are
// shared by reference where they can be, so this is only really repairing the
// bindings that a wholesale `App.states = ...` reassignment broke.
export function flushActiveComponent() {
  // Self-healing rather than boot-order dependent: every reader flushes, so
  // making the root appear here means no code path can reach the tree before
  // something has remembered to create it.
  const c = activeComponent() || ensureRootComponent();
  if (!c) return null;
  c.states = App.states;
  c.transitions = App.transitions;
  c.startId = App.startId;
  c.accepts = [...App.accepts];
  c.cam = { ...App.cam };
  return c;
}

// Points the live arrays at a component without flushing the outgoing one.
// Restore paths need exactly this: the live arrays there belong to the state
// being discarded, so writing them back is at best wasted work, and would
// become a real bug the day adoptComponents merges into the existing tree
// instead of replacing it wholesale.
export function bindComponent(id, path) {
  const target = getComponent(id);
  if (!target) return false;
  App.states = target.states || [];
  App.transitions = target.transitions || [];
  App.startId = target.startId || null;
  App.accepts = new Set(target.accepts || []);
  App.cam = { ...(target.cam || { x: 0, y: 0, z: 1 }) };
  App.componentPath = path && path.length ? [...path] : [id];
  // Selection is per-component: ids from the component being left would either
  // dangle or, with global counters, silently point at a different node.
  App.selectedStates.clear();
  App.selectedTransitions.clear();
  return true;
}

// Every machine has a root component, including the 19 flat models and every
// file saved before hierarchy existed. Synthesizing one on load is what lets
// the rest of the app stop caring whether a machine is hierarchical.
export function ensureRootComponent() {
  const root = App.rootComponentId && getComponent(App.rootComponentId);
  if (root) {
    if (!App.componentPath.length) App.componentPath = [App.rootComponentId];
    return root;
  }
  const c = {
    id: newComponentId(),
    name: 'Main',
    states: App.states,
    transitions: App.transitions,
    startId: App.startId,
    accepts: [...App.accepts],
    exitIds: [],
    cam: { ...App.cam }
  };
  App.components = [c];
  App.rootComponentId = c.id;
  App.componentPath = [c.id];
  return c;
}

// Adopts a serialized component tree, falling back to a single root built from
// the flat fields when there isn't one. Shared by snapshot restore, workspace
// import and file load, because all three face the same legacy shape.
export function adoptComponents(data) {
  const list = Array.isArray(data && data.components) ? data.components : null;
  const rootId = data && data.rootComponentId;
  if (list && list.length && rootId && list.some(c => c.id === rootId)) {
    App.components = list;
    App.rootComponentId = rootId;
    App.componentN = Math.max(data.componentN || 0, App.componentN);
    const path = (data.componentPath || []).filter(id => list.some(c => c.id === id));
    const target = path.length ? path[path.length - 1] : rootId;
    bindComponent(target, path.length ? path : [target]);
    return;
  }
  App.components = [];
  App.rootComponentId = null;
  App.componentPath = [];
  ensureRootComponent();
}

export function serializeComponents() {
  flushActiveComponent();
  return {
    components: JSON.parse(JSON.stringify(App.components)),
    rootComponentId: App.rootComponentId,
    componentPath: [...App.componentPath],
    componentN: App.componentN
  };
}

// ══════════════════════════════════════════════════════════════════
//  WORKSPACES
// ══════════════════════════════════════════════════════════════════
// The open tabs and which one is live. Both are reassigned wholesale (filter,
// slice, reset), so — like R above — cross-module writes go through setters
// while reads use the live import binding.
export let Workspaces = [];
export let activeWorkspaceId = null;
export function setWorkspaces(v) { Workspaces = v; }
export function setActiveWorkspaceId(v) { activeWorkspaceId = v; }

export function exportWorkspaceState() {
  // A reader of the whole tree, so it flushes first. The flat states/transitions
  // below stay the ACTIVE component's, which is what they have always been —
  // that is what lets an older build open this blob and show something sane.
  const tree = serializeComponents();
  return {
    ...tree,
    machine: App.machine,
    sigma: [...App.sigma],
    outputAlpha: [...App.outputAlpha],
    flags: [...(App.flags || [])],
    stackAlpha: [...App.stackAlpha],
    tapeCount: App.tapeCount,
    states: JSON.parse(JSON.stringify(App.states)),
    transitions: JSON.parse(JSON.stringify(App.transitions)),
    startId: App.startId,
    accepts: [...App.accepts],
    stateN: App.stateN,
    transN: App.transN,
    notes: JSON.parse(JSON.stringify(App.notes)),
    noteN: App.noteN,
    dividers: JSON.parse(JSON.stringify(App.dividers)),
    dividerN: App.dividerN,
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

export function importWorkspaceState(data) {
  App.machine = data.machine || 'DFA';
  App.sigma = new Set(data.sigma || ['a', 'b']);
  App.outputAlpha = new Set(data.outputAlpha || ['0', '1']);
  App.flags = Array.isArray(data.flags) ? [...data.flags] : [];
  App.stackAlpha = new Set(data.stackAlpha || ['Z']);
  App.tapeCount = data.tapeCount || 2;
  App.states = data.states || [];
  App.transitions = data.transitions || [];
  App.startId = data.startId || null;
  App.accepts = new Set(data.accepts || []);
  App.stateN = data.stateN || 0;
  App.transN = data.transN || 0;
  App.notes = data.notes || [];
  App.noteN = data.noteN || 0;
  App.dividers = data.dividers || [];
  App.dividerN = data.dividerN || 0;
  App.selectedDividerId = null;
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
    // R mirrors config.radius for the modules that imported it, and replacing
    // config wholesale does not update it. Without this a tab saved at a
    // different radius draws its states at the previous tab's size.
    setR(App.config.radius);
  }

  // After the flat fields, because the fallback root is built from them.
  adoptComponents(data);

  if (typeof normalizeBoundarySymbolsForMachine === 'function') {
    normalizeBoundarySymbolsForMachine(App.machine);
  }
}

// ══════════════════════════════════════════════════════════════════
//  STATE MIGRATIONS
// ══════════════════════════════════════════════════════════════════
export function migrateSystemSymbols(oldSyms, newSyms) {
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
