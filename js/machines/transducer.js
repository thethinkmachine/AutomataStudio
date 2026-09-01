// ══════════════════════════════════════════════════════════════════
//  TRANSDUCERS — Moore, Mealy, FST
// ══════════════════════════════════════════════════════════════════
// Machines that compute a function rather than decide a set. What
// separates the three is where the emitted symbol lives and how much the
// machine is allowed to guess:
//
//   Moore — output on the state, so a run of n symbols emits n+1 of them
//           and δ is a plain DFA's.
//   Mealy — output on the transition: n symbols in, n out.
//   FST   — output on the transition, ε-moves allowed and δ branching, so
//           the result is a *relation* rather than a function and the run
//           is a search whose accepting branches are collected.
//
// Whether a transducer has a verdict at all is App.config.transducerAccepts,
// and it is the caller's policy rather than the machine's: decide() here
// always answers, and computeBatchResults is what drops the answer when
// the setting is off.
//
// The other two transducers live elsewhere, with the mechanism they share
// rather than the flag: PDT with the pushdown machines, 2DFT with the
// two-way heads.

import { App, getState } from '../state.js';
import { renderSimStep } from './paint.js';
import { accepted, firstOverlappingTransition, getSingleTapeDeterministicTransition, nameOfState, playEagerly, traceSearchPath, transduced, transducerRunContributes } from './runtime.js';
import { testDFA } from './finite.js';
import { defineFamily } from './registry.js';

export function* streamMoore(tokens) {
  let cur = App.startId;
  const s0 = getState(cur);
  const initOut = s0?.output ?? '';
  let outStr = initOut;
  let outputs = [initOut];
  let last = { state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Start: ${s0?.name} — ${App.config.sym.lambda}: '${initOut}'` };
  yield last;
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) {
      last = { state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `No δ(${getState(cur)?.name},'${sym}') — HALT`, final: 'reject' };
      yield last;
      break;
    }
    cur = t.to;
    const sc = getState(cur);
    const out = sc?.output ?? '';
    outStr += out;
    outputs.push(out);
    last = { state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Read '${sym}' → ${sc?.name} — ${App.config.sym.lambda}: '${out}'`, tid: t.id };
    yield last;
  }
  const showAccepts = App.config.transducerAccepts;
  if (!last.final && showAccepts) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  last.note += ` | Output: "${outStr}"`;
}

export function simMoore(tokens) { playEagerly(streamMoore(tokens)); }

export function* streamMealy(tokens) {
  let cur = App.startId;
  let outStr = '';
  let outputs = [];
  let last = { state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Start: ${getState(cur)?.name}` };
  yield last;
  for (let i = 0; i < tokens.length; i++) {
    const sym = tokens[i];
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) {
      last = { state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `No δ(${getState(cur)?.name},'${sym}') — HALT`, final: 'reject' };
      yield last;
      break;
    }
    const out = t.output ?? '?';
    outStr += out;
    outputs.push(out);
    cur = t.to;
    last = { state: cur, tokens, outToks: [...outputs], outSoFar: outStr, note: `Read '${sym}' → ${getState(cur)?.name} — out: '${out}'`, tid: t.id };
    yield last;
  }
  const showAccepts = App.config.transducerAccepts;
  if (!last.final && showAccepts) { last.final = App.accepts.has(cur) ? 'accept' : 'reject'; last.note += ` — ${last.final.toUpperCase()}`; }
  if (outStr.length) last.note += ` | Output: "${outStr}"`;
}

export function simMealy(tokens) { playEagerly(streamMealy(tokens)); }

// ══════════════════════════════════════════════════════════════════
//  FINITE STATE TRANSDUCER
// ══════════════════════════════════════════════════════════════════
// δ branches and may read ε, so a run is a search rather than a walk and
// the result is a relation rather than a function. Two branches reaching
// the same (state, position) with different output are genuinely different
// configurations, which is why the output joins the visited key.

export function fstConfigKey(state, index, outRaw) {
  return `${state}|${index}|${outRaw}`;
}

export function getMatchingFstTransitions(cfg, tokens) {
  const eps = App.config.sym.eps;
  return App.transitions.filter(t => {
    if (t.from !== cfg.state) return false;
    if (t.symbol === eps) return true;
    if (cfg.index >= tokens.length) return false;
    return t.symbol === tokens[cfg.index] || t.symbol === App.config.sym.any;
  });
}

export function applyFstTransition(cfg, transition, branch) {
  const eps = App.config.sym.eps;
  const rawOut = transition.output ?? '';
  const displayOut = rawOut === '' ? App.config.sym.lambda : rawOut;
  const consumes = transition.symbol !== eps;
  return {
    state: transition.to,
    index: consumes ? cfg.index + 1 : cfg.index,
    depth: cfg.depth + 1,
    branch,
    outRaw: cfg.outRaw + rawOut,
    outToks: [...cfg.outToks, displayOut],
    parent: cfg,
    via: transition
  };
}

export function buildFstPathSteps(path, tokens, finalStatus = null, finalNote = '') {
  const steps = path.map((cfg, idx) => {
    const stateName = getState(cfg.state)?.name || cfg.state;
    const step = {
      state: cfg.state,
      tokens,
      outToks: [...cfg.outToks],
      outSoFar: cfg.outRaw,
      branch: cfg.branch,
      tid: cfg.via?.id,
      note: ''
    };
    if (idx === 0) {
      step.note = `Start: ${stateName}`;
    } else {
      const prev = path[idx - 1];
      const fromName = getState(prev.state)?.name || prev.state;
      const read = cfg.via?.symbol || App.config.sym.eps;
      const out = cfg.via?.output !== undefined && cfg.via?.output !== '' ? cfg.via.output : App.config.sym.lambda;
      step.note = `Branch ${cfg.branch} depth ${cfg.depth}: (${fromName}, ${read}/${out}) → ${stateName}`;
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

export function exploreFST(tokens) {
  const init = {
    state: App.startId,
    index: 0,
    depth: 0,
    branch: 1,
    outRaw: '',
    outToks: [],
    parent: null,
    via: null
  };
  const queue = [init];
  const visited = new Set([fstConfigKey(init.state, init.index, init.outRaw)]);
  const outputs = new Set();
  let acceptedCfg = null;
  let completedCfg = null;
  let lastCfg = init;
  let branches = 0;
  let maxDepth = 0;
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxPdaSteps) {
    const cfg = queue.shift();
    lastCfg = cfg;
    branches++;
    maxDepth = Math.max(maxDepth, cfg.depth);

    if (cfg.index === tokens.length) {
      const accepting = App.accepts.has(cfg.state);
      if (transducerRunContributes(true, accepting)) outputs.add(cfg.outRaw);
      if (!completedCfg) completedCfg = cfg;
      // Deliberately no early break. A nondeterministic transducer's answer is
      // the *set* of outputs of its accepting runs, so stopping at the first
      // one would report a truncated relation. The branch budget still bounds
      // the search; the first accepting config is kept as the witness path.
      if (App.config.transducerAccepts && accepting && !acceptedCfg) acceptedCfg = cfg;
    }

    const matching = getMatchingFstTransitions(cfg, tokens);
    if (!matching.length) continue;

    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyFstTransition(cfg, transition, childBranch);
      const key = fstConfigKey(nextCfg.state, nextCfg.index, nextCfg.outRaw);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  const witnessCfg = acceptedCfg || completedCfg || lastCfg;
  return {
    accepted: !!acceptedCfg,
    witnessPath: traceSearchPath(witnessCfg),
    finalCfg: witnessCfg,
    outputs,
    unresolved: !acceptedCfg && queue.length > 0,
    branches,
    maxDepth
  };
}

export function simFST(tokens) {
  const result = exploreFST(tokens);
  const usesAcceptance = App.config.transducerAccepts;
  const finalStatus = usesAcceptance ? (result.accepted ? 'accept' : 'reject') : null;
  const finalNote = usesAcceptance
    ? (result.accepted
      ? 'Accepting branch found'
      : (result.unresolved
        ? `Exploration limit ${App.config.maxPdaSteps} reached — unresolved branches remain`
        : 'No accepting branch found'))
    : '';

  App.simSteps = buildFstPathSteps(result.witnessPath, tokens, finalStatus, finalNote);
  const last = App.simSteps[App.simSteps.length - 1];
  if (last) {
    const outs = [...result.outputs];
    if (!outs.length) {
      last.note += ' | Output: ""';
    } else if (outs.length === 1) {
      last.note += ` | Output: "${outs[0]}"`;
    } else {
      last.note += ` | Outputs: {${outs.map(o => `"${o}"`).join(', ')}}`;
    }
  }

  App.simIdx = 0;
  renderSimStep();
  return result;
}

export function testFST(tokens) {
  const result = exploreFST(tokens);
  const outs = [...result.outputs];
  let output = '';
  if (outs.length > 1) output = outs.join(' | ');
  else if (outs.length === 1) output = outs[0];
  else output = result.witnessPath.at(-1)?.outRaw || '';
  return { accepted: result.accepted, output };
}

// ── the outputs, without a run ────────────────────────────────────
// The batch tester and the Language panel want the emitted string and
// nothing else, so these walk δ directly rather than building steps.

export function getMooreOutput(tokens) {
  let cur = App.startId;
  const outputs = [getState(cur)?.output ?? ''];
  for (const sym of tokens) {
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) break;
    cur = t.to;
    outputs.push(getState(cur)?.output ?? '');
  }
  return outputs.join('');
}

export function getMealyOutput(tokens) {
  let cur = App.startId;
  const outputs = [];
  for (const sym of tokens) {
    const t = getSingleTapeDeterministicTransition(cur, sym);
    if (!t) break;
    outputs.push(t.output ?? '?');
    cur = t.to;
  }
  return outputs.join('');
}

// ── the definitions ───────────────────────────────────────────────
// Moore and Mealy are deterministic finite automata that happen to emit,
// so their verdict is the DFA's — testDFA, not a transducer-specific
// runner. The FST's is not: its δ branches, so a word is in the domain of
// the relation when *some* branch consumed it.

// A transducer computes a function, so a second edge on the same symbol
// is not a branch to explore but two answers to one question.
const transducerDeterminism = {
  conflict: (c, editId) => firstOverlappingTransition(c.from, c.symbol, editId),
  say: c => `${App.machine} already has δ(${nameOfState(c.from)}, '${c.symbol}'). Each input symbol must map to one output.`
};

const transducer = {
  family: 'transducer',
  schema: {
    transitionFields: ['from', 'to', 'on', 'out'],
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma', 'outputAlpha']
  }
};

defineFamily(transducer, {
  'Moore': {
    simulate: simMoore,
    stream: streamMoore,
    deterministicDelta: true,
    determinism: transducerDeterminism,
    decide: tokens => transduced(testDFA(tokens), getMooreOutput(tokens)),
    // Moore hangs its output off the state, so its transitions carry none
    // and its states carry one.
    schema: {
      ...transducer.schema,
      transitionFields: ['from', 'to', 'on'],
      stateFields: ['name', 'start', 'accept', 'out']
    },
    formal: {
      tuple: () => ['Q', 'Σ', 'Δ', 'δ', 'λ', 'q₀'],
      delta: () => 'Q × Σ → Q',
      outputSay: 'Q → Δ',
      outputPerState: true
    }
  },
  'Mealy': {
    simulate: simMealy,
    stream: streamMealy,
    deterministicDelta: true,
    determinism: transducerDeterminism,
    decide: tokens => transduced(testDFA(tokens), getMealyOutput(tokens)),
    formal: {
      tuple: () => ['Q', 'Σ', 'Δ', 'δ', 'λ', 'q₀'],
      delta: () => 'Q × Σ → Q',
      outputSay: 'Q × Σ → Δ'
    }
  },
  'FST': {
    simulate: simFST,
    decide: tokens => { const r = testFST(tokens); return transduced(r.accepted, r.output); },
    formal: {
      tuple: () => ['Q', 'Σ', 'Δ', 'δ', 'λ', 'q₀', 'F'],
      delta: () => 'Q × (Σ ∪ {ε}) → P(Q)',
      outputSay: 'Q × (Σ ∪ {ε}) × Q → Δ*'
    }
  }
});
