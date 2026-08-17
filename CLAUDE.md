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
```

CI: `.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on push to `main`. `.github/workflows/electron-build.yml` packages win/mac/linux installers on every push and publishes a GitHub Release for `v*` tags.

The package is `"type": "module"`. The two Electron entry points are CommonJS and carry a `.cjs` extension for that reason ([electron/main.cjs](electron/main.cjs), [electron/preload.cjs](electron/preload.cjs)).

## Architecture

### Modules, and the one global seam

`js/` is ES modules with explicit imports and exports; `index.html` loads exactly one script, [js/main.js](js/main.js). There is no shared global scope and no load-order dependency — with one deliberate exception.

**[js/bridge.js](js/bridge.js)** re-exposes 217 names on `window` (216 functions plus `App`). The UI is driven by `on*="..."` attributes, which are evaluated as global-scope code and cannot see module bindings. 324 of those attributes are static in `index.html`; a further 122 are in markup the app builds at runtime (algorithm cards in `algorithms-fa.js`, the export dialogs, alphabet chips, context menus) — so grepping `index.html` alone will understate what the HTML depends on.

Practical consequences:

- **Adding a function called from an `on*` attribute means adding it to `bridge.js`.** Nothing else will fail loudly; the button just won't work.
- Everything *not* in `bridge.js` is free to rename. The build mangles top-level names, and only `bridge.js`'s object keys survive.
- `bridge.js` is the worklist for removing this seam: move a handler to a delegated `data-action` listener, delete the name, and the surface shrinks by one.

### Evaluation-order rules

ES modules make most ordering irrelevant, but three rules are load-bearing and cheap to break:

- **[js/state.js](js/state.js) imports nothing.** Several modules run top-level code against `$` and `App` — `canvas.js` resolves `#canvas-wrap`, `algorithms-cfg.js` aliases `App.grammar` — which only works because `state.js` is a leaf and therefore fully evaluated first. Don't add an import to it. The machine-shape predicates (`getMachineConfig`, `isAnyTM`, `normalizeBoundarySymbolsForMachine`, …) live there rather than in `utils.js` for exactly this reason.
- **Shared mutable containers live in leaf modules.** A hoisted function is reachable across an import cycle before its own module finishes evaluating, but the `const` it closes over is not — reading it throws *"Cannot access before initialization."* This bit `registerModal` (eight modules call it at module scope) and `ExportFormats` (written by both `export-ui.js` and `codegen.js`). Both containers now sit in import-free modules: [js/modal-registry.js](js/modal-registry.js) and [js/export-registry.js](js/export-registry.js). [js/store.js](js/store.js) is import-free for the same reason — modules `subscribe` at module scope. Follow that pattern for anything else written at module scope from more than one place.
- **`js/init.js` runs last.** It is the boot sequence, imported last by `main.js`, after `bridge.js`.

Circular imports between the UI modules (`canvas` ↔ `render` ↔ `ui` and friends) are expected and safe — every one resolves a function reference at call time.

### Cross-module writes

Imported bindings are live for reads but read-only for writes. `R`, `Workspaces` and `activeWorkspaceId` are declared in `state.js` and reassigned elsewhere, so they go through `setR`, `setWorkspaces`, `setActiveWorkspaceId`. Reads use the plain import. Assigning to an import is a build error, so this fails loudly rather than silently.

### State

`App` in [js/state.js](js/state.js) is the single mutable store: current machine, `states`/`transitions`, alphabets (as `Set`s), selection, camera, `config`, simulation cursor. `MachineTypes` there is the capability table (`hasStack`, `hasTape`, `hasEpsilon`, `isTransducer`, `hasEndMarkers`, `isWeighted`, `isOmega`) most machine-agnostic code branches on — prefer adding a capability flag over `if (App.machine === ...)` chains.

Two of those flags change what a "run" is, so they cut across more than panel visibility. `isWeighted` (PFA) makes a configuration a probability distribution over Q rather than a state or a set of them, simulated by the forward algorithm and decided against `config.pfaCutPoint`. `isOmega` (`DBA`, `NBA`) makes the input an ultimately periodic ω-word typed as `u(v)`; it bypasses the finite-word tokenizer in both `runSim` and `computeBatchResults`, and acceptance is a reachable cycle through F in the (state × position) graph, which is also where the witness lasso comes from. Anything that enumerates Σ\* — the Language panel especially — has to opt out for `isOmega` rather than report finite-word verdicts.

**The eight ω-automata are one structure over two axes**, and both are named by the type, so the label on screen is always the machine you have. The `Omega Automata` group is determinism × α: `DBA`/`DcoBA`/`DPA`/`DWA` and `NBA`/`NcoBA`/`NPA`/`NWA`. Each `MachineTypes` entry carries `omegaCondition` (`buchi`, `cobuchi`, `parity`, `weak` — catalogued in the `OmegaAcceptance` registry) and `deterministic`, read back through `omegaAcceptanceOf`, `usesParityPriorities` and `isDeterministicOmega`. **There is no config knob**; adding a ninth type means adding a row, not a setting.

Determinism is enforced three times over: `hasSingleValuedDelta`, the editor's `isDeterministicOmega` branch in `states-transitions.js`, and once more before an ω-run starts, since a loaded or imported machine never passed through the editor. That editor check tests symbol *overlap* rather than equality, because `buchiSuccessors` takes every matching edge instead of resolving to the most specific one the way the deterministic finite-word simulators do.

All four conditions judge the same object: `inf(r)`, which on an ultimately periodic word is exactly the states on the run's lasso cycle. So each is a predicate over a cycle, and `exploreOmega` serves all eight types by choosing an anchor node plus an `allow` filter in `omegaCycleCandidates` — the filter constrains the *cycle* only, since a finite stem cannot affect `inf(r)`, which is what lets co-Büchi pass through F on the way in. `parity` is the one that changes the data model: α becomes a per-state integer `s.priority`, so F, the accepting ring and the double-click toggle all go away (`acceptsAreShown`), and the number takes over the Moore output's sub-label slot. `weak` decides exactly as `buchi`; its extra content is `findWeakViolation`, a Tarjan pass over the *automaton* asserting every SCC lies wholly inside F or wholly outside it.

Between them the two axes decide expressive power, and it is not uniform: `DBA ⊊ NBA`, but `DPA = NPA` = the full ω-regular class, and `NcoBA = DcoBA ⊊ ω-regular`. Büchi is the only cell where determinism costs languages — which is why `dcoba.json` and `dpa.json` both recognize `FG b`, the language `buchi-classic.json` can only reach by guessing, and why `ncoba.json` and `nwa.json` carry a deliberately redundant branch.

Ordering trap: `isAnyPDA` includes `PDT` and `isTwoWayFA` includes `2DFT`, so a per-machine branch for either has to sit *above* the family check in `langTupleSyms`, `langDeltaSignature`, `updateFormalDef` and `updateRegex`, or the family answer wins and the output alphabet silently vanishes from the tuple. `hasSingleValuedDelta` has the same shape inverted — the `isOmega` branch answers `cfg.deterministic` rather than a blanket `false`, or the editor will let you draw an NBA and call it a DBA. `MachineCategories` drives the model picker; `PDA` is a hidden alias of `DPDA` and is deliberately absent from it.

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
- **Subscribers live beside the functions they call** (`render.js`, `alphabet.js`, `ui.js`, `history.js`), registered at module scope. `store.js` imports nothing so `subscribe` is always reachable.
- Declaration order in `Change` is delivery order.

### Rendering

The diagram is **SVG**, built imperatively in [js/render.js](js/render.js) (`makeSVG()` + `SVG_NS`) — no virtual DOM and no framework. `renderAll()` **diffs**: it walks `App.states` and the layout pass's edge groups, reusing the node registered in `App.domCache` for each state id / `"from|to"` edge key, creating only what is new and evicting only what is gone. An idle re-render allocates nothing; a 150-state machine used to recreate 745 elements and 447 listeners on every call.

Two rules follow, and breaking either is silent:

- **Listeners must not close over per-render data.** They are attached once, at node creation, and outlive every later render. Resolve state by id and transitions by edge key at event time — `edgeGroupFor(key)` exists for that. A captured `grp` keeps pointing at transitions that have since been replaced.
- **Write classes and attributes unconditionally in the `sync*` functions.** `canvas.js` and the edge handlers toggle `sel-st`/`sel-t` on these nodes directly, so a "what did we render last time" cache drifts from the DOM and strands selection highlights. Only the label tspans are cache-keyed, because rebuilding them is the one expensive part.

Node internals are reached through `node.__parts` (`circle`, `label`, `ring`, `sub`; `pathEl`, `hitEl`, `textEl`, `handle`) rather than `querySelector`. `sub` is the second line under a state's name, shared by the Moore output and the parity priority — they never coexist. Edge labels live in `#trans-lbl-g`, not inside the edge group, so every label paints above every edge — deleting an edge has to detach both.

`updateFastDOM()` is the drag path: geometry only, every frame, sharing the layout pass and `__parts` with the renderer.

### Geometry and collision avoidance

**Where things go is [js/geometry.js](js/geometry.js); what gets drawn is `render.js`.** `buildLayoutContext()` lays the whole diagram out in one pass and returns `{stateById, tsByPair, groups, geo}`, where `geo` maps each `"from|to"` key to a finished `{d, lx, ly, mx, my, crvVal, …}`. Both `renderTransitions()` and `updateFastDOM()` start from it — via `currentLayoutContext()` in `render.js`, which supplies the label-measuring callback — so routing runs live during a drag rather than snapping into place on release.

It is one pass rather than one call per edge because avoidance is global: a label can only be placed clear of the other labels once they all have positions. The four stages, each reading the last:

1. **index** — states, transitions grouped per ordered pair, and a uniform spatial grid. Every "what is near here?" query goes through the grid; without it routing is O(edges × states) and label placement O(labels²).
2. **self-loops** — twelve candidate directions scored against nearby states, the label box that would ride outside the arc, and the directions incident edges (plus the start arrow) arrive from. Up wins ties. **A loop is no longer always on top**; `t.loopAngle` is the manual override, set by dragging the grip a selected loop now shows, and cleared by "Reset Shape".
3. **routing** — an edge whose chord runs through a third state is bent around it. A quadratic's deviation is *half* its control offset, so the search steps in node-sized increments. `t.curve` (the bend handle) always wins over it, and an edge crossing more than `MAX_ROUTE_BLOCKERS` states gives up rather than swinging 300px sideways.
4. **labels** — offset off their own edge along the normal, on the outside of the bend, then moved only if that box overlaps a state, another label or a foreign edge. Candidates are ordered ideal-first, so an uncrowded diagram costs one collision test per label.

Points worth keeping in mind:

- **Label sizes are estimated, not measured.** The box has to exist before the text is in the DOM, and measuring per edge per frame would force a layout flush on every drag frame. `render.js` and `geometry.js` therefore share the pill metrics (`pillPartWidth`, `PILL_ROW_H`) — two copies of that arithmetic would place the label clear of a box that is not the one drawn.
- **Stages 2–4 are skipped past `COLLISION_BUDGET_STATES` / `COLLISION_BUDGET_TRANSITIONS`**, where a pass no longer fits a drag frame; the geometry degrades to the plain drawing rather than getting slow. The four `App.config.render` flags (`smartSelfLoops`, `autoRouteEdges`, `smartLabels`, `avoidNodeOverlap`) switch the stages off independently, and **absent means on** — an imported config predating them must not read as "all off".
- `resolveNodeOverlaps()` separates state circles, and `canvas.js` calls it on drop with `movable` set to the dragged ids so the crowd stays put. Coincident centres have no direction to divide by; it builds the unit vector directly rather than standing in an epsilon distance, which scaled the push by a thousand and fired the state off the canvas.
- `includeLayoutBounds()` feeds `getContentBounds()`, so fit-to-screen and cropped exports frame loops and pushed-out labels instead of cropping them.

[js/canvas.js](js/canvas.js) owns the camera (`App.cam` = `{x, y, z}`), pan/zoom and pointer gestures, with touch on a deliberately separate path from mouse/pen. `App.dragCurve` covers both edge gestures: bending a chord, or swinging a self-loop when `from === to`.

### Views

`setView()` in [js/view.js](js/view.js) is the single entry point. The build view (canvas) is always mounted; `algo`, `grammar` and `reference` render as overlays on top of it, so canvas geometry stays measurable. Algorithms call `setView('build')` to reveal a result.

### Reference

The third aux view is the reference. Rendering is [js/reference.js](js/reference.js); content is data, split across two registries that share one page shape and one renderer:

- **[js/machine-guide.js](js/machine-guide.js)** — one explainer per machine, keyed by `MachineTypes` key, plus the `GuideOverview` landing page.
- **[js/concept-guide.js](js/concept-guide.js)** — the pages that are not about one machine, keyed by slug and grouped by `ConceptCategories`. Currently the Decidability section.

Both import only [js/guide-blocks.js](js/guide-blocks.js), which is import-free, so both stay leaves. That module is the block vocabulary — `p`, `ul`, `math`, `mathLines`, `note`, `table`, `sec` — and **a block kind added there needs a case in `renderBlock()`**, which is the only place the two halves have to agree. `mathLines()` exists because two adjacent `math` blocks draw two boxes and read as two unrelated statements. `table()` cells are tagged `yes`/`no`/`semi`/`na` for verdict colour, and the wrapper scrolls on its own so a six-column table never widens the page.

`referencePages()` is the nav order: overview, then machines grouped exactly as `MachineCategories` groups them, then the concept categories. **A machine added to `state.js` appears automatically** — with an empty page until a guide exists for it. [tests/reference.test.js](tests/reference.test.js) fails on that gap, on a concept slug listed with no guide, on a guide in no category, on a slug colliding across the two registries (they share the `ref-sec-<slug>` id namespace), and on a table row whose width does not match its header. It also pins each machine guide's formal definition to the tuple `updateFormalDef()` prints.

Sections are typeset lazily on first view — there are several hundred display formulas across the guides, and the reader of any one page needs a handful.

The view key is `reference`; every id and class carries a `ref-` prefix (`v-reference`, `#ref-nav` for the rail, `#ref-nav-list` for the generated links, `#ref-pages` for the generated sections, `.ref-card`, `.ref-prose`). `reference.js` also owns `triggerMath()`, which `render.js` uses for the formal-definition box and which is unrelated to the view.

Nothing in the view is reached from an `on*` attribute: the nav links get their listeners at creation, which is why `reference.js` has no entry in `bridge.js`.

### Simulation

[js/simulation.js](js/simulation.js) dispatches from `runSim()` to a per-family simulator (`simDFA`, `simNFA`, `simPDA`, `simNPDA`, `simTM`, `simNDTM`, `sim2DFA`, `simMoore`, …). All produce the same artifact: a flat `App.simSteps` array the UI scrubs with `App.simIdx`. Nondeterministic machines explore first (`exploreNPDA`, `explore2NFA`) then linearize the winning path. Step budgets are in `App.config` (`maxPdaSteps`, `maxTmSteps`, `langStepBudget`).

### Algorithms

[js/algorithms-fa.js](js/algorithms-fa.js) and [js/algorithms-cfg.js](js/algorithms-cfg.js) hold the textbook constructions, one pair per algorithm: `algoXxx(container)` renders the interactive card, `runXxx()`/`buildXxx()` computes and returns a machine or grammar, `loadXxxResult()` puts it on the canvas. Keeping compute separate from render is what makes them testable — tests call the `build*`/`run*` half directly.

### Export / codegen

[js/export-core.js](js/export-core.js) normalizes `App` into a machine **IR** via `buildMachineIR()`. Everything downstream consumes only the IR: [js/export-formats.js](js/export-formats.js) (DOT, TikZ, tables, sample words) and [js/codegen.js](js/codegen.js) (JS/Python/Java in table/switch/class styles). Both register their targets into `ExportFormats` from [js/export-registry.js](js/export-registry.js); [js/export-ui.js](js/export-ui.js) owns the dialogs. Adding a target means adding a registry entry and an IR consumer, not touching `App`.

PNG export can embed the workspace JSON in the image; dropping that PNG back on the canvas restores it ([js/persistence.js](js/persistence.js) `handleFiles`). Persistence also covers IndexedDB autosave, `.json` save/load, base64url share links, and JFLAP import ([js/import-jflap.js](js/import-jflap.js)).

### StateMate

The AI assist behind the sparkle button in the header. Seven modules, split by pipeline stage so each half is testable without the one before it:

```
assemble → request → parse → compile → lint → verify → apply
              ↑        │                          │
              │        └── reply ────────────────────→ (writes nothing)
              └────────── repair, ≤2 rounds ─────┘
```

**The canvas is written exactly once, at `apply`, or not at all.** Every stage before it produces a candidate object and touches nothing else, so a failed run — a rejected key, an unparseable answer, a DFA that turned out nondeterministic — leaves the user's work exactly as it was. That property matters more than model quality, and [tests/statemate.test.js](tests/statemate.test.js) pins it by comparing `exportWorkspaceState()` either side of a failure.

**A model answer is one of two declared shapes**, and the invariant above is why the discrimination is explicit rather than inferred. `parseTurn()` reads a required `kind`: `machine` runs the pipeline, `reply` is prose that exits before `compile` and never builds a candidate at all. The asymmetry is deliberate — a missing `kind` falls through to the machine path, because that path is strictly gated by `validateSpec` and nothing can get in by omission, whereas `reply` is the branch that writes nothing and so must be spelled out. **`reply` is legal only on attempt 1**: inside the repair loop it is rejected as a schema error, or a model that cannot produce valid JSON has a legal way to stop being asked for it.

**Write authority is the one axis the model never decides.** `AUTHORITIES` in [js/statemate.js](js/statemate.js) is `ask` / `propose` / `auto`, and all three run the *identical* pipeline — they differ in a single branch at step 7, which is only possible because the canvas was already written exactly once and at the end. `ask` never writes and says so in the prompt (`buildUserMessage` adds a read-only preamble asking for a described machine rather than a returned one); `propose` — the default — builds, lints and verifies a real candidate and then stops, keeping it in `result.pending`; `auto` writes immediately. A held result carries `status: 'proposed'` plus `hold` (`ask` | `propose` | `scope`), and `applyPending()` is the only way it reaches the canvas, so `apply` stays the single place the user's work is touched.

Two guards ride along. **`scopeGuard` drops `auto` to a proposal when an *edit* removes more than half the states** — an edit that comes back as a replacement is the case `auto` cannot be trusted with, and the guard is what makes leaving it on reasonable. It deliberately ignores builds and new-tab results: "build me a DFA for X" removes every state the old machine had, and that is the request rather than an overreach. **`machineSignature()`** is stamped on a pending proposal and re-checked on accept, because the diff a reader approved was computed against a particular machine; if the canvas moved underneath, the button becomes "Apply anyway" and says why. Authority survives closing the dialog — a standing decision about how much this tool may touch your work would be worse than useless if it silently reverted to the default on every open.

**The turn's subject is inferred, and there is no switch for it.** `intent` ('build' | 'edit') reaches the model in one place — `buildUserMessage` — and it is derived from the canvas rather than toggled: a turn is about the machine on screen when there is one and it is being attached, and is a fresh build otherwise, with `/new <prompt>` overriding it for a single turn. The old `build`/`edit` status chip is gone; detaching the canvas is now the only way to say "not about this machine", so the two cannot fall out of step the way a toggle beside a checkbox could. **Authority is the one setting left.** The framing used to head the attached canvas with "modify this", which made every turn an edit: ask *why* a machine rejects a word and you got a rebuilt diagram instead of an answer, which is both the wrong reply and a destructive one. The two cases are now spelled out side by side — return the modified machine for a change, reply and change nothing for a question — and `replyBlock` names a question about the canvas as a legitimate reason to reply, with "Answering is not declining" to say so. The fence around the escape hatch stays intact: a request that is merely hard still has to be built with the gap in `caveat`, a request needing another model is still a switch, and *any* named change still outranks replying. Nothing in the pipeline changed — `parseTurn` has always allowed a reply on attempt 1 regardless of mode — so this is prompt copy plus the labels that describe it (`chat + edit` in the status bar, `editStarterPrompts` in the empty state).

**Conversation is a thread of intent, not of machines.** `getThread()` in [js/statemate.js](js/statemate.js) retains user turns verbatim and reduces an assistant's machine turn to its one-line summary; `threadMessages()` is what converts it for the provider. The canvas is the state — `compileSpec` diffs by name against whatever is live, and the current machine is attached fresh to every turn — so replaying past machines would put several candidates for "the machine" in front of the model at once. The thread is keyed on machine type plus workspace and invalidated lazily on read, since there is no `Change` for "the machine type switched". `threadDepth` governs how much is *sent* (0 is the old one-shot behaviour); the console always shows the whole retained exchange.

**Switching machine type has always worked** — `validateSpec` accepts any `MachineTypes` key, `compileSpec` starts clean on a type change, `assignCandidate` calls `applyMachineSwitch`. What was missing was telling the model, which refused buildable requests instead ("I build only DFAs"). `switchBlock` in the prompt lists every other machine with the extra transition fields it needs; only the current machine's full rules are spelled out, and the linter's repair round covers a switch that gets the shape wrong, since `lintCandidate` judges the machine the answer actually names.

- **[js/statemate-spec.js](js/statemate-spec.js)** — the dialect, plus `parseTurn` above it. Deliberately *not* the workspace save format: no ids, no coordinates, `start`/`accept` as booleans on the state. Field names differ (`on` not `symbol`, `move` not `dir`, `out` not `output`) so a model that regurgitates a save file fails loudly at the gate instead of half-working. `transitionFieldsFor`/`stateFieldsFor` derive the legal fields from `MachineTypes`, so a machine added to `state.js` is describable with no edit here. `caveat` is the model's one line about a gap between the request and the machine — capped, unsevered (severity is the app's), and dropped when it narrates the repair rather than describing the machine. Imports `state.js` only.
- **[js/statemate-compile.js](js/statemate-compile.js)** — spec → candidate, diffed against the live machine **by state name**. Survivors keep their id, their x/y, their anchored notes and their hand-tuned `curve`/`loopAngle`; only new states are placed, at the centroid of their placed neighbours plus `resolveNodeOverlaps`. This is the whole difference between an edit and a replacement — "add a trap state" must add one circle, not rearrange the diagram. A machine-type change starts clean rather than half-inheriting.
- **[js/statemate-lint.js](js/statemate-lint.js)** — the machine-shape rules a schema cannot express, pure over the candidate. Three severities: `fix` is applied locally and *reported* (a fix the user cannot see is a fix they cannot distrust), `repair` costs a model round trip, `warn` never blocks. Determinism is the rule that earns its keep.
- **`verifyCandidate`** in [js/statemate.js](js/statemate.js) — the reason to trust the output. The model must predict what its machine does on ≥3 words; those predictions are executed through `computeBatchResults()` before anything is drawn. Stash the workspace, import the candidate without emitting, decide, restore in a `finally`. `computeBatchResults` is DOM-free by construction — that split is what makes this possible.
- **[js/statemate-prompt.js](js/statemate-prompt.js)** — assembled from the app's own registries: the field list from `MachineTypes`, the notation from `App.config.sym`, the concept text from `MachineGuides`, and a worked example produced by running the bundled example file through `machineToSpec()` — so the few-shot cannot drift from the schema.
- **[js/statemate.js](js/statemate.js)** — the orchestrator, the repair loop, the thread, and the error copy. Applying goes through `commit()`, so one Ctrl+Z reverts the whole thing. `resultNotes()` lives here too rather than in the card that draws it: the card renders only the first few, so severity ordering (`fail`, `warn`, `fix`) is a correctness question and belongs somewhere testable.
- **[js/statemate-ui.js](js/statemate-ui.js)** — the console. **⏎ in the composer sends to the model, and that is the only thing it ever means.** The dialog this replaced was a command palette whose one input both searched examples and built machines, with the model as a row among the results and `⌘⏎` as the way to insist — an input with no single answer to "what does ⏎ do". Everything that is not a prompt is now a slash command, and the completion menu is the only thing that ever takes ⏎ back, only while the line starts with `/`, so the ambiguity is visible in the text you are looking at.

  **`Commands` is the registry, and adding one is an entry rather than a branch** — `{name, hint, args?, suggest?, run}`. `suggest(query)` returns `{label, hint, run}` rows and is what turns a command into two keystrokes instead of a name to remember: ⏎ on a command that has one completes to `/name` plus a space and hands the menu to its arguments, while a command without one runs on ⏎ outright. `/help` renders the list from the array, so a command documents itself. Three of them — `/examples`, `/algorithms`, `/settings` — build their completions by **reading the markup rather than a second copy of it** (`.algo-item[data-algo]`, `#settings-tabs .modal-tab[data-tab]`), so an algorithm or a settings tab added to `index.html` is completable the same day; the `data-tab` attributes exist for exactly that and an element missing one is simply not offered.

  Three consequences worth keeping straight. **The transcript is the surface** — `Session.log` holds richer entries than the thread does (the live run with its stages, errors, `/examples` output, system notes), and `syncLogWithThread()` rebuilds it from `getThread()` whenever the two disagree; it counts only entries flagged `turn`, so a failed or interrupted run leaves its error on screen instead of being erased by the next open. **The console stays open after a machine result** and is docked to the bottom with no scrim, because the diagram is drawn behind it — a dialog that hides its own result is one you have to dismiss to use; `decorateResultCard` still writes the canvas card, which outlives the console and carries the runnable test words. **An exact algorithm is a note above the composer, never a row** (`renderNudge`): `algorithms-fa.js` being correct is a reason to offer the tool, not a reason to reinterpret the sentence being typed.

  **It is a dock, not a dialog, and that is the same sentence carried through to the pointer.** Docking to the bottom with no scrim was always justified by "the diagram is drawn behind it" — but an `.overlay` takes the whole viewport and `pointer-events: all` on `.show`, so the diagram was visible and *inert*: no clicking a state, no panning, no running a word, and a click meant to select something dismissed the console instead. `registerModal` now takes **`dock: true`** ([js/modal.js](js/modal.js)), which keeps the Escape chain, the stack and the return-focus bookkeeping and gives up everything that blocks — the `body.modal-open` scroll lock, the Tab trap, the generic autofocus, and `anyModalOpen()`, which is what gates the canvas shortcuts. `anyDockOpen()` is the separate question, asked by the aux views' own Tab trap. The pointer half is CSS: the overlay drops `pointer-events` and `.sm-console` takes them back. Two things follow. `dismissOnBackdrop` is **off** — with the canvas reachable, a click on it is work. And `ui.js`'s shortcut handler bails on `e.target.closest('.sm-console')`, because a key pressed with the focus still in the panel belongs to the panel.

  **And a dock can be put away without being closed.** `setMinimized()` collapses the panel to its header strip — `is-min` on the overlay, which hides `.sm-logwrap` and `.sm-dock` and lets the console shrink-wrap so the diagram gets its bottom back. Nothing about the session lives in the DOM, so the transcript, the thread, a held proposal and a request in flight all survive it; **closing is the destructive one**, since its teardown interrupts the run. That is why the ✕ keeps its place beside the caret rather than being replaced by it, why `openStateMate()` always restores (the sparkle button, ⌘K and "ask about this selection" all land there, and a button that looks broken is worse than a panel in the way), and why ⌘K in the composer minimizes — the other half of the shortcut that opened it, answerable there only because `ui.js` ignores keys aimed at the console. **Escape minimizes rather than closes**, one rung further down the same chain that dismisses the completion menu and interrupts a run; the ladder bottoms out because a second Escape, with the strip already down, is not consumed, so it closes and a third belongs to the canvas. `*` on the canvas opens or restores — the sparkle button as a key. Two details carry the collapsed state: `#sm-live` sits outside `.sm-dock` so a run that finishes behind the strip is still announced, and the unread count is **derived** — `minSince` is where the log had got to, anchored *at* a live run rather than after it, so the entry that is replaced in place by a machine, a reply or an error is counted once, as whatever it turned out to be.

  Because the canvas moves under an open console, the console subscribes: `Change.CANVAS` re-renders the status line and the context chips, and `Change.GRAPH` also invalidates any held proposal, whose card compares `machineSignature()` at render time. That is what makes a selection made *while* the console is open reach the context basket — the status line offers it, which was impossible when reaching the canvas meant closing the dialog.

  **The transcript is diffed, not rebuilt.** `renderLog()` walks `Session.log` against `Session.nodes`, keyed by entry *object identity* the way `renderAll()` keys states by id, and reuses the node that is already on screen. Clearing and rebuilding cost more than time: it collapsed whatever `<details>` the reader had opened, destroyed a part-made text selection, re-ran KaTeX over every past reply, and — with `aria-live` on the container — re-announced the whole session, all of it several times per run, because a stage event is a render. The rules that keep it correct: a changed entry is a **new object** (`replaceEntry` builds one), the two places that mutate an entry in place call **`invalidate()`** (`acceptProposal`, and `keyEntry` when the thread hands back the turn id the branch stepper is keyed on), `rebuildFromThread()` drops the whole cache because a stepper reads `siblingsOf()` at render time, and the live run entry is the one always rebuilt. The live region moved to `#sm-live`, which carries one line per turn.

  **And it follows its tail only while the reader is at it.** `Session.pinned` is maintained by the log's own scroll listener; `scrollLogToEnd()` is a no-op when the reader has scrolled away, and `#sm-jump` offers the way back. Scrolling up to re-read a turn is a decision, and a streaming reply used to undo it several times a second.

  Escape has three jobs — dismiss the completion menu, interrupt a run, close the dialog — and the modal core owns the last one. `registerModal` takes an `onEscape` returning true when it consumed the key, which is how the first two get first refusal without `modal.js` importing the module it serves. Dismissing the menu leaves the line alone (`Session.menuHidden`, cleared by the next keystroke); it used to clear the composer, so escaping a completion list deleted the command being written. Listeners are attached at creation the way `reference.js` does, so the whole feature still adds exactly one name to `bridge.js`.

  **The composer has one submit path and one send button.** `submitComposer()` serves ⏎ and the click both, because they were two functions and the button's copy dropped the `branch` — so "Rewriting a turn: ⏎ replaces it" was true of the keystroke and false of the button beside it. That state is now a bar above the composer with a way out (`renderEditing`) plus a mark on the turn itself, written straight to the cached node the way `canvas.js` writes selection. While a request is in flight the send button **becomes the stop button** rather than going grey — Escape has always interrupted, but a keystroke named in a placeholder is not a control. And ↑/↓ walk the whole prompt history: the old gate was "the line is empty", which the first recall broke, leaving a history exactly one deep with no way forward.

  **The result card leads with the machine's name.** `decorateResultCard` inserts its strip *after* the title row and appends the actions as a footer; prepending both put a row of diff chips and three buttons above the name, which read as the card's heading and buried the title mid-card. `summarizeDiff` pairs the signs into one chip per dimension (`+4 −7 states`) — as four chips it was the same two facts said twice, wrapping onto a second row to do it. The empty word renders as `ε` rather than as a blank pill.

  **A reply is rendered as markdown** — it is the one surface where the model writes prose for a person, so it is the one that gets [js/markdown.js](js/markdown.js), then `triggerMath()` for whatever `$…$` came through. That module is a leaf and its security design is a property of its *shape*, not of a filter: **it builds DOM nodes and never assigns `innerHTML`**, so there is no HTML parser for a `<script>` in a reply to get past and nothing to sanitise. Two consequences follow from the same stance — a link is scheme-checked (`http`, `https`, `mailto` only; anything else renders as its own text, so an anchor that exists is safe to click), and an image renders as a *link*, because an `<img>` is a request to a third party the moment it is drawn and a model should not be able to plant a tracking pixel by answering. Math is extracted before emphasis, or `$a_1 * b_2$` loses its asterisk to an emphasis run before KaTeX sees it; `_` is inert inside a word, because `q_0` and `snake_case` are ordinary text here. [tests/markdown.test.js](tests/markdown.test.js) pins the node shapes, the scheme allow-list, and that the module contains exactly one `innerHTML` — the clear on entry.

  **The console's type is two voices and four sizes**, declared as `--sm-prose` / `--sm-ui` / `--sm-mono` / `--sm-micro` on `.sm-console` in [css/modals.css](css/modals.css) — tune the scale there, not in thirty rules. The rule for which voice: **`--sans` is language** (prompts, replies, titles, blurbs, button labels) and **`--mono` is identifiers and instrumentation** (`/command` names, gutter marks, chips, counts, model names, keycaps). Two things are easy to get wrong. The composer and a sent user turn must stay identical — same family, size and line-height — because they are the same text before and after ⏎. And **JetBrains Mono is loaded at 300/400/500 only** ([index.html](index.html) font link), so `font-weight: 600` on a mono run is a synthetic bold; 500 is the heaviest real weight it has. DM Sans does load 600.

**Settings must never go in `App.config`.** `exportWorkspaceState()` deep-copies the whole config into every workspace tab and `getBackupPayload()` writes it to IndexedDB, so an API key there would be a key on disk. StateMate keeps its own store under the `automata-statemate` localStorage key ([js/statemate-provider.js](js/statemate-provider.js)), and a test asserts the key reaches none of the four serializers. The conversation thread is module state for the same reason, with its own test. `getWorkspaceData()` and `getEditorSettingsData()` happen to be allow-lists today; that is one edit away from not being true.

In Electron the request goes through `statemate:request` in the main process, which sidesteps every provider's CORS policy. The browser path falls back to a direct `fetch` with the per-provider caveat surfaced in the settings tab.

### Themes

Adding a theme touches two places, documented at the top of [js/themes.js](js/themes.js): a `:root[data-theme="id"]` block in `css/variables.css`, and an entry in the `Themes` registry. The entry needs an `export` palette because the SVG canvas and minimap paint from JS colour values, not CSS variables — `applyTheme()` ([js/ui.js](js/ui.js)) copies it into `App.config.export.*` and repaints.

### Electron

`window.electronAPI` (from [electron/preload.cjs](electron/preload.cjs)) exists only inside the shell; [js/electron-bridge.js](js/electron-bridge.js) sets `isElectron` and the `.is-electron` root class, and every `isElectron` branch falls through to browser behaviour on the website. The window is frameless — the page draws its own window controls. The packaged app serves `dist/` over a custom `app://` protocol rather than `loadFile()`, so `fetch`/CORS behave like http.

## Tests

`node:test` + `node:assert`, ESM. [tests/harness.js](tests/harness.js) imports the real modules; [tests/dom-stub.js](tests/dom-stub.js) installs a fake DOM, `localStorage`, `location` and friends on `globalThis` — it must be imported first, which is why it is a separate module (imports are evaluated before any module body).

`context` is a flat live view over every module export, plus browser globals proxied in both directions so tests can install fakes (`context.indexedDB = fake`, `context.matchMedia = () => …`). It uses getters rather than copying, because several exports are `let` bindings the app reassigns (`saveState`, `Workspaces`, `R`).

Modules are singletons, so **`resetApp()` between tests is what isolation means** — the old harness built a fresh vm context per call and got it free. `createHarness()` still exists and resets; it does not build anything new. If you add module-level state that survives a reset, clear it in `resetModuleState()` (which already clears the renderer's `App.domCache` node registries). Keyed caches (`_regexCache`, `_langVocab`, `_langExtCache`) are deliberately left alone: each stores its own cache key and recomputes when it changes.

[tests/dom-stub.js](tests/dom-stub.js) models enough of the DOM for the incremental renderer to be testable: `firstChild`/`nextSibling`, parent tracking, and `appendChild`/`insertBefore` detaching from the previous parent. Reordering a node is one `insertBefore`, and the tests assert that an unchanged render performs none.

[tests/store.test.js](tests/store.test.js) subscribes and unsubscribes its own handlers rather than resetting the registry, because its last two cases assert on the app's real wiring. [tests/render-incremental.test.js](tests/render-incremental.test.js) is about node *identity* — a renderer that drew the right picture by rebuilding everything would pass a screenshot test and fail most of that file.

`codegen.test.js` still uses `node:vm` — legitimately, to sandbox and execute the *generated* code and check it decides the same language as the simulator.

## Worth knowing

- `js/examples/*.json` are fetched at runtime by name, so they are copied verbatim into `dist/` by a small plugin in [vite.config.js](vite.config.js) rather than hashed as bundler assets.
- The build no longer runs `javascript-obfuscator`. It roughly doubled the bundle and cost ~26% time-to-interactive on a project whose source is public; the desktop build already skipped it. Re-add it as a Vite plugin if that trade is wanted back.
- `exportOpenSamples` in `export-ui.js` has no callers.
