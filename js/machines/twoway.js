// ══════════════════════════════════════════════════════════════════
//  TWO-WAY MACHINES — 2DFA, 2NFA, 2DFT
// ══════════════════════════════════════════════════════════════════
// A head that moves both ways over an end-marked, read-only input. Three
// types, one head: 2DFT differs from 2DFA only in emitting output on each
// move, which is the transducer flag's business and not the head's.
//
// They deliberately do not use js/tape.js. That object exists to model
// what a *writable* tape refuses — a left bound, a right bound, an
// unwritable cell — and these never write. Running off an end here is a
// halt condition rather than a move to refuse, so Tape would be the wrong
// shape: the input is a fixed array and the head is an index into it.
//
// Two-wayness costs nothing in expressive power (a 2DFA recognises exactly
// the regular languages) and everything in how a run is decided: a path
// can revisit a cell, so termination is a reachability question over
// (state, position) pairs rather than a walk of length |w|.

import { App } from '../state.js';
import { renderSimStep } from '../simulation.js';
import { getState } from '../states-transitions.js';
import { buildMarkedInputTape, pickMostSpecificTransition } from '../utils.js';
import { accepted, firstOverlappingTransition, nameOfState, traceSearchPath, transduced } from './runtime.js';
import { defineFamily } from './registry.js';

export function headMoveDelta(dir) {
  return dir === 'R' ? 1 : (dir === 'L' ? -1 : 0);
}

export function isHeadOutOfInput(tokens, head) {
  return head < 0 || head >= tokens.length;
}

export function twoWayDisplayTape(tokens) {
  return buildMarkedInputTape(tokens);
}

export function twoWayDisplayHead(tokens, head) {
  return head;
}

export function twoWayReadSymbol(tokens, head) {
  return tokens[head] ?? null;
}

export function getTwoWayMatchingTransitions(state, sym) {
  return App.transitions.filter(t => t.from === state && (t.symbol === sym || t.symbol === App.config.sym.any));
}

export function buildTwoWayPathSteps(path, tokens, finalStatus = null, finalNote = '') {
  const displayTape = twoWayDisplayTape(tokens);
  const steps = path.map((cfg, idx) => {
    const stateName = getState(cfg.state)?.name || cfg.state;
    const step = {
      state: cfg.state,
      tokens,
      tape: [...displayTape],
      head: twoWayDisplayHead(displayTape, cfg.head),
      branch: cfg.branch,
      tid: cfg.via?.id,
      note: ''
    };
    // Present only for 2DFT; inert for 2DFA/2NFA.
    if (Array.isArray(cfg.outToks)) { step.outToks = [...cfg.outToks]; step.outSoFar = cfg.outRaw; }
    if (idx === 0) {
      step.note = `Start: ${stateName} at ${displayTape[cfg.head]}`;
    } else {
      const prev = path[idx - 1];
      const fromName = getState(prev.state)?.name || prev.state;
      const read = twoWayReadSymbol(displayTape, prev.head);
      const readSym = read === null ? App.config.sym.eps : read;
      step.note = `Branch ${cfg.branch} depth ${cfg.depth}: ${fromName} reads '${readSym}', move ${cfg.via?.dir || 'S'} → ${stateName} (head=${cfg.head})`;
    }
    return step;
  });
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept'
      ? ` — ${finalNote || 'ACCEPT'}`
      : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

export function explore2DFA(tokens) {
  const tape = buildMarkedInputTape(tokens);
  const init = { state: App.startId, head: 0, depth: 0, branch: 1, parent: null, via: null };
  const path = [init];

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const cfg = path[path.length - 1];
    if (App.accepts.has(cfg.state)) {
      return {
        accepted: true,
        path,
        finalNote: `Accepted in state ${getState(cfg.state)?.name || cfg.state}`
      };
    }

    if (cfg.head < 0 || cfg.head >= tape.length) {
      return {
        accepted: false,
        path,
        finalNote: `Head moved outside endmarker bounds at index ${cfg.head}`
      };
    }

    const sym = tape[cfg.head];
    const matching = getTwoWayMatchingTransitions(cfg.state, sym);
    const t = pickMostSpecificTransition(matching, tr => (tr.symbol === sym ? 1 : 0));
    if (!t) {
      return {
        accepted: false,
        path,
        finalNote: `No valid transition on '${sym}'`
      };
    }
    const nextHead = cfg.head + headMoveDelta(t.dir);
    if (nextHead < 0 || nextHead >= tape.length) {
      const boundSym = nextHead < 0 ? '⊢' : '⊣';
      return {
        accepted: false,
        path,
        finalNote: `Transition on '${sym}' attempted to move outside ${boundSym} bound.`
      };
    }
    path.push({
      state: t.to,
      head: nextHead,
      depth: cfg.depth + 1,
      branch: cfg.branch,
      parent: cfg,
      via: t
    });
  }

  return {
    accepted: false,
    path,
    finalNote: `2DFA step limit ${App.config.maxTmSteps} reached`
  };
}

export function sim2DFA(tokens) {
  const result = explore2DFA(tokens);
  App.simSteps = buildTwoWayPathSteps(result.path, tokens, result.accepted ? 'accept' : 'reject', result.finalNote);
  App.simIdx = 0;
  renderSimStep();
  return result;
}

export function explore2NFA(tokens) {
  const tape = buildMarkedInputTape(tokens);
  const init = { state: App.startId, head: 0, depth: 0, branch: 1, parent: null, via: null };
  const queue = [init];
  const visited = new Set([`${init.state}|${init.head}`]);
  let acceptedCfg = null;
  let lastCfg = init;
  let branches = 0;
  let maxDepth = 0;
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxTmSteps) {
    const cfg = queue.shift();
    lastCfg = cfg;
    branches++;
    maxDepth = Math.max(maxDepth, cfg.depth);

    if (App.accepts.has(cfg.state)) {
      acceptedCfg = cfg;
      break;
    }

    if (cfg.head < 0 || cfg.head >= tape.length) {
      continue;
    }

    const sym = tape[cfg.head];
    const matching = getTwoWayMatchingTransitions(cfg.state, sym);
    if (!matching.length) continue;

    matching.forEach((t, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextHead = cfg.head + headMoveDelta(t.dir);
      if (nextHead < 0 || nextHead >= tape.length) return;
      const nextCfg = {
        state: t.to,
        head: nextHead,
        depth: cfg.depth + 1,
        branch: childBranch,
        parent: cfg,
        via: t
      };
      const key = `${nextCfg.state}|${nextCfg.head}`;
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  const witnessCfg = acceptedCfg || lastCfg;
  return {
    accepted: !!acceptedCfg,
    witnessPath: traceSearchPath(witnessCfg),
    finalCfg: witnessCfg,
    unresolved: !acceptedCfg && queue.length > 0,
    branches,
    maxDepth
  };
}

export function sim2NFA(tokens) {
  const result = explore2NFA(tokens);
  const finalNote = result.accepted
    ? `Accepted in state ${getState(result.finalCfg.state)?.name || result.finalCfg.state}`
    : (result.unresolved
      ? `Exploration limit ${App.config.maxTmSteps} reached — unresolved branches remain`
      : 'All branches halted without acceptance');
  App.simSteps = buildTwoWayPathSteps(
    result.witnessPath,
    tokens,
    result.accepted ? 'accept' : 'reject',
    finalNote
  );
  App.simIdx = 0;
  renderSimStep();
  return result;
}

export function test2DFA(tokens) {
  return explore2DFA(tokens).accepted;
}

export function test2NFA(tokens) {
  return explore2NFA(tokens).accepted;
}

// ══════════════════════════════════════════════════════════════════
//  TWO-WAY TRANSDUCER
// ══════════════════════════════════════════════════════════════════
// Deterministic, so this is explore2DFA's walk with an output accumulator. The
// head may revisit cells, which is exactly what lets a 2DFT compute w ↦ ww and
// w ↦ wᴿ — transductions no one-way FST can realise.
export function explore2DFT(tokens) {
  const tape = buildMarkedInputTape(tokens);
  const lambda = App.config.sym.lambda;
  const init = { state: App.startId, head: 0, depth: 0, branch: 1, parent: null, via: null, outRaw: '', outToks: [] };
  const path = [init];

  for (let step = 0; step < App.config.maxTmSteps; step++) {
    const cfg = path[path.length - 1];
    if (App.accepts.has(cfg.state)) {
      return { accepted: true, halted: true, path, finalNote: `Accepted in state ${getState(cfg.state)?.name || cfg.state}` };
    }
    const sym = tape[cfg.head];
    const matching = getTwoWayMatchingTransitions(cfg.state, sym);
    const t = pickMostSpecificTransition(matching, tr => (tr.symbol === sym ? 1 : 0));
    if (!t) return { accepted: false, halted: true, path, finalNote: `No valid transition on '${sym}'` };
    const nextHead = cfg.head + headMoveDelta(t.dir);
    if (nextHead < 0 || nextHead >= tape.length) {
      const boundSym = nextHead < 0 ? App.config.sym.leftMarker : App.config.sym.rightMarker;
      return { accepted: false, halted: true, path, finalNote: `Transition on '${sym}' attempted to move outside ${boundSym} bound.` };
    }
    const rawOut = t.output ?? '';
    path.push({
      state: t.to,
      head: nextHead,
      depth: cfg.depth + 1,
      branch: cfg.branch,
      parent: cfg,
      via: t,
      outRaw: cfg.outRaw + rawOut,
      outToks: [...cfg.outToks, rawOut === '' ? lambda : rawOut]
    });
  }

  // A two-way head can genuinely loop. Saying "no verdict" is the honest
  // report; calling it a rejection would assert something we did not decide.
  return { accepted: false, halted: false, path, finalNote: `2DFT step limit ${App.config.maxTmSteps} reached` };
}

export function test2DFT(tokens) {
  const result = explore2DFT(tokens);
  const finalCfg = result.path[result.path.length - 1];
  return { accepted: result.accepted, halted: result.halted, output: finalCfg?.outRaw ?? '' };
}

export function sim2DFT(tokens) {
  const result = explore2DFT(tokens);
  const usesAcceptance = App.config.transducerAccepts;
  const finalStatus = !result.halted ? 'timeout' : (usesAcceptance ? (result.accepted ? 'accept' : 'reject') : null);
  App.simSteps = buildTwoWayPathSteps(result.path, tokens, finalStatus, result.finalNote);
  const last = App.simSteps[App.simSteps.length - 1];
  if (last) {
    if (!result.halted) last.limit = App.config.maxTmSteps;
    last.note += ` | Output: "${result.path[result.path.length - 1]?.outRaw ?? ''}"`;
  }
  App.simIdx = 0;
  renderSimStep();
  return result;
}

// ── the definitions ───────────────────────────────────────────────

// A two-way head takes every matching edge, so a wildcard alongside a
// concrete symbol is a genuine branch here even where a DFA tolerates it —
// hence overlap rather than equality. The alternative named is the machine
// the reader should switch to if the branch was intended, which is why it
// is a per-type string rather than a rule.
const twoWayDeterminism = alternative => ({
  conflict: (c, editId) => firstOverlappingTransition(c.from, c.symbol, editId),
  say: c => `${App.machine} already has δ(${nameOfState(c.from)}, '${c.symbol}'). Use ${alternative} mode if you want multiple choices for the same read symbol.`
});

const twoWay = {
  family: 'twoway',
  schema: {
    transitionFields: ['from', 'to', 'on', 'move'],
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma']
  }
};

defineFamily(twoWay, {
  '2DFA': {
    simulate: sim2DFA,
    deterministicDelta: true,
    determinism: twoWayDeterminism('2NFA'),
    decide: tokens => accepted(test2DFA(tokens)),
    formal: { tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'F'], delta: () => 'Q × Σ → Q × {L, R, S}' }
  },
  '2NFA': {
    simulate: sim2NFA,
    decide: tokens => accepted(test2NFA(tokens)),
    formal: { tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'F'], delta: () => 'Q × Σ → P(Q × {L, R, S})' }
  },
  '2DFT': {
    simulate: sim2DFT,
    deterministicDelta: true,
    determinism: twoWayDeterminism('FST'),
    // A head that never halted has decided nothing, so the verdict is
    // three-valued here the way a Turing machine's is — the output it
    // accumulated so far is still worth showing.
    decide: tokens => {
      const r = test2DFT(tokens);
      return r.halted ? transduced(r.accepted, r.output) : { verdict: 'unk', output: r.output };
    },
    schema: {
      ...twoWay.schema,
      transitionFields: ['from', 'to', 'on', 'move', 'out'],
      alphabetFields: ['sigma', 'outputAlpha']
    },
    formal: {
      tuple: () => ['Q', 'Σ', 'Δ', 'δ', 'λ', 'q₀', 'F'],
      delta: () => 'Q × Σ → Q × {L, R, S} × Δ*',
      outputSay: 'Q × Σ → Δ*'
    }
  }
});
