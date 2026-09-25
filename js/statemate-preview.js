// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — THE DRAFT, WHILE IT IS BEING WRITTEN
// ══════════════════════════════════════════════════════════════════
//  What the reader sees on the canvas while StateMate works. Two sources, one
//  shape:
//
//    a streamed answer   the model is still typing its JSON. The states and
//                        transitions that have *finished* arriving are pulled
//                        out of the text as it grows (partialMachine).
//    an agent draft      the private copy the tools are editing, which may be
//                        invalid mid-way — no start state yet, a transition
//                        whose target has not been added.
//
//  Both go through lenientSpec, which keeps what can be drawn and drops what
//  cannot, and then through the real compileSpec against the live machine —
//  so a state on the preview sits where the finished machine would put it
//  given what has arrived so far, and a state the model left alone sits
//  exactly where it already is on the canvas.
//
//  DOM-free, and nothing here writes App. The preview is paint (draft-layer.js);
//  the canvas is still written once, at apply, or not at all.

import { MachineTypes } from './state.js';
import { compileSpec } from './statemate-compile.js';
import { partialStringField, stateFieldsFor, transitionFieldsFor } from './statemate-spec.js';

// ── pulling finished objects out of a half-written answer ────────

/**
 * The complete JSON values inside the array under `key`, as far as the text
 * has got. An object still being written is left for the next call; the
 * scanner tracks strings so a `}` inside a state name does not end it.
 */
function completedItems(text, key) {
  const opener = new RegExp(`"${key}"\\s*:\\s*\\[`);
  const m = opener.exec(text);
  if (!m) return [];
  const items = [];
  let depth = 0, inString = false, escaped = false, start = -1;
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        // A bare string item (an alphabet), closed at depth 0.
        if (depth === 0 && start !== -1) {
          try { items.push(JSON.parse(text.slice(start, i + 1))); } catch (e) { /* skip */ }
          start = -1;
        }
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      if (depth === 0) start = i;
    } else if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) break;                 // the array itself closed
      depth--;
      if (depth === 0 && start !== -1) {
        try { items.push(JSON.parse(text.slice(start, i + 1))); } catch (e) { /* skip */ }
        start = -1;
      }
    }
  }
  return items;
}

/**
 * The machine as far as a streamed answer has written it.
 * Null when the text is not (or not yet) a machine answer.
 */
export function partialMachine(text) {
  const src = String(text || '');
  const kind = partialStringField(src, 'kind');
  if (kind && kind !== 'machine') return null;
  if (!/"states"\s*:\s*\[/.test(src)) return null;
  return {
    machine: partialStringField(src, 'machine'),
    title: partialStringField(src, 'title'),
    sigma: completedItems(src, 'sigma'),
    states: completedItems(src, 'states'),
    transitions: completedItems(src, 'transitions')
  };
}

// ── keeping what can be drawn ────────────────────────────────────

/**
 * A draft that validateSpec would refuse, made drawable.
 *
 * validateSpec is right to refuse a machine with no start state; a preview of
 * one half-written is not wrong, it is early. So this keeps every state with a
 * name, every transition whose ends both exist, and nothing else — it never
 * invents a start state or a symbol, because the reader would see it.
 */
export function lenientSpec(raw, fallbackMachine) {
  const machine = typeof raw?.machine === 'string' && MachineTypes[raw.machine.trim()]
    ? raw.machine.trim()
    : fallbackMachine;
  const stateFields = new Set(stateFieldsFor(machine));
  const seen = new Set();
  const states = [];
  for (const row of Array.isArray(raw?.states) ? raw.states : []) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const state = { name, start: !!row.start, accept: !!row.accept };
    if (stateFields.has('priority') && Number.isFinite(Number(row.priority))) state.priority = Number(row.priority);
    if (stateFields.has('out') && row.out !== undefined) state.out = String(row.out);
    states.push(state);
  }
  // At most one start state, as the canvas can only show one.
  let started = false;
  states.forEach(s => { if (s.start && started) s.start = false; if (s.start) started = true; });

  const legal = transitionFieldsFor(machine);
  const transitions = (Array.isArray(raw?.transitions) ? raw.transitions : [])
    .filter(t => t && seen.has(String(t.from ?? '').trim()) && seen.has(String(t.to ?? '').trim()))
    .map(t => {
      const out = {};
      legal.forEach(field => { if (t[field] !== undefined) out[field] = t[field]; });
      out.from = String(t.from).trim();
      out.to = String(t.to).trim();
      out.on = t.on === undefined || t.on === null ? '' : String(t.on);
      return out;
    });

  const sigma = Array.isArray(raw?.sigma) && raw.sigma.length
    ? raw.sigma.map(String)
    : [...new Set(transitions.map(t => t.on).filter(Boolean))];

  return {
    machine,
    title: typeof raw?.title === 'string' ? raw.title : '',
    blurb: '',
    sigma,
    ...(Array.isArray(raw?.stackAlpha) ? { stackAlpha: raw.stackAlpha.map(String) } : {}),
    ...(Array.isArray(raw?.outputAlpha) ? { outputAlpha: raw.outputAlpha.map(String) } : {}),
    ...(Number.isFinite(Number(raw?.tapeCount)) ? { tapeCount: Number(raw.tapeCount) } : {}),
    states,
    transitions,
    tests: [],
    notes: []
  };
}

/**
 * A placed candidate for the preview, or null when there is nothing to draw.
 *
 * Every frame is placed against the live machine, exactly as the finished
 * answer will be — never against the previous frame. That used to be the
 * other way round, so that each state would land once and stay; but the
 * dialect lists every state before any transition, so each one landed before
 * a single edge had arrived and was parked in a row beside the diagram, and
 * stayed there until the finished answer was compiled with its edges in hand.
 * On a six-state build that was a jump averaging 572px at the moment the
 * reader was about to judge the result. Placing each frame the way the
 * machine will be placed means the last frame *is* the machine Apply draws;
 * the continuity between frames is the draft layer's job, which glides a
 * state to its new position rather than letting it jump.
 */
export function draftCandidate(raw, live, fallbackMachine = live?.machine) {
  const spec = lenientSpec(raw, fallbackMachine);
  if (!spec.states.length) return null;
  try {
    return compileSpec(spec, live).candidate;
  } catch (e) {
    return null;
  }
}

/** "5 states · 9 transitions" — what the console says while a draft grows. */
export function draftSize(candidate) {
  if (!candidate) return '';
  const s = candidate.states.length, t = candidate.transitions.length;
  return `${s} state${s === 1 ? '' : 's'} · ${t} transition${t === 1 ? '' : 's'}`;
}
