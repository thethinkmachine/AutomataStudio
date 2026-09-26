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
import { ConfigSet, Fifo, accepted, makeStateNumbering, traceSearchPath, transitionsFrom } from './runtime.js';
import { attachBranchTree, newBranchTree } from './branch-tree.js';
import { NPDA_LOG_KEEP } from './pushdown.js';
import { defineMachine } from './registry.js';
import { epdaStep, stackArray, stackPush, stackRoot } from './step-log.js';

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

// ── the store a search holds ──────────────────────────────────────
// A search holds the store as a stack node (js/machines/step-log.js) whose
// symbols are themselves stack nodes: the inner stacks live in one trie and
// the store in another, both interned, so a move rebuilds only the stacks it
// touches and a store is named exactly by its node's id. The arrays above are
// what a step shows and what the tests write by hand; `epdaStoreArrays` is the
// way from one to the other.

export function epdaStoreArrays(store) {
  return Array.isArray(store) ? store : stackArray(store).map(stackArray);
}

export function createInitialEpdaConfig(tokens) {
  const explicit = App.config.pdaParadigm === 'explicit';
  const inner = stackRoot();
  const first = explicit ? stackPush(inner, App.config.sym.stackBottom) : inner;
  return {
    state: runStartId(),
    tokens,
    pos: 0,
    store: stackPush(stackRoot(), first),
    // Per search: the inner stacks' trie, and each written stack list and
    // push parsed once rather than once per configuration.
    ctx: { inner, lists: new Map(), pushes: new Map() },
    depth: 0,
    branch: 1,
    parent: null,
    via: null
  };
}

export function epdaConfigKey(state, pos, store) {
  const named = Array.isArray(store) ? store.map(s => s.join('\u0001')).join('\u0002') : store.id;
  return `${state}|${pos}|${named}`;
}

export function isEpdaAcceptingConfig(cfg) {
  if (cfg.pos < cfg.tokens.length) return false;
  if (App.config.pdaParadigm === 'explicit') return App.accepts.has(cfg.state);
  // "Empty store" here means every stack empty, which after normalization is
  // the one surviving stack being empty.
  return cfg.store.length === 1 && cfg.store.sym.length === 0;
}

function popApplies(top, pop) {
  const { eps, any } = App.config.sym;
  if (pop === eps) return true;
  return top !== undefined && (pop === top || pop === any);
}

export function getMatchingEpdaTransitions(cfg) {
  const eps = App.config.sym.eps;
  const any = App.config.sym.any;
  const top = cfg.store.sym.sym;
  return transitionsFrom(cfg.state).filter(t => {
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
  const ctx = cfg.ctx;
  let top = cfg.store.sym;

  let popped;
  if ((t.pop || eps) !== eps && top.length) { popped = top.sym; top = top.below; }
  let pushStr = t.push && t.push !== eps ? t.push : '';
  if (pushStr === any) pushStr = popped || '';
  if (pushStr) {
    const syms = parsedPush(ctx, pushStr);
    for (let i = syms.length - 1; i >= 0; i--) top = stackPush(top, syms[i]);
  }

  // Everything under the top stack is kept as it is; `below`, the rewritten
  // top and `above` go on in that order.
  let store = cfg.store.below;
  for (const st of stackList(ctx, t.below)) store = stackPush(store, st);
  store = stackPush(store, top);
  for (const st of stackList(ctx, t.above)) store = stackPush(store, st);
  // normalizeStore's rule: an emptied stack on top is discarded, and one
  // stack always survives.
  while (store.length > 1 && store.sym.length === 0) store = store.below;

  return {
    state: t.to,
    tokens: cfg.tokens,
    pos: t.symbol === eps ? cfg.pos : cfg.pos + 1,
    store,
    ctx,
    depth: cfg.depth + 1,
    branch,
    parent: cfg,
    via: t
  };
}

function parsedPush(ctx, raw) {
  let syms = ctx.pushes.get(raw);
  if (!syms) ctx.pushes.set(raw, syms = epdaSymbols(raw));
  return syms;
}

// A written `below`/`above` list as inner stack nodes, bottom stack first.
function stackList(ctx, raw) {
  const k = raw ?? '';
  let list = ctx.lists.get(k);
  if (!list) {
    list = parseStackList(raw).map(st => st.reduce((n, sym) => stackPush(n, sym), ctx.inner));
    ctx.lists.set(k, list);
  }
  return list;
}

export function formatEpdaId(cfg) {
  const name = getState(cfg.state)?.name || cfg.state;
  const rest = cfg.pos < cfg.tokens.length ? cfg.tokens.slice(cfg.pos).join('') : App.config.sym.eps;
  return `(${name}, ${rest}, ${storeToString(epdaStoreArrays(cfg.store))})`;
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
  const steps = path.map((cfg, i) => epdaStep({
    state: cfg.state,
    tokens: cfg.tokens,
    pos: cfg.pos,
    // The store's node is shared rather than copied — a node never changes
    // once made — and `step.store` / `step.stack` spell it out when read.
    storeRef: cfg.store,
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
  steps.push(epdaStep({
    state: cfg.state,
    tokens: cfg.tokens,
    pos: cfg.pos,
    storeRef: cfg.store,
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

// A store node's `size` is the symbols in all of its stacks, kept as it is built.
function withinBudget(store, budget) {
  return store.length <= budget.stacks && store.size <= budget.symbols;
}

/**
 * Breadth-first search over the EPDA's configurations. `opts.log` is how many
 * branches to narrate and `opts.witness` whether to rebuild the path — the
 * options exploreNPDA takes, for the reason it takes them: the narration is
 * a whole store spelled out per configuration, and a verdict needs none of it.
 */
export function exploreEPDA(tokens, opts = {}) {
  const logKeep = opts.log ?? NPDA_LOG_KEEP;
  const wantWitness = opts.witness !== false;
  const tree = opts.tree || null;
  const init = createInitialEpdaConfig(tokens);
  const queue = new Fifo([init]);
  // epdaConfigKey's identity, held as integers — see pdaVisited.
  const visited = new ConfigSet(), stateNo = makeStateNumbering();
  const seen = c => visited.add(stateNo(c.state), c.pos, c.store.id, -1, -1);
  seen(init);
  if (tree) tree.root(init.state, init);
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

    const narrate = log.length < logKeep;
    if (isEpdaAcceptingConfig(cfg)) {
      acceptedCfg = cfg;
      if (tree) tree.accept(cfg.tn);
      if (narrate) log.push(`<span class="step-acc">Branch ${cfg.branch}: ACCEPT ✓</span><span class="step-sub">Accepted at depth ${cfg.depth}.<br>ID: ${formatEpdaId(cfg)}</span>`);
      break;
    }

    const matching = getMatchingEpdaTransitions(cfg);
    if (!matching.length) {
      if (tree) tree.expandCfgs(cfg, []);
      if (narrate) log.push(`Branch ${cfg.branch}: <span class="step-dead">stuck</span><span class="step-sub">No transition matches ${formatEpdaId(cfg)}.<br>Depth ${cfg.depth}</span>`);
      continue;
    }

    if (narrate) {
      const name = getState(cfg.state)?.name || cfg.state;
      const subs = [
        `State "${name}" with next input '${cfg.tokens[cfg.pos] || App.config.sym.eps}'`,
        `Depth ${cfg.depth} · ${cfg.store.length} stack${cfg.store.length === 1 ? '' : 's'} · top ${cfg.store.sym.sym || App.config.sym.eps}`,
        `ID: ${formatEpdaId(cfg)}`
      ];
      if (matching.length > 1) subs.push(`Nondeterministic choice: ${matching.length} matching transitions.`);
      log.push(`Branch ${cfg.branch}: exploring <em>${name}</em><span class="step-sub">${subs.join('<br>')}</span>`);
    }

    const kids = tree && !tree.full ? [] : null;
    matching.forEach((t, i) => {
      const childBranch = matching.length === 1 || i === 0 ? cfg.branch : nextBranch++;
      const nextCfg = applyEpdaTransition(cfg, t, childBranch);
      if (!withinBudget(nextCfg.store, budget)) { capped = true; return; }
      const fresh = seen(nextCfg);
      if (fresh) queue.push(nextCfg);
      if (kids) kids.push({ cfg: nextCfg, fresh });
    });
    if (kids) tree.expandCfgs(cfg, kids);
  }

  if (tree) tree.finish((acceptedCfg || last).tn ?? -1);

  return {
    accepted: !!acceptedCfg,
    branches,
    maxDepth,
    maxStacks,
    log,
    capped,
    witnessPath: wantWitness ? traceSearchPath(acceptedCfg || last) : null,
    finalCfg: acceptedCfg || last,
    unresolved: !acceptedCfg && (queue.length > 0 || capped)
  };
}

export function simEPDA(tokens) {
  const tree = newBranchTree('path');
  const res = exploreEPDA(tokens, { tree });
  if (res.accepted) {
    App.simSteps = buildEpdaSteps(res.witnessPath, 'accept');
  } else {
    App.simSteps = buildEpdaSteps(res.witnessPath);
    appendEpdaSummary(App.simSteps, res.finalCfg, 'reject',
      res.unresolved
        ? `Exploration limit ${App.config.maxPdaSteps} reached — unresolved branches remain`
        : 'All branches halted without acceptance — REJECT');
  }
  attachBranchTree(App.simSteps, tree);
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
  const res = exploreEPDA(tokens, { log: 0, witness: false });
  if (res.accepted) return { verdict: 'acc', output: null };
  return { verdict: res.capped ? 'unk' : 'rej', output: null };
}

export function testEPDA(tokens) {
  return exploreEPDA(tokens, { log: 0, witness: false }).accepted;
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
  branches: true,
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
