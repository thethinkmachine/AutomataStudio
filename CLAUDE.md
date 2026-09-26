# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev                # Vite dev server on :5173
npm run build              # vite build -> dist/
npm test                   # node --test over tests/*.test.js
node --test tests/language.test.js                       # single file
node --test --test-name-pattern "subset construction"    # single test by name
npm run electron:dev       # vite + electron pointed at the dev server
npm run electron:preview   # production build, run in electron
npm run electron:build     # electron-builder -> release/
npm run wasm               # asc wasm/label-penalty.ts -> js/wasm/ (output committed)
```

`npm run wasm` is run by hand after editing [wasm/label-penalty.ts](wasm/label-penalty.ts) and its output is committed, the way `npm run glyphs` and `npm run icons` already are — the build does not shell out to a compiler. See [The label kernel](.claude/skills/perf/SKILL.md).

CI: `.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on push to `main`. `.github/workflows/electron-build.yml` packages win/mac/linux installers on every push and publishes a GitHub Release for `v*` tags.

The package is `"type": "module"`. The two Electron entry points are CommonJS and carry a `.cjs` extension for that reason ([electron/main.cjs](electron/main.cjs), [electron/preload.cjs](electron/preload.cjs)).

## Where the rest of these notes live

This file holds what applies everywhere. The area-specific notes moved out so they load
only when they are relevant — same text, same headings, nothing was deleted.

| Working on | Read |
| --- | --- |
| StateMate, the Inspector console, panel tabs, floating sections | `.claude/skills/statemate/SKILL.md` |
| Building blocks, scope, ports, the view-graph projection | `.claude/skills/blocks/SKILL.md` |
| Running a machine: the player, the tape, space-time diagrams, the complexity profile, lazy execution, workers | `.claude/skills/simulation/SKILL.md` |
| Saving, loading, export, codegen, share links, JFLAP, XState/SCXML import | `.claude/skills/persistence/SKILL.md` |
| Exercises and grading, the lexer generator | `.claude/skills/exercises/SKILL.md` |
| Layout geometry, culling, the large-machine profile, the label kernel | `.claude/skills/perf/SKILL.md` |
| Dialogs and the two sidebars | `.claude/skills/ui-chrome/SKILL.md` |
| The machine card, the wizard, the mobile shell | `.claude/skills/ui-features/SKILL.md` |
| Grammars | `js/grammar/CLAUDE.md` (loads automatically) |

## Architecture

### Modules, and the one global seam

`js/` is ES modules with explicit imports and exports; `index.html` loads exactly one script, [js/main.js](js/main.js). There is no shared global scope and no load-order dependency — with one deliberate exception.

**[js/bridge.js](js/bridge.js)** re-exposes 225 names on `window` (224 functions plus `App`). The UI is driven by `on*="..."` attributes, which are evaluated as global-scope code and cannot see module bindings. 337 of those attributes are static in `index.html`; a further 122 are in markup the app builds at runtime (algorithm cards in `algorithms-fa.js`, the export dialogs, alphabet chips, context menus) — so grepping `index.html` alone will understate what the HTML depends on.

Practical consequences:

- **Adding a function called from an `on*` attribute means adding it to `bridge.js`.** Nothing else will fail loudly; the button just won't work.
- Everything *not* in `bridge.js` is free to rename. The build mangles top-level names, and only `bridge.js`'s object keys survive.
- `bridge.js` is the worklist for removing this seam: move a handler to a delegated `data-action` listener, delete the name, and the surface shrinks by one.

### Evaluation-order rules

ES modules make most ordering irrelevant, but three rules are load-bearing and cheap to break:

- **[js/state.js](js/state.js) imports one module, and only because Solid is not ours.** Several modules run top-level code against `$` and `App` — `canvas.js` resolves `#canvas-wrap`, `grammar-ui.js` resolves the editor — which only works because `state.js` is a leaf and therefore fully evaluated first. Its single import is [js/reactive.js](js/reactive.js), which imports Solid and nothing else; Solid cannot import back into the app, so the subgraph is closed and `state.js` is still a leaf of the *app's* graph. That is the property the rule protects. Don't add an import of an app module to it. The machine-shape predicates (`getMachineConfig`, `isAnyTM`, `normalizeBoundarySymbolsForMachine`, …) live there rather than in `utils.js` for exactly this reason.
- **Shared mutable containers live in leaf modules.** A hoisted function is reachable across an import cycle before its own module finishes evaluating, but the `const` it closes over is not — reading it throws *"Cannot access before initialization."* This bit `registerModal` (eight modules call it at module scope) and `ExportFormats` (written by both `export-ui.js` and `codegen.js`). Both containers now sit in import-free modules: [js/modal-registry.js](js/modal-registry.js) and [js/export-registry.js](js/export-registry.js). [js/machines/registry.js](js/machines/registry.js) is the third and the same shape: seven family modules call `defineFamily` at module scope. [js/store.js](js/store.js) imports only `reactive.js` for the same reason — modules `subscribe` at module scope, and a leaf-of-the-app-graph is what keeps a hoisted `subscribe` reachable regardless of evaluation order. Follow that pattern for anything else written at module scope from more than one place.
- **`js/init.js` runs last.** It is the boot sequence, imported last by `main.js`, after `bridge.js`.

Circular imports between the UI modules (`canvas` ↔ `render` ↔ `ui` and friends) are expected and safe — every one resolves a function reference at call time.

### Cross-module writes

Imported bindings are live for reads but read-only for writes. `R`, `Workspaces` and `activeWorkspaceId` are declared in `state.js` and reassigned elsewhere, so they go through `setR`, `setWorkspaces`, `setActiveWorkspaceId`. Reads use the plain import. Assigning to an import is a build error, so this fails loudly rather than silently.

### State

`App` in [js/state.js](js/state.js) is the single mutable store: current machine, `states`/`transitions`, alphabets (as `Set`s), selection, camera, `config`, simulation cursor. `MachineTypes` there is the capability table (`hasStack`, `hasTape`, `hasEpsilon`, `isTransducer`, `hasEndMarkers`, `isWeighted`, `isOmega`) most machine-agnostic code branches on — prefer adding a capability flag over `if (App.machine === ...)` chains.

Two of those flags change what a "run" is, so they cut across more than panel visibility. `isWeighted` (PFA) makes a configuration a probability distribution over Q rather than a state or a set of them, simulated by the forward algorithm and decided against `config.pfaCutPoint`. `isOmega` (`DBA`, `NBA`) makes the input an ultimately periodic ω-word typed as `u(v)`; it bypasses the finite-word tokenizer in both `runSim` and `computeBatchResults`, and acceptance is a reachable cycle through F in the (state × position) graph, which is also where the witness lasso comes from. Anything that enumerates Σ\* — the Language panel especially — has to opt out for `isOmega` rather than report finite-word verdicts.

**The eight ω-automata are one structure over two axes**, and both are named by the type, so the label on screen is always the machine you have. The `Omega Automata` group is determinism × α: `DBA`/`DcoBA`/`DPA`/`DWA` and `NBA`/`NcoBA`/`NPA`/`NWA`. Each `MachineTypes` entry carries `omegaCondition` (`buchi`, `cobuchi`, `parity`, `weak` — catalogued in the `OmegaAcceptance` registry) and `deterministic`, read back through `omegaAcceptanceOf`, `usesParityPriorities` and `isDeterministicOmega`. **There is no config knob**; adding a ninth type means adding a row, not a setting.

Determinism is enforced twice, from one declaration each time. The editor asks the machine for its `determinism` rule (`js/machines/omega.js`); the run asks it for its `guards`, since a loaded or imported machine never passed through the editor. Both tests are the same one — symbol *overlap* rather than equality, because `buchiSuccessors` takes every matching edge instead of resolving to the most specific one the way the deterministic finite-word simulators do — and `hasSingleValuedDelta` reads the same `deterministicDelta` flag, so the three cannot disagree.

All four conditions judge the same object: `inf(r)`, which on an ultimately periodic word is exactly the states on the run's lasso cycle. So each is a predicate over a cycle, and `exploreOmega` serves all eight types by choosing an anchor node plus an `allow` filter in `omegaCycleCandidates` — the filter constrains the *cycle* only, since a finite stem cannot affect `inf(r)`, which is what lets co-Büchi pass through F on the way in. `parity` is the one that changes the data model: α becomes a per-state integer `s.priority`, so F, the accepting ring and the double-click toggle all go away (`acceptsAreShown`), and the number takes over the Moore output's sub-label slot. `weak` decides exactly as `buchi`; its extra content is `findWeakViolation`, a Tarjan pass over the *automaton* asserting every SCC lies wholly inside F or wholly outside it.

Between them the two axes decide expressive power, and it is not uniform: `DBA ⊊ NBA`, but `DPA = NPA` = the full ω-regular class, and `NcoBA = DcoBA ⊊ ω-regular`. Büchi is the only cell where determinism costs languages — which is why `dcoba.json` and `dpa.json` both recognize `FG b`, the language `buchi-classic.json` can only reach by guessing, and why `ncoba.json` and `nwa.json` carry a deliberately redundant branch.

`MachineCategories` drives the model picker; `PDA` is a hidden alias of `DPDA` and is deliberately absent from it.

**The ordering traps that used to live here are gone, and it is worth knowing what they were.** `isAnyPDA` includes `PDT` and `isTwoWayFA` includes `2DFT`, so a per-machine branch for either had to sit *above* the family check in `langTupleSyms`, `langDeltaSignature`, `updateFormalDef` and `updateRegex`, or the family answer won and the output alphabet silently vanished from the tuple. `hasSingleValuedDelta` had the same shape inverted: its `isOmega` branch had to answer `cfg.deterministic` rather than a blanket `false`, or the editor would let you draw an NBA and call it a DBA. Both were properties of a *list read in order*. Each machine now declares its own tuple, δ signature and determinism rule (see [The machines](#the-machines)), and a per-type lookup has no order to get wrong.

**There is one definition of an empty workspace**, `blankWorkspaceData()` in [js/state.js](js/state.js), and both the new-tab path and the Clear button start from it. There used to be two and they disagreed: the new-tab literal in `ui.js` reset the machine, all three alphabets, the tape count, the camera and the grammar, while `performClear()` emptied the graph and left every one of them standing — so Clear handed back a canvas still carrying the previous machine's Σ and Γ, the old grammar in the Grammar view, the description card, and the camera parked over where the deleted diagram had been. That is a blank *screen*; the tab beside it reading "Workspace 2" is a blank workspace.

`clearAll()` (the button) is now `resetWorkspace()`; `performClear()` survives as the narrower one, and **the machine-type switch is its only caller** — the diagram cannot survive the switch but Σ can, and retyping the alphabet because you moved from a DFA to a PDA over it would be busywork. Two things there are easy to get wrong: the undo point is taken before the reset and has to be **carried across the import**, since a blank workspace carries an empty `history` like any other loaded blob and assigning it would throw away the entry that undoes the clear; and the reset changes the machine *type*, so it ends in `applyMachineSwitch` — `emit(Change.GRAPH)` redraws the diagram but does not re-shape the editor around a different machine.

Multi-tab editing lives in `Workspaces` / `activeWorkspaceId`: each tab is a serialized `exportWorkspaceState()` blob, and switching saves the live `App` into the outgoing tab and rehydrates the incoming one.

### Announcing changes

**After mutating `App`, say what changed — do not call renderers directly.** [js/store.js](js/store.js) is a small publish/subscribe layer:

```js
snapshot();                            // undo point — BEFORE the edit
App.accepts.add(id);
emit(Change.GRAPH);                    // ... announced after it

commit(() => { /* the edit */ });                          // both, in one call
commit(() => { /* … */ }, Change.ALPHABET, Change.GRAPH);  // that also touched Σ/Γ
emit(Change.CANVAS);                   // repaint only, no undo point
batch(() => { /* many edits */ });     // deliver once at the end
```

**`snapshot()` records the state an edit starts *from*, so it goes before the mutation.** `App.history` holds past states; the one on screen is never on it. `undo()` pops the top and hands the state being left behind to redo. ~45 sites use the explicit two-call form above; `commit()` in [js/history.js](js/history.js) wraps it and takes the edit as a callback so the ordering cannot be got wrong.

That callback is not ceremony. `commit()` used to be `snapshot(); emit()` called *after* the mutation, which put the snapshot on the wrong side of it — two orderings sharing one stack, and `undo()` can only be written for one. The mismatch cost a step on every undo and left the newest edit unreachable by redo. There is no boot snapshot for the same reason: at boot there is nothing behind the empty canvas.

Points worth keeping in mind:

- **Delivery is synchronous.** `fitToScreen` and `autoFitLoadedMachine` measure the DOM on the line after an edit; deferring would hand them stale geometry. `batch()` is the opt-in for coalescing.
- **`Change.CANVAS` does not dirty the tab.** It means selection/highlight repaints, which `exportWorkspaceState` does not persist — dirtying there would raise the unsaved-changes prompt for clicking a state. The camera is the exception that *is* persisted, and `canvas.js` calls `markDirty()` for it explicitly.
- **`Change.META` is the info card's text, and it is its own kind for two reasons.** It *is* persisted, so unlike `CANVAS` it dirties the tab; it is not the machine, so unlike `GRAPH` it must not drag the panels and the whole diagram through a re-render because a blurb was reworded. `machine-card.js` subscribes the card renderer to `META` and only the button's visibility to `GRAPH` — a full redraw on `GRAPH` would wipe StateMate's result strip off the card between the run and the reading of it.
- **Subscribers live beside the functions they call** (`render.js`, `alphabet.js`, `ui.js`, `history.js`), registered at module scope. `store.js` imports nothing so `subscribe` is always reachable.
- Declaration order in `Change` is delivery order.

### Reactivity, and where it stops

**The app uses Solid's signals and none of Solid's renderer.** [js/reactive.js](js/reactive.js) is the only module that imports `solid-js`; everything else takes its primitives from there, so the library is one named seam rather than eighty import sites.

**The line is drawn at the frame budget, and it was measured rather than argued.** Wrapping `App` in a store proxy (`createMutable`) is the obvious way to do this and it is the wrong one: a proxied property read benchmarked at **~260× a plain one** — 780µs/frame for six reads across a 1000-state machine, against a 16.7ms budget, before any geometry or DOM work happens at all. It is the `Proxy` trap that costs and not the dependency bookkeeping, so `untrack()` does not buy it back. So **the canvas hot path is not reactive and must not become reactive**: `buildLayoutContext`, `updateFastDOM`, `resolveNodeOverlaps` and `cullViewport` read plain properties off plain objects, sixty times a second, exactly as before. Every performance note in [Very large machines](.claude/skills/perf/SKILL.md) still describes live code.

What *is* reactive is the derived panel content and the Sets feeding it — things that recompute per structural edit rather than per frame.

- **`changed(kind)` in [js/store.js](js/store.js) is the invalidation token, and it does not replace `subscribe`/`emit`.** The two coexist on purpose. Dispatch stays a subscriber list because its ordering is a documented contract (declaration order in `Change`, not emit order) and 22 function calls were never the cost. `deliver()` bumps a version signal per kind **before** running subscribers, or a subscriber like `updateRPanel` reads a memo still holding the previous edit's value.
- **The expense was `updateFormalDef`**, whose last two lines are an `innerHTML` write and a full KaTeX re-typeset of the machine's tuple — and which ran on *every* `emit(Change.GRAPH)`. Most graph edits do not change what that box shows: δ is drawn as a signature rather than as a listing, so adding, editing or deleting a transition leaves Q, Σ, q₀ and F alone. Behind a memo, a realistic editing session (60 transition edits, 20 drags that nudged a neighbour, 10 real structural changes) went from 90 re-typesets to 10.
- **The skip is decided on the built string, not on the dependency.** The states are plain objects by the rule above, so there is nothing finer to depend on than "the graph changed" and the LaTeX is still rebuilt per structural edit. Rebuilding a string is cheap; typesetting it is not. `_defBoxPainted` is what the box currently holds, and it is tested against the DOM as well as the memo — the box is repainted from under it by a theme change.
- **`renderLanguagePanel` is memoised the same way, and `updateRegex` deliberately is not.** All three were measured in Chromium on a 12-state DFA before anything was changed: the formal definition cost **1.79ms** (essentially all KaTeX), the Language panel **0.80ms**, and `updateRegex` **0.01ms**. The last is noise, and memoising it for symmetry would add a guard to something that does not need one. The panel's own pieces are keyed-cached inside (`_langExtCache`, `_langVocab`), so its 0.80ms is not computation — it is DOM writes, class toggles and the tuple render running whether or not anything would differ.
- **The Language panel's key has to be structural, and it is worth knowing why the cheap options are wrong.** A key built from the class label freezes the panel on every TM and PDA, where that label is the constant `Recursively Enumerable Language`; a key built from counts misses a retargeted edge, which changes the language while leaving every count identical. So it is `_regexCacheKey()`, and the cost was checked rather than assumed: at 1000 states / 2000 transitions the key costs **0.199ms** to skip **0.80ms**, and the margin narrows slowly enough that it pays at every size the app draws. Together the two memos take a full `updateRPanel` from **2.21ms to 0.23ms**, and a realistic session (40 drags, 30 idempotent repaints, 20 real structural edits) avoids 70 of 90 redraws on each.
- **`_regexCacheKey()` is deliberately *not* memoised**, and that asymmetry is the point. It is a change *detector*: it exists to notice edits nobody announced, which is why `deriveRegex` can be called straight after a direct write to `App.accepts` and still be right. Hanging it off `emit` would make it circular — blind to precisely the mutations it is there to catch. [tests/language.test.js](tests/language.test.js) fails if it is memoised; that is not an accident.

**The Sets are reactive at the field, never at the call site.** Σ, Γ, the output alphabet, F and the four selection sets are mutated in place 76 times (`App.accepts.add(id)`) and reassigned wholesale a further 33 times from twelve modules. A plain `Set` notifies on neither path, and a `ReactiveSet` that some later assignment quietly replaced with a plain `Set` would stop notifying **with no error anywhere** — the panels would simply go stale. So `installReactiveSetField()` in [js/state.js](js/state.js) installs a coercing accessor: every existing `App.sigma = new Set(...)` keeps working untouched and cannot downgrade the field. `ReactiveSet` is a real `instanceof Set`, so the shape tests in `normalizeBoundarySymbolsForMachine` still hold.

**The setter builds a new set rather than refilling the existing one**, and that is load-bearing: `exportWithOverrides` in [js/export-core.js](js/export-core.js) saves `App.accepts`, installs a temporary, and restores the saved reference in a `finally`. Refilling in place would empty the very object it just saved and lose the machine's real accept marks.

- **`updateLPanel` is guarded on what its rows draw, not on structure.** It rebuilt both lists on every `emit(Change.GRAPH)` — **6.95ms** on a 200-state machine, a fifth of the delivery — so toggling one accept mark redrew 200 state rows and 400 transition rows. A structural key is not enough here: a rename changes no id, and a relabelled edge changes no count. The transition fields are **enumerated rather than listed**, because they differ per machine (a TM carries `write`/`move`, a PDA `pop`/`push`, an MTM three arrays) and a hand-written list would fall behind the next machine added and silently stop redrawing for it. `curve` and `loopAngle` are skipped — a list shows no coordinates, and an edge drag would otherwise bust the key on drop for a row that reads identically. The two filter strings are part of it, or typing in the search box would be a no-op whenever the machine had not moved. **6.95ms → 0.10ms.**
- **The machine card's guard is about a forced reflow, not about the card.** `renderExampleCard` ends in `repositionCanvasInfo()`, which calls `getBoundingClientRect` on `#canvas-wrap` and so forces a synchronous layout flush against the whole diagram — **8.4ms** on a 200-state machine, paid even on the early-return path where `App.meta` is null and the card is closed, i.e. when there is nothing to draw. That would be fine if `META` meant "the card changed", but it does not: every path that rehydrates `App` announces it, so `restoreSnapshot` (**each undo and redo**), both tab-activation paths and StateMate's `restoreCheckpoint` all paid the reflow to redraw a card that usually had not moved. Only the **subscriber** is guarded, on a signature of `App.meta`; every direct caller is a live interaction with the card, where module state the signature cannot see has changed and the redraw is the point. `emit(Change.META)`: **12.65ms → 0.01ms.**

**The drag path is incremental, and the cliff it removed was in an unexpected place.** Profiling the frame cost across sizes found the worst machine in the app was the one just *under* the collision budget, not the largest: at 200 states a drag frame cost **21.9ms** against a 16.7ms budget, and at 210 states — one past the line, where the stages are skipped, culling engages and the large-machine profile drops the labels — the same frame cost **1.05ms**. A subset construction on a twelve-state NFA lands squarely in the bad band. Attribution at 200 states put 18.4ms of the 21.9 in `buildLayoutContext`, and 16.9ms of *that* in `smartLabels` alone.

`relayout()` in [js/geometry.js](js/geometry.js) rebuilds only what a change could have altered. A drag moves one state out of two hundred; what that can affect is edges incident to it, edges it now blocks or has stopped blocking, self-loops on its neighbours (a loop is aimed to dodge the edges arriving at its own state), and the labels of all of those. Everything else keeps the geometry it had — cheaper, and steadier, since a label on the far side of the diagram re-optimising during a drag it has nothing to do with reads as jitter. **200 states: 21.9ms → 8.8ms; a fifty-state selection: 17.7ms → 11.6ms; and with the stages forced on past the budget a drag frame is 2–5ms at 800 states.**

Four things it has to get right, and three of them were found by the test rather than by reasoning:

- **The dirty test is `routeCurve`'s own reach, not a guess.** It asks `nodesNearChord` for states within `r + clearance + slack` of the **chord**, `slack` at most `(curveOff + ROUTE_STEPS × (r + clearance)) / 2`. The first attempt queried a grid over the *drawn paths* at a smaller radius and missed edges two ways at once: the radius was too small, and an already-bent edge has been routed *away* from the chord the moved state is standing on. Two of 120 edges came out routed differently, which is exactly the kind of wrong that looks like nothing until someone notices an edge running through a state.
- **An edge with no blockers is only sensitive to the narrow band.** `routeCurve` returns `base` from a cheap early-out when nothing is near, so a state crossing the wide search band cannot have changed it; `geo.blocked` records which branch was taken and the scan uses `nearPad` or `routePad` accordingly. The dirty set grows with the *area* of the radius, so this is worth about 25%.
- **State positions are diffed, not asked of the drag.** `ctx.pos` is recorded by the pass itself, so every mover is caught whoever moved it — a pointer drag, an align snap, auto-pan, an undo — and no caller has to remember to declare anything. `ctx.manual` does the same for a hand-set `curve`/`loopAngle`, which changes an edge's shape with no state moving at all.
- **`since` is handed only by `updateFastDOM`.** A structural edit goes through `renderAll`, which takes a full pass, and grouping identity would refuse the reuse anyway. That is what stops the one deliberate approximation — a label that did not move is not re-examined against one that did — from accumulating past a single gesture.

[tests/incremental-layout.test.js](tests/incremental-layout.test.js) pins the invariant that makes it safe: **the routes it arrives at are the routes a full pass would have computed**, compared on the drawn `d` attributes after a drag. Also that a state dragged into the middle of a diagram bends the edges it steps into even though it is on none of them, that an edge handle is picked up with nothing having moved, and that idle frames move nothing.

**What is left is the layout pass, and it is not a reactivity problem.** After the four guards, `emit(Change.GRAPH)` on a 200-state machine is **33.8ms**, of which `renderAll` is ~20.5ms. But the per-*edit* path was never the strained one: a drag frame calls `updateFastDOM()` directly and a pan calls `applyCamera()` — **neither ever calls `emit`** — and `updateFastDOM` costs **20.7ms at 200 states and 38.2ms at 1000**, against a 16.7ms frame budget. Panning is free (0.01ms), as designed. So the hot path is already dropping frames on a machine the collision budget still considers small, and nothing in this section touches it: it is the geometry pass, and making it reactive is what the 260× measurement rules out.

**The question of whether Solid could serve the layout path is settled, and re-measured rather than assumed.** `createMutable` proxy reads benchmarked at **293×** a plain property read (the original measurement said ~260×): a layout pass reads roughly six fields per node per frame, which at 60fps is 2.5ms/sec of budget plain and **734ms/sec** proxied, before any geometry. Solid's *idea* — dependency-driven invalidation — is exactly what `relayout()` above does; Solid's *mechanism* is the one thing that cannot be afforded here, because it requires the reads to go through a proxy. Manual dirty-tracking gets the same invalidation with plain reads. Use the idea, not the library.

**Solid's memos are eager, and that is the trap in this design.** `createMemo` recomputes when a dependency is *written*, not when the value is read — so `deliver()` bumping a version signal recomputes every memo on that line, **before it has run a single subscriber**. Two things follow, and both were found by the memo being wrong rather than by reading the docs:

- **A memo must not depend on anything an earlier subscriber produces.** `updateRPanel` runs `updateRegex()` before `renderLanguagePanel()`, but the eager recompute happens before either, so a key memoising `App._regexBoxPlain` read it one edit stale — which looks exactly like an ordinary caching bug. The Language panel therefore memoises **the structure only** and reads the regex live at call time. `defLatex` has no such problem: everything it reads is set by the mutating code before `emit` was called.
- **A memo that throws would take the whole delivery with it**, canvas included, since the bump is not inside the subscriber loop's `try`. `deliver()` wraps it for the same reason it wraps subscribers: a memo that throws keeps its previous value, which is stale but survivable.

**Node resolves `solid-js` to the SSR build, where `createEffect` is `function createEffect(fn, value) {}` — an empty function.** Nothing throws; effects never run, memos are inert, and a suite would pass every reactivity test while asserting nothing. `npm test` therefore runs with `--conditions=browser --conditions=development`, and `reactive.js` probes at load and **throws** if the stub came back, so the failure is loud rather than silent. Vite picks the browser condition on its own. [tests/reactive.test.js](tests/reactive.test.js) pins the build, the coercion, the save-and-restore semantics, that an unchanged structure does not repaint, that a retargeted edge does, that a throwing memo does not abort a delivery, and that the Language panel's key carries no value an earlier subscriber had yet to write.

### Rendering

The diagram is **SVG**, built imperatively in [js/render.js](js/render.js) (`makeSVG()` + `SVG_NS`) — no virtual DOM and no framework. `renderAll()` **diffs**: it walks `App.states` and the layout pass's edge groups, reusing the node registered in `App.domCache` for each state id / `"from|to"` edge key, creating only what is new and evicting only what is gone. An idle re-render allocates nothing; a 150-state machine used to recreate 745 elements and 447 listeners on every call.

Two rules follow, and breaking either is silent:

- **Listeners must not close over per-render data.** They are attached once, at node creation, and outlive every later render. Resolve state by id and transitions by edge key at event time — `edgeGroupFor(key)` exists for that. A captured `grp` keeps pointing at transitions that have since been replaced.
- **Write classes and attributes unconditionally in the `sync*` functions.** `canvas.js` and the edge handlers toggle `sel-st`/`sel-t` on these nodes directly, so a "what did we render last time" cache drifts from the DOM and strands selection highlights. Only the label tspans are cache-keyed, because rebuilding them is the one expensive part.

Node internals are reached through `node.__parts` (`circle`, `label`, `ring`, `sub`; `pathEl`, `hitEl`, `textEl`, `handle`) rather than `querySelector`. `sub` is the second line under a state's name, shared by the Moore output and the parity priority — they never coexist. Edge labels live in `#trans-lbl-g`, not inside the edge group, so every label paints above every edge — deleting an edge has to detach both.

`updateFastDOM()` is the drag path: geometry only, every frame, sharing the layout pass and `__parts` with the renderer. It walks **`App.domCache.states`, not `App.states`** — the same list on a small machine, and on a windowed one the difference between fifty writes and a thousand map misses to find them.

### Views

`setView()` in [js/view.js](js/view.js) is the single entry point. The build view (canvas) is always mounted; `algo`, `grammar` and `reference` render as overlays on top of it, so canvas geometry stays measurable. Algorithms call `setView('build')` to reveal a result.

### Reference

The third aux view is the reference. Rendering is [js/reference.js](js/reference.js); content is data, split across two registries that share one page shape and one renderer:

- **[js/machine-guide.js](js/machine-guide.js)** — one explainer per machine, keyed by `MachineTypes` key, plus the `GuideOverview` landing page.
- **[js/concept-guide.js](js/concept-guide.js)** — the pages that are not about one machine, keyed by slug and grouped by `ConceptCategories`. Currently the Decidability section, and Language Classes — which holds the tree-adjoining page, the grammar side of the EPDA. There is deliberately no TAG editor; the page is where the class is explained.

A guide links to another page with `href="#ref-sec-<slug>"` in its prose. `reference.js` intercepts those with one delegated listener, because the browser's own handling would scroll to a hidden section and write the hash, which is where share links live. [tests/reference.test.js](tests/reference.test.js) fails on a link to a slug that does not exist.

Both import only [js/guide-blocks.js](js/guide-blocks.js), which is import-free, so both stay leaves. That module is the block vocabulary — `p`, `ul`, `math`, `mathLines`, `note`, `table`, `sec` — and **a block kind added there needs a case in `renderBlock()`**, which is the only place the two halves have to agree. `mathLines()` exists because two adjacent `math` blocks draw two boxes and read as two unrelated statements. `table()` cells are tagged `yes`/`no`/`semi`/`na` for verdict colour, and the wrapper scrolls on its own so a six-column table never widens the page.

`referencePages()` is the nav order: overview, then machines grouped exactly as `MachineCategories` groups them, then the concept categories. **A machine added to `state.js` appears automatically** — with an empty page until a guide exists for it. [tests/reference.test.js](tests/reference.test.js) fails on that gap, on a concept slug listed with no guide, on a guide in no category, on a slug colliding across the two registries (they share the `ref-sec-<slug>` id namespace), and on a table row whose width does not match its header. It also pins each machine guide's formal definition to the tuple `updateFormalDef()` prints.

Sections are typeset lazily on first view — there are several hundred display formulas across the guides, and the reader of any one page needs a handful.

The view key is `reference`; every id and class carries a `ref-` prefix (`v-reference`, `#ref-nav` for the rail, `#ref-nav-list` for the generated links, `#ref-pages` for the generated sections, `.ref-card`, `.ref-prose`). `reference.js` also owns `triggerMath()`, which `render.js` uses for the formal-definition box and which is unrelated to the view.

Nothing in the view is reached from an `on*` attribute: the nav links get their listeners at creation, which is why `reference.js` has no entry in `bridge.js`.

### The machines

**Everything a machine *is* lives under [js/machines/](js/machines/), one module per family, and every consumer asks the registry rather than the type's name.**

That is the newest structural line in the app and the reason for it is worth stating plainly. Each question about a machine — how it reads its input, what its transitions carry, how it decides a word, what its tuple is, whether a second edge on the same symbol is a branch or a mistake — used to be answered by an `if` chain over `App.machine`, in a different file per question. There were five of them — `runSim`, `computeBatchResults`, `langVerdict`, `langTupleSyms`, `langDeltaSignature` — and **each ended in a silent `else`**: `runSim`'s fell through to `simTM`, `langVerdict`'s to `'unk'`, `langTupleSyms`'s to a DFA's five-tuple. A machine added to `MachineTypes` and wired into four of the five did not fail — it ran as a Turing machine in the player, reported a DFA's tuple in the panel, and offered a queue's fields in the editor. Counting only dispatch (not codegen's per-language Moore/Mealy emitters, which are a different job), the app tested `App.machine` against a literal name 106 times; it now does so 39 times, and none of those decide how a machine runs.

```
js/machines/
  registry.js    import-free. defineMachine / defineFamily, and the lookups.
  runtime.js     DOM-free. What more than one family needs: the tokenizer,
                 the ε-closure, "which transition fires", loop tracking.
  index.js       imports the families (registration is a module-scope side
                 effect) and exposes the dispatch every consumer uses.
  finite.js      DFA, NFA, ε-NFA
  weighted.js    PFA
  omega.js       DBA, DcoBA, DPA, DWA, NBA, NcoBA, NPA, NWA
  pushdown.js    DPDA, PDA, NPDA, QA, Counter, 2PDA, PDT
  embedded.js    EPDA — a store that is a stack of stacks
  turing.js      TM, NDTM, MTM, LBA, ITM
  transducer.js  Moore, Mealy, FST
  twoway.js      2DFA, 2NFA, 2DFT
  predicates.js  import-free. The machine-shape predicates the layer reads.
  paint.js       import-free. The late-bound renderSimStep hook.
  step-log.js    import-free. What a step holds instead of a copy — the
                 non-tape half of tape-log.js.
  batch.js       the batch tester's deciding half, with no page attached.
```

**Families are drawn along shared mechanism, not along the model picker's groups.** PDT is a pushdown machine that happens to emit, so it lives with the PDAs whose configuration machinery it uses; 2DFT is a two-way head that happens to emit, so it lives with the two-way heads. Putting either with the transducers would mean copying a store or a head to keep it company.

A definition is a plain object, registered per *type* — never per family with a fallthrough — so DPDA and NPDA share an implementation by spreading one base and differ where they differ:

| field | what it answers |
| --- | --- |
| `family` | the mechanism this type shares. `isAnyTM`/`isAnyPDA` in `utils.js` read it. |
| `parseInput(raw)` | the run box's text → what `simulate`/`decide` take. `{ok, input, tokens}` or `{ok: false, error}`. Absent means a finite word. |
| `guards` | claims about the *machine* a run should not start under — a D-type whose δ branches, a weak automaton whose SCCs straddle F. `refuse` stops, `warn` prints and continues. |
| `simulate(input)` | the step-by-step run: writes `App.simSteps`, paints. |
| `decide(input, opts)` | the DOM-free verdict, `{verdict: 'acc'\|'rej'\|'unk', output}`. |
| `schema` | `transitionFields` / `stateFields` / `alphabetFields`. |
| `formal` | `tuple()`, `delta()`, plus the labels (`storeSay`, `outputSay`). |
| `determinism` | `{conflict, say}` — how this machine refuses a second edge, and what it tells the reader. Absent means a second edge is a branch. |
| flags | `deterministicDelta`, `multiTape`, `options`, `storeLabels`. |

Points worth keeping in mind:

- **`registry.js` imports nothing**, because family modules call `defineFamily` at module scope and a shared mutable container written from several modules at module scope has to sit in a leaf — the same rule as `modal-registry.js` and `export-registry.js`.
- **The machine modules are DOM-free, and now so is everything they import.** A simulator still ends with `renderSimStep()`, but it comes from [js/machines/paint.js](js/machines/paint.js) — an import-free leaf holding a hook that `simulation.js` installs at module scope — rather than from `simulation.js` itself. That distinction is the whole of what changed: the layer was always DOM-free in what it *did*, and DOM-bound in what it *imported*, which is the half a module graph cares about. `runtime.js` pulled `pickMostSpecificTransition` and `symbolsOverlap` out of `utils.js`, and `getState` out of `states-transitions.js`, so importing a simulator evaluated `canvas.js` — which resolves `#canvas-wrap` as it goes. The predicates moved to [js/machines/predicates.js](js/machines/predicates.js) (re-exported by `utils.js`, so no call site changed), `getState` moved to `state.js` (re-exported by `states-transitions.js`, likewise), and `js/machines/**` now imports nothing but leaves. **Adding a UI import anywhere under `js/machines/` silently costs the app its worker pool**, so [tests/parallel.test.js](tests/parallel.test.js) asserts the import graph directly.
- **A machine says what went wrong; the player decides what an error looks like.** `parseInput` and `guards` return sentences, and `runSim` wraps them in `t-err` / `t-warn`.
- **`decide()` ignores `App.config.transducerAccepts`.** Whether a transducer is allowed to *have* a verdict is the caller's policy — a machine that emits `011` on a word either consumed it or did not, and that does not change when a checkbox does. `computeBatchResults` is where the answer gets dropped.
- **The EPDA is a family of its own (`embedded`), not a pushdown machine with an extra field.** A PDA's store is one array and `applyPdaStoreTransition` / `pdaPeek` / `pdaStoreToString` are written against that shape; the EPDA's is a stack of stacks. So `isAnyPDA` stays exactly the machines whose store is one array, and `isEmbeddedMachine` is the EPDA. Two consequences: **a saved transition's fields are chosen by `transitionHasField`, not by the family predicates** — asked with `isAnyPDA`, the save path deleted an EPDA's `pop`/`push` on every save — and an **emptied top stack is discarded**, a convention the machine guide states rather than hides, since no move has "the top stack is empty" on its left-hand side. It answers `unk`, never `rej`, when its store budget stopped the search: it can open stacks without reading input, so its configuration space can be infinite. [tests/epda.test.js](tests/epda.test.js) checks the example word by word and round-trips `below`/`above` through the save file, StateMate and the export IR.
- **A step asks `transitionsFrom(state)`, never `App.transitions.filter`.** δ is indexed by source state in [js/machines/runtime.js](js/machines/runtime.js); a per-step scan of δ makes every machine slower in proportion to its size (see [The engine's hot paths](.claude/skills/perf/SKILL.md)). Code that rewrites a transition's `from` in place calls `invalidateTransitionIndex()`.
- **Adding a machine is two edits**: a row in `MachineTypes` ([js/state.js](js/state.js)) and a `defineMachine` call in the family module whose mechanism it shares. [tests/machines.test.js](tests/machines.test.js) walks `MachineTypes` rather than a list of its own, so the second edit is not optional: nine assertions fail until the definition exists, and more until it answers every question.

### Algorithms

[js/algorithms-fa.js](js/algorithms-fa.js) holds the textbook constructions over machines, one pair per algorithm: `algoXxx(container)` renders the interactive card, `runXxx()`/`buildXxx()` computes and returns a machine or grammar, `loadXxxResult()` puts it on the canvas. Keeping compute separate from render is what makes them testable — tests call the `build*`/`run*` half directly. The grammar constructions used to sit beside them in `algorithms-cfg.js`; they are now [the grammar workbench](js/grammar/CLAUDE.md), which takes the same split further — a tool there returns *blocks* rather than a container to render into.

### A dashed outline means "not part of the machine"

Stated once, at the top of [css/views.css](css/views.css), because it was doing five jobs and none of them legibly. A dashed border was carrying *absence* (a blank tape cell), *a draft* (an uncommitted test word), *an invitation* (add one here), *a constraint* (a locked chip) and *a decided fault* (a proven loop) — so it told the reader only that something was unusual, and which unusual had to be worked out from context every time.

    dashed   derived, drafted, absent, or offered — not (yet) part of the
             machine, and carried by no serializer
    solid    something the machine actually has

Three broke the rule and are solid now. **`.tv-cell.is-head.loop`** was the worst of them: a proven loop is a *decision* — the machine never halts, so the input is not accepted, which is strictly more than the step budget can tell you — and drawing the app's firmest verdict as an absence put it in the same visual bracket as an unwritten tape cell. It is `border-style: double` instead, which distinguishes it from an ordinary reject without borrowing the dash. **`.lang-sym.dead`** is a real fact about a real machine: uninteresting, not missing, and quiet is what colour and opacity are for. **`.wiz-chips .chip.is-locked`** is a constraint the machine has, so it takes the disabled idiom the app now owns.

Everything still dashed is genuinely one of the four: `.tv-cell.is-blank`, `.tv-cell.is-ghost`, `.example-chip.is-pending`, `.example-card-add`, `.gram-stub`, `.canvas-info-btn.is-invite`, `.wiz-example`, `.pn-body` — a port, derived from the wiring on every rebuild — and StateMate's `.draft-layer`, a machine still being written.

### Themes

Adding a theme touches two places, documented at the top of [js/themes.js](js/themes.js): a `:root[data-theme="id"]` block in `css/variables.css`, and an entry in the `Themes` registry. The entry needs an `export` palette because the SVG canvas and minimap paint from JS colour values, not CSS variables — `applyTheme()` ([js/ui.js](js/ui.js)) copies it into `App.config.export.*` and repaints.

### Electron

`window.electronAPI` (from [electron/preload.cjs](electron/preload.cjs)) exists only inside the shell; [js/electron-bridge.js](js/electron-bridge.js) sets `isElectron` and the `.is-electron` root class, and every `isElectron` branch falls through to browser behaviour on the website. The window is frameless — the page draws its own window controls. The packaged app serves `dist/` over a custom `app://` protocol rather than `loadFile()`, so `fetch`/CORS behave like http.

## Tests

`node:test` + `node:assert`, ESM. [tests/harness.js](tests/harness.js) imports the real modules — including each of the machine modules, since the machines' own functions (`simTM`, `testFST`, `decideMachine`) are reached through `context` the way every other export is; [tests/dom-stub.js](tests/dom-stub.js) installs a fake DOM, `localStorage`, `location` and friends on `globalThis` — it must be imported first, which is why it is a separate module (imports are evaluated before any module body).

`context` is a flat live view over every module export, plus browser globals proxied in both directions so tests can install fakes (`context.indexedDB = fake`, `context.matchMedia = () => …`). It uses getters rather than copying, because several exports are `let` bindings the app reassigns (`saveState`, `Workspaces`, `R`).

Modules are singletons, so **`resetApp()` between tests is what isolation means** — the old harness built a fresh vm context per call and got it free. `createHarness()` still exists and resets; it does not build anything new. If you add module-level state that survives a reset, clear it in `resetModuleState()` (which already clears the renderer's `App.domCache` node registries). Keyed caches (`_regexCache`, `_langVocab`, `_langExtCache`) are deliberately left alone: each stores its own cache key and recomputes when it changes.

[tests/dom-stub.js](tests/dom-stub.js) models enough of the DOM for the incremental renderer to be testable: `firstChild`/`nextSibling`, parent tracking, and `appendChild`/`insertBefore` detaching from the previous parent. Reordering a node is one `insertBefore`, and the tests assert that an unchanged render performs none.

`className` and `classList` there are **two views of one set**, the way a real DOM keeps them. Held apart — a plain string beside a `Set` — code that sets the class at creation and refines it with `classList.add` afterwards reads back whichever half the test happens to look at, and the two disagree with no error anywhere; the tape tracker's end caps are built exactly that way.

It also **records `document` listeners with their phase**, and `dispatchDocumentEvent(type, init)` (re-exported by the harness) delivers capture before bubble and stops on `stopPropagation`. Several features listen for the same key on `document` — `modal.js`, the canvas shortcuts, StateMate's Escape ladder — so which of them may claim a keystroke is a question about phase rather than about registration order, and a capture-phase listener that stops the event silently disables every handler below it. That is not something a per-element stub can express, and it is the failure mode worth a test.

[tests/store.test.js](tests/store.test.js) subscribes and unsubscribes its own handlers rather than resetting the registry, because its last two cases assert on the app's real wiring. [tests/render-incremental.test.js](tests/render-incremental.test.js) is about node *identity* — a renderer that drew the right picture by rebuilding everything would pass a screenshot test and fail most of that file.

[tests/large-machines.test.js](tests/large-machines.test.js) pins the thousand-state path: that the drawn window is smaller than the machine while `exportWorkspaceState()` either side of a render is identical, that the layout pass and `getContentBounds` still measure the whole diagram, that `withFullRender` hands an exporter every node and takes them back, that the grid sweep and the all-pairs loop settle a dropped state to the same place, and that a 4000-step playback is not quadratic. Several of its assertions are wall-clock — they are there to catch a reintroduced quadratic, so the budgets are loose enough not to be flaky on a slow machine.

`codegen.test.js` still uses `node:vm` — legitimately, to sandbox and execute the *generated* code and check it decides the same language as the simulator.

## Worth knowing

- `js/examples/*.json` are fetched at runtime by name, so they are copied verbatim into `dist/` by a small plugin in [vite.config.js](vite.config.js) rather than hashed as bundler assets.
- The build no longer runs `javascript-obfuscator`. It roughly doubled the bundle and cost ~26% time-to-interactive on a project whose source is public; the desktop build already skipped it. Re-add it as a Vite plugin if that trade is wanted back.
- `exportOpenSamples` in `export-ui.js` has no callers.
