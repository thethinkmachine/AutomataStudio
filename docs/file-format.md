# The machine file format

> How to write a machine that AutomataStudio (https://automatastudio.pages.dev/) opens: a
> JSON document of states, transitions and alphabets, one shape for every machine
> type. This page is also served as plain text at
> https://automatastudio.pages.dev/llms.txt, for AI assistants.

AutomataStudio saves a machine as JSON, in a file ending `.automaton` (or `.json`). You
can write one by hand, generate one from a script, or ask an AI assistant to write one.
This page has everything needed to get it right.

**Asking an AI assistant for a machine?** Give it this page's address,
`https://automatastudio.pages.dev/llms.txt`, and ask for "an AutomataStudio `.automaton`
file". The app's own address won't help: the app is drawn by JavaScript, so an assistant
that fetches it gets an empty page.

- [Opening a machine you were given](#opening-a-machine-you-were-given)
- [A complete example](#a-complete-example)
- [The document](#the-document)
- [Symbols with a meaning](#symbols-with-a-meaning)
- [Each kind of machine](#each-kind-of-machine)
- [The machine card and test words](#the-machine-card-and-test-words)
- [Before you hand it over](#before-you-hand-it-over)
- [Other formats the app opens](#other-formats-the-app-opens)

---

## Opening a machine you were given

Any of these works, on the website and in the desktop app:

- **Paste it.** Copy the JSON, click the canvas and press <kbd>Ctrl</kbd>+<kbd>V</kbd>
  (<kbd>⌘</kbd>+<kbd>V</kbd> on a Mac). A code block copied from a chat works as it is,
  with its ```` ``` ```` fences.
- **Open it** with the Open button in the header, or drop the file onto the canvas.
- **Double-click it**, if the desktop app is installed.

A pasted or opened machine never replaces the one on screen. If the canvas is in use, the
machine opens in a new tab. If the file has a problem, the status line says what it is.

## A complete example

A DFA over `{0, 1}` that accepts the words with an even number of 1s:

```json
{
  "machine": "DFA",
  "sigma": ["0", "1"],
  "states": [
    { "id": "s1", "name": "even", "x": 140, "y": 200 },
    { "id": "s2", "name": "odd",  "x": 360, "y": 200 }
  ],
  "startId": "s1",
  "accepts": ["s1"],
  "transitions": [
    { "id": "t1", "from": "s1", "to": "s1", "symbol": "0" },
    { "id": "t2", "from": "s1", "to": "s2", "symbol": "1" },
    { "id": "t3", "from": "s2", "to": "s2", "symbol": "0" },
    { "id": "t4", "from": "s2", "to": "s1", "symbol": "1" }
  ],
  "meta": {
    "title": "Even number of 1s",
    "blurb": "A 0 leaves the count alone and a 1 flips it.",
    "inputs": [
      { "w": "11",  "expect": "accept" },
      { "w": "",    "expect": "accept", "label": "the empty word" },
      { "w": "111", "expect": "reject" }
    ]
  }
}
```

Every machine type has a worked example the app ships with, at
`https://automatastudio.pages.dev/js/examples/<name>.json`. The name for each type is
listed under [Each kind of machine](#each-kind-of-machine). Starting from the example for
your type is the surest way to get its fields right.

## The document

| Field | Required | What it holds |
| --- | --- | --- |
| `machine` | always | The machine type, spelled exactly as in the [table below](#each-kind-of-machine): `"DFA"`, `"NPDA"`, `"TM"`, … |
| `sigma` | always | The input alphabet Σ, as an array of strings. `[]` for a Minsky machine. |
| `states` | always | The states. See [States](#states). |
| `transitions` | always | The transitions. See [Transitions](#transitions). |
| `startId` | always | The `id` of the start state. |
| `accepts` | always | The `id`s of the accepting states. `[]` when there are none, as in a parity automaton. |
| `stackAlpha` | stack, queue and tape machines | Γ: the stack or queue alphabet, or a Turing machine's tape alphabet. |
| `outputAlpha` | transducers | The output alphabet. |
| `tapeCount` | `MTM` | The number of tapes. |
| `registers` | `Minsky` | The registers. See [Minsky machines](#minsky-machines). |
| `config` | no | Settings the machine depends on, such as how a pushdown automaton accepts. Each type below says which apply. |
| `meta` | no | The machine card: a title, a description and test words. See [The machine card](#the-machine-card-and-test-words). |
| `notes` | no | Sticky notes on the canvas, in Markdown: `{ "id": "n1", "x": 150, "y": 70, "text": "…" }`. |

Leave out `format`, `schema` and `app`. The app adds them when it saves a file. It also
adds layout, camera and grammar fields of its own, and a file without them is complete.

### States

```json
{ "id": "s1", "name": "q0", "x": 140, "y": 200 }
```

- **`id`** is any string, unique among the states. Transitions, `startId` and `accepts`
  refer to states by `id`, never by name.
- **`name`** is the label drawn in the circle. A short stem with an index draws as a
  subscript: `q0` and `q_0` read q₀, and `q_even` reads q with "even" lowered.
- **`x`, `y`** place the state on the canvas, in pixels, with y pointing down. About 200
  apart reads well. They are optional: if any state has no position, the app lays out the
  whole machine itself when it opens the file.
- Moore machines add `output` and parity automata add `priority`. See below.

### Transitions

```json
{ "id": "t1", "from": "s1", "to": "s2", "symbol": "a" }
```

- **`id`** is any string, unique among the transitions.
- **`from`** and **`to`** are state `id`s. A transition from a state to itself is a loop.
- **`symbol`** is the input symbol the transition reads. It must be in `sigma`, or be one
  of the [special symbols](#symbols-with-a-meaning).
- **One symbol per transition.** A move on `a` or `b` is two transitions. The canvas
  draws them as one edge labelled `a, b`.
- The other fields depend on the machine type, and each type below lists them.

### Symbols are strings, and may be words

A symbol is any string: `"0"`, `"a"`, `"tick"`, `"coin"`. When an alphabet has symbols
longer than one character, words are typed with the symbols separated by spaces or commas:
`tick tick tock`.

## Symbols with a meaning

Write these as the exact characters shown. Never put them in `sigma`, though a tape
machine's `stackAlpha` does include the blank.

| Symbol | Name | Where it is used |
| --- | --- | --- |
| `ε` | epsilon | A transition that reads no input (`"symbol": "ε"`), or a stack field that pops or pushes nothing (`"pop": "ε"`). Also the empty word in a test. |
| `Σ` | wildcard | Matches any symbol. A deterministic machine prefers an explicit symbol and takes `Σ` otherwise. A nondeterministic one takes every transition that matches. As a Turing machine's `write`, it writes back the symbol it read. |
| `⊔` | blank | The empty tape cell of a Turing machine. |
| `⊢` `⊣` | end markers | The left and right ends of the input for two-way automata, two-way transducers and linear bounded automata. |
| `Z` | stack bottom | The symbol a stack starts with (see [pushdown machines](#pushdown-and-other-store-machines)). Put it in `stackAlpha`. |

`ε` may be read only by the types marked "ε moves" below. A file that uses it anywhere
else is refused.

## Each kind of machine

| `machine` | Machine | Example file | Extra transition fields |
| --- | --- | --- | --- |
| `DFA` | Deterministic finite automaton | `dfa-classic` | — |
| `NFA` | Nondeterministic finite automaton | `nfa-classic` | — |
| `ε-NFA` | Finite automaton with ε moves | `enfa-classic` | — |
| `2DFA` | Two-way deterministic finite automaton | `twdfa-classic` | `dir` |
| `2NFA` | Two-way nondeterministic finite automaton | `twnfa-classic` | `dir` |
| `PFA` | Probabilistic finite automaton | `pfa-classic` | `weight` |
| `DBA` | Deterministic Büchi automaton | `dba-classic` | — |
| `NBA` | Nondeterministic Büchi automaton | `buchi-classic` | — |
| `DcoBA` | Deterministic co-Büchi automaton | `dcoba` | — |
| `NcoBA` | Nondeterministic co-Büchi automaton | `ncoba` | — |
| `DPA` | Deterministic parity automaton | `dpa` | — (states carry `priority`) |
| `NPA` | Nondeterministic parity automaton | `npa` | — (states carry `priority`) |
| `DWA` | Deterministic weak automaton | `dwa` | — |
| `NWA` | Nondeterministic weak automaton | `nwa` | — |
| `DPDA` | Deterministic pushdown automaton | `pda-classic` | `pop`, `push` |
| `NPDA` | Nondeterministic pushdown automaton | `npda-classic` | `pop`, `push` |
| `QA` | Queue automaton | `queue-classic` | `pop`, `push` |
| `Counter` | One-counter automaton | `counter-classic` | `pop`, `push` |
| `2PDA` | Two-stack pushdown automaton | `twopda-classic` | `pop`, `push`, `pop2`, `push2` |
| `EPDA` | Embedded pushdown automaton | `epda-classic` | `pop`, `push`, `below`, `above` |
| `TM` | Deterministic Turing machine | `tm-classic` | `write`, `dir` |
| `NDTM` | Nondeterministic Turing machine | `ndtm-classic` | `write`, `dir` |
| `MTM` | Multi-tape Turing machine | `mtm-palindrome` | `tapeSyms`, `tapeWrites`, `tapeDirs` |
| `LBA` | Linear bounded automaton | `lba-classic` | `write`, `dir` |
| `ITM` | Two-way infinite Turing machine | `ittm-classic` | `write`, `dir` |
| `Minsky` | Minsky register machine | `minsky-add` | `reg`, `op` (no `symbol`) |
| `Moore` | Moore machine | `moore-classic` | — (states carry `output`) |
| `Mealy` | Mealy machine | `mealy-classic` | `output` |
| `FST` | Finite-state transducer | `fst-classic` | `output` |
| `PDT` | Pushdown transducer | `pdt-classic` | `pop`, `push`, `output` |
| `2DFT` | Two-way deterministic finite transducer | `twodft-classic` | `dir`, `output` |

ε moves are allowed in `ε-NFA`, `DPDA`, `NPDA`, `QA`, `Counter`, `2PDA`, `EPDA`, `FST` and
`PDT`.

**Don't worry about choosing between the deterministic and nondeterministic type.** The
app checks what δ actually does when it opens the file. A `TM` whose δ branches opens as an
`NDTM`, and a `DPDA` whose δ branches opens as an `NPDA`, so either name works (and so does
`PDA`). The
deterministic ω-automata (`DBA`, `DcoBA`, `DPA`, `DWA`) are the exception: they refuse to
run if two transitions from one state can read the same symbol.

### Finite automata

`DFA`, `NFA` and `ε-NFA` need only the fields in [the example](#a-complete-example). A word
is accepted if a run reads all of it and ends in an accepting state. A DFA may leave
transitions out: a missing transition rejects.

### Two-way automata

`2DFA` and `2NFA` read the input between end markers, `⊢ w ⊣`, starting on `⊢`. Each
transition says where the head goes next with `dir`, which is `"L"`, `"R"` or `"S"` (stay).
The machine accepts as soon as it enters an accepting state.

```json
{ "id": "t1", "from": "s1", "to": "s1", "symbol": "⊢", "dir": "R" }
```

### Probabilistic automata

A `PFA` gives each transition a probability in `weight`, a number from 0 to 1. The
transitions leaving one state on one symbol should add up to 1. A word is accepted when the
probability of ending in an accepting state is greater than the cut-point, which is
`config.pfaCutPoint` (0.5 if left out).

```json
{ "id": "t2", "from": "s1", "to": "s2", "symbol": "1", "weight": 0.5 }
```

### ω-automata

The Büchi, co-Büchi, parity and weak automata read infinite words, written `u(v)`: `u`
once, then `v` forever. `a(b)` is a b b b …, and `(ab)` is a b a b …. Their transitions are
a finite automaton's. What changes is acceptance, which looks at the states a run visits
infinitely often:

- **Büchi** (`DBA`, `NBA`) accepts when some state in `accepts` is visited infinitely often.
- **co-Büchi** (`DcoBA`, `NcoBA`) accepts when, from some point on, the run stays inside
  `accepts`.
- **Parity** (`DPA`, `NPA`) gives every state a whole number `priority` and leaves
  `accepts` empty. A run is accepted when the smallest priority it visits infinitely often
  is even.

  ```json
  { "id": "s1", "name": "last was b", "x": 140, "y": 200, "priority": 2 }
  ```

- **Weak** (`DWA`, `NWA`) accepts as Büchi does, with one rule for the machine itself: each
  strongly connected component must lie wholly inside `accepts` or wholly outside it.

### Pushdown and other store machines

`DPDA`, `NPDA`, `QA`, `Counter` and `2PDA` need `stackAlpha`. Each transition reads an input
symbol (or `ε`), takes `pop` off the store and puts `push` on it:

```json
{ "id": "t1", "from": "s1", "to": "s1", "symbol": "a", "pop": "Z", "push": "AZ" }
```

- **`pop`** is one store symbol, or `ε` to take nothing (the move then happens whatever is
  on top).
- **`push`** is a string of store symbols, or `ε` to push nothing. Each character is one
  symbol, and the **leftmost ends up on top**: popping `Z` and pushing `AZ` puts `A` on top
  of `Z`. So stack symbols are single characters.
- **How it accepts is `config.pdaParadigm`.** `"explicit"` (the default) starts the stack
  holding `Z` and accepts when the input is used up in an accepting state. `"empty"` starts
  the store empty and accepts when the input is used up with the store empty.

The others work the same way, with these differences:

- **`QA`**, a queue automaton, takes `pop` from the front of the queue and adds `push` at
  the back.
- **`Counter`** is a pushdown automaton whose `stackAlpha` is one counting symbol plus `Z`,
  such as `["1", "Z"]`.
- **`2PDA`** has a second stack, written with `pop2` and `push2`.
- **`EPDA`** keeps a stack of stacks and works only on the top one. Besides `pop` and
  `push`, a transition can insert new stacks on either side of the top stack. `below` lists
  the ones to insert under it and `above` the ones to insert over it, separated by `|`, or
  `ε` for none. A top stack that empties is discarded. This one is unusual, so start from
  `epda-classic`.

```json
{ "id": "t1", "from": "s1", "to": "s2", "symbol": "a", "pop": "ε", "push": "A", "below": "E|C", "above": "ε" }
```

### Turing machines

`TM`, `NDTM`, `LBA` and `ITM` need `stackAlpha`, the tape alphabet Γ. It includes every
symbol in `sigma`, the blank `⊔`, and any symbols the machine writes. Each transition reads
the symbol under the head, writes `write` and moves `dir` (`"L"`, `"R"` or `"S"`):

```json
{ "id": "t1", "from": "s1", "to": "s1", "symbol": "0", "write": "0", "dir": "R" }
```

- The input starts on the tape with the head on its first symbol. Every other cell holds
  `⊔`.
- The machine **accepts as soon as it enters an accepting state**. It rejects when it stops
  in another state because no transition applies.
- The tape is infinite to the right only, unless `config.twoWayTape` is `true`. An `ITM`'s
  tape is always infinite in both directions.
- An `LBA`'s input sits between `⊢` and `⊣` (put both in `stackAlpha`). Moving past
  either marker rejects.

**Multi-tape machines.** An `MTM` adds `tapeCount`. Each transition gives one entry per tape
in `tapeSyms` (read), `tapeWrites` (write) and `tapeDirs` (move), and repeats the first
tape's read as `symbol`:

```json
{ "id": "t1", "from": "mark", "to": "copy", "symbol": "a",
  "tapeSyms": ["a", "⊔"], "tapeWrites": ["A", "a"], "tapeDirs": ["R", "R"] }
```

The input of an MTM is one word per tape, separated by commas, with `ε` for an empty tape:
`abba,ε`.

### Minsky machines

A `Minsky` machine has no input alphabet (`"sigma": []`). It has registers holding whole
numbers, declared in `registers`. `input` registers take the starting values and `output`
registers hold the answer:

```json
"registers": [
  { "name": "x", "input": true, "output": false },
  { "name": "y", "input": true, "output": true }
]
```

Transitions have no `symbol`. They name a register in `reg` and an operation in `op`:

| `op` | Does |
| --- | --- |
| `inc` | adds one to the register |
| `dec` | takes one from the register, and is possible only when it is above 0 |
| `zero` | changes nothing, and is possible only when the register is 0 |
| `nop` | changes nothing, always (leave out `reg`) |

So a `dec` and a `zero` transition from one state together make a test-and-branch. The
machine accepts when it reaches an accepting state. Its input is the input registers'
values in order, such as `3, 4`.

```json
{ "id": "t1", "from": "s1", "to": "s2", "reg": "x", "op": "dec" }
```

### Transducers

Transducers produce output as they read. They need `outputAlpha`.

- **`Moore`** puts the output on the states, as `output`. Its transitions are a DFA's.
- **`Mealy`** and **`FST`** put it on the transitions, as `output`. In an `FST` the output
  may be several symbols, or `""` for none.
- **`PDT`** is a pushdown automaton whose transitions also carry `output`.
- **`2DFT`** is a two-way automaton whose transitions also carry `output`.

```json
{ "id": "t1", "from": "s1", "to": "s2", "symbol": "a", "output": "b" }
```

`config.transducerAccepts` says whether the transducer also accepts or rejects. When it is
`false` (the default), the app shows the output and gives no verdict.

## The machine card and test words

`meta` is the card shown on the canvas beside the machine. All of it is optional, and it
is the best place to explain the machine to whoever studies it:

```json
"meta": {
  "title": "aⁿbⁿ",
  "blurb": "Pushes an A for every a and pops one for every b.",
  "inputs": [
    { "w": "aabb", "expect": "accept" },
    { "w": "aab",  "expect": "reject", "label": "one b short" }
  ]
}
```

- **`title`** and **`blurb`** are plain text.
- **`inputs`** are test words shown as chips on the card, which the reader can run with one
  click. `w` is the word (`""` is the empty word), `expect` is `"accept"` or `"reject"`, and
  `label` is an optional caption. A transducer's row can give its expected output as `out`.
- Write each word the way it would be typed in the app: `a(b)` for an ω-automaton,
  `abba,ε` for a multi-tape machine, `3, 4` for a Minsky machine.

## Before you hand it over

- `machine` is spelled exactly as in the table, including the case.
- Every `from`, `to`, `startId` and `accepts` entry is the `id` of a state that exists.
- Every `id` is unique among the states, and every transition `id` among the transitions.
- Every symbol a transition reads is in `sigma`, or is a [special symbol](#symbols-with-a-meaning).
  A stack or tape symbol is in `stackAlpha`.
- There is one symbol per transition. Use a second transition for a second symbol.
- `ε` appears only in a type that allows ε moves, and only as these characters.
- The fields are the ones listed for the type, spelled the same way: `dir`, not `move`, and
  `output`, not `out`.
- The result is plain JSON, with no comments and no trailing commas.

## Other formats the app opens

You can also give the app these:

- **JFLAP** (`.jff`) finite automata, pushdown automata, Turing machines, Mealy and Moore
  machines. Open them like any file.
- **A Turing machine in the standard text notation**, `1RB1LC_1RC1RB_…`, as used by
  bbchallenge and the Busy Beaver wiki. Paste it onto the canvas.
- **A machine code**, the one-line form the app writes with **Copy Machine Code**. Paste it
  onto the canvas.
- **A statechart**, as SCXML or an XState config. Open it like any file.

The `automata` command line reads all of these and also Hanoi Omega-Automata (`.hoa`) and
RABIT/GOAL Büchi automata (`.ba`), and `automata convert` turns any of them into an
`.automaton` file. See [the command line](https://github.com/thethinkmachine/AutomataStudio/blob/main/docs/cli.md#formats-getting-machines-in-and-out). If you
work with an AI assistant that can run commands, `automata lint` and `automata run` let it
check a machine before handing it over.
