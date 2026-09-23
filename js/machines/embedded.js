// ══════════════════════════════════════════════════════════════════
//  EMBEDDED MACHINES — the EPDA
// ══════════════════════════════════════════════════════════════════
// The automaton that recognises exactly the tree-adjoining languages (the
// `tag` page in js/concept-guide.js explains the class). It is a family of
// its own rather than a pushdown machine with an extra field, and the reason
// is the store: a PDA's is an array of symbols and every one of
// applyPdaStoreTransition / pdaPeek / pdaStoreToString is written against
// that shape. Here the store is a **stack of stacks**, so every one of
// those would have needed a second meaning. `isAnyPDA` stays exactly the
// set of machines whose store is one array.
//
// ── Why a stack of stacks is the right amount of extra power ──────
// A PDA can hold one unbounded count, which is why aⁿbⁿ is context-free
// and aⁿbⁿcⁿ is not. Two *independent* stacks is too much — the app's own
// 2PDA is Turing-equivalent, and the reference guide for it says so. What
// an EPDA has instead is one stack whose *elements are stacks*, and the
// discipline is that only the topmost is reachable: a nested computation
// must finish and be discarded before the one under it resumes. That is
// exactly the shape of adjunction — an auxiliary tree spliced into another
// tree is a computation that opens, runs to completion, and hands control
// back to where it interrupted — and it is what makes the machine
// recognise the tree-adjoining languages and nothing more.
//
// It is nondeterministic and explores, for the same reason NPDA does: its
// store admits several moves from one configuration, and the languages it
// is for are not deterministic ones.

import { App, getState, runStartId } from '../state.js';
import { renderSimStep } from './paint.js';
import { accepted, traceSearchPath } from './runtime.js';
import { defineMachine } from './registry.js';
import { wordStep } from './step-log.js';

/** Stacks within a store, and stacks within a `below`/`above` list. */
export const STACK_SEP = '|';

// ══════════════════════════════════════════════════════════════════
//  EPDA
// ══════════════════════════════════════════════════════════════════

/**
 * A written stack → its symbols, top-first.
 *
 * **Whitespace, where there is any, separates symbols; where there is none,
 * every character is one.** A PDA's stack alphabet is single characters and
 * `AZ` is two symbols, which is the rule the whole app already follows and
 * which stays the default here. But a machine whose store holds *tree nodes*
 * needs names that are words, so an embedded machine that writes its symbols
 * apart is read that way, and one that does not is read exactly as a PDA's
 * would be.
 */
export function epdaSymbols(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    // A bracket form is always exactly one symbol — the same rule, and the
    // same reason, as js/grammar/parse.js's: it is how a name too long to be
    // a character is written, and a machine mirroring a grammar stores tree
    // nodes, whose names are words. Whitespace alone cannot carry it, because
    // one symbol on its own has no whitespace in it to find.
    if (ch === '<') {
      const j = s.indexOf('>', i + 1);
      if (j > 0) { out.push(s.slice(i, j + 1)); i = j + 1; continue; }
    }
    if (/\s/.test(s)) {
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      out.push(s.slice(i, j));
      i = j;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out;
}

/** Symbols back to a written stack, spaced only when it would otherwise read wrong. */
export function epdaSymbolsToString(syms) {
  return syms.some(x => String(x).length > 1) ? syms.join(' ') : syms.join('');
}

/** A name too long to be a character, written so it reads back as one symbol. */
export function epdaSymbolOf(name) {
  return `<${String(name).replace(/[<>|\s]/g, '_')}>`;
}

/**
 * A `|`-separated list of stacks, each written top-first the way `push` is.
 *
 * Empty entries are dropped rather than kept as empty stacks: an empty
 * stack on top is discarded by `normalizeStore` on the next move anyway, so
 * writing one would be a stack that exists for no step of the run.
 */
export function parseStackList(raw) {
  const eps = App.config.sym.eps;
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s === eps) return [];
  return s.split(STACK_SEP)
    .map(part => part.trim())
    .filter(part => part && part !== eps)
    // Top-first in, bottom-first out — the same convention `push` uses, and
    // the reason it is reversed here rather than at every read.
    .map(part => epdaSymbols(part).reverse());
}

export function formatStackList(stacks) {
  const eps = App.config.sym.eps;
  if (!stacks || !stacks.length) return eps;
  return stacks.map(st => epdaSymbolsToString([...st].reverse())).join(STACK_SEP);
}

/**
 * The store with empty stacks on top discarded — **the rule that lets an
 * embedded computation finish.**
 *
 * An EPDA can only ever act on the topmost stack, so a stack emptied to its
 * last symbol would strand the machine for good: there is no move whose
 * left-hand side is "the top stack is empty". Discarding it is the standard
 * convention and it is what makes "open a stack, work in it, leave" a thing
 * the machine can do at all. One stack always survives, so a store is never
 * an empty sequence and `epdaTop` never has to ask.
 *
 * A reader who wants a stack that outlives being emptied writes a bottom
 * marker onto it, which is the same idiom the PDA's Z₀ already is.
 */
export function normalizeStore(store) {
  const out = store.map(s => s);
  while (out.length > 1 && out[out.length - 1].length === 0) out.pop();
  return out;
}

export function epdaTop(store) {
  const top = store[store.length - 1];
  return top && top.length ? top[top.length - 1] : undefined;
}

export function storeToString(store) {
  const eps = App.config.sym.eps;
  if (!store.length) return eps;
  return store
    .map(st => (st.length ? epdaSymbolsToString([...st].reverse()) : eps))
    .join(' ' + STACK_SEP + ' ');
}

export function createInitialEpdaConfig(tokens) {
  const explicit = App.config.pdaParadigm === 'explicit';
  return {
    state: runStartId(),
    tokens,
    pos: 0,
    store: [explicit ? [App.config.sym.stackBottom] : []],
    depth: 0,
    branch: 1,
    parent: null,
    via: null
  };
}

export function epdaConfigKey(state, pos, store) {
  return `${state}|${pos}|${store.map(s => s.join('')).join('')}`;
}

export function isEpdaAcceptingConfig(cfg) {
  if (cfg.pos < cfg.tokens.length) return false;
  if (App.config.pdaParadigm === 'explicit') return App.accepts.has(cfg.state);
  // "Empty store" here means every stack empty, which after normalization is
  // the one surviving stack being empty.
  return cfg.store.length === 1 && cfg.store[0].length === 0;
}

function popApplies(top, pop) {
  const { eps, any } = App.config.sym;
  if (pop === eps) return true;
  return top !== undefined && (pop === top || pop === any);
}

export function getMatchingEpdaTransitions(cfg) {
  const eps = App.config.sym.eps;
  const any = App.config.sym.any;
  const top = epdaTop(cfg.store);
  return App.transitions.filter(t => {
    if (t.from !== cfg.state) return false;
    const readOk = t.symbol === eps
      || (cfg.pos < cfg.tokens.length && (t.symbol === cfg.tokens[cfg.pos] || t.symbol === any));
    return readOk && popApplies(top, t.pop || eps);
  });
}

/**
 * One EPDA move.
 *
 * The topmost stack is rewritten as a PDA would rewrite its only one, and
 * the new stacks named by `below` and `above` are inserted either side of
 * it — which is the whole of the move. `above` is what opens an embedded
 * computation (the machine will be working in the last of those next),
 * `below` is what parks one to be resumed after the current stack is gone.
 */
export function applyEpdaTransition(cfg, t, branch = cfg.branch) {
  const { eps, any } = App.config.sym;
  const store = cfg.store;
  const topStack = [...(store[store.length - 1] || [])];

  let popped;
  if ((t.pop || eps) !== eps) popped = topStack.pop();
  let pushStr = t.push && t.push !== eps ? t.push : '';
  if (pushStr === any) pushStr = popped || '';
  if (pushStr) epdaSymbols(pushStr).reverse().forEach(s => topStack.push(s));

  const next = [
    ...store.slice(0, -1),
    ...parseStackList(t.below),
    topStack,
    ...parseStackList(t.above)
  ];

  return {
    state: t.to,
    tokens: cfg.tokens,
    pos: t.symbol === eps ? cfg.pos : cfg.pos + 1,
    store: normalizeStore(next),
    depth: cfg.depth + 1,
    branch,
    parent: cfg,
    via: t
  };
}

export function formatEpdaId(cfg) {
  const name = getState(cfg.state)?.name || cfg.state;
  const rest = cfg.pos < cfg.tokens.length ? cfg.tokens.slice(cfg.pos).join('') : App.config.sym.eps;
  return `(${name}, ${rest}, ${storeToString(cfg.store)})`;
}

function epdaNote(prev, next) {
  const t = next.via;
  const eps = App.config.sym.eps;
  const from = getState(prev.state)?.name || prev.state;
  const to = getState(next.state)?.name || next.state;
  const parts = [`(${from}, ${t?.symbol || eps}, ${t?.pop || eps}) → (${to}, ${t?.push || eps}`];
  const below = parseStackList(t?.below);
  const above = parseStackList(t?.above);
  if (below.length) parts.push(`, ${below.length} below`);
  if (above.length) parts.push(`, ${above.length} above`);
  parts.push(')');
  return `Branch ${next.branch} depth ${next.depth}: ${parts.join('')} · ${next.store.length} stack${next.store.length === 1 ? '' : 's'}`;
}

export function buildEpdaSteps(path, finalStatus = null, finalNote = '') {
  const steps = path.map((cfg, i) => wordStep({
    state: cfg.state,
    tokens: cfg.tokens,
    pos: cfg.pos,
    // The store is rebuilt per configuration and nothing mutates one
    // afterwards, so it is shared rather than copied — the rule
    // buildPdaPathSteps already states for a stack.
    store: cfg.store,
    stack: cfg.store[cfg.store.length - 1] || [],
    branch: cfg.branch,
    tid: cfg.via?.id,
    note: i === 0 ? 'Start configuration' : epdaNote(path[i - 1], cfg)
  }));
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept' ? ' — ACCEPT' : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

function appendEpdaSummary(steps, cfg, finalStatus, note) {
  steps.push(wordStep({
    state: cfg.state,
    tokens: cfg.tokens,
    pos: cfg.pos,
    store: cfg.store,
    stack: cfg.store[cfg.store.length - 1] || [],
    branch: cfg.branch,
    note,
    final: finalStatus
  }));
}

/**
 * How big the store may get before a branch is abandoned.
 *
 * **An EPDA can open stacks without reading anything**, so a machine with
 * an ε-move that inserts a stack has an infinite chain of moves that consume
 * no input — the configuration space is genuinely infinite and a search over
 * it genuinely does not terminate. That is a property of the model, not of
 * this implementation, and it is why a budget is the honest answer rather
 * than a cleverer search.
 *
 * The bound is drawn against the *word* rather than against the machine,
 * because that is what a sensible run's store is bounded by: a machine that
 * mirrors a tree-adjoining grammar opens a stack per adjunction, and every
 * adjunction with something in its yield consumes at least one symbol. A
 * machine that can grow its store while reading nothing is the case this
 * cannot decide, and `capped` is how a run says so instead of reporting a
 * rejection it did not establish.
 */
export function epdaStoreBudget(tokens = []) {
  const n = tokens.length + 2;
  return { stacks: n + 4, symbols: 16 * (n + 4) };
}

function withinBudget(store, budget) {
  if (store.length > budget.stacks) return false;
  let total = 0;
  for (const st of store) {
    total += st.length;
    if (total > budget.symbols) return false;
  }
  return true;
}

export function exploreEPDA(tokens) {
  const init = createInitialEpdaConfig(tokens);
  const queue = [init];
  const visited = new Set([epdaConfigKey(init.state, init.pos, init.store)]);
  const log = [];
  let acceptedCfg = null;
  let branches = 0;
  let maxDepth = 0;
  let maxStacks = 1;
  let last = init;
  let nextBranch = 2;
  const budget = epdaStoreBudget(tokens);
  let capped = false;

  while (queue.length && branches < App.config.maxPdaSteps) {
    const cfg = queue.shift();
    last = cfg;
    branches++;
    maxDepth = Math.max(maxDepth, cfg.depth);
    maxStacks = Math.max(maxStacks, cfg.store.length);

    if (isEpdaAcceptingConfig(cfg)) {
      acceptedCfg = cfg;
      log.push(`<span class="step-acc">Branch ${cfg.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${cfg.depth}.<br>ID: ${formatEpdaId(cfg)}</span>`);
      break;
    }

    const matching = getMatchingEpdaTransitions(cfg);
    if (!matching.length) {
      log.push(`Branch ${cfg.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${formatEpdaId(cfg)}.<br>Depth ${cfg.depth}</span>`);
      continue;
    }

    const name = getState(cfg.state)?.name || cfg.state;
    const subs = [
      `State "${name}" with next input '${cfg.tokens[cfg.pos] || App.config.sym.eps}'`,
      `Depth ${cfg.depth} · ${cfg.store.length} stack${cfg.store.length === 1 ? '' : 's'} · top ${epdaTop(cfg.store) || App.config.sym.eps}`,
      `ID: ${formatEpdaId(cfg)}`
    ];
    if (matching.length > 1) subs.push(`Nondeterministic choice: ${matching.length} matching transitions.`);
    log.push(`Branch ${cfg.branch}: exploring <em>${name}</em><span class="step-sub">${subs.join('<br>')}</span>`);

    matching.forEach((t, i) => {
      const childBranch = matching.length === 1 || i === 0 ? cfg.branch : nextBranch++;
      const nextCfg = applyEpdaTransition(cfg, t, childBranch);
      if (!withinBudget(nextCfg.store, budget)) { capped = true; return; }
      const key = epdaConfigKey(nextCfg.state, nextCfg.pos, nextCfg.store);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push(nextCfg);
    });
  }

  return {
    accepted: !!acceptedCfg,
    branches,
    maxDepth,
    maxStacks,
    log,
    capped,
    witnessPath: traceSearchPath(acceptedCfg || last),
    finalCfg: acceptedCfg || last,
    unresolved: !acceptedCfg && (queue.length > 0 || capped)
  };
}

export function simEPDA(tokens) {
  const res = exploreEPDA(tokens);
  if (res.accepted) {
    App.simSteps = buildEpdaSteps(res.witnessPath, 'accept');
  } else {
    App.simSteps = buildEpdaSteps(res.witnessPath);
    appendEpdaSummary(App.simSteps, res.finalCfg, 'reject',
      res.unresolved
        ? `Exploration limit ${App.config.maxPdaSteps} reached — unresolved branches remain`
        : 'All branches halted without acceptance — REJECT');
  }
  App.simIdx = 0;
  renderSimStep();
  return res;
}

/**
 * The verdict, three-valued.
 *
 * A search that was cut short establishes nothing about the branches it did
 * not take, so it answers `unk` rather than `rej` — the same call
 * js/machines/twoway.js makes for a head that never halts. Reporting a
 * rejection there would be the machine claiming a result it has not got.
 */
export function decideEPDA(tokens) {
  const res = exploreEPDA(tokens);
  if (res.accepted) return { verdict: 'acc', output: null };
  return { verdict: res.capped ? 'unk' : 'rej', output: null };
}

export function testEPDA(tokens) {
  return exploreEPDA(tokens).accepted;
}

// ══════════════════════════════════════════════════════════════════
//  THE DEFINITIONS
// ══════════════════════════════════════════════════════════════════

const embedded = {
  family: 'embedded',
  schema: {
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma', 'stackAlpha']
  }
};

defineMachine('EPDA', {
  ...embedded,
  storeLabels: ['Stack of stacks', 'Pop', 'Push'],
  schema: {
    ...embedded.schema,
    transitionFields: ['from', 'to', 'on', 'pop', 'push', 'below', 'above']
  },
  simulate: simEPDA,
  decide: tokens => decideEPDA(tokens),
  formal: {
    tuple: () => (App.config.pdaParadigm === 'explicit'
      ? ['Q', 'Σ', 'Γ', 'δ', 'q₀', 'Z₀', 'F']
      : ['Q', 'Σ', 'Γ', 'δ', 'q₀']),
    // Υ is a sequence of stacks, which is what the codomain carries two of:
    // the stacks inserted below the topmost and the ones inserted above it.
    delta: () => 'Q × (Σ ∪ {ε}) × Γ → P(Q × Υ* × Γ* × Υ*)',
    storeSay: 'stack alphabet'
  }
});
