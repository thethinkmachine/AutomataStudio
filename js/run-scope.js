// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  RUNNING ONE BLOCK
// ══════════════════════════════════════════════════════════════════
// Drilling into a block used to change what you could *see* and nothing about
// what you could *do*: the run box still ran the whole machine from its own
// start state, so pressing play inside `CPU/ALU/add` ran the CPU, and if
// control never reached the adder on that word you learned nothing about the
// adder. There was no toggle, and nothing in js/simulation.js knew a scope
// existed beyond the trail cache's key.
//
// ── One mechanism, two questions ──────────────────────────────────
// "Run this block on its own" and "run the whole machine but stop when it
// reaches this block" look like two features and are one: a **run boundary** —
// a block whose subtree the player watches the run against.
//
//     subject   run *this block*: start at its entry, stop when control leaves
//     break     run the whole machine, pause when control first enters
//
// Both are answered by the same test on the same step, which is why they live
// together rather than as two passes over the same trace.
//
// ── Nothing here teaches a simulator anything ─────────────────────
// A boundary is enforced by the **player**, not by the machine layer. Teaching
// twenty-five simulators to halt at a subtree would be twenty-five ways to
// disagree; the player already holds a cursor over the steps and already
// decides which one is on screen, so "do not go past this one" is a bound on
// the cursor. On a streaming run that also means the steps beyond are never
// computed, because nothing pulls them.
//
// The one thing the machine layer does read is where to *start*, and that is a
// single declaration — runStartId() in js/state.js — rather than a parameter
// threaded through every simulator.
//
// ── A block has no F, so it has no verdict ────────────────────────
// A block's accepting marks are dropped when it is inlined: a block finishing
// is not the machine accepting. So the answer to "run this block on `11+01`"
// is not accept or reject, it is **which exit it left by** — which is exactly
// what `block.exits` already declares, and what the downstream of a block
// actually branches on. A run that never leaves says that instead.
//
// ── It is session state ───────────────────────────────────────────
// `App.runSubject`, `App.simStart`, `App.simBreakAt`, `App.simStopAt` and
// `App.simExit` reach no serializer. They are a property of this reader's
// investigation, not of the machine — the same reasoning js/scope.js gives for
// keeping the per-scope cameras out of the save format. A file that recorded a
// start state that is not the machine's start would be a file that lies.

import { blockAncestry, blockSubtree, getBlock, localStateName } from './blocks.js';
import { $, App, getState } from './state.js';
import { liveScope } from './view-graph.js';
import { Change, subscribe } from './store.js';
import { showStatus } from './utils.js';
// A cycle with the player, and a safe one: nothing at this module's top level
// calls into it — the only top-level code here is `subscribe`, which comes from
// the import-free store — so `resetSim` is a hoisted binding resolved at click
// time, exactly as the note in CLAUDE.md describes for canvas ↔ render.
import { resetSim } from './simulation.js';

// ══════════════════════════════════════════════════════════════════
//  THE SUBJECT
// ══════════════════════════════════════════════════════════════════

/** The block a run is about, or null for the machine. Pruned like the scope. */
export function runSubject() {
  const id = App.runSubject || null;
  if (id && !getBlock(id)) { setRunSubject(null); return null; }
  return id;
}

/**
 * Point the run box at a block, or back at the machine.
 *
 * `App.simStart` is written here rather than derived at run time because
 * `runStartId()` is read by the batch tester and the Language panel too, and
 * those never go through `runSim` — a subject that only took effect on the play
 * button would give one answer in the player and another in the table beside it.
 */
export function setRunSubject(id) {
  const b = id ? getBlock(id) : null;
  App.runSubject = b ? b.id : null;
  App.simStart = b ? b.entry : null;
  return App.runSubject;
}

/** Pause the whole-machine run when control first enters this block. */
export function setBreakScope(id) {
  App.simBreakAt = id && getBlock(id) ? id : null;
  return App.simBreakAt;
}

export function breakScope() {
  const id = App.simBreakAt || null;
  if (id && !getBlock(id)) { App.simBreakAt = null; return null; }
  return id;
}

/**
 * Forget where a run stopped, keeping what it was about.
 *
 * The subject survives a reset because it is the reader's choice of what to
 * investigate — clearing it on every `resetSim` would mean re-picking the block
 * for each word tried, which is the one thing you do repeatedly here.
 */
export function resetRunBounds() {
  App.simStopAt = null;
  App.simExit = null;
}

/** The subject and the break scope both go when the machine is replaced. */
export function clearRunScope() {
  App.runSubject = null;
  App.simStart = null;
  App.simBreakAt = null;
  resetRunBounds();
}

// ══════════════════════════════════════════════════════════════════
//  WHERE A STEP IS
// ══════════════════════════════════════════════════════════════════

/**
 * The states a step is in.
 *
 * One for a deterministic machine, a set for a nondeterministic one — which is
 * why "has it left the block" is answered as *none of them is inside* rather
 * than as a single test. A branch still inside the block has not left it.
 */
export function stepStateIds(step) {
  if (!step) return [];
  if (step.state) return [step.state];
  return step.states ? [...step.states] : [];
}

/** Every state under a block, at every depth. Memoised per (block, machine). */
let _subArr = null, _subId = null, _subSet = null;
function subtreeStates(blockId) {
  const states = App.states || [];
  if (_subId === blockId && _subArr === states && _subSet) return _subSet;
  const ids = new Set(blockSubtree(blockId));
  const out = new Set();
  for (const s of states) if (s.blockId && ids.has(s.blockId)) out.add(s.id);
  _subId = blockId; _subArr = states; _subSet = out;
  return out;
}

/** Test-only, and for the paths that replace App.states without saying so. */
export function invalidateRunScope() { _subArr = null; _subId = null; _subSet = null; }

export function stepIsInside(step, blockId) {
  if (!blockId) return false;
  const inside = subtreeStates(blockId);
  return stepStateIds(step).some(id => inside.has(id));
}

// ══════════════════════════════════════════════════════════════════
//  THE BOUNDARY
// ══════════════════════════════════════════════════════════════════

/**
 * What the boundary says about the step at `idx`.
 *
 * `{ stop, exit }` — the run has left the subject, and everything from `idx`
 *                    on is the host machine rather than the block. The cursor
 *                    is held at `idx - 1`, the last step inside, because that
 *                    is what "run this block" showed you.
 * `{ pause }`      — the run has just entered the block being watched. The
 *                    steps are real and playback simply stops there, so the
 *                    reader can look at the configuration the host handed over.
 * `null`           — carry on.
 *
 * Called with the step already materialized, so on a streaming run the step
 * that trips the boundary is the last one computed and nothing past it is.
 */
export function boundaryAt(step, idx, prev) {
  const subject = runSubject();
  if (subject && idx > 0 && !stepIsInside(step, subject)) {
    return { stop: true, exit: describeExit(prev, step, subject) };
  }
  const watch = breakScope();
  if (watch && stepIsInside(step, watch) && !stepIsInside(prev, watch)) {
    return { pause: true, block: watch };
  }
  return null;
}

/**
 * Which way control left the block, in the block's own terms.
 *
 * The declared label when the state it left from is a declared exit, and the
 * state's own name when it is not — an undeclared way out is a real answer, and
 * one worth being able to see, since it is also what stops the block being
 * reusable somewhere else.
 */
function describeExit(prev, step, blockId) {
  const b = getBlock(blockId);
  const from = stepStateIds(prev).filter(id => subtreeStates(blockId).has(id));
  const declared = new Map((b?.exits || []).map(e => [e.id, e.label]));
  const leftFrom = from.find(id => declared.has(id)) ?? from[0] ?? null;
  const landed = stepStateIds(step)[0] ?? null;
  return {
    label: leftFrom != null && declared.has(leftFrom)
      ? declared.get(leftFrom)
      : null,
    from: leftFrom,
    fromName: leftFrom ? localStateName(getState(leftFrom)) : null,
    to: landed,
    toName: landed ? (getState(landed)?.name ?? landed) : null,
    declared: leftFrom != null && declared.has(leftFrom)
  };
}

// ══════════════════════════════════════════════════════════════════
//  WHAT THE READER IS OFFERED
// ══════════════════════════════════════════════════════════════════

/**
 * The subjects the run box may be pointed at, for the level on screen.
 *
 * The machine, then the blocks the reader is standing inside, outermost first —
 * so from within `CPU/ALU/add` you can run the adder, the ALU or the CPU
 * without going back out to do it. Deliberately not every block in the machine:
 * that is the Blocks panel's job, and a picker listing twenty subjects for a
 * question about the one you are looking at would be worse than the panel.
 */
export function runSubjects() {
  return [
    { id: null, label: 'Machine', sub: 'from the start state' },
    ...blockAncestry(liveScope()[liveScope().length - 1] || null).map(b => ({
      id: b.id,
      label: b.name,
      sub: `from ${localStateName(getState(b.entry)) || 'its entry'}`
    }))
  ];
}

/** The subject, dropped when the reader walks out of the block it names. */
export function syncRunSubject() {
  const id = runSubject();
  if (!id) return null;
  const visible = new Set(blockAncestry(liveScope()[liveScope().length - 1] || null).map(b => b.id));
  if (!visible.has(id)) return setRunSubject(null);
  return id;
}

// ══════════════════════════════════════════════════════════════════
//  THE CONTROL
// ══════════════════════════════════════════════════════════════════
// Kept here rather than in js/simulation.js for the reason syncTapeCountUI()
// gives for living beside setTapeCount: the picker and the thing it sets are
// one fact, and a control filled in from one place and read from another is
// how a 3-tape machine came to open showing "2".

/**
 * Fill in the run-box subject, and hide it where there is nothing to choose.
 *
 * Subscribed to GRAPH *and* CANVAS because the two things that change it are a
 * block appearing or going (GRAPH) and the reader drilling in or out — and
 * `enterBlockScope` announces both, so this is reached either way.
 */
export function syncRunSubjectUI() {
  const row = $('sim-subject-row');
  const sel = $('sim-subject');
  if (!row || !sel) return;
  const subjects = runSubjects();
  // One option is no choice. The picker would be a label saying "Machine" above
  // a machine, which is the state the reader is in nearly all of the time.
  if (subjects.length < 2) {
    row.hidden = true;
    if (App.runSubject || App.simBreakAt) { setRunSubject(null); setBreakScope(null); }
    return;
  }
  row.hidden = false;
  const want = subjects.map(x => x.id ?? '');
  const have = Array.from(sel.options || []).map(o => o.value);
  if (have.length !== want.length || want.some((v, i) => have[i] !== v)) {
    // The name alone. A select in a 300px panel truncates anything longer, and
    // "Machine — from…" is a label that has lost the half that made it worth
    // saying; where each subject starts is on the control's own tooltip.
    sel.innerHTML = subjects
      .map(x => `<option value="${x.id ?? ''}">${x.label}</option>`)
      .join('');
    sel.title = subjects.map(x => `${x.label}: ${x.sub}`).join('\n');
  }
  sel.value = syncRunSubject() ?? '';

  // "Break in" is offered only while the subject is the machine: it means
  // "run everything, but stop when you get here", and asking to stop on
  // entering the very block you are already starting inside is a question with
  // no answer. Selecting a block is the other way of asking the same thing.
  const brk = $('sim-break-lbl');
  const box = $('sim-break');
  const innermost = liveScope()[liveScope().length - 1] || null;
  if (brk) brk.hidden = !!App.runSubject || !innermost;
  if (box) {
    if (brk?.hidden && App.simBreakAt) setBreakScope(null);
    else if (innermost && App.simBreakAt && App.simBreakAt !== innermost) setBreakScope(innermost);
    box.checked = !!App.simBreakAt;
  }
}

/**
 * The picker. Named for the bridge, which is how an on* attribute reaches it.
 *
 * **The trace on screen goes with the subject**, because it was produced from a
 * different start state and judged against a different boundary. Left standing,
 * a finished whole-machine run \u2014 one that went through the block and out the
 * far side to an accepting state \u2014 was relabelled the moment the reader picked
 * that block: the ACCEPT banner became "No exit, control never left B", which
 * is false about the very run still drawn under it. And it could not correct
 * itself, because the boundary scan is a cursor over an array it had already
 * walked to the end.
 *
 * Clearing the run is what `resetSim` is for, so the picker asks for it rather
 * than trying to re-judge steps that answer a question nobody asked.
 */
export function setRunSubjectFromUI(value) {
  const before = App.runSubject || null;
  setRunSubject(value || null);
  syncRunSubjectUI();
  if ((App.runSubject || null) !== before) resetSim();
  else resetRunBounds();
  showStatus(App.runSubject
    ? `Runs start inside ${getBlock(App.runSubject)?.name}`
    : 'Runs start at the machine\u2019s start state');
}

/**
 * Break in, or stop watching.
 *
 * Unlike the subject this does not change where a run *starts*, so the steps on
 * screen are still the steps this setting is about \u2014 but where playback would
 * have paused is decided by a scan that has already been made, so the run is
 * reset for the same reason: the answer cannot be recomputed over a cursor that
 * is already at the end of its array.
 */
export function setBreakScopeFromUI(on) {
  const before = App.simBreakAt || null;
  setBreakScope(on ? (liveScope()[liveScope().length - 1] || null) : null);
  syncRunSubjectUI();
  if ((App.simBreakAt || null) !== before) resetSim();
  showStatus(App.simBreakAt
    ? `Playback will pause when control enters ${getBlock(App.simBreakAt)?.name}`
    : 'Playback runs straight through');
}

subscribe(Change.GRAPH, syncRunSubjectUI);
subscribe(Change.CANVAS, syncRunSubjectUI);
