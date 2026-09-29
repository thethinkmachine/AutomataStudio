// Machine in, machine out: the regular operations, and an expression
// language over them. Output goes to standard output as a document unless
// -o names a file, so these chain in a pipe.
import { readMachine, emit, CliError } from '../io.mjs';
import { formatFor, serialize } from '../writers.mjs';
import {
  complement, concat, determinize, epsilonFree, fromRegex, lettersOf, minimize, product, reverse, star, toRegex, union
} from '../fa.mjs';
import { compareMachines } from '../../js/exercise/grade.js';
import { App } from '../../js/state.js';
import { c, print, printJson, wordOf } from '../out.mjs';

const OUT = {
  output: { type: 'string', short: 'o' },
  to: { type: 'string', short: 't' }
};

function write(target, opts) {
  const format = formatFor(opts.to, opts.output);
  emit(serialize(target, format), opts.output);
  return 0;
}

const outHelp = `
  -o, --output FILE   write here (the extension picks the format); default stdout
  -t, --to FORMAT     automaton (default), jff, hoa, ba, timbuk, code, dot, …`;

function unary(fn, what, extra = '') {
  return {
    usage: `automata ${what} <machine>${extra}${outHelp}`,
    options: { ...OUT, complete: { type: 'boolean' } },
    async run({ args, opts }) {
      const { target } = readMachine(args[0] ?? '-');
      return write(fn(target, opts), opts);
    }
  };
}

function binary(fn, what) {
  return {
    usage: `automata ${what} <machine-a> <machine-b>${outHelp}`,
    options: OUT,
    async run({ args, opts }) {
      if (args.length < 2) throw new CliError(`${what} takes two machines.`);
      return write(fn(readMachine(args[0]).target, readMachine(args[1]).target), opts);
    }
  };
}

// ── The expression language ───────────────────────────────────────

const FUNCS = {
  min: [1, t => minimize(t)], minimize: [1, t => minimize(t)],
  det: [1, t => determinize(t)], determinize: [1, t => determinize(t)],
  comp: [1, t => complement(t)], complement: [1, t => complement(t)],
  rev: [1, t => reverse(t)], reverse: [1, t => reverse(t)],
  star: [1, t => star(t)],
  eps: [1, t => epsilonFree(t)], noeps: [1, t => epsilonFree(t)],
  union: [2, (a, b) => union(a, b)], concat: [2, (a, b) => concat(a, b)],
  inter: [2, (a, b) => product(a, b, 'and')], intersect: [2, (a, b) => product(a, b, 'and')],
  diff: [2, (a, b) => product(a, b, 'diff')], xor: [2, (a, b) => product(a, b, 'xor')]
};

function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith('==', i) || src.startsWith('<=', i) || src.startsWith('>=', i) || src.startsWith('!=', i)) { toks.push({ t: 'op', v: src.slice(i, i + 2) }); i += 2; continue; }
    if ('()|&\\~*.,+'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '/' || ch === "'" || ch === '"') {
      const close = src.indexOf(ch, i + 1);
      if (close < 0) throw new CliError(`Unclosed ${ch} in the expression.`);
      toks.push({ t: ch === '/' ? 'regex' : 'file', v: src.slice(i + 1, close) });
      i = close + 1;
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_\-]*/.exec(src.slice(i));
    if (m) { toks.push({ t: 'name', v: m[0] }); i += m[0].length; continue; }
    throw new CliError(`Unexpected "${ch}" in the expression.`);
  }
  return toks;
}

/**
 * Evaluate `src` with `env` naming machines. Grammar, loosest first:
 *   top     := expr (('==' | '!=' | '<=' | '>=') expr)?
 *   expr    := and (('|' | '+') and)*          union
 *   and     := diff ('&' diff)*                intersection
 *   diff    := cat ('\' cat)*                  difference
 *   cat     := unary ('.' unary)*              concatenation
 *   unary   := '~' unary | post                complement
 *   post    := atom '*'*                       star
 *   atom    := NAME | f(expr, …) | /regex/ | 'file' | '(' expr ')'
 */
export function evaluate(src, env, { sigma = null } = {}) {
  const toks = lex(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = v => peek()?.t === 'op' && peek().v === v;
  const expect = v => { if (!isOp(v)) throw new CliError(`Expected "${v}" in the expression.`); i++; };
  function top() {
    const l = expr();
    const op = peek();
    if (op && op.t === 'op' && ['==', '!=', '<=', '>='].includes(op.v)) {
      i++;
      const r = expr();
      return { cmp: op.v, l, r };
    }
    return l;
  }
  function expr() { let l = and(); while (isOp('|') || isOp('+')) { i++; l = union(l, and()); } return l; }
  function and() { let l = diff(); while (isOp('&')) { i++; l = product(l, diff(), 'and'); } return l; }
  function diff() { let l = cat(); while (isOp('\\')) { i++; l = product(l, cat(), 'diff'); } return l; }
  function cat() { let l = un(); while (isOp('.')) { i++; l = concat(l, un()); } return l; }
  function un() { if (isOp('~')) { i++; return complement(un(), sigma || undefined); } return post(); }
  function post() { let a = atom(); while (isOp('*')) { i++; a = star(a); } return a; }
  function atom() {
    const tk = toks[i++];
    if (!tk) throw new CliError('The expression ended early.');
    if (tk.t === 'op' && tk.v === '(') { const e = expr(); expect(')'); return e; }
    if (tk.t === 'regex') return fromRegex(tk.v, { sigma });
    if (tk.t === 'file') return readMachine(tk.v).target;
    if (tk.t === 'name') {
      if (isOp('(')) {
        i++;
        const f = FUNCS[tk.v];
        if (tk.v === 'regex') {
          const s = toks[i++];
          if (!s || (s.t !== 'file' && s.t !== 'regex')) throw new CliError('regex(…) takes a quoted expression.');
          expect(')');
          return fromRegex(s.v, { sigma });
        }
        if (!f) throw new CliError(`${tk.v}(…) is not a function. Functions: ${Object.keys(FUNCS).join(', ')}, regex.`);
        const argsList = [expr()];
        while (isOp(',')) { i++; argsList.push(expr()); }
        expect(')');
        if (argsList.length !== f[0]) throw new CliError(`${tk.v} takes ${f[0]} argument${f[0] > 1 ? 's' : ''}.`);
        return f[1](...argsList);
      }
      if (!env.has(tk.v)) throw new CliError(`${tk.v} is not bound. Bind it with ${tk.v}=file on the command line.`);
      return env.get(tk.v);
    }
    throw new CliError(`Unexpected ${tk.v} in the expression.`);
  }
  const result = top();
  if (i < toks.length) throw new CliError(`Unexpected ${toks[i].v} in the expression.`);
  return result;
}

/**
 * A top-level comparison from `evaluate` → `{ ok, word }`, where `word` is a
 * word in one language and not the other when there is one. Inclusion is
 * emptiness of the difference: A ⊆ B ⟺ A \ B = ∅, and == is both ways.
 */
export function answerComparison(r) {
  const included = (a, b) => {
    const d = product(a, b, 'diff');
    const e = compareMachines(d, { ...d, accepts: [] });
    return e.equal ? { ok: true, word: null } : { ok: false, word: e.tokens };
  };
  if (r.cmp === '==' || r.cmp === '!=') {
    const e = compareMachines(r.l, r.r);
    const same = e.equal === true;
    return { ok: r.cmp === '==' ? same : !same, word: e.tokens || null };
  }
  return r.cmp === '<=' ? included(r.l, r.r) : included(r.r, r.l);
}

const evalCmd = {
  usage: `automata eval '<expression>' [NAME=machine ...]

  min(det(A) & ~B)          A=a.automaton B=b.jff
  /(a|b)*abb/ == A          compare a regex with a machine
  A <= B                    is L(A) contained in L(B)?

Operators, tightest first: postfix * (star), ~ (complement), . (concatenation),
& (intersection), \\ (difference), | or + (union). Functions: min, det, comp,
rev, star, eps, union, inter, diff, xor, concat, regex('…'). A /regex/ or a
'quoted/path' is a machine too. With ==, !=, <= or >= at the top the answer is
a verdict, not a machine.

  --sigma abc         the alphabet for ~ and for . in a regex
${outHelp}

Exit (comparisons): 0 true, 1 false.`,
  options: { ...OUT, sigma: { type: 'string' } },
  async run({ args, opts }) {
    const [src, ...binds] = args;
    if (!src) throw new CliError('Give an expression.');
    const env = new Map();
    for (const b of binds) {
      const eq = b.indexOf('=');
      if (eq < 1) throw new CliError(`"${b}" is not NAME=machine.`);
      env.set(b.slice(0, eq), readMachine(b.slice(eq + 1)).target);
    }
    const sigma = opts.sigma ? [...opts.sigma.split(/[,\s]+/).filter(Boolean).flatMap(s => (s.length > 1 && !opts.sigma.includes(',') ? [...s] : [s]))] : null;
    const r = evaluate(src, env, { sigma });
    if (!r.cmp) return write(r, opts);
    const answer = answerComparison(r);
    const eps = App.config.sym.eps;
    if (opts.json) printJson({ holds: answer.ok, counterexample: answer.word ? wordOf(answer.word, eps) : null });
    else {
      print(answer.ok ? c.green('true') : c.red('false'));
      if (answer.word && (r.cmp !== '!=' || !answer.ok)) print(`counterexample: ${wordOf(answer.word, eps)}`);
    }
    return answer.ok ? 0 : 1;
  }
};

const fromRegexCmd = {
  usage: `automata from-regex '<regex>' [--sigma ab]

Thompson's construction, with the app's regex syntax: | concatenation * + ?
{n,m} [a-z] [^…] . and ε. --sigma sets what . and [^…] range over.
${outHelp}`,
  options: { ...OUT, sigma: { type: 'string' }, min: { type: 'boolean' } },
  async run({ args, opts }) {
    if (!args.length) throw new CliError('Give a regular expression.');
    const sigma = opts.sigma ? (opts.sigma.includes(',') ? opts.sigma.split(',').map(s => s.trim()) : [...opts.sigma]) : null;
    let t = fromRegex(args[0], { sigma });
    if (opts.min) t = minimize(t);
    return write(t, opts);
  }
};

const toRegexCmd = {
  usage: 'automata to-regex <machine>\n\nState elimination, least-connected state first.',
  options: {},
  async run({ args, opts }) {
    const { target } = readMachine(args[0] ?? '-');
    const re = toRegex(target);
    // The regex syntax has no escapes, so a letter that is also an operator
    // makes the expression readable but not re-readable by from-regex.
    const clash = lettersOf(target).filter(a => [...a].some(ch => '|*+?()[]{}.'.includes(ch)));
    if (clash.length && !opts.quiet) process.stderr.write(c.yellow(`warning: Σ contains ${clash.join(' ')}, which the regex syntax also uses as an operator — read this expression, but do not feed it back to from-regex.\n`));
    if (opts.json) printJson({ regex: re, ...(clash.length ? { ambiguousLetters: clash } : {}) }); else print(re);
    return 0;
  }
};

export const commands = {
  determinize: unary((t, o) => determinize(t, { complete: o.complete }), 'determinize', '\n\nThe reachable subset construction. --complete keeps the empty-set sink.'),
  minimize: unary((t, o) => minimize(t, { complete: o.complete }), 'minimize', '\n\nThe minimal DFA, states in breadth-first order. --complete keeps the sink.'),
  complement: unary(t => complement(t), 'complement', '\n\nA complete DFA for Σ* minus the language.'),
  reverse: unary(t => reverse(t), 'reverse'),
  star: unary(t => star(t), 'star'),
  'eps-elim': unary(t => epsilonFree(t), 'eps-elim'),
  union: binary(union, 'union'),
  concat: binary(concat, 'concat'),
  intersect: binary((a, b) => product(a, b, 'and'), 'intersect'),
  difference: binary((a, b) => product(a, b, 'diff'), 'difference'),
  'from-regex': fromRegexCmd,
  'to-regex': toRegexCmd,
  eval: evalCmd
};

export { lettersOf };
