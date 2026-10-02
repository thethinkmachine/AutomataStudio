// ══════════════════════════════════════════════════════════════════
//  BA (RABIT, GOAL, Ultimate)
// ══════════════════════════════════════════════════════════════════
// The plain-text format the automata-inclusion tools read: one Büchi (or
// finite) automaton.
//
//     [q0]              the initial state, on the first line
//     a,[q0]->[q1]      one line per transition: label,source->target
//     [q1]              after the transitions, one line per accepting state
//
//   RABIT's convention is that a file listing no accepting states accepts in
//   every state, so a machine with F = ∅ cannot be written faithfully; the
//   writer says so rather than writing a file that means the opposite.

import { aMachine } from '../grammar.mjs';
import { CliError } from '../errors.mjs';

const clean = s => String(s).replace(/^\[|\]$/g, '');

// What BA can hold unquoted.
const SAFE = /^[^\s()[\],:]+$/;

/** State names as written: themselves when safe and unique, s0, s1, … otherwise. */
function safeNames(states) {
  const out = new Map();
  const used = new Set();
  states.forEach((s, i) => {
    const want = String(s.name ?? s.id);
    const ok = SAFE.test(want) && !want.includes('->') && !used.has(want);
    let name = ok ? want : `s${i}`;
    while (used.has(name)) name += '_';
    used.add(name);
    out.set(s.id, name);
  });
  return out;
}

function deterministic(transitions) {
  const seen = new Set();
  for (const t of transitions) {
    const k = `${t.from}|${t.symbol}`;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** BA text → an NBA/DBA (Büchi). */
export function readBA(text, sym) {
  // A transition is tried before a line is taken as a comment: a label may
  // start with # (and BA itself has no comment syntax to protect).
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
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
    // Bracketed states first, split at the *last* ",[": a label may itself
    // contain a comma, an arrow or brackets. Then the bare form, `a,q0->q1`.
    const m = /^(.+),\s*\[([^\]]*)\]\s*->\s*\[([^\]]*)\]$/.exec(line) || /^(.+),\s*([^,\s[\]]+)\s*->\s*([^,\s[\]]+)$/.exec(line);
    if (m) {
      seenTransition = true;
      transitions.push({ id: `t${transitions.length + 1}`, from: ensure(m[2]), to: ensure(m[3]), symbol: m[1].trim() });
      continue;
    }
    if (line.startsWith('#')) continue;
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
export function baText(target, { warn = () => {} } = {}) {
  if (target.machine === 'DFA' || target.machine === 'NFA') {
    warn('BA files are read as Büchi automata by RABIT and GOAL: this finite automaton will read back as one, accepting infinite words that visit F infinitely often. Tools that take BA for finite automata (Ultimate) read it as written.');
  }
  const ok = ['DBA', 'NBA', 'DWA', 'NWA', 'DFA', 'NFA'];
  if (!ok.includes(target.machine)) {
    throw new CliError(`BA holds Büchi and finite automata; ${aMachine(target.machine)} is neither.${target.machine === 'ε-NFA' ? ' Remove the ε-moves first (automata eps-elim).' : ''}`);
  }
  if (!(target.accepts || []).length) {
    throw new CliError('The machine has no accepting states, and a BA file with none is read as "every state accepts". There is no faithful BA file for it.');
  }
  const sym = target.config?.sym || {};
  const letters = [...new Set(target.sigma)].filter(s => s !== sym.eps && s !== sym.any);
  // A state name is written as itself when it is a plain identifier, and as
  // s0, s1, … otherwise: a bracket or an arrow in it would end the field early.
  const name = safeNames(target.states);
  const lines = [`[${name.get(target.startId)}]`];
  for (const t of target.transitions) {
    const syms = t.symbol === sym.any ? letters : [t.symbol];
    for (const a of syms) lines.push(`${a},[${name.get(t.from)}]->[${name.get(t.to)}]`);
  }
  for (const id of target.accepts) lines.push(`[${name.get(id)}]`);
  return lines.join('\n') + '\n';
}
