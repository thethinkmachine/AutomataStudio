// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — SPEC → CANDIDATE
// ══════════════════════════════════════════════════════════════════
//  Turns a validated spec into a workspace object of exactly the shape
//  loadData() consumes, and reports what changed on the way.
//
//  The whole point of this stage is identity. A spec names states; the
//  compiler matches those names against what is already on the canvas, and
//  anything that matches keeps:
//
//      its id          so notes anchored to it stay anchored
//      its x / y       so an edit does not rearrange the diagram
//      its curve       so a hand-tuned bend or self-loop angle survives
//
//  Only genuinely new states get placed, and they are placed next to the
//  states they connect to rather than by re-running the whole layout. That
//  is the difference between "add a trap state" adding one circle and
//  "add a trap state" reshuffling everything you had arranged.
//
//  Nothing here touches App. It reads a snapshot in, hands a candidate
//  back, and the caller decides whether it is ever applied.

import { circularLayout, sugiyamaLayout } from './canvas.js';
import { resolveNodeOverlaps } from './geometry.js';
import { NOTE_WIDTH as NOTE_COLUMN_WIDTH } from './notes.js';
import { App, getMachineConfig, stateNameKey, usesParityPriorities } from './state.js';
import { machineSupportsBlocks } from './machines/index.js';
import { TRANSITION_KEY_MAP, machineToSpec, specTransitionLabel } from './statemate-spec.js';

/** The live machine in the internal shape the compiler diffs against. */
export function currentMachineSnapshot() {
  return {
    machine: App.machine,
    states: App.states.map(s => ({ ...s })),
    transitions: App.transitions.map(t => ({ ...t })),
    startId: App.startId,
    accepts: [...App.accepts],
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    notes: (App.notes || []).map(n => ({ ...n })),
    dividers: (App.dividers || []).map(d => ({ ...d })),
    // Blocks are carried because the compiler *diffs* against this, and a
    // dimension it cannot see is a dimension it silently destroys. Every state
    // it rebuilt used to arrive with no `blockId`, so `blockIsIntact` failed on
    // every record and `pruneBlocks` dropped the whole hierarchy — on a no-op
    // round trip through the wizard as readily as on a model's edit.
    blocks: (App.blocks || []).map(b => ({ ...b, exits: (b.exits || []).map(e => ({ ...e })) })),
    scope: [...(App.scope || [])]
  };
}

// Names are matched leniently — case and inner whitespace are not identity.
// "Even" and "even" are the same state to a reader, and treating them as two
// is how an edit silently duplicates half the diagram.
//
// Re-exported because the wizard and js/blocks.js both have to agree with this
// function about what counts as the same state: the wizard refuses two states
// whose names collide *here* rather than two whose names differ as strings, and
// blocks.js uniquifies an inlined interior against it. Two copies of the rule is
// exactly how a rename in one surface would silently merge two states in
// another — so the declaration itself moved to js/state.js, which every one of
// them can reach without dragging canvas.js in behind it.
export { stateNameKey };
const nameKey = stateNameKey;

// NUL, because no transition field can contain one: a symbol with a space in
// it would otherwise run into the next field and two different transitions
// would share a key.
//
// Written as an escape, and that is the whole of the note. As a literal byte it
// made this file **binary to git** -- no diff, no blame, no review, "Binary
// files differ" for every change ever made to the compiler, for the sake of one
// separator character.
const KEY_SEP = '\u0000';

function transitionKey(t) {
  return [t.from, t.to, t.symbol, t.pop, t.push, t.pop2, t.push2, t.below, t.above, t.write, t.dir, t.output]
    .map(v => (v === undefined || v === null ? '' : String(v)))
    .join(KEY_SEP);
}

// ══════════════════════════════════════════════════════════════════
//  PLACEMENT
// ══════════════════════════════════════════════════════════════════

function boundsOf(states) {
  if (!states.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  states.forEach(s => {
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y);
  });
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/**
 * Place the states that have no coordinates yet.
 *
 * Two cases, and they want different treatment:
 *
 *   nothing survived   → this is a new machine. Run the real layout.
 *   some survived      → this is an edit. Leave every placed state exactly
 *                        where it is and drop each new one at the centroid
 *                        of the neighbours it connects to, then separate.
 */
function placeNewStates(states, transitions, startId) {
  const unplaced = states.filter(s => !Number.isFinite(s.x) || !Number.isFinite(s.y));
  if (!unplaced.length) return;

  const placed = states.filter(s => Number.isFinite(s.x) && Number.isFinite(s.y));

  if (!placed.length) {
    if (App.config.layout.algorithm === 'circular') circularLayout(states);
    else sugiyamaLayout(states, transitions, startId);
    return;
  }

  const byId = new Map(states.map(s => [s.id, s]));
  const neighbours = new Map(states.map(s => [s.id, new Set()]));
  transitions.forEach(t => {
    if (t.from === t.to) return;
    neighbours.get(t.from)?.add(t.to);
    neighbours.get(t.to)?.add(t.from);
  });

  const box = boundsOf(placed);
  const step = 2 * (App.config.radius || 30) + (App.config.layout.nodeSpacing || 35);

  // Repeat until nothing more can be resolved: a new state whose only
  // neighbour is another new state gets placed on the second pass, once that
  // one has a position of its own.
  let progress = true;
  while (progress) {
    progress = false;
    for (const s of unplaced) {
      if (Number.isFinite(s.x)) continue;
      const anchors = [...(neighbours.get(s.id) || [])]
        .map(id => byId.get(id))
        .filter(n => n && Number.isFinite(n.x));
      if (!anchors.length) continue;
      const cx = anchors.reduce((a, n) => a + n.x, 0) / anchors.length;
      const cy = anchors.reduce((a, n) => a + n.y, 0) / anchors.length;
      // Offset below the centroid rather than onto it, so the separation pass
      // below has a direction to work with instead of a pile.
      s.x = cx;
      s.y = cy + step;
      progress = true;
    }
  }

  // Anything still unplaced is disconnected from the existing diagram; park it
  // in a row under the machine rather than at the origin, which is usually
  // somewhere inside it.
  let orphanX = box.minX;
  unplaced.forEach(s => {
    if (Number.isFinite(s.x)) return;
    s.x = orphanX;
    s.y = box.maxY + step * 1.5;
    orphanX += step;
  });

  // Only the new states may move — the crowd stays put, which is the same
  // contract canvas.js uses when a drag is dropped.
  resolveNodeOverlaps(states, { movable: unplaced.map(s => s.id) });
}

// ══════════════════════════════════════════════════════════════════
//  COMPILE
// ══════════════════════════════════════════════════════════════════

/**
 * @param {object} spec      a spec that has been through validateSpec
 * @param {object} [current] the machine to diff against; defaults to the live one
 * @returns {{candidate: object, diff: object}}
 */
export function compileSpec(spec, current = currentMachineSnapshot(), { scope = null } = {}) {
  const machine = spec.machine;
  const cfg = getMachineConfig(machine);
  const parity = usesParityPriorities(machine);

  // A machine-type change makes the old diagram a different kind of object, so
  // identity is only inherited within one type. Positions could survive it, but
  // the accepting marks and the transition fields cannot, and half-inheriting
  // is worse than starting clean.
  const sameMachine = current.machine === machine;
  const previous = sameMachine
    ? current
    : { ...current, states: [], transitions: [], accepts: [], blocks: [], scope: [] };

  // ── blocks ──
  // **Absent means unchanged** — the rule the four `App.config.render` flags
  // follow. A spec that says nothing about the hierarchy has not asked for it
  // to go, so the records are carried and the reused states keep their
  // `blockId`. A spec that *does* declare blocks is authoritative, and its
  // entries are matched to the existing records **by path** so a block the
  // model left alone keeps its id — and with the id, its box, its position and
  // its hand-placed port offsets.
  //
  // Path, not name: a block name is unique among its siblings only, so "add"
  // under the ALU and "add" under the FPU are two blocks with one name. The
  // dialect addresses them the way it addresses states, which are already
  // paths.
  const blocksAllowed = sameMachine && machineSupportsBlocks(machine);
  const specBlocks = blocksAllowed && Array.isArray(spec.blocks) ? spec.blocks : null;
  const oldBlockPaths = pathsOf(previous.blocks || []);
  const oldBlocksByPath = new Map();
  (previous.blocks || []).forEach(b => oldBlocksByPath.set(nameKey(oldBlockPaths.get(b.id) || b.name), b));
  let blockN = Math.max(0, ...(current.blocks || []).map(b => idNumber(b.id)));
  const specBlockId = new Map();      // spec block path -> record id
  const specBlockIdOf = new Map();    // state name      -> record id
  if (specBlocks) {
    specBlocks.forEach(b => {
      const prior = oldBlocksByPath.get(nameKey(b.name));
      specBlockId.set(b.name, prior ? prior.id : 'b' + (++blockN));
    });
    // A state names its container; the container names no members back, so
    // this is read off the states rather than off a list the two could
    // disagree about.
    spec.states.forEach(s => {
      if (s.block && specBlockId.has(s.block)) specBlockIdOf.set(s.name, specBlockId.get(s.block));
    });
  }

  const oldByName = new Map();
  (previous.states || []).forEach(s => oldByName.set(nameKey(s.name || s.id), s));
  const oldCurves = new Map();
  (previous.transitions || []).forEach(t => {
    if (t.curve !== undefined || t.loopAngle !== undefined) {
      oldCurves.set(transitionKey(t), { curve: t.curve, loopAngle: t.loopAngle });
    }
  });

  // Ids continue the workspace's own counters so a compiled machine can be
  // merged into an existing one without collision.
  let stateN = Math.max(0, ...(current.states || []).map(s => idNumber(s.id)));
  let transN = 0;

  const nameToId = new Map();
  const reused = new Set();

  const states = spec.states.map(spec_s => {
    const prior = oldByName.get(nameKey(spec_s.name));
    const id = prior ? prior.id : 's' + (++stateN);
    if (prior) reused.add(prior.id);
    nameToId.set(spec_s.name, id);

    const out = { id, name: spec_s.name };
    if (prior && Number.isFinite(prior.x) && Number.isFinite(prior.y)) {
      out.x = prior.x;
      out.y = prior.y;
    }
    // Which block a state is in survives an edit the way its id, position and
    // curves do — a state the model left alone has not moved out of the
    // subroutine it was written for. When the spec declares blocks of its own
    // that answer wins; otherwise this is the whole of what keeps a hierarchy
    // alive across a turn.
    const container = specBlocks ? (specBlockIdOf.get(spec_s.name) || null) : (prior?.blockId ?? null);
    if (container) out.blockId = container;
    if (machine === 'Moore') out.output = spec_s.out ?? '';
    if (parity) out.priority = spec_s.priority ?? 0;
    return out;
  });

  const transitions = spec.transitions.map(spec_t => {
    const t = {
      id: 't' + (++transN),
      from: nameToId.get(spec_t.from),
      to: nameToId.get(spec_t.to)
    };
    for (const [specKey, internalKey] of Object.entries(TRANSITION_KEY_MAP)) {
      if (spec_t[specKey] !== undefined) t[internalKey] = spec_t[specKey];
    }
    const kept = oldCurves.get(transitionKey(t));
    if (kept) {
      if (kept.curve !== undefined) t.curve = kept.curve;
      if (kept.loopAngle !== undefined) t.loopAngle = kept.loopAngle;
    }
    return t;
  });

  const startSpec = spec.states.find(s => s.start);
  let startId = startSpec ? nameToId.get(startSpec.name) : (states[0]?.id ?? null);
  let accepts = parity ? [] : spec.states.filter(s => s.accept).map(s => nameToId.get(s.name));

  placeNewStates(states, transitions, startId);

  // ── a scoped edit governs one block and leaves the rest of the machine ──
  //
  // The hazard this exists for is silent and total. When the reader is inside a
  // block, the model is shown *that block* — see scopedSource() — so the spec
  // that comes back names only the block's states. Diffed against the whole
  // machine, every state outside it is a state the spec did not mention, which
  // is a state the edit removed: asking a question about the adder would have
  // deleted the processor around it, in one undoable step nobody would think to
  // press.
  //
  // So the diff is *bounded* to the subtree. Everything outside is carried
  // through untouched, including its ids, its coordinates and its curves —
  // which is the same promise compileSpec already makes about a state the
  // model left alone, applied one level up.
  if (scope) {
    const kept = keepOutsideScope(previous, scope, accepts, states, transitions);
    startId = kept.startId ?? startId;
    accepts = kept.accepts;
  }

  // The block records outside the cut, for the same reason the states are: the
  // model was not shown them, so it cannot have asked for them to go.
  const blocksOutsideScope = scope
    ? (previous.blocks || [])
      .filter(b => !new Set(scope.subtree || []).has(b.id))
      .map(b => ({ ...b, exits: (b.exits || []).map(e => ({ ...e })) }))
    : [];

  // Notes anchored to a state that survived stay anchored; the model's own
  // notes are appended with their anchor resolved by name.
  const keptNotes = (previous.notes || [])
    .filter(n => !Array.isArray(n.anchorStates) || n.anchorStates.every(id => reused.has(id)))
    .map(n => ({ ...n }));
  let noteN = Math.max(0, ...keptNotes.map(n => idNumber(n.id)));
  // Notes go beside the finished diagram, not at a fixed world position — the
  // layout puts a new machine near the origin, so a note at (30, 60) lands on
  // top of it. Placing them in a column to the left keeps the leader lines
  // short and leaves the machine itself unobstructed.
  const box = boundsOf(states);
  const noteGap = 2 * (App.config.radius || 30) + 40;
  const newNotes = (spec.notes || []).map((n, i) => ({
    id: 'n' + (++noteN),
    x: box.minX - NOTE_COLUMN_WIDTH - noteGap,
    y: box.minY + i * 190,
    color: i === 0 ? 'blue' : 'green',
    anchorStates: n.anchor && nameToId.has(n.anchor) ? [nameToId.get(n.anchor)] : [],
    anchorTransitions: [],
    text: n.text
  }));

  const candidate = {
    machine,
    sigma: [...spec.sigma],
    states,
    transitions,
    startId,
    accepts,
    blocks: specBlocks
      ? specBlocks.map(b => ({
        id: specBlockId.get(b.name),
        // The record keeps the *local* name. A path is derived from the tree
        // and written into the interior state names once, at inline time; a
        // record holding the path would write it down twice, and the two
        // disagree the moment a parent is renamed. See localStateName().
        name: localOf(b.name),
        // A parent the spec did not declare is still a parent: inside `ALU/ADD`
        // the model is shown ADD and CARRY, and ALU is above the cut. Resolved
        // against the existing records so the block stays where it is rather
        // than floating to the top level.
        parent: b.parent
          ? (specBlockId.get(b.parent) ?? oldBlocksByPath.get(nameKey(b.parent))?.id ?? null)
          : null,
        entry: nameToId.get(b.entry) ?? null,
        exits: (b.exits || [])
          .map(e => ({ id: nameToId.get(e.state), label: e.label }))
          .filter(e => e.id),
        // Geometry is the reader's, never the model's. A block that already
        // exists keeps the box it was drawn at; a new one is given none and
        // blockSize() derives one from what is inside it.
        ...pickGeometry(oldBlocksByPath.get(nameKey(b.name)))
      })).filter(b => b.entry)
      // No declaration means no change. The records are handed back as they
      // were and validated on read: a block the edit gutted fails
      // blockIsIntact() and is pruned by machinery that already runs, so
      // nothing here has to work out which ones survived.
      : (blocksAllowed ? (previous.blocks || []) : [])
        .map(b => ({ ...b, exits: (b.exits || []).map(e => ({ ...e })) })),
    // Merged below when the edit was scoped: a spec that declares blocks is
    // authoritative over *what it was shown*, which inside a block is that
    // block's subtree and not the tree above it.
    __outsideBlocks: blocksOutsideScope,
    scope: [...(previous.scope || [])],
    notes: [...keptNotes, ...newNotes],
    dividers: (previous.dividers || []).map(d => ({ ...d })),
    meta: {
      title: spec.title,
      blurb: spec.blurb,
      inputs: (spec.tests || []).map(t => ({ w: t.w, expect: t.expect, out: t.out }))
    }
  };

  // Folded in and the marker removed, so the candidate's shape is the one every
  // consumer already knows. Done here rather than inline above because the two
  // branches of `blocks:` would each have needed it.
  if (candidate.__outsideBlocks?.length) {
    const have = new Set(candidate.blocks.map(b => b.id));
    candidate.blocks = [...candidate.blocks, ...candidate.__outsideBlocks.filter(b => !have.has(b.id))];
  }
  delete candidate.__outsideBlocks;

  if (cfg.hasStack) candidate.stackAlpha = [...(spec.stackAlpha || [])];
  if (cfg.isTransducer) candidate.outputAlpha = [...(spec.outputAlpha || [])];
  if (machine === 'MTM') candidate.tapeCount = spec.tapeCount || current.tapeCount || 2;

  return { candidate, diff: computeDiff(current, candidate, { reused }) };
}

function idNumber(id) {
  const m = String(id || '').match(/(\d+)/g);
  return m ? Math.max(...m.map(Number)) : 0;
}

/**
 * Fold a scoped edit back into the machine around it.
 *
 * Mutates `states` and `transitions` in place — they are the arrays being
 * assembled for the candidate, and building a third copy of a thousand-state
 * machine to concatenate onto is work for nothing.
 *
 * Three rules, and the third is the one that is easy to get wrong:
 *
 *   - a state outside the subtree is carried verbatim
 *   - a transition with both ends outside is carried verbatim
 *   - a transition that *crosses* the boundary is carried only if the end
 *     inside still exists. The model was never shown the outside end and
 *     cannot have moved it; the inside end it may well have deleted, and a
 *     transition pointing at a state that is gone is an endpoint naming
 *     nothing — saved to the file, counted in the δ list, drawn nowhere.
 */
function keepOutsideScope(previous, scope, insideAccepts, states, transitions) {
  const under = new Set(scope.subtree || []);
  const inside = new Set((previous.states || [])
    .filter(s => s.blockId && under.has(s.blockId)).map(s => s.id));

  const live = new Set(states.map(s => s.id));
  for (const s of previous.states || []) {
    if (inside.has(s.id) || live.has(s.id)) continue;
    states.push({ ...s });
    live.add(s.id);
  }

  let n = transitions.length;
  for (const t of previous.transitions || []) {
    const f = inside.has(t.from), o = inside.has(t.to);
    if (f && o) continue;                       // the spec is the authority here
    if (!live.has(t.from) || !live.has(t.to)) continue;
    transitions.push({ ...t, id: 't' + (++n) });
  }
  // Renumbered as a block so ids stay unique and dense; nothing outside this
  // function has taken a reference to one yet.
  transitions.forEach((t, i) => { t.id = 't' + (i + 1); });

  // The machine's start and its accepting states belong to the machine, not to
  // the block. A scoped spec marks its *entry* as the start, which is true of
  // the block and false of the machine — writing it through would move q0 into
  // a subroutine.
  return {
    // The machine's start belongs to the machine. A scoped spec marks its own
    // *entry* as the start, which is true of the block and false of the machine
    // — written through, it would move q0 into a subroutine.
    startId: live.has(previous.startId) ? previous.startId : null,
    // F is the union: whatever the spec said about the states it governs, plus
    // whatever the machine already said about the ones it does not.
    accepts: [...new Set([
      ...(previous.accepts || []).filter(id => !inside.has(id) && live.has(id)),
      ...insideAccepts
    ])]
  };
}

/**
 * block id -> path, over a snapshot's own records.
 *
 * Computed here rather than asked of blocks.js because the snapshot may not be
 * the canvas — a candidate on the bench has to describe itself, not whatever
 * happens to be on screen. A cycle cannot be built by any path in the app, but
 * a hand-edited file can carry one, so the walk carries its own `seen`.
 */
function pathsOf(blocks) {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const out = new Map();
  const walk = (id, seen) => {
    if (out.has(id)) return out.get(id);
    const b = byId.get(id);
    if (!b || seen.has(id)) return '';
    seen.add(id);
    const parent = b.parent ? walk(b.parent, seen) : '';
    const path = parent ? parent + '/' + b.name : String(b.name || id);
    out.set(id, path);
    return path;
  };
  blocks.forEach(b => walk(b.id, new Set()));
  return out;
}

/** The last segment of a path: the block own name, as the record stores it. */
function localOf(path) {
  const parts = String(path || '').split('/');
  return parts[parts.length - 1] || String(path || '');
}

/** The parts of a block record that belong to the diagram rather than to the spec. */
function pickGeometry(prior) {
  if (!prior) return {};
  const out = {};
  for (const k of ['x', 'y', 'w', 'h', 'ports', 'source', 'version', 'description']) {
    if (prior[k] !== undefined) out[k] = k === 'ports' ? { ...prior[k] } : prior[k];
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  DIFF
// ══════════════════════════════════════════════════════════════════
//  Computed here, where both sides are in hand, rather than reconstructed
//  from the canvas afterwards. It drives the result card, and it is the only
//  way the user finds out that an auto-fix extended Σ or that the machine
//  type changed underneath them.

// A replacing edit on a large machine has hundreds of lines and nobody reads
// past the first screen of them. The counts in summarizeDiff are the honest
// summary; this is the detail, and it is bounded.
const MAX_DIFF_LINES = 200;

/** The facts about a state that a reader would notice changing. */
function stateFacts(s, machine) {
  const bits = [];
  if (s.start) bits.push('start');
  if (usesParityPriorities(machine)) bits.push(`priority ${s.priority ?? 0}`);
  else if (s.accept) bits.push('accepting');
  if (machine === 'Moore') bits.push(`outputs "${s.out ?? ''}"`);
  return bits;
}

function countLabels(labels) {
  const counts = new Map();
  labels.forEach(l => counts.set(l, (counts.get(l) || 0) + 1));
  return counts;
}

/**
 * The diff as lines, the way a diff is normally read.
 *
 * Computed by describing both sides as **specs** rather than by walking the
 * internal objects: machineToSpec already normalizes them, already resolves ids
 * to names, and is already the shape the model was shown — so a line here says
 * the same thing the prompt would. It also means this needs no knowledge of
 * which fields a machine's transitions carry.
 *
 * `op` is '+', '-' or '~'; the glyphs are the UI's business.
 */
function buildDiffLines(before, after, { statesRenamed = [], blocksAdded = [], blocksRemoved = [] } = {}) {
  const b = machineToSpec(before);
  const a = machineToSpec(after);
  const lines = [];
  const add = (op, kind, text) => lines.push({ op, kind, text });

  if (before.machine !== after.machine) {
    add('~', 'machine', `machine  ${before.machine} → ${after.machine}`);
  }

  const alphabet = (label, was, now) => {
    const had = new Set(was || []);
    const has = new Set(now || []);
    (now || []).forEach(sym => { if (!had.has(sym)) add('+', 'alphabet', `${label}  ${sym}`); });
    (was || []).forEach(sym => { if (!has.has(sym)) add('-', 'alphabet', `${label}  ${sym}`); });
  };
  blocksRemoved.forEach(path => add('-', 'block', `block  ${path}`));
  blocksAdded.forEach(path => add('+', 'block', `block  ${path}`));

  alphabet('Σ', b.sigma, a.sigma);
  if (b.stackAlpha || a.stackAlpha) alphabet('Γ', b.stackAlpha, a.stackAlpha);
  if (b.outputAlpha || a.outputAlpha) alphabet('Ω', b.outputAlpha, a.outputAlpha);

  // Renames are keyed by id upstream, where the ids still exist; here the two
  // names are just two names, so the pairing has to be handed in.
  const renamedFrom = new Map(statesRenamed.map(r => [nameKey(r.from), r]));
  const renamedTo = new Map(statesRenamed.map(r => [nameKey(r.to), r]));

  const bStates = new Map(b.states.map(s => [nameKey(s.name), s]));
  const aStates = new Map(a.states.map(s => [nameKey(s.name), s]));

  statesRenamed.forEach(r => add('~', 'state', `state  "${r.from}" → "${r.to}"`));

  b.states.forEach(s => {
    const key = nameKey(s.name);
    if (aStates.has(key) || renamedFrom.has(key)) return;
    add('-', 'state', `state  ${s.name}`);
  });
  a.states.forEach(s => {
    const key = nameKey(s.name);
    if (bStates.has(key) || renamedTo.has(key)) return;
    const facts = stateFacts(s, a.machine);
    add('+', 'state', `state  ${s.name}${facts.length ? `  (${facts.join(', ')})` : ''}`);
  });

  // A state that survived but changed what it is — the accepting mark, the
  // start, a parity priority, a Moore output. Structurally invisible in the
  // counts, and usually the whole point of the edit.
  a.states.forEach(s => {
    const key = nameKey(s.name);
    const was = bStates.get(key) || (renamedTo.has(key) ? bStates.get(nameKey(renamedTo.get(key).from)) : null);
    if (!was || before.machine !== after.machine) return;
    const wasFacts = stateFacts(was, b.machine).join(', ') || 'plain';
    const nowFacts = stateFacts(s, a.machine).join(', ') || 'plain';
    if (wasFacts !== nowFacts) add('~', 'state', `state  ${s.name}  ${wasFacts} → ${nowFacts}`);
  });

  // Transitions are a multiset: two identical arrows are two arrows, and
  // reporting one of a duplicated pair as removed would be a lie.
  const bLabels = b.transitions.map(t => specTransitionLabel(t, b.machine));
  const aLabels = a.transitions.map(t => specTransitionLabel(t, a.machine));
  const bCount = countLabels(bLabels);
  const aCount = countLabels(aLabels);
  const emitted = new Map();
  bLabels.forEach(label => {
    const budget = bCount.get(label) - (aCount.get(label) || 0);
    const done = emitted.get(label) || 0;
    if (done >= budget) return;
    emitted.set(label, done + 1);
    add('-', 'transition', label);
  });
  emitted.clear();
  aLabels.forEach(label => {
    const budget = aCount.get(label) - (bCount.get(label) || 0);
    const done = emitted.get(label) || 0;
    if (done >= budget) return;
    emitted.set(label, done + 1);
    add('+', 'transition', label);
  });

  if (lines.length > MAX_DIFF_LINES) {
    const dropped = lines.length - MAX_DIFF_LINES;
    return lines.slice(0, MAX_DIFF_LINES)
      .concat([{ op: ' ', kind: 'more', text: `… and ${dropped} more change${dropped === 1 ? '' : 's'}` }]);
  }
  return lines;
}

export function computeDiff(before, after, { reused = new Set() } = {}) {
  const beforeStates = before.states || [];
  const afterStates = after.states || [];
  const beforeNames = new Map(beforeStates.map(s => [nameKey(s.name || s.id), s]));
  const afterNames = new Map(afterStates.map(s => [nameKey(s.name || s.id), s]));

  const machineChanged = before.machine !== after.machine;

  const statesAdded = machineChanged
    ? afterStates.map(s => s.name)
    : afterStates.filter(s => !beforeNames.has(nameKey(s.name))).map(s => s.name);
  const statesRemoved = machineChanged
    ? beforeStates.map(s => s.name || s.id)
    : beforeStates.filter(s => !afterNames.has(nameKey(s.name || s.id))).map(s => s.name || s.id);

  // A state that kept its id but changed its name was renamed rather than
  // replaced — worth saying, because the diagram looks different for a reason
  // that is not structural.
  const beforeById = new Map(beforeStates.map(s => [s.id, s]));
  const statesRenamed = machineChanged ? [] : afterStates
    .filter(s => reused.has(s.id) && beforeById.get(s.id) && beforeById.get(s.id).name !== s.name)
    .map(s => ({ from: beforeById.get(s.id).name, to: s.name }));

  const beforeTrans = new Set((before.transitions || []).map(transitionKey));
  const afterTrans = new Set((after.transitions || []).map(transitionKey));
  let transitionsAdded = 0, transitionsRemoved = 0;
  if (machineChanged) {
    transitionsAdded = afterTrans.size;
    transitionsRemoved = beforeTrans.size;
  } else {
    afterTrans.forEach(k => { if (!beforeTrans.has(k)) transitionsAdded++; });
    beforeTrans.forEach(k => { if (!afterTrans.has(k)) transitionsRemoved++; });
  }

  const beforeSigma = new Set(before.sigma || []);
  const sigmaAdded = (after.sigma || []).filter(s => !beforeSigma.has(s));
  const afterSigma = new Set(after.sigma || []);
  const sigmaRemoved = [...beforeSigma].filter(s => !afterSigma.has(s));

  const beforeAccepts = new Set((before.accepts || []).map(id => nameKey(beforeById.get(id)?.name || id)));
  const afterById = new Map(afterStates.map(s => [s.id, s]));
  const afterAccepts = new Set((after.accepts || []).map(id => nameKey(afterById.get(id)?.name || id)));
  const acceptsChanged = machineChanged
    || beforeAccepts.size !== afterAccepts.size
    || [...afterAccepts].some(n => !beforeAccepts.has(n));

  // Blocks are the one dimension the model can change without saying so: the
  // hierarchy is carried through the compiler rather than restated on every
  // turn, so a candidate that deleted a block entry dissolves it silently.
  // This is where both sides are in hand, which is why it is answered here and
  // not in the linter -- that pass is handed the candidate alone, deliberately,
  // so it can lint a machine that is not and may never be on the canvas.
  const beforePaths = pathsOf(before.blocks || []);
  const afterPaths = pathsOf(after.blocks || []);
  const afterBlocks = new Set([...afterPaths.values()].map(nameKey));
  const blocksRemoved = machineChanged
    ? [...beforePaths.values()]
    : [...beforePaths.values()].filter(path => !afterBlocks.has(nameKey(path)));
  const beforeBlocks = new Set([...beforePaths.values()].map(nameKey));
  const blocksAdded = machineChanged
    ? [...afterPaths.values()]
    : [...afterPaths.values()].filter(path => !beforeBlocks.has(nameKey(path)));

  return {
    machineChanged,
    machineFrom: before.machine,
    machineTo: after.machine,
    statesAdded,
    statesRemoved,
    statesRenamed,
    transitionsAdded,
    transitionsRemoved,
    sigmaAdded,
    sigmaRemoved,
    acceptsChanged,
    blocksAdded,
    blocksRemoved,
    lines: buildDiffLines(before, after, { statesRenamed, blocksAdded, blocksRemoved }),
    isEmptyBefore: beforeStates.length === 0,
    unchanged:
      !machineChanged && !statesAdded.length && !statesRemoved.length &&
      !statesRenamed.length && !transitionsAdded && !transitionsRemoved &&
      !sigmaAdded.length && !sigmaRemoved.length && !acceptsChanged &&
      !blocksAdded.length && !blocksRemoved.length
  };
}

/**
 * One chip per dimension, both signs inside it.
 *
 * A replacing edit produces additions *and* removals, and as separate chips
 * that read "+4 states −7 states +8 transitions −14 transitions" — the same
 * two facts said twice, in four pills that wrap onto a second row to do it.
 * Paired, the shape of the edit is legible at a glance: +4 −7 states is a
 * machine that got smaller, and you can see it without reading.
 */
function deltaChip(added, removed, noun) {
  if (!added && !removed) return '';
  const signs = [added ? `+${added}` : '', removed ? `−${removed}` : ''].filter(Boolean).join(' ');
  return `${signs} ${added + removed === 1 ? noun : `${noun}s`}`;
}

/** The diff as the short chips the result card shows. */
export function summarizeDiff(diff) {
  const parts = [];
  if (diff.machineChanged) parts.push(`${diff.machineFrom} → ${diff.machineTo}`);

  const states = deltaChip(diff.statesAdded.length, diff.statesRemoved.length, 'state');
  if (states) parts.push(states);
  if (diff.statesRenamed.length) parts.push(`${diff.statesRenamed.length} renamed`);

  const transitions = deltaChip(diff.transitionsAdded, diff.transitionsRemoved, 'transition');
  if (transitions) parts.push(transitions);

  if (diff.sigmaAdded.length) parts.push(`Σ +${diff.sigmaAdded.join(' ')}`);
  if (!parts.length) parts.push('no change');
  return parts;
}
