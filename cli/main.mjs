// ══════════════════════════════════════════════════════════════════
//  THE COMMAND LINE
// ══════════════════════════════════════════════════════════════════
// One table of commands, one argument parser, one place that turns a thrown
// CliError into a sentence and an exit code. Each command lives in a module
// under commands/ that is imported only when that command runs, after
// env.mjs — the DOM stand-in has to be installed before any app module is
// evaluated, which a static import from here could not guarantee.
//
// Exit codes are the three-valued verdict wherever a command decides
// something, and never fold "unknown" into "reject":
//
//   0  accept / equal / pass / halts proved / nothing found
//   1  reject / different / fail / a lint finding
//   2  unknown — a budget ran out before an answer
//   3  the command could not run (bad input, bad flag, missing file)

import { parseArgs } from 'node:util';

// Neither imports the app, so both are safe to load before env.mjs.
import { c, pad, styled } from './out.mjs';
import { TOPICS, commandHelp, topicHelp } from './help.mjs';

const COMMANDS = {
  // Running
  run: ['run', 'Decide words: accept, reject or unknown (and a transducer\'s output)'],
  test: ['run', 'Batch-test words from a file; "w => accept" lines are expectations. --watch reruns on save'],
  trace: ['run', 'Print a word\'s run step by step'],
  play: ['play', 'Animate a run in the terminal'],
  // Looking
  info: ['info', 'Type, tuple, size, determinism, language class, regex, minimal DFA size'],
  lint: ['info', 'Find unreachable and dead states, unused symbols, branching D-types, …'],
  words: ['words', 'List, count or uniformly sample the accepted words of a finite automaton'],
  profile: ['words', 'Steps and space per input length, with a growth estimate (CSV)'],
  // Comparing
  equiv: ['compare', 'Do two machines accept the same language? Prints a counterexample if not'],
  diff: ['compare', 'Structural and language differences between two versions of a machine'],
  similar: ['compare', 'Group machines that recognise the same language (or are the same machine)'],
  fuzz: ['fuzz', 'Compare a machine with an external program on random words, and shrink a disagreement'],
  // Transforming (machine in, machine out — pipe-friendly)
  'from-regex': ['ops', 'Regular expression → ε-NFA (Thompson)'],
  'to-regex': ['ops', 'Finite automaton → regular expression (state elimination)'],
  determinize: ['ops', 'Subset construction → DFA'],
  minimize: ['ops', 'Minimal DFA'],
  complement: ['ops', 'Complement DFA over Σ'],
  reverse: ['ops', 'Reverse the language'],
  star: ['ops', 'Kleene star'],
  union: ['ops', 'Union of two finite automata'],
  concat: ['ops', 'Concatenation of two finite automata'],
  intersect: ['ops', 'Product DFA for the intersection'],
  difference: ['ops', 'Product DFA for A \\ B'],
  'eps-elim': ['ops', 'Remove ε-moves'],
  eval: ['ops', 'Evaluate an expression over machines: min(det(A) & ~B)'],
  // Formats
  convert: ['convert', 'Convert between .automaton, .jff, HOA, BA, Timbuk, machine codes, …'],
  export: ['convert', 'Any of the app\'s export formats: DOT, TikZ, tables, samples, code, tests'],
  codegen: ['convert', 'Generate code: --lang js|py|java|c|xstate|scxml'],
  svg: ['convert', 'Draw the machine as an SVG'],
  animate: ['play', 'A run as an animated SVG, or a Turing machine\'s space-time diagram as a GIF'],
  // Teaching
  grade: ['grade', 'Grade submissions against an exercise; CSV or Gradescope results.json'],
  generate: ['grade', 'Random exercises with answer keys'],
  // Turing machines
  halts: ['tm', 'Does it halt? Proof methods, growth class, workers, proof files'],
  'check-proof': ['tm', 'Independently re-check a proof file written by halts --proof'],
  'bb-search': ['tm', 'Enumerate n-state Turing machines and classify them all'],
  'tm-normalize': ['tm', 'Put Turing machines in normal form and drop duplicates'],
  sheet: ['tm', 'A contact sheet of space-time diagrams, one per machine'],
  // Learning
  learn: ['learn', 'Learn a DFA: RPNI from labelled words, or L* from a membership oracle'],
  // Elsewhere
  library: ['library', 'Search and fetch machines from the machine library'],
  mcp: ['mcp', 'Serve the engine to AI agents over the Model Context Protocol (stdio)']
};

const GROUPS = [
  ['Running', ['run', 'test', 'trace', 'play']],
  ['Looking', ['info', 'lint', 'words', 'profile']],
  ['Comparing', ['equiv', 'diff', 'similar', 'fuzz']],
  ['Transforming', ['from-regex', 'to-regex', 'determinize', 'minimize', 'complement', 'reverse', 'star', 'union', 'concat', 'intersect', 'difference', 'eps-elim', 'eval']],
  ['Formats', ['convert', 'export', 'codegen', 'svg', 'animate']],
  ['Teaching', ['grade', 'generate']],
  ['Turing machines', ['halts', 'check-proof', 'bb-search', 'tm-normalize', 'sheet']],
  ['Learning', ['learn']],
  ['Elsewhere', ['library', 'mcp']]
];

// Every numeric flag, checked once here rather than at forty call sites: a
// value that is not a number, not whole where it must be, or below its floor
// is refused by name instead of becoming NaN inside a loop bound.
const NUMERIC = {
  'max-steps': { int: true, min: 1 }, budget: { int: true, min: 1 }, cps: { int: true, min: 0, max: 32 },
  'induction-ms': { min: 0 }, limit: { int: true, min: 1 }, fps: { min: 0.1, max: 1000 }, steps: { int: true, min: 1 },
  size: { int: true, min: 1, max: 4000 }, cols: { int: true, min: 1, max: 50 }, 'max-len': { int: true, min: 0, max: 10000 },
  'max-length': { int: true, min: 0, max: 64 }, count: { int: true, min: 1 }, len: { int: true, min: 0, max: 100000 },
  sample: { int: true, min: 1, max: 1000000 }, from: { int: true, min: 0, only: 'profile' }, to: { int: true, min: 0, max: 100000, only: 'profile' },
  cap: { int: true, min: 1 }, states: { int: true, min: 1 }, symbols: { int: true, min: 2 }, points: { min: 0 },
  exhaustive: { int: true, min: 0, max: 24 }, tests: { int: true, min: 0 }, timeout: { int: true, min: 1 },
  bounded: { int: true, min: 0, max: 24 }, cell: { int: true, min: 1, max: 64 }, 'step-ms': { int: true, min: 10 },
  workers: { int: true, min: 1, max: 256 }, 'max-states': { int: true, min: 1 },
  segment: { int: true, min: 0, max: 12 }, far: { int: true, min: 0, max: 12 }, loops: { int: true, min: 0, max: 100000000 }
};

function checkNumbers(opts, cmd) {
  for (const [key, rule] of Object.entries(NUMERIC)) {
    if (typeof opts[key] !== 'string' || (rule.only && rule.only !== cmd)) continue;
    const raw = opts[key];
    const n = Number(raw);
    const say = `--${key}`;
    if (raw === '' || !Number.isFinite(n)) return `${say} takes a number, not "${raw}".`;
    if (rule.int && !Number.isInteger(n)) return `${say} takes a whole number, not ${raw}.`;
    if (rule.min !== undefined && n < rule.min) return `${say} is at least ${rule.min}.`;
    if (rule.max !== undefined && n > rule.max) return `${say} is at most ${rule.max}.`;
  }
  return null;
}

const GLOBAL_OPTIONS = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  'max-steps': { type: 'string' },
  quiet: { type: 'boolean', short: 'q' }
};

const START_HERE = [
  ['automata run machine.automaton 0110 101', 'decide words'],
  ['automata info machine.automaton', 'what is this machine?'],
  ['automata play machine.automaton 0110', 'watch a run, step by step'],
  ['automata from-regex "(a|b)*abb" | automata minimize - | automata svg -', 'machines travel down pipes'],
  ['automata halts 1RB1LB_1LA1RZ', 'does a Turing machine halt?']
];

function mainHelp(version) {
  const L = [];
  L.push(styled
    ? `${c.bold(c.accent('◆ automata'))} ${c.muted(version)}  ${c.faint('—')}  AutomataStudio from the command line`
    : `automata ${version} — AutomataStudio from the command line`);
  L.push('', `${c.bold('Usage:')} automata ${c.cyan('<command>')} [options]`,
    `       automata ${c.cyan('<command>')} --help      ${c.muted('options and examples for one command')}`,
    `       automata help ${c.cyan('<topic>')}          ${c.muted('a guide: machines, words, formats, …')}`, '');
  for (const [title, names] of GROUPS) {
    L.push(c.bold(c.accent(title)));
    for (const n of names) L.push(`  ${c.bold(pad(n, 14))}${COMMANDS[n][1]}`);
    L.push('');
  }
  L.push(c.bold(c.accent('Start here')));
  const w = Math.max(...START_HERE.map(([cmd]) => cmd.length));
  for (const [cmd, what] of START_HERE) L.push(`  ${c.faint('$')} ${c.teal(pad(cmd, w))}  ${c.muted(what)}`);
  L.push('', `${c.bold(c.accent('Help topics'))}  ${c.muted('automata help <topic>')}`);
  for (const [name, t] of Object.entries(TOPICS)) L.push(`  ${c.bold(pad(name, 14))}${c.muted(t.summary)}`);
  L.push('',
    `Every command takes ${c.cyan('--json')}, ${c.cyan('--quiet')} and ${c.cyan('--max-steps N')} (the step budget per word, default 100000).`,
    `Exit codes: ${c.green('0')} accept/equal/pass  ${c.red('1')} reject/different/fail  ${c.yellow('2')} unknown  ${c.magenta('3')} could not run.`,
    `The full guide is ${c.underline('docs/cli.md')}.`);
  return L.join('\n');
}

function closest(name, names = Object.keys(COMMANDS)) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  };
  let best = null, bd = Infinity;
  for (const n of names) { const x = dist(name, n); if (x < bd) { bd = x; best = n; } }
  return bd <= 3 ? best : null;
}

export async function main(argv) {
  // The app reads its version from a build-time define; the CLI has the
  // package's own, and must set it before the app's modules evaluate.
  if (typeof globalThis.__APP_VERSION__ !== 'string') {
    try {
      const { readFileSync } = await import('node:fs');
      globalThis.__APP_VERSION__ = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    } catch { /* stays dev */ }
  }
  const { App, APP_VERSION } = await import('./env.mjs');
  const { CliError } = await import('./errors.mjs');
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    const topic = cmd === 'help' ? rest[0] : null;
    if (!topic) { process.stdout.write(mainHelp(APP_VERSION) + '\n'); return 0; }
    if (topic === 'topics') {
      for (const [name, t] of Object.entries(TOPICS)) process.stdout.write(`${c.bold(pad(name, 14))}${c.muted(t.summary)}\n`);
      return 0;
    }
    if (TOPICS[topic]) { process.stdout.write(topicHelp(topic)); return 0; }
    if (COMMANDS[topic]) return main([topic, '--help']);
    const near = closest(topic, [...Object.keys(COMMANDS), ...Object.keys(TOPICS)]);
    process.stderr.write(`automata help: "${topic}" is neither a command nor a topic.${near ? ` Did you mean "${near}"?` : ''} See automata help topics.\n`);
    return 3;
  }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') { process.stdout.write(`${APP_VERSION}\n`); return 0; }
  const entry = COMMANDS[cmd];
  if (!entry) {
    const near = closest(cmd);
    process.stderr.write(`automata: "${cmd}" is not a command.${near ? ` Did you mean "${near}"?` : ''} See automata --help.\n`);
    return 3;
  }
  const mod = await import(`./commands/${entry[0]}.mjs`);
  const spec = mod.commands[cmd];
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: { ...GLOBAL_OPTIONS, ...(spec.options || {}) },
      allowPositionals: true,
      strict: true
    });
  } catch (e) {
    process.stderr.write(`automata ${cmd}: ${e.message.replace(/^Unknown option/, 'unknown option')}\nUsage: ${spec.usage.split('\n')[0]}\n`);
    return 3;
  }
  const { values: opts, positionals: args } = parsed;
  if (opts.help) {
    process.stdout.write(commandHelp(cmd, COMMANDS[cmd][1], spec.usage) + '\n');
    return 0;
  }

  // The CLI decides one word at a time, so it can afford a real budget; the
  // app's 400 is sized for the Language panel's grid of hundreds of cells.
  const bad = checkNumbers(opts, cmd);
  if (bad) {
    process.stderr.write(`automata ${cmd}: ${bad}\n`);
    return 3;
  }
  const budget = opts['max-steps'] !== undefined ? Number(opts['max-steps']) : 100000;
  App.config.langStepBudget = budget;
  if (opts['max-steps'] !== undefined) {
    App.config.maxTmSteps = budget;
    App.config.maxPdaSteps = budget;
  }

  try {
    const code = await spec.run({ args, opts, cmd });
    return typeof code === 'number' ? code : 0;
  } catch (e) {
    if (e instanceof CliError || e?.exitCode !== undefined) {
      process.stderr.write(`automata ${cmd}: ${e.message}\n`);
      return e.exitCode ?? 3;
    }
    process.stderr.write(`automata ${cmd}: ${e?.message || e}\n`);
    if (process.env.AUTOMATA_DEBUG) process.stderr.write(`${e?.stack || ''}\n`);
    return 3;
  }
}

export { COMMANDS, GROUPS };
