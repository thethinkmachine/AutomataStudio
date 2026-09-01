// js/state.js imports exactly one module, and only because Solid is not ours.
//
// The standing rule is that this file imports nothing, because several modules
// run top-level code against `App` and `$` and rely on state.js being fully
// evaluated first. js/reactive.js imports Solid and nothing else, and Solid
// cannot import back into the app, so the subgraph is closed and state.js is
// still a leaf of the *app's* module graph. That is the property the rule
// protects. Do not add an import of an app module here.
import { ReactiveSet } from './reactive.js';

// ══════════════════════════════════════════════════════════════════
//  CORE CONFIGURATION
// ══════════════════════════════════════════════════════════════════
// `label` is the compact name used wherever space is tight (the header button,
// badges, formal definitions). `fullName` is the unabbreviated textbook name and
// is what the model picker lists; it falls back to `label` if ever omitted.
export const MachineTypes = {
  'DFA': { label: 'DFA', fullName: 'Deterministic Finite Automaton', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-dfa', file: 'dfa' },
  'NFA': { label: 'NFA', fullName: 'Nondeterministic Finite Automaton', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-nfa', file: 'nfa' },
  'ε-NFA': { label: 'ε-NFA', fullName: 'Finite Automaton with ε-Transitions', category: 'fa', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, isTransducer: false, badge: 'bd-enfa', file: 'enfa' },
  '2DFA': { label: '2DFA', fullName: 'Two-Way Deterministic Finite Automaton', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, hasEndMarkers: true, isTransducer: false, badge: 'bd-2dfa', file: 'twdfa' },
  '2NFA': { label: '2NFA', fullName: 'Two-Way Nondeterministic Finite Automaton', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, hasEndMarkers: true, isTransducer: false, badge: 'bd-2nfa', file: 'twnfa' },
  // isWeighted: edges carry a numeric probability rather than only a symbol, and
  // a run is a distribution over Q instead of a single state. isOmega: the input
  // is an infinite (ultimately periodic) word, so acceptance is a property of the
  // run's cycle rather than of a final configuration.
  'PFA': { label: 'PFA', fullName: 'Probabilistic Finite Automaton', category: 'fa', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isWeighted: true, badge: 'bd-pfa', file: 'pfa' },
  // The ω-automata are one structure — Q, Σ, δ, q₀ — crossed over two axes:
  // determinism, and the acceptance condition α that judges inf(r). Both are
  // named by the type, so the label on screen is always the machine you have.
  //
  //   omegaCondition — which predicate decides a run. Drives the simulator, the
  //                    tuple, and the class label; see the OmegaAcceptance
  //                    registry below.
  //   deterministic  — δ must be single-valued. Costs expressive power under
  //                    Büchi alone: DBA ⊊ NBA, while DPA = NPA and
  //                    DcoBA = NcoBA.
  'DBA': { label: 'DBA', fullName: 'Deterministic Büchi Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'buchi', deterministic: true, badge: 'bd-dba', file: 'dba' },
  'DcoBA': { label: 'DcoBA', fullName: 'Deterministic co-Büchi Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'cobuchi', deterministic: true, badge: 'bd-dba', file: 'dcoba' },
  'DPA': { label: 'DPA', fullName: 'Deterministic Parity Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'parity', deterministic: true, badge: 'bd-dba', file: 'dpa' },
  'DWA': { label: 'DWA', fullName: 'Deterministic Weak Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'weak', deterministic: true, badge: 'bd-dba', file: 'dwa' },
  'NBA': { label: 'NBA', fullName: 'Nondeterministic Büchi Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'buchi', deterministic: false, badge: 'bd-nba', file: 'buchi' },
  'NcoBA': { label: 'NcoBA', fullName: 'Nondeterministic co-Büchi Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'cobuchi', deterministic: false, badge: 'bd-nba', file: 'ncoba' },
  'NPA': { label: 'NPA', fullName: 'Nondeterministic Parity Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'parity', deterministic: false, badge: 'bd-nba', file: 'npa' },
  'NWA': { label: 'NWA', fullName: 'Nondeterministic Weak Automaton', category: 'omega', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: false, isOmega: true, omegaCondition: 'weak', deterministic: false, badge: 'bd-nba', file: 'nwa' },

  'DPDA': { label: 'DPDA', fullName: 'Deterministic Pushdown Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-dpda', file: 'pda' },
  'PDA': { label: 'PDA', fullName: 'Pushdown Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-dpda', file: 'pda' },
  'NPDA': { label: 'NPDA', fullName: 'Nondeterministic Pushdown Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-npda', file: 'npda' },
  'QA': { label: 'Queue Automaton', fullName: 'Queue Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-qa', file: 'queue' },
  'Counter': { label: 'Counter Automaton', fullName: 'One-Counter Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-counter', file: 'counter' },
  '2PDA': { label: '2-Stack PDA', fullName: 'Two-Stack Pushdown Automaton', category: 'mem', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: false, badge: 'bd-2pda', file: 'twopda' },

  'TM': { label: 'TM (DTM)', fullName: 'Deterministic Turing Machine', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-tm', file: 'tm' },
  'NDTM': { label: 'NDTM', fullName: 'Nondeterministic Turing Machine', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-ndtm', file: 'ndtm' },
  'MTM': { label: 'MTM', fullName: 'Multi-Tape Turing Machine', category: 'tm', implemented: true, hasEpsilon: true, hasStack: true, hasTape: true, isTransducer: false, badge: 'bd-mtm', file: 'mtm' },
  'LBA': { label: 'LBA', fullName: 'Linear Bounded Automaton', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, hasEndMarkers: true, isTransducer: false, badge: 'bd-lba', file: 'lba' },
  'ITM': { label: '2-Way Infinite TM', fullName: 'Two-Way Infinite Turing Machine', category: 'tm', implemented: true, hasEpsilon: false, hasStack: true, hasTape: true, isTransducer: false, twoWayTape: true, badge: 'bd-itm', file: 'ittm' },

  'Moore': { label: 'Moore', fullName: 'Moore Machine', category: 'special', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-moore', file: 'moore' },
  'Mealy': { label: 'Mealy', fullName: 'Mealy Machine', category: 'special', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-mealy', file: 'mealy' },
  'FST': { label: 'FST', fullName: 'Finite State Transducer', category: 'special', implemented: true, hasEpsilon: true, hasStack: false, hasTape: false, isTransducer: true, badge: 'bd-fst', file: 'fst' },
  'PDT': { label: 'Pushdown Transducer', fullName: 'Pushdown Transducer', category: 'special', implemented: true, hasEpsilon: true, hasStack: true, hasTape: false, isTransducer: true, badge: 'bd-pdt', file: 'pdt' },
  '2DFT': { label: '2-Way Transducer', fullName: 'Two-Way Deterministic Finite Transducer', category: 'special', implemented: true, hasEpsilon: false, hasStack: false, hasTape: false, hasEndMarkers: true, isTransducer: true, badge: 'bd-2dft', file: 'twodft' }
};

// Example gallery per machine: first entry is the flagship shown by default,
// the rest are alternates offered in the searchable example picker.
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
  'MTM': [{ file: 'mtm-alu', label: '4-tape ALU — add, and, or, xor, not' }, { file: 'mtm', label: '3-tape adder — one pass' }, { file: 'mtm-palindrome', label: 'Palindromes in linear time' }, { file: 'mtm-classic', label: 'Classic: aⁿbⁿcⁿ with 2 tapes' }],
  'LBA': [{ file: 'lba', label: 'Powers of two, by halving' }, { file: 'lba-classic', label: 'Classic: scan to first b' }],
  'ITM': [{ file: 'ittm', label: 'The 4-state busy beaver' }, { file: 'ittm-classic', label: 'Classic: one step left' }],
  'Moore': [{ file: 'moore', label: 'Combination lock 1101' }, { file: 'moore-classic', label: 'Classic: traffic light' }],
  'Mealy': [{ file: 'mealy', label: 'Serial binary adder' }, { file: 'mealy-classic', label: 'Classic: report each bit' }],
  'FST': [{ file: 'fst', label: 'Binary → Gray code' }, { file: 'fst-classic', label: 'Classic: nondeterministic rewriter' }],
  'PFA': [{ file: 'pfa', label: 'Noisy channel: does it end in a?' }, { file: 'pfa-classic', label: 'Classic: Rabin’s cut-point language' }],
  'DBA': [{ file: 'dba', label: 'Never two a’s in a row' }, { file: 'dba-classic', label: 'Classic: infinitely often a' }],
  'DcoBA': [{ file: 'dcoba', label: 'Eventually always b' }],
  'DPA': [{ file: 'dpa', label: 'Eventually always b, by priority' }],
  'DWA': [{ file: 'dwa', label: 'Never two a’s in a row' }],
  'NBA': [{ file: 'buchi', label: 'Infinitely often a' }, { file: 'buchi-classic', label: 'Classic: eventually always b' }],
  'NcoBA': [{ file: 'ncoba', label: 'Eventually always b, with a needless guess' }],
  'NPA': [{ file: 'npa', label: 'Infinitely often a, or eventually always c' }],
  'NWA': [{ file: 'nwa', label: 'Never two a’s, with a needless guess' }],
  'PDT': [{ file: 'pdt', label: 'Reverse the input' }, { file: 'pdt-classic', label: 'Classic: aⁿbⁿ ↦ bⁿaⁿ' }],
  '2DFT': [{ file: 'twodft', label: 'Copy twice: w ↦ ww' }, { file: 'twodft-classic', label: 'Classic: reverse the input' }]
};

// The acceptance conditions an ω-automaton can carry, keyed by a machine type's
// omegaCondition. All four judge the same object: inf(r), the set of states the
// run visits infinitely often. On an ultimately periodic input that set is
// exactly the states on the run's lasso cycle, which is why the eight types
// share one simulator and differ only in a predicate over that cycle.
//
//   usesPriority — α is a per-state integer instead of a subset of Q.
//   structural   — α is a subset of Q judged the Büchi way, but the *automaton*
//                  must additionally satisfy a shape constraint.
export const OmegaAcceptance = {
  buchi: {
    label: 'Büchi', tuple: 'F',
    say: 'inf(r) ∩ F ≠ ∅ — some accepting state recurs forever',
    usesPriority: false, structural: false
  },
  cobuchi: {
    label: 'co-Büchi', tuple: 'F',
    say: 'inf(r) ∩ F = ∅ — every state of F is visited only finitely often',
    usesPriority: false, structural: false
  },
  parity: {
    label: 'Parity', tuple: 'Ω',
    say: 'the least priority recurring forever is even',
    usesPriority: true, structural: false
  },
  weak: {
    label: 'Weak', tuple: 'F',
    say: 'Büchi acceptance, on an automaton whose every SCC lies inside F or outside it',
    usesPriority: false, structural: true
  }
};

export const MachineCategories = [
  { id: 'fa', label: 'Finite Automata', machines: ['DFA', 'NFA', 'ε-NFA', '2DFA', '2NFA', 'PFA'] },
  { id: 'omega', label: 'Omega Automata', machines: ['DBA', 'DcoBA', 'DPA', 'DWA', 'NBA', 'NcoBA', 'NPA', 'NWA'] },
  { id: 'mem', label: 'Memory Automata', machines: ['DPDA', 'NPDA', 'QA', 'Counter', '2PDA'] },
  { id: 'tm', label: 'Turing Machines', machines: ['TM', 'NDTM', 'MTM', 'LBA', 'ITM'] },
  { id: 'special', label: 'Transducers', machines: ['Moore', 'Mealy', 'FST', 'PDT', '2DFT'] }
];

// ══════════════════════════════════════════════════════════════════
//  CORE STATE
// ══════════════════════════════════════════════════════════════════
// ── Reactive set fields ───────────────────────────────────────────
// Σ, Γ, the output alphabet, F and the four selection sets are Sets that the
// app mutates in place — App.accepts.add(id) — 76 times across the codebase,
// and reassigns wholesale a further 33 times from twelve modules. A plain Set
// notifies nothing on either path, and a ReactiveSet that some later
// assignment quietly replaced with a plain Set would stop notifying with no
// error anywhere: the panels would simply go stale.
//
// So reactivity is installed on the *field*, not left to the call sites. The
// setter coerces whatever it is handed into a ReactiveSet, which means every
// existing `App.sigma = new Set(...)` keeps working untouched and cannot
// downgrade the field. `.add`/`.delete`/`.clear`/`.has`/`.size`/spread are
// unchanged, and ReactiveSet is a real `instanceof Set`, so the shape tests in
// normalizeBoundarySymbolsForMachine still hold.
//
// The setter builds a NEW set rather than refilling the existing one. That is
// load-bearing: exportWithOverrides in js/export-core.js saves App.accepts,
// assigns a temporary, and restores the saved reference in a finally — refilling
// in place would empty the very object it saved and lose the machine's real
// accept marks.
function installReactiveSetField(obj, key) {
  let backing = obj[key] instanceof ReactiveSet
    ? obj[key]
    : new ReactiveSet(obj[key] || []);
  Object.defineProperty(obj, key, {
    get() { return backing; },
    set(v) { backing = v instanceof ReactiveSet ? v : new ReactiveSet(v || []); },
    enumerable: true,
    configurable: true
  });
}

// The CFG view's variable set, with the same protection. Built by a function
// because App.grammar is reassigned wholesale on load and on reset, and a
// grammar whose vars were a plain Set would be a silently dead panel.
function makeGrammar(vars = ['S'], start = 'S', productions = []) {
  const g = { vars: new ReactiveSet(vars), start, productions };
  installReactiveSetField(g, 'vars');
  return g;
}

export const App = {
  machine: 'DFA', tool: 'move', view: 'build',
  sigma: new ReactiveSet(['a', 'b']),
  outputAlpha: new ReactiveSet(['0', '1']),
  stackAlpha: new ReactiveSet(['Z']), // will be sync'd in init
  tapeCount: 2,
  states: [], transitions: [],
  startId: null, accepts: new ReactiveSet(),
  selectedStates: new ReactiveSet(),
  selectedTransitions: new ReactiveSet(),
  stateN: 0, transN: 0,
  // What this machine *is*, in the author's own words — the info card over the
  // canvas. `null` when nothing has been said about it, which is the state a
  // blank canvas starts in and the state loading an undescribed file returns
  // it to. Shape: { title, blurb, inputs: [{ w, expect, label, out }] }.
  //
  // It lives on App rather than in js/persistence.js — where it was module
  // state — because it is document content: exportWorkspaceState carries it
  // between tabs, getWorkspaceData writes it to the .json, and serializeState
  // puts it on the undo stack. A description that survived neither a save nor
  // a tab switch is one nobody would bother writing.
  meta: null,
  // Canvas notes (comments), anchored to states/transitions or free-floating
  notes: [], noteN: 0,
  activeNoteId: null,
  // Notes, dividers and regions are selected exactly the way states and
  // transitions are: their own id sets, filled by click / shift-click /
  // marquee / select-all and emptied by Escape. Anything on the canvas is an
  // object you can pick, move as a group, and Delete.
  selectedNotes: new ReactiveSet(),
  ctxNoteId: null, editNoteId: null,
  resizeNoteId: null, resizeNoteStart: null,
  // Canvas dividers (annotation line segments that partition the canvas)
  dividers: [], dividerN: 0,
  selectedDividers: new ReactiveSet(),
  ctxDividerId: null, editDividerId: null,
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
    // Whether a Turing machine's tape extends left of its input. This is a
    // property of the tape, not of the machine, so it is a setting rather
    // than a family of extra machine types: it makes TM, NDTM and MTM
    // two-way exactly as ITM already is. Textbooks and JFLAP both take the
    // two-way tape as standard; the app's default stays bounded so an
    // existing machine keeps deciding what it decided.
    twoWayTape: false,
    // How many tapes a multi-tape machine may be given. The arity itself is
    // not capped by the app — see clampTapeCount — this is the reader's own
    // ceiling, so the picker offers a list worth reading rather than every
    // number up to the hard limit. Settings → Turing.
    maxTapeCount: 8,
    maxPdaSteps: 2000,
    maxTmSteps: 10000,
    // Whether the step-by-step tape simulators stop at a repeated
    // configuration. On, a machine that provably never halts is *decided* —
    // it will repeat forever, so the word is not accepted. Off, it runs to
    // maxTmSteps and reports no verdict, which is what you want when the
    // machine not halting is the thing you came to watch. See detectsLoops().
    detectLoops: true,
    // How a run is produced: see runsLazily() below. 'auto' is the default and
    // absent reads as 'auto', the same rule the render flags follow, so a
    // workspace or settings profile written before this existed does not load
    // pinned to one strategy.
    execMode: 'auto',
    // Per-word budget for the Language panel's fingerprint. Deliberately
    // far smaller than maxTmSteps: the fingerprint runs one simulation per
    // cell, so this is multiplied by ~127. Words that exhaust it are drawn
    // as "no verdict" rather than as rejects.
    langStepBudget: 400,
    autoSpeed: 500,
    autosaveIntervalMs: 15000,
    // How long the info card waits before folding back into its (i) button,
    // after the *app* opened it on a load or a StateMate run. A card the reader
    // opened never times out at all, and 0 here means neither one does.
    cardAutoHideMs: 13000,
    radius: 30,
    zoom: { min: 0.2, max: 3, step: 0.1 },
    wheelZoom: true,
    snapToGrid: false,
    wrapStateLabels: true,
    edgeLabelStyle: 'compact', // 'compact' | 'pills' | 'beginner' | 'none'
    clickHighlightMode: 'off', // 'off' | 'outgoing' | 'incoming'
    layout: { minRadius: 80, nodeSpacing: 35, algorithm: 'sugiyama' },
    gridSnap: 20,
    sym: { eps: 'ε', any: 'Σ', blank: '⊔', leftMarker: '⊢', rightMarker: '⊣', stackBottom: 'Z', lambda: 'λ' },
    pdaParadigm: 'explicit',
    // PFA acceptance is Rabin's cut-point rule: w ∈ L iff P(w) > cutPoint. The
    // comparison is strict, which is what makes the cut-point "isolated" notion
    // meaningful; 0 recovers the plain "some accepting run has positive
    // probability" reading and matches the NFA the weights sit on top of.
    pfaCutPoint: 0.5,
    statePrefix: 'q',
    render: {
      startArrowLen: 28,
      selfLoopSize: 22,
      selfLoopOff: 12,
      selfLoopTextOff: 30,
      curveOff: 45,
      arrowHeadSize: 6,
      textMargin: 8,
      mooreTextMargin: 9,
      // Collision avoidance (js/geometry.js). The three flags switch off the
      // three passes independently; the distances are what "clear of" means.
      nodeClearance: 12,       // space an edge or label leaves around a state
      labelGap: 5,             // space a label leaves around anything else
      minNodeGap: 8,           // space between two state circles after a drop
      smartSelfLoops: true,    // put a loop where the node's surroundings allow
      autoRouteEdges: true,    // bend an edge around a state in its way
      smartLabels: true,       // move a label off whatever it would sit on
      avoidNodeOverlap: true,  // separate states dropped on top of each other
      // Display-only easing on the way to the DOM (js/anim.js). The stages above
      // pick their winner from a discrete candidate set, so a one-pixel pointer
      // move can flip a decision; this glides the drawing to the new one instead
      // of teleporting. Targets are unaffected.
      animateLayout: true,
      // Whether the app may simplify itself once the machine is past what a
      // frame can draw in full. See largeMachineProfile() below for what that
      // turns off, and why it is one answer rather than six more settings.
      largeMachineAuto: true
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
  // `simInput` is the word the steps in `simSteps` were produced from. It is
  // what lets the run button tell "resume this run" from "start a new one":
  // pausing and playing again must not silently re-run from step 0, and
  // editing the run box before pressing play must not silently resume the
  // previous word. See handleRunBtnClick.
  // `simRun` is the cursor producing `simSteps` — see js/machines/run.js. The
  // steps array is the cursor's own, so the two are one object graph rather
  // than two copies; `simDrainTimer` is the sliced "go to the end".
  simSteps: [], simIdx: 0, simInput: null, autoTimer: null,
  simRun: null, simDrainTimer: null,
  // Grammar
  grammar: makeGrammar(),
  // Current algo
  currentAlgo: 'table',
  // DOM Cache for performance
  domCache: { states: new Map(), transitions: new Map(), notes: new Map(), dividers: new Map(), startArrow: null },
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

// Installed after the literal, so the fields above read as plain declarations
// and the reactive machinery is stated once rather than nine times.
for (const key of [
  'sigma', 'outputAlpha', 'stackAlpha', 'accepts',
  'selectedStates', 'selectedTransitions', 'selectedNotes', 'selectedDividers'
]) installReactiveSetField(App, key);

// The graph lookup the machine layer runs on. It lived in
// states-transitions.js beside getTransition/getEdgeTransitions, which is a UI
// module — so every simulator importing it dragged canvas.js and render.js in
// behind it, and the machine layer could not be evaluated without a document.
// It reads App.states and nothing else, so it belongs in the leaf that owns
// App. states-transitions.js re-exports it, and every call site is unchanged.
// A linear scan here is the app's single most-multiplied cost: 112 call sites,
// several of them inside per-transition or per-frame loops, so on a 1000-state
// machine one render pass alone spent millions of comparisons resolving ids the
// caller already had. The index is a plain id → state Map, rebuilt lazily.
//
// Nothing in the app announces that App.states changed — it is pushed to,
// filtered and wholesale reassigned from twenty places — so the index validates
// itself instead of being invalidated. Array identity plus length plus the
// identity of the two end elements catches every mutation the app actually
// performs (push, splice, filter, reassign); the one shape it could miss,
// replacing an element in place at the same index, no call site does.
let _idxMap = null, _idxArr = null, _idxLen = -1, _idxFirst = null, _idxLast = null;

function stateIndex() {
  const arr = App.states || [];
  const n = arr.length;
  if (_idxArr === arr && _idxLen === n && _idxFirst === arr[0] && _idxLast === arr[n - 1]) return _idxMap;
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(arr[i].id, arr[i]);
  _idxMap = map; _idxArr = arr; _idxLen = n; _idxFirst = arr[0]; _idxLast = arr[n - 1];
  return map;
}

export function getState(id) { return stateIndex().get(id); }

// The same index, for callers that resolve many ids at once (the layout pass,
// the minimap, the exporters) and would otherwise each build their own copy.
export function stateById() { return stateIndex(); }

// Tests and the workspace loader replace App.states behind the validator's back
// in ways that can coincide on all four checks (an empty array swapped for
// another empty array). Cheap insurance, called from resetApp and loadData.
export function invalidateStateIndex() { _idxArr = null; _idxLen = -1; }

export const SVG_NS = 'http://www.w3.org/2000/svg';
// Mirrors App.config.radius. ES module imports are live for reads but read-only
// for writes, so the one place that changes it (the Settings modal) goes through
// setR rather than assigning across the module boundary.
export let R = App.config.radius;
export function setR(v) { R = v; }
export const $ = id => document.getElementById(id);

// The canvas edge-label styles, and the one place that decides what an unknown
// value means. Settings reads it, writes it and exports it, and render.js and
// geometry.js branch on it — four literal lists of the valid ids drifted apart
// the moment a fifth style was added, so they all come through here instead.
// 'none' hides the labels altogether: nothing is drawn and, because the label
// box also goes to zero, nothing is laid out around them either.
export const EdgeLabelStyles = ['compact', 'pills', 'beginner', 'none'];

export function normalizeEdgeLabelStyle(style) {
  return EdgeLabelStyles.includes(style) ? style : 'compact';
}

export function edgeLabelsHidden() {
  return App.config.edgeLabelStyle === 'none' || largeMachineProfile();
}

// True when the labels are off because of the machine's size rather than
// because the reader asked for it. That is the only difference the two settings
// surfaces have to explain, and the only thing the override changes.
export function edgeLabelsAutoHidden() {
  return App.config.edgeLabelStyle !== 'none' && largeMachineProfile();
}

// One reader for "is wrapping on", so render.js's label cache cannot key on a
// different answer than the one being drawn.
//
// It deliberately does *not* consult largeMachineProfile(), and that is the
// line the profile is drawn along: the profile turns off what costs frames,
// never what costs nothing. Wrapping is a handful of extra tspans behind the
// cull window — while un-wrapping a name like NEW_ACCOUNT_OPENED overflows its
// circle, on exactly the diagram that is already hardest to read. The profile
// keeps state names, so breaking their layout would be the worst of both.
export function wrapStateLabelsOn() {
  return App.config.wrapStateLabels !== false;
}

// ══════════════════════════════════════════════════════════════════
//  THE LARGE-MACHINE PROFILE
// ══════════════════════════════════════════════════════════════════
// Past a certain size the app stops drawing everything it *could* draw, and
// most of that is already automatic: js/viewport.js windows the DOM and drops
// labels below a zoom, js/geometry.js skips the three avoidance stages,
// js/panel-list.js draws a window rather than a row per item, the trace log
// keeps a tail, the undo stack is capped in bytes, minZoom() lets the camera
// pull back far enough to frame the whole thing. Each of those states its own
// threshold because each is answering its own question.
//
// What was missing was the other half — the costs that scale with the machine
// and were gated on nothing at all:
//
//   * every edge label is built, at any zoom above the LOD threshold, for the
//     whole cull window — which is nine screens of content, so a machine dense
//     enough to be worth culling paints a wall of pills over its own diagram
//   * every edge's geometry is *eased* to its new position after any structural
//     change, so thousands of tracks keep rAF busy until they settle
//   * autosave stringifies every workspace into IndexedDB on a fixed timer,
//     which on a thousand-state machine is megabytes on the main thread
//   * the minimap repaints on every frame of every pan
//
// State-name wrapping is deliberately *not* on that list — see
// wrapStateLabelsOn() for where the line is drawn.
//
// They are turned off by the same fact about the machine, so that fact is
// stated once, here, rather than as five thresholds in five modules.
//
// The line is the collision budget. It was measured rather than guessed (see
// the note over the constants) and "past what a layout pass can afford in a
// frame" is a good definition of "too big to draw in full" — so this reuses it
// instead of introducing a sixth number the others can drift from.
//
// Two properties are what make this safe to switch on by default:
//
//   * It is *derived*, never written. Nothing here touches App.config, so the
//     reader's settings are remembered exactly as they were, the tab is not
//     dirtied, the .json is not rewritten, and lifting the override restores
//     the machine's own appearance with no state to unwind. It also means the
//     profile covers every path into a large machine — a load, an import, a
//     subset construction that blows up on the canvas, an undo back into one —
//     rather than only the one that happened to remember to ask.
//   * The override follows the same rule as the four render flags above:
//     absent means on, so a workspace written before this existed does not
//     load with the profile disabled.
//
// Settings → Canvas and the quick-settings popover both offer the override, and
// both ask before letting you turn it off — on the machines this fires for, the
// result is a canvas you cannot read.

// Where a collision-avoidance pass stops fitting a 60fps frame, timed on a
// deliberately hostile diagram: states packed two diameters apart with edges
// running clear across the field. A machine that size is already unreadable at
// any zoom that shows it whole, so nothing legible is given up. js/geometry.js
// re-exports both, which is where they used to be declared.
export const COLLISION_BUDGET_STATES = 200;
export const COLLISION_BUDGET_TRANSITIONS = 700;

/** Whether this machine is past what the app can draw in full. */
export function machineIsLarge() {
  return (App.states?.length || 0) > COLLISION_BUDGET_STATES
    || (App.transitions?.length || 0) > COLLISION_BUDGET_TRANSITIONS;
}

/** Whether the app is currently simplifying itself for the machine's size. */
export function largeMachineProfile() {
  return App.config?.render?.largeMachineAuto !== false && machineIsLarge();
}

/**
 * What the reader is asked before the profile is switched off, in the numbers
 * of the machine in front of them.
 *
 * Both surfaces that offer the override — Settings → Canvas and the
 * quick-settings popover — spread this into askConfirm() and supply only the
 * handlers, so the same decision cannot be described two ways. It lives here
 * rather than in either of them because this module is the one both can reach:
 * quick-settings.js must not import ui.js.
 */
export function largeMachineOverridePrompt() {
  const st = (App.states?.length || 0).toLocaleString();
  const tr = (App.transitions?.length || 0).toLocaleString();
  return {
    title: 'Are you sure?',
    message: `This machine has ${st} states and ${tr} transitions. Drawing every `
      + 'edge label, easing every layout change and repainting the minimap on every '
      + 'frame will cause extreme stutter. Your '
      + 'settings are kept either way — you can switch this back on at any time.',
    confirmLabel: 'Draw it anyway',
    danger: true
  };
}

// ══════════════════════════════════════════════════════════════════
//  HOW A RUN IS PRODUCED
// ══════════════════════════════════════════════════════════════════
// The app used to precompute every run and then visualize it. The player now
// holds a cursor over the steps instead (js/machines/run.js), which can be
// drained up front — eager, exactly what it always did — or pulled as the
// animation asks for each step.
//
// **The trigger is run length, not machine size, and that distinction is the
// whole of why this is not another thing largeMachineProfile() turns off.**
// The two are close to uncorrelated here: a 1000-state DFA on a 12-symbol word
// is 13 steps and precomputing it is free, while a 3-state Turing machine is
// maxTmSteps steps each carrying a tape snapshot, and it is that one which
// freezes the tab. Keying this on states-and-transitions would switch strategy
// on precisely the machines that never needed it.
//
// So it is projected instead, from the machine's own mechanism and the length
// of the word — both known before the run starts.

/**
 * Machines whose runs are long enough to be worth spreading or streaming.
 *
 * Derived from the capability flags rather than listed by name, because a name
 * list is a thing a machine added to MachineTypes silently falls out of — and
 * the failure is invisible in both directions: no parallelism for a batch, no
 * streaming for a run, nothing raised. Every member of the list this replaced
 * was one of these three shapes.
 *
 * js/parallel/pool.js reads it for its own question ("is one word's work worth
 * a worker?"), which is the same underlying fact stated once.
 */
export function hasExpensiveRuns(m = App.machine) {
  const cfg = getMachineConfig(m);
  return !!(cfg.hasTape || cfg.hasStack || isTwoWayFA(m));
}

// Where materializing a run up front stops being free. Well under the budgets
// the tape machines run to (maxTmSteps is 10,000 by default), because the cost
// is per step object and a tape machine's carries a tape snapshot; well over
// anything a finite automaton reaches on a word a person types.
export const LAZY_STEP_THRESHOLD = 2000;

/**
 * The worst case number of steps this run can materialize.
 *
 * A projection, not a prediction: most runs stop long before it. That is the
 * right side to be wrong on — the decision is whether to pay a cost up front,
 * and a run that turns out short costs nothing extra for having been streamed.
 */
export function projectedRunSteps(m = App.machine, inputLen = 0) {
  const cfg = getMachineConfig(m);
  if (cfg.hasTape) return App.config.maxTmSteps;
  if (cfg.hasStack) return App.config.maxPdaSteps;
  // A two-way head cannot repeat a (state, position) pair without looping, so
  // its run is bounded by the product rather than by the word.
  if (isTwoWayFA(m)) return Math.max(1, inputLen) * Math.max(1, App.states?.length || 1);
  // One step per symbol, plus the start.
  return inputLen + 1;
}

/** 'auto' | 'eager' | 'lazy', with absent reading as 'auto'. */
export function execMode() {
  const m = App.config?.execMode;
  return m === 'eager' || m === 'lazy' ? m : 'auto';
}

/**
 * Whether this run should be pulled rather than precomputed.
 *
 * Auto biases toward streaming when it is uncertain, because the two mistakes
 * are not the same size: streaming a short run costs a few microseconds of
 * generator overhead, while precomputing a long one is the frozen tab this
 * exists to prevent.
 *
 * It is a *policy*. Whether the machine can actually stream is a separate
 * question the run answers for itself (js/machines/run.js) — a search-based
 * simulator arrives complete whatever is set here, and that is honest rather
 * than a fallback, since no prefix of its trace exists before the search ends.
 */
export function runsLazily(inputLen = 0, m = App.machine) {
  const mode = execMode();
  if (mode !== 'auto') return mode === 'lazy';
  return projectedRunSteps(m, inputLen) > LAZY_STEP_THRESHOLD;
}

// ══════════════════════════════════════════════════════════════════
//  MACHINE SHAPE PREDICATES
// ══════════════════════════════════════════════════════════════════
// These read nothing but App and MachineTypes, so they live here rather than in
// utils.js. That keeps state.js free of imports, which in turn lets it evaluate
// before every other module — the app relies on $ and App being initialised by
// the time other modules run their top-level code.
export function getMachineConfig(m) { return MachineTypes[m] || MachineTypes['DFA']; }

// A two-way head over an endmarked, read-only input tape. 2DFT belongs here for
// the same reason 2DFA does — it differs only in emitting output on each move,
// which is the isTransducer flag's business, not the head's.
export function isTwoWayFA(m = App.machine) {
  return m === '2DFA' || m === '2NFA' || m === '2DFT';
}

// Does this machine's tape extend left of its input?
//
// Two sources, because there are two kinds of answer. ITM says so by *being*
// what it is — the type is the claim, and no setting should be able to make a
// "Two-Way Infinite TM" bounded. TM, NDTM and MTM take it from the setting,
// which is what makes a two-way multi-tape machine a tape choice rather than
// a sixth entry in the machine picker.
//
// LBA is excluded deliberately: its tape is bounded at *both* ends by the end
// markers, and that is the machine's definition rather than its tape's.
// ── how many tapes ────────────────────────────────────────────────
// A multi-tape machine's arity used to be the literal 2..4, written out in
// seven places — the picker's markup, the picker's clamp, the wizard's
// clamp, the wizard's validation, the wizard's option list, StateMate's
// schema and its agent tool. Four is not a fact about anything: k tapes are
// k Tape objects and k columns on a transition, and nothing in the
// simulators, the tracker or the save format counts to four.

/** Fewer than two tapes is a single-tape machine, which is a different type. */
export const MIN_TAPES = 2;

/**
 * The hard ceiling, which is a UI limit rather than a theoretical one.
 * Every rule of a k-tape machine is a k-column row and the tracker draws k
 * rows, so this is the point past which the *dialog* stops being usable —
 * the machine layer itself has no opinion.
 */
export const TAPE_LIMIT = 64;

/**
 * The largest arity the reader may choose right now.
 *
 * Never smaller than the machine already on the canvas: the setting bounds
 * what you can pick, never what you can open. A file declaring twelve tapes
 * is a twelve-tape machine whatever this reader's preference says, and a
 * picker that could not show its own machine's arity would be the
 * two-places-for-one-number bug again.
 */
export function maxTapes() {
  const set = Number(App.config?.maxTapeCount);
  const ceiling = Number.isInteger(set) ? Math.min(Math.max(set, MIN_TAPES), TAPE_LIMIT) : 8;
  return Math.max(ceiling, clampTapeCount(App.tapeCount));
}

/** Any integer arity, held inside the bounds the app can actually draw. */
export function clampTapeCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return MIN_TAPES;
  return Math.max(MIN_TAPES, Math.min(TAPE_LIMIT, v));
}

export function usesTwoWayTape(m = App.machine) {
  if (m === 'LBA') return false;
  return !!getMachineConfig(m).twoWayTape || !!App.config.twoWayTape;
}


// Does the step-by-step simulator stop when a tape machine repeats a
// configuration?
//
// A deterministic machine that revisits a configuration will revisit it
// forever, so stopping there reports a *proven* non-halt rather than a
// timeout — which is strictly more than the step budget can tell you, and why
// this is on by default. Turning it off is a playback choice: the machine runs
// to maxTmSteps and the verdict degrades from "never halts" to "no verdict".
//
// **Absent reads as on.** A workspace or settings profile saved before this
// setting existed must not load as one with detection switched off — the same
// rule the four App.config.render flags follow.
export function detectsLoops() {
  return App.config.detectLoops !== false;
}

export function isEndmarkerMachine(m = App.machine) {
  return !!getMachineConfig(m).hasEndMarkers;
}

// Edges carry a probability and a run is a distribution over Q, not one state.
export function isWeightedFA(m = App.machine) {
  return !!getMachineConfig(m).isWeighted;
}

// Reads an infinite (ultimately periodic) word; acceptance is a property of the
// run's cycle, so there is no final configuration to inspect.
export function isOmegaAutomaton(m = App.machine) {
  return !!getMachineConfig(m).isOmega;
}

// The α the current machine carries. Always a valid key — a type without an
// explicit condition (or a workspace naming one this build does not know) reads
// back as Büchi rather than as undefined.
export function omegaAcceptanceOf(m = App.machine) {
  const id = getMachineConfig(m).omegaCondition;
  return OmegaAcceptance[id] ? id : 'buchi';
}

// True when α is a per-state priority rather than a subset of Q. This is what
// swaps the accepting ring for a number on the node, so it gates rendering and
// the state modal as well as the verdict.
export function usesParityPriorities(m = App.machine) {
  return isOmegaAutomaton(m) && OmegaAcceptance[omegaAcceptanceOf(m)].usesPriority;
}

// δ must be single-valued. Only the four D-types answer true, and only under
// Büchi does the restriction cost languages.
export function isDeterministicOmega(m = App.machine) {
  const cfg = getMachineConfig(m);
  return !!cfg.isOmega && !!cfg.deterministic;
}

// Priorities are small non-negative integers; anything missing or malformed
// reads as 0, which is even and therefore the permissive default.
export function statePriority(s) {
  const p = Number(s?.priority);
  return Number.isInteger(p) && p >= 0 ? p : 0;
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
    meta: App.meta ? JSON.parse(JSON.stringify(App.meta)) : null,
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

/**
 * An empty workspace: what a new tab starts as, and what Clear returns to.
 *
 * There were two of these and they disagreed. The new-tab literal in
 * `ui.js` reset the machine, all three alphabets, the tape count, the
 * camera and the grammar; `performClear()` emptied the graph and left every
 * one of them standing — so Clear handed back a canvas that still carried
 * the previous machine's Σ and Γ, the old grammar in the Grammar view, and
 * the camera parked wherever the deleted diagram used to be, which reads as
 * a blank *screen* rather than a blank workspace. One definition, so
 * "empty" cannot mean two things.
 */
export function blankWorkspaceData() {
  return {
    machine: 'DFA', sigma: ['a', 'b'], outputAlpha: ['0', '1'], stackAlpha: ['Z'],
    tapeCount: MIN_TAPES,
    states: [], transitions: [], startId: null, accepts: [], stateN: 0, transN: 0,
    notes: [], noteN: 0, dividers: [], dividerN: 0, meta: null,
    cam: { x: 0, y: 0, z: 1 },
    history: [], future: [], grammar: { vars: ['S'], start: 'S', productions: [] }
  };
}

export function importWorkspaceState(data) {
  App.machine = data.machine || 'DFA';
  App.sigma = new Set(data.sigma || ['a', 'b']);
  App.outputAlpha = new Set(data.outputAlpha || ['0', '1']);
  App.stackAlpha = new Set(data.stackAlpha || ['Z']);
  App.tapeCount = clampTapeCount(data.tapeCount || MIN_TAPES);
  App.states = data.states || [];
  App.transitions = data.transitions || [];
  App.startId = data.startId || null;
  App.accepts = new Set(data.accepts || []);
  App.stateN = data.stateN || 0;
  App.transN = data.transN || 0;
  App.meta = data.meta || null;
  App.notes = data.notes || [];
  App.noteN = data.noteN || 0;
  App.dividers = data.dividers || [];
  App.dividerN = data.dividerN || 0;
  App.selectedNotes.clear();
  App.selectedDividers.clear();
  App.cam = data.cam || { x: 0, y: 0, z: 1 };
  App.history = data.history || [];
  App.future = data.future || [];
  if (data.grammar) {
    App.grammar.vars = new Set(data.grammar.vars);
    App.grammar.start = data.grammar.start;
    App.grammar.productions = data.grammar.productions || [];
  } else {
    App.grammar = makeGrammar();
  }
  if (data.config) {
    // `theme` and the `export` palette it drives are an app-wide preference,
    // restored from localStorage at boot — not something a tab owns. They ride
    // along in the blob because exportWorkspaceState serialises App.config
    // wholesale, and letting them land would undo applyTheme: the page keeps
    // the theme you chose while the canvas, the minimap and every PNG export
    // silently repaint in whichever palette the tab was last saved under.
    const { sym, theme, export: savedExport, ...loadedConfig } = data.config;
    App.config = { ...App.config, ...loadedConfig, sym: { ...App.config.sym, ...(sym || {}) } };
    // R mirrors config.radius for the modules that imported it, and replacing
    // config wholesale does not update it. Without this a tab saved at a
    // different radius draws its states at the previous tab's size.
    setR(App.config.radius);
  }

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
