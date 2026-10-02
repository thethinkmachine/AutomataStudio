// equiv, diff, similar — two machines, or many, side by side.
import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { App, getMachineConfig } from '../../js/state.js';
import { compareMachines, withMachine } from '../../js/exercise/grade.js';
import { decideMachine, decideWord } from '../../js/machines/index.js';
import { decideRaw, languageFingerprint, minimalDfaOf } from '../../js/library/analyze.js';
import { canonicalCodeOf, hash64 } from '../../js/library/hash.js';
import { readMachine, CliError } from '../io.mjs';
import { FA_TYPES, lettersOf, symOf } from '../fa.mjs';
import { c, print, printJson, table, wordOf } from '../out.mjs';

/**
 * A word as tokens, decided the way the grader decides it: a symbol outside
 * the machine's Σ has no move, so the run rejects rather than failing to parse.
 */
export function verdictOnTokens(target, tokens) {
  return withMachine(target, () => {
    try { return decideWord(target.machine, tokens) || { verdict: 'unk', output: null }; }
    catch { return { verdict: 'unk', output: null }; }
  });
}

// ── ω-automata: equivalence on lassos ─────────────────────────────

function* words(sigma, len) {
  if (len === 0) { yield []; return; }
  for (const w of words(sigma, len - 1)) for (const a of sigma) yield [...w, a];
}

/**
 * Every ultimately periodic word u(v) with |u| + |v| ≤ size and v non-empty,
 * shortest first. Two ω-regular languages that agree on all of them up to a
 * large enough size are equal (they are determined by their lassos), but
 * "large enough" depends on the automata, so this is a bounded check and says so.
 */
export function* lassos(sigma, size) {
  for (let total = 1; total <= size; total++) {
    for (let lv = 1; lv <= total; lv++) {
      for (const u of words(sigma, total - lv)) for (const v of words(sigma, lv)) yield { u, v };
    }
  }
}

export function decideOmega(target, u, v) {
  return withMachine(target, () => {
    try { return decideMachine(target.machine, { u, v })?.verdict ?? 'unk'; }
    catch { return 'unk'; }
  });
}

export function compareOmega(a, b, { size = 6, maxWords = 20000 } = {}) {
  const sigma = [...new Set([...lettersOf(a), ...lettersOf(b)])].sort();
  let n = 0, undecided = false;
  for (const { u, v } of lassos(sigma, size)) {
    if (++n > maxWords) break;
    const x = decideOmega(a, u, v), y = decideOmega(b, u, v);
    if (x === 'unk' || y === 'unk') { undecided = true; continue; }
    if (x !== y) return { equal: false, method: 'lassos', u, v, aAccepts: x === 'acc' };
  }
  return { equal: undecided ? null : true, method: 'lassos', words: Math.min(n, maxWords) };
}

/** The strongest comparison available: exact for finite automata, bounded otherwise. */
export function compare(a, b, { maxLength = 8, maxWords = 20000, size = 6 } = {}) {
  const ca = getMachineConfig(a.machine) || {}, cb = getMachineConfig(b.machine) || {};
  if (ca.isOmega || cb.isOmega) {
    if (!(ca.isOmega && cb.isOmega)) throw new CliError('One machine reads infinite words and the other finite ones; they have no language in common to compare.');
    return compareOmega(a, b, { size, maxWords });
  }
  // Two transducers with no acceptance switched on are functions from words to
  // outputs: their accept marks are not part of what they do, so they must not
  // decide the comparison. With every state accepting, a run that reads the
  // whole word "accepts" on both sides and only the outputs can differ.
  const outputsOnly = ca.isTransducer && cb.isTransducer && !a.config?.transducerAccepts && !b.config?.transducerAccepts;
  if (outputsOnly) {
    a = { ...a, accepts: a.states.map(s => s.id) };
    b = { ...b, accepts: b.states.map(s => s.id) };
  }
  // The machines actually compared ride along, so a witness is decided on the
  // same footing as the comparison that found it.
  return { ...compareMachines(a, b, { maxLength, maxWords, sym: symOf(a) }), outputsOnly, compared: [a, b] };
}

// ── equiv ─────────────────────────────────────────────────────────

const equiv = {
  usage: `automata equiv <machine-a> <machine-b>

Exact for two finite automata (a product search, with the shortest word they
disagree on). Otherwise every word of Σ* up to --max-length is run on both —
comparing outputs as well for transducers — and ω-automata are compared on
every ultimately periodic word u(v) up to --size symbols.

  --max-length N    bound for the finite-word check (default 8)
  --size N          bound for the lasso check (default 6)
  --json

Exit: 0 equal, 1 different, 2 no difference found but some word was undecided,
or the check was bounded (use --json to see which).`,
  options: { 'max-length': { type: 'string' }, size: { type: 'string' } },
  async run({ args, opts }) {
    if (args.length < 2) throw new CliError('equiv takes two machines.');
    const A = readMachine(args[0]), B = readMachine(args[1]);
    const r = compare(A.target, B.target, { maxLength: Number(opts['max-length'] ?? 8), size: Number(opts.size ?? 6) });
    const eps = App.config.sym.eps;
    let witness = null;
    if (r.equal === false) {
      if (r.method === 'lassos') witness = { word: `${wordOf(r.u, '')}(${wordOf(r.v, '')})`, acceptedBy: r.aAccepts ? A.name : B.name };
      else {
        const w = wordOf(r.tokens, eps);
        const [ta, tb] = r.compared || [A.target, B.target];
        const va = verdictOnTokens(ta, r.tokens), vb = verdictOnTokens(tb, r.tokens);
        witness = { word: w, a: va.verdict, b: vb.verdict, aOutput: va.output ?? null, bOutput: vb.output ?? null };
      }
    }
    const exact = r.method === 'exact';
    if (opts.json) printJson({ equal: r.equal, method: r.method, exact, witness, checked: r.words ?? null });
    else if (r.equal === true) print(`${c.green('equal')}${exact ? '' : c.dim(` — no difference on ${r.words} ${r.method === 'lassos' ? 'lassos' : 'words'} (a bounded check)`)}`);
    else if (r.equal === null) print(`${c.yellow('undecided')} — no difference found, but some word had no verdict within the budget`);
    else {
      print(c.red('different'));
      if (witness.acceptedBy) print(`${witness.word} is accepted by ${witness.acceptedBy} only`);
      else {
        const out = o => [].concat(o).join('') || eps;
        const say = (v, o) => (r.outputsOnly
          // Every state accepts here, so a reject is a run that could not read
          // the whole word — not an output of ε.
          ? (v === 'unk' ? 'gives no output within the budget' : v === 'rej' ? 'cannot read the whole word' : `outputs ${out(o)}`)
          : `${v === 'acc' ? 'accepts' : v === 'rej' ? 'rejects' : 'gives no verdict'}${o != null ? ` (→ ${out(o)})` : ''}`);
        print(`${witness.word}: ${A.name} ${say(witness.a, witness.aOutput)}, ${B.name} ${say(witness.b, witness.bOutput)}`);
      }
    }
    if (r.equal === false) return 1;
    if (r.equal === null) return 2;
    return 0;
  }
};

// ── diff ──────────────────────────────────────────────────────────

/** A stable, coordinate-free listing of a machine — what git's textconv shows. */
export function textListing(target) {
  const sym = symOf(target);
  const name = new Map(target.states.map(s => [s.id, String(s.name ?? s.id)]));
  const acc = new Set(target.accepts || []);
  const lines = [`machine ${target.machine}`, `sigma {${lettersOf(target).join(', ')}}`];
  if ((target.stackAlpha || []).length) lines.push(`gamma {${[...target.stackAlpha].sort().join(', ')}}`);
  if ((target.outputAlpha || []).length) lines.push(`output {${[...target.outputAlpha].sort().join(', ')}}`);
  if (target.tapeCount > 1) lines.push(`tapes ${target.tapeCount}`);
  lines.push(`start ${name.get(target.startId) ?? '(none)'}`);
  for (const s of [...target.states].sort((x, y) => String(x.name ?? x.id).localeCompare(String(y.name ?? y.id)))) {
    const marks = [acc.has(s.id) ? 'accepting' : null, s.priority !== undefined ? `priority ${s.priority}` : null, s.output !== undefined && s.output !== '' ? `output ${s.output}` : null, s.blockId ? `in ${s.blockId}` : null].filter(Boolean);
    lines.push(`state ${name.get(s.id)}${marks.length ? `  (${marks.join(', ')})` : ''}`);
  }
  const edges = target.transitions.map(t => `${name.get(t.from)} --${edgeLabel(t, sym)}--> ${name.get(t.to)}`).sort();
  for (const e of edges) lines.push(e);
  return lines.join('\n') + '\n';
}

function edgeLabel(t, sym) {
  const parts = [];
  if (t.tapeSyms) parts.push(t.tapeSyms.map((r, k) => `${r}/${t.tapeWrites?.[k] ?? r},${t.tapeDirs?.[k] ?? 'S'}`).join(' | '));
  else parts.push(t.symbol ?? sym.eps);
  if (t.write !== undefined && !t.tapeSyms) parts.push(`/${t.write},${t.dir ?? 'S'}`);
  if (t.pop !== undefined || t.push !== undefined) parts.push(`, ${t.pop ?? sym.eps}→${t.push ?? sym.eps}`);
  if (t.pop2 !== undefined || t.push2 !== undefined) parts.push(`; ${t.pop2 ?? sym.eps}→${t.push2 ?? sym.eps}`);
  if (t.below !== undefined || t.above !== undefined) parts.push(` [${t.below ?? ''}|${t.above ?? ''}]`);
  if (t.output !== undefined && t.output !== null) parts.push(` / ${t.output}`);
  if (t.weight !== undefined && t.weight !== null) parts.push(` @${t.weight}`);
  return parts.join('');
}

export function structuralDiff(a, b) {
  const sa = symOf(a);
  const nameA = new Map(a.states.map(s => [s.id, String(s.name ?? s.id)]));
  const nameB = new Map(b.states.map(s => [s.id, String(s.name ?? s.id)]));
  const setA = new Set(nameA.values()), setB = new Set(nameB.values());
  const edgesOf = (t, names) => new Set(t.transitions.map(x => `${names.get(x.from)} --${edgeLabel(x, sa)}--> ${names.get(x.to)}`));
  const accOf = (t, names) => new Set((t.accepts || []).map(id => names.get(id)));
  const minus = (x, y) => [...x].filter(v => !y.has(v)).sort();
  const ea = edgesOf(a, nameA), eb = edgesOf(b, nameB);
  const aa = accOf(a, nameA), ab = accOf(b, nameB);
  const out = {
    type: a.machine === b.machine ? null : [a.machine, b.machine],
    sigma: { added: minus(new Set(lettersOf(b)), new Set(lettersOf(a))), removed: minus(new Set(lettersOf(a)), new Set(lettersOf(b))) },
    states: { added: minus(setB, setA), removed: minus(setA, setB) },
    start: nameA.get(a.startId) === nameB.get(b.startId) ? null : [nameA.get(a.startId) ?? null, nameB.get(b.startId) ?? null],
    accepting: { added: minus(ab, aa), removed: minus(aa, ab) },
    transitions: { added: minus(eb, ea), removed: minus(ea, eb) }
  };
  out.same = !out.type && !out.start && ['sigma', 'states', 'accepting', 'transitions'].every(k => !out[k].added.length && !out[k].removed.length);
  const codeA = canonicalCodeOf({ ...a }, { flat: true }), codeB = canonicalCodeOf({ ...b }, { flat: true });
  out.isomorphic = !!codeA && codeA === codeB;
  return out;
}

const diff = {
  usage: `automata diff <old> <new>
       automata diff --textconv <machine>

What changed between two versions: the type, Σ, states, start, accepting states
and transitions (matched by state name, so moving a state on the canvas is not
a change), whether the two are the same machine up to renaming, and whether the
language changed — with the shortest word that tells them apart.

--textconv prints a stable listing with no coordinates, for git:

  git config diff.automaton.textconv "automata diff --textconv"
  echo "*.automaton diff=automaton" >> .gitattributes

and as a difftool:  git difftool -x "automata diff" -- machine.automaton

  --no-language     skip the language comparison
  --json

Exit: 0 no change to the language, 1 the language changed, 2 undecided.`,
  options: { textconv: { type: 'boolean' }, 'no-language': { type: 'boolean' }, 'max-length': { type: 'string' } },
  async run({ args, opts }) {
    if (opts.textconv) {
      const { target } = readMachine(args[0] ?? '-');
      process.stdout.write(textListing(target));
      return 0;
    }
    if (args.length < 2) throw new CliError('diff takes two machines (or --textconv and one).');
    const A = readMachine(args[0]), B = readMachine(args[1]);
    const d = structuralDiff(A.target, B.target);
    let lang = null;
    if (!opts['no-language']) {
      try {
        const r = compare(A.target, B.target, { maxLength: Number(opts['max-length'] ?? 8) });
        lang = { equal: r.equal, exact: r.method === 'exact', method: r.method };
        if (r.equal === false) {
          if (r.method === 'lassos') lang.word = `${wordOf(r.u, '')}(${wordOf(r.v, '')})`;
          else {
            lang.word = wordOf(r.tokens, App.config.sym.eps);
            const [ta, tb] = r.compared || [A.target, B.target];
            lang.old = verdictOnTokens(ta, r.tokens).verdict;
            lang.new = verdictOnTokens(tb, r.tokens).verdict;
          }
        }
      } catch (e) { lang = { equal: null, error: e.message }; }
    }
    if (opts.json) { printJson({ structure: d, language: lang }); }
    else {
      const line = (label, { added, removed }) => {
        if (!added.length && !removed.length) return;
        print(c.bold(label));
        removed.forEach(x => print(c.red(`  - ${x}`)));
        added.forEach(x => print(c.green(`  + ${x}`)));
      };
      if (d.type) print(`${c.bold('type')}  ${d.type[0]} → ${d.type[1]}`);
      if (d.start) print(`${c.bold('start')}  ${d.start[0]} → ${d.start[1]}`);
      line('Σ', d.sigma);
      line('states', d.states);
      line('accepting', d.accepting);
      line('transitions', d.transitions);
      if (d.same) print(c.dim('no structural change'));
      else if (d.isomorphic) print(c.cyan('the same machine up to renaming states'));
      if (lang) {
        if (lang.equal === true) print(`${c.bold('language')}  unchanged${lang.exact ? '' : c.dim(' (bounded check)')}`);
        else if (lang.equal === false) {
          const say = v => (v === 'acc' ? 'accepted' : v === 'rej' ? 'rejected' : 'undecided');
          print(`${c.bold('language')}  ${c.red('changed')} — ${lang.word}${lang.old ? `: ${say(lang.old)} before, ${say(lang.new)} now` : ''}`);
        } else print(`${c.bold('language')}  ${c.yellow('undecided')}${lang.error ? ` (${lang.error})` : ''}`);
      }
    }
    if (!lang) return d.same ? 0 : 1;
    return lang.equal === false ? 1 : lang.equal === null ? 2 : 0;
  }
};

// ── similar ───────────────────────────────────────────────────────

const READABLE = new Set(['.automaton', '.json', '.jff', '.hoa', '.ba', '.scxml', '.txt']);

export function expandSpecs(specs) {
  const out = [];
  for (const s of specs) {
    let st = null;
    try { st = statSync(s); } catch { /* inline code or missing */ }
    if (st?.isDirectory()) {
      for (const f of readdirSync(s).sort()) {
        const p = join(s, f);
        if (statSync(p).isFile() && READABLE.has(extname(f).toLowerCase())) out.push(p);
      }
    } else out.push(s);
  }
  return out;
}

/**
 * What two machines have to share to be "the same": the minimal DFA's
 * fingerprint for a finite automaton (so different drawings of one language
 * group together), the canonical machine code otherwise (same machine up to
 * renaming) — or, with `bounded`, the verdicts on every word up to that length.
 */
export function signatureOf(target, { bounded = 0 } = {}) {
  if (FA_TYPES.has(target.machine)) {
    const dfa = minimalDfaOf(target);
    if (dfa) return { kind: 'language', key: `L:${languageFingerprint(dfa)}` };
  }
  if (bounded > 0) {
    const sigma = lettersOf(target);
    const cfg = getMachineConfig(target.machine) || {};
    const bits = [];
    if (cfg.isOmega) {
      for (const { u, v } of lassos(sigma, bounded)) bits.push(decideOmega(target, u, v)[0]);
    } else {
      for (let len = 0; len <= bounded; len++) for (const w of words(sigma, len)) {
        const r = decideRaw(target, w.join(' '));
        bits.push(r.verdict[0] + (r.output != null ? `:${[].concat(r.output).join('')}` : ''));
      }
    }
    return { kind: 'behaviour', key: `B:${hash64(`${sigma.join(',')}|${bits.join('')}`)}` };
  }
  const code = canonicalCodeOf({ ...target }, { flat: true });
  return code ? { kind: 'machine', key: `M:${hash64(code)}` } : { kind: 'none', key: null };
}

const similar = {
  usage: `automata similar <machine|dir ...>

Groups machines that are the same: finite automata by language (their minimal
DFAs match, whatever they look like), anything else by structure (the same
machine up to renaming states). --bounded N groups the rest by behaviour
instead: the same verdict (and output) on every word up to length N.

Built for a folder of submissions, where two students' identical answers are
worth a look.

  --bounded N       compare non-finite automata by behaviour up to length N
  --all             list machines that are in no group too
  --json

Exit: 0 no two alike, 1 at least one group.`,
  options: { bounded: { type: 'string' }, all: { type: 'boolean' } },
  async run({ args, opts }) {
    const files = expandSpecs(args.length ? args : ['.']);
    const groups = new Map();
    const errors = [];
    for (const f of files) {
      try {
        const { target } = readMachine(f);
        const sig = signatureOf(target, { bounded: Number(opts.bounded ?? 0) });
        const key = sig.key ?? `unique:${f}`;
        if (!groups.has(key)) groups.set(key, { kind: sig.kind, members: [] });
        groups.get(key).members.push(f);
        (groups.get(key).types ||= []).push(target.machine);
      } catch (e) { errors.push({ file: f, error: e.message }); }
    }
    const shared = [...groups.values()].filter(g => g.members.length > 1);
    const alone = [...groups.values()].filter(g => g.members.length === 1).map(g => g.members[0]);
    if (opts.json) printJson({ groups: shared, alone: opts.all ? alone : undefined, errors });
    else {
      const say = { language: 'same language', machine: 'same machine up to renaming', behaviour: 'same behaviour on every short word' };
      shared.forEach((g, i) => {
        print(c.bold(`group ${i + 1}`) + c.dim(` — ${say[g.kind] || g.kind}`));
        const mixed = new Set(g.types).size > 1;
        g.members.forEach((m, k) => print(`  ${m}${mixed ? c.dim(`  (${g.types[k]})`) : ''}`));
      });
      if (!shared.length) print(c.green(`no two of ${files.length - errors.length} machines are alike`));
      if (opts.all && alone.length) { print(c.bold('alone')); alone.forEach(m => print(`  ${m}`)); }
      errors.forEach(e => print(c.red(`${e.file}: ${e.error}`)));
    }
    return shared.length ? 1 : 0;
  }
};

export const commands = { equiv, diff, similar };
