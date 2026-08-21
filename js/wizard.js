// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  MACHINE WIZARD — THE DRAFT
// ══════════════════════════════════════════════════════════════════
//  A machine, assembled by answering questions instead of by drawing.
//  This module is the half with no DOM in it: it holds the draft, decides
//  which questions a given machine is asked, validates the answers, and
//  hands the finished thing to the pipeline that already exists.
//
//  ── Why there is almost nothing here ──────────────────────────────
//
//  The route from "a machine described declaratively" to "a machine on the
//  canvas" was already built, tested, and free of anything to do with a
//  model provider:
//
//      draftToSpec()      this module — answers → the spec dialect
//      validateSpec()     js/statemate-spec.js — schema, one start, refs
//      compileSpec()      js/statemate-compile.js — spec → candidate
//      lintCandidate()    js/statemate-lint.js — the machine-shape rules
//      applyCandidate()   js/statemate.js — one commit(), one Ctrl+Z
//
//  The wizard is the second caller of that pipeline, not a second copy of
//  it. Everything the pipeline guarantees StateMate — the canvas is written
//  exactly once, at the end, or not at all; an edit keeps the ids, positions
//  and hand-tuned curves of every state it did not touch — is therefore true
//  of the wizard for free, and true for every machine in MachineTypes,
//  because transitionFieldsFor() and friends derive the fields from the
//  capability flags rather than listing them per machine.
//
//  ── Two decisions worth knowing ──────────────────────────────────
//
//  **Rows reference each other by key, not by name.** A transition's `from`
//  is a draft-local key (`w3`), resolved to a state name only in
//  draftToSpec(). Renaming a state is then just a rename; if transitions
//  held names, renaming "q0" would silently orphan every rule that left it,
//  and the wizard would be the one surface in the app where renaming a state
//  breaks the machine.
//
//  **The draft outlives the dialog.** Nothing is written until Create, so
//  closing the wizard is free and reopening it resumes — the same
//  non-destructive-leave StateMate's panel has. It is only rebuilt when the
//  canvas has moved underneath it, which machineSignature() answers.

import { showExampleCard } from './persistence.js';
import {
  App, MachineTypes, getMachineConfig, isBoundarySymbol, isEndmarkerMachine,
  isTwoWayFA, isWeightedFA, omegaAcceptanceOf, statePriority, usesParityPriorities
} from './state.js';
import { applyCandidate, machineSignature } from './statemate.js';
import { compileSpec, stateNameKey } from './statemate-compile.js';
import { lintCandidate } from './statemate-lint.js';
import {
  MAX_SPEC_STATES, StateMateError, alphabetFieldsFor, machineToSpec,
  stateFieldsFor, transitionFieldsFor, validateSpec
} from './statemate-spec.js';
import { hasStateOutput, isMultiTape, machineOptions } from './machines/index.js';
import { hasSingleValuedDelta } from './utils.js';
import {
  FIELD_COPY, FIELD_COPY_BY_MACHINE, OPTION_COPY, READ_HINTS, STATE_FIELD_COPY,
  STEP_COPY
} from './wizard-copy.js';

// ══════════════════════════════════════════════════════════════════
//  RUNTIME STATE
// ══════════════════════════════════════════════════════════════════

/** The one live draft. Null until the wizard has been opened once. */
export const Wizard = {
  mode: 'create',      // 'create' | 'edit'
  draft: null,
  step: 0,
  // machineSignature() as it was when an edit draft was filled in. A draft
  // built from a machine that has since changed is stale prefill, not a
  // resumable answer.
  signature: '',
  // Steps the reader has left at least once, so a field is not marked wrong
  // before it has been visited.
  seen: new Set()
};

let keyN = 0;
const newKey = () => 'w' + (++keyN);

/** Test seam: forget the draft and the key counter. */
export function resetWizard() {
  Wizard.mode = 'create';
  Wizard.draft = null;
  Wizard.step = 0;
  Wizard.signature = '';
  Wizard.seen = new Set();
  keyN = 0;
}

// ══════════════════════════════════════════════════════════════════
//  WHICH QUESTIONS THIS MACHINE IS ASKED
// ══════════════════════════════════════════════════════════════════
//  Every `applies` below reads a capability flag, never a machine name, so
//  a machine added to js/state.js is asked the right questions on the day
//  it is added. The two exceptions are the two places the *app* singles a
//  machine out anyway: MTM's tape count and PFA's cut point.

const STEP_ORDER = [
  {
    id: 'model',
    applies: () => true
  },
  {
    id: 'sigma',
    applies: () => true
  },
  {
    // Γ. One field, two entirely different things: a stack machine's store
    // and a tape machine's cell contents. Same ordering trap as everywhere
    // else — every TM carries hasStack as well as hasTape.
    id: 'gamma',
    applies: m => getMachineConfig(m).hasStack
  },
  {
    id: 'delta',
    applies: m => getMachineConfig(m).isTransducer
  },
  {
    id: 'options',
    applies: m => optionsFor(m).length > 0
  },
  {
    id: 'states',
    applies: () => true
  },
  {
    id: 'transitions',
    applies: () => true
  },
  {
    id: 'describe',
    applies: () => true
  },
  {
    id: 'review',
    applies: () => true
  }
];

/**
 * The settings this machine has that are neither its alphabet nor its graph.
 *
 * Declared by the machine (js/machines/), not inferred here. Inferring it
 * meant the wizard's list of knobs and usesTwoWayTape()'s list of machines
 * that read one were two derivations of the same fact, kept in step by
 * hand and by an exclusion for LBA written twice.
 */
export function optionsFor(machine) {
  return machineOptions(machine);
}

/**
 * The steps this machine's wizard has, in order, with the copy resolved.
 * @returns {Array<{id, question, description, examples}>}
 */
export function wizardSteps(machine = App.machine) {
  return STEP_ORDER
    .filter(s => s.applies(machine))
    .map(s => ({ id: s.id, ...stepCopy(s.id, machine) }));
}

/** Resolve one step's copy for one machine: base text, overridden by flavour. */
export function stepCopy(id, machine = App.machine) {
  const base = STEP_COPY[id] || {};
  const flavour = stepFlavour(id, machine);
  const description = (flavour && base.variants && base.variants[flavour]) || base.description || '';
  const short = (flavour && base.shortVariants && base.shortVariants[flavour]) || base.short || id;
  return {
    short,
    question: base.question || '',
    description,
    examples: base.examples || [],
    flavour
  };
}

/**
 * Which variant of a step's copy applies. Derived from capability flags; the
 * result is a key into STEP_COPY[id].variants, or '' for the base text.
 */
export function stepFlavour(id, machine = App.machine) {
  const cfg = getMachineConfig(machine);

  if (id === 'sigma') {
    if (cfg.hasTape) return 'tape';
    if (cfg.isOmega) return 'omega';
    return '';
  }

  if (id === 'gamma') {
    if (cfg.hasTape) return 'tape';
    if (machine === 'QA') return 'queue';
    if (machine === 'Counter') return 'counter';
    if (machine === '2PDA') return 'twoStack';
    return '';
  }

  if (id === 'states') {
    if (usesParityPriorities(machine)) return 'parity';
    if (hasStateOutput(machine)) return 'moore';
    if (cfg.isOmega) return omegaAcceptanceOf(machine) === 'cobuchi' ? 'cobuchi' : 'omega';
    if (cfg.hasTape) return 'tape';
    if (cfg.isTransducer) return 'transducer';
    return '';
  }

  if (id === 'transitions') {
    if (isMultiTape(machine)) return 'multiTape';
    if (cfg.hasTape) return 'tape';
    if (machine === 'QA') return 'queue';
    if (cfg.hasStack) return 'stack';
    if (cfg.isWeighted) return 'weighted';
    if (isTwoWayFA(machine)) return 'twoWay';
    if (cfg.isTransducer) return 'transducer';
    return hasSingleValuedDelta(machine) ? 'deterministic' : 'nondeterministic';
  }

  return '';
}

// ══════════════════════════════════════════════════════════════════
//  FIELD COPY
// ══════════════════════════════════════════════════════════════════

/** Label and hint for one transition field on one machine. */
export function fieldCopy(machine, field) {
  const override = (FIELD_COPY_BY_MACHINE[machine] || {})[field];
  const base = FIELD_COPY[field] || { label: field, hint: '' };
  const copy = { ...base, ...(override || {}) };
  if (field === 'on') copy.hint = readHint(machine);
  return copy;
}

/** What "reads" means on this machine — the field whose meaning moves most. */
export function readHint(machine) {
  const cfg = getMachineConfig(machine);
  if (isMultiTape(machine)) return READ_HINTS.multiTape;
  if (cfg.hasTape) return READ_HINTS.tape;
  if (cfg.hasEpsilon) return READ_HINTS.epsilon;
  if (cfg.isOmega) return READ_HINTS.omega;
  return READ_HINTS.wildcard;
}

/** Label and hint for one state field. */
export function stateFieldCopy(machine, field) {
  const override = (FIELD_COPY_BY_MACHINE[machine] || {})[field];
  return { ...(STATE_FIELD_COPY[field] || { label: field, hint: '' }), ...(override || {}) };
}

/** Label and hint for one machine option. */
export function optionCopy(name) {
  return OPTION_COPY[name] || { label: name, hint: '' };
}

// ══════════════════════════════════════════════════════════════════
//  THE DRAFT
// ══════════════════════════════════════════════════════════════════

function blankTransition(machine, draft) {
  const sym = App.config.sym;
  const fields = transitionFieldsFor(machine);
  const row = { key: newKey(), from: '', to: '', on: '' };
  const tapes = draft?.tapeCount || App.tapeCount || 2;

  if (fields.includes('write')) row.write = '';
  if (fields.includes('move')) row.move = 'R';
  if (fields.includes('pop')) row.pop = sym.eps;
  if (fields.includes('push')) row.push = sym.eps;
  if (fields.includes('pop2')) row.pop2 = sym.eps;
  if (fields.includes('push2')) row.push2 = sym.eps;
  if (fields.includes('out')) row.out = '';
  if (fields.includes('weight')) row.weight = 1;
  if (fields.includes('tapeSyms')) {
    row.tapeSyms = Array(tapes).fill(sym.blank);
    row.tapeWrites = Array(tapes).fill(sym.blank);
    row.tapeDirs = Array(tapes).fill('S');
  }
  return row;
}

function blankState(machine, name) {
  const state = { key: newKey(), name, start: false, accept: false };
  if (usesParityPriorities(machine)) state.priority = 0;
  if (hasStateOutput(machine)) state.out = '';
  return state;
}

/**
 * An empty draft, seeded with one start state.
 *
 * Σ is deliberately left empty rather than copied from the canvas: "what
 * alphabet does your machine use" is a real question, and pre-filling it with
 * {a, b} answers it on the reader's behalf with something they never chose.
 */
export function newDraft(machine = App.machine) {
  const cfg = getMachineConfig(machine);
  const sym = App.config.sym;
  const draft = {
    machine,
    sigma: [],
    states: [blankState(machine, (App.config.statePrefix || 'q') + '0')],
    transitions: [],
    meta: { title: '', blurb: '', tests: [] }
  };
  draft.states[0].start = true;

  if (cfg.hasStack) {
    draft.stackAlpha = cfg.hasTape ? [sym.blank] : [sym.stackBottom];
    if (isEndmarkerMachine(machine) && cfg.hasTape) {
      draft.stackAlpha = [sym.leftMarker, sym.blank, sym.rightMarker];
    }
  }
  if (cfg.isTransducer) draft.outputAlpha = [];
  if (isMultiTape(machine)) draft.tapeCount = App.tapeCount || 2;
  if (isWeightedFA(machine)) draft.cutPoint = App.config.pfaCutPoint;
  if (optionsFor(machine).includes('twoWayTape')) draft.twoWayTape = !!App.config.twoWayTape;

  return draft;
}

/**
 * A draft filled in from the machine on the canvas.
 *
 * machineToSpec() is the same view of the canvas StateMate's prompt is built
 * from, so the wizard and the model are looking at the same machine.
 */
export function draftFromCanvas() {
  const spec = machineToSpec();
  const machine = spec.machine;
  const draft = newDraft(machine);

  draft.sigma = [...spec.sigma];
  if (draft.stackAlpha && spec.stackAlpha) draft.stackAlpha = [...spec.stackAlpha];
  if (draft.outputAlpha && spec.outputAlpha) draft.outputAlpha = [...spec.outputAlpha];
  if (spec.tapeCount) draft.tapeCount = spec.tapeCount;

  const byName = new Map();
  draft.states = spec.states.map(s => {
    const state = blankState(machine, s.name);
    state.start = !!s.start;
    state.accept = !!s.accept;
    if (usesParityPriorities(machine)) state.priority = statePriority(s);
    if (hasStateOutput(machine)) state.out = s.out ?? '';
    byName.set(s.name, state.key);
    return state;
  });

  draft.transitions = spec.transitions.map(t => {
    const row = blankTransition(machine, draft);
    Object.keys(t).forEach(f => {
      if (f === 'from' || f === 'to') return;
      row[f] = Array.isArray(t[f]) ? [...t[f]] : t[f];
    });
    row.from = byName.get(t.from) || '';
    row.to = byName.get(t.to) || '';
    return row;
  });

  const meta = App.meta;
  draft.meta = {
    title: meta?.title || '',
    blurb: meta?.blurb || '',
    tests: (meta?.inputs || []).map(i => ({
      key: newKey(),
      w: i.w ?? '',
      expect: i.expect || '',
      out: i.out
    }))
  };

  return draft;
}

// ── Mutation helpers ──────────────────────────────────────────────
//  Everything the UI does to a draft goes through one of these, so the
//  bookkeeping that keeps a draft coherent — exactly one start state, tape
//  arrays as wide as the tape count — has one home.

export function addState(draft, name = '') {
  const used = new Set(draft.states.map(s => stateNameKey(s.name)));
  let n = draft.states.length;
  let auto = name;
  if (!auto) {
    const prefix = App.config.statePrefix || 'q';
    do { auto = prefix + n++; } while (used.has(stateNameKey(auto)));
  }
  const state = blankState(draft.machine, auto);
  if (!draft.states.some(s => s.start)) state.start = true;
  draft.states.push(state);
  return state;
}

export function removeState(draft, key) {
  draft.states = draft.states.filter(s => s.key !== key);
  draft.transitions = draft.transitions.filter(t => t.from !== key && t.to !== key);
  if (draft.states.length && !draft.states.some(s => s.start)) draft.states[0].start = true;
}

/** Exactly one start state, always — the reason this is not a plain checkbox. */
export function setStart(draft, key) {
  draft.states.forEach(s => { s.start = s.key === key; });
}

export function addTransition(draft) {
  const row = blankTransition(draft.machine, draft);
  const first = draft.states[0];
  if (first) { row.from = first.key; row.to = first.key; }
  const syms = symbolChoices(draft, 'on');
  if (syms.length) row.on = syms[0].value;
  if (getMachineConfig(draft.machine).hasTape && !isMultiTape(draft.machine)) row.write = row.on;
  draft.transitions.push(row);
  return row;
}

export function removeTransition(draft, key) {
  draft.transitions = draft.transitions.filter(t => t.key !== key);
}

/** Keep every per-tape array exactly as wide as the tape count. */
export function setDraftTapeCount(draft, n) {
  const count = Math.max(2, Math.min(4, Number(n) || 2));
  draft.tapeCount = count;
  const blank = App.config.sym.blank;
  draft.transitions.forEach(t => {
    ['tapeSyms', 'tapeWrites', 'tapeDirs'].forEach(f => {
      if (!Array.isArray(t[f])) return;
      const fill = f === 'tapeDirs' ? 'S' : blank;
      while (t[f].length < count) t[f].push(fill);
      t[f] = t[f].slice(0, count);
    });
  });
}

export function addTest(draft) {
  const row = { key: newKey(), w: '', expect: 'accept' };
  draft.meta.tests.push(row);
  return row;
}

export function removeTest(draft, key) {
  draft.meta.tests = draft.meta.tests.filter(t => t.key !== key);
}

/**
 * Change the machine a draft is for.
 *
 * The graph is carried across — states and transitions keep their names and
 * their shape — but fields the new machine does not have go, and fields it
 * does have appear with their defaults. compileSpec() starts clean on a type
 * change anyway, so nothing is promised here that the compiler would not keep.
 */
export function setDraftMachine(draft, machine) {
  if (!MachineTypes[machine] || draft.machine === machine) return draft;
  const next = newDraft(machine);
  next.sigma = [...draft.sigma];
  next.meta = draft.meta;
  if (next.stackAlpha && draft.stackAlpha) {
    // Keep whatever the old store held that the new one can also hold; the
    // linter adds back anything required that is missing.
    const keep = draft.stackAlpha.filter(s => !isBoundarySymbol(s));
    next.stackAlpha = [...new Set([...next.stackAlpha, ...keep])];
  }
  if (next.outputAlpha && draft.outputAlpha) next.outputAlpha = [...draft.outputAlpha];

  next.states = draft.states.map(s => {
    const state = blankState(machine, s.name);
    state.key = s.key;
    state.start = s.start;
    state.accept = usesParityPriorities(machine) ? false : s.accept;
    if (usesParityPriorities(machine)) state.priority = s.priority ?? 0;
    if (hasStateOutput(machine)) state.out = s.out ?? '';
    return state;
  });

  next.transitions = draft.transitions.map(t => {
    const row = blankTransition(machine, next);
    row.key = t.key;
    row.from = t.from;
    row.to = t.to;
    row.on = t.on;
    // Anything the new machine also has keeps its answer.
    Object.keys(row).forEach(f => {
      if (['key', 'from', 'to', 'on'].includes(f)) return;
      if (t[f] === undefined) return;
      row[f] = Array.isArray(t[f]) ? [...t[f]] : t[f];
    });
    return row;
  });
  if (isMultiTape(machine)) setDraftTapeCount(next, next.tapeCount);

  return next;
}

// ══════════════════════════════════════════════════════════════════
//  WHAT MAY GO IN A FIELD
// ══════════════════════════════════════════════════════════════════
//  The wizard's central usability claim: you pick symbols out of the
//  alphabet you just declared instead of typing them again. A symbol that
//  is not in Σ cannot be typed into a transition by accident, which is the
//  commonest way a hand-built machine silently rejects everything.

/**
 * The offered values for one symbol field, as {value, label, note} rows.
 * A value already in the draft is always included, even when it is not one
 * of the legal choices — an answer is never silently dropped from a menu.
 */
export function symbolChoices(draft, field, current = '') {
  const machine = draft.machine;
  const cfg = getMachineConfig(machine);
  const sym = App.config.sym;
  const rows = [];
  const seen = new Set();
  const add = (value, note = '') => {
    if (value === undefined || value === null || seen.has(value)) return;
    seen.add(value);
    rows.push({ value, label: value === '' ? sym.eps : value, note });
  };

  if (field === 'on') {
    if (cfg.hasTape) {
      // A tape machine reads the tape, and the tape holds Γ ∪ Σ ∪ {⊔}.
      (draft.stackAlpha || []).forEach(s => add(s));
      (draft.sigma || []).forEach(s => add(s));
      add(sym.blank, 'blank cell');
    } else {
      (draft.sigma || []).forEach(s => add(s));
      if (isEndmarkerMachine(machine)) {
        add(sym.leftMarker, 'left end marker');
        add(sym.rightMarker, 'right end marker');
      }
      if (cfg.hasEpsilon) add(sym.eps, 'read nothing');
      add(sym.any, 'any other symbol');
    }
  } else if (field === 'write') {
    (draft.stackAlpha || []).forEach(s => add(s));
    add(sym.blank, 'blank cell');
  } else if (field === 'pop' || field === 'pop2') {
    add(sym.eps, 'do not look');
    (draft.stackAlpha || []).forEach(s => add(s));
  } else if (field === 'push' || field === 'push2') {
    add(sym.eps, 'put nothing back');
    (draft.stackAlpha || []).forEach(s => add(s));
  } else if (field === 'out') {
    add('', 'print nothing');
    (draft.outputAlpha || []).forEach(s => add(s));
  } else if (field === 'tapeSyms' || field === 'tapeWrites') {
    (draft.stackAlpha || []).forEach(s => add(s));
    (draft.sigma || []).forEach(s => add(s));
    add(sym.blank, 'blank cell');
  }

  if (current !== '' && current !== undefined && !seen.has(current)) {
    rows.unshift({ value: current, label: current, note: 'not in the alphabet' });
  }
  return rows;
}

/** True when a field is a free string rather than one symbol from a menu. */
export function isFreeTextField(field) {
  // A push is written symbol by symbol, so "AZ" is two stack symbols and not
  // one — a menu of single symbols cannot express it. Same for a transducer's
  // output, which may be a word.
  return field === 'push' || field === 'push2' || field === 'out';
}

// ══════════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════════
//  Two severities. An `error` blocks the step it is on and blocks Create;
//  a `warn` is said once and never blocks. Nothing here duplicates
//  validateSpec — this is what tells the reader *which answer* is wrong
//  while they can still see the field, rather than after the fact.

function issue(field, message, severity = 'error', key = '') {
  return { field, message, severity, key };
}

export function stepIssues(draft, stepId) {
  const machine = draft.machine;
  const cfg = getMachineConfig(machine);
  const out = [];

  if (stepId === 'model') {
    if (!MachineTypes[machine]) out.push(issue('machine', 'Pick a machine to build.'));
  }

  if (stepId === 'sigma') {
    if (!draft.sigma.length) out.push(issue('sigma', 'Add at least one symbol — a machine with no alphabet has no words to read.'));
  }

  if (stepId === 'gamma') {
    if (!(draft.stackAlpha || []).length) {
      out.push(issue('stackAlpha', cfg.hasTape ? 'Add at least one tape symbol.' : 'Add at least one stack symbol.'));
    }
  }

  if (stepId === 'options') {
    if (isMultiTape(machine)) {
      const n = Number(draft.tapeCount);
      if (!Number.isInteger(n) || n < 2 || n > 4) out.push(issue('tapeCount', 'A multi-tape machine has between 2 and 4 tapes.'));
    }
    if (isWeightedFA(machine)) {
      const c = Number(draft.cutPoint);
      if (!Number.isFinite(c) || c < 0 || c > 1) out.push(issue('cutPoint', 'The threshold is a probability between 0 and 1.'));
    }
  }

  if (stepId === 'states') {
    if (!draft.states.length) out.push(issue('states', 'A machine needs at least one state.'));
    if (draft.states.length > MAX_SPEC_STATES) {
      out.push(issue('states', `${draft.states.length} states is more than the canvas can draw legibly (the limit is ${MAX_SPEC_STATES}).`));
    }

    const seen = new Map();
    draft.states.forEach(s => {
      if (!String(s.name || '').trim()) {
        out.push(issue('name', 'Every state needs a name.', 'error', s.key));
        return;
      }
      const k = stateNameKey(s.name);
      if (seen.has(k)) {
        // stateNameKey, not the raw string: the compiler matches states by
        // this key, so "Even" and "even" would silently become one state.
        out.push(issue('name', `Two states are called "${s.name}". Names are matched ignoring case and spacing, so these count as the same state.`, 'error', s.key));
      } else {
        seen.set(k, s.key);
      }
      if (usesParityPriorities(machine)) {
        const p = Number(s.priority);
        if (!Number.isInteger(p) || p < 0) out.push(issue('priority', 'A priority is a whole number, 0 or more.', 'error', s.key));
      }
    });

    const starts = draft.states.filter(s => s.start);
    if (draft.states.length && !starts.length) out.push(issue('start', 'Mark one state as the start state.'));

    if (!usesParityPriorities(machine) && draft.states.length && !draft.states.some(s => s.accept)) {
      out.push(issue('accept', cfg.isTransducer
        ? 'No accepting states. That is fine for a transducer — its answer is the word it writes.'
        : 'No accepting states, so this machine will reject every word. That may be what you want for now.',
      'warn'));
    }
  }

  if (stepId === 'transitions') {
    const keys = new Set(draft.states.map(s => s.key));
    const fields = transitionFieldsFor(machine);
    draft.transitions.forEach(t => {
      if (!keys.has(t.from) || !keys.has(t.to)) {
        out.push(issue('from', 'This rule points at a state that no longer exists.', 'error', t.key));
      }
      if (!cfg.hasTape && (t.on === '' || t.on === undefined)) {
        out.push(issue('on', 'Say what this rule reads.', 'error', t.key));
      }
      if (fields.includes('weight')) {
        const w = Number(t.weight);
        if (!Number.isFinite(w) || w < 0 || w > 1) {
          out.push(issue('weight', 'A probability is between 0 and 1.', 'error', t.key));
        }
      }
      if (fields.includes('move') && !['L', 'R', 'S'].includes(t.move)) {
        out.push(issue('move', 'Pick a direction for the head.', 'error', t.key));
      }
      if (fields.includes('tapeSyms')) {
        const n = draft.tapeCount || 2;
        if ((t.tapeSyms || []).length !== n || (t.tapeWrites || []).length !== n || (t.tapeDirs || []).length !== n) {
          out.push(issue('tapeSyms', `Every rule needs one entry per tape (${n}).`, 'error', t.key));
        }
      }
    });

    if (!draft.transitions.length) {
      out.push(issue('transitions', 'No transitions yet. A machine with none only accepts the empty word, and only if it starts in an accepting state.', 'warn'));
    }
    if (isWeightedFA(machine) && draft.transitions.length) {
      // Rabin's model wants a distribution per (state, symbol); the simulator
      // will normalise, but a reader is better told than surprised.
      const sums = new Map();
      draft.transitions.forEach(t => {
        const k = t.from + '|' + t.on;
        sums.set(k, (sums.get(k) || 0) + (Number(t.weight) || 0));
      });
      const off = [...sums.values()].some(v => Math.abs(v - 1) > 0.001);
      if (off) out.push(issue('weight', 'The probabilities leaving a state on one symbol do not add up to 1.', 'warn'));
    }
  }

  return out;
}

/** Every issue in the draft, step by step. */
export function draftIssues(draft) {
  return wizardSteps(draft.machine).flatMap(s =>
    stepIssues(draft, s.id).map(i => ({ ...i, step: s.id })));
}

/** Can this step be left? Warnings never stop anyone. */
export function stepIsComplete(draft, stepId) {
  return !stepIssues(draft, stepId).some(i => i.severity === 'error');
}

// ══════════════════════════════════════════════════════════════════
//  DRAFT → SPEC
// ══════════════════════════════════════════════════════════════════

/**
 * The draft in the dialect validateSpec() gates. Keys become names here and
 * nowhere else.
 */
export function draftToSpec(draft) {
  const machine = draft.machine;
  const cfg = getMachineConfig(machine);
  const parity = usesParityPriorities(machine);
  const stateFields = new Set(stateFieldsFor(machine));
  const transFields = transitionFieldsFor(machine);
  const nameOf = new Map(draft.states.map(s => [s.key, String(s.name || '').trim()]));

  const spec = {
    machine,
    sigma: [...draft.sigma],
    states: draft.states.map(s => {
      const out = { name: String(s.name || '').trim(), start: !!s.start };
      if (parity) out.priority = Number(s.priority) || 0;
      else out.accept = !!s.accept;
      if (stateFields.has('out')) out.out = s.out ?? '';
      return out;
    }),
    transitions: draft.transitions.map(t => {
      const out = { from: nameOf.get(t.from) || '', to: nameOf.get(t.to) || '' };
      transFields.forEach(f => {
        if (f === 'from' || f === 'to') return;
        out[f] = Array.isArray(t[f]) ? [...t[f]] : t[f];
      });
      return out;
    })
  };

  alphabetFieldsFor(machine).forEach(f => {
    if (f === 'sigma') return;
    if (f === 'tapeCount') spec.tapeCount = draft.tapeCount;
    else if (draft[f]) spec[f] = [...draft[f]];
  });
  if (cfg.isTransducer && !spec.outputAlpha) spec.outputAlpha = [];

  spec.title = String(draft.meta.title || '').trim();
  spec.blurb = String(draft.meta.blurb || '').trim();
  spec.tests = (draft.meta.tests || [])
    .filter(t => t && t.w !== undefined && t.w !== null && String(t.w).length >= 0)
    .map(t => {
      const row = { w: String(t.w) };
      if (t.expect === 'accept' || t.expect === 'reject') row.expect = t.expect;
      if (t.out !== undefined && t.out !== '') row.out = String(t.out);
      // validateSpec drops a test that says nothing; a word with neither a
      // verdict nor an output is one of those, so give it the default.
      if (!row.expect && row.out === undefined) row.expect = 'accept';
      return row;
    });

  return spec;
}

// ══════════════════════════════════════════════════════════════════
//  PREVIEW AND APPLY
// ══════════════════════════════════════════════════════════════════

/**
 * Everything the review step needs: the machine that would be drawn, what
 * changes, and what the linter makes of it.
 *
 * In edit mode a finding that was already true of the machine on the canvas
 * is downgraded to a warning. Blocking Create on a problem the reader did not
 * introduce — an imported DFA that was never deterministic — would make the
 * wizard refuse to let them fix the title of a machine it did not build.
 *
 * @returns {{candidate, diff, findings, error}}
 */
export function previewCandidate(draft) {
  try {
    const spec = validateSpec(draftToSpec(draft), { fallbackMachine: draft.machine });
    const { candidate, diff } = compileSpec(spec);
    // lintCandidate hands back the findings plus three pre-filtered views of
    // them; only the list matters here, since the severities are re-read
    // below anyway.
    let findings = lintCandidate(candidate).findings;

    if (Wizard.mode === 'edit') {
      const inherited = new Set(inheritedFindings());
      findings = findings.map(f => (
        f.severity === 'repair' && inherited.has(f.rule)
          ? { ...f, severity: 'warn', inherited: true }
          : f
      ));
    }
    return { candidate, diff, findings, error: null };
  } catch (err) {
    return { candidate: null, diff: null, findings: [], error: err };
  }
}

/** The lint rules the machine on the canvas already breaks, by name. */
function inheritedFindings() {
  try {
    const spec = validateSpec(machineToSpec(), { fallbackMachine: App.machine });
    const { candidate } = compileSpec(spec);
    return lintCandidate(candidate).findings.map(f => f.rule);
  } catch {
    // A canvas that cannot be described is a canvas with nothing to inherit.
    return [];
  }
}

/**
 * Draw it.
 *
 * The canvas is written exactly once, here, by applyCandidate — which means a
 * draft that fails anywhere above leaves the reader's work untouched.
 *
 * @returns {{ok: boolean, error?: Error, findings?: Array, newTab?: boolean}}
 */
export function applyDraft(draft, { openNewTab = false } = {}) {
  const preview = previewCandidate(draft);
  if (preview.error) return { ok: false, error: preview.error };

  const blocking = preview.findings.filter(f => f.severity === 'repair');
  if (blocking.length) {
    return {
      ok: false,
      findings: preview.findings,
      error: new StateMateError('lint', blocking[0].message)
    };
  }

  // Settings the graph cannot carry. They are applied first so the machine
  // lands in the world it was described for; both are workspace-level and
  // neither is part of the candidate.
  if (draft.cutPoint !== undefined) App.config.pfaCutPoint = Number(draft.cutPoint);
  if (draft.twoWayTape !== undefined) App.config.twoWayTape = !!draft.twoWayTape;

  applyCandidate(preview.candidate, { openNewTab, title: draft.meta.title || 'New machine' });

  showExampleCard({
    title: draft.meta.title,
    blurb: draft.meta.blurb,
    inputs: (draft.meta.tests || []).map(t => ({ w: t.w, expect: t.expect, out: t.out }))
  });

  return { ok: true, findings: preview.findings, newTab: openNewTab };
}

// ══════════════════════════════════════════════════════════════════
//  OPENING
// ══════════════════════════════════════════════════════════════════

/** Is there a machine to edit, or is this a blank canvas? */
export function canvasHasMachine() {
  return App.states.length > 0;
}

/**
 * Prepare the draft for an opening.
 *
 * A draft survives the dialog closing, so this resumes one where it can. It
 * cannot when the machine on the canvas has moved since an edit draft was
 * filled in: that draft is stale prefill, and applying it would quietly
 * discard whatever happened in between.
 */
export function beginWizard({ fresh = false } = {}) {
  const mode = fresh || !canvasHasMachine() ? 'create' : 'edit';
  const signature = machineSignature();
  const stale = Wizard.mode !== mode
    || !Wizard.draft
    || (mode === 'edit' && Wizard.signature !== signature);

  if (fresh || stale) {
    Wizard.mode = mode;
    Wizard.draft = mode === 'edit' ? draftFromCanvas() : newDraft(App.machine);
    Wizard.step = 0;
    Wizard.seen = new Set();
  }
  Wizard.signature = signature;
  return Wizard.draft;
}
