<div align="center">

# AutomataStudio

**An IDE for designing, simulating and analysing automata and formal languages.**

Draw a machine, run it step by step, derive its language, put it through the textbook
constructions, and take it out as a diagram, LaTeX or working code. It covers 30
machine types, from DFAs to multi-tape Turing machines and ω-automata.

[![Version](https://img.shields.io/github/package-json/v/thethinkmachine/AutomataStudio?label=version)](https://github.com/thethinkmachine/AutomataStudio/releases)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Deploy](https://github.com/thethinkmachine/AutomataStudio/actions/workflows/deploy.yml/badge.svg)](https://github.com/thethinkmachine/AutomataStudio/actions/workflows/deploy.yml)
[![Desktop build](https://github.com/thethinkmachine/AutomataStudio/actions/workflows/electron-build.yml/badge.svg)](https://github.com/thethinkmachine/AutomataStudio/actions/workflows/electron-build.yml)

[**Open in the browser**](https://thethinkmachine.github.io/AutomataStudio/) ·
[Download the desktop app](https://github.com/thethinkmachine/AutomataStudio/releases/latest) ·
[Machine library](https://thethinkmachine.github.io/automata-library/) ·
[Guides](#guides) ·
[Cite](#citation)

![An 8-tape Turing machine executing a stored program, one step per frame](docs/media/cpu.gif)

<sup>A 5-bit accumulator CPU with a 19-opcode instruction set, built entirely as an 8-tape
Turing machine: 614 states and 19,191 transitions in 40 nested building blocks. It
runs a multiply-by-repeated-addition program from tape 1 and halts with 12 in the
accumulator after 331 steps.</sup>

</div>

---

## Contents

- [Getting started](#getting-started)
- [Guides](#guides)
- [Features](#features)
- [Algorithms and theory](#algorithms-and-theory)
- [Command line](#command-line)
- [Development](#development)
- [Known issues](#known-issues)
- [Contributing](#contributing)
- [Citation](#citation)
- [License](#license)

## Getting started

You can use AutomataStudio in three ways.

| | How | Notes |
| --- | --- | --- |
| **Web** | [thethinkmachine.github.io/AutomataStudio](https://thethinkmachine.github.io/AutomataStudio/) | Nothing to install, and your machines stay in your browser. |
| **Desktop** | [Latest release](https://github.com/thethinkmachine/AutomataStudio/releases/latest) for Windows, macOS and Linux | Windows and Linux AppImage builds update themselves. The `automata` CLI ships inside. |
| **From source** | See below | Requires Node.js 20.19+ or 22.12+ (24 LTS recommended). |

```bash
git clone https://github.com/thethinkmachine/AutomataStudio.git
cd AutomataStudio
npm install
npm run dev            # http://localhost:5173
```

### Your first machine

1. Choose a model from the picker, for example **DFA**.
2. Use the **State** tool to place states and the **Transition** tool to connect
   them, then double-click a state to mark it accepting.
3. Type a word into the run box and step through it, or paste a list of words into
   the batch tester.
4. The inspector on the right derives the language for you: a regular expression, the
   formal tuple, and an acceptance fingerprint.

You can also skip drawing. The **Machine Wizard** builds a machine from your answers
to a few questions, **StateMate** builds one from a prompt, and the
[machine library](https://thethinkmachine.github.io/automata-library/) has ready-made
machines to open and remix.

![A DFA for binary divisibility by five, open on the canvas](docs/media/hero.png)

<sup>A five-state DFA that accepts binary multiples of 5. The inspector derives a regular
expression by state elimination, the tuple `M = (Q⁵, Σ², δ¹⁰, q₀, F¹)`, and an
acceptance fingerprint of the words decided so far.</sup>

## Guides

Each part of the app has a guide of its own in [`docs/`](docs), with clips and
screenshots:

| Guide | Covers |
| --- | --- |
| [The machine library](docs/library.md) | searching and running shared machines, badges, saving offline, submitting, updates and remixes |
| [Algorithms](docs/algorithms.md) | all 35 constructions, two-machine operations, the lexer generator |
| [The grammar workbench](docs/grammar.md) | writing grammars, the 25 tools, CYK and derivations, conversions to and from the canvas |
| [StateMate](docs/statemate.md) | setting up a provider, the build-and-verify pipeline, write modes, agentic mode, commands, privacy |
| [The reference](docs/reference.md) | the machine pages, decidability and language classes |
| [Building blocks](docs/building-blocks.md) | sub-machines, nesting and reuse, worked through on a small CPU |
| [The command line](docs/cli.md) | `automata` by task, with the full [command reference](docs/cli-reference.md) |

## Features

### Machines

| Group | Machines |
| --- | --- |
| Finite automata | DFA, NFA, ε-NFA, 2DFA, 2NFA, PFA |
| ω-automata | DBA, DcoBA, DPA, DWA, NBA, NcoBA, NPA, NWA |
| Memory automata | DPDA, NPDA, Queue Automaton, Counter Automaton, 2-Stack PDA, Embedded PDA |
| Turing machines | TM, NDTM, Multi-tape TM, LBA, Two-way infinite TM |
| Transducers | Moore, Mealy, FST, Pushdown Transducer, Two-way Transducer |

The ω-automata are deterministic and nondeterministic variants of four acceptance
conditions (Büchi, co-Büchi, parity and weak), and their input is an ultimately periodic
word `u(v)`. A multi-tape Turing machine can have any number of tapes.

### Building
- **Canvas.** Draw states and transitions, bend edges, and arrange the diagram
  automatically. Notes, regions and separators are part of the saved document.
- **Building blocks.** A block is a sub-machine shown as one node, with one entry and
  named exits. Blocks nest and can be reused, and they are inlined when placed, so
  every simulator and exporter sees an ordinary machine.
  See [docs/building-blocks.md](docs/building-blocks.md).
- **Machine Wizard.** Builds or edits any machine type from a series of questions.
- **Workspaces and themes.** Edit in multiple tabs, choose from 19 light and dark themes, and use the
  mobile layout on small screens.

![The Machine Wizard building a DFA for an even number of 1s, then running a test word](docs/media/wizard.webp)

<sup>**Machine Wizard.** Pick a model, name the alphabet, list the states, fill in the
transitions from dropdowns, and add a test word. The machine is drawn in one step (one
Ctrl+Z undoes it), and the test word becomes a chip on the info card that runs with one
click — here `1001`, accepted.</sup>

![Grouping states of a binary-addition Turing machine into two blocks, drilling into one, and running the machine](docs/media/blocks.webp)

<sup>**Building blocks.** Two pairs of states in a binary-addition Turing machine are
grouped into *decrement b* and *increment a*. Double-clicking a block opens it, with
tabs showing where edges enter and leave; the breadcrumb leads back out. During the run
on `101+11` the block that is executing lights up, down to the state inside it.</sup>

### Running
- **Step-by-step simulation** with a scrubber, a trace log in plain sentences, and a
  tape view that shows each model's tape boundaries.
- **Batch testing** runs a word list across every CPU core.
- **Nondeterminism** is shown as a computation tree. Turing machines can be proved to
  halt, or proved never to halt, beyond what a step budget can tell you.
- **Language panel** shows the derived regular expression, the language class and an
  acceptance fingerprint.
- **Space-time diagrams** draw a whole tape run, one row per step, with an overview of
  the run beside them. Runs of millions of steps stay responsive.

![Stepping the word 1100100 through the DFA](docs/media/simulate.gif)

<img src="docs/media/multitape.gif" alt="A four-tape Turing machine's tape tracker during a run" width="300">

<sup>Top: the divisibility DFA accepting `1100100` (100 in binary). Bottom: a four-tape
ALU computing 11 + 6 = 17, with each tape drawn as its model defines it.</sup>

![The space-time diagram of the BB(2,4) champion, computed to its halt after 3,932,964 steps](docs/media/spacetime.webp)

<sup>**Space-time diagram** of the BB(2,4) busy beaver champion
(`1RB2LA1RA1RA_1LB1LA3RB1RZ`), the two-state, four-symbol machine that runs longest
before halting. It plays a few dozen steps cell by cell, then *Compute the rest* runs
all 3,932,964 steps in about five seconds. The widened overview shows the whole run,
and *Jump to end* lands on the halt: 2,050 non-blank cells.</sup>

### Grammars
The grammar workbench has 25 tools for inspecting, normalising, parsing, deciding and
converting grammars. They include FIRST/FOLLOW, Chomsky classification, CNF and GNF,
removal of ε, unit, useless and left-recursive rules, left factoring, CYK, parse trees,
derivations, ambiguity witnesses, LL(1) tables, and conversion to and from the canvas.

![Typing a grammar, filling a CYK table step by step, and finding an ambiguity witness](docs/media/grammar.webp)

<sup>The grammar is checked as you type it. CYK fills its table one span at a time on
`aabb` (using the Chomsky normal form it converted to, which is shown below the table).
*Check ambiguity* then finds two different parse trees for `ababab`, which proves the
grammar is ambiguous.</sup>

More in [the grammar workbench guide](docs/grammar.md).

### Import, export and sharing
- **Import:** JFLAP `.jff` (including 6.1 blocks), XState, SCXML, and machine codes.
- **Diagrams:** PNG and SVG, with text converted to outlines. A PNG can embed the
  workspace, so dropping it back on the canvas resumes editing.
- **Interchange:** Graphviz DOT, TikZ/LaTeX, CSV and Markdown transition tables, and
  workspace JSON.
- **Code generation:** JavaScript, Python, Java, C, XState and SCXML, with Jest and
  pytest suites.
- **Share links:** the whole workspace is compressed into a URL and never sent to a
  server.
- **Exercises:** sealed reference solutions with exact or bounded grading, for teaching.

### StateMate (optional AI assistant)
StateMate builds and edits machines from a prompt and answers questions about the one
on screen. It works with Anthropic, OpenAI, Mistral AI, Google AI Studio, Cohere,
OpenRouter, or any OpenAI-compatible local server. You supply your own key, and it is
never written to a saved file. Every candidate machine is run on the real simulator
before you see it, and you choose whether StateMate asks, proposes or applies changes
automatically.

![StateMate building a pushdown automaton for balanced brackets from a one-line prompt](docs/media/statemate.webp)

<sup>One prompt, *a pushdown automaton that accepts balanced strings of ( ) and [ ]*. The
proposal arrives as a diff with its test words already run (5/5 checks). Apply draws
it, and `([])` is accepted. Recorded through the repository's agent bridge
([tools/agent-bridge](tools/agent-bridge/statemate-bridge.mjs)), so the answer goes
through the same parse, lint and verify steps as one from any provider.</sup>

More in [the StateMate guide](docs/statemate.md).

### The machine library
A public catalogue of machines you can search (by name, type, size, or by a word they
accept), run in place, open on your canvas, save for offline use, remix, and add to.
Every badge on a listing (tests pass, deterministic, minimal, halts, never halts) comes
from the library's CI running the machine, not from its author.

![Searching the library, trying a word on an entry and opening it on the canvas](docs/media/library.webp)

More in [the library guide](docs/library.md).

## Algorithms and theory

The app has 35 interactive constructions from the standard textbooks (Hopcroft &
Ullman, Sipser). Each one shows its working, and can put its result on the canvas:

- **Conversions:** subset construction, ε-NFA → NFA, regex ↔ NFA, DFA ↔ regular
  grammar, TM → grammar, Moore ↔ Mealy
- **Analysis:** minimisation (table-filling and visual), equivalence with a
  distinguishing word, ε-closure, dead states, computation trees
- **Closure:** union, intersection, concatenation, star, complement, reversal, product
- **Decision procedures:** emptiness, finiteness, universality
- **A universal Turing machine** visualiser, and a **lexer generator** that compiles
  token rules into one minimal DFA and emits it as JavaScript, Python or C

![Regex to NFA to DFA to minimal DFA, each result loaded onto the canvas](docs/media/algorithms.webp)

<sup>`(a|b)*abb` through the whole pipeline: Thompson's construction gives a 14-state
ε-NFA, the subset construction a 5-state DFA, and minimisation the 4-state DFA from the
textbook. More in [the Algorithms guide](docs/algorithms.md).</sup>

A built-in **reference** has a page for every machine type, covering its formal
definition and what it can and cannot recognise. It also has sections on decidability
(Rice's theorem, reductions, diagonalisation) and on language classes.

![The reference page for a DFA](docs/media/reference.png)

More in [the reference guide](docs/reference.md).

## Command line

`automata` runs the same engine from a terminal. You can use it to run, test, trace and
animate machines, compare and convert them, grade a class, learn a DFA from examples,
serve machines over MCP, and prove whether Turing machines halt.

```sh
automata run machine.automaton 0110 101          # ✔ accept / ✘ reject / ? unknown
automata play machine.automaton 0110 --history   # animated run in the terminal
automata from-regex "(a|b)*abb" | automata minimize - | automata codegen - --lang py
automata grade exercise.automaton submissions/ --csv grades.csv
automata halts machines.txt --proof proofs/      # halting proofs, checkable with check-proof
```

![automata halts classifying nine Turing machines, one per proof method, then check-proof verifying the proofs](docs/media/cli-halts.webp)

<sup>`automata halts` on nine machines: the BB(2), BB(2,4) and BB(5) champions halt
(BB(5) after 47,176,870 steps), five machines are proved never to halt by five different
methods, and the last, Antihydra, is reported as unknown: whether it halts is an open
problem. `check-proof` then
re-checks every proof file with code that shares nothing with the provers.</sup>

It also reads and writes HOA, BA and JFLAP. To install it, add the desktop
app's `resources/cli` directory to your `PATH`, or run `npm install && npm link` from a
checkout. Read the [CLI guide](docs/cli.md) for task-by-task instructions, or the
[command reference](docs/cli-reference.md) for every option.

## Development

```bash
npm run dev               # Vite dev server
npm test                  # node:test suite (tests/*.test.js)
npm run build             # production web build -> dist/
npm run electron:dev      # the desktop shell against the dev server
npm run electron:build    # installers -> release/
npm run cli -- --help     # the CLI, from source
npm run bench             # engine and renderer timings vs. bench/baseline.json
```

The code is organised as follows:

```
js/            the app: plain ES modules, SVG rendering, Solid signals for derived panels
js/machines/   one module per machine family, behind a registry (DOM-free)
js/grammar/    the grammar workbench
cli/           the `automata` command line
electron/      the desktop shell
wasm/          the label-placement kernel (AssemblyScript)
tests/         node:test, with a DOM stub
docs/          user documentation and media
```

[CLAUDE.md](CLAUDE.md) holds the architecture notes: the module layout, the change
notification store, the renderer, and how to add a machine type (one row in
`MachineTypes` and one `defineMachine` call).

## Known issues

- Regular-expression derivation stops at 120 states. State elimination is cubic, so
  larger machines show the language class instead of an expression.
- An exported SVG inlines the whole application stylesheet, which makes the file larger
  than it needs to be.
- Pushdown automata accept by final state only. A JFLAP file that accepts by empty
  stack is imported as final-state acceptance and flagged.

Bug reports and feature requests go to the
[issue tracker](https://github.com/thethinkmachine/AutomataStudio/issues). If the
desktop updater reports an error, the code is explained in
[docs/update-error-codes.md](docs/update-error-codes.md).

## Contributing

Pull requests are welcome. Commits must be signed off (`git commit -s`).
[CONTRIBUTING.md](CONTRIBUTING.md) explains why the licence requires it. To contribute
machines, submit them to the
[machine library](https://github.com/thethinkmachine/automata-library), either from
the app's Library view or through the library's issue form.

## Citation

If you use AutomataStudio in your research, teaching materials or a publication,
please cite it. GitHub's **"Cite this repository"** button (from
[CITATION.cff](CITATION.cff)) produces APA and BibTeX, or you can copy these:

```bibtex
@software{chaubey_automatastudio_2026,
  author  = {Chaubey, Shreyan},
  title   = {{AutomataStudio}: An {IDE} for Designing, Simulating and Analysing Automata},
  year    = {2026},
  version = {2.9.0},
  url     = {https://github.com/thethinkmachine/AutomataStudio},
  note    = {Software}
}
```

> Chaubey, S. (2026). *AutomataStudio: An IDE for designing, simulating and analysing
> automata* (Version 2.9.0) [Computer software].
> https://github.com/thethinkmachine/AutomataStudio

Cite the version you actually used, so that others can reproduce your results. If you
have a paper, course or project that uses AutomataStudio, please open an issue to let
me know.

## License

AutomataStudio is released under the
**[PolyForm Noncommercial License 1.0.0](LICENSE)**. Under a supplemental grant, each
release converts to **AGPL-3.0-or-later** four years after it is published. Academic
research, teaching and personal use are noncommercial uses under the licence. See
[NOTICE](NOTICE) for the required notice.

Releases published before the licence change remain available under CC BY-NC-SA 4.0
([LICENSE-PRIOR-VERSIONS.txt](LICENSE-PRIOR-VERSIONS.txt)). That grant is irrevocable.

© 2026 Shreyan Chaubey
