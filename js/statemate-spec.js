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
  App, MachineTypes, getMachineConfig, isOmegaAutomaton, isTwoWayFA,
  statePriority, usesParityPriorities
} from './state.js';

// A machine bigger than this is past the collision-avoidance budget in
// geometry.js — drawing it would be slow and unreadable, so it is refused
// rather than rendered badly.
export const MAX_SPEC_STATES = 120;
export const MAX_SPEC_TRANSITIONS = 600;
export const MIN_SPEC_TESTS = 3;

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
// Derived from MachineTypes rather than listed per machine, so a machine
// added to state.js is describable here without touching this file.

/**
 * Legal transition keys for a machine, in the order the prompt should
 * present them. Ordering trap, same as langTupleSyms: the tape check has to
 * come before the stack check, because every TM in MachineTypes carries
 * hasStack: true as well as hasTape.
 */
export function transitionFieldsFor(machine) {
  const cfg = getMachineConfig(machine);
  const fields = ['from', 'to', 'on'];

  if (cfg.hasTape) {
    if (machine === 'MTM') fields.push('tapeSyms', 'tapeWrites', 'tapeDirs');
    else fields.push('write', 'move');
  } else if (cfg.hasStack) {
    fields.push('pop', 'push');
    if (machine === '2PDA') fields.push('pop2', 'push2');
  } else if (isTwoWayFA(machine)) {
    // A two-way head moves without writing.
    fields.push('move');
  }

  // Moore hangs its output off the state, so its transitions carry none.
  if (cfg.isTransducer && machine !== 'Moore') fields.push('out');
  if (cfg.isWeighted) fields.push('weight');
  return fields;
}

/** Legal state keys for a machine. */
export function stateFieldsFor(machine) {
  const fields = ['name', 'start'];
  // Parity replaces F with a per-state priority: there is no accepting set to
  // mark, and offering one invites the model to produce both.
  if (usesParityPriorities(machine)) fields.push('priority');
  else fields.push('accept');
  if (machine === 'Moore') fields.push('out');
  return fields;
}

/** Alphabet keys a spec for this machine must or may carry. */
export function alphabetFieldsFor(machine) {
  const cfg = getMachineConfig(machine);
  const fields = ['sigma'];
  if (cfg.hasStack) fields.push('stackAlpha');
  if (cfg.isTransducer) fields.push('outputAlpha');
  if (machine === 'MTM') fields.push('tapeCount');
  return fields;
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
    if (machine === 'Moore') {
      out.out = s.out !== undefined ? String(s.out) : (s.output !== undefined ? String(s.output) : '');
    }
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
  if (machine === 'MTM') {
    const n = Number(raw.tapeCount);
    spec.tapeCount = Number.isInteger(n) && n >= 2 && n <= 4 ? n : App.tapeCount;
  }

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
//  THE OTHER DIRECTION
// ══════════════════════════════════════════════════════════════════

/**
 * The live machine (or any {states, transitions, …} in internal form) as a
 * spec. Used twice: to attach the canvas to a prompt, and to compile the
 * bundled example files into few-shots — which is what keeps the worked
 * example in the prompt from ever drifting from the schema, since it is
 * produced by this function rather than written by hand.
 */
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

  const spec = {
    machine,
    sigma: [...(src.sigma instanceof Set ? src.sigma : (src.sigma || []))],
    states: (src.states || []).map(s => {
      const out = { name: s.name || s.id, start: s.id === src.startId };
      if (parity) out.priority = statePriority(s);
      else out.accept = accepts.has(s.id);
      if (machine === 'Moore') out.out = s.output ?? '';
      return out;
    }),
    transitions: (src.transitions || []).map(t => {
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
    })
  };

  if (cfg.hasStack) spec.stackAlpha = [...(src.stackAlpha instanceof Set ? src.stackAlpha : (src.stackAlpha || []))];
  if (cfg.isTransducer) spec.outputAlpha = [...(src.outputAlpha instanceof Set ? src.outputAlpha : (src.outputAlpha || []))];
  if (machine === 'MTM') spec.tapeCount = src.tapeCount || 2;
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
