// ══════════════════════════════════════════════════════════════════
//  WHAT THE LIBRARY KNOWS ABOUT A MACHINE, AND HOW IT KNOWS
// ══════════════════════════════════════════════════════════════════
// The library's badges are earned, not declared: every one of them is the answer
// to a question this module asked the machine by running it. The library's CI
// imports this file (scripts/library/build.mjs), and so does the app — the
// submit dialog runs the same checks on the machine on the canvas before
// anything is filed, and the listing's "try it" box decides words with it. One
// implementation is what keeps "the CI will award this" and "the CI awarded
// this" the same sentence.
//
// Nothing here touches the canvas. A machine is analysed as a *target* — the
// grader's shape, `{ kind: 'machine', machine, states, transitions, … }` — and
// every question that needs the machine layer borrows App through
// `withMachine`, which swaps the target in and restores the reader's machine in
// a `finally`. That is how the exercise grader already decides a sealed
// reference on the main thread, and why it is safe: assigning App's Set fields
// replaces the ReactiveSet behind the accessor without notifying, so no panel
// recomputes against the borrowed machine.
//
// Each question answers `null` rather than a guess when it cannot be asked of
// this machine — a minimal DFA of a PDA, a halting proof for an NFA. An entry
// carries no badge it did not earn, and no badge because a check was skipped.

import { App, MachineCategories, MachineTypes, getMachineConfig } from '../state.js';
import {
  decideMachine, decideWord, machineDef, machineDeterminism, machineGuards, parseMachineInput, streamMachine
} from '../machines/index.js';
import { withPainterSuppressed } from '../machines/paint.js';
import { BEHAVIOUR_MACHINES, classifyBehaviourNow, compileBehaviourMachine } from '../machines/tm-behaviour.js';
import { subsetSide, withMachine } from '../exercise/grade.js';
import { writeStandardTM } from '../interop/standard-tm.js';
import { migrateWorkspaceDoc, normalizeMachineType, validateSchema } from '../persistence.js';
import { thumbBounds, thumbEdgePairs, thumbEdgePath, thumbEdgeSegments, thumbFit, thumbNodeRadius } from '../graph-thumb.js';
import { canonicalCodeOf, hash64, machineIdOf } from './hash.js';
import { unsealTarget } from '../exercise/model.js';
import { drawSketch, packSketch, sketchAspect, sketchFromTarget } from './sketch.js';
import { isLibraryId } from './config.js';

// ── Limits ────────────────────────────────────────────────────────
//  A library entry is something a person reads and a CI runner analyses on
//  every push, so both have a ceiling. Generous for teaching machines, and
//  far above anything the bundled examples reach.
export const LIBRARY_LIMITS = {
  bytes: 1_500_000,
  states: 2000,
  transitions: 20000,
  // The card's own limits (js/machine-card.js), so an entry reads the same in
  // the library and on the canvas. A longer write-up is the entry's essay; meta.library.readme is the
  // short notes older entries carry instead, still read and shown.
  inputs: 12,
  tags: 12,
  titleMax: 70,
  blurbMax: 400,
  readmeMax: 4000,
  subsetStates: 4096,
  behaviourBudget: 2e8
};

/** Licences a submission may carry. Both let the library redistribute it with credit. */
export const LIBRARY_LICENSES = {
  'CC-BY-4.0': 'Creative Commons Attribution 4.0',
  'CC0-1.0': 'Public domain (CC0 1.0)'
};

const SEMANTIC_CONFIG = ['pdaParadigm', 'twoWayTape', 'pfaCutPoint', 'transducerAccepts'];
const EXACT = new Set(['DFA', 'NFA', 'ε-NFA']);
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

// ── A document as a target ────────────────────────────────────────

/**
 * A parsed workspace document → the grader's target shape, migrated and with
 * its type re-derived the way the load path re-derives it. The document's own
 * symbols travel in `config.sym`: withMachine merges `config` over App's, so a
 * machine drawn with a different blank or ε is read with its own spelling,
 * whatever the reader has configured.
 */
export function targetFromDoc(doc) {
  const d = migrateWorkspaceDoc(doc);
  const machine = normalizeMachineType(d);
  const config = {};
  for (const k of SEMANTIC_CONFIG) if (d.config && d.config[k] !== undefined) config[k] = d.config[k];
  config.sym = { ...App.config.sym, ...(d.config?.sym || {}) };
  return {
    kind: 'machine',
    machine,
    states: (d.states || []).map(s => ({ ...s })),
    transitions: (d.transitions || []).map(t => ({ ...t })),
    startId: d.startId || null,
    accepts: [...(d.accepts || [])],
    sigma: [...(d.sigma || [])],
    stackAlpha: [...(d.stackAlpha || [])],
    outputAlpha: [...(d.outputAlpha || [])],
    tapeCount: d.tapeCount || 1,
    blocks: JSON.parse(JSON.stringify(d.blocks || [])),
    config
  };
}

const symOf = target => target.config?.sym || App.config.sym;

// ── Deciding a word ───────────────────────────────────────────────

/**
 * The run box's text → a verdict, for a machine that is not on the canvas.
 * Guards are honoured the way the player honours them: a refusal is an error,
 * not a reject, because "this D-type branches" says nothing about the word.
 */
export function decideRaw(target, raw) {
  return withMachine(target, () => {
    try {
      const parsed = parseMachineInput(target.machine, String(raw ?? ''));
      if (!parsed.ok) return { verdict: 'err', error: parsed.error };
      const refusal = machineGuards(target.machine, parsed.input).find(g => g.refuse);
      if (refusal) return { verdict: 'err', error: refusal.message || refusal.say || 'This machine cannot be run as drawn.' };
      const r = decideMachine(target.machine, parsed.input) || { verdict: 'unk', output: null };
      return { verdict: r.verdict, output: r.output ?? null };
    } catch (e) {
      return { verdict: 'err', error: e?.message || String(e) };
    }
  });
}

/** An output as the card writes it: symbols run together, spacing ignored. */
export function outputText(out) {
  if (out == null) return '';
  if (Array.isArray(out)) return out.map(outputText).join('');
  return String(out).replace(/\s+/g, '');
}

/**
 * Run every example the author declared on the card (`meta.inputs`) and say
 * which ones hold. A row with no `expect` and no `out` claims nothing and is
 * skipped rather than counted as a pass.
 */
export function runDeclaredTests(target, inputs) {
  const rows = (Array.isArray(inputs) ? inputs : []).slice(0, LIBRARY_LIMITS.inputs);
  const failures = [];
  let accepts = 0, rejects = 0, outputs = 0, checked = 0;
  for (const row of rows) {
    if (!row || typeof row.w !== 'string') continue;
    const wantVerdict = row.expect === 'accept' ? 'acc' : row.expect === 'reject' ? 'rej' : null;
    const wantOut = typeof row.out === 'string' ? outputText(row.out) : null;
    if (!wantVerdict && wantOut === null) continue;
    const got = decideRaw(target, row.w);
    checked++;
    if (got.verdict === 'err') { failures.push({ w: row.w, want: row.expect || `→ ${row.out}`, got: got.error }); continue; }
    if (wantVerdict) {
      if (got.verdict !== wantVerdict) {
        failures.push({ w: row.w, want: row.expect, got: got.verdict === 'acc' ? 'accept' : got.verdict === 'rej' ? 'reject' : 'no verdict within the step budget' });
        continue;
      }
      if (wantVerdict === 'acc') accepts++; else rejects++;
    }
    if (wantOut !== null) {
      const gotOut = outputText(got.output);
      if (gotOut !== wantOut) { failures.push({ w: row.w, want: `→ ${row.out}`, got: `→ ${gotOut || '(nothing)'}` }); continue; }
      outputs++;
    }
  }
  return { checked, accepts, rejects, outputs, failures, ok: checked > 0 && !failures.length };
}

// ── Determinism ───────────────────────────────────────────────────

/**
 * Whether δ is single-valued as drawn. A deterministic type is asked through
 * its own determinism rule — the editor's — for every transition, so the
 * badge and the editor's refusal are one test. A nondeterministic finite
 * automaton earns it too when its δ happens not to branch: no ε-moves and no
 * two edges out of a state on overlapping symbols.
 */
export function isDeterministicTarget(target) {
  return withMachine(target, () => {
    const m = target.machine;
    const rule = machineDeterminism(m);
    if (rule) return !target.transitions.some(t => !!rule.conflict(t, t.id));
    if (m === 'NFA' || m === 'ε-NFA') {
      const sym = symOf(target);
      const seen = new Set();
      for (const t of target.transitions) {
        if (t.symbol === sym.eps || t.symbol === sym.any) return false;
        const key = t.from + '\u0001' + t.symbol;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    }
    return false;
  });
}

// ── The minimal DFA, and the language's fingerprint ───────────────

/**
 * The minimal complete DFA of a finite automaton's language, in canonical form:
 * states numbered in breadth-first order from the start over Σ sorted, so two
 * machines for the same language produce the same table whatever they looked
 * like. `dead` is the index of the rejecting sink, or -1.
 *
 * `null` for anything that is not a DFA/NFA/ε-NFA, and for a subset
 * construction that outgrows LIBRARY_LIMITS.subsetStates.
 */
export function minimalDfaOf(target) {
  if (!EXACT.has(target.machine)) return null;
  const sym = symOf(target);
  const sigma = [...new Set(target.sigma)].filter(s => s !== sym.eps && s !== sym.any).sort();
  const side = subsetSide(target, sym);
  const keyOf = cfg => cfg.join('\u0001');

  // Determinize, complete over Σ (the empty set is the sink).
  const index = new Map();
  const configs = [];
  const add = cfg => {
    const k = keyOf(cfg);
    let i = index.get(k);
    if (i === undefined) { i = configs.length; index.set(k, i); configs.push(cfg); }
    return i;
  };
  add(side.start);
  const delta = [];
  for (let i = 0; i < configs.length; i++) {
    if (configs.length > LIBRARY_LIMITS.subsetStates) return null;
    for (let a = 0; a < sigma.length; a++) delta[i * sigma.length + a] = add(side.step(configs[i], sigma[a]));
  }
  const n = configs.length, k = sigma.length;
  const accepting = configs.map(c => side.accepting(c));

  // Moore's refinement: split by acceptance, then by the blocks each symbol
  // leads to, until nothing splits. Quadratic at worst, and n is capped.
  let block = accepting.map(x => (x ? 1 : 0));
  for (;;) {
    const sig = new Map();
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = String(block[i]);
      for (let a = 0; a < k; a++) s += ',' + block[delta[i * k + a]];
      let b = sig.get(s);
      if (b === undefined) { b = sig.size; sig.set(s, b); }
      next[i] = b;
    }
    const same = sig.size === new Set(block).size;
    block = next;
    if (same) break;
  }

  // Canonical numbering: BFS over the quotient from the start's block.
  const order = new Map([[block[0], 0]]);
  const rep = [0];
  for (let h = 0; h < rep.length; h++) {
    for (let a = 0; a < k; a++) {
      const b = block[delta[rep[h] * k + a]];
      if (!order.has(b)) { order.set(b, rep.length); rep.push(delta[rep[h] * k + a]); }
    }
  }
  const m = rep.length;
  const out = new Array(m * k);
  const acc = [];
  for (let q = 0; q < m; q++) {
    if (accepting[rep[q]]) acc.push(q);
    for (let a = 0; a < k; a++) out[q * k + a] = order.get(block[delta[rep[q] * k + a]]);
  }
  let dead = -1;
  for (let q = 0; q < m && dead < 0; q++) {
    if (acc.includes(q)) continue;
    let loops = true;
    for (let a = 0; a < k; a++) if (out[q * k + a] !== q) { loops = false; break; }
    if (loops) dead = q;
  }
  return { sigma, n: m, start: 0, acc, delta: out, dead };
}

/**
 * Sixteen hex digits naming the language, not the machine. Equal for equal
 * languages over the same Σ by construction; a match is still confirmed with
 * the exact equivalence check before anything is said to a reader.
 */
export function languageFingerprint(dfa) {
  if (!dfa) return null;
  return hash64(JSON.stringify([dfa.sigma, dfa.acc, dfa.delta]));
}

/**
 * An exercise's identity: its task, which is the reference it is graded
 * against and the rules an answer has to follow — never its title, prompt,
 * hints or grading budget, which say how the task is put, and never its
 * canvas, which is only where a student starts. Two exercises that grade every
 * answer the same way are one exercise, however differently they are worded.
 *
 * The reference is named at the strength the grader can tell it apart:
 *
 *   a finite automaton   by its language (the minimal DFA's fingerprint), since
 *                        grading one is an exact language comparison — two
 *                        drawings of "an even number of 1s" set one task;
 *   any other machine    by the machine (hash.js canonicalCodeOf, flat), since
 *                        their languages cannot be compared exactly;
 *   a grammar            by its start symbol and productions in a fixed order.
 *                        Renaming a variable makes it another grammar here —
 *                        grammar isomorphism is a harder question than this
 *                        needs to answer.
 *
 * Hashed under its own tag, so an exercise's id can never equal a machine's.
 * Null when the reference cannot be read.
 */
export function exerciseIdOf(doc) {
  const ex = doc?.exercise;
  if (!ex || typeof ex !== 'object') return null;
  let target;
  try { target = unsealTarget(ex.target); } catch { return null; }
  if (!target || typeof target !== 'object') return null;
  let ref = null;
  if (target.kind === 'grammar') {
    const g = target.grammar || {};
    const prods = (g.productions || []).map(p => [String(p.lhs ?? ''), String(p.rhs ?? '')]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    ref = ['grammar', JSON.stringify([String(g.start ?? ''), prods])];
  } else {
    const sym = { ...App.config.sym, ...(doc.config?.sym || {}) };
    const machine = { ...target, config: { ...(target.config || {}), sym } };
    let dfa = null;
    try { dfa = minimalDfaOf(machine); } catch { dfa = null; }
    const print = languageFingerprint(dfa);
    ref = print ? ['language', print] : ['machine', canonicalCodeOf(machine, { flat: true })];
  }
  if (!ref[1]) return null;
  const allow = [...new Set(Array.isArray(ex.allow) ? ex.allow.filter(m => typeof m === 'string') : [])].sort();
  const answer = ex.answer === 'grammar' ? 'grammar' : 'machine';
  return hash64(JSON.stringify(['exercise', answer, allow, ex.maxStates ?? null, ...ref]));
}

/**
 * A DFA is minimal when no DFA of its own kind for its language has fewer
 * states. A complete drawing is held to the minimal complete DFA, sink and
 * all; a partial one to the minimal automaton's live states, since the sink is
 * exactly what a partial DFA leaves out. Holding a partial drawing to the
 * complete count would call two equivalent states minimal whenever the
 * language happened to need a sink.
 */
export function isMinimalDfa(target, dfa = minimalDfaOf(target)) {
  if (target.machine !== 'DFA' || !dfa) return false;
  const n = target.states.length;
  if (isCompleteDfa(target, dfa.sigma)) return n === dfa.n;
  return n === dfa.n - (dfa.dead >= 0 ? 1 : 0);
}

/** Whether every state has a move on every symbol of Σ — a wildcard counts for all of them. */
function isCompleteDfa(target, sigma) {
  const sym = symOf(target);
  const out = new Map(target.states.map(s => [s.id, new Set()]));
  for (const t of target.transitions) out.get(t.from)?.add(t.symbol);
  for (const syms of out.values()) {
    if (syms.has(sym.any)) continue;
    if (sigma.some(a => !syms.has(a))) return false;
  }
  return true;
}

// ── Halting ───────────────────────────────────────────────────────

/** Whether the machine halts from a blank tape, with the proof's method. `null` when it cannot be asked. */
export function behaviourOf(target, budget = LIBRARY_LIMITS.behaviourBudget) {
  if (!BEHAVIOUR_MACHINES.has(target.machine)) return null;
  return withMachine(target, () => {
    const p = compileBehaviourMachine([], target.machine);
    if (!p.ok) return null;
    const v = classifyBehaviourNow(p, { budget });
    const out = { verdict: v.verdict, method: v.method || null };
    for (const k of ['steps', 'ones', 'cells', 'period', 'from', 'shift', 'direction', 'longest', 'how', 'size', 'depth']) {
      if (v[k] !== undefined && v[k] !== null && typeof v[k] !== 'object') out[k] = v[k];
    }
    return out;
  });
}

// A plain stepper over the compiled table// A plain stepper over the compiled table, for the space-time picture. The
// classifier's own runner is private to it and carries the
// hashing a proof needs; this carries only a tape.
function tapeRunner(p) {
  const tape = new Map();
  p.input.forEach((c, i) => { if (c) tape.set(i, c); });
  let head = 0, state = p.start;
  return {
    get head() { return head; },
    get state() { return state; },
    read: x => tape.get(x) || 0,
    step() {
      if (p.accept[state]) return false;
      const e = state * p.K + (tape.get(head) || 0);
      const to = p.next[e];
      if (to < 0) return false;
      const w = p.write[e];
      if (w) tape.set(head, w); else tape.delete(head);
      head += p.move[e];
      if (!p.twoWay && head < 0) return false;
      state = to;
      return true;
    }
  };
}

// ── Pictures ──────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function round(v) { return Math.round(v * 10) / 10; }

// ── Card art ──────────────────────────────────────────────────────
//  Each card shows two or three pictures in turn (js/library-ui.js rotates
//  them), each the most characteristic view of the machine in some sense:
//
//    diagram    the machine as drawn, in its family's colour, state names on
//               when there are few enough to read
//    language   every word up to some length, one row per length in shortlex
//               order, lit where accepted — the Language panel's fingerprint.
//               Two different machines for the same language draw the same
//               picture, which is the point of showing it.
//    spacetime  a Turing machine's first steps from a blank tape, cropped to
//               the card
//
//  They are <img> files, so they cannot read a theme variable: each is drawn
//  as a small dark screen in the default theme's family hues, and reads as a
//  screen on every theme. The hues are the dark palette's (css/variables.css).

export const FAMILY_HUES = { fa: '#4fc3f7', omega: '#b388ff', mem: '#ffd54f', tm: '#ff9e6b', special: '#69f0ae' };
export const ART_KINDS = ['diagram', 'language', 'spacetime'];
const ART_W = 320, ART_H = 180, SCREEN = '#0d1322';

function svgOpen(w, h, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">`;
}

/**
 * The diagram, in its family's hue, on the canvas's dot grid — the build's
 * file, for the website and for a machine too large to carry a sketch. The app
 * draws its own figures in the theme's ink (sketch.js).
 */
export function diagramArtSvg(target, hue = FAMILY_HUES[categoryOf(target.machine)], { w: W = ART_W, h: H = ART_H } = {}) {
  const blockById = new Map((target.blocks || []).map(b => [b.id, b]));
  const topOf = s => {
    let b = s.blockId ? blockById.get(s.blockId) : null;
    const seen = new Set();
    while (b && b.parent && !seen.has(b.id)) { seen.add(b.id); b = blockById.get(b.parent) || null; }
    return b;
  };
  const nodes = [];
  const rootOf = new Map();
  for (const s of target.states) {
    const b = topOf(s);
    rootOf.set(s.id, b ? b.id : s.id);
    if (!b) nodes.push({ id: s.id, x: s.x || 0, y: s.y || 0, name: s.name ?? s.id, kind: 'state' });
  }
  for (const b of (target.blocks || []).filter(b => !b.parent)) nodes.push({ id: b.id, x: b.x || 0, y: b.y || 0, name: b.name || '', kind: 'block' });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = target.transitions
    .map(t => ({ ...t, from: rootOf.get(t.from) || t.from, to: rootOf.get(t.to) || t.to }))
    .filter(t => byId.has(t.from) && byId.has(t.to));
  const k = W / ART_W;
  const fit = thumbFit(thumbBounds(nodes, 34, n => (n.kind === 'block' ? 70 : 34)), { x: 22 * k, y: 16 * k, w: W - 44 * k, h: H - 32 * k });
  const r = Math.max(5, Math.min(15 * k, thumbNodeRadius(fit.scale, 30) * 2));
  const segs = thumbEdgeSegments(thumbEdgePairs(edges), byId, fit, r);
  const accepts = new Set(target.accepts);
  const names = nodes.length <= 6;
  const p = [svgOpen(W, H, 'The machine’s diagram'),
    `<defs><pattern id="g" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="${hue}" fill-opacity="0.16"/></pattern>`,
    `<radialGradient id="v" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="${hue}" stop-opacity="0.15"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="${SCREEN}"/><rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#v)"/>`];
  p.push(`<path d="${thumbEdgePath(segs)}" fill="none" stroke="${hue}" stroke-opacity="0.55" stroke-width="1.6" stroke-linecap="round"/>`);
  for (const n of nodes) {
    const cx = round(fit.px(n.x)), cy = round(fit.py(n.y));
    if (n.kind === 'block') {
      const bw = round(r * 3.4), bh = round(r * 2.3);
      p.push(`<rect x="${round(cx - bw / 2)}" y="${round(cy - bh / 2)}" width="${bw}" height="${bh}" rx="4" fill="#131b2e" stroke="${hue}" stroke-width="1.6"/>`);
      continue;
    }
    const start = n.id === target.startId;
    p.push(`<circle cx="${cx}" cy="${cy}" r="${round(r)}" fill="#131b2e" stroke="${hue}" stroke-width="${start ? 2.2 : 1.6}"/>`);
    if (accepts.has(n.id)) p.push(`<circle cx="${cx}" cy="${cy}" r="${round(Math.max(r - 3.2, r * 0.7))}" fill="none" stroke="${hue}" stroke-width="1.2"/>`);
    if (start) p.push(`<path d="M${round(cx - r - 13)} ${cy} h9 m-4 -4 l4 4 l-4 4" fill="none" stroke="${hue}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (names && r >= 9) p.push(`<text x="${cx}" y="${round(cy + r * 0.24)}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="${round(Math.max(7, r * 0.6))}" fill="#dfe8ff">${esc(String(n.name).slice(0, 4))}</text>`);
  }
  p.push('</svg>');
  return p.join('');
}

/**
 * How an edge is labelled in a figure: its symbol, and a transducer's output
 * after a slash. Null — no label — for a machine whose moves say more than a
 * figure can print (a stack, a tape), where a half-label would mislead.
 */
export function edgeLabelOf(machine) {
  const cfg = getMachineConfig(machine) || {};
  const cat = categoryOf(machine);
  if (cat === 'fa' || cat === 'omega') return t => (t.symbol === undefined ? null : String(t.symbol));
  if (machine === 'Mealy' || machine === 'FST') return t => (t.symbol === undefined ? null : `${t.symbol}/${t.output ?? ''}`);
  if (cfg.isTransducer && machine === 'Moore') return t => (t.symbol === undefined ? null : String(t.symbol));
  return null;
}

/** The machine's shape as the index carries it (sketch.js packSketch), or null past its limit. */
export function sketchOf(target) {
  return packSketch(sketchFromTarget(target));
}

/**
 * The listing's diagram and what a trace needs to light it: which drawn node a
 * state is (a state inside a block is its block), and which drawn edge a
 * transition is. Drawn by sketch.js in the theme's ink, labelled where the
 * machine is small enough for labels to be read.
 */
export function liveDiagram(target, { w = 640, h = null } = {}) {
  const d = namedDiagram(target, { w, h, live: true });
  const edgeOf = new Map(target.transitions.map(t => [t.id, `${d.rootOf.get(t.from) || t.from}|${d.rootOf.get(t.to) || t.to}`]));
  const names = new Map(target.states.map(s => [s.id, String(s.name ?? s.id)]));
  return { svg: d.svg, w: d.w, h: d.h, rootOf: d.rootOf, edgeOf, names };
}

/**
 * The machine drawn to be read: names in its states, and labels on its edges
 * where the machine is small enough for them to be read. The listing's figure,
 * in the app (live, via liveDiagram) and on the website (drawn by the build).
 */
export function namedDiagram(target, { w = 640, h = null, live = false } = {}) {
  const labelOf = edgeLabelOf(target.machine);
  const sk = sketchFromTarget(target, labelOf);
  h = h || Math.round(w / sketchAspect(sk));
  const labels = !!labelOf && sk.nodes.length <= 14 && sk.edges.length <= 36;
  return { svg: drawSketch(sk, { w, h, names: true, labels, live, label: 'The machine’s diagram' }), w, h, rootOf: sk.rootOf };
}

/**
 * A one-tape machine's first `max` configurations from a blank tape, in the
 * shape sketch.js drawRun takes — for a Turing machine the standard notation
 * cannot write (sketch.js framesFromStandard covers the rest from the index).
 */
export function runFramesOf(target, max = 90) {
  if (!BEHAVIOUR_MACHINES.has(target.machine)) return null;
  return withMachine(target, () => {
    const p = compileBehaviourMachine([], target.machine);
    if (!p.ok) return null;
    const run = tapeRunner(p);
    const frames = [];
    for (let t = 0; t < max; t++) {
      const cells = [];
      for (let x = run.head - max; x <= run.head + max; x++) { const c = run.read(x); if (c) cells.push([x, c]); }
      frames.push({ head: run.head, cells });
      if (!run.step()) break;
    }
    return frames;
  });
}

/**
 * A word's run, as the player would show it, cut to `cap` steps: for each step
 * the states the machine is in, the transition it took, and how much of the
 * input it has read. Uses the machine's own stream (js/machines/index.js), so
 * the path on a listing is the path the canvas would draw — and pulls only
 * `cap` steps of it, so a Turing machine that never halts costs a few hundred.
 */
export function traceWord(target, raw, cap = 400) {
  return withMachine(target, () => {
    const saved = [App.simSteps, App.simIdx, App.simRun, App.simStart];
    App.simStart = null;
    try {
      const parsed = parseMachineInput(target.machine, String(raw ?? ''));
      if (!parsed.ok) return { error: parsed.error };
      const refusal = machineGuards(target.machine, parsed.input).find(g => g.refuse);
      if (refusal) return { error: refusal.message || refusal.say || 'This machine cannot be run as drawn.' };
      const run = withPainterSuppressed(() => {
        const r = streamMachine(target.machine, parsed.input);
        r.drain(cap + 1);
        return r;
      });
      const steps = [];
      const n = Math.min(run.known, cap + 1);
      let pos = 0;
      for (let i = 0; i < n; i++) {
        const st = run.at(i);
        if (!st) break;
        const states = Array.isArray(st.states) ? [...st.states] : st.states instanceof Set ? [...st.states] : st.state != null ? [st.state] : [];
        // A word machine's step says how far it has read; the symbol it just
        // read is the one the strip prints on the arrow.
        const read = Array.isArray(st.tokens) && Number.isInteger(st.pos) && st.pos > pos ? st.tokens[st.pos - 1] : null;
        if (Number.isInteger(st.pos)) pos = st.pos;
        steps.push({ states, tid: st.tid ?? null, read: read ?? null, final: st.final || null });
      }
      const last = steps[steps.length - 1];
      return { steps, cut: !run.done || run.known > cap + 1, final: last?.final || null };
    } catch (e) {
      return { error: e?.message || String(e) };
    } finally {
      [App.simSteps, App.simIdx, App.simRun, App.simStart] = saved;
    }
  });
}

/**
 * Every word up to length L, decided, one row per length. L is as large as
 * keeps the rows readable: at most 256 words in the longest row and 511 in all.
 * `null` for a machine without a finite-word language to draw — an ω-automaton,
 * a multi-tape run, a transducer, a Turing machine (which draws its run).
 */
export function languageArtSvg(target, dfa = null, hue = FAMILY_HUES[categoryOf(target.machine)]) {
  const cfg = getMachineConfig(target.machine) || {};
  const cat = categoryOf(target.machine);
  if (cfg.isOmega || cfg.isTransducer || (cat !== 'fa' && cat !== 'mem')) return null;
  const def = machineDef(target.machine);
  if (!def || def.parseInput) return null;
  const sym = symOf(target);
  const sigma = [...new Set(target.sigma)].filter(s => s !== sym.eps && s !== sym.any).sort();
  const k = sigma.length;
  if (!k) return null;
  let L = 0, total = 1;
  while (L < (k === 1 ? 14 : 10) && k ** (L + 1) <= 256 && total + k ** (L + 1) <= 511) { L++; total += k ** L; }
  // A large alphabet leaves room for only a couple of lengths, and the picture
  // is a few stripes with a speck in them — no picture beats a broken-looking one.
  if (L < 3) return null;
  const words = [[]];
  let frontier = [[]];
  for (let len = 1; len <= L; len++) {
    const next = [];
    for (const w of frontier) for (const a of sigma) next.push([...w, a]);
    words.push(...next);
    frontier = next;
  }
  let verdicts;
  if (dfa && dfa.sigma.join('\u0001') === sigma.join('\u0001')) {
    const col = new Map(dfa.sigma.map((s, i) => [s, i]));
    const acc = new Set(dfa.acc);
    verdicts = words.map(w => {
      let q = dfa.start;
      for (const t of w) q = dfa.delta[q * k + col.get(t)];
      return acc.has(q) ? 'acc' : 'rej';
    });
  } else {
    verdicts = withMachine(target, () => words.map(w => {
      try { return (decideWord(target.machine, w) || { verdict: 'unk' }).verdict; } catch { return 'unk'; }
    }));
  }
  // Something to see: at least three accepted words, at two or more lengths.
  if (verdicts.filter(v => v === 'acc').length < 3) return null;
  let lengthsLit = 0, at = 0;
  for (let len = 0; len <= L; len++) {
    const n = k ** len;
    if (verdicts.slice(at, at + n).includes('acc')) lengthsLit++;
    at += n;
  }
  if (lengthsLit < 2) return null;
  const pad = 14, rh = (ART_H - pad * 2) / (L + 1), iw = ART_W - pad * 2;
  const p = [svgOpen(ART_W, ART_H, `Every word up to length ${L}, lit where accepted`), `<rect width="${ART_W}" height="${ART_H}" fill="${SCREEN}"/>`];
  let i = 0;
  for (let len = 0; len <= L; len++) {
    const n = k ** len, cw = iw / n, y = round(pad + len * rh + 1.2), h = round(Math.max(rh - 2.4, 1));
    // Runs of one verdict are one rect, so a long quiet row costs one element.
    let x0 = 0;
    while (x0 < n) {
      const v = verdicts[i + x0];
      let run = 1;
      while (x0 + run < n && verdicts[i + x0 + run] === v) run++;
      const fill = v === 'acc' ? hue : v === 'unk' ? '#6b5324' : '#1a2640';
      const gap = cw > 3 ? 0.6 : 0;
      p.push(`<rect x="${round(pad + x0 * cw)}" y="${y}" width="${round(Math.max(run * cw - gap, 0.8))}" height="${h}" fill="${fill}"${v === 'acc' ? '' : ' fill-opacity="0.9"'}/>`);
      x0 += run;
    }
    i += n;
  }
  p.push('</svg>');
  return p.join('');
}

/**
 * A Turing machine's first steps from a blank tape, sized to the card: cells as
 * large as the run allows, so a six-step machine is not a speck in a corner.
 */
export function spaceTimeArtSvg(target, hue = FAMILY_HUES.tm) {
  if (!BEHAVIOUR_MACHINES.has(target.machine)) return null;
  return withMachine(target, () => {
    const p0 = compileBehaviourMachine([], target.machine);
    if (!p0.ok) return null;
    const run = tapeRunner(p0);
    const frames = [];
    let lo = 0, hi = 0;
    const MAX_ROWS = 90;
    for (let t = 0; t < MAX_ROWS; t++) {
      lo = Math.min(lo, run.head); hi = Math.max(hi, run.head);
      const cells = new Map();
      for (let x = run.head - 90; x <= run.head + 90; x++) { const c = run.read(x); if (c) cells.set(x, c); }
      frames.push({ head: run.head, cells });
      if (!run.step()) break;
    }
    const span = hi - lo + 1;
    const s = Math.max(2, Math.min(14, Math.floor(ART_H / frames.length), Math.floor(ART_W / (span + 4))));
    const cols = Math.floor(ART_W / s), rows = Math.min(frames.length, Math.floor(ART_H / s));
    const left = Math.round((lo + hi) / 2) - Math.floor(cols / 2);
    const top = Math.round((ART_H - rows * s) / 2), ox = Math.round((ART_W - cols * s) / 2);
    const palette = [hue, '#4fc3f7', '#69f0ae', '#b388ff', '#ffd54f', '#ff6b6b', '#f48fb1', '#80deea'];
    const p = [svgOpen(ART_W, ART_H, 'The first steps from a blank tape'), `<rect width="${ART_W}" height="${ART_H}" fill="#05070d"/>`];
    for (let y = 0; y < rows; y++) {
      const f = frames[y];
      let x = 0;
      while (x < cols) {
        const c = f.cells.get(left + x) || 0;
        let n = 1;
        while (x + n < cols && (f.cells.get(left + x + n) || 0) === c) n++;
        if (c) p.push(`<rect x="${ox + x * s}" y="${top + y * s}" width="${n * s}" height="${s}" fill="${palette[(c - 1) % palette.length]}"/>`);
        x += n;
      }
      const hx = f.head - left;
      if (hx >= 0 && hx < cols && s >= 3) p.push(`<rect x="${ox + hx * s + 0.5}" y="${top + y * s + 0.5}" width="${s - 1}" height="${s - 1}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1"/>`);
    }
    p.push('</svg>');
    return p.join('');
  });
}

/** Every picture this machine has, in display order. */
export function cardArt(target, dfa = null) {
  const out = [];
  const st = spaceTimeArtSvg(target);
  if (st) out.push({ kind: 'spacetime', svg: st });
  out.push({ kind: 'diagram', svg: diagramArtSvg(target) });
  let lang = null;
  try { lang = languageArtSvg(target, dfa); } catch { lang = null; }
  if (lang) out.push({ kind: 'language', svg: lang });
  return out;
}


// ── Facts ─────────────────────────────────────────────────────────

const CATEGORY_OF = new Map(MachineCategories.flatMap(c => c.machines.map(m => [m, c.id])));
CATEGORY_OF.set('PDA', 'mem');

export function categoryOf(machine) {
  return CATEGORY_OF.get(machine) || 'special';
}

/** The class of languages the machine's *type* can recognise — the Language panel's heading, shortened. */
export function languageClassOf(machine) {
  const cfg = getMachineConfig(machine) || {};
  if (['DFA', 'NFA', 'ε-NFA', '2DFA', '2NFA'].includes(machine)) return 'Regular';
  if (machine === 'PFA') return 'Stochastic';
  if (cfg.isOmega) {
    if (cfg.omegaCondition === 'cobuchi') return 'co-Büchi ω-regular';
    if (cfg.omegaCondition === 'weak') return 'Weak ω-regular';
    if (cfg.omegaCondition === 'buchi' && cfg.deterministic) return 'Deterministic Büchi';
    return 'ω-regular';
  }
  if (machine === 'DPDA' || machine === 'PDA') return 'Deterministic context-free';
  if (machine === 'NPDA') return 'Context-free';
  if (machine === 'Counter') return 'One-counter';
  if (machine === 'EPDA') return 'Tree-adjoining (mildly context-sensitive)';
  if (machine === 'LBA') return 'Context-sensitive';
  if (machine === 'QA' || machine === '2PDA' || ['TM', 'NDTM', 'MTM', 'ITM'].includes(machine)) return 'Recursively enumerable';
  if (machine === 'PDT') return 'Pushdown transduction';
  if (machine === '2DFT') return 'Regular transduction (two-way)';
  if (cfg.isTransducer) return 'Rational transduction';
  return '';
}

export function statsOf(target) {
  const sym = symOf(target);
  return {
    states: target.states.length,
    transitions: target.transitions.length,
    sigma: target.sigma.filter(s => s !== sym.eps),
    tapes: target.tapeCount || 1,
    blocks: (target.blocks || []).length
  };
}

// ── The library's own fields on a document ────────────────────────

/**
 * `meta.library` — what the author says about the entry that is not about the
 * machine. Read tolerantly: every field has a default, and a value that is the
 * wrong shape is dropped rather than repaired into something the author did
 * not write.
 */
export function libraryMetaOf(doc) {
  const lib = doc?.meta?.library && typeof doc.meta.library === 'object' ? doc.meta.library : {};
  const author = lib.author && typeof lib.author === 'object' ? lib.author : {};
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    author: { login: s(author.login, 39).replace(/^@/, ''), name: s(author.name, 80) },
    tags: (Array.isArray(lib.tags) ? lib.tags : [])
      .filter(t => typeof t === 'string').map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean)
      .slice(0, LIBRARY_LIMITS.tags),
    license: s(lib.license, 20),
    difficulty: ['intro', 'intermediate', 'advanced'].includes(lib.difficulty) ? lib.difficulty : '',
    chapter: s(lib.chapter, 80),
    forkOf: isLibraryId(lib.forkOf) ? lib.forkOf : null,
    readme: s(lib.readme, LIBRARY_LIMITS.readmeMax)
  };
}

// ── The whole analysis ────────────────────────────────────────────

/**
 * Everything the library says about one document.
 *
 *   errors    reasons it cannot be listed at all — the PR check fails on these
 *   warnings  things a reviewer should see, which do not block it
 *   facts     the index entry's computed half: stats, badges, fingerprint, …
 *   target    the machine, for callers that go on to draw or grade it
 *
 * `opts.behaviourBudget` caps the halting classifier; `opts.pictures` asks for
 * the card's pictures (cardArt).
 */
export function analyzeDocument(doc, opts = {}) {
  const errors = [], warnings = [];
  const text = typeof opts.text === 'string' ? opts.text : null;
  if (text !== null && text.length > LIBRARY_LIMITS.bytes) {
    errors.push(`The file is ${Math.round(text.length / 1024)} KB; the library takes machines up to ${Math.round(LIBRARY_LIMITS.bytes / 1024)} KB.`);
    return { ok: false, errors, warnings, facts: null, target: null };
  }
  try {
    validateSchema(doc);
  } catch (e) {
    errors.push(e.message);
    return { ok: false, errors, warnings, facts: null, target: null };
  }
  const target = targetFromDoc(doc);
  if (!MachineTypes[target.machine]) errors.push(`Unknown machine type ${target.machine}.`);
  if (target.states.length > LIBRARY_LIMITS.states) errors.push(`${target.states.length} states is past the library's ${LIBRARY_LIMITS.states}.`);
  if (target.transitions.length > LIBRARY_LIMITS.transitions) errors.push(`${target.transitions.length} transitions is past the library's ${LIBRARY_LIMITS.transitions}.`);
  if (!target.states.length) errors.push('The machine has no states.');
  if (!target.startId || !target.states.some(s => s.id === target.startId)) errors.push('The machine has no start state.');

  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  const lib = libraryMetaOf(doc);
  const title = typeof meta.title === 'string' ? meta.title.trim() : '';
  if (!title) errors.push('The machine card needs a title (meta.title).');
  if (title.length > LIBRARY_LIMITS.titleMax) errors.push(`The title is longer than ${LIBRARY_LIMITS.titleMax} characters.`);
  if (typeof meta.blurb === 'string' && meta.blurb.length > LIBRARY_LIMITS.blurbMax) errors.push(`The description is longer than ${LIBRARY_LIMITS.blurbMax} characters.`);
  if (!meta.blurb) warnings.push('There is no description (meta.blurb). A sentence on what the machine does helps people find it.');
  if (!lib.author.login) errors.push('meta.library.author.login must name the GitHub account the entry is credited to.');
  else if (!LOGIN_RE.test(lib.author.login)) errors.push(`"${lib.author.login}" is not a GitHub username.`);
  if (!LIBRARY_LICENSES[lib.license]) errors.push(`meta.library.license must be one of ${Object.keys(LIBRARY_LICENSES).join(', ')}.`);
  if (errors.length) return { ok: false, errors, warnings, facts: null, target };

  const badges = [];
  const tests = runDeclaredTests(target, meta.inputs);
  if (tests.failures.length) {
    for (const f of tests.failures.slice(0, 8)) errors.push(`Example "${f.w}": the card says ${f.want}, the machine gives ${f.got}.`);
  } else if (tests.ok) {
    badges.push({ id: 'tested', detail: `${tests.checked} example${tests.checked === 1 ? '' : 's'} checked` });
  } else if (!BEHAVIOUR_MACHINES.has(target.machine)) {
    // A one-tape Turing machine is checked from a blank tape below whether or
    // not it has examples, and a busy beaver's example would be a run the
    // card's step budget cannot finish — so the nudge is for everything else.
    warnings.push('The card declares no examples with an expected verdict or output, so nothing could be checked. Add some to earn the “Tests pass” badge.');
  }

  let deterministic = false;
  try { deterministic = isDeterministicTarget(target); } catch { deterministic = false; }
  if (deterministic) badges.push({ id: 'deterministic', detail: '' });
  if (!deterministic && machineDef(target.machine)?.deterministicDelta && machineDeterminism(target.machine)) {
    errors.push(`A ${target.machine} has to be deterministic, and this one's δ branches.`);
  }

  let dfa = null;
  try { dfa = minimalDfaOf(target); } catch { dfa = null; }
  const fingerprint = languageFingerprint(dfa);
  if (dfa && isMinimalDfa(target, dfa)) badges.push({ id: 'minimal', detail: `${target.states.length} state${target.states.length === 1 ? '' : 's'}` });
  if (target.machine === 'DFA' && dfa && !isMinimalDfa(target, dfa)) {
    warnings.push(`A DFA for this language needs only ${dfa.n - (dfa.dead >= 0 ? 1 : 0)} live states; this one has ${target.states.length}.`);
  }

  let behaviour = null;
  if (opts.behaviour !== false) {
    try { behaviour = behaviourOf(target, opts.behaviourBudget ?? LIBRARY_LIMITS.behaviourBudget); } catch { behaviour = null; }
  }
  // A machine that stops before its first move on a blank tape is one that
  // expects input, and "halts in 0 steps" says nothing about it. A proof that
  // it never halts is always worth saying.
  if (behaviour?.verdict === 'halts' && behaviour.steps > 0) badges.push({ id: 'halts', detail: `${behaviour.steps.toLocaleString('en-US')} steps` });
  if (behaviour?.verdict === 'never') badges.push({ id: 'never-halts', detail: METHOD_SAY[behaviour.method] || behaviour.method || '' });

  const facts = {
    title,
    blurb: typeof meta.blurb === 'string' ? meta.blurb.trim() : '',
    machine: target.machine,
    category: categoryOf(target.machine),
    languageClass: languageClassOf(target.machine),
    // The one-line code bbchallenge and the literature name a small TM by —
    // computed, so it is right for a machine drawn by hand as well as one read
    // from the notation. Null for anything the notation cannot say.
    standard: writeStandardTM(target, symOf(target)),
    stats: statsOf(target),
    badges,
    behaviour,
    fingerprint,
    // What this entry is, so the library can list it once. A machine is known
    // by the machine (hash.js machineIdOf) — for every kind of machine, where
    // the fingerprint above says only that two agree on a language. An
    // exercise is known by its task (exerciseIdOf): its canvas is only where a
    // student starts, so two exercises starting from the same near-empty
    // machine are not one exercise, and two with different starting points
    // that grade every answer alike are.
    machineId: doc.exercise ? null : machineIdOf(doc),
    taskId: doc.exercise ? exerciseIdOf(doc) : null,
    // The table is what lets the library search by word without downloading a
    // machine. Past 64 states it is more index than it is worth.
    dfa: dfa && dfa.n <= 64 ? { sigma: dfa.sigma, n: dfa.n, start: dfa.start, acc: dfa.acc, delta: dfa.delta } : null,
    // What a card draws the machine from, in the app, in the theme's ink.
    sketch: sketchOf(target),
    tests: { accepts: tests.accepts, rejects: tests.rejects, outputs: tests.outputs },
    ...lib
  };

  const out = { ok: !errors.length, errors, warnings, facts, target };
  if (opts.pictures) out.art = cardArt(target, dfa);
  return out;
}

const METHOD_SAY = {
  cycler: 'cycler',
  translated: 'translated cycler',
  backward: 'backward reasoning',
  segment: 'halting segment',
  far: 'finite automata reduction'
};
