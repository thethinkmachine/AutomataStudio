// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — THE SPEC DIALECT
// ══════════════════════════════════════════════════════════════════
//  What a model is allowed to say, and how a machine on the canvas is
//  described back to it. This is deliberately NOT the workspace save
//  format:
//
//    - no ids           a spec names states, and the compiler resolves
//                       names against the live machine. That is what lets
//                       an edit keep a state's identity, its coordinates,
//                       its anchored notes and its hand-tuned edge curve.
//    - no coordinates   they cost tokens and models place states badly.
//                       sugiyamaLayout() does it properly for free.
//    - booleans on the  `start` / `accept` on the state itself, rather than
//      state            a startId and an accepts[] cross-referencing ids.
//                       One state, one truth, one thing to get wrong.
//
//  The field names differ from the internal ones on purpose (`on` not
//  `symbol`, `move` not `dir`, `out` not `output`). A model that ignores
//  the schema and emits a workspace file therefore fails loudly at the
//  gate here instead of half-working two stages later.
//
//  This module imports state.js and nothing else, so it stays a leaf: both
//  the prompt builder and the compiler read it, and neither should be able
//  to drag a UI module into the other's import graph.

import {
  App, MachineTypes, getMachineConfig, getState, isOmegaAutomaton,
  statePriority, usesParityPriorities, MIN_TAPES, TAPE_LIMIT } from './state.js';
// The dialect still knows nothing about the UI, the provider or the
// pipeline it feeds — only about what each machine carries, which is the
// one thing a schema has to know.
import {
  alphabetFieldsOf, hasStateOutput, isMultiTape, machineSupportsBlocks,
  stateFieldsOf, transitionFieldsOf
} from './machines/index.js';
// blocks.js imports exactly what this module already does — state.js and the
// machine registry — so reaching for it costs the dialect nothing and keeps
// the path derivation in the one place that owns the tree.
import { blockAncestry, blockPath, blockSubtree, getBlock, liveBlocks } from './blocks.js';
import { liveScope } from './view-graph.js';

// A machine bigger than this is past the collision-avoidance budget in
// geometry.js — drawing it would be slow and unreadable, so it is refused
// rather than rendered badly.
export const MAX_SPEC_STATES = 120;
export const MAX_SPEC_TRANSITIONS = 600;
export const MIN_SPEC_TESTS = 3;
export const MAX_CAVEAT_CHARS = 240;
// Raised when the reply card learned to render markdown: structure costs
// characters, and a table or a fenced block cut off at 1200 is a card that
// looks broken rather than a reply that was long. Still a cap — it is the
// backstop against a model that will not stop talking.
export const MAX_REPLY_CHARS = 2400;

/**
 * Every failure in the StateMate pipeline. `code` is what the UI maps to a
 * sentence and a button; `detail` is the technical remainder, shown only
 * under a disclosure.
 */
export class StateMateError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'StateMateError';
    this.code = code;
    this.detail = detail;
  }
}

// ══════════════════════════════════════════════════════════════════
//  WHAT EACH MACHINE'S TRANSITIONS AND STATES MAY CARRY
// ══════════════════════════════════════════════════════════════════
// Read off the machine's own definition (js/machines/), which is the same
// place the editor and the wizard read it from. It used to be derived here
// from the capability flags, and the derivation carried an ordering trap
// of its own — the tape check had to come before the stack check, because
// every Turing machine in MachineTypes carries hasStack as well as hasTape.
// A machine now says what its transitions carry instead of the schema
// inferring it from what it can do.

/**
 * Legal transition keys for a machine, in the order the prompt should
 * present them.
 */
export function transitionFieldsFor(machine) {
  return transitionFieldsOf(machine);
}

/** Legal state keys for a machine. */
export function stateFieldsFor(machine) {
  return stateFieldsOf(machine);
}

/** Alphabet keys a spec for this machine must or may carry. */
export function alphabetFieldsFor(machine) {
  return alphabetFieldsOf(machine);
}

// The spec dialect ↔ the internal transition field names. The compiler is the
// only module that needs both, but the mapping lives here beside the schema
// it belongs to.
export const TRANSITION_KEY_MAP = {
  on: 'symbol',
  move: 'dir',
  out: 'output',
  pop: 'pop',
  push: 'push',
  pop2: 'pop2',
  push2: 'push2',
  write: 'write',
  weight: 'weight',
  tapeSyms: 'tapeSyms',
  tapeWrites: 'tapeWrites',
  tapeDirs: 'tapeDirs'
};

// ══════════════════════════════════════════════════════════════════
//  EXTRACTION
// ══════════════════════════════════════════════════════════════════
//  Models wrap JSON in fences, preface it with "Here's the automaton:",
//  and occasionally curl the quotes. None of that is worth a retry, so it
//  is unwrapped locally first and only genuine malformation escalates.

/** The first balanced {…} run in `text`, honouring string literals. */
export function sliceBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // A stream cut off mid-object: everything from the first brace is the best
  // available guess, and the parse error below names the real problem.
  return null;
}

function stripFences(text) {
  const fence = text.match(/```(?:json|jsonc|js)?\s*([\s\S]*?)```/i);
  return fence ? fence[1] : text;
}

const JSON_ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * One string field out of JSON that has not finished arriving.
 *
 * A streamed answer is not parseable until its last brace lands, so anything
 * shown while it arrives has to be read out of the partial text. That is why
 * "plan" is the first key in the machine schema and "text" the first in a
 * reply's: both are readable within a chunk or two of the answer starting.
 *
 * Tolerant by design — an unterminated value returns what there is so far, and
 * an escape sequence split across chunk boundaries stops rather than emitting
 * the backslash. It exists to show progress; extractSpecJSON is what decides.
 *
 * @returns {string|null} null when the field has not started yet
 */
export function partialStringField(text, key) {
  const src = String(text || '');
  const opener = new RegExp(`"${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"`);
  const m = opener.exec(src);
  if (!m) return null;

  let out = '';
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') return out;               // the value closed
    if (ch !== '\\') { out += ch; continue; }

    const esc = src[i + 1];
    if (esc === undefined) return out;        // the escape itself is split
    if (esc === 'u') {
      const hex = src.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      const code = parseInt(hex, 16);
      if (Number.isFinite(code)) out += String.fromCharCode(code);
      i += 5;
      continue;
    }
    out += JSON_ESCAPES[esc] ?? esc;
    i += 1;
  }
  return out;                                 // still arriving
}

// Only tried when a straight parse has already failed, so a curly quote
// inside a legitimate string value is never rewritten unnecessarily.
function normalizeQuotes(text) {
  return text.replace(/[“”„″]/g, '"').replace(/[‘’′]/g, "'");
}

function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Model text → object. Throws StateMateError('no-json') when there is no
 * object at all, and ('bad-json') when there is one but it will not parse
 * after the three local repairs.
 */
export function extractSpecJSON(text) {
  const raw = String(text || '');
  if (!raw.trim()) throw new StateMateError('no-json', 'The model returned nothing.');

  const body = sliceBalancedObject(stripFences(raw)) || sliceBalancedObject(raw);
  if (!body) {
    throw new StateMateError('no-json', "The model's answer did not contain a machine.", raw.slice(0, 2000));
  }

  const attempts = [
    body,
    normalizeQuotes(body),
    stripTrailingCommas(body),
    stripTrailingCommas(normalizeQuotes(body))
  ];
  let lastErr = null;
  for (const attempt of attempts) {
    try { return JSON.parse(attempt); } catch (err) { lastErr = err; }
  }
  throw new StateMateError('bad-json', "The model's answer was not valid JSON.", `${lastErr?.message || ''}\n\n${body.slice(0, 2000)}`);
}

// ══════════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════════

// Words that mean the model is talking about producing the answer rather than
// about the machine. See the caveat handling in validateSpec.
const PROCESS_NARRATION = /\b(correct(?:ed|ion)|repair(?:ed)?|fix(?:ed)?|revis(?:ed|ion)|(?:updat|adjust)ed to|previous (?:answer|attempt)|my (?:answer|previous))\b/i;

const EPSILON_ALIASES = new Set(['eps', 'epsilon', 'ε', 'λ', 'lambda', '\\e', '', 'empty']);
const MOVE_ALIASES = { l: 'L', left: 'L', r: 'R', right: 'R', s: 'S', stay: 'S', n: 'S', none: 'S' };

/** Symbol as written by the model → the symbol this workspace uses. */
export function normalizeSymbol(value, { allowEpsilon = true } = {}) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (allowEpsilon && EPSILON_ALIASES.has(s.toLowerCase())) return App.config.sym.eps;
  if (s.toLowerCase() === 'blank' || s === '_') return App.config.sym.blank;
  return s;
}

export function normalizeMove(value) {
  if (value === undefined || value === null) return undefined;
  const key = String(value).trim().toLowerCase();
  return MOVE_ALIASES[key] || String(value).trim().toUpperCase();
}

function asStringArray(value) {
  if (!Array.isArray(value)) return null;
  return value.map(v => normalizeSymbol(v, { allowEpsilon: false })).filter(v => v !== undefined && v !== '');
}

function fail(message, detail) {
  throw new StateMateError('schema', message, detail);
}

/**
 * Check and normalize a parsed spec. Returns a new object — the input is
 * never mutated, so a failed round can still be quoted back to the model
 * verbatim in the repair message.
 *
 * Throws StateMateError with code 'schema', 'unknown-machine' or 'too-large'.
 */
/**
 * The block tree, validated onto `spec`.
 *
 * **Absent means unchanged.** A model that says nothing about the hierarchy has
 * not asked for it to go, and compileSpec carries the existing records forward;
 * that is the rule the four `App.config.render` flags follow, and it is what
 * lets every prompt, few-shot and test written before this field existed go on
 * meaning what it meant. So the shape here is: read it if it is there, refuse
 * it if it is malformed, and never invent one.
 *
 * A block is addressed by **path** (`CPU/ALU 2`), because a name is unique
 * among siblings only. That is the same shape a state name already has.
 *
 * What is refused, rather than quietly corrected:
 *   - an entry naming no state, which is a block with no way in
 *   - a parent naming no declared block, which is a tree with a hole
 *   - a cycle, which is a block containing itself -- see blockDefinitionCycle
 * What is dropped: a `block` on a state naming nothing, and an exit naming no
 * state. Both are a container that does not exist, and refusing the machine
 * over one would cost the reader a whole turn for a field the compiler can
 * simply not write.
 */
function readBlocks(raw, spec, machine, stateNames) {
  // A container with no list to declare it is not a container, whether the list
  // is missing, empty, or refused because this machine cannot have one. Stripped
  // rather than left standing, or a DFA arrives carrying a `block` field that
  // every later stage has to remember to ignore.
  const strip = () => spec.states.forEach(s => { delete s.block; });
  if (!machineSupportsBlocks(machine)) return strip();   // no stay move, so no blocks
  if (!Array.isArray(raw.blocks)) return strip();        // absent: carried forward
  // An *empty* list is a declaration, not an absence. `blocks: []` is the only
  // way for a model to say "this machine has no hierarchy any more", and read
  // as "unchanged" it was a request the dialect could not express: the records
  // were carried straight back and the reader watched a dissolve they had asked
  // for silently not happen. So the empty array is set, and compileSpec's
  // "absent means unchanged" branch turns on `Array.isArray(spec.blocks)`
  // rather than on its length.
  if (!raw.blocks.length) { strip(); spec.blocks = []; return; }

  const seen = new Set();
  const blocks = raw.blocks.map((b, i) => {
    if (!b || typeof b !== 'object') fail(`Block #${i + 1} is not an object.`);
    const name = String(b.name ?? '').trim();
    if (!name) fail(`Block #${i + 1} has no name.`);
    if (seen.has(name)) fail(`Two blocks are both called "${name}".`);
    seen.add(name);
    const entry = String(b.entry ?? '').trim();
    if (!stateNames.has(entry)) {
      fail(`Block "${name}" names "${entry || '(nothing)'}" as its entry, which is not a state.`);
    }
    return {
      name,
      parent: b.parent ? String(b.parent).trim() : null,
      entry,
      exits: (Array.isArray(b.exits) ? b.exits : [])
        .map(e => ({
          state: String(e?.state ?? e?.id ?? '').trim(),
          label: String(e?.label ?? '').trim()
        }))
        .filter(e => stateNames.has(e.state))
    };
  });

  blocks.forEach(b => {
    if (b.parent && !seen.has(b.parent)) {
      fail(`Block "${b.name}" names "${b.parent}" as its parent, which is not a block.`);
    }
  });

  // A block that contains itself is not a machine with a subroutine -- it needs
  // a stack of tape positions, which is a different machine, and inlining would
  // not terminate. blocks.js refuses the same thing from the library side.
  const byName = new Map(blocks.map(b => [b.name, b]));
  blocks.forEach(b => {
    const trail = new Set();
    let cur = b;
    while (cur && cur.parent) {
      if (trail.has(cur.name)) fail(`The blocks "${b.name}" and "${cur.name}" contain each other.`);
      trail.add(cur.name);
      cur = byName.get(cur.parent);
    }
  });

  spec.blocks = blocks;
  // A container the list does not declare is not a container.
  spec.states.forEach(s => { if (s.block && !seen.has(s.block)) delete s.block; });
}

export function validateSpec(raw, { fallbackMachine = App.machine } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('The answer was not a machine object.');
  }

  // ── machine ──────────────────────────────────────────────────
  const machine = typeof raw.machine === 'string' ? raw.machine.trim() : fallbackMachine;
  if (!MachineTypes[machine]) {
    throw new StateMateError(
      'unknown-machine',
      `"${machine}" is not a machine this app builds.`,
      `Known types: ${Object.keys(MachineTypes).join(', ')}`
    );
  }
  const cfg = getMachineConfig(machine);
  const parity = usesParityPriorities(machine);

  // ── states ───────────────────────────────────────────────────
  if (!Array.isArray(raw.states) || !raw.states.length) fail('The machine has no states.');
  if (raw.states.length > MAX_SPEC_STATES) {
    throw new StateMateError('too-large', `That machine is too large to draw (${raw.states.length} states).`);
  }

  const seenNames = new Set();
  const states = raw.states.map((s, i) => {
    if (!s || typeof s !== 'object') fail(`State #${i + 1} is not an object.`);
    const name = String(s.name ?? s.id ?? '').trim();
    if (!name) fail(`State #${i + 1} has no name.`);
    if (seenNames.has(name)) fail(`Two states are both called "${name}".`);
    seenNames.add(name);

    const out = { name, start: !!s.start, accept: !!s.accept };
    if (parity) {
      const p = Number(s.priority);
      out.priority = Number.isInteger(p) && p >= 0 ? p : 0;
      // Parity has no F. A model that marked accepting states anyway has said
      // something meaningless rather than something wrong — drop it quietly.
      out.accept = false;
    }
    if (hasStateOutput(machine)) {
      out.out = s.out !== undefined ? String(s.out) : (s.output !== undefined ? String(s.output) : '');
    }
    // Carried through raw and checked against the declared blocks below --
    // the list has not been read yet, and a container naming nothing is a
    // dropped field rather than a refusal (see readBlocks).
    if (s.block !== undefined && s.block !== null) out.block = String(s.block).trim();
    return out;
  });

  const starts = states.filter(s => s.start);
  if (!starts.length) {
    // Recoverable without a round trip: a machine with one entry point almost
    // always meant its first state.
    states[0].start = true;
  } else if (starts.length > 1) {
    fail(`${starts.length} states are marked as the start state; there must be exactly one.`);
  }

  // ── alphabets ────────────────────────────────────────────────
  const sigma = asStringArray(raw.sigma);
  if (!sigma || !sigma.length) fail("The machine has no input alphabet ('sigma').");

  const spec = { machine, states, sigma };

  if (cfg.hasStack) {
    spec.stackAlpha = asStringArray(raw.stackAlpha) || [];
    if (!spec.stackAlpha.includes(App.config.sym.stackBottom)) {
      spec.stackAlpha.unshift(App.config.sym.stackBottom);
    }
  }
  if (cfg.isTransducer) spec.outputAlpha = asStringArray(raw.outputAlpha) || [];
  if (isMultiTape(machine)) {
    const n = Number(raw.tapeCount);
    spec.tapeCount = Number.isInteger(n) && n >= MIN_TAPES && n <= TAPE_LIMIT ? n : App.tapeCount;
  }

  // ── blocks ───────────────────────────────────────────────────
  readBlocks(raw, spec, machine, seenNames);

  // ── transitions ──────────────────────────────────────────────
  if (!Array.isArray(raw.transitions)) fail("The machine has no 'transitions' array.");
  if (raw.transitions.length > MAX_SPEC_TRANSITIONS) {
    throw new StateMateError('too-large', `That machine is too large to draw (${raw.transitions.length} transitions).`);
  }

  const legal = new Set(transitionFieldsFor(machine));
  const tapeCount = spec.tapeCount || App.tapeCount || 1;

  spec.transitions = raw.transitions.map((t, i) => {
    if (!t || typeof t !== 'object') fail(`Transition #${i + 1} is not an object.`);
    const from = String(t.from ?? '').trim();
    const to = String(t.to ?? '').trim();
    if (!from || !to) fail(`Transition #${i + 1} is missing 'from' or 'to'.`);

    const out = { from, to };

    // `on` is the read symbol under any of the names a model might reach for.
    const read = t.on !== undefined ? t.on : (t.symbol !== undefined ? t.symbol : t.read);
    out.on = normalizeSymbol(read, { allowEpsilon: cfg.hasEpsilon }) ?? App.config.sym.eps;

    if (legal.has('write')) out.write = normalizeSymbol(t.write) ?? out.on;
    if (legal.has('move')) out.move = normalizeMove(t.move ?? t.dir);
    if (legal.has('pop')) out.pop = normalizeSymbol(t.pop) ?? App.config.sym.eps;
    if (legal.has('push')) out.push = normalizeSymbol(t.push) ?? App.config.sym.eps;
    if (legal.has('pop2')) out.pop2 = normalizeSymbol(t.pop2) ?? App.config.sym.eps;
    if (legal.has('push2')) out.push2 = normalizeSymbol(t.push2) ?? App.config.sym.eps;
    if (legal.has('out')) out.out = String((t.out ?? t.output) ?? '');
    if (legal.has('weight')) {
      const w = Number(t.weight);
      out.weight = Number.isFinite(w) ? w : 1;
    }
    if (legal.has('tapeSyms')) {
      const pad = (arr, fillFrom) => {
        const list = Array.isArray(arr) ? arr.map(v => normalizeSymbol(v)) : [];
        while (list.length < tapeCount) list.push(fillFrom ? fillFrom[list.length] : App.config.sym.blank);
        return list.slice(0, tapeCount);
      };
      out.tapeSyms = pad(t.tapeSyms);
      out.tapeWrites = pad(t.tapeWrites, out.tapeSyms);
      out.tapeDirs = (Array.isArray(t.tapeDirs) ? t.tapeDirs.map(normalizeMove) : [])
        .concat(Array(tapeCount).fill('S')).slice(0, tapeCount);
    }
    return out;
  });

  // ── tests ────────────────────────────────────────────────────
  // Required, and the model is told they will be executed. That instruction is
  // the cheapest accuracy win available: it makes the model check the
  // construction while it is still writing it.
  const tests = Array.isArray(raw.tests) ? raw.tests : [];
  spec.tests = tests
    .map(t => {
      if (!t || typeof t !== 'object') return null;
      const w = t.w !== undefined ? String(t.w) : (t.word !== undefined ? String(t.word) : null);
      if (w === null) return null;
      const entry = { w };
      if (t.out !== undefined) entry.out = String(t.out);
      const expect = String(t.expect ?? '').toLowerCase();
      if (expect.startsWith('a')) entry.expect = 'accept';
      else if (expect.startsWith('r')) entry.expect = 'reject';
      if (!entry.expect && entry.out === undefined) return null;
      return entry;
    })
    .filter(Boolean);

  // ── prose ────────────────────────────────────────────────────
  spec.plan = typeof raw.plan === 'string' ? raw.plan.trim() : '';
  spec.title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'StateMate machine';
  spec.blurb = typeof raw.blurb === 'string' ? raw.blurb.trim() : '';

  // The one thing a model may say about its own answer beyond the machine
  // itself: that the machine is not quite what was asked for. It exists for
  // the request that cannot be honoured — a DFA for a non-regular language —
  // where the alternative is a confidently drawn wrong machine and a failing
  // check the user has to interpret unaided. Capped because it renders in a
  // four-line list, not given a severity because severity drives the repair
  // loop and is the app's to assign.
  const caveat = typeof raw.caveat === 'string' ? raw.caveat.trim().slice(0, MAX_CAVEAT_CHARS) : '';

  // A caveat describes the machine's relationship to the request. Coming out
  // of a repair round a model will otherwise narrate the repair instead — "the
  // machine was corrected to accurately reflect the language it recognizes" —
  // which says nothing the user can act on and takes a line on the card that a
  // real finding could have used. The prompt forbids it; this is the guard for
  // when that is ignored. A genuine caveat about a language has no reason to
  // reach for these words, and the cost of a false positive is one advisory
  // line, never a wrong machine.
  spec.caveat = PROCESS_NARRATION.test(caveat) ? '' : caveat;

  spec.notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .slice(0, 2)
    .map(n => ({
      text: String(n?.text ?? '').trim(),
      anchor: n?.anchor ? String(n.anchor).trim() : null
    }))
    .filter(n => n.text);

  // ── referential integrity ────────────────────────────────────
  const names = new Set(states.map(s => s.name));
  const unknown = new Set();
  spec.transitions.forEach(t => {
    if (!names.has(t.from)) unknown.add(t.from);
    if (!names.has(t.to)) unknown.add(t.to);
  });
  if (unknown.size) {
    fail(
      `Transitions refer to states that do not exist: ${[...unknown].map(n => `"${n}"`).join(', ')}.`,
      `Declared states: ${[...names].join(', ')}`
    );
  }

  return spec;
}

// ══════════════════════════════════════════════════════════════════
//  WHICH KIND OF TURN IS THIS
// ══════════════════════════════════════════════════════════════════
//  A model may answer with a machine or, once, with prose. Those are two
//  different things and the difference is declared, never inferred from
//  which keys happen to be present — inferring it is exactly the loose
//  matching this dialect exists to prevent, and it fails in the worst
//  direction: a machine answer truncated mid-stream would read as a
//  malformed *reply* rather than a malformed *machine*.
//
//  The asymmetry is deliberate. "reply" must be spelled out, because that is
//  the branch that writes nothing and therefore the branch a model could
//  hide a failure behind. A missing `kind` falls through to the machine
//  path, which validateSpec gates strictly enough that nothing gets in by
//  omission.

/**
 * Parse one model answer into either a machine or a reply.
 *
 * @param {object}  raw
 * @param {object}  [opts]
 * @param {string}  [opts.fallbackMachine]
 * @param {boolean} [opts.allowReply]  false inside the repair loop
 * @returns {{kind: 'machine', spec: object} | {kind: 'reply', text: string}}
 */
export function parseTurn(raw, { fallbackMachine = App.machine, allowReply = true } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('The answer was not a machine object.');
  }

  const kind = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : '';

  if (kind === 'reply') {
    // A model that has already committed to a machine does not get to talk
    // its way out of fixing it. Without this the repair loop has a legal
    // escape hatch, and the one model that cannot produce valid JSON is the
    // one that will find it.
    if (!allowReply) {
      fail('A reply is not a correction — return the fixed machine, as JSON.');
    }
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_REPLY_CHARS) : '';
    if (!text) fail('The reply had no text.');
    return { kind: 'reply', text };
  }

  return { kind: 'machine', spec: validateSpec(raw, { fallbackMachine }) };
}

// ══════════════════════════════════════════════════════════════════
//  THE OTHER DIRECTION
// ══════════════════════════════════════════════════════════════════

/**
 * The live machine (or any {states, transitions, …} in internal form) as a
 * spec. Used twice: to attach the canvas to a prompt, and to compile the
 * bundled example files into few-shots — which is what keeps the worked
 * example in the prompt from ever drifting from the schema, since it is
 * produced by this function rather than written by hand.
 */
/**
 * One internal transition in the dialect. Factored out of machineToSpec so
 * anything that needs a single transition described — the diff, the focus
 * block — cannot drift from what the model is shown.
 */
export function transitionToSpec(t, machine, nameOf = id => id) {
  const legal = new Set(transitionFieldsFor(machine));
  const out = { from: nameOf(t.from), to: nameOf(t.to), on: t.symbol };
  if (legal.has('write')) out.write = t.write;
  if (legal.has('move')) out.move = t.dir;
  if (legal.has('pop')) out.pop = t.pop;
  if (legal.has('push')) out.push = t.push;
  if (legal.has('pop2')) out.pop2 = t.pop2;
  if (legal.has('push2')) out.push2 = t.push2;
  if (legal.has('out')) out.out = t.output ?? '';
  if (legal.has('weight')) out.weight = t.weight ?? 1;
  if (legal.has('tapeSyms')) {
    out.tapeSyms = t.tapeSyms;
    out.tapeWrites = t.tapeWrites;
    out.tapeDirs = t.tapeDirs;
  }
  return out;
}

/**
 * What a spec transition reads on and does, without its endpoints — the middle
 * of the arrow. One function per machine family rather than per machine, since
 * the families are what decide which fields exist.
 */
export function specTransitionDetail(t, machine = App.machine) {
  const eps = App.config.sym.eps;
  const on = t.on === '' || t.on === undefined ? eps : t.on;
  const legal = new Set(transitionFieldsFor(machine));

  if (legal.has('tapeSyms')) {
    const reads = (t.tapeSyms || []).join(',');
    const writes = (t.tapeWrites || []).join(',');
    const dirs = (t.tapeDirs || []).join(',');
    return `[${reads}] → [${writes}], ${dirs}`;
  }
  if (legal.has('write')) return `${on} → ${t.write ?? on}, ${t.move ?? '?'}`;
  if (legal.has('pop')) {
    const stack = `${t.pop ?? eps}/${t.push ?? eps}`;
    const second = legal.has('pop2') ? `; ${t.pop2 ?? eps}/${t.push2 ?? eps}` : '';
    return `${on}, ${stack}${second}`;
  }
  if (legal.has('move')) return `${on}, ${t.move ?? '?'}`;
  if (legal.has('out')) return `${on} / ${t.out ?? ''}`;
  if (legal.has('weight')) return `${on} : ${t.weight ?? 1}`;
  return String(on);
}

/** The whole arrow, as one line: `q0 --a--> q1`. */
export function specTransitionLabel(t, machine = App.machine) {
  return `${t.from} --${specTransitionDetail(t, machine)}--> ${t.to}`;
}

/**
 * Selected parts of the live machine, named the way the model knows them.
 *
 * This is the one place the canvas's ids have to be turned into something a
 * prompt can carry, and turning them into *names* rather than passing them
 * through is the whole point: the dialect has no ids, so an id in the focus
 * block would be a token the model has never seen attached to anything.
 *
 * Refs are resolved late, at send time, so a chip added before a rename still
 * points at the right state. One that no longer resolves is counted rather
 * than guessed at.
 *
 * @param {Array<object>} refs  [{kind: 'states'|'transitions'|'notes'|'word', ids?, w?}]
 */
export function resolveContextRefs(refs = [], source = null) {
  const src = source || { machine: App.machine, states: App.states, transitions: App.transitions, notes: App.notes };
  const machine = src.machine || App.machine;
  const byId = new Map((src.states || []).map(s => [s.id, s]));
  const nameOf = id => byId.get(id)?.name || id;
  const transById = new Map((src.transitions || []).map(t => [t.id, t]));
  const noteById = new Map((src.notes || []).map(n => [n.id, n]));

  const out = { states: [], transitions: [], notes: [], words: [], missing: 0 };
  const seen = new Set();
  const once = (bucket, value) => {
    const key = `${bucket}::${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out[bucket].push(value);
  };

  refs.forEach(ref => {
    if (!ref) return;
    if (ref.kind === 'word') {
      const w = String(ref.w ?? '');
      once('words', w === '' ? App.config.sym.eps : w);
      return;
    }
    (ref.ids || []).forEach(id => {
      if (ref.kind === 'states') {
        if (!byId.has(id)) return void out.missing++;
        once('states', nameOf(id));
      } else if (ref.kind === 'transitions') {
        const t = transById.get(id);
        if (!t) return void out.missing++;
        once('transitions', specTransitionLabel(transitionToSpec(t, machine, nameOf), machine));
      } else if (ref.kind === 'notes') {
        const n = noteById.get(id);
        if (!n) return void out.missing++;
        once('notes', String(n.text || '').trim());
      }
    });
  });

  out.notes = out.notes.filter(Boolean);
  return out;
}

/** True when a resolved focus has anything in it worth sending. */
export function focusIsEmpty(focus) {
  if (!focus) return true;
  return !focus.states.length && !focus.transitions.length && !focus.notes.length && !focus.words.length;
}

/**
 * The block tree, as the dialect states it.
 *
 * **A block is addressed by its path**, not by its name, because a name is
 * unique among siblings only — "add" under the ALU and "add" under the FPU are
 * two blocks. That is the same shape a state name already has (inlining writes
 * the path into it), so `CPU/ALU 2` reads beside `CPU/ALU 2/scan` rather than
 * against it.
 *
 * Read from the live records when the source is the canvas and from the
 * source's own when it is not, so a candidate on the bench describes itself
 * rather than whatever happens to be on screen.
 */
function specBlockRecords(src) {
  if (Array.isArray(src.blocks)) return src.blocks;
  return src === null ? [] : liveBlocks();
}

function pathIndex(blocks, live) {
  if (live) return new Map(blocks.map(b => [b.id, blockPath(b.id)]));
  // A snapshot's records carry local names and parent ids, so the path is
  // walked here rather than asked of the tree — the tree describes the canvas,
  // and this may not be it.
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

function blockContext(src) {
  // A *cut* of the live machine carries real records, and their paths have to
  // stay the machine's own: walked over the filtered list, `ALU/ADD` comes back
  // as `ADD`, because the parent it names is not in the list. That reads fine
  // and matches nothing — compileSpec pairs a spec block to an existing record
  // *by path*, so a scoped edit would mint a second ALU/ADD beside the first
  // and the reader would end up with two. `blockPaths` is scopedSource() saying
  // which tree these came from rather than leaving it to be inferred.
  if (src.blockPaths) return { blocks: src.blocks || [], paths: asPathMap(src.blockPaths) };
  const live = !Array.isArray(src.blocks);
  const blocks = live ? liveBlocks() : src.blocks;
  return { blocks, paths: pathIndex(blocks, live) };
}

/**
 * A path index, however it arrived.
 *
 * `scopedSource()` builds a `Map`, and a Map does not survive `JSON.stringify`
 * — it comes back as `{}`. Everything downstream of a source is entitled to
 * round-trip it: `createAgentSession` clones its input, the tool layer
 * checkpoints drafts, and a worker structured-clones a machine. Read straight,
 * the cloned `{}` was still truthy, so `blockContext` handed back an object
 * with no `.get` and the next line threw — the cut worked in the one-shot path
 * and crashed the moment an agent session was opened inside a block.
 *
 * So the shape is normalised on read rather than defended at each call site.
 */
function asPathMap(paths) {
  if (paths instanceof Map) return paths;
  return new Map(Object.entries(paths || {}));
}

function blocksToSpec({ blocks, paths }, src, machine, nameOf) {
  if (!machineSupportsBlocks(machine)) return [];
  const live = new Set((src.states || []).map(s => s.id));
  return blocks
    .filter(b => live.has(b.entry))
    .map(b => ({
      name: paths.get(b.id) || b.name,
      parent: b.parent ? (paths.get(b.parent) || null) : null,
      entry: nameOf(b.entry),
      exits: (b.exits || [])
        .filter(e => live.has(e.id))
        .map(e => ({ state: nameOf(e.id), label: String(e.label ?? '') }))
    }));
}

/**
 * The machine, cut down to one block and everything under it.
 *
 * **A drill-in changed what the reader could see and nothing about what the
 * model was shown.** `machineToSpec()` sends `App.states` — every state at every
 * depth, three thousand of them on a CPU — so asking why the adder rejects
 * `11+01` handed the model the whole processor and no way to tell which forty
 * states were the adder. The context chip said so out loud: "614 states, 19191
 * transitions" while eight were on screen.
 *
 * So the subject follows the scope. What comes back is a real machine in its
 * own right — it starts at the block's entry, which is where control actually
 * arrives — plus a `boundary` describing how it is reached and where it hands
 * control back. Without that it is a disconnected fragment, which is the same
 * thing a drilled-in view without ports would be, and for the same reason.
 *
 * Null at the top level, so a machine with no blocks in it sends exactly what
 * it always sent.
 */
export function scopedSource(blockId = null) {
  const id = blockId || (liveScope()[liveScope().length - 1] ?? null);
  const b = id ? getBlock(id) : null;
  if (!b) return null;

  const under = new Set(blockSubtree(id));
  const inside = (App.states || []).filter(s => s.blockId && under.has(s.blockId));
  if (!inside.length) return null;
  const ids = new Set(inside.map(s => s.id));
  // Indexed, not scanned. `App.states.find` per crossing is the pattern
  // getState() exists to replace — and this runs on every prompt build and,
  // through the console's context chip, on every selection change.
  const nameOf = sid => getState(sid)?.name || sid;

  const within = [];
  const crossings = { in: [], out: [] };
  for (const t of App.transitions || []) {
    const f = ids.has(t.from), o = ids.has(t.to);
    if (f && o) within.push(t);
    else if (o) crossings.in.push({ from: nameOf(t.from), to: nameOf(t.to) });
    else if (f) crossings.out.push({ from: nameOf(t.from), to: nameOf(t.to) });
  }

  return {
    machine: App.machine,
    states: inside,
    transitions: within,
    // Control arrives at the entry. Not App.startId, which is the *machine's*
    // start and is very likely not under this block at all.
    startId: b.entry,
    accepts: [...App.accepts].filter(x => ids.has(x)),
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount,
    blocks: (App.blocks || []).filter(x => under.has(x.id)),
    // Absolute, from the tree these records actually belong to — and including
    // the *ancestors* of the cut, which are not in it. `blocksToSpec` resolves
    // a record's `parent` through this map, so with only the subtree in it the
    // block being edited comes back declaring no parent at all, which reads as
    // "move me to the top level" and is the one thing a scoped edit must not
    // be able to say by omission.
    blockPaths: new Map([
      ...blockAncestry(id).map(x => [x.id, blockPath(x.id)]),
      ...[...under].map(x => [x, blockPath(x)])
    ]),
    scope: {
      id,
      path: blockPath(id),
      entry: nameOf(b.entry),
      exits: (b.exits || []).filter(e => ids.has(e.id)).map(e => ({ state: nameOf(e.id), label: e.label })),
      crossings
    }
  };
}

export function machineToSpec(source = null, { includeTests = false } = {}) {
  const src = source || {
    machine: App.machine,
    states: App.states,
    transitions: App.transitions,
    startId: App.startId,
    accepts: [...App.accepts],
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount
  };

  const machine = src.machine || App.machine;
  const cfg = getMachineConfig(machine);
  const parity = usesParityPriorities(machine);
  const accepts = new Set(src.accepts instanceof Set ? [...src.accepts] : (src.accepts || []));
  const byId = new Map((src.states || []).map(s => [s.id, s]));
  const nameOf = id => byId.get(id)?.name || id;
  const tree = blockContext(src);

  const spec = {
    machine,
    sigma: [...(src.sigma instanceof Set ? src.sigma : (src.sigma || []))],
    states: (src.states || []).map(s => {
      const out = { name: s.name || s.id, start: s.id === src.startId };
      if (parity) out.priority = statePriority(s);
      else out.accept = accepts.has(s.id);
      if (hasStateOutput(machine)) out.out = s.output ?? '';
      // Only when there is one. A machine with no blocks in it describes
      // exactly what it always described, so no prompt, few-shot or test that
      // predates the field sees a byte of it.
      //
      // The index is built once for the whole machine, never per state: this
      // function runs on every prompt build and twice more on every diff, and a
      // path walk per state is the machine's size times its depth for a fact
      // that is the same each time round.
      const path = s.blockId ? (tree.paths.get(s.blockId) || null) : null;
      if (path) out.block = path;
      return out;
    }),
    transitions: (src.transitions || []).map(t => transitionToSpec(t, machine, nameOf))
  };

  const blocks = blocksToSpec(tree, src, machine, nameOf);
  if (blocks.length) spec.blocks = blocks;
  // Only ever set by scopedSource(). It is not part of the dialect a model may
  // *send* — validateSpec never reads it — because how a block is reached is a
  // fact about the machine around it, which a scoped turn is not being shown
  // and must not be able to rewrite.
  if (src.scope) spec.scope = src.scope;

  if (cfg.hasStack) spec.stackAlpha = [...(src.stackAlpha instanceof Set ? src.stackAlpha : (src.stackAlpha || []))];
  if (cfg.isTransducer) spec.outputAlpha = [...(src.outputAlpha instanceof Set ? src.outputAlpha : (src.outputAlpha || []))];
  if (isMultiTape(machine)) spec.tapeCount = src.tapeCount || 2;
  if (includeTests && Array.isArray(src.tests)) spec.tests = src.tests;

  return spec;
}

/** A one-line description of a spec or machine, for chips and status text. */
export function describeSpecSize(spec) {
  const s = spec?.states?.length || 0;
  const t = spec?.transitions?.length || 0;
  return `${s} state${s === 1 ? '' : 's'}, ${t} transition${t === 1 ? '' : 's'}`;
}

/** Whether a machine's tests are ω-words, output words, or plain verdicts. */
export function testKindFor(machine) {
  if (isOmegaAutomaton(machine)) return 'omega';
  if (getMachineConfig(machine).isTransducer) return 'output';
  return 'verdict';
}
