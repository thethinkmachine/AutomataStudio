// ══════════════════════════════════════════════════════════════════
//  BUILDING BLOCKS
// ══════════════════════════════════════════════════════════════════
// A block is a subroutine: a Turing machine drawn as one node, whose interior
// is another whole machine. Instead of one enormous diagram that copies a
// string, moves the head, compares two words and then decides, you build four
// machines and wire them together.
//
// ── Inlining is the semantics, not an optimisation ────────────────
// A block adds no computational power. The proof is the expansion: copy the
// sub-machine's states in, rename them, wire the caller's incoming edges to its
// start state and its halting states to the caller's outgoing edges. There is
// no call stack and no return address, which is also why a block may not
// contain itself — that would need a stack of tape positions, which is a
// different machine.
//
// So this module *inlines at placement time*, and `App.states` is always the
// flat machine. That is not a convenience: every simulator, decider, worker and
// exporter in the app reads `App.states` / `App.transitions` / `App.startId` /
// `App.accepts` straight off the module-global `App` (see
// js/parallel/snapshot.js for the exact list), so there is no machine object a
// nested definition could be handed to. Flattening means every one of them —
// loop detection, the step budgets, the tape log, the batch tester, codegen,
// the Language panel, StateMate's verification — keeps working untouched.
//
// What a block adds is a *grouping* over that flat machine:
//
//     App.blocks   one record per placed instance, with a `parent`
//     s.blockId    the immediate container of an interior state
//
// `parent` makes containment a tree, so nesting depth is a walk rather than a
// data structure and there is nothing to bound. A CPU may contain four ALUs,
// each containing an adder, a multiplier and a divider, and none of that
// recurses here.
//
// ── One entry, N named exits ──────────────────────────────────────
// JFLAP's blocks have one implicit exit — control leaves along any outgoing
// edge when any final state is reached — and that cannot express the case this
// feature exists for. "Compare the strings" has to leave one way when they
// match and another when they do not, or the block downstream of it learns
// nothing.
//
// So a block declares an entry (its own start state) and a list of exit ports,
// which default to its accepting states. An exit edge in the host is
// `Σ / Σ, S` — read anything, write back what you read, do not move — which
// every tape machine already understands: js/machines/turing.js reads
// `write === sym.any` as "put back what you read", and `S` is a real direction.
// That is what makes an exit cost a step and consume nothing, and it is why
// blocks are a Turing-family feature: a machine with no stay move cannot leave
// a block without eating a symbol, which would change the language.
//
// A block's accept marks are *dropped* on inline. A block finishing is not the
// machine accepting; the exits record where it finished.
//
// ── Validated on read, never invalidated ──────────────────────────
// `App.states` is pushed to, filtered and reassigned wholesale from around
// twenty places — every algorithm's load path, StateMate's apply, the wizard,
// performClear — and not one of them announces it. That is the same problem
// stateIndex() in js/state.js solves by checking array identity rather than
// being told, and blockIsIntact() is the same answer: a record whose entry,
// exits or members have gone is dropped when it is next read, rather than
// surviving as a node pointing at nothing.
//
// ── Where this sits in the module graph ───────────────────────────
// state.js and machines/index.js only, both of which reach nothing DOM-bound.
// A block is a fact about a machine, so it is testable without a page — and
// stateNameKey deliberately comes from state.js rather than from
// statemate-compile.js, which imports canvas.js.

import {
  App, getState, stateNameKey
} from './state.js';
import {
  isMultiTape, machineDeterminism, machineSupportsBlocks, setTapeArity
} from './machines/index.js';

// The separator between an instance's name and the interior state's own. `/`
// reads as a path in the panel and the formal definition, and it is added to
// splitStateLabel's wrap set so `copy/scan` still breaks over two lines inside
// a circle rather than overflowing it.
export const BLOCK_NAME_SEP = '/';

// Declared on the family in js/machines/turing.js and answered by the registry,
// never by a name check here. Re-exported so a caller reaching for "can this
// machine have blocks" finds it beside the rest of the feature.
export { machineSupportsBlocks };

// ══════════════════════════════════════════════════════════════════
//  IDS AND LOOKUP
// ══════════════════════════════════════════════════════════════════

export function newBlockId() { return 'b' + (++App.blockN); }

// Indexed the way getState is, and validated rather than invalidated for the
// same reason: App.blocks is reassigned by every loader. Blocks are counted in
// tens rather than thousands, but blockPathOf() is called once per step when
// the trace log names which block a run is inside, and that is thousands.
let _bMap = null, _bArr = null, _bLen = -1, _bFirst = null, _bLast = null;

function blockIndex() {
  const arr = App.blocks || [];
  const n = arr.length;
  if (_bArr === arr && _bLen === n && _bFirst === arr[0] && _bLast === arr[n - 1]) return _bMap;
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(arr[i].id, arr[i]);
  _bMap = map; _bArr = arr; _bLen = n; _bFirst = arr[0]; _bLast = arr[n - 1];
  return map;
}

export function getBlock(id) { return blockIndex().get(id) || null; }

/** Test-only, and for the loaders that swap App.blocks for an equal-looking one. */
export function invalidateBlockIndex() { _bArr = null; _bLen = -1; }

// ══════════════════════════════════════════════════════════════════
//  THE TREE
// ══════════════════════════════════════════════════════════════════

/** The states whose immediate container is `id` (null for the top level). */
export function blockMembers(id) {
  const want = id || null;
  return (App.states || []).filter(s => (s.blockId || null) === want);
}

/** The blocks whose immediate container is `id` (null for the top level). */
export function blockChildren(id) {
  const want = id || null;
  return (App.blocks || []).filter(b => (b.parent || null) === want);
}

/**
 * `id` and every block beneath it, parents before children.
 *
 * Guarded against a cycle rather than trusting the tree: a record can arrive
 * from a file, and a `parent` chain that closes on itself would hang the walk
 * rather than reporting anything.
 */
export function blockSubtree(id) {
  const out = [];
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.shift();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const child of blockChildren(cur)) stack.push(child.id);
  }
  return out;
}

/** Every state in `id`'s subtree, however deep. */
export function blockSubtreeStates(id) {
  const ids = new Set(blockSubtree(id));
  return (App.states || []).filter(s => s.blockId && ids.has(s.blockId));
}

/** The chain of containing blocks, outermost first. */
export function blockAncestry(id) {
  const out = [];
  const seen = new Set();
  let cur = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const b = getBlock(cur);
    if (!b) break;
    out.unshift(b);
    cur = b.parent || null;
  }
  return out;
}

/** How deep a block sits. Top-level blocks are depth 0. */
export function blockDepth(id) { return Math.max(0, blockAncestry(id).length - 1); }

/**
 * A state's own name, with the containing blocks' prefix taken off.
 *
 * `s.name` is the full path — inlining prefixes it with the instance's name,
 * and because inlining is transitive a definition's own states already carry
 * theirs, so one prefix per level accumulates into exactly the path. That is
 * what keeps names unique across the machine, which the panel, the formal
 * definition and the compiler's match-by-name all need.
 *
 * But it means the path is written down in two places — the name and the block
 * tree — and the tree is the one that stays right. Renaming a *block* re-derives
 * every path under it without touching a single state, and this is what makes
 * that work: the prefix is stripped when it is there and the name is taken as
 * it stands when it is not, so a state the reader renamed by hand reads as what
 * they typed rather than as a path they never wrote.
 *
 * It is also what a drilled-in view wants to show: inside ALU 2 the states are
 * `scan` and `carry`, not `CPU/ALU 2/add/scan`.
 *
 * The strip is *positional* rather than a match against the current prefix, and
 * that is the whole of what makes a block renameable. Matching the prefix as a
 * string works only while the names still agree with the tree — rename one
 * block and `ALU 7/add` no longer matches `ALU/add/scan`, so nothing is
 * stripped and the path comes back as `ALU 7/add/ALU/add/scan`, which is worse
 * than either answer on its own. The app writes a name of exactly
 * depth + 1 segments, so dropping that many leading segments is the same answer
 * whatever the blocks are called now. A name with fewer segments than that is
 * one the reader typed, and it is left whole.
 */
export function localStateName(s) {
  if (!s) return '';
  const name = String(s.name || '');
  const depth = blockAncestry(s.blockId || null).length;
  if (!depth) return name;
  const parts = name.split(BLOCK_NAME_SEP);
  return parts.slice(Math.min(depth, parts.length - 1)).join(BLOCK_NAME_SEP);
}

/**
 * Where a state lives, as a readable path: `CPU/ALU 2/multiplier/shift-loop`.
 *
 * This is the whole of the debugging story. A step already carries its state
 * id, so naming which block a run is inside — or which block it failed to halt
 * in — is one lookup rather than new machinery in the player.
 *
 * Derived from the tree rather than read off the name, so that renaming a block
 * moves every path under it. See localStateName for why the two cannot simply
 * be the same string.
 */
export function blockPathOf(stateId) {
  const s = getState(stateId);
  if (!s) return '';
  const names = blockAncestry(s.blockId || null).map(b => b.name);
  names.push(localStateName(s));
  return names.join(BLOCK_NAME_SEP);
}

// ══════════════════════════════════════════════════════════════════
//  INTEGRITY
// ══════════════════════════════════════════════════════════════════

/**
 * Is this record still describing something that exists?
 *
 * Nothing tells a block that its states were replaced, so it checks: the
 * parent it names is present, its entry is a live state that belongs to it,
 * and at least one member survives. An exit that has gone is *trimmed* rather
 * than fatal — deleting one halting state of three should cost the block one
 * port, not the block.
 */
export function blockIsIntact(b) {
  if (!b || !b.id) return false;
  if (b.parent && !(App.blocks || []).some(o => o.id === b.parent)) return false;
  const entry = getState(b.entry);
  if (!entry || (entry.blockId || null) !== b.id) return false;
  return (App.states || []).some(s => (s.blockId || null) === b.id);
}

/**
 * Drop the records that no longer describe anything, and trim dead exits off
 * the ones that do. Returns how many blocks were dropped.
 *
 * Called on read rather than on write, because the writes that break a block
 * are the twenty places that reassign `App.states` without announcing it.
 */
export function pruneBlocks() {
  const before = (App.blocks || []).length;
  // Repeated to a fixed point: dropping a parent orphans its children, and a
  // child whose parent has gone fails its own check on the next round. One
  // pass would leave a nested block standing under a parent that had gone.
  let blocks = App.blocks || [];
  for (;;) {
    const kept = blocks.filter(b => blockIsIntact(b));
    if (kept.length === blocks.length) break;
    blocks = kept;
    App.blocks = kept;
    invalidateBlockIndex();
  }
  for (const b of blocks) {
    b.exits = (b.exits || []).filter(e => {
      const s = getState(e.id);
      return s && (s.blockId || null) === b.id;
    });
  }
  // A state naming a container that has gone is no longer inside anything.
  // Deliberately outside any early return on `blocks.length`: the commonest
  // way to reach this is App.blocks being emptied wholesale, which leaves
  // every state still claiming a container and no record left to say so.
  const live = new Set(blocks.map(b => b.id));
  for (const s of App.states || []) {
    if (s.blockId && !live.has(s.blockId)) delete s.blockId;
  }
  if (blocks.length !== before) invalidateBlockIndex();
  return before - blocks.length;
}

/** The blocks that still describe something, pruning as it reads. */
export function liveBlocks() {
  pruneBlocks();
  return App.blocks || [];
}

// ══════════════════════════════════════════════════════════════════
//  NAMING
// ══════════════════════════════════════════════════════════════════

function uniqueName(base, taken) {
  const root = String(base || 'block').trim() || 'block';
  if (!taken.has(stateNameKey(root))) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root} ${n}`;
    if (!taken.has(stateNameKey(candidate))) return candidate;
  }
}

/**
 * A name no sibling block is using.
 *
 * Sibling uniqueness is load-bearing rather than cosmetic: interior state names
 * are prefixed with it, so two blocks both called "ALU" would produce two
 * states called `ALU/mul/scan` — and the compiler, the panel and the formal
 * definition all treat two states with one name as one state.
 */
export function uniqueBlockName(base, parent = null) {
  const taken = new Set(blockChildren(parent).map(b => stateNameKey(b.name)));
  return uniqueName(base, taken);
}

// ══════════════════════════════════════════════════════════════════
//  DEFINITIONS
// ══════════════════════════════════════════════════════════════════
// A definition is a small workspace of its own — states, transitions, a start
// state, and its own nested blocks — plus the two things a *host* needs to wire
// it up: where control enters and where it may leave.
//
//   { name, machine, description, sigma, stackAlpha, outputAlpha, tapeCount,
//     sym, states, transitions, startId, blocks,
//     entry, exits: [{ id, label }], version, key }
//
// Deliberately not the workspace save format. It carries no camera, no notes,
// no dividers and no config — none of which mean anything about a subroutine —
// and it carries `entry`/`exits`, which the save format has no place for.

/** What is wrong with this definition, as sentences. Empty means usable. */
export function validateBlockDefinition(def) {
  const bad = [];
  if (!def || typeof def !== 'object') return ['A block definition must be an object.'];
  if (!Array.isArray(def.states) || !def.states.length) bad.push('A block needs at least one state.');
  if (!Array.isArray(def.transitions)) bad.push('A block needs a transitions array.');
  const ids = new Set((def.states || []).map(s => s.id));
  const entry = def.entry || def.startId;
  if (!entry) bad.push('A block needs an entry state.');
  else if (!ids.has(entry)) bad.push(`Entry state "${entry}" is not one of the block's states.`);
  for (const t of def.transitions || []) {
    if (!ids.has(t.from) || !ids.has(t.to)) {
      bad.push(`Transition ${t.id || ''} refers to a state that is not in the block.`);
      break;
    }
  }
  for (const e of def.exits || []) {
    if (!ids.has(e.id)) { bad.push(`Exit "${e.label || e.id}" is not one of the block's states.`); break; }
  }
  for (const b of def.blocks || []) {
    if (b.parent && !(def.blocks || []).some(o => o.id === b.parent)) {
      bad.push(`Nested block "${b.name || b.id}" names a parent that is not in the definition.`);
      break;
    }
  }
  return bad;
}

/**
 * The exits a definition offers, defaulting to its accepting states.
 *
 * The default is the whole reason placing a block usually needs no
 * configuration: a block *is* a machine, and its final states are its answers.
 */
function exitsOf(def) {
  if (Array.isArray(def.exits) && def.exits.length) {
    return def.exits.map(e => ({ id: e.id, label: e.label || nameOf(def, e.id) }));
  }
  return (def.accepts || []).map(id => ({ id, label: nameOf(def, id) }));
}

function nameOf(def, id) {
  return (def.states || []).find(s => s.id === id)?.name || id;
}

/**
 * The symbols a definition was written under, mapped onto this workspace's.
 *
 * A reader may change ⊔ or Σ in Settings, and a block written before that would
 * otherwise arrive reading a symbol no cell can hold — the edge draws, Γ fills
 * with a stray glyph, and the machine rejects everything with no error
 * anywhere. Only the system symbols are mapped; an ordinary alphabet symbol is
 * whatever the author typed and means the same thing in both.
 */
function remapDefSymbols(transitions, from) {
  const to = App.config.sym;
  if (!from) return transitions;
  const keys = ['eps', 'any', 'blank', 'stackBottom', 'leftMarker', 'rightMarker', 'lambda'];
  const map = new Map();
  for (const k of keys) if (from[k] !== undefined && from[k] !== to[k]) map.set(from[k], to[k]);
  if (!map.size) return transitions;
  const one = v => (map.has(v) ? map.get(v) : v);
  const many = arr => (Array.isArray(arr) ? arr.map(one) : arr);
  for (const t of transitions) {
    for (const f of ['symbol', 'write', 'pop', 'pop2', 'output']) {
      if (t[f] !== undefined) t[f] = one(t[f]);
    }
    // A push string is characters, not one symbol — the same rule
    // js/import-jflap.js states for JFLAP's <push>.
    for (const f of ['push', 'push2']) {
      if (typeof t[f] === 'string') t[f] = t[f].split('').map(one).join('');
    }
    t.tapeSyms = many(t.tapeSyms);
    t.tapeWrites = many(t.tapeWrites);
  }
  return transitions;
}

// ══════════════════════════════════════════════════════════════════
//  INLINING
// ══════════════════════════════════════════════════════════════════

/**
 * Place a definition on the current machine, expanding its whole subtree.
 *
 * Mutates `App` — pushing states, transitions and block records — and
 * deliberately takes no undo point and emits nothing. Placing a block is one
 * edit as far as the reader is concerned, so the caller wraps it in
 * `commit(() => inlineBlock(...))` the way every other multi-part edit is
 * wrapped. Splitting it that way is also what lets a test call this with no
 * store and no page.
 *
 * @returns {{ block, states, transitions, warnings }}
 */
export function inlineBlock(def, opts = {}) {
  const problems = validateBlockDefinition(def);
  if (problems.length) throw new Error(`Cannot place this block: ${problems[0]}`);

  const parent = opts.parent || null;
  const name = uniqueBlockName(opts.name || def.name || 'block', parent);
  const warnings = [];

  // ── ids ──
  // Every state and every nested block gets a fresh id from the workspace's own
  // counters, so two placements of one definition can never collide and
  // resetIds() recovers the counters from the ids on load.
  const rootId = newBlockId();
  const blockIdMap = new Map();
  for (const b of def.blocks || []) blockIdMap.set(b.id, newBlockId());

  const stateIdMap = new Map();
  for (const s of def.states) stateIdMap.set(s.id, 's' + (++App.stateN));

  // Which of the new block ids a state belongs to. A definition's own top-level
  // states carry no blockId and become members of the block being placed.
  const containerOf = s => (s.blockId ? blockIdMap.get(s.blockId) : rootId) || rootId;

  // ── states ──
  // Names are prefixed with the instance name, once. A definition that already
  // contains blocks carries names like `mul/scan` from when *those* were
  // placed, so prefixing again gives `ALU 2/mul/scan` — which is exactly the
  // path blockPathOf() reports, arrived at from the other end.
  const takenNames = new Set((App.states || []).map(s => stateNameKey(s.name)));
  const dx = Number.isFinite(opts.x) ? opts.x : 0;
  const dy = Number.isFinite(opts.y) ? opts.y : 0;
  const newStates = def.states.map(s => {
    const wanted = `${name}${BLOCK_NAME_SEP}${s.name || s.id}`;
    const unique = uniqueName(wanted, takenNames);
    takenNames.add(stateNameKey(unique));
    return {
      ...s,
      id: stateIdMap.get(s.id),
      name: unique,
      x: (Number.isFinite(s.x) ? s.x : 0) + dx,
      y: (Number.isFinite(s.y) ? s.y : 0) + dy,
      blockId: containerOf(s)
    };
  });

  // ── transitions ──
  const newTransitions = def.transitions.map(t => ({
    ...t,
    id: 't' + (++App.transN),
    from: stateIdMap.get(t.from),
    to: stateIdMap.get(t.to)
  }));
  remapDefSymbols(newTransitions, def.sym);
  // A k-tape rule stays true when a (k+1)th tape appears: setTapeArity pads
  // with a blank read, a blank write and a stationary head. One rule rather
  // than a second copy of it here — see js/machines/index.js.
  if (isMultiTape(App.machine)) {
    const from = def.tapeCount || 0;
    if (setTapeArity(newTransitions, App.tapeCount) && from && from !== App.tapeCount) {
      warnings.push(`Block was written for ${from} tape${from > 1 ? 's' : ''} and this machine has ${App.tapeCount}; the extra tapes do nothing in its rules.`);
    }
  }

  // ── block records ──
  const root = {
    id: rootId,
    name,
    parent,
    entry: stateIdMap.get(def.entry || def.startId),
    exits: exitsOf(def).map(e => ({ id: stateIdMap.get(e.id), label: e.label })),
    x: dx, y: dy,
    w: Number.isFinite(opts.w) ? opts.w : null,
    h: Number.isFinite(opts.h) ? opts.h : null,
    source: def.key || null,
    version: def.version || 1,
    collapsed: true
  };
  const nested = (def.blocks || []).map(b => ({
    ...b,
    id: blockIdMap.get(b.id),
    parent: b.parent ? blockIdMap.get(b.parent) : rootId,
    entry: stateIdMap.get(b.entry),
    exits: (b.exits || []).map(e => ({ id: stateIdMap.get(e.id), label: e.label })),
    x: (Number.isFinite(b.x) ? b.x : 0) + dx,
    y: (Number.isFinite(b.y) ? b.y : 0) + dy
  }));

  // ── commit to App ──
  App.states = [...(App.states || []), ...newStates];
  App.transitions = [...(App.transitions || []), ...newTransitions];
  App.blocks = [...(App.blocks || []), root, ...nested];
  invalidateBlockIndex();

  // A block's accept marks say "this block finished", not "the machine
  // accepted", so they do not travel. The exits are what record them.
  // (Nothing is added to App.accepts above; this is the statement of intent.)

  for (const sym of def.sigma || []) App.sigma.add(sym);
  for (const sym of def.stackAlpha || []) App.stackAlpha.add(sym);
  for (const sym of def.outputAlpha || []) App.outputAlpha.add(sym);

  // An empty canvas has no start state, and the block is the only thing on it.
  if (!App.startId) App.startId = root.entry;

  warnings.push(...determinismWarnings(newTransitions));
  return { block: root, states: newStates, transitions: newTransitions, warnings };
}

/**
 * Rules the inlined edges conflict with, in the host machine's own words.
 *
 * The editor refuses a second edge for the same read (confirmTrans asks
 * machineDeterminism(m).conflict), but inlining does not go through the
 * editor — so the same rule is asked here rather than a second copy of it
 * written. This is the pattern the app already uses for determinism: one
 * declaration, consulted from the editor and from the run.
 */
export function determinismWarnings(transitions) {
  const rule = machineDeterminism(App.machine);
  if (!rule) return [];
  const out = [];
  for (const t of transitions) {
    const clash = rule.conflict(t, t.id);
    if (!clash) continue;
    out.push(rule.say(t, clash));
    // One sentence is the point; a block whose every edge collides would
    // otherwise bury the reader in the same complaint.
    if (out.length >= 3) break;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  OUTLINING
// ══════════════════════════════════════════════════════════════════

/**
 * A block's interior, back out as a definition — for the library, and for
 * "update every instance of this".
 *
 * Ids are rebased to the definition's own space and names have the instance
 * prefix stripped, so a definition taken out and put back in does not
 * accumulate `ALU 2/ALU 2/scan`.
 */
export function outlineBlock(id, opts = {}) {
  const block = getBlock(id);
  if (!block) return null;
  const subtree = blockSubtree(id);
  const inSubtree = new Set(subtree);
  const states = (App.states || []).filter(s => s.blockId && inSubtree.has(s.blockId));
  if (!states.length) return null;

  const idMap = new Map(states.map((s, i) => [s.id, 'd' + (i + 1)]));
  const blockMap = new Map(subtree.map((b, i) => [b, 'k' + (i + 1)]));
  const prefix = block.name + BLOCK_NAME_SEP;
  const strip = n => (String(n).startsWith(prefix) ? String(n).slice(prefix.length) : String(n));

  const ox = block.x || 0, oy = block.y || 0;
  const defStates = states.map(s => {
    const out = { ...s, id: idMap.get(s.id), name: strip(s.name), x: (s.x || 0) - ox, y: (s.y || 0) - oy };
    // A member of the block itself is top-level in the definition; a member of
    // one of its children keeps a container.
    if ((s.blockId || null) === id) delete out.blockId;
    else out.blockId = blockMap.get(s.blockId);
    return out;
  });

  const defTransitions = (App.transitions || [])
    .filter(t => idMap.has(t.from) && idMap.has(t.to))
    .map((t, i) => ({ ...t, id: 'e' + (i + 1), from: idMap.get(t.from), to: idMap.get(t.to) }));

  const defBlocks = subtree.slice(1).map(bid => {
    const b = getBlock(bid);
    return {
      ...b,
      id: blockMap.get(bid),
      parent: b.parent === id ? null : blockMap.get(b.parent),
      entry: idMap.get(b.entry),
      exits: (b.exits || []).map(e => ({ id: idMap.get(e.id), label: e.label })),
      x: (b.x || 0) - ox, y: (b.y || 0) - oy
    };
  });

  return {
    name: opts.name || block.name,
    machine: App.machine,
    description: opts.description || '',
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    sym: { ...App.config.sym },
    states: defStates,
    transitions: defTransitions,
    blocks: defBlocks,
    startId: idMap.get(block.entry),
    entry: idMap.get(block.entry),
    exits: (block.exits || []).map(e => ({ id: idMap.get(e.id), label: e.label })),
    accepts: [],
    version: opts.version || block.version || 1,
    key: opts.key || block.source || null
  };
}

/**
 * The whole machine on the canvas, as a definition — "save this as a block".
 *
 * F becomes the exits, which is the mapping that makes the common case free: a
 * block is a machine, and the states it halts in are the answers it hands back.
 */
export function machineAsBlockDefinition(opts = {}) {
  const states = (App.states || []).map(s => ({ ...s }));
  if (!states.length) return null;
  return {
    name: opts.name || 'block',
    machine: App.machine,
    description: opts.description || '',
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    sym: { ...App.config.sym },
    states,
    transitions: (App.transitions || []).map(t => ({ ...t })),
    blocks: (App.blocks || []).map(b => ({ ...b, exits: (b.exits || []).map(e => ({ ...e })) })),
    startId: App.startId,
    entry: opts.entry || App.startId,
    exits: [...App.accepts].map(id => ({ id, label: getState(id)?.name || id })),
    accepts: [...App.accepts],
    version: opts.version || 1,
    key: opts.key || null
  };
}

// ══════════════════════════════════════════════════════════════════
//  REMOVAL AND WIRING
// ══════════════════════════════════════════════════════════════════

/**
 * Delete a block and everything inside it, at every depth.
 *
 * Like inlineBlock, this neither snapshots nor emits: deleting a block is one
 * edit, and the caller owns the undo point.
 */
export function removeBlock(id) {
  const subtree = new Set(blockSubtree(id));
  if (!subtree.size) return false;
  const doomed = new Set((App.states || [])
    .filter(s => s.blockId && subtree.has(s.blockId))
    .map(s => s.id));
  if (!doomed.size && !subtree.size) return false;

  App.states = (App.states || []).filter(s => !doomed.has(s.id));
  App.transitions = (App.transitions || []).filter(t => !doomed.has(t.from) && !doomed.has(t.to));
  App.blocks = (App.blocks || []).filter(b => !subtree.has(b.id));
  for (const sid of doomed) App.accepts.delete(sid);
  if (doomed.has(App.startId)) App.startId = App.states[0]?.id || null;
  invalidateBlockIndex();
  return true;
}

/**
 * The edges that cross a block's boundary, which is what a collapsed drawing
 * has to redirect and what "update all instances" has to preserve.
 *
 *   incoming — from outside the subtree to the entry (or, wrongly, elsewhere)
 *   outgoing — from an exit port out of the subtree
 *   stray    — a crossing that uses neither the entry nor an exit port
 *
 * `stray` is separated rather than folded in because it is the one shape a
 * re-inline cannot carry over: an edge into the middle of a subroutine has no
 * port to be matched by name.
 */
export function blockCrossings(id) {
  const subtree = new Set(blockSubtree(id));
  const inside = new Set((App.states || [])
    .filter(s => s.blockId && subtree.has(s.blockId))
    .map(s => s.id));
  const block = getBlock(id);
  const exitIds = new Set((block?.exits || []).map(e => e.id));
  const incoming = [], outgoing = [], stray = [];
  for (const t of App.transitions || []) {
    const fromIn = inside.has(t.from), toIn = inside.has(t.to);
    if (fromIn === toIn) continue;
    if (!fromIn && toIn) (t.to === block?.entry ? incoming : stray).push(t);
    else (exitIds.has(t.from) ? outgoing : stray).push(t);
  }
  return { incoming, outgoing, stray };
}

// ══════════════════════════════════════════════════════════════════
//  THE DAG GUARD
// ══════════════════════════════════════════════════════════════════

/**
 * Would saving this definition under `key` let a block contain itself?
 *
 * Inlining makes a cycle impossible on the canvas — you cannot place something
 * that does not exist yet — but the library can create one: edit a machine that
 * already contains ALU and save it back over ALU. A recursive block is not a
 * Turing machine with a subroutine; it needs a stack of tape positions, which
 * is a different machine, and the expansion would not terminate.
 *
 * @param resolve  key -> definition, for whatever store the caller uses
 */
export function blockDefinitionCycle(def, key, resolve) {
  if (!key || typeof resolve !== 'function') return null;
  const seen = new Set();
  const walk = (d, trail) => {
    for (const b of d?.blocks || []) {
      const src = b.source;
      if (!src) continue;
      if (src === key) return [...trail, b.name || src];
      if (seen.has(src)) continue;
      seen.add(src);
      const child = resolve(src);
      if (!child) continue;
      const hit = walk(child, [...trail, b.name || src]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(def, [def.name || key]);
}
