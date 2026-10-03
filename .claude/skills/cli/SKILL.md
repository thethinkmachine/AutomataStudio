---
name: cli
description: AutomataStudio: the `automata` command line - the headless engine, machine formats in and out (HOA, BA, JFLAP export), the finite-automaton operations, grading, learning, the MCP server, and the Turing-machine provers (closed position sets, inductive rules, the busy beaver bound, proof files). Read before touching cli/, vite.cli.config.js, build/cli/, or the --cli path in electron/main.cjs.
---

### The command line

`cli/` is the app's engine with a terminal attached, not a second engine. Every
command is a front end on something that already existed — `js/library/analyze.js`
decides and traces, `js/exercise/grade.js` compares and grades, the export registry
writes code and diagrams, `js/machines/tm-behaviour.js` classifies Turing machines —
and borrows `App` through `withMachine` to ask a question of a machine that is not on
a canvas. What `cli/` adds is only what had nowhere else to live: the formats the app
does not read or write, the finite-automaton operations as values rather than canvas
actions, the learners, and the Turing-machine provers the classifier does not have.

```
cli/
  automata.mjs     the executable: re-runs itself with --conditions=browser
  bundle.mjs       the bundle's entry (npm run cli:build → dist-cli/)
  main.mjs         the command table, the argument parser, exit codes
  env.mjs          the headless boot — what scripts/library/env.mjs does
  node-globals.mjs Node's fetch and Blob, saved before the DOM stub replaces them
  io.mjs           a machine in (files, stdin, inline codes); a document out
  writers.mjs      a machine out in any format; --to and the extension agree
  fa.mjs           determinize, minimize, products, regex, counting words
  learn.mjs        RPNI and L*
  figure.mjs       a standalone SVG, and a run as an animated one
  raster.mjs       PNG and GIF, no dependency
  formats/         hoa, ba, jff (export)
  tm/              core (tables, CPS, bound, pipeline), induction, check,
                   search (tree normal form), pool + worker
  commands/        one module per family of commands
```

**Exit codes are the three-valued verdict and never fold "unknown" into "reject"**:
0 accept/equal/pass, 1 reject/different/fail, 2 unknown (a budget ran out), 3 could
not run. A shell script's `&&` would otherwise read a budget running out as a proof.

### Booting without a page

`env.mjs` is `scripts/library/env.mjs` for the terminal — the DOM stub first, then
`simulation.js` for the painter hook, then the machine registry, and never `main.js`,
whose boot restores a backup and starts autosave. Four things were learned the hard way:

- **Solid needs `--conditions=browser`, and a shebang cannot pass it portably.** `env -S`
  is not on Windows and npm's launcher ignores shebang arguments, so `automata.mjs`
  re-executes itself once with the flag. The bundle resolves Solid's browser build at
  build time and never re-runs.
- **The DOM stub replaces `fetch` with one that throws.** Right for a test, wrong for
  `automata library`. `node-globals.mjs` saves Node's own before the stub loads — it has
  to be a module of its own, imported first, because imports evaluate before the
  importing module's body — and `env.mjs` puts them back.
- **In a bundle, the stub has to be a static import of every entry.** In the source,
  `env.mjs` imports it first and module order does the rest; in `dist-cli/` modules are
  regrouped into chunks and a chunk of app modules evaluated before the stub's chunk
  (`document is not defined`). A static import from the entry puts it in the entry
  chunk, which runs before anything imported dynamically. The worker is an entry too.
- **Do not `process.exit()` the moment a command returns.** On Windows it aborts Node
  with a libuv assertion while `fetch`'s sockets are closing. The entry lets the loop
  drain and keeps an unref'd timer as the backstop for anything an app module leaves
  running — it cannot keep the process alive itself.

The DOM stub lives in `js/headless/dom-stub.js` now, because shipped code does not
import from `tests/`; `tests/dom-stub.js` re-exports it, so every test is unchanged.

### Machines in and out

`readMachine(spec)` takes a path, `-`, or an inline machine code / standard-notation
TM, and returns `{ doc, target }` — the saved document and the grader's target shape.
Content is recognised by extension first and by its first characters second (`{`,
`<`, `HOA:`, `Ops`). An exercise file is a blank canvas on purpose, so `grade` reads
with `allowEmpty`. `writers.serialize` is the one way out; the app's `ExportFormats`
entries are built from `buildMachineIR()` exactly as the export dialog builds them.

- **HOA's letters are valuations, the app's are symbols.** Writing uses one
  proposition per symbol, labelled "this one and no other". Reading names a letter by
  its proposition when every used valuation is one-hot, and by its true set otherwise.
  Transition-based marks are moved onto states by splitting each state by the marks of
  the edges entering it; generalized Büchi is degeneralised with the usual counter;
  every parity flavour is mapped to the app's min-even by a map that keeps the order of
  importance (an unmarked visit is colour k under min, −1 under max). **Parity is
  recognised from the `Acceptance:` formula, not from `acc-name`**: two colours of min odd
  are exactly `Fin(0) & Inf(1)` and Spot names them "Rabin 1"; two of max odd are
  `Fin(0) | Inf(1)`, "Streett 1". The formula is compared with each flavour on every set
  of colours that could recur. Rabin and Streett past that are refused.
- **The reader is tested against Spot's own output**, not only against our writer:
  [tests/cli-hoa-spot.test.js](tests/cli-hoa-spot.test.js) reads the automata in
  `tests/fixtures/spot-hoa/` — every acceptance `ltl2tgba` builds and every `-H` output
  shape (aliases, implicit and state labels, one line, mixed marks, v1.1) — and checks
  Spot's recorded verdict on each word, before and after a trip through `hoaText`. Our
  own round trips passed while Spot's odd parity was refused. Regenerate with
  `node scripts/hoa-fixtures.mjs` where Spot's `ltl2tgba` and `autfilt` are on PATH.
- **A `.jff` cannot say a PDA accepts by empty stack** — JFLAP asks when it runs one —
  so exporting such a PDA warns rather than writing a file that reads back differently.
- **BA's "no accepting lines" means every state accepts**, so a machine with F = ∅ has
  no faithful BA file and the writer refuses.
- **A counterexample is decided on tokens, the way the grader does.** Re-parsing it
  through the run box fails on a symbol outside one machine's Σ and reports "no
  verdict" for what is a plain reject.

### Finite automata as values

`fa.mjs` borrows the two hard parts: the subset construction is the grader's
`subsetSide` (so a DFA resolves the wildcard the way the simulator does) and the
minimal DFA is the library's `minimalDfaOf`. **Uniform sampling builds its random
numbers from 32-bit chunks**: a seeded generator has 32 bits of precision, so scaled to
52 its low 20 bits are zero, and masking to the low bits drew the same word every time.

`equiv` is exact for two finite automata. For ω-automata it runs every ultimately
periodic word u(v) up to a size — the language is determined by its lassos, but "large
enough" depends on the automata — and says it was bounded.

### Turing machines: what can be proved

`tm/core.mjs` builds the classifier's table straight from the standard notation (no
`App`, so a search can make millions) and runs a pipeline, cheapest first: the app's
four methods, then bbchallenge's halting segment and finite automata reduction (inside
the classifier, after its budget — `--segment`, `--far`), then closed position sets,
then Coq-BB5's loops, n-gram CPS and repeated word list and bbchallenge's bouncers
(`--loops`, `--no-ngram`, `--repwl`, `--no-bouncers`), then inductive rules, then the
busy beaver bound. The command line runs halting segment and FAR without the app's
caps: halting segment at the reference's 11 cells, FAR to 6 DFA states
(`--far 7` is the reference's BB(5) search, minutes a machine). `--db` reads
bbchallenge's seed database a record at a time (`tm/seed-db.mjs`), so the 2.3 GB file
is never loaded. What is still unknown gets a growth reading — log (counter-like), √t
(bouncer-like), t (translated-cycler-like) — which is a classification, not a proof.

- **The bound is sound only in the model S(n, k) is proved for**: two-way tape, blank
  start, L/R moves only, and a proved value (S(2..5), S(2,3), S(2,4)). `boundFor`
  checks all of it; halt states are the accepting ones, and n counts the rest.
- **CPS** is the n-gram closed position set: windows of n cells either side of the
  head, plus the n-grams seen in each half-tape. A newly formed gram is added and the
  closure re-run; any halting window fails the proof. Its certificate is the two gram
  sets, which `check.mjs` verifies with the sets *frozen*, so a set that is not closed
  is caught rather than repaired.
- **Inductive rules** (`tm/induction.mjs`) are a macro machine over run-length blocks
  with the chain rule, and rules proved by symbolic replay: an exponent that changed by
  d is written |d|·x + e, and a stretch that lands on the same shape with each exponent
  an affine function of the x's is a rule for every x ≥ 0. A rule whose output always
  fits its own precondition applies forever — that is the proof. An additive rule with
  a shrinking run is kept and applied as one step, as many times as the run allows, to
  concrete and symbolic configurations alike, which is how a bouncer's outer loop is
  proved through its inner one. Three things were found by the proofs failing:
  **normalise symbolic configurations too** (a run whose exponent is the constant 0 is
  empty for every x; normalising only concrete ones made the replay's shape disagree
  with the start's); **keep only rules that accelerate** (a chain carrying a whole run
  across the head "proves" a new one-step rule every pass and flushed the history each
  time); and **try the general variant first** (unchanged runs free, least minimums)
  — whatever is claimed is exactly what the replay verifies, so generality can only fail
  to prove, never prove wrongly.
- **Counters are not proved by anything here.** Binary counters need a closed language
  that is not local — finite-automata reduction is the known method — and neither CPS
  (any window, symmetric or not) nor fixed-shape rules reach them. Below six states the
  bound settles them; past it they are reported as unknown, counter-like.

**Proof files** (`halts --proof`) carry the machine as a table and the method's
evidence. `check-proof` shares no code with the provers for simulation, cyclers,
translated cyclers and CPS — its own Map tape and stepper — and checks a FAR proof
against bbchallenge's verifier conditions (`verifier_FAR_NFA_DFA.py`); every single-edge
deletion from a proof's NFA is caught. Halting segment is re-derived, like backward
reasoning, and so are loops, n-gram CPS, repeated word lists and bouncers — re-run with
the parameters the proof records (a bouncer must reproduce its certificate). A
simulation proof's steps follow bbchallenge's count. Backward reasoning and the
inductive rules are re-derived by re-running the prover, and the output says so.

[tests/cli-provers.test.js](tests/cli-provers.test.js) judges the provers against
ground truth rather than against themselves: every machine in the 3-state and 2-state
3-symbol tree-normal-form enumerations halts within S(n, k) steps if it halts at all,
so every "never" claim over the whole enumeration is checked, plus a 4-state sample.
A prover wrong once fails there.

`bb-search` enumerates in tree normal form — run a machine with nothing defined, and
branch where it first reads an undefined transition — with state, symbol and mirror
symmetry. It never uses the bound, which would assume its own answer.

### How it looks, and how it is documented

- **`out.mjs` is the only place colour is decided.** The palette is the app's dark
  theme; depth is detected (truecolor, 256, 16, none) and `FORCE_COLOR`/`NO_COLOR`
  override. **Plain output is a contract**: tests and scripts read it, so a
  colour-only flourish (pills, boxes, coloured stack cells) must fall back to the
  text it replaced — `trace`'s `stack ZA`, `halts`' "1 halt, 0 never halt". Each
  tape symbol keeps one colour everywhere (`symbolColour`), the same order the
  space-time pictures use; the blank is always faint.
- **`play` is one pure `renderFrame`**, drawn two ways: interactively (alternate
  screen, raw keys, the last frame left on the normal screen on quit) when both
  stdin and stdout are terminals, and as a sequence of frames otherwise. Keep it
  pure — the tests read the piped frames.
- **On Windows the desktop app's `automata` has no stdin.** It is the app's
  executable run as Node, a GUI program: Electron reattaches stdout and stderr to
  the console but not stdin, so `play` saw a pipe and printed every frame. Its keys
  come from `keyboard()`, which opens `\\.\CONIN$` there — Electron on win32 only,
  so a real pipe into plain Node still gets frames. The clips run this checkout
  under plain Node and cannot show this; test it with the repo's `electron.exe`
  and `ELECTRON_RUN_AS_NODE=1` from a `.cmd`, under a console.
- **A command's help is its module's `usage` plus `help.mjs`'s examples and
  see-also**, coloured by `renderUsage` (headings end in `:`, flags start with
  `-`, examples with `$ `). Topics (`automata help <topic>`) live there too.
- **`docs/cli-reference.md` is generated** (`npm run cli:docs`) from exactly that,
  and a test fails when it is stale — change the usage text or the examples, then
  regenerate. `docs/cli.md` is the hand-written guide; the README points at both.
- **The guide's output blocks are generated too.** A fence under
  `<!-- automata-output: <arguments> -->` holds what that command prints, run by
  `npm run cli:docs` in a scratch copy of [examples/cli/](../../../examples/cli/) with
  colour off and no shell (`shellWords` splits the line). `tests/cli.test.js` fails when
  one is stale — so changing what a command prints means regenerating, and the guide
  cannot drift from the CLI. A block must be deterministic on every platform: no
  timings, no unseeded randomness, no paths joined by the platform's separator.
- **`examples/cli/` is the guide's working directory**: every example on the page runs
  from it, and every clip is filmed in a fresh copy of it. Change a fixture and the
  blocks and clips that use it change with it — regenerate both.

### The clips

`docs/media/cli-*.webp` are filmed, not screen-recorded: each is a tape in
[docs/media/tapes/](../../../docs/media/tapes/) — the commands it types and the keys it
presses — and `npm run media:cli` (scripts/media/) films them all again, or
`npm run media:cli -- <tape>` one. Run by hand after a change to what a command prints,
the way `npm run glyphs` is; output committed. `--list` names the tapes.

- **A tape types into a real bash on a pseudo-terminal** (node-pty; Git Bash on Windows),
  so stdout is a terminal: colour, `play`'s full screen, pipes, Ctrl+C. `automata` on the
  PATH is a shim running this checkout. Each prompt appends its exit status to a file
  (`PROMPT_COMMAND`), which is how `enter()` knows a command finished.
- **The stage is xterm.js in headless Chromium**, WebGL renderer, so every glyph sits on
  the cell grid whatever font it fell back to. Filmed at 2× and written at 1.5×: the
  WebGL renderer spaces cells wider than its canvas at a fractional density.
- **The encoder (`webp.mjs`) writes animated WebP by hand**, one changed rectangle per
  frame, lossy at quality 78 — lossless was three to four times the size. Keep each clip
  near a megabyte; `t.speed(n)` plays a long computation faster (`bb-search`).
- **The `watch` tape films the desktop app**: Electron on a fresh `dist/` (the runner
  builds it), opened on the tape's file, with a profile of its own set *inside* the app
  by a boot script — on Windows Electron ignores `%APPDATA%`, so an environment variable
  isolates nothing, and the recording would open and write the recorder's own
  workspaces. `openApp` refuses to film if the profile did not take. The app is filmed
  on its own loop and laid into the pane at encode time; a drawn cursor shows clicks.
- **The `mcp` tape is a real Claude Code session**, so it reads differently each time,
  costs a little usage, and is skipped (with the reason) where `claude` is missing or
  has never been set up in a terminal. It runs Sonnet 5.5 with `--tools ""`, so the
  answer comes through automata's tools rather than from reading the file, and its
  shell drops every inherited `CLAUDE*` variable (recording from inside a Claude Code
  session would otherwise hand down its session id and messaging token).
- **The welcome panel is redacted, never filmed.** It shows the recorder's name and
  plan, and a full repaint brings it back mid-session, so `stage.redact(/^[╭│╰]/)`
  blanks those rows before xterm paints them, and the tape refuses to finish if account
  text is still on screen. Scrolling it away or `/clear` did not hold — check a new
  take's frames before committing it.
- **A failing tape saves the screen it was looking at** to the temp folder and says
  where; most failures are a `waitFor` whose text the command no longer prints.
- **Several CLI fixes came from filming**, and are worth knowing were bugs: `play`'s
  frame overran the screen by two lines (the header box counted as one), a double-click
  on a state never toggled accepting in a browser (pointer capture swallows `dblclick`;
  it is two presses now, js/render.js), an opened file came up marked unsaved, and the
  CLI's own layout put a chain DFA's states in a row that its back edges ran through.

### Running it elsewhere

- **The bundle** (`npm run cli:build` → `dist-cli/`, config `vite.cli.config.js`) is
  self-contained and runs under plain `node`. Its worker is a second entry emitted as
  `worker.mjs` beside the main file; `pool.mjs` holds the worker's path in a variable
  because the bundler rewrites a literal `new URL('…', import.meta.url)` into a copied,
  unbundled asset. It carries the license's Required Notice after the shebang line.
- **The desktop app ships the bundle** unpacked beside `app.asar`, run by the app's own
  executable as Node (`ELECTRON_RUN_AS_NODE`) through `resources/cli/automata(.cmd)` —
  the way VS Code ships `code`. `AutomataStudio --cli …` does the same from a macOS or
  Linux terminal; on Windows a GUI executable's output never reaches the console, which
  is why the `.cmd` launcher exists. A VS Code terminal (and this repo's agent sessions)
  export `ELECTRON_RUN_AS_NODE=1`, so testing `electron . --cli` there needs it unset.
- **`automata mcp`** is JSON-RPC over stdio, one message per line; nothing but protocol
  goes to stdout. Tools take a machine as a path, a code, or a document's JSON text.
