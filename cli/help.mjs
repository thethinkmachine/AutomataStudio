// ══════════════════════════════════════════════════════════════════
//  HELP: EXAMPLES, TOPICS, AND HOW HELP LOOKS
// ══════════════════════════════════════════════════════════════════
// Every command's --help is its own usage text (in its module) plus, from
// here, examples and "see also" — kept in one place so they stay consistent —
// and `automata help <topic>` guides that explain what a single command's help
// cannot: what a machine spec is, how words are typed, what each exit code
// means, which proofs can be trusted how far. docs/cli.md is the long form.

import { c, rule, styled } from './out.mjs';

export const EXAMPLES = {
  run: [
    ['automata run machine.automaton 0110 "" 101', 'decide three words ("" is the empty word)'],
    ['automata run 1RB1LB_1LA1RZ ""', 'a Turing machine in the standard notation, on a blank tape'],
    ['automata run buchi.json "a(b)" "(ab)"', 'an ω-automaton reads u(v): prefix, then the repeating part'],
    ['cat words.txt | automata run machine.automaton', 'one word per line from standard input'],
    ['automata run machine.automaton 0110 --json', 'machine-readable: [{ word, verdict, output, error }]']
  ],
  test: [
    ['automata test machine.automaton words.txt', 'lines like "0110 => accept" are expectations'],
    ['automata test machine.automaton words.txt --watch', 'rerun on every save of either file'],
    ['automata test machine.automaton words.txt --failures', 'show only what did not pass'],
    ['automata words reference.automaton --max-len 6 | sed "s/$/ => accept/" > words.txt', 'make a test file from another machine']
  ],
  trace: [
    ['automata trace machine.automaton 0110', 'every step: state, what happened, tape or stack'],
    ['automata trace 1RB1LB_1LA1RZ "" --limit 20', 'the first 20 steps of a Turing machine'],
    ['automata trace pda.automaton abba --json', 'the steps as JSON, for a script']
  ],
  play: [],
  info: [
    ['automata info machine.automaton', 'type, size, alphabets, determinism, language, regex, codes'],
    ['automata info 1RB1LB_1LA1RZ', 'works on inline machines too'],
    ['automata info machine.automaton --latex', 'with the formal 5-tuple (or 7-tuple) as LaTeX'],
    ['automata info machine.automaton --json | jq .minimalDfaStates', 'one fact, for a script']
  ],
  lint: [
    ['automata lint machine.automaton', 'errors, warnings and infos, with the rule that found each'],
    ['automata lint submissions/*.automaton --strict', 'every file; infos count as findings too'],
    ['automata lint machine.automaton --json', 'findings as JSON, for CI annotations']
  ],
  words: [
    ['automata words machine.automaton', 'the shortest accepted words, in order'],
    ['automata words machine.automaton --rejected --limit 20', 'the shortest rejected words'],
    ['automata words machine.automaton --count --max-len 30', 'how many words of each length (exact, even at length 30)'],
    ['automata words machine.automaton --sample 5 --len 40 --seed 1', 'five accepted words of length 40, uniformly at random']
  ],
  profile: [
    ['automata profile tm.automaton --to 10', 'steps and cells for every input up to length 10'],
    ['automata profile tm.automaton --family "0^n 1^n" --to 30', 'one structured input per length'],
    ['automata profile pda.automaton > cost.csv', 'the CSV to plot; the growth estimate goes to stderr']
  ],
  equiv: [
    ['automata equiv mine.automaton reference.automaton', 'the shortest word they disagree on, if any'],
    ['automata equiv a.jff b.automaton', 'formats can differ'],
    ['automata equiv nba.hoa dba.automaton --size 8', 'ω-automata: every u(v) up to 8 symbols']
  ],
  diff: [
    ['automata diff old.automaton new.automaton', 'what changed, and whether the language did'],
    ['git difftool -x "automata diff" -- machine.automaton', 'as git\'s difftool'],
    ['git config diff.automaton.textconv "automata diff --textconv"', 'make plain git diff readable (with .gitattributes: *.automaton diff=automaton)']
  ],
  similar: [
    ['automata similar submissions/', 'group identical answers (same language, or same machine)'],
    ['automata similar submissions/ --bounded 6', 'group PDAs and TMs by behaviour on words up to length 6']
  ],
  fuzz: [
    ['automata fuzz machine.automaton --oracle "python check.py {}" --mode stdout', 'the oracle prints yes/no for the word in {}'],
    ['automata fuzz machine.automaton --oracle "node check.js" --batch', 'one process answers every word, a line each'],
    ['automata fuzz machine.automaton --oracle "./is_valid" --count 5000 --max-len 20 --seed 7', 'more and longer words, repeatably']
  ],
  'from-regex': [
    ['automata from-regex "(a|b)*abb"', 'an ε-NFA document on standard output'],
    ['automata from-regex "(a|b)*abb" --min -o abb.automaton', 'minimized, to a file'],
    ['automata from-regex "a.b" --sigma xyz', '. ranges over {x, y, z}']
  ],
  'to-regex': [
    ['automata to-regex machine.automaton', 'a regular expression for the language'],
    ['automata from-regex "(ab)*" | automata to-regex -', 'round trip']
  ],
  determinize: [['automata determinize nfa.automaton -o dfa.automaton', 'the subset construction'], ['automata determinize nfa.jff --complete --to dot', 'keep the ∅ sink, as Graphviz']],
  minimize: [['automata minimize dfa.automaton', 'the minimal DFA (without its dead sink)'], ['automata from-regex "(a|b)*abb" | automata minimize - | automata info -', 'in a pipe']],
  complement: [['automata complement dfa.automaton -o not.automaton', 'Σ* minus the language']],
  reverse: [['automata reverse dfa.automaton | automata minimize -', 'the reversal, minimized']],
  star: [['automata star dfa.automaton', 'the Kleene star, as an ε-NFA']],
  union: [['automata union a.automaton b.automaton -o either.automaton', 'L(a) ∪ L(b)']],
  concat: [['automata concat a.automaton b.automaton', 'L(a)·L(b)']],
  intersect: [['automata intersect a.automaton b.automaton | automata words -', 'words both accept']],
  difference: [['automata difference a.automaton b.automaton | automata words -', 'words a accepts and b does not']],
  'eps-elim': [['automata eps-elim enfa.automaton', 'the same language, no ε-moves']],
  eval: [
    ['automata eval "min(det(A) & ~B)" A=a.automaton B=b.jff', 'an expression over machines'],
    ['automata eval "/(a|b)*abb/ == A" A=mine.automaton', 'is my machine this regex? (exit 0 yes, 1 no)'],
    ['automata eval "A <= B" A=a.automaton B=b.automaton', 'is L(A) contained in L(B)?']
  ],
  convert: [
    ['automata convert machine.jff -o machine.automaton', 'JFLAP → the app\'s format'],
    ['automata convert nba.automaton --to hoa', 'an ω-automaton for Spot/Owl'],
    ['automata convert spot-output.hoa -o machine.automaton', 'and back'],
    ['automata convert nfa.automaton --minimize -o min.jff', 'transform on the way'],
    ['automata convert tm.automaton --to standard', 'a Turing machine as 1RB1LB_1LA1RZ']
  ],
  export: [
    ['automata export --list', 'every format and its options'],
    ['automata export machine.automaton -f dot --opt rankdir=TB | dot -Tpng > m.png', 'Graphviz, top to bottom'],
    ['automata export machine.automaton -f tikz --opt standalone=true -o m.tex', 'a compilable LaTeX figure'],
    ['automata export machine.automaton -f samples --opt format=json', 'accepted and rejected words']
  ],
  codegen: [
    ['automata codegen dfa.automaton --lang py -o recogniser.py', 'a Python accepts() function'],
    ['automata codegen dfa.automaton --lang java --style class --class-name Parser', 'a Java class'],
    ['automata codegen dfa.automaton --lang c --style switch', 'C, one switch per state'],
    ['automata codegen dfa.automaton --lang jest', 'a test suite derived from the language']
  ],
  svg: [['automata svg machine.automaton -o m.svg', 'a labelled diagram that carries its own styles'], ['automata svg tm.automaton --theme dark', 'dark colours']],
  animate: [
    ['automata animate machine.automaton 0110 -o run.svg', 'the run as a self-playing SVG'],
    ['automata animate 1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA "" --gif --limit 400 --cell 3 -o bb5.gif', 'BB(5)\'s first 400 steps as a GIF']
  ],
  grade: [
    ['automata grade exercise.automaton submissions/ --csv grades.csv', 'a class at once'],
    ['automata grade exercise.automaton submission.automaton --gradescope /autograder/results/results.json', 'inside a Gradescope autograder'],
    ['automata grade reference.automaton submissions/ --allow DFA --max-states 5', 'a bare reference machine as the exercise']
  ],
  generate: [
    ['automata generate --states 4 --count 10 --seed 2026 -o week3/', 'ten different exercises with keys'],
    ['automata generate --from-regex "(ab|ba)*" -o ex/', 'one exercise from a regex'],
    ['automata generate --states 3 --prompt examples --infinite', 'described by example words instead of a regex']
  ],
  halts: [
    ['automata halts 1RB1LB_1LA1RZ', 'one machine'],
    ['automata halts machines.txt --proof proofs/', 'a list, one per line, with a proof file per decided machine'],
    ['automata halts tm.automaton --input 0110', 'a machine from a file, on a word'],
    ['automata halts machines.txt --json | jq \'.[] | select(.verdict=="unknown")\'', 'what is still open']
  ],
  'check-proof': [['automata check-proof proofs/', 're-check every proof file']],
  'bb-search': [
    ['automata bb-search -n 3', 'every 3-state machine; finds BB(3) = 21'],
    ['automata bb-search -n 2 -k 3 --holdouts open.txt', '2 states, 3 symbols; save the unsettled ones'],
    ['automata bb-search -n 4 --workers 8', '4 states: minutes, on 8 cores']
  ],
  'tm-normalize': [['automata tm-normalize machines.txt > unique.txt', 'drop renamings and mirror images'], ['automata tm-normalize machines.txt --prune --json', 'drop unreachable states too']],
  sheet: [
    ['automata sheet machines.txt -o sheet.svg', 'one space-time diagram per machine, captioned with its verdict'],
    ['automata sheet machines.txt --png -o pictures/', 'one PNG each instead'],
    ['automata sheet 1RB1LB_1LA1RZ --steps 200 --size 400', 'one machine, bigger']
  ],
  learn: [
    ['automata learn --from samples.txt -o learned.automaton', 'RPNI from "word => accept/reject" lines'],
    ['automata learn --oracle "./validator" --sigma 01 --mode exit', 'L* against a program'],
    ['automata learn --target machine.automaton | automata info -', 'L* against a machine: its minimal DFA']
  ],
  library: [
    ['automata library search "tag:textbook type:DFA"', 'search the machine library'],
    ['automata library search accepts:0110 is:minimal', 'machines that accept a word'],
    ['automata library show finite/dfa/binary-divisibility-by-5', 'one entry'],
    ['automata library pull finite/dfa/binary-divisibility-by-5 -o div5.automaton', 'download it']
  ],
  mcp: [['claude mcp add automata -- automata mcp', 'register with Claude Code'], ['automata mcp < session.jsonl', 'answer a recorded session']]
};

export const SEE_ALSO = {
  run: ['test', 'trace', 'play', 'help words'], test: ['run', 'fuzz', 'help words'], trace: ['play', 'run'], play: ['trace', 'animate'],
  info: ['lint', 'to-regex'], lint: ['info'], words: ['profile', 'equiv'], profile: ['words', 'help turing'],
  equiv: ['diff', 'eval', 'similar'], diff: ['equiv', 'help scripting'], similar: ['grade', 'equiv'], fuzz: ['test', 'learn'],
  eval: ['help machines'], convert: ['export', 'help formats'], export: ['convert', 'codegen', 'svg'], codegen: ['export'],
  svg: ['animate', 'export'], animate: ['play', 'svg', 'sheet'], grade: ['generate', 'similar', 'help grading'], generate: ['grade', 'help grading'],
  halts: ['check-proof', 'sheet', 'help proofs', 'help turing'], 'check-proof': ['halts', 'help proofs'], 'bb-search': ['halts', 'help turing'],
  'tm-normalize': ['halts'], sheet: ['halts', 'animate'], learn: ['fuzz', 'help learning'], library: ['convert'], mcp: ['help mcp']
};

// ── Topics ────────────────────────────────────────────────────────

export const TOPICS = {
  machines: {
    summary: 'what a <machine> argument can be',
    text: `
Every command that takes a machine takes it the same way.

A file:
  .automaton .json      the app's own document (what Save writes)
  .jff                  JFLAP: finite automata, PDAs, Turing machines, Mealy, Moore
  .scxml  .js .ts       a statechart (SCXML, or an XState config), flattened
  .hoa                  Hanoi Omega-Automata, from Spot, Owl, ltl2tgba, …
  .ba                   RABIT / GOAL Büchi automata
  .timbuk .tmb          Timbuk word automata

Standard input:
  -                     read the machine from stdin, recognised by its content,
                        so machines can be piped from command to command

Inline, as an argument:
  1RB1LB_1LA1RZ         a Turing machine in the standard (bbchallenge) notation:
                        one segment per state A, B, C, …; per symbol read, the
                        symbol written, L or R, and the next state (Z halts,
                        --- is undefined, which also halts)
  fa.01:+AB_BA          a machine code: any machine the app has, as one line
                        (the app's Copy Machine Code writes these)

Every command that makes a machine writes an .automaton document to standard
output unless -o names a file, so they chain:

  $ automata from-regex "(a|b)*abb" | automata minimize - | automata codegen - --lang c`
  },
  words: {
    summary: 'how to type words, the empty word, and ω-words',
    text: `
A word is typed the way the app's run box takes it.

  0110                  single-character symbols run together
  "01 11 00"            multi-character symbols separated by spaces (or commas)
  ""   ε   eps          the empty word

An ω-automaton (DBA, NBA, DPA, …) reads an infinite word, written u(v): a finite
prefix u, then v repeated forever. "(ab)" is abababab…, "a(b)" is abbbbb….

In a words file (test, learn --from) each line is one word; "w => accept" or
"w => reject" (also acc/rej, a/r, ✓/✗) makes it an expectation; blank lines and
lines starting with # are skipped.

Symbols outside Σ are an error for run and test, and simply have no transition
(so reject) for equiv and grade, which is how the app's grader treats them.`
  },
  'exit-codes': {
    summary: 'what each exit code means, per command',
    text: `
Every command exits with the three-valued verdict wherever it decides
something. "Unknown" is never folded into "reject": a budget running out is
not a proof, and a script's && must not read it as one.

  0   accept · equal · every test passed · halts or never-halts proved · no
      findings · a transducer ran to the end
  1   reject · different · a test failed · a lint finding · a proof did not check
  2   unknown: a step budget ran out, a run was cut short, or a check was
      bounded and could not decide
  3   could not run: a file that does not read, a word outside Σ, a bad flag

In a shell:
  $ automata run m.automaton "$w" && echo accepted
  $ automata equiv mine.automaton ref.automaton || echo "they differ"
  $ automata halts tm.txt; [ $? -eq 2 ] && echo "some are still open"`
  },
  formats: {
    summary: 'every format the CLI reads and writes, and what each loses',
    text: `
                    read   write   notes
  automaton/json     ✔      ✔      everything: layout, card, blocks, exercise
  jff (JFLAP)        ✔      ✔      FA, PDA, TM, Mealy, Moore; empty-stack
                                   acceptance is chosen in JFLAP, not the file
  hoa                ✔      ✔      ω-automata; transition-based and generalized
                                   Büchi acceptance are moved onto states
  ba                 ✔      ✔      Büchi (RABIT/GOAL read finite automata as
                                   Büchi too — the writer warns)
  timbuk             ✔      ✔      word automata only (arities 0 and 1)
  scxml / xstate     ✔      ✔      statecharts; parallel states are refused
  code (SMTF)        ✔      ✔      one line, the machine and nothing else
  standard           ✔      ✔      one-tape TMs over digits, L/R moves
  svg                       ✔      a labelled diagram with its own styles
  dot, tikz                 ✔      Graphviz and LaTeX
  table-csv/md              ✔      transition tables
  samples, coverage         ✔      words, as CSV/JSON/Markdown
  code-*, test-*            ✔      JS, Python, Java, C, XState, SCXML; Jest, pytest

--to FORMAT picks one; otherwise the output file's extension does:
.automaton .json .jff .hoa .ba .timbuk .txt .svg .dot .gv .tex .csv .md .js .py
.java .c .scxml .test.js`
  },
  turing: {
    summary: 'Turing machines: halting, busy beavers, space-time pictures',
    text: `
halts        does it halt? tries, cheapest first:
               simulation            it halts within --budget steps
               cycler                a configuration repeats exactly
               translated cycler     it repeats, shifted along fresh tape
               backward reasoning    no halting configuration is reachable
               closed position set   an n-gram abstraction closed under δ
               inductive rule        a run-length pattern that grows forever
               busy beaver bound     it ran past S(n,k), for n ≤ 5 (2 symbols)
             and otherwise reports "unknown" with how its tape grows:
             logarithmic (counter-like) or √t (bouncer-like)
bb-search    every n-state machine, the champion, and the holdouts
sheet        a contact sheet of space-time diagrams
play, trace  one run, step by step; play --history draws the diagram live
profile      steps and cells as the input grows, with a growth estimate

The standard notation: 1RB1LB_1LA1RZ is state A: on 0 write 1, move R, go to
B; on 1 write 1, move L, go to B — then state B likewise. Z (or any letter past
the last state) halts; --- is undefined, which halts too.`
  },
  proofs: {
    summary: 'how far each halting proof can be trusted, and check-proof',
    text: `
halts --proof DIR writes one JSON file per decided machine: the machine as a
table, the verdict, the method, and the method's evidence. check-proof
re-checks them:

  simulation, cycler,       independently: its own tape, its own stepper,
  translated cycler, CPS    sharing no code with the prover
  busy beaver bound         independently simulated; the value of S(n,k) is
                            cited (BB(5) was proved in 2024), not re-proved
  backward reasoning,       re-derived by running the prover again — said so
  inductive rule            in the output

The provers are tested against ground truth: every machine in the 3-state and
2-state 3-symbol enumerations halts within S(n,k) steps if it halts at all,
and no "never halts" claim over either enumeration is wrong.`
  },
  omega: {
    summary: 'ω-automata: Büchi, co-Büchi, parity, weak',
    text: `
The eight ω-automata are determinism × acceptance: D/N × Büchi (BA),
co-Büchi (coBA), parity (PA), weak (WA). They read u(v) words (help words).

run, test, trace      decide u(v) words
equiv, diff           compare on every u(v) up to --size symbols — a bounded
                      check, and the output says so
convert --to hoa      for Spot, Owl and the other LTL tools; .hoa files read
                      back, including transition-based and generalized
                      Büchi acceptance and every parity flavour
info                  shows the acceptance: F and whether it must be visited
                      infinitely or finitely often, or the parity priorities`
  },
  grading: {
    summary: 'exercises, grading a class, Gradescope',
    text: `
An exercise is an .automaton file with an exercise inside — the app's
Create Exercise writes one, and so does automata generate. It carries the
reference sealed, the machine types allowed, a state limit and hints.

  $ automata generate --states 4 --count 20 --seed 1 -o week3/
      exercise-N.automaton   what students open (a blank canvas + the task)
      key-N.automaton        the answer, drawn
  $ automata grade week3/exercise-1.automaton submissions/ --csv grades.csv

Grading is exact for finite automata (proved equal, or the shortest word they
disagree on) and word by word up to the exercise's length bound otherwise.

For Gradescope, in the autograder's run_autograder:
  automata grade /autograder/source/exercise.automaton \\
    /autograder/submission/*.automaton \\
    --gradescope /autograder/results/results.json

automata similar submissions/ groups identical answers.`
  },
  learning: {
    summary: 'learn a DFA from examples (RPNI) or from a program (L*)',
    text: `
learn --from samples.txt      RPNI: labelled words in, a DFA consistent with
                              every one out; exact with enough examples
learn --oracle "cmd" --sigma  L*: asks the program membership questions and
                              tests its guesses on words; exact as far as the
                              testing reached, and it says so
learn --target m.automaton    L* against a machine; exact for a finite automaton

The oracle protocol is fuzz's: the word as {} in the command (or appended), on
stdin, and in $AUTOMATA_WORD; the answer as the exit code (--mode exit) or a
yes/no line (--mode stdout); --batch for one process answering a line per word.`
  },
  scripting: {
    summary: 'pipes, --json, git, CI and shells',
    text: `
Every command takes --json. Machines travel on stdin/stdout. Exit codes are
verdicts (help exit-codes).

In git:
  git config diff.automaton.textconv "automata diff --textconv"
  echo "*.automaton diff=automaton" >> .gitattributes
  git difftool -x "automata diff" -- machine.automaton

In CI (a GitHub Actions step):
  - run: npx automata lint machines/*.automaton --strict
  - run: npx automata test machines/parser.automaton tests/parser.txt

Colour: automatic in a terminal; NO_COLOR=1 turns it off; FORCE_COLOR=1..3
turns it on for a pager: FORCE_COLOR=3 automata info m.automaton | less -R`
  },
  mcp: {
    summary: 'give AI agents the engine as tools',
    text: `
automata mcp serves the Model Context Protocol on stdin/stdout. Tools:
decide, info, lint, equiv, transform, from_regex, eval, convert, trace,
words, halts. Machines are passed as paths, machine codes, standard-notation
TMs, or .automaton JSON text.

  $ claude mcp add automata -- automata mcp
  (or in another client's config: command "automata", args ["mcp"])`
  },
  install: {
    summary: 'installing: the desktop app, npm link, or the bundle',
    text: `
With the desktop app (no Node needed): the CLI is inside it.
  Windows   add  %LOCALAPPDATA%\\Programs\\AutomataStudio\\resources\\cli  to PATH
  macOS     ln -s "/Applications/AutomataStudio.app/Contents/Resources/cli/automata" /usr/local/bin/automata
  Linux     ln -s /opt/AutomataStudio/resources/cli/automata /usr/local/bin/automata
  or run    AutomataStudio --cli <command> …   (macOS, Linux)

From a checkout:   npm install && npm link
The bundle:        npm run cli:build, then node dist-cli/automata.mjs (Node 20+)`
  },
  colour: {
    summary: 'colour, and turning it off',
    text: `
Colour is automatic in a terminal and off when output is piped. Depth is
detected: truecolor (Windows Terminal, iTerm, VS Code, COLORTERM=truecolor),
256 colours (TERM=*256*), or the basic 16.

  NO_COLOR=1       no colour at all (https://no-color.org)
  FORCE_COLOR=3    truecolor even into a pipe:  … | less -R
  FORCE_COLOR=1    the basic 16 colours

Each tape symbol keeps one colour in every command, in play, trace and the
space-time pictures alike; the blank is always the faint one.`
  }
};

// ── Rendering ─────────────────────────────────────────────────────

/**
 * Usage text → coloured help. Headings ("Options:"), flags, examples ("$ …",
 * with the trailing comment dimmed) and the first line are picked out; plain
 * text passes through, so an unstyled terminal gets the text as written.
 */
export function renderUsage(text) {
  if (!styled) return text;
  return text.split('\n').map((line, i) => {
    if (i === 0) return line.replace(/^(automata)( [\w-]+)?/, (m, a, b) => c.bold(c.accent(a)) + (b ? c.bold(b) : ''));
    if (/^\s*automata\s/.test(line) && !/^\s*\$/.test(line)) return line.replace(/(automata)( [\w-]+)?/, (m, a, b) => c.accent(a) + (b ? c.bold(b) : ''));
    if (/^[A-Z][\w /-]*:$/.test(line)) return c.bold(c.accent(line));
    const ex = /^(\s*)\$ (.*?)(\s{2,}(\S.*))?$/.exec(line);
    if (ex) return `${ex[1]}${c.faint('$')} ${c.teal(ex[2])}${ex[3] ? `  ${c.muted(ex[4])}` : ''}`;
    const opt = /^(\s{2,})((?:-\w, )?--?[\w-]+(?: [A-Z][\w|.]*)?)(\s+)(.*)$/.exec(line);
    if (opt) return `${opt[1]}${c.cyan(opt[2])}${opt[3]}${opt[4]}`;
    if (/^Exit:/.test(line)) return c.muted(line);
    return line;
  }).join('\n');
}

/** A command's whole help: summary, usage, examples, see also. */
export function commandHelp(name, summary, usage) {
  const parts = [`${c.bold(summary)}`, '', `${styled ? c.bold(c.accent('Usage:')) : 'Usage:'} ${usage}`];
  const ex = EXAMPLES[name];
  if (ex?.length && !/\nExamples:\n/.test(usage)) {
    parts.push('', 'Examples:');
    const w = Math.min(52, Math.max(...ex.map(([cmd]) => cmd.length)) + 2);
    for (const [cmd, what] of ex) parts.push(cmd.length + 4 > w + 2 ? `  $ ${cmd}\n      ${what}` : `  $ ${cmd.padEnd(w)}  ${what}`);
  }
  const see = SEE_ALSO[name];
  if (see?.length) parts.push('', `See also: ${see.map(s => `automata ${s.startsWith('help ') ? s : `${s} --help`}`).join(', ')}`);
  return renderUsage(parts.join('\n'));
}

export function topicHelp(name) {
  const t = TOPICS[name];
  return `${rule(`automata help ${name}`)}\n${c.muted(t.summary)}\n${renderUsage(t.text.replace(/^\n/, ''))}\n`;
}
