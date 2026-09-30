// grade, generate — a class's worth of exercises, from the command line.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { App, getMachineConfig } from '../../js/state.js';
import { gradeExercise, wordText } from '../../js/exercise/grade.js';
import { normalizeExercise, sealTarget, unsealTarget, validateExercise } from '../../js/exercise/model.js';
import { minimalDfaOf } from '../../js/library/analyze.js';
import { readMachine, docFromTarget, docText, emit, CliError } from '../io.mjs';
import { expandSpecs } from './compare.mjs';
import { dfaTableToTarget, lettersOf, listAccepted, minimize, randomDfa, seeded, toRegex, fromRegex } from '../fa.mjs';
import { languageFacts } from './info.mjs';
import { c, print, printJson, table, warn } from '../out.mjs';

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The exercise a file describes: its own `exercise` if it has one (what the
 * app's Create Exercise writes), otherwise the machine in it as the reference,
 * with the limits given on the command line.
 */
function loadExercise(spec, opts) {
  const { doc, target } = readMachine(spec, { allowEmpty: true });
  if (doc.exercise) {
    try { validateExercise(doc.exercise); } catch (e) { throw new CliError(`${spec}: ${e.message}`); }
    return normalizeExercise(doc.exercise);
  }
  if (!target.states.length) throw new CliError(`${spec}: neither an exercise nor a machine to use as the reference.`);
  const allow = opts.allow ? opts.allow.split(',').map(s => s.trim()).filter(Boolean) : [];
  return normalizeExercise({
    title: doc.meta?.title || 'Exercise',
    target: sealTarget(target),
    answer: 'machine',
    allow,
    maxStates: opts['max-states'] ?? null,
    maxLength: opts['max-length'] ?? 8
  });
}

function answerOf(spec, ex) {
  const { doc, target } = readMachine(spec);
  if (ex.answer === 'grammar') {
    const g = doc.grammar;
    if (!g || !(g.productions || []).length) throw new CliError('the file has no grammar');
    return { kind: 'grammar', grammar: { vars: g.vars || [], start: g.start, productions: g.productions } };
  }
  return target;
}

function summarize(result, sym) {
  const cx = result.counterexample;
  const word = cx ? wordText(cx.tokens, sym) : '';
  const say = v => (v?.verdict === 'acc' ? 'accept' : v?.verdict === 'rej' ? 'reject' : 'no verdict');
  return {
    status: result.status,
    method: result.method,
    counterexample: cx ? word : null,
    expected: cx ? say(cx.expected) + (cx.expected?.output != null ? ` → ${[].concat(cx.expected.output).join('')}` : '') : null,
    got: cx ? say(cx.got) + (cx.got?.output != null ? ` → ${[].concat(cx.got.output).join('')}` : '') : null,
    problems: result.problems || [],
    notes: result.notes || []
  };
}

const grade = {
  usage: `automata grade <exercise> <submission | dir ...>

Grades each submission the way the app's exercise panel does: exactly for
finite automata, word by word up to the exercise's length bound otherwise.
The exercise is an .automaton file with an exercise in it (the app's
Create Exercise writes one), or any machine, which is then the reference.

  --csv FILE            one row per submission (default: a table on stdout)
  --gradescope FILE     Gradescope's results.json, for one submission
  --points N            score for a correct answer (default 1)
  --allow DFA,NFA       for a bare reference: the machine types accepted
  --max-states N        for a bare reference: the most states allowed
  --max-length N        for a bare reference: the bound for non-exact grading
  --json

Exit: 0 every submission passed, 1 one did not.`,
  options: {
    csv: { type: 'string' }, gradescope: { type: 'string' }, points: { type: 'string' },
    allow: { type: 'string' }, 'max-states': { type: 'string' }, 'max-length': { type: 'string' }
  },
  async run({ args, opts }) {
    const [exSpec, ...rest] = args;
    if (!exSpec || !rest.length) throw new CliError('Give an exercise and at least one submission.');
    const ex = loadExercise(exSpec, opts);
    const target = unsealTarget(ex.target);
    const points = Number(opts.points ?? 1);
    const sym = App.config.sym;
    const files = expandSpecs(rest).filter(f => f !== exSpec);
    const rows = files.map(file => {
      try {
        const answer = answerOf(file, ex);
        const r = summarize(gradeExercise(ex, answer, { target }), sym);
        const solved = r.status === 'correct' || r.status === 'passed';
        return { file, ...r, score: solved ? points : 0 };
      } catch (e) {
        return { file, status: 'error', method: null, problems: [e.message], notes: [], score: 0 };
      }
    });

    if (opts.gradescope) {
      if (rows.length !== 1) throw new CliError('--gradescope writes the results of one submission; give exactly one.');
      const r = rows[0];
      const lines = [];
      if (r.status === 'correct') lines.push('Correct — proved equal to the reference.');
      else if (r.status === 'passed') lines.push('Passed every word checked.');
      else if (r.counterexample !== null && r.counterexample !== undefined) lines.push(`On ${r.counterexample || sym.eps} the reference says ${r.expected}; your machine says ${r.got}.`);
      lines.push(...r.problems, ...r.notes);
      const results = {
        score: r.score,
        output: lines.join('\n'),
        tests: [{ name: ex.title, score: r.score, max_score: points, output: lines.join('\n'), status: r.score === points ? 'passed' : 'failed' }]
      };
      writeFileSync(opts.gradescope, JSON.stringify(results, null, 2) + '\n');
    }
    if (opts.csv) {
      const head = ['file', 'status', 'method', 'score', 'counterexample', 'expected', 'got', 'problems', 'notes'];
      const lines = [head.join(',')].concat(rows.map(r => [r.file, r.status, r.method ?? '', r.score, r.counterexample ?? '', r.expected ?? '', r.got ?? '', r.problems.join(' | '), r.notes.join(' | ')].map(csvCell).join(',')));
      writeFileSync(opts.csv, lines.join('\n') + '\n');
    }
    if (opts.json) printJson({ exercise: ex.title, rows });
    else if (!opts.csv || rows.length <= 40) {
      const colour = { correct: c.green, passed: c.green, incorrect: c.red, inconclusive: c.yellow, invalid: c.magenta, error: c.magenta };
      print(table(rows.map(r => [
        r.file, colour[r.status](r.status), String(r.score),
        r.counterexample !== null && r.counterexample !== undefined ? `${r.counterexample || sym.eps}: expected ${r.expected}, got ${r.got}` : (r.problems[0] || '')
      ]), { head: ['submission', 'status', 'score', ''] }));
      const ok = rows.filter(r => r.score === points).length;
      print(`\n${ok} of ${rows.length} correct${opts.csv ? c.dim(` — ${opts.csv}`) : ''}`);
    }
    return rows.every(r => r.score === points) ? 0 : 1;
  }
};

// ── generate ──────────────────────────────────────────────────────

function studentDoc(target, ex) {
  const blank = docFromTarget({ ...target, states: [], transitions: [], startId: null, accepts: [] });
  return {
    ...blank,
    machine: ex.allow[0] || 'DFA',
    notes: [], dividers: [], scope: [],
    grammar: { vars: ['S'], start: 'S', productions: [] },
    cam: { x: 0, y: 0, z: 1 },
    meta: null,
    exercise: ex
  };
}

const generate = {
  usage: `automata generate [--states N] [--sigma 01] [--count K] [-o dir]

Random DFA exercises with the properties asked for, each with an answer key.
The student's file (exercise-1.automaton, …) opens in the app as an exercise
on a blank canvas; the key (key-1.automaton) is the reference DFA, drawn.

  --states N        states in the minimal DFA (default 4)
  --sigma 01        the alphabet (default 01)
  --count K         how many (default 1)
  --seed S          the same exercises again
  --prompt KIND     regex (the language as a regular expression, default) or
                    examples (words it accepts and rejects)
  --from-regex RE   one exercise from a regular expression instead of at random
  --allow TYPES     machine types a student may answer with (default DFA,NFA,ε-NFA)
  --max-states N    the most states an answer may have
  --infinite        only languages with infinitely many words
  -o, --output DIR  where to write (default: the current directory)
  --json            print the exercises instead of writing files`,
  options: {
    states: { type: 'string', short: 'n' }, sigma: { type: 'string' }, count: { type: 'string' }, seed: { type: 'string' },
    prompt: { type: 'string' }, 'from-regex': { type: 'string' }, allow: { type: 'string' }, 'max-states': { type: 'string' },
    infinite: { type: 'boolean' }, output: { type: 'string', short: 'o' }
  },
  async run({ opts }) {
    const n = Number(opts.states ?? 4);
    // From a regex with no --sigma, the alphabet is the regex's own letters:
    // a default of {0, 1} merged into a regex over {a, b} would make every
    // language look neither empty nor universal.
    const sigma = opts.sigma
      ? (opts.sigma.includes(',') ? opts.sigma.split(',').map(s => s.trim()) : [...opts.sigma])
      : opts['from-regex'] ? lettersOf(fromRegex(opts['from-regex'])) : ['0', '1'];
    const count = Number(opts.count ?? 1);
    const rnd = opts.seed !== undefined ? seeded(opts.seed) : Math.random;
    const allow = opts.allow ? opts.allow.split(',').map(s => s.trim()) : ['DFA', 'NFA', 'ε-NFA'];
    const promptKind = opts.prompt ?? 'regex';
    const made = [];
    const seen = new Set();
    let tries = 0;
    while (made.length < count) {
      if (++tries > 20000) throw new CliError(`Found ${made.length} of ${count} after 20000 tries — ask for fewer states or a looser language.`);
      let ref;
      if (opts['from-regex']) ref = minimize(fromRegex(opts['from-regex'], { sigma }));
      else {
        const dfa = minimalDfaOf(randomDfa(n, sigma, { rnd, p: 0.35 + rnd() * 0.3 }));
        if (!dfa || dfa.n - (dfa.dead >= 0 ? 1 : 0) !== n) continue;
        ref = dfaTableToTarget(dfa);
      }
      const facts = languageFacts(ref);
      if (facts.empty || facts.universal) { if (opts['from-regex']) break; continue; }
      if (opts.infinite && facts.finite) { if (opts['from-regex']) break; continue; }
      const key = JSON.stringify([ref.transitions.map(t => [t.from, t.symbol, t.to]), ref.accepts]);
      if (seen.has(key)) continue;
      seen.add(key);
      const i = made.length + 1;
      let prompt;
      if (promptKind === 'examples') {
        const acc = listAccepted(ref, 6, 6).map(w => wordText(w, App.config.sym));
        const all = [];
        for (let len = 0; len <= 4; len++) {
          const walk = (w) => { if (w.length === len) { all.push(w); return; } sigma.forEach(a => walk([...w, a])); };
          walk([]);
        }
        const accSet = new Set(acc);
        const rej = all.map(w => wordText(w, App.config.sym)).filter(w => !accSet.has(w)).slice(0, 6);
        prompt = `Build a machine over {${sigma.join(', ')}} for a language that includes ${acc.join(', ')} and excludes ${rej.join(', ')}. The grader checks every word, not just these.`;
      } else {
        prompt = `Build a machine over {${sigma.join(', ')}} that accepts exactly the words matching ${toRegex(ref)}.`;
      }
      const ex = normalizeExercise({
        id: `ex-${Date.now().toString(36)}-${i}`,
        title: opts['from-regex'] ? `Regular language ${opts['from-regex']}` : `Regular language #${i}`,
        prompt,
        target: sealTarget({ ...ref, sigma }),
        answer: 'machine',
        allow,
        maxStates: opts['max-states'] ?? null,
        maxLength: 10,
        hints: [`The smallest DFA for this language has ${ref.states.length} states (${ref.states.length + (ref.transitions.length < ref.states.length * sigma.length ? 1 : 0)} if every state needs a move on every symbol).`]
      });
      made.push({ ex, ref: { ...ref, sigma } });
      if (opts['from-regex']) break;
    }
    if (!made.length) throw new CliError('That regular expression denotes the empty language or Σ*, which makes no exercise.');
    if (opts.json) { printJson(made.map(m => ({ exercise: m.ex, key: docFromTarget(m.ref) }))); return 0; }
    const dir = opts.output ?? '.';
    mkdirSync(dir, { recursive: true });
    made.forEach(({ ex, ref }, k) => {
      writeFileSync(join(dir, `exercise-${k + 1}.automaton`), docText(studentDoc(ref, ex)));
      writeFileSync(join(dir, `key-${k + 1}.automaton`), docText(docFromTarget(ref, { meta: { title: `Answer key — ${ex.title}`, blurb: ex.prompt } })));
    });
    print(`${made.length} exercise${made.length > 1 ? 's' : ''} and answer key${made.length > 1 ? 's' : ''} in ${dir}`);
    return 0;
  }
};

export const commands = { grade, generate };
