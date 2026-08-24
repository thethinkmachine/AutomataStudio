// ══════════════════════════════════════════════════════════════════
//  PUSHDOWN MACHINES — DPDA, PDA, NPDA, QA, Counter, 2PDA, PDT
// ══════════════════════════════════════════════════════════════════
// One store, reached through one interface. applyPdaStoreTransition,
// pdaPeek and pdaStoreToString take a queueMode flag and a second stack,
// which is the whole of what separates a stack from a queue and one
// store from two — so all seven types share a configuration, a matcher
// and a path builder, and differ in how far they are allowed to branch.
//
// The Pushdown Transducer belongs here rather than with the transducers:
// it *is* a PDA, sharing every one of those functions, and differs only
// in accumulating output as it goes.

import { App } from '../state.js';
import { renderSimStep } from '../simulation.js';
import { getState } from '../states-transitions.js';
import { getPdaDeterminismConflict, isQueueAutomaton, isTwoStackPDA } from '../utils.js';
import { accepted, nameOfState, traceSearchPath, transduced, transducerRunContributes } from './runtime.js';
import { defineFamily } from './registry.js';

export function canApplyPdaPop(top, pop) {
  const eps = App.config.sym.eps;
  if (pop === eps) return true;
  return top !== undefined && (pop === top || pop === App.config.sym.any);
}

export function pdaUsesQueueStorage(machine = App.machine) {
  return isQueueAutomaton(machine);
}

export function pdaUsesSecondStack(machine = App.machine) {
  return isTwoStackPDA(machine);
}

export function pdaPeek(store, queueMode = false) {
  if (!store || !store.length) return undefined;
  return queueMode ? store[0] : store[store.length - 1];
}

export function pdaStoreToString(store, queueMode = false) {
  if (!store || !store.length) return App.config.sym.eps;
  return queueMode ? store.join('') : [...store].reverse().join('');
}

export function applyPdaStoreTransition(store, pop, push, queueMode = false) {
  const eps = App.config.sym.eps;
  const nextStore = [...store];
  let popped = undefined;
  if (pop !== eps) {
    popped = queueMode ? nextStore.shift() : nextStore.pop();
  }
  let pushStr = push && push !== eps ? push : '';
  if (pushStr === App.config.sym.any) pushStr = popped || '';
  if (pushStr) {
    const chars = pushStr.split('');
    if (queueMode) chars.forEach(sym => nextStore.push(sym));
    else chars.reverse().forEach(sym => nextStore.push(sym));
  }
  return nextStore;
}

export function createInitialPdaConfig(tokens) {
  const isExplicit = App.config.pdaParadigm === 'explicit';
  const baseStore = isExplicit ? [App.config.sym.stackBottom] : [];
  const cfg = {
    state: App.startId,
    tokens,
    remaining: [...tokens],
    stack: [...baseStore],
    depth: 0,
    branch: 1,
    parent: null,
    via: null
  };
  if (pdaUsesSecondStack()) cfg.stack2 = [...baseStore];
  return cfg;
}

export function pdaConfigKey(state, remaining, stack, stack2 = null) {
  const second = Array.isArray(stack2) ? `|${stack2.join('\u0001')}` : '';
  return `${state}|${remaining.join('\u0001')}|${stack.join('\u0001')}${second}`;
}

export function isPdaAcceptingConfig(cfg) {
  if (App.config.pdaParadigm === 'explicit') {
    return App.accepts.has(cfg.state) && cfg.remaining.length === 0;
  }
  if (pdaUsesSecondStack()) {
    return cfg.remaining.length === 0 && cfg.stack.length === 0 && (cfg.stack2 || []).length === 0;
  }
  return cfg.remaining.length === 0 && cfg.stack.length === 0;
}

export function formatPdaInstantaneousDescription(cfg) {
  const stateName = getState(cfg.state)?.name || cfg.state;
  const remaining = cfg.remaining.length ? cfg.remaining.join('') : App.config.sym.eps;
  const primary = pdaStoreToString(cfg.stack, pdaUsesQueueStorage());
  if (pdaUsesSecondStack()) {
    const secondary = pdaStoreToString(cfg.stack2 || []);
    return `(${stateName}, ${remaining}, ${primary}; ${secondary})`;
  }
  return `(${stateName}, ${remaining}, ${primary})`;
}

export function getMatchingPdaTransitions(cfg) {
  const eps = App.config.sym.eps;
  const queueMode = pdaUsesQueueStorage();
  const top = pdaPeek(cfg.stack, queueMode);
  const top2 = pdaUsesSecondStack() ? pdaPeek(cfg.stack2 || []) : undefined;
  return App.transitions.filter(t => {
    if (t.from !== cfg.state) return false;
    const readOk = t.symbol === eps || (cfg.remaining.length > 0 && (t.symbol === cfg.remaining[0] || t.symbol === App.config.sym.any));
    const popOk = canApplyPdaPop(top, t.pop);
    const pop2Sym = t.pop2 || eps;
    const pop2Ok = !pdaUsesSecondStack() || canApplyPdaPop(top2, pop2Sym);
    return readOk && popOk && pop2Ok;
  });
}

export function applyPdaTransitionConfig(cfg, transition, branch = cfg.branch) {
  const eps = App.config.sym.eps;
  const queueMode = pdaUsesQueueStorage();
  const nextCfg = {
    state: transition.to,
    tokens: cfg.tokens,
    remaining: transition.symbol === eps ? [...cfg.remaining] : cfg.remaining.slice(1),
    stack: applyPdaStoreTransition(cfg.stack, transition.pop || eps, transition.push || eps, queueMode),
    depth: cfg.depth + 1,
    branch,
    parent: cfg,
    via: transition
  };
  if (pdaUsesSecondStack()) {
    nextCfg.stack2 = applyPdaStoreTransition(cfg.stack2 || [], transition.pop2 || eps, transition.push2 || eps, false);
  }
  return nextCfg;
}

export function formatPdaTransitionNote(prevCfg, nextCfg) {
  const t = nextCfg.via;
  const fromName = getState(prevCfg.state)?.name || prevCfg.state;
  const toName = getState(nextCfg.state)?.name || nextCfg.state;
  const read = t?.symbol || App.config.sym.eps;
  const pop = t?.pop || App.config.sym.eps;
  const push = t?.push || App.config.sym.eps;
  const pop2 = t?.pop2 || App.config.sym.eps;
  const push2 = t?.push2 || App.config.sym.eps;
  if (pdaUsesSecondStack()) {
    return `Branch ${nextCfg.branch} depth ${nextCfg.depth}: (${fromName}, ${read}, ${pop}/${pop2}) → (${toName}, ${push}/${push2})`;
  }
  return `Branch ${nextCfg.branch} depth ${nextCfg.depth}: (${fromName}, ${read}, ${pop}) → (${toName}, ${push})`;
}

export function buildPdaPathSteps(path, finalStatus = null, finalNote = '') {
  const steps = path.map((cfg, idx) => {
    const step = {
      state: cfg.state,
      tokens: cfg.tokens,
      remaining: [...cfg.remaining],
      stack: [...cfg.stack],
      branch: cfg.branch,
      tid: cfg.via?.id,
      note: idx === 0 ? 'Start configuration' : formatPdaTransitionNote(path[idx - 1], cfg)
    };
    if (Array.isArray(cfg.stack2)) step.stack2 = [...cfg.stack2];
    // Present only for PDT; inert for every other pushdown family.
    if (Array.isArray(cfg.outToks)) { step.outToks = [...cfg.outToks]; step.outSoFar = cfg.outRaw; }
    return step;
  });
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept' ? ' — ACCEPT' : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

export function appendPdaSummaryStep(steps, cfg, finalStatus, note) {
  const summary = {
    state: cfg.state,
    tokens: cfg.tokens,
    remaining: [...cfg.remaining],
    stack: [...cfg.stack],
    branch: cfg.branch,
    note,
    final: finalStatus
  };
  if (Array.isArray(cfg.stack2)) summary.stack2 = [...cfg.stack2];
  steps.push(summary);
}

export function simPDA(tokens) {
  const init = createInitialPdaConfig(tokens);
  if (isPdaAcceptingConfig(init)) {
    App.simSteps = buildPdaPathSteps([init], 'accept');
    App.simIdx = 0; renderSimStep();
    return { accepted: true };
  }

  let cfg = init;
  const visited = new Set([pdaConfigKey(cfg.state, cfg.remaining, cfg.stack, cfg.stack2)]);

  for (let step = 0; step < App.config.maxPdaSteps; step++) {
    const matching = getMatchingPdaTransitions(cfg);
    if (matching.length > 1) {
      App.simSteps = buildPdaPathSteps(traceSearchPath(cfg));
      appendPdaSummaryStep(
        App.simSteps,
        cfg,
        'reject',
        'Nondeterministic overlap detected in DPDA mode. Switch to NPDA to explore all valid branches.'
      );
      App.simIdx = 0; renderSimStep();
      return { accepted: false };
    }
    if (!matching.length) {
      App.simSteps = buildPdaPathSteps(traceSearchPath(cfg));
      appendPdaSummaryStep(App.simSteps, cfg, 'reject', 'No valid transition from this configuration — REJECT');
      App.simIdx = 0; renderSimStep();
      return { accepted: false };
    }

    const nextCfg = applyPdaTransitionConfig(cfg, matching[0], cfg.branch);
    const nextKey = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack, nextCfg.stack2);
    if (visited.has(nextKey)) {
      App.simSteps = buildPdaPathSteps(traceSearchPath(cfg));
      appendPdaSummaryStep(App.simSteps, cfg, 'reject', 'Repeated configuration detected — possible ε-loop — REJECT');
      App.simIdx = 0; renderSimStep();
      return { accepted: false };
    }
    visited.add(nextKey);
    cfg = nextCfg;

    if (isPdaAcceptingConfig(cfg)) {
      App.simSteps = buildPdaPathSteps(traceSearchPath(cfg), 'accept');
      App.simIdx = 0; renderSimStep();
      return { accepted: true };
    }
  }

  App.simSteps = buildPdaPathSteps(traceSearchPath(cfg));
  appendPdaSummaryStep(App.simSteps, cfg, 'reject', 'PDA step limit reached — REJECT');
  App.simIdx = 0; renderSimStep();
  return { accepted: false };
}

export function exploreNPDA(tokens) {
  const init = createInitialPdaConfig(tokens);
  const queue = [init];
  const visited = new Set([pdaConfigKey(init.state, init.remaining, init.stack, init.stack2)]);
  const log = [];
  let acceptedCfg = null;
  let branches = 0;
  let maxDepth = 0;
  let lastExplored = init;
  let nextBranchId = 2;

  while (queue.length && branches < App.config.maxPdaSteps) {
    const cfg = queue.shift();
    lastExplored = cfg;
    branches++;
    maxDepth = Math.max(maxDepth, cfg.depth);
    const stateName = getState(cfg.state)?.name || cfg.state;
    const idStr = formatPdaInstantaneousDescription(cfg);

    if (isPdaAcceptingConfig(cfg)) {
      acceptedCfg = cfg;
      log.push(`<span class="step-acc">Branch ${cfg.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${cfg.depth}.<br>ID: ${idStr}</span>`);
      break;
    }

    const matching = getMatchingPdaTransitions(cfg);
    if (!matching.length) {
      log.push(`Branch ${cfg.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${idStr}.<br>Depth ${cfg.depth}</span>`);
      continue;
    }

    const nextRead = cfg.remaining[0] || App.config.sym.eps;
    const primaryTop = pdaPeek(cfg.stack, pdaUsesQueueStorage());
    const primaryTopLabel = isQueueAutomaton() ? 'Queue front' : 'Stack top';
    const subs = [
      `State "${stateName}" with next input '${nextRead}'`,
      `Depth ${cfg.depth} · ${primaryTopLabel} ${primaryTop || App.config.sym.eps}`,
      `ID: ${idStr}`
    ];
    if (isTwoStackPDA()) {
      subs.push(`Second stack top ${pdaPeek(cfg.stack2 || []) || App.config.sym.eps}`);
    }
    if (matching.length > 1) {
      subs.push(`Nondeterministic choice: ${matching.length} matching transitions.`);
    }
    log.push(`Branch ${cfg.branch}: exploring <em>${stateName}</em><span class="step-sub">${subs.join('<br>')}</span>`);

    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyPdaTransitionConfig(cfg, transition, childBranch);
      const key = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack, nextCfg.stack2);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  return {
    accepted: !!acceptedCfg,
    branches,
    maxDepth,
    log,
    witnessPath: traceSearchPath(acceptedCfg || lastExplored),
    finalCfg: acceptedCfg || lastExplored,
    unresolved: !acceptedCfg && queue.length > 0
  };
}

export function simNPDA(tokens) {
  const result = exploreNPDA(tokens);
  if (result.accepted) {
    App.simSteps = buildPdaPathSteps(result.witnessPath, 'accept');
  } else {
    App.simSteps = buildPdaPathSteps(result.witnessPath);
    appendPdaSummaryStep(
      App.simSteps,
      result.finalCfg,
      'reject',
      result.unresolved
        ? `Exploration limit ${App.config.maxPdaSteps} reached — unresolved branches remain`
        : 'All branches halted without acceptance — REJECT'
    );
  }
  App.simIdx = 0;
  renderSimStep();
  return {
    accepted: result.accepted,
    branches: result.branches,
    maxDepth: result.maxDepth,
    log: result.log,
    witnessLength: result.witnessPath.length
  };
}

export function testPDA(tokens) {
  let cfg = createInitialPdaConfig(tokens);
  if (isPdaAcceptingConfig(cfg)) return true;
  const visited = new Set([pdaConfigKey(cfg.state, cfg.remaining, cfg.stack, cfg.stack2)]);

  for (let step = 0; step < App.config.maxPdaSteps; step++) {
    const matching = getMatchingPdaTransitions(cfg);
    if (matching.length !== 1) return false;
    const nextCfg = applyPdaTransitionConfig(cfg, matching[0], cfg.branch);
    const nextKey = pdaConfigKey(nextCfg.state, nextCfg.remaining, nextCfg.stack, nextCfg.stack2);
    if (visited.has(nextKey)) return false;
    visited.add(nextKey);
    cfg = nextCfg;
    if (isPdaAcceptingConfig(cfg)) return true;
  }

  return false;
}

export function testNPDA(tokens) {
  return exploreNPDA(tokens).accepted;
}

// ══════════════════════════════════════════════════════════════════
//  PUSHDOWN TRANSDUCER
// ══════════════════════════════════════════════════════════════════
// A PDT is a PDA that also prints, so it reuses the PDA configuration
// machinery wholesale and only extends the config with the emitted string.
// Two runs reaching the same (state, input, stack) with different output are
// genuinely different configurations, so the output joins the visited key —
// the same reason exploreFST keys on its own output.
export function pdtConfigKey(cfg) {
  return `${pdaConfigKey(cfg.state, cfg.remaining, cfg.stack, cfg.stack2)}|${cfg.outRaw}`;
}

export function applyPdtTransitionConfig(cfg, transition, branch) {
  const next = applyPdaTransitionConfig(cfg, transition, branch);
  const rawOut = transition.output ?? '';
  next.outRaw = (cfg.outRaw || '') + rawOut;
  next.outToks = [...(cfg.outToks || []), rawOut === '' ? App.config.sym.lambda : rawOut];
  return next;
}

export function explorePDT(tokens) {
  const init = createInitialPdaConfig(tokens);
  init.outRaw = '';
  init.outToks = [];
  const queue = [init];
  const visited = new Set([pdtConfigKey(init)]);
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

    const accepting = isPdaAcceptingConfig(cfg);
    if (cfg.remaining.length === 0) {
      if (transducerRunContributes(true, accepting)) outputs.add(cfg.outRaw);
      if (!completedCfg) completedCfg = cfg;
    }
    // No early break, for the same reason as exploreFST: the relation is the
    // set of outputs over accepting runs, not just the first one found.
    if (accepting && !acceptedCfg) acceptedCfg = cfg;

    const matching = getMatchingPdaTransitions(cfg);
    if (!matching.length) continue;
    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyPdtTransitionConfig(cfg, transition, childBranch);
      const key = pdtConfigKey(nextCfg);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  const witnessCfg = acceptedCfg || completedCfg || lastCfg;
  return {
    accepted: !!acceptedCfg,
    outputs,
    witnessPath: traceSearchPath(witnessCfg),
    finalCfg: witnessCfg,
    unresolved: !acceptedCfg && queue.length > 0,
    branches,
    maxDepth
  };
}

export function testPDT(tokens) {
  const result = explorePDT(tokens);
  const outs = [...result.outputs];
  return { accepted: result.accepted, output: outs.length ? outs[0] : '', outputs: outs };
}

export function simPDT(tokens) {
  const result = explorePDT(tokens);
  const usesAcceptance = App.config.transducerAccepts;
  const finalStatus = usesAcceptance ? (result.accepted ? 'accept' : 'reject') : null;
  const finalNote = usesAcceptance
    ? (result.accepted
      ? 'Accepting run found'
      : (result.unresolved
        ? `Exploration limit ${App.config.maxPdaSteps} reached — unresolved branches remain`
        : 'No accepting run found'))
    : '';

  App.simSteps = buildPdaPathSteps(result.witnessPath, finalStatus, finalNote);
  const last = App.simSteps[App.simSteps.length - 1];
  if (last) {
    const outs = [...result.outputs];
    if (!outs.length) last.note += ' | Output: ""';
    else if (outs.length === 1) last.note += ` | Output: "${outs[0]}"`;
    else last.note += ` | Outputs: {${outs.map(o => `"${o}"`).join(', ')}}`;
  }
  App.simIdx = 0;
  renderSimStep();
  return result;
}

// ── the definitions ───────────────────────────────────────────────
// The split that matters here is deterministic vs branching, and it is
// not the one the names suggest: DPDA follows the single matching move
// and gives up where there is a choice, while QA, Counter and 2PDA all
// go through the nondeterministic explorer even though two of them are
// usually drawn deterministically. What separates them from DPDA is that
// their store admits several moves from one configuration, not that their
// authors intended a guess.

const pushdown = {
  family: 'pushdown',
  // What this machine calls its store, for the transition editor's three
  // labels: the section title, the read end, the write end.
  storeLabels: ['Stack', 'Pop', 'Push'],
  schema: {
    transitionFields: ['from', 'to', 'on', 'pop', 'push'],
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma', 'stackAlpha']
  }
};

// The classic PDA tuple is the one place the app's own setting shows in a
// formal definition: under "empty stack" acceptance there is no Z₀ to
// name and no F to reach.
const classicTuple = () => App.config.pdaParadigm === 'explicit'
  ? ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'Z₀', 'F']
  : ['Q', 'Σ', 'Γ', 'δ', 'q₀'];

const deterministic = {
  ...pushdown,
  deterministicDelta: true,
  // The conflict is over a whole configuration, not a symbol: two moves
  // clash only if their reads *and* their pops can both apply at once, so
  // (q, a, A) and (q, a, B) are two rules of one deterministic machine.
  determinism: {
    conflict: (c, editId) => getPdaDeterminismConflict({ from: c.from, symbol: c.symbol, pop: c.pop }, App.transitions, editId),
    say: c => `DPDA already has an overlapping move from ${nameOfState(c.from)}. Switch to NPDA mode if you want branching on the same configuration.`
  },
  simulate: simPDA,
  decide: tokens => accepted(testPDA(tokens))
};

const branching = {
  ...pushdown,
  simulate: simNPDA,
  decide: tokens => accepted(testNPDA(tokens))
};

defineFamily(pushdown, {
  'DPDA': { ...deterministic, formal: { tuple: classicTuple, delta: () => 'Q × (Σ ∪ {ε}) × Γ → Q × Γ*' } },
  // A hidden alias of DPDA, deliberately absent from the model picker.
  'PDA': { ...deterministic, formal: { tuple: classicTuple, delta: () => 'Q × (Σ ∪ {ε}) × Γ → Q × Γ*' } },
  'NPDA': { ...branching, formal: { tuple: classicTuple, delta: () => 'Q × (Σ ∪ {ε}) × Γ → P(Q × Γ*)' } },
  'QA': {
    ...branching,
    storeLabels: ['Queue', 'Dequeue', 'Enqueue'],
    formal: {
      tuple: () => ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'F'],
      delta: () => 'Q × (Σ ∪ {ε}) × (Γ ∪ {ε}) → P(Q × Γ*)',
      storeSay: 'queue alphabet'
    }
  },
  'Counter': {
    ...branching,
    storeLabels: ['Counter', 'Test', 'Update'],
    // Branching, like QA and 2PDA above — the codomain is a power set. This
    // string used to be DPDA's, copied verbatim, so the Language panel
    // reported the machine as single-valued while the runtime explored.
    formal: { tuple: () => ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'F'], delta: () => 'Q × (Σ ∪ {ε}) × (Γ ∪ {ε}) → P(Q × Γ*)' }
  },
  '2PDA': {
    ...branching,
    schema: { ...pushdown.schema, transitionFields: ['from', 'to', 'on', 'pop', 'push', 'pop2', 'push2'] },
    formal: {
      tuple: () => ['Q', 'Σ', 'Γ₁', 'Γ₂', 'δ', 'q₀', 'F'],
      delta: () => 'Q × (Σ ∪ {ε}) × Γ₁ × Γ₂ → P(Q × Γ₁* × Γ₂*)'
    }
  },
  'PDT': {
    ...pushdown,
    simulate: simPDT,
    decide: tokens => { const r = testPDT(tokens); return transduced(r.accepted, r.output); },
    schema: { ...pushdown.schema, transitionFields: ['from', 'to', 'on', 'pop', 'push', 'out'], alphabetFields: ['sigma', 'stackAlpha', 'outputAlpha'] },
    formal: {
      tuple: () => ['Q', 'Σ', 'Γ', 'Δ', 'δ', 'λ', 'q₀', 'F'],
      delta: () => 'Q × (Σ ∪ {ε}) × Γ → P(Q × Γ* × Δ*)',
      outputSay: 'Q × (Σ ∪ {ε}) × Γ × Q → Δ*'
    }
  }
});
