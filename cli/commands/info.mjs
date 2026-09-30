// info, lint — what a machine is, and what is odd about it.
import { App, getMachineConfig } from '../../js/state.js';
import {
  isDeterministicTarget, isMinimalDfa, languageClassOf, minimalDfaOf, statsOf
} from '../../js/library/analyze.js';
import { withMachine } from '../../js/exercise/grade.js';
import { machineDeterminism, machineGuards, parseMachineInput } from '../../js/machines/index.js';
import { buildFormalDefLatex } from '../../js/render.js';
import { writeStandardTM } from '../../js/interop/standard-tm.js';
import { writeMachineCode } from '../../js/interop/smtf.js';
import { readMachine } from '../io.mjs';
import { FA_TYPES, lettersOf, subsetTable, symOf, toRegex } from '../fa.mjs';
import { c, print, printJson, rule, table, warn } from '../out.mjs';

const strip = s => String(s ?? '').replace(/<[^>]+>/g, '');

/** Empty, finite, universal — exact for a finite automaton, from its subset DFA. */
export function languageFacts(target) {
  const t = subsetTable(target);
  const k = t.sigma.length;
  const acc = new Set(t.acc);
  // Live: can still reach acceptance.
  const live = new Set(t.acc);
  for (let changed = true; changed;) {
    changed = false;
    for (let q = 0; q < t.n; q++) {
      if (live.has(q)) continue;
      for (let a = 0; a < k; a++) if (live.has(t.delta[q * k + a])) { live.add(q); changed = true; break; }
    }
  }
  const empty = !live.has(t.start);
  // Finite iff no cycle among live states (every state in t is reachable).
  let finite = true;
  const color = new Map();
  const stack = [[t.start, 0]];
  if (!empty) {
    color.set(t.start, 1);
    while (stack.length && finite) {
      const top = stack[stack.length - 1];
      const [q, a] = top;
      if (a >= k) { color.set(q, 2); stack.pop(); continue; }
      top[1]++;
      const to = t.delta[q * k + a];
      if (!live.has(to)) continue;
      if (color.get(to) === 1) { finite = false; break; }
      if (!color.has(to)) { color.set(to, 1); stack.push([to, 0]); }
    }
  }
  const universal = [...Array(t.n).keys()].every(q => acc.has(q));
  return { empty, finite, universal, subsetStates: t.n };
}

export function infoOf(target, doc, { latex = false, regex = true } = {}) {
  const cfg = getMachineConfig(target.machine) || {};
  const sym = symOf(target);
  const st = statsOf(target);
  const name = new Map(target.states.map(s => [s.id, String(s.name ?? s.id)]));
  const out = {
    type: target.machine,
    name: cfg.fullName || target.machine,
    class: languageClassOf(target.machine),
    states: st.states,
    transitions: st.transitions,
    sigma: st.sigma,
    start: target.startId ? name.get(target.startId) ?? null : null,
    accepting: (target.accepts || []).map(id => name.get(id) ?? id),
    // What acceptance means for this machine, where F is not the whole story.
    ...(cfg.hasStack && !cfg.hasTape && target.config?.pdaParadigm === 'empty' ? { acceptance: 'empty store' } : {}),
    ...(cfg.omegaCondition ? { acceptance: cfg.omegaCondition } : {}),
    ...(cfg.omegaCondition === 'parity' ? { priorities: Object.fromEntries(target.states.map(s => [name.get(s.id), Number(s.priority) || 0])) } : {}),
    deterministic: isDeterministicTarget(target)
  };
  if (cfg.hasStack && !cfg.hasTape) out.stackAlphabet = target.stackAlpha;
  if (cfg.hasTape) out.tapeAlphabet = target.stackAlpha;
  if (cfg.isTransducer) out.outputAlphabet = target.outputAlpha;
  if (target.tapeCount > 1) out.tapes = target.tapeCount;
  if (st.blocks) out.blocks = st.blocks;
  if (FA_TYPES.has(target.machine)) {
    const dfa = minimalDfaOf(target);
    if (dfa) {
      out.minimalDfaStates = dfa.n - (dfa.dead >= 0 ? 1 : 0);
      out.minimalDfaStatesComplete = dfa.n;
      if (target.machine === 'DFA') out.minimal = isMinimalDfa(target, dfa);
    }
    Object.assign(out, languageFacts(target));
    if (regex) {
      try { out.regex = toRegex(target); } catch { /* too large: leave it out */ }
    }
  }
  if (target.machine === 'TM' || target.machine === 'ITM') {
    const std = writeStandardTM(target, sym);
    if (std) out.standard = std;
  }
  try { out.code = writeMachineCode(doc, { sym, labels: false }).code; } catch { /* not every machine has one */ }
  if (latex) out.latex = withMachine(target, () => buildFormalDefLatex());
  return out;
}

const info = {
  usage: `automata info <machine>

Type, language class, size, alphabets, start and accepting states, whether δ is
deterministic; for a finite automaton also the minimal DFA's size, whether the
language is empty, finite or universal, and a regular expression; for a Turing
machine its standard notation; and the machine code that names it.

  --latex           include the formal definition as LaTeX
  --no-regex        skip the regular expression (large automata)
  --json`,
  options: { latex: { type: 'boolean' }, 'no-regex': { type: 'boolean' } },
  async run({ args, opts }) {
    const { target, doc, warnings } = readMachine(args[0]);
    if (!opts.quiet) warnings.forEach(warn);
    const i = infoOf(target, doc, { latex: !!opts.latex, regex: !opts['no-regex'] });
    if (opts.json) { printJson(i); return 0; }
    const set = xs => `{${xs.map(x => c.cyan(x)).join(', ')}}`;
    const states = xs => (xs.length ? xs.map(x => c.violet(x)).join(', ') : c.faint('none'));
    const section = (title, rows) => {
      print(rule(title));
      print(table(rows.filter(Boolean).map(([k, v]) => [`  ${c.muted(k)}`, v])));
      print('');
    };
    section('Machine', [
      ['type', `${c.bold(c.accent(i.type))} ${c.muted('—')} ${i.name}`],
      ['size', `${c.bold(i.states)} states, ${c.bold(i.transitions)} transitions${i.tapes ? `, ${i.tapes} tapes` : ''}${i.blocks ? `, ${i.blocks} blocks` : ''}`],
      ['Σ', set(i.sigma)],
      i.stackAlphabet && ['Γ', set(i.stackAlphabet)],
      i.tapeAlphabet && ['Γ', set(i.tapeAlphabet)],
      i.outputAlphabet && ['output', set(i.outputAlphabet)],
      ['start', i.start ? c.violet(i.start) : c.red('none')],
      i.acceptance === 'empty store'
        ? ['accepts by', `empty store ${c.faint('(F is not used)')}`]
        : i.priorities
          ? ['priorities', `${Object.entries(i.priorities).map(([s, p]) => `${c.violet(s)} ${c.bold(p)}`).join(c.faint(', '))}  ${c.faint('accept: the least priority seen forever is even')}`]
          : ['accepting', `${states(i.accepting)}${i.acceptance === 'cobuchi' ? `  ${c.faint('co-Büchi: visited only finitely often')}` : i.acceptance ? `  ${c.faint(`${i.acceptance === 'weak' ? 'weak' : 'Büchi'}: visited infinitely often`)}` : ''}`],
      ['deterministic', i.deterministic ? c.green('yes') : c.yellow('no')]
    ]);
    const language = [
      ['class', i.class || c.faint('—')],
      i.empty !== undefined && ['language', i.empty ? c.red('empty') : [i.finite ? 'finite' : 'infinite', i.universal ? c.green('universal (Σ*)') : null].filter(Boolean).join(', ')],
      i.minimalDfaStates !== undefined && ['minimal DFA', `${c.bold(i.minimalDfaStates)} states ${c.faint(`(${i.minimalDfaStatesComplete} with the sink)`)}${i.minimal !== undefined ? (i.minimal ? `  ${c.green('✔ this DFA is minimal')}` : `  ${c.yellow('this DFA is not minimal — automata minimize')}`) : ''}`],
      i.regex && ['regex', c.teal(i.regex)]
    ];
    section('Language', language);
    if (i.standard || i.code || i.latex) {
      section('Names', [
        i.standard && ['standard', c.orange(i.standard)],
        i.code && ['code', c.muted(i.code)],
        i.latex && ['LaTeX', i.latex]
      ]);
    }
    return 0;
  }
};

// ── lint ──────────────────────────────────────────────────────────

/**
 * Findings, each `{ level: 'error'|'warning'|'info', rule, message }`.
 * Errors make a machine unusable, warnings are almost always mistakes, and
 * infos are worth knowing but often deliberate.
 */
export function lintTarget(target) {
  const cfg = getMachineConfig(target.machine) || {};
  const sym = symOf(target);
  const found = [];
  const add = (level, rule, message) => found.push({ level, rule, message });
  const name = new Map(target.states.map(s => [s.id, String(s.name ?? s.id)]));
  const nm = id => name.get(id) ?? id;
  const ids = new Set(target.states.map(s => s.id));

  if (!target.startId || !ids.has(target.startId)) add('error', 'no-start', 'The machine has no start state.');
  for (const t of target.transitions) {
    if (!ids.has(t.from) || !ids.has(t.to)) add('error', 'dangling-edge', `Transition ${t.id} points at a state that does not exist.`);
  }

  // Reachability, forwards from the start and backwards from F.
  const out = new Map(target.states.map(s => [s.id, []]));
  const inn = new Map(target.states.map(s => [s.id, []]));
  for (const t of target.transitions) {
    if (ids.has(t.from) && ids.has(t.to)) { out.get(t.from).push(t.to); inn.get(t.to).push(t.from); }
  }
  const walk = (seeds, adj) => {
    const seen = new Set(seeds), stack = [...seeds];
    while (stack.length) for (const n of adj.get(stack.pop()) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    return seen;
  };
  const reach = target.startId && ids.has(target.startId) ? walk([target.startId], out) : new Set();
  const unreachable = target.states.filter(s => !reach.has(s.id) && !s.blockId);
  if (reach.size && unreachable.length) {
    add('warning', 'unreachable', `Unreachable from the start: ${unreachable.map(s => nm(s.id)).join(', ')}.`);
  }

  const usesPriority = cfg.omegaCondition === 'parity';
  const hasVerdict = !cfg.isTransducer || !!target.config?.transducerAccepts;
  // A store machine may accept by empty store instead of by F, and then F
  // being empty — and states that cannot reach it — say nothing.
  const acceptsByStore = cfg.hasStack && !cfg.hasTape && target.config?.pdaParadigm === 'empty';
  if (!usesPriority && hasVerdict && !acceptsByStore && cfg.omegaCondition !== 'cobuchi') {
    if (!(target.accepts || []).length) add('warning', 'no-accepting', 'No state accepts, so the language is empty.');
    else {
      const coreach = walk(target.accepts, inn);
      const dead = target.states.filter(s => reach.has(s.id) && !coreach.has(s.id));
      // A single rejecting sink is the usual way to complete a DFA — say so quietly.
      const sinks = dead.filter(s => out.get(s.id).every(to => to === s.id));
      const others = dead.filter(s => !sinks.includes(s));
      if (others.length) add('warning', 'dead', `No accepting state can be reached from: ${others.map(s => nm(s.id)).join(', ')}.`);
      if (sinks.length > 1) add('info', 'sinks', `${sinks.length} rejecting sinks (${sinks.map(s => nm(s.id)).join(', ')}) — one is enough.`);
    }
  }
  if (usesPriority) {
    const none = target.states.filter(s => s.priority === undefined || s.priority === null || s.priority === '');
    if (none.length) add('warning', 'no-priority', `No priority on: ${none.map(s => nm(s.id)).join(', ')} (read as 0).`);
  }

  // Alphabets. The wildcard reads every symbol, so it uses all of Σ.
  const letters = lettersOf(target);
  const read = new Set();
  let wildcard = false;
  for (const t of target.transitions) {
    const syms = t.tapeSyms ? t.tapeSyms : [t.symbol];
    for (const s of syms) { if (s === sym.any) wildcard = true; else if (s != null) read.add(s); }
  }
  if (!wildcard && !cfg.hasTape) {
    const unused = letters.filter(a => !read.has(a));
    if (unused.length) add('info', 'unused-symbol', `Σ symbols no transition reads: ${unused.join(', ')}.`);
  }
  if (!cfg.hasTape) {
    const special = new Set([sym.eps, sym.any, sym.leftMarker, sym.rightMarker]);
    const stray = [...read].filter(s => !special.has(s) && !letters.includes(s));
    if (stray.length && !cfg.hasEndMarkers) add('warning', 'not-in-sigma', `Transitions read symbols that are not in Σ: ${stray.join(', ')}.`);
  }

  // Duplicate edges.
  const seen = new Map();
  for (const t of target.transitions) {
    const { id, curve, loopAngle, ...rest } = t;
    const key = JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]]));
    if (seen.has(key)) add('warning', 'duplicate-edge', `Transitions ${seen.get(key)} and ${id} are identical.`);
    else seen.set(key, id);
  }
  const names = new Map();
  for (const s of target.states) {
    const n = String(s.name ?? '');
    if (n && names.has(n)) add('warning', 'duplicate-name', `Two states are called ${n}.`);
    names.set(n, s.id);
  }

  // Determinism: a D-type that branches cannot be run; an N-type that does not is worth knowing.
  const rule = machineDeterminism(target.machine);
  if (rule) {
    withMachine(target, () => {
      for (const t of target.transitions) {
        const clash = rule.conflict(t, t.id);
        if (clash) { add('error', 'branches', `${target.machine} branches at ${nm(t.from)} on ${t.symbol ?? '?'}${rule.say ? ` — ${strip(typeof rule.say === 'function' ? rule.say(clash) : rule.say)}` : ''}.`); break; }
      }
    });
  } else if ((target.machine === 'NFA' || target.machine === 'ε-NFA') && isDeterministicTarget(target)) {
    add('info', 'could-be-dfa', `δ never branches and has no ε-moves: this ${target.machine} is already a (partial) DFA.`);
  }

  // The machine's own guards, as the player would run them.
  withMachine(target, () => {
    let input = null;
    try {
      const probe = cfg.isOmega ? `(${letters[0] ?? ''})` : '';
      const p = parseMachineInput(target.machine, probe);
      if (p.ok) input = p.input;
    } catch { /* guard gets null */ }
    try {
      for (const g of machineGuards(target.machine, input)) {
        const msg = strip(g.refuse || g.warn || g.message || g.say || '');
        if (msg && !found.some(f => f.rule === 'branches')) add(g.refuse ? 'error' : 'warning', g.refuse ? 'guard' : 'guard-warning', msg);
      }
    } catch { /* a guard that needs a real word says nothing here */ }
  });

  // Turing machines: a reachable working state with no move on blank halts there.
  if (cfg.hasTape && !target.tapeCount || (cfg.hasTape && target.tapeCount === 1)) {
    const acc = new Set(target.accepts || []);
    for (const s of target.states) {
      if (!reach.has(s.id) || acc.has(s.id)) continue;
      const mine = target.transitions.filter(t => t.from === s.id);
      if (!mine.length) continue;
      if (!mine.some(t => t.symbol === sym.blank || t.symbol === sym.any)) {
        add('info', 'no-blank-move', `${nm(s.id)} has no move on ${sym.blank}: reaching blank tape there halts without accepting.`);
      }
    }
  }
  return found;
}

const lint = {
  usage: `automata lint <machine ...>

Findings are errors (the machine cannot be run as drawn), warnings (almost
always a mistake) and infos (worth knowing, often deliberate):

  no-start, dangling-edge, branches, guard          errors
  unreachable, dead, no-accepting, not-in-sigma,
  duplicate-edge, duplicate-name, no-priority       warnings
  unused-symbol, sinks, could-be-dfa, no-blank-move info

  --strict          infos count too
  --json

Exit: 0 nothing found, 1 an error or warning (or an info under --strict).`,
  options: { strict: { type: 'boolean' } },
  async run({ args, opts }) {
    if (!args.length) args = ['-'];
    const all = [];
    for (const spec of args) {
      const { target, name } = readMachine(spec);
      all.push({ file: name, findings: lintTarget(target) });
    }
    if (opts.json) printJson(args.length === 1 ? all[0] : all);
    else {
      const colour = { error: c.red, warning: c.yellow, info: c.cyan };
      for (const { file, findings } of all) {
        if (args.length > 1 || !findings.length) print(c.bold(file) + (findings.length ? '' : c.green('  no findings')));
        for (const f of findings) print(`  ${colour[f.level](f.level.padEnd(7))} ${c.dim(f.rule.padEnd(15))} ${f.message}`);
      }
    }
    const counts = all.flatMap(a => a.findings).filter(f => f.level !== 'info' || opts.strict);
    return counts.length ? 1 : 0;
  }
};

export const commands = { info, lint };
