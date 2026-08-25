// ══════════════════════════════════════════════════════════════════
//  TURING MACHINES — TM, NDTM, MTM, LBA, ITM
// ══════════════════════════════════════════════════════════════════
// A machine and a tape, and most of what separates these five is the
// tape rather than the machine. js/tape.js holds where the head may go —
// bounded at the left, unbounded both ways, or bounded at both ends with
// two unwritable cells — so ITM is TM with a different tape and testITM3
// is a one-line delegation rather than a second copy of the loop.
//
// What is left over is genuinely per-type: NDTM searches instead of
// stepping, MTM moves k heads at once, and LBA turns running off an end
// into a rejection because the tape refuses the move rather than
// clamping it.
//
// ── THREE-VALUED MEMBERSHIP ───────────────────────────────────────
// A machine that has not halted inside a step budget has NOT rejected.
// Collapsing the two is the mistake that makes undecidability invisible,
// so the deciders below return 'unk' for "no verdict yet" and keep 'rej'
// for a real answer. Two situations turn a non-halt back INTO a real
// answer:
//
//   • a repeated configuration in a deterministic machine — it will now
//     repeat forever, so the word is provably never accepted;
//   • an exhausted search frontier in a nondeterministic one — every
//     branch halted without accepting.
//
// An LBA is decidable outright: its tape is bounded, so the configuration
// space is finite and the repeat check always fires.

import { App, getState, usesTwoWayTape } from '../state.js';
import { renderSimStep } from './paint.js';
import { Tape, makeTapes, tapesKey } from '../tape.js';
import { buildMarkedInputTape, tapeTuplesOverlap } from './predicates.js';
import { firstOverlappingTransition, formatTapeInstantaneousDescription, getMultiTapeDeterministicTransition, getSingleTapeDeterministicTransition, langStepBudget, makeLoopTracker, nameOfState, markLoopStep, markTimeoutStep, parseWordInput, tokenize } from './runtime.js';
import { defineFamily, machineDef } from './registry.js';

export function simTM(tokens) {
  App.simSteps = [];
  const tape = new Tape(tokens, App.config.sym.blank, usesTwoWayTape());
  let state = App.startId;
  let via = null;
  const loop = makeLoopTracker();
  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const sym = tape.read();
    // The head index the UI draws is relative to the window the tape
    // reports, not the cell number — on a two-way tape those differ the
    // moment it grows leftward.
    const snap = tape.snapshot();
    // On a two-way tape the drawn index is not the cell number, so the note
    // carries the cell — otherwise "head 0" means two different places
    // before and after the tape grows leftward.
    const cellNote = tape.twoWay ? ` @${tape.head}` : '';
    App.simSteps.push({ state, tokens, tape: snap.tape, head: snap.head, view: tape.view(), tid: via, note: `State:${getState(state)?.name} Read:'${sym}'${cellNote}` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const at = loop.seenAt(`${state}|${tape.key()}`, App.simSteps.length - 1);
    if (at >= 0) { markLoopStep(App.simSteps[App.simSteps.length - 1], at); break; }
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    tape.write((!t.write || t.write === App.config.sym.any) ? sym : t.write);
    state = t.to; via = t.id;
    tape.move(t.dir);
  }
  const lastTM = App.simSteps[App.simSteps.length - 1];
  if (lastTM && !lastTM.final) markTimeoutStep(lastTM);
  App.simIdx = 0; renderSimStep();
}

export function simNDTM(tokens) {
  App.simSteps = [];
  const startTape = new Tape(tokens, App.config.sym.blank, usesTwoWayTape());
  const queue = [{ state: App.startId, tape: startTape, depth: 0, branch: 1 }];
  const visited = new Set([`${App.startId}|${startTape.key()}`]);
  let accepted = false;
  let branches = 0;
  let maxDepth = 0;
  const log = [];
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxTmSteps) {
    const cfg = queue.shift();
    const { state, depth, branch } = cfg;
    const snap = cfg.tape.snapshot();
    const tape = snap.tape;
    const head = snap.head;
    const sym = cfg.tape.read();
    const stateName = getState(state)?.name || state;
    const idStr = formatTapeInstantaneousDescription(state, tape, head);
    branches++;
    maxDepth = Math.max(maxDepth, depth);

    const step = {
      state,
      tokens,
      tape: [...tape],
      head,
      view: cfg.tape.view(),
      branch,
      note: `Branch ${branch} depth ${depth}: ${stateName} reads '${sym}'`
    };

    if (App.accepts.has(state)) {
      step.final = 'accept';
      step.note += ' — ACCEPT';
      App.simSteps.push(step);
      log.push(`<span class="step-acc">Branch ${branch}: ACCEPT ✓</span><span class="step-sub">State "${stateName}" is accepting.<br>Depth ${depth} · ID: ${idStr}</span>`);
      accepted = true;
      break;
    }

    const matching = App.transitions.filter(tr => tr.from === state && (tr.symbol === sym || tr.symbol === App.config.sym.any));
    if (!matching.length) {
      step.note += ' — dead branch';
      App.simSteps.push(step);
      log.push(`Branch ${branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches (${stateName}, '${sym}').<br>Depth ${depth} · ID: ${idStr}</span>`);
      continue;
    }

    step.note += matching.length > 1 ? ` — branching ×${matching.length}` : ' — deterministic step';
    App.simSteps.push(step);

    const subs = [
      `Read '${sym}' at head position ${cfg.tape.twoWay ? cfg.tape.head : head}.`,
      `Depth ${depth} · ID: ${idStr}`
    ];
    if (matching.length > 1) {
      subs.push(`Nondeterministic choice: ${matching.length} matching transitions.`);
    }
    log.push(`Branch ${branch}: exploring <em>${stateName}</em><span class="step-sub">${subs.join('<br>')}</span>`);

    matching.forEach(tr => {
      const nextTape = cfg.tape.clone();
      nextTape.write((!tr.write || tr.write === App.config.sym.any) ? sym : tr.write);
      nextTape.move(tr.dir);
      const nextKey = `${tr.to}|${nextTape.key()}`;
      if (visited.has(nextKey)) return;
      visited.add(nextKey);
      queue.push({ state: tr.to, tape: nextTape, depth: depth + 1, branch: nextBranchId++ });
    });
  }

  if (!accepted) {
    // An exhausted frontier is a real reject; unexplored branches are not.
    const unresolved = queue.length > 0;
    const finalNote = unresolved
      ? `NO VERDICT: exploration limit ${App.config.maxTmSteps} reached — unresolved branches remain`
      : 'All branches halted without acceptance — REJECT';
    const fallbackTape = App.simSteps.at(-1)?.tape || startTape.snapshot().tape;
    const fallbackHead = App.simSteps.at(-1)?.head ?? 0;
    const fallbackState = App.simSteps.at(-1)?.state || App.startId;
    App.simSteps.push({
      state: fallbackState,
      tokens,
      tape: [...fallbackTape],
      head: fallbackHead,
      note: finalNote,
      final: unresolved ? 'timeout' : 'reject',
      limit: unresolved ? App.config.maxTmSteps : undefined
    });
    log.push(`${queue.length ? 'Exploration limit reached' : 'Reject'}<span class="step-sub">${finalNote}.<br>Branches explored: ${branches} · max depth ${maxDepth}</span>`);
  }

  App.simIdx = 0;
  renderSimStep();
  return { accepted, branches, maxDepth, log };
}

export function simMTM(tokens, allTapeTokens) {
  App.simSteps = [];
  const k = App.tapeCount;
  const blank = App.config.sym.blank;
  const twoWay = usesTwoWayTape();
  const tapes = allTapeTokens
    ? Array.from({ length: k }, (_, i) => new Tape(allTapeTokens[i] || [], blank, twoWay))
    : makeTapes(k, tokens, blank, twoWay);
  let state = App.startId;
  let via = null;
  const loop = makeLoopTracker();
  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const syms = tapes.map(tape => tape.read());
    const snaps = tapes.map(tape => tape.snapshot());
    App.simSteps.push({ state, tokens, tapes: snaps.map(s => s.tape), heads: snaps.map(s => s.head), views: tapes.map(tape => tape.view()), tid: via, note: `State:${getState(state)?.name} Read:[${syms.join(',')}]` });
    if (App.accepts.has(state)) { App.simSteps[App.simSteps.length - 1].final = 'accept'; App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT'; break; }
    const at = loop.seenAt(tapesKey(state, tapes), App.simSteps.length - 1);
    if (at >= 0) { markLoopStep(App.simSteps[App.simSteps.length - 1], at); break; }
    const t = getMultiTapeDeterministicTransition(state, syms);
    if (!t) { App.simSteps[App.simSteps.length - 1].final = 'reject'; App.simSteps[App.simSteps.length - 1].note += ' — REJECT'; break; }
    for (let i = 0; i < k; i++) {
      tapes[i].write(t.tapeWrites[i] || syms[i]);
      tapes[i].move(t.tapeDirs[i]);
    }
    state = t.to; via = t.id;
  }
  const lastMTM = App.simSteps[App.simSteps.length - 1];
  if (lastMTM && !lastMTM.final) markTimeoutStep(lastMTM);
  App.simIdx = 0; renderSimStep();
}

export function simLBA(tokens) {
  App.simSteps = [];
  const tape = makeLbaTape(tokens);
  let state = App.startId;
  let via = null;
  // An LBA's tape is bounded, so its configuration space is finite and this
  // check always fires eventually — membership is genuinely decidable here.
  const loop = makeLoopTracker();

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const sym = tape.read();
    const snap = tape.snapshot();
    App.simSteps.push({ state, tokens, tape: snap.tape, head: snap.head, view: tape.view(), tid: via, note: `State:${getState(state)?.name} Read:'${sym}'` });
    if (App.accepts.has(state)) {
      App.simSteps[App.simSteps.length - 1].final = 'accept';
      App.simSteps[App.simSteps.length - 1].note += ' — ACCEPT';
      break;
    }
    const at = loop.seenAt(`${state}|${tape.key()}`, App.simSteps.length - 1);
    if (at >= 0) { markLoopStep(App.simSteps[App.simSteps.length - 1], at); break; }
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) {
      App.simSteps[App.simSteps.length - 1].final = 'reject';
      App.simSteps[App.simSteps.length - 1].note += ' — REJECT';
      break;
    }
    // The markers refuse the write themselves — see Tape.immutable.
    tape.write((!t.write || t.write === App.config.sym.any) ? sym : t.write);
    state = t.to; via = t.id;
    // Which end it ran off is worth naming, so ask before moving.
    const heading = t.dir === 'L' ? App.config.sym.leftMarker : App.config.sym.rightMarker;
    if (!tape.move(t.dir)) {
      const after = tape.snapshot();
      App.simSteps.push({
        state,
        tokens,
        tape: after.tape,
        head: after.head,
        view: tape.view(),
        tid: via,
        note: `Attempted to move outside the ${heading} boundary. — REJECT`,
        final: 'reject'
      });
      break;
    }
  }

  const last = App.simSteps[App.simSteps.length - 1];
  if (last && !last.final) markTimeoutStep(last);
  App.simIdx = 0;
  renderSimStep();
}

// Same machine, two-way tape — which the Tape already knows. See testITM3.
export function simITM(tokens) {
  return simTM(tokens);
}

// ── deciding ──────────────────────────────────────────────────────

export function testTM3(tokens, budget) {
  budget = budget || langStepBudget();
  const any = App.config.sym.any;
  const tape = new Tape(tokens, App.config.sym.blank, usesTwoWayTape());
  let state = App.startId;
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    if (App.accepts.has(state)) return 'acc';
    const key = `${state}|${tape.key()}`;
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const sym = tape.read();
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) return 'rej';
    tape.write((!t.write || t.write === any) ? sym : t.write);
    tape.move(t.dir);
    state = t.to;
  }
  return 'unk';
}

/**
 * An LBA's tape is its input between two end markers, and nothing more:
 * bounded on both sides, with the markers themselves unwritable. That is
 * the whole of what makes it linear-bounded, so it is stated once here
 * rather than reassembled in each of the two simulators.
 */
export function makeLbaTape(tokens) {
  const { leftMarker, rightMarker, blank } = App.config.sym;
  return new Tape(buildMarkedInputTape(tokens), blank, false, {
    rightBound: tokens.length + 1,
    immutable: new Set([leftMarker, rightMarker])
  });
}

export function testLBA3(tokens, budget) {
  budget = budget || langStepBudget();
  const any = App.config.sym.any;
  const tape = makeLbaTape(tokens);
  let state = App.startId;
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    if (App.accepts.has(state)) return 'acc';
    const key = `${state}|${tape.key()}`;
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const sym = tape.read();
    const t = getSingleTapeDeterministicTransition(state, sym);
    if (!t) return 'rej';
    // The markers refuse the write themselves — see Tape.immutable.
    tape.write((!t.write || t.write === any) ? sym : t.write);
    state = t.to;
    // Running off either end is what bounds an LBA, and it is a halt
    // rather than a stall — the tape reports, this decides.
    if (!tape.move(t.dir)) return 'rej';
  }
  return 'unk';
}

// ITM is a deterministic single-tape machine whose tape happens to be
// two-way, and `usesTwoWayTape` already answers that — so this *is*
// testTM3. A second copy of the loop is only a way for the two to drift.
export function testITM3(tokens, budget) {
  return testTM3(tokens, budget);
}

export function testMTM3(tokens, budget) {
  budget = budget || langStepBudget();
  const k = App.tapeCount || 2;
  const tapes = makeTapes(k, tokens, App.config.sym.blank, usesTwoWayTape());
  let state = App.startId;
  const seen = new Set();
  for (let step = 0; step < budget; step++) {
    if (App.accepts.has(state)) return 'acc';
    const key = tapesKey(state, tapes);
    if (seen.has(key)) return 'rej';
    seen.add(key);
    const syms = tapes.map(tape => tape.read());
    const t = getMultiTapeDeterministicTransition(state, syms);
    if (!t) return 'rej';
    for (let i = 0; i < k; i++) {
      tapes[i].write(t.tapeWrites[i] || syms[i]);
      tapes[i].move(t.tapeDirs[i]);
    }
    state = t.to;
  }
  return 'unk';
}

export function testNDTM3(tokens, budget) {
  budget = budget || langStepBudget();
  const any = App.config.sym.any;
  const start = new Tape(tokens, App.config.sym.blank, usesTwoWayTape());
  const queue = [{ state: App.startId, tape: start }];
  // The key comes off the tape, which normalizes its own window — so two
  // configurations that differ only in how far the tape has grown compare
  // equal. With absolute indices a two-way tape renumbers every cell the
  // moment it grows leftward and the frontier never closes.
  const visited = new Set([`${App.startId}|${start.key()}`]);
  let expanded = 0;
  while (queue.length) {
    if (expanded++ >= budget) return 'unk';
    const cfg = queue.shift();
    if (App.accepts.has(cfg.state)) return 'acc';
    const sym = cfg.tape.read();
    const matching = App.transitions.filter(tr =>
      tr.from === cfg.state && (tr.symbol === sym || tr.symbol === any));
    for (const tr of matching) {
      const next = cfg.tape.clone();
      next.write((!tr.write || tr.write === any) ? sym : tr.write);
      next.move(tr.dir);
      const key = `${tr.to}|${next.key()}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ state: tr.to, tape: next });
    }
  }
  // Frontier exhausted with nothing accepting — a definitive answer.
  return 'rej';
}

export function testTMVerdict(tokens, budget) {
  // The registry already knows which of the five is on the canvas, so this
  // asks it rather than keeping a second copy of the mapping. The fallback
  // is the old switch's `default`: a caller that asks for a Turing verdict
  // while some other machine is live gets the single-tape answer.
  const def = machineDef(App.machine);
  if (def?.family === 'turing') return def.decide(tokens, { budget }).verdict;
  return testTM3(tokens, budget);
}

// ── the multi-tape input ──────────────────────────────────────────
// An MTM may be started with one value per tape, comma-separated. That is
// the one input format in the app that is neither a word nor an ω-word,
// and it belongs to the machine that reads it.

export function parseMultiTapeInput(raw) {
  if (!String(raw).includes(',')) return parseWordInput(raw);

  const parts = String(raw).split(',');
  if (parts.length !== App.tapeCount) {
    return {
      ok: false,
      error: `MTM: found ${parts.length} comma-separated segment(s) but machine has ${App.tapeCount} tape(s). Provide one value per tape.`
    };
  }
  const tapeTokens = [];
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi].trim();
    const tok = tokenize(p === App.config.sym.eps ? '' : p);
    if (tok === null) {
      return { ok: false, error: `Tape ${pi + 1}: cannot tokenize "${p}" using alphabet {${[...App.sigma].join(', ')}}.` };
    }
    tapeTokens.push(tok);
  }
  // No single token list to highlight against: the heads are on different
  // tapes, so `tokens` is null and the canvas highlight sits this one out.
  return { ok: true, input: { tapes: tapeTokens }, tokens: null };
}

// ── the definitions ───────────────────────────────────────────────

// One head, one read symbol. Overlap rather than equality, because a
// wildcard edge alongside a concrete one is two moves the simulator would
// have to choose between.
const singleTapeDeterminism = {
  conflict: (c, editId) => firstOverlappingTransition(c.from, c.symbol, editId),
  say: c => `${App.machine} already has δ(${nameOfState(c.from)}, '${c.symbol}'). Use NDTM mode if you want multiple choices for the same read symbol.`
};

const turing = {
  family: 'turing',
  // The tape-shape setting, offered to exactly the machines usesTwoWayTape()
  // reads it for. ITM and LBA override it away: ITM is two-way by being what
  // it is, and LBA is bounded at both ends by definition, so neither has a
  // choice to offer.
  options: ['twoWayTape'],
  schema: {
    transitionFields: ['from', 'to', 'on', 'write', 'move'],
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma', 'stackAlpha']
  },
  formal: {
    tuple: () => ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'F'],
    delta: () => 'Q × Γ → Q × Γ × {L, R, S}',
    storeSay: 'tape alphabet'
  }
};

// Every decider here is three-valued, so the mapping is the same for all
// five and the family writes it once.
const decideWith = test => (tokens, opts = {}) => ({ verdict: test(tokens, opts.budget), output: null });

defineFamily(turing, {
  'TM': { simulate: simTM, decide: decideWith(testTM3), deterministicDelta: true, determinism: singleTapeDeterminism },
  'NDTM': {
    simulate: simNDTM,
    decide: decideWith(testNDTM3),
    formal: { ...turing.formal, delta: () => 'Q × Γ → P(Q × Γ × {L, R, S})' }
  },
  'MTM': {
    deterministicDelta: true,
    multiTape: true,
    options: ['tapeCount', 'twoWayTape'],
    // k heads, so the thing that must be unique is the read *tuple*.
    determinism: {
      conflict: (c, editId) => App.transitions.find(t =>
        t.id !== editId && t.from === c.from && tapeTuplesOverlap(t.tapeSyms || [t.symbol], c.tapeSyms || [])) || null,
      say: c => `MTM already has a transition for (${nameOfState(c.from)}, [${(c.tapeSyms || []).join(', ')}]). Each read tuple must be unique.`
    },
    // parseMultiTapeInput hands back either a plain token list (the
    // single-value form) or one list per tape.
    simulate: input => Array.isArray(input) ? simMTM(input) : simMTM(input.tapes[0], input.tapes),
    decide: decideWith(testMTM3),
    parseInput: parseMultiTapeInput,
    schema: {
      ...turing.schema,
      transitionFields: ['from', 'to', 'on', 'tapeSyms', 'tapeWrites', 'tapeDirs'],
      alphabetFields: ['sigma', 'stackAlpha', 'tapeCount']
    },
    formal: {
      ...turing.formal,
      delta: () => { const k = App.tapeCount || 2; return `Q × Γ^${k} → Q × Γ^${k} × {L, R, S}^${k}`; }
    }
  },
  'LBA': { simulate: simLBA, decide: decideWith(testLBA3), deterministicDelta: true, determinism: singleTapeDeterminism, options: [] },
  'ITM': { simulate: simITM, decide: decideWith(testITM3), deterministicDelta: true, determinism: singleTapeDeterminism, options: [] }
});
