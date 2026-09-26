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

import {
  App, getState, runStartId
} from '../state.js';
import { renderSimStep } from './paint.js';
import { getPdaDeterminismConflict, isQueueAutomaton, isTwoStackPDA } from './predicates.js';
import { ConfigSet, Fifo, accepted, makeStateNumbering, nameOfState, traceSearchPath, transduced, transducerRunContributes, transitionsFrom } from './runtime.js';
import { defineFamily } from './registry.js';
import { OUT_EMPTY, outPush, outputKeyAfter, pdaStep, stackPush, stackRoot, storeArray } from './step-log.js';

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

// A store is an array (a queue, or a stack a caller built by hand) or a
// stack node from step-log.js (every stack a search builds). Both answer
// `length`; these four are the rest of what the two have to agree on.

export function pdaPeek(store, queueMode = false) {
  if (!store || !store.length) return undefined;
  if (!Array.isArray(store)) return store.sym;
  return queueMode ? store[0] : store[store.length - 1];
}

export function pdaStoreToString(store, queueMode = false) {
  if (!store || !store.length) return App.config.sym.eps;
  const arr = storeArray(store);
  return queueMode ? arr.join('') : [...arr].reverse().join('');
}

/**
 * One move on a stack node: pop one symbol unless `pop` is ε, then push
 * `push` — its first character ends on top, as applyPdaStoreTransition has it.
 * O(|push|), and nothing below the top is touched.
 */
export function applyPdaStackMove(node, pop, push) {
  const { eps, any } = App.config.sym;
  let popped;
  if (pop !== eps && node.length) { popped = node.sym; node = node.below; }
  let pushStr = push && push !== eps ? push : '';
  if (pushStr === any) pushStr = popped || '';
  for (let i = pushStr.length - 1; i >= 0; i--) node = stackPush(node, pushStr[i]);
  return node;
}

function storeKey(store) {
  return Array.isArray(store) ? store.join('\u0001') : store.id;
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
  // A stack is a node in a trie this search owns (see stackPush). A queue
  // stays an array: it is taken from one end and added to at the other, and
  // no shared-tail structure makes both O(1) while keeping equal queues equal.
  const root = stackRoot();
  const cfg = {
    state: runStartId(),
    tokens,
    // A position into `tokens` rather than a copy of the unread suffix. The
    // suffix is what the reader is shown, but it is never anything other
    // than tokens.slice(pos) — see js/machines/step-log.js.
    pos: 0,
    stack: pdaUsesQueueStorage() ? [...baseStore] : baseStore.reduce((n, s) => stackPush(n, s), root),
    depth: 0,
    branch: 1,
    parent: null,
    via: null
  };
  if (pdaUsesSecondStack()) cfg.stack2 = baseStore.reduce((n, s) => stackPush(n, s), root);
  return cfg;
}

// The unread input is a suffix of one array that never changes during a run,
// so its *position* identifies it exactly — and identifying it that way is
// both cheaper to build and cheaper to compare than joining the suffix on
// every configuration the search touches. A stack node's id does the same for
// the stack: interned, so equal stacks share one.
export function pdaConfigKey(state, pos, stack, stack2 = null) {
  const second = stack2 != null ? `|${storeKey(stack2)}` : '';
  return `${state}|${pos}|${storeKey(stack)}${second}`;
}

/**
 * The visited set a pushdown search keeps: `seen(cfg)` adds the configuration
 * and answers whether it was new. Exactly pdaConfigKey's identity (plus the
 * PDT's output), held as integers — the state numbered, the stack by its node
 * id — so a configuration costs no string. A queue has no node, so its
 * contents are numbered through their join.
 */
export function pdaVisited() {
  const set = new ConfigSet();
  const stateNo = makeStateNumbering();
  let queues = null;
  const storeNo = st => {
    if (!Array.isArray(st)) return st.id;
    if (!queues) queues = new Map();
    const k = st.join('\u0001');
    let n = queues.get(k);
    if (n === undefined) queues.set(k, n = queues.size);
    return n;
  };
  return cfg => set.add(
    stateNo(cfg.state),
    cfg.pos,
    storeNo(cfg.stack),
    cfg.stack2 !== undefined ? storeNo(cfg.stack2) : -1,
    cfg.outKey !== undefined ? cfg.outKey.id : -1
  );
}

export function isPdaAcceptingConfig(cfg) {
  if (App.config.pdaParadigm === 'explicit') {
    return App.accepts.has(cfg.state) && cfg.pos >= cfg.tokens.length;
  }
  if (pdaUsesSecondStack()) {
    return cfg.pos >= cfg.tokens.length && cfg.stack.length === 0 && (cfg.stack2 || []).length === 0;
  }
  return cfg.pos >= cfg.tokens.length && cfg.stack.length === 0;
}

export function formatPdaInstantaneousDescription(cfg) {
  const stateName = getState(cfg.state)?.name || cfg.state;
  const remaining = cfg.pos < cfg.tokens.length ? cfg.tokens.slice(cfg.pos).join('') : App.config.sym.eps;
  const primary = pdaStoreToString(cfg.stack, pdaUsesQueueStorage());
  if (pdaUsesSecondStack()) {
    const secondary = pdaStoreToString(cfg.stack2 || []);
    return `(${stateName}, ${remaining}, ${primary}; ${secondary})`;
  }
  return `(${stateName}, ${remaining}, ${primary})`;
}

export function getMatchingPdaTransitions(cfg) {
  const { eps, any } = App.config.sym;
  const top = pdaPeek(cfg.stack, pdaUsesQueueStorage());
  const twoStacks = pdaUsesSecondStack();
  const top2 = twoStacks ? pdaPeek(cfg.stack2 || []) : undefined;
  const reading = cfg.pos < cfg.tokens.length;
  const next = reading ? cfg.tokens[cfg.pos] : undefined;
  const out = [];
  for (const t of transitionsFrom(cfg.state)) {
    const sym = t.symbol;
    if (sym !== eps && !(reading && (sym === next || sym === any))) continue;
    if (!canApplyPdaPop(top, t.pop)) continue;
    if (twoStacks && !canApplyPdaPop(top2, t.pop2 || eps)) continue;
    out.push(t);
  }
  return out;
}

const END_OF_INPUT = Symbol('end of input');

/**
 * getMatchingPdaTransitions for the length of one search, remembered.
 *
 * Which moves apply depends on the state, the next symbol and the top of each
 * store, and on nothing else — so a search asks δ once per combination it
 * meets rather than once per configuration, and a configuration costs a few
 * Map lookups instead of a pass over its state's edges and a fresh array. The
 * lists are shared between configurations: read them, never change them.
 */
export function pdaMatcher() {
  const memo = new Map();
  const queueMode = pdaUsesQueueStorage(), twoStacks = pdaUsesSecondStack();
  const level = (map, k) => {
    let next = map.get(k);
    if (next === undefined) map.set(k, next = new Map());
    return next;
  };
  return cfg => {
    const next = cfg.pos < cfg.tokens.length ? cfg.tokens[cfg.pos] : END_OF_INPUT;
    let tops = level(level(memo, cfg.state), next);
    if (twoStacks) tops = level(tops, pdaPeek(cfg.stack2 || []));
    const top = pdaPeek(cfg.stack, queueMode);
    let list = tops.get(top);
    if (list === undefined) tops.set(top, list = getMatchingPdaTransitions(cfg));
    return list;
  };
}

/** isPdaAcceptingConfig with its settings read once, for one search. */
export function pdaAcceptTest() {
  const explicit = App.config.pdaParadigm === 'explicit';
  const twoStacks = pdaUsesSecondStack();
  const accepts = App.accepts;
  if (explicit) return cfg => cfg.pos >= cfg.tokens.length && accepts.has(cfg.state);
  return cfg => cfg.pos >= cfg.tokens.length && cfg.stack.length === 0
    && (!twoStacks || (cfg.stack2 || []).length === 0);
}

export function applyPdaTransitionConfig(cfg, transition, branch = cfg.branch) {
  const eps = App.config.sym.eps;
  const pop = transition.pop || eps, push = transition.push || eps;
  const nextCfg = {
    state: transition.to,
    tokens: cfg.tokens,
    pos: transition.symbol === eps ? cfg.pos : cfg.pos + 1,
    stack: Array.isArray(cfg.stack)
      ? applyPdaStoreTransition(cfg.stack, pop, push, pdaUsesQueueStorage())
      : applyPdaStackMove(cfg.stack, pop, push),
    depth: cfg.depth + 1,
    branch,
    parent: cfg,
    via: transition
  };
  if (cfg.stack2 !== undefined) {
    const pop2 = transition.pop2 || eps, push2 = transition.push2 || eps;
    nextCfg.stack2 = Array.isArray(cfg.stack2)
      ? applyPdaStoreTransition(cfg.stack2, pop2, push2, false)
      : applyPdaStackMove(cfg.stack2, pop2, push2);
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
    // The store is shared rather than copied: a stack node is never changed
    // once made, and a queue's array is built fresh per configuration and
    // never mutated afterwards. `step.stack` spells it out when read (see
    // pdaStep); every reader downstream copies before reversing or joining.
    const props = {
      state: cfg.state,
      tokens: cfg.tokens,
      pos: cfg.pos,
      stackRef: cfg.stack,
      branch: cfg.branch,
      tid: cfg.via?.id,
      note: idx === 0 ? 'Start configuration' : formatPdaTransitionNote(path[idx - 1], cfg)
    };
    if (cfg.stack2 !== undefined) props.stackRef2 = cfg.stack2;
    // Present only for PDT; inert for every other pushdown family.
    if (cfg.outNode !== undefined) { props.outNode = cfg.outNode; props.outSoFar = cfg.outRaw; }
    return pdaStep(props);
  });
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept' ? ' — ACCEPT' : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

export function appendPdaSummaryStep(steps, cfg, finalStatus, note) {
  const props = {
    state: cfg.state,
    tokens: cfg.tokens,
    pos: cfg.pos,
    stackRef: cfg.stack,
    branch: cfg.branch,
    note,
    final: finalStatus
  };
  if (cfg.stack2 !== undefined) props.stackRef2 = cfg.stack2;
  steps.push(pdaStep(props));
}

export function simPDA(tokens) {
  const init = createInitialPdaConfig(tokens);
  if (isPdaAcceptingConfig(init)) {
    App.simSteps = buildPdaPathSteps([init], 'accept');
    App.simIdx = 0; renderSimStep();
    return { accepted: true };
  }

  let cfg = init;
  const seen = pdaVisited();
  const isAccepting = pdaAcceptTest(), matchesOf = pdaMatcher();
  seen(cfg);

  for (let step = 0; step < App.config.maxPdaSteps; step++) {
    const matching = matchesOf(cfg);
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
    if (!seen(nextCfg)) {
      App.simSteps = buildPdaPathSteps(traceSearchPath(cfg));
      appendPdaSummaryStep(App.simSteps, cfg, 'reject', 'Repeated configuration detected — possible ε-loop — REJECT');
      App.simIdx = 0; renderSimStep();
      return { accepted: false };
    }
    cfg = nextCfg;

    if (isAccepting(cfg)) {
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

// How many explored branches the search narrates. The narration is an HTML
// line per configuration, each carrying the configuration's instantaneous
// description — a join of the whole stack — and its one reader, the NPDA
// card in the algorithms view, shows the first ten. Formatting all of them
// was the most expensive thing a search did, for lines nobody could reach.
export const NPDA_LOG_KEEP = 10;

/**
 * Breadth-first search over the NPDA's configurations.
 *
 * `opts.log` is how many branches to narrate (NPDA_LOG_KEEP by default) and
 * `opts.witness` whether to rebuild the path to the deciding configuration.
 * A decider wants neither — see testNPDA — and a search that skips them
 * visits exactly the same configurations in exactly the same order.
 */
export function exploreNPDA(tokens, opts = {}) {
  const logKeep = opts.log ?? NPDA_LOG_KEEP;
  const wantWitness = opts.witness !== false;
  const init = createInitialPdaConfig(tokens);
  const queue = new Fifo([init]);
  const seen = pdaVisited();
  const isAccepting = pdaAcceptTest(), matchesOf = pdaMatcher();
  seen(init);
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
    const narrate = log.length < logKeep;
    const stateName = narrate ? (getState(cfg.state)?.name || cfg.state) : '';
    const idStr = narrate ? formatPdaInstantaneousDescription(cfg) : '';

    if (isAccepting(cfg)) {
      acceptedCfg = cfg;
      if (narrate) log.push(`<span class="step-acc">Branch ${cfg.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${cfg.depth}.<br>ID: ${idStr}</span>`);
      break;
    }

    const matching = matchesOf(cfg);
    if (!matching.length) {
      if (narrate) log.push(`Branch ${cfg.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${idStr}.<br>Depth ${cfg.depth}</span>`);
      continue;
    }

    if (narrate) narrateBranch(log, cfg, stateName, idStr, matching);

    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyPdaTransitionConfig(cfg, transition, childBranch);
      if (seen(nextCfg)) queue.push(nextCfg);
    });
  }

  return {
    accepted: !!acceptedCfg,
    branches,
    maxDepth,
    log,
    witnessPath: wantWitness ? traceSearchPath(acceptedCfg || lastExplored) : null,
    finalCfg: acceptedCfg || lastExplored,
    unresolved: !acceptedCfg && queue.length > 0
  };
}

function narrateBranch(log, cfg, stateName, idStr, matching) {
  const nextRead = cfg.tokens[cfg.pos] || App.config.sym.eps;
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
  const seen = pdaVisited();
  const isAccepting = pdaAcceptTest(), matchesOf = pdaMatcher();
  seen(cfg);

  for (let step = 0; step < App.config.maxPdaSteps; step++) {
    const matching = matchesOf(cfg);
    if (matching.length !== 1) return false;
    const nextCfg = applyPdaTransitionConfig(cfg, matching[0], cfg.branch);
    if (!seen(nextCfg)) return false;
    cfg = nextCfg;
    if (isAccepting(cfg)) return true;
  }

  return false;
}

export function testNPDA(tokens) {
  // A verdict needs the search and nothing it narrates.
  return exploreNPDA(tokens, { log: 0, witness: false }).accepted;
}

// ══════════════════════════════════════════════════════════════════
//  PUSHDOWN TRANSDUCER
// ══════════════════════════════════════════════════════════════════
// A PDT is a PDA that also prints, so it reuses the PDA configuration
// machinery wholesale and only extends the config with the emitted string.
// Two runs reaching the same (state, input, stack) with different output are
// genuinely different configurations, so the output joins the visited key —
// the same reason exploreFST keys on its own output.
//
// It joins as `outKey`, an interned node per character of the output so far
// (outputKeyAfter), rather than as the string itself: the string grows with
// the run, and keying on it made every configuration cost the whole output —
// quadratic in the word, and out of memory on a 2,000-symbol one.
export function pdtConfigKey(cfg) {
  return `${pdaConfigKey(cfg.state, cfg.pos, cfg.stack, cfg.stack2)}|${cfg.outKey.id}`;
}

export function applyPdtTransitionConfig(cfg, transition, branch) {
  const next = applyPdaTransitionConfig(cfg, transition, branch);
  const rawOut = transition.output ?? '';
  next.outRaw = (cfg.outRaw || '') + rawOut;
  next.outKey = outputKeyAfter(cfg.outKey, rawOut);
  next.outNode = outPush(cfg.outNode, rawOut === '' ? App.config.sym.lambda : rawOut);
  return next;
}

export function explorePDT(tokens) {
  const init = createInitialPdaConfig(tokens);
  init.outRaw = '';
  init.outKey = stackRoot();
  init.outNode = OUT_EMPTY;
  const queue = new Fifo([init]);
  const seen = pdaVisited();
  const isAccepting = pdaAcceptTest(), matchesOf = pdaMatcher();
  seen(init);
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

    const accepting = isAccepting(cfg);
    if (cfg.pos >= cfg.tokens.length) {
      if (transducerRunContributes(true, accepting)) outputs.add(cfg.outRaw);
      if (!completedCfg) completedCfg = cfg;
    }
    // No early break, for the same reason as exploreFST: the relation is the
    // set of outputs over accepting runs, not just the first one found.
    if (accepting && !acceptedCfg) acceptedCfg = cfg;

    const matching = matchesOf(cfg);
    if (!matching.length) continue;
    matching.forEach((transition, idx) => {
      const childBranch = matching.length === 1 || idx === 0 ? cfg.branch : nextBranchId++;
      const nextCfg = applyPdtTransitionConfig(cfg, transition, childBranch);
      if (seen(nextCfg)) queue.push(nextCfg);
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
