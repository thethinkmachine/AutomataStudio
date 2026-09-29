// ══════════════════════════════════════════════════════════════════
//  BA (RABIT, GOAL, Ultimate) AND TIMBUK
// ══════════════════════════════════════════════════════════════════
// Two plain-text formats the automata-inclusion and tree-automata tools read.
//
// BA — one Büchi (or finite) automaton:
//
//     [q0]              the initial state, on the first line
//     a,[q0]->[q1]      one line per transition: label,source->target
//     [q1]              after the transitions, one line per accepting state
//
//   RABIT's convention is that a file listing no accepting states accepts in
//   every state, so a machine with F = ∅ cannot be written faithfully; the
//   writer says so rather than writing a file that means the opposite.
//
// Timbuk — bottom-up tree automata. A word automaton is the special case
// where every symbol but the leaf is unary, which is the only case this reads:
//
//     Ops x:0 a:1 b:1
//     Automaton A
//     States q0 q1
//     Final States q1
//     Transitions
//     x -> q0           a leaf: q0 is initial
//     a(q0) -> q1       reading a in q0 goes to q1
//
// A symbol of arity two or more is a real tree automaton, and there is no
// machine in the app for one; it is refused by name.

import { CliError } from '../errors.mjs';

const clean = s => String(s).replace(/^\[|\]$/g, '');

function deterministic(transitions) {
  const seen = new Set();
  for (const t of transitions) {
    const k = `${t.from}|${t.symbol}`;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

// Several initial states → one fresh start with their outgoing edges (and,
// for a finite automaton, accepting if any of them is).
function mergeStarts(states, transitions, starts, accepts, finite) {
  if (starts.length === 1) return starts[0];
  const id = '__init';
  states.unshift({ id, name: 'init' });
  const set = new Set(starts);
  for (const t of [...transitions]) if (set.has(t.from)) transitions.push({ ...t, id: `t${transitions.length + 1}`, from: id });
  if (finite && starts.some(s => accepts.includes(s))) accepts.push(id);
  return id;
}

/** BA text → an NBA/DBA (Büchi). */
export function readBA(text, sym) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const states = new Map();
  const ensure = name => {
    const n = clean(name);
    if (!states.has(n)) states.set(n, { id: `s${states.size}`, name: n });
    return states.get(n).id;
  };
  const transitions = [];
  let init = null;
  const accepting = [];
  let seenTransition = false;
  for (const line of lines) {
    const m = /^(.+?),\s*(\[?[^\]]*\]?)\s*->\s*(\[?[^\]]*\]?)$/.exec(line);
    if (m) {
      seenTransition = true;
      transitions.push({ id: `t${transitions.length + 1}`, from: ensure(m[2]), to: ensure(m[3]), symbol: m[1].trim() });
      continue;
    }
    if (!seenTransition && init === null) { init = ensure(line); continue; }
    if (seenTransition) { accepting.push(ensure(line)); continue; }
    throw new CliError(`BA: could not read the line "${line}".`);
  }
  if (!states.size) throw new CliError('BA: the file has no states.');
  const startId = init ?? transitions[0]?.from ?? [...states.values()][0].id;
  const all = [...states.values()];
  const accepts = accepting.length ? [...new Set(accepting)] : all.map(s => s.id);
  const warnings = accepting.length ? [] : ['The file lists no accepting states, which RABIT reads as "every state accepts".'];
  return {
    machine: deterministic(transitions) ? 'DBA' : 'NBA',
    sigma: [...new Set(transitions.map(t => t.symbol))].sort(),
    stackAlpha: [], outputAlpha: [], tapeCount: 1,
    states: all, transitions, startId, accepts, config: {}, warnings
  };
}

/** A Büchi-condition ω-automaton or a finite automaton → BA text. */
export function baText(target) {
  const ok = ['DBA', 'NBA', 'DWA', 'NWA', 'DFA', 'NFA'];
  if (!ok.includes(target.machine)) {
    throw new CliError(`BA holds Büchi and finite automata; a ${target.machine} is neither.${target.machine === 'ε-NFA' ? ' Remove the ε-moves first (automata eps-elim).' : ''}`);
  }
  if (!(target.accepts || []).length) {
    throw new CliError('The machine has no accepting states, and a BA file with none is read as "every state accepts". There is no faithful BA file for it.');
  }
  const sym = target.config?.sym || {};
  const letters = [...new Set(target.sigma)].filter(s => s !== sym.eps && s !== sym.any);
  const name = new Map(target.states.map(s => [s.id, String(s.name ?? s.id)]));
  const lines = [`[${name.get(target.startId)}]`];
  for (const t of target.transitions) {
    const syms = t.symbol === sym.any ? letters : [t.symbol];
    for (const a of syms) lines.push(`${a},[${name.get(t.from)}]->[${name.get(t.to)}]`);
  }
  for (const id of target.accepts) lines.push(`[${name.get(id)}]`);
  return lines.join('\n') + '\n';
}

/** Timbuk text (word automata only) → an NFA/DFA. */
export function readTimbuk(text, sym) {
  const src = text.replace(/#.*$/gm, '');
  const ops = /Ops\s+([\s\S]*?)(?=\bAutomaton\b)/.exec(src);
  if (!ops) throw new CliError('Timbuk: no "Ops" line before "Automaton".');
  const arity = new Map();
  for (const m of ops[1].matchAll(/([^\s:]+):(\d+)/g)) arity.set(m[1], Number(m[2]));
  const wide = [...arity].filter(([, n]) => n > 1);
  if (wide.length) throw new CliError(`Timbuk: ${wide.map(([s, n]) => `${s} has arity ${n}`).join(', ')} — this is a tree automaton, and the app has no machine for trees. Only word automata (arities 0 and 1) can be read.`);
  const statesPart = /States\s+([\s\S]*?)(?=\bFinal\s+States\b)/.exec(src);
  const finalPart = /Final\s+States\s+([\s\S]*?)(?=\bTransitions\b)/.exec(src);
  const transPart = /Transitions\s+([\s\S]*)$/.exec(src);
  if (!statesPart || !finalPart || !transPart) throw new CliError('Timbuk: expected "States", "Final States" and "Transitions" sections.');
  const states = new Map();
  const ensure = raw => {
    const n = raw.replace(/:\d+$/, '');
    if (!states.has(n)) states.set(n, { id: `s${states.size}`, name: n });
    return states.get(n).id;
  };
  statesPart[1].split(/\s+/).filter(Boolean).forEach(ensure);
  const accepts = finalPart[1].split(/\s+/).filter(Boolean).map(ensure);
  const transitions = [];
  const starts = [];
  for (const line of transPart[1].split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const leaf = /^([^\s(]+)\s*->\s*(\S+)$/.exec(line);
    if (leaf) { starts.push(ensure(leaf[2])); continue; }
    const step = /^([^\s(]+)\s*\(\s*([^\s)]+)\s*\)\s*->\s*(\S+)$/.exec(line);
    if (step) { transitions.push({ id: `t${transitions.length + 1}`, from: ensure(step[2]), to: ensure(step[3]), symbol: step[1] }); continue; }
    throw new CliError(`Timbuk: could not read the rule "${line}".`);
  }
  if (!starts.length) throw new CliError('Timbuk: no leaf rule (x -> q), so no state is initial.');
  const all = [...states.values()];
  const acc = [...new Set(accepts)];
  const startId = mergeStarts(all, transitions, [...new Set(starts)], acc, true);
  return {
    machine: deterministic(transitions) ? 'DFA' : 'NFA',
    sigma: [...new Set(transitions.map(t => t.symbol))].sort(),
    stackAlpha: [], outputAlpha: [], tapeCount: 1,
    states: all, transitions, startId, accepts: acc, config: {}, warnings: []
  };
}

/** A finite automaton without ε-moves → Timbuk, with `x` as the leaf. */
export function timbukText(target, { name = 'A' } = {}) {
  if (!['DFA', 'NFA'].includes(target.machine)) {
    throw new CliError(`Timbuk (as a word automaton) holds DFAs and NFAs; a ${target.machine} is neither.${target.machine === 'ε-NFA' ? ' Remove the ε-moves first (automata eps-elim).' : ''}`);
  }
  const sym = target.config?.sym || {};
  const letters = [...new Set(target.sigma)].filter(s => s !== sym.eps && s !== sym.any);
  let leaf = 'x';
  while (letters.includes(leaf)) leaf += '_';
  const nm = new Map(target.states.map(s => [s.id, String(s.name ?? s.id).replace(/\s+/g, '_')]));
  const lines = [
    `Ops ${leaf}:0 ${letters.map(a => `${a}:1`).join(' ')}`.trim(),
    '',
    `Automaton ${name}`,
    `States ${target.states.map(s => nm.get(s.id)).join(' ')}`,
    `Final States ${(target.accepts || []).map(id => nm.get(id)).join(' ')}`,
    'Transitions',
    `${leaf} -> ${nm.get(target.startId)}`
  ];
  for (const t of target.transitions) {
    const syms = t.symbol === sym.any ? letters : [t.symbol];
    for (const a of syms) lines.push(`${a}(${nm.get(t.from)}) -> ${nm.get(t.to)}`);
  }
  return lines.join('\n') + '\n';
}
