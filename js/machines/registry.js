// ══════════════════════════════════════════════════════════════════
//  THE MACHINE REGISTRY
// ══════════════════════════════════════════════════════════════════
// One definition per machine type, and the only place the app looks up
// what a machine *does*.
//
// Before this existed, every question about a machine's behaviour was
// answered by an if-chain over `App.machine` — one in runSim, another in
// computeBatchResults, a third in langVerdict, a fourth in the formal
// definition, more in the editor and the spec schema. Each chain ended in
// a silent `else`, so a machine added to MachineTypes did not fail: it ran
// as a DFA in one place, a Turing machine in another, and reported a tuple
// belonging to neither. That is the failure this module removes — a type
// with no definition is now an error with a name in it, raised at the one
// call site that needed the answer.
//
// This file imports nothing. Family modules register themselves at module
// scope (js/machines/index.js is what pulls them in), and a shared mutable
// container written from several modules at module scope has to sit in a
// leaf — see the note on modal-registry.js and export-registry.js in
// CLAUDE.md. Everything a definition needs from App it takes at call time.
//
// ── The interface ─────────────────────────────────────────────────
// A definition is a plain object. Every field is optional except `family`
// and the two halves of running a machine:
//
//   family        — 'finite' | 'twoway' | 'weighted' | 'omega' |
//                   'pushdown' | 'turing' | 'transducer'. The grouping the
//                   behaviour is shared along; js/utils.js's family
//                   predicates read this rather than listing names.
//   parseInput(raw, m)
//                 — the run box's text → whatever simulate/decide take.
//                   Returns { ok: true, input, tokens } or
//                   { ok: false, error }. `tokens` is the flat symbol list
//                   the canvas highlights against, or null when there is
//                   none (a multi-tape run, say).
//   precheck(input, m)
//                 — a claim about the *machine* that a run should not be
//                   started (or should be warned) under: a D-type with a
//                   branching δ, a weak automaton whose SCCs straddle F.
//                   Returns null, { refuse } or { warn }.
//   simulate(input, m)
//                 — the step-by-step run. Writes App.simSteps and paints;
//                   returns whatever the family's own callers want.
//   decide(input, opts, m)
//                 — the DOM-free verdict, for the batch tester, the
//                   language fingerprint and StateMate's verification.
//                   Returns { verdict: 'acc' | 'rej' | 'unk', output }.
//                   `output` is the transducer's emission, null otherwise.
//                   The verdict is the machine's own answer and ignores
//                   App.config.transducerAccepts — whether a transducer is
//                   allowed to have a verdict at all is the caller's policy,
//                   not the machine's.
//   schema        — { transitionFields, stateFields, alphabetFields }, the
//                   fields this machine's transitions and states carry.
//                   The editor, the wizard and the StateMate dialect all
//                   read these instead of deriving them three times.
//   formal        — { tuple, delta }, the formal definition's components.
//
// Definitions are registered per *type*, not per family, so there is no
// "everything else" branch to fall into: DPDA and NPDA share an
// implementation by spreading one base object, and differ where they
// differ.
// ══════════════════════════════════════════════════════════════════

const defs = new Map();

/** Register one machine type. Registering twice is a bug, not an override. */
export function defineMachine(id, def) {
  if (defs.has(id)) throw new Error(`Machine "${id}" is already defined.`);
  if (!def || typeof def !== 'object') throw new Error(`Machine "${id}" needs a definition object.`);
  defs.set(id, { id, ...def });
  return defs.get(id);
}

/**
 * Register a family: one base object plus per-type overrides.
 *
 *   defineFamily(pushdown, { DPDA: { simulate: simPDA }, NPDA: { … } })
 *
 * The overrides are what keep this from becoming another if-chain — the
 * base holds what the family shares and the entry holds what one type
 * does differently, so neither has to test for the other.
 */
export function defineFamily(base, members) {
  for (const [id, over] of Object.entries(members)) defineMachine(id, { ...base, ...over });
}

/** The definition for `id`, or null when this build does not implement it. */
export function machineDef(id) {
  return defs.get(id) || null;
}

/**
 * The definition for `id`, or a thrown error naming the type.
 *
 * Used where there is nothing sensible to do without one. A caller that
 * can report the gap to the reader — runSim, the batch tester — should ask
 * machineDef() and say so instead.
 */
export function requireMachineDef(id) {
  const def = defs.get(id);
  if (!def) throw new Error(`No machine definition for "${id}". Add one under js/machines/.`);
  return def;
}

export function hasMachineDef(id) { return defs.has(id); }

/** Every registered type, in registration order. */
export function machineIds() { return [...defs.keys()]; }

/** Every registered definition, in registration order. */
export function machineDefs() { return [...defs.values()]; }

/** The family `id` belongs to, or null. */
export function machineFamily(id) { return defs.get(id)?.family ?? null; }

/** Is `id` one of the types this family covers? */
export function inFamily(id, ...families) {
  const f = defs.get(id)?.family;
  return f != null && families.includes(f);
}

/** Every type in a family, in registration order. */
export function familyMembers(family) {
  return machineDefs().filter(d => d.family === family).map(d => d.id);
}

// Test-only. Definitions are registered at module scope and modules are
// singletons, so nothing in the app ever needs to unregister one.
export function _resetMachineRegistry() { defs.clear(); }
