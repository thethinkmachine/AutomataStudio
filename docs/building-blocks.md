# Building blocks — building a small CPU

A quick reference for using building blocks, written around the case they exist
for: modelling something with parts, where each part is worth understanding on
its own.

---

## The idea in one paragraph

A block is a **subroutine drawn as one node**. Instead of one enormous Turing
machine that copies a string, moves the head, compares two words and then
decides, you build four machines and wire them together. A block adds no
computational power — placing one *inlines* its states into the machine, and the
proof that blocks change nothing is that expansion. What they buy is legibility
and reuse.

Blocks are a **Turing-machine feature**: `TM`, `NDTM`, `MTM`, `LBA`, `ITM`. Control
leaves a block along an edge that reads anything, puts it back and does not move
(`Σ / Σ, S`), and only a machine with a *stay* move can do that without eating a
symbol. On a DFA the same edge would change the language, so the option is not
offered.

## The three things to know before you start

**One entry, several named exits.** A block's entry is its start state. Its exits
are the states control leaves from, and their names are what you wire onward —
so `compare` can leave one way when the words match and another when they do
not. This is the thing that makes blocks compose at all.

**A block's accepting states become its exits, and stop being accepting.** A
block finishing is not the machine accepting. Keep the real accept states
outside, at the top level.

**Two placements of one block are two copies.** Four ALUs are four independent
copies of the ALU's states — as in hardware. Fixing the library's multiplier does
not reach into the four already on the canvas; that is a separate, deliberate
action.

---

## Setting up a small CPU

### 1. Pick a Turing machine and get the alphabet right first

Model picker → **TM (DTM)**, or **MTM** if you want separate tapes for the
registers, the instruction and scratch space. A multi-tape machine is usually
much less painful for a CPU, because the alternative is one tape with delimiters
and a lot of head travel.

Add every symbol you will need to **Σ** and **Γ** now. A block placed later
brings its own alphabet with it, but starting from the right one saves rework.

### 2. Build the smallest part first, on its own

Draw the adder — just the adder — on an empty canvas. Give it:

- one clear start state
- one or more halting states, marked **accepting**, one per outcome you want to
  distinguish (`done`, `overflow`)

Run it. Get it right *before* it becomes a block. Debugging a block is far
easier when you already know the thing inside it works.

### 3. Turn it into a block

Select its states (marquee, or shift-click) → right-click → **Group into
Block** → name it `add`.

The box appears with a title strip and, under it, a small live drawing of what
is inside — the same drawing the minimap makes of the whole machine. That
picture is how you will recognise it later.

### 4. Save it to the library

Right-click the box → **Save to Library…**. This is what makes it reusable: the
definition is kept in the browser's IndexedDB, independent of this workspace.

### 5. Repeat for the other parts

`sub`, `mul`, `div`, `cmp`, `shift`. Same loop each time: draw it, test it,
group it, save it.

### 6. Assemble the ALU

On a fresh canvas (or a fresh workspace tab), place the four arithmetic blocks
and draw the control states that dispatch between them. Wire:

- an edge **into** each block's box, which lands on its entry
- an edge **out of** each exit

Then select the four boxes *and* the dispatch states → **Group into Block** →
name it `ALU`. Save it.

**This is the step that makes nesting work.** A selected block becomes a child of
the new one, so `ALU` now contains `add`, `sub`, `mul` and `div`.

### 7. Assemble the CPU

Place `ALU` as many times as you need, plus the control unit, the register file
and the bus. Group the lot into `CPU` if you want one box for the whole thing.

There is **no maximum nesting depth** — containment is a tree, and depth is a
walk up it.

---

## Getting around

| | |
|---|---|
| **Double-click a box** | go inside it |
| **Breadcrumb** (top of the canvas) | click any level to jump back to it |
| **↑ button** / **Escape** | out one level |
| **Blocks panel** (left sidebar) | every block in the machine, at every depth, with its path — click to open. This is how you reach the multiplier three levels down without drilling through its parents |

Inside a block you see two extra things at the edges: a dashed **entry tab**
saying where control arrives from, and a dashed **exit tab** per exit saying
where it hands control back. They are not part of the machine — they are its
boundary, drawn so a sub-machine does not read as a disconnected fragment. Click
either to go back out.

The canvas remembers where the camera was on each level, so drilling out puts
you back where you were.

---

## Debugging a CPU

The whole machine is flat underneath, so **everything still runs normally** —
the simulator, the batch tester, the Language panel, export, codegen. What blocks
add is knowing *where* you are:

- A run inside a collapsed block **lights the block**, so you can see which part
  the computation is in without opening it.
- The trace log names states by their full path — `CPU/ALU 2/mul/shift-loop` —
  so a non-halt tells you which part failed to halt.
- Drill into that block and re-run: the highlight is now on the state itself.

If the machine stops deciding what it used to, the cause is almost always the
wiring at a boundary, not the block: check that the edge out of an exit is
`Σ / Σ, S` and that you wired it from the **exit port**, not from some state in
the middle of the block.

---

## Things that will bite you

**A block that already branches.** If the machine you grouped had two rules for
the same read, it still does. Placing it says so at the bottom of the screen —
read that message; it is your machine telling you it is nondeterministic.

**Editing one instance.** Four ALUs are four copies. Change the multiplier inside
`ALU 2` and `ALU 1` is untouched. That is correct macro semantics, and usually
what you want in hardware — but it does mean the library is the place to fix a
bug once.

**Names get long.** Interior states are prefixed with the block's name, so
`ALU 2/mul/scan`. Inside a block the panel shows the short name; the long one is
the path and is what keeps two `scan` states in different ALUs from being one
state to the app.

**Ungroup is not delete.** *Ungroup Block* puts the states back on the current
level and drops the box — the machine is unchanged. *Delete Block and Contents*
removes everything inside it. Both are one Ctrl+Z.

**A block cannot contain itself.** Saving a definition that transitively contains
the block you are saving over is refused — the expansion would not terminate.

---

## The real ceiling, honestly

Composing, nesting and drilling into a CPU is comfortable. **Running one to
completion is not, yet.**

`maxTmSteps` defaults to 10,000. An 8-bit multiply by repeated addition on a tape
is 10⁵–10⁶ steps, and the app keeps every step of a run so you can scrub back
through it — at roughly 190 bytes a step, a million-step run is ~190 MB. So:

- **Raise** Settings → Turing → max TM steps for anything non-trivial.
- Expect a long run to get heavy. Test the parts individually — that is what the
  parts are for — and run the whole CPU on small inputs.

This limit is not caused by blocks; blocks just make it easy to build something
big enough to reach it. Lifting it needs a windowed step log, which is separate
work.

---

## Suggested first project

Rather than a CPU, build this — it is the same shape and takes an afternoon:

1. `copy` — copy the word after `#` to the end of the tape (exit: `done`)
2. `rewind` — walk the head left to the first blank (exit: `at-start`)
3. `compare` — compare two `#`-separated words (exits: `equal`, `differ`)
4. Top level: `copy` → `rewind` → `compare` → accept / reject

You will have used every part of the feature: grouping, exits that mean
different things, the library, and drilling in to fix the one that is wrong.
