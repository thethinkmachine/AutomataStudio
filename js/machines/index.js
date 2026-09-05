// ══════════════════════════════════════════════════════════════════
//  THE MACHINE LAYER
// ══════════════════════════════════════════════════════════════════
// The one import the rest of the app needs. Pulling this in evaluates
// every family module, and a family module registers its types as it
// evaluates — so by the time anything can ask a question, the registry
// can answer it.
//
// Everything below is a *dispatch*, and dispatch is the whole point:
// these five functions are what used to be five if-chains over
// App.machine, in five different files, each with its own idea of what
// the last `else` meant. A machine type that is not registered now
// answers `null` here instead of quietly running as a DFA in one place
// and a Turing machine in another.
//
// Adding a machine is: a row in MachineTypes (js/state.js), and a
// defineMachine call in the family module whose mechanism it shares.
// tests/machines.test.js fails until both exist.

import { App } from '../state.js';
import { withPainterSuppressed } from './paint.js';
import { machineDef, requireMachineDef } from './registry.js';
import { makeRun } from './run.js';
import { parseWordInput } from './runtime.js';
import { tapeTuplesOverlap } from './predicates.js';

// Evaluated for their registrations. Order is the model picker's order,
// which is also the order machineIds() reports.
import './finite.js';
import './weighted.js';
import './omega.js';
import './pushdown.js';
import './turing.js';
import './transducer.js';
import './twoway.js';

export {
  defineFamily, defineMachine, familyMembers, hasMachineDef, inFamily,
  machineDef, machineDefs, machineFamily, machineIds, requireMachineDef
} from './registry.js';

/** Is there an implementation for this type in this build? */
export function machineImplemented(m = App.machine) {
  return machineDef(m) !== null;
}

/**
 * The run box's text → whatever this machine's simulate/decide take.
 *
 * Returns { ok: true, input, tokens } or { ok: false, error }. A machine
 * without its own parseInput reads a finite word, which is what all but
 * the ω-automata and a multi-tape MTM run do.
 */
export function parseMachineInput(m, raw) {
  const def = machineDef(m);
  if (!def) return { ok: false, error: `This build has no implementation for ${m}.` };
  return (def.parseInput || parseWordInput)(raw, m);
}

/**
 * The claims about the machine that a run should not start under.
 *
 * Returns the guards that fired, in order, stopping at the first refusal.
 * A `warn` does not stop anything — a weak automaton whose SCCs straddle F
 * is still run, as a Büchi automaton, because that is what its acceptance
 * condition says.
 */
export function machineGuards(m, input) {
  const fired = [];
  for (const guard of machineDef(m)?.guards || []) {
    const result = guard(input, m);
    if (!result) continue;
    fired.push(result);
    if (result.refuse) break;
  }
  return fired;
}

/** The step-by-step run, all of it at once. Writes App.simSteps and paints. */
export function simulateMachine(m, input) {
  return requireMachineDef(m).simulate(input, m);
}

/**
 * The step-by-step run as a *cursor*, which is what the player holds.
 *
 * A machine that declares `stream` builds one step per iteration and can hand
 * them over as they are computed; the cursor pulls, so playback is what drives
 * the computation and a ten-thousand-step tape machine costs nothing until it
 * is watched. See js/machines/run.js.
 *
 * A machine that declares none is search-based — `simNPDA`, `sim2NFA`,
 * `simFST`, the ω-automata and the deterministic PDA, all of which explore the
 * configuration space and only then linearize the winning path. No prefix of
 * their trace exists until the search has finished, so there is nothing to
 * stream and the run arrives complete however the reader has set the execution
 * mode. Collecting it here suppresses the paint, because the player has not yet
 * decided what to show and the eager simulators end by drawing a step.
 */
export function streamMachine(m, input) {
  const def = requireMachineDef(m);
  if (def.stream) return makeRun(def.stream(input, m));
  const steps = withPainterSuppressed(() => {
    def.simulate(input, m);
    return App.simSteps || [];
  });
  return makeRun(steps);
}

/** Whether this machine's trace can be produced a step at a time. */
export function machineStreams(m) {
  return typeof machineDef(m)?.stream === 'function';
}

/**
 * The DOM-free verdict: { verdict: 'acc' | 'rej' | 'unk', output }.
 *
 * The verdict is the machine's own answer. Whether a transducer is
 * allowed to have one is App.config.transducerAccepts, which is the
 * caller's policy and is applied by the caller — a machine that emits
 * "011" on a word either consumed it or did not, and that fact does not
 * change when a checkbox does.
 */
export function decideMachine(m, input, opts = {}) {
  const def = machineDef(m);
  if (!def) return { verdict: 'unk', output: null };
  return withMachineStart(() => def.decide(input, opts, m));
}

/**
 * Decide about **the machine**, whatever the player is currently running.
 *
 * `runStartId()` answers `App.simStart` so that picking a block in the run box
 * starts the *player* at that block's entry. Deciding is a different question
 * and it was quietly getting the same answer: the moment a subject was chosen,
 * every row of the Test Words table and every cell of the Language panel's
 * fingerprint was decided from inside the block instead — a word could flip
 * from reject to accept with nothing anywhere saying why.
 *
 * Two reasons it is wrong rather than merely surprising. **A block has no F** —
 * its accepting marks are dropped when it is inlined, which is the whole reason
 * a block run reports an exit and not a verdict — so accept/reject measured
 * from a block's entry against the host machine's F is not an answer to any
 * question. And the Language panel prints Q, q₀ and F of the *machine* beside
 * that fingerprint, so a scoped verdict made one panel contradict its own
 * heading.
 *
 * So the override stops here, at the one seam every decider goes through. This
 * is not "a subject that only takes effect on the play button": the subject
 * takes effect on every run, every step and every frame of playback. It takes
 * effect on the *player*, which is the thing it is a property of.
 */
function withMachineStart(fn) {
  const held = App.simStart;
  if (held == null) return fn();
  App.simStart = null;
  try { return fn(); } finally { App.simStart = held; }
}

/**
 * Decide a finite word, from raw text, in one call — the shape the
 * Language panel and StateMate's verification want. `null` when this
 * machine does not read finite words at all.
 */
export function decideWord(m, tokens, opts = {}) {
  const def = machineDef(m);
  if (!def || def.parseInput) return null;
  return withMachineStart(() => def.decide(tokens, opts, m));
}

// The bare minimum a machine's transitions and states carry: two states
// and a symbol read. Anything without a definition answers this rather
// than `undefined`, so a caller reading fields never has to null-check.
const MINIMAL_SCHEMA = {
  transitionFields: ['from', 'to', 'on'],
  stateFields: ['name', 'start', 'accept'],
  alphabetFields: ['sigma']
};

/**
 * The fields this machine's transitions, states and alphabets carry.
 *
 * One list, four readers: the transition editor decides which rows to
 * show from it, the wizard which questions to ask, StateMate's dialect
 * which keys a model may send, and the importer which keys to read.
 * They used to derive it separately from the capability flags, which is
 * how a machine could be describable to the model and un-editable on the
 * canvas at the same time.
 */
export function machineSchema(m) {
  return machineDef(m)?.schema || MINIMAL_SCHEMA;
}

export function transitionFieldsOf(m) { return machineSchema(m).transitionFields; }

/**
 * Why a piece of one machine's graph cannot be dropped onto another — or
 * `null`, which is much the commonest answer.
 *
 * Copying is the one gesture in the app that crosses machines. A clipboard
 * outlives the machine it was filled from — nothing clears it on a switch, and
 * deliberately so — so copy on an MTM, switch the canvas to a DFA, press
 * Ctrl+V, and until this was asked the states and their transitions simply
 * landed. Nothing threw, because a transition is a plain object and every
 * field on it is optional: the DFA carried rules holding `tapeSyms` it has no
 * reader for, and the states it was asked to decide with had no `symbol` at
 * all. A machine reading `undefined` rejects everything, which looks exactly
 * like a machine that is merely wrong.
 *
 * `transitionFields` is the app's one declaration of what a transition carries,
 * so it is the test rather than the family or the name: DFA, NFA and ε-NFA
 * share theirs and states move freely among them, as do TM, NDTM, LBA and ITM
 * — which is the case worth having, since those differ in their tape and their
 * δ rather than in their rules. MTM does not share the TM's, because its rules
 * are a read *tuple*.
 *
 * Deliberately **not** `stateFields`. A state's extra fields are defaultable —
 * a Moore state pasted onto a DFA carries an `out` nothing reads, and the app
 * already tolerates exactly that from every importer — while a transition's
 * are what the machine runs on. Refusing on them would turn a cosmetic
 * mismatch into a refusal, which is the wrong trade in a teaching tool.
 *
 * A fragment that names no machine is allowed through: everything this app
 * writes records one, so absence means something hand-made or older with
 * nothing to compare against — the rule the four `render.*` flags follow, read
 * from the other side.
 */
export function transitionShapeRefusal(src, m = App.machine, subject = 'This') {
  if (!src || src === m) return null;
  const want = transitionFieldsOf(m), got = transitionFieldsOf(src);
  if (want.length === got.length && want.every((f, i) => f === got[i])) return null;
  return `${subject} came from ${src}, whose transitions are not the shape ${m} reads. `
    + 'The rules would mean nothing here.';
}
export function stateFieldsOf(m) { return machineSchema(m).stateFields; }
export function alphabetFieldsOf(m) { return machineSchema(m).alphabetFields; }

// The three words the transition editor puts on the store rows. A machine
// with no store never shows them; the default is the stack's, which is
// what every pushdown machine but the queue and the counter uses.
export function machineStoreLabels(m) {
  return machineDef(m)?.storeLabels || ['Stack', 'Pop', 'Push'];
}

/**
 * The settings this machine has that are neither its alphabet nor its
 * graph — a multi-tape machine's tape count, a PFA's cut-point, the tape
 * shape for the Turing machines that have a choice about it.
 *
 * The wizard asks these as a step and skips the step when the list is
 * empty, so a machine with a knob nobody declared is a machine the wizard
 * silently cannot configure.
 */
export function machineOptions(m) {
  return machineDef(m)?.options || [];
}

/** Does this machine draw more than one tape? */
export function isMultiTape(m) {
  return !!machineDef(m)?.multiTape;
}

/**
 * May this machine be built out of building blocks?
 *
 * A block is inlined, and control leaves it along an exit edge that consumes
 * nothing — which needs a stay move and a wildcard write. Declared per family
 * rather than tested for by name, so this cannot fall out of step with the
 * machines that actually have them. See js/blocks.js.
 */
export function machineSupportsBlocks(m = App.machine) {
  return !!machineDef(m)?.supportsBlocks;
}

/** The three fields a multi-tape transition carries one column of per tape. */
export const TAPE_ARITY_FIELDS = ['tapeSyms', 'tapeWrites', 'tapeDirs'];

/**
 * Every per-tape array on these transitions, exactly as wide as `count`.
 *
 * Changing the tape count used to *delete every transition*, which made
 * the control unusable for the one thing anybody wants it for: adding a
 * work tape to a machine that already works. Nothing about a k-tape rule
 * stops being true when a (k+1)th tape appears — so widening pads with a
 * blank read, a blank write and a stationary head, which is the new tape
 * doing nothing, and the machine goes on deciding exactly what it decided.
 * Narrowing genuinely drops the trailing columns, which is why its caller
 * asks first.
 *
 * One rule rather than two: the wizard's draft rows and the canvas's
 * transitions are the same shape here, and a second copy is only a way
 * for the picker and the wizard to disagree about what a third tape
 * starts as.
 *
 * @returns {boolean} whether anything was actually reshaped.
 */
export function setTapeArity(transitions, count, blank = App.config.sym.blank) {
  let touched = false;
  for (const t of transitions || []) {
    for (const field of TAPE_ARITY_FIELDS) {
      if (!Array.isArray(t[field])) continue;
      const fill = field === 'tapeDirs' ? 'S' : blank;
      if (t[field].length === count) continue;
      while (t[field].length < count) t[field].push(fill);
      t[field] = t[field].slice(0, count);
      touched = true;
    }
  }
  return touched;
}

/**
 * Does narrowing to `count` tapes leave two rules out of one state reading
 * the same tuple?
 *
 * Dropping a column can merge transitions that differed only on the tape
 * being removed, and δ of a multi-tape machine is single-valued — so the
 * reader is told before it happens rather than left with a machine that
 * silently picks one of two rules. Read tuples are compared for *overlap*,
 * the same test the editor refuses a second edge with.
 */
export function tapeArityCollisions(transitions, count) {
  const rows = (transitions || []).filter(t => Array.isArray(t.tapeSyms));
  const clash = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].from !== rows[j].from) continue;
      // Only a clash the narrowing *creates*. Two rules that already
      // overlap at the current width are a machine the reader already
      // had, and blaming the tape count for it would be a false alarm.
      if (tapeTuplesOverlap(rows[i].tapeSyms, rows[j].tapeSyms)) continue;
      if (tapeTuplesOverlap(rows[i].tapeSyms.slice(0, count), rows[j].tapeSyms.slice(0, count))) {
        clash.push([rows[i], rows[j]]);
      }
    }
  }
  return clash;
}

/**
 * How this machine refuses a second edge for the same read, or null when
 * a second edge is a branch rather than a mistake.
 *
 *   { conflict(candidate, editId) -> transition | null,
 *     say(candidate, conflict) -> string }
 *
 * The editor asks; the machine answers. That is what turned a six-branch
 * chain — whose *order* decided which message a DWA got — into one lookup
 * per machine, with the message beside the rule that produced it.
 */
export function machineDeterminism(m) {
  return machineDef(m)?.determinism || null;
}

// Where the emitted symbol lives, asked from both ends. Moore is the odd
// one out — it labels states, so its output rides on s.output and never on
// t.output. Every other transducer labels edges, which is what the modal's
// Output row and transLabel key off.
//
// Both answers are the schema read one way or the other, so the node's
// second line, the state modal's Output row, the wizard's extra column and
// the StateMate dialect's state keys all follow from one declaration.
// js/utils.js re-exports both for the callers that already knew them there.
export function hasTransitionOutput(m = App.machine) {
  return transitionFieldsOf(m).includes('out');
}

export function hasStateOutput(m = App.machine) {
  return stateFieldsOf(m).includes('out');
}

/** Does this machine's transition carry `field`? */
export function transitionHasField(m, field) {
  return machineSchema(m).transitionFields.includes(field);
}

/** The formal definition's components: the tuple, δ's signature, and labels. */
export function machineFormal(m) {
  return machineDef(m)?.formal || null;
}
