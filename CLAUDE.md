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

**[js/bridge.js](js/bridge.js)** re-exposes 214 functions on `window`. The UI is driven by `on*="..."` attributes, which are evaluated as global-scope code and cannot see module bindings. 357 of those attributes are static in `index.html`; a further 125 are in markup the app builds at runtime (algorithm cards in `algorithms-fa.js`, the export dialogs, alphabet chips, context menus) — so grepping `index.html` alone will understate what the HTML depends on.

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

`App` in [js/state.js](js/state.js) is the single mutable store: current machine, `states`/`transitions`, alphabets (as `Set`s), selection, camera, `config`, simulation cursor. `MachineTypes` there is the capability table (`hasStack`, `hasTape`, `hasEpsilon`, `isTransducer`, `hasEndMarkers`) most machine-agnostic code branches on — prefer adding a capability flag over `if (App.machine === ...)` chains. `MachineCategories` drives the model picker; `PDA` is a hidden alias of `DPDA` and is deliberately absent from it.

Multi-tab editing lives in `Workspaces` / `activeWorkspaceId`: each tab is a serialized `exportWorkspaceState()` blob, and switching saves the live `App` into the outgoing tab and rehydrates the incoming one.

### Announcing changes

**After mutating `App`, say what changed — do not call renderers directly.** [js/store.js](js/store.js) is a small publish/subscribe layer:

```js
commit();                              // edit + undo point (the common case)
commit(Change.ALPHABET, Change.GRAPH); // ... that also touched Σ/Γ
emit(Change.GRAPH);                    // edit with no undo point
emit(Change.CANVAS);                   // repaint only
batch(() => { /* many edits */ });      // deliver once at the end
```

`commit()` lives in [js/history.js](js/history.js) and is `snapshot()` + `emit()`. It replaced a `snapshot(); renderAll(); updateLPanel(); updateRPanel();` sequence that was copied to ~24 sites and regularly went wrong by a call.

Points worth keeping in mind:

- **Delivery is synchronous.** `fitToScreen` and `autoFitLoadedMachine` measure the DOM on the line after an edit; deferring would hand them stale geometry. `batch()` is the opt-in for coalescing.
- **`Change.CANVAS` does not dirty the tab.** It means selection/highlight repaints, which `exportWorkspaceState` does not persist — dirtying there would raise the unsaved-changes prompt for clicking a state. The camera is the exception that *is* persisted, and `canvas.js` calls `markDirty()` for it explicitly.
- **Subscribers live beside the functions they call** (`render.js`, `alphabet.js`, `ui.js`, `history.js`), registered at module scope. `store.js` imports nothing so `subscribe` is always reachable.
- Declaration order in `Change` is delivery order.

### Hierarchical machines (HSM / RSM)

Two families, and the difference between them is one bit that lands exactly on the REG/CFL boundary:

| | data | shape | capability flag | class |
|---|---|---|---|---|
| **Containment** — a state *contains* states | `parent` on the child, `super: true` on the container | a **tree**, cannot cycle | `hasSuperstates` | regular |
| **Reference** — a state *names* a component | `callee` on the state | a **graph**, can cycle | `hasCallStack` | context-free |

`HSM` has the first, `RSM` has both. [js/superstates.js](js/superstates.js) owns containment; [js/hierarchy.js](js/hierarchy.js) owns components, navigation, the simulator and the RSM→PDA compiler, plus the pair of conversions between the two families.

**`machineTree()` flattens containment away.** Every consumer downstream — validator, simulator, compiler, every export target — sees components whose states are a flat set. Regions are the family that adds nothing, `flattenComponent()` is the constructive proof, and doing it at the tree's entry point is what stops the reference family from ever having to know regions exist.

Flattening semantics, and each one is a test:

- an arrow **out of** a region applies from every leaf inside it (1 arrow → N arrows: the succinctness)
- an arrow **into** a region lands on its default entry (`initial`, else first child)
- a leaf accepts if it, or any region containing it, is marked accepting
- no transition priority — inner and outer both fire. UML gives the inner one precedence; the union is what makes "a statechart is an NFA" literally true, so it is what's implemented.

Points that bite:

- **`origin` on a flattened transition is the arrow the user drew.** Flattening renumbers every transition, so the simulator highlights by `via.origin || via.id`. Without it a run with regions lights up nothing.
- **A region's rectangle is derived, never stored** (`superstateRects` → `App.superRects`, refreshed once per render pass *before* the arrow maths). It therefore can never clip a child and needs no resize handles. `syncSuperstateCentres` writes the rect centre back to `s.x`/`s.y`, which is what keeps the marquee, minimap, autolayout and `getContentBounds` working without any of them learning what a region is.
- **Only the title band takes pointer events.** The body is `pointer-events: none`, which is what makes containment hit-testing a non-problem: a container swallowing clicks over its whole area would make every state inside it unreachable and eat the empty-canvas gestures landing in the gaps.
- **Drag measurement excludes the top of the drag set** (`dragMeasureExclusion`). A state defining its container's boundary could otherwise never leave it — the container would grow to follow it forever. Excluding only the *top* is what still lets a region dragged with its contents keep its size.
- **Deleting a region deletes its contents** (`subtreeIds`); **Ungroup** is the non-destructive door and writes out the arrows the region stood for.

**A region IS its contents, for every whole-node operation.** `selectionSubtree()` in `canvas.js` is that rule, and the operations that predate regions all go through it: `deleteSelection` (ui.js), `nudgeSelected`, `copySelection`. Two traps behind it:

- **A region's `x`/`y` is derived, so writing to it does nothing.** `syncSuperstateCentres` recomputes it from the children on the next pass. Moving a region means moving its children — which is why `nudgeSelected` expands to the subtree and why `layoutLevel` reads the layout's assignment as a *displacement* and applies it to the subtree.
- **`parent` and `initial` travel by id, so they need remapping like `from`/`to`.** `pasteClipboard` remaps both, and drops a `parent` whose container was not part of the copy. Left alone, pasted children are adopted by the *original* region and the copy is an empty placeholder.

**`dragOffsets` is armed on pointer-DOWN, so it is set for a click that never moves.** `App.dragPendingSnapshot` is the "hasn't moved yet" flag, and `commitDropTarget` returns early on it — without that, every plain click on a state inside a region committed a drop onto `null` and evicted it, with no undo point because the drag's snapshot is only taken on first movement. All three gesture fields (`dragOffsets`, `dragCurve`, `dragPendingSnapshot`) are declared in `state.js` so a reset can clear them.

**Collapse is a view state and only a view state.** `collapsed` on a region is never read by `flattenComponent`, `machineTree`, the simulator or any export — [tests/collapse.test.js](tests/collapse.test.js) asserts the flattened machine is identical either way, and that is the whole design constraint. It exists because *how much do you want to see* and *which class are you in* were the same lever: the only way to stop looking at a region's interior was `extractRegionToSubmachine`, which also crosses REG/CFL, refuses on recursion and renumbers ids. Now collapse/expand is free in both directions and extract/inline is only for the deliberate crossing.

Three things follow:

- **A collapsed region's `x`/`y` is the one region position the user owns.** With no children on screen there is nothing to derive it from, so `superstateRects` builds the rect *from* the centre and `syncSuperstateCentres` skips it.
- **`App.hiddenStates` is computed beside the rects** and is what stops everything that measures geometry from framing what isn't drawn — a hidden state keeps its absolute position. `refreshSuperRects` also deletes the rects of regions inside a collapsed one, so a nested region cannot be hit-tested while off screen.
- **`edgeProjection()` is why collapse works at all.** An arrow into a hidden state has to land on the region that replaced it, so `groupTrans` (what to draw), `edgeGroupFor` (what a click means) and `buildEdgeIndex` (per-frame geometry) all go through it. Arrows with both ends inside one collapsed region are dropped — a self-loop on the box would claim something about the container that is really about a state it isn't showing. It returns `null` when nothing is collapsed, so the common case pays nothing.

**`autoLayout` is containment-aware and recursive.** Deepest region first, because a region's size is derived from its contents and the level above cannot space it until the level below is settled; `refreshSuperRects` publishes that size between levels. `levelTransitions` lifts both endpoints of every arrow to the node at the current level, so an arrow between two regions' interiors is what puts those regions next to each other. `sugiyamaLayout` and `circularLayout` space by per-node extents (`nodeHalf`) rather than the configured radius — with every node a circle that reduces exactly to the old uniform pitch, which is what keeps the existing layout tests meaningful.

**The toggle** is `extractRegionToSubmachine` / `inlineSubmachineAsRegion`. Both preserve the language. Inlining **refuses on a recursive component**, and that refusal is the point rather than a limitation: a component you cannot inline is one no finite picture can express. Extraction refuses when an arrow aims past the region's default entry, because a component has exactly one way in and silently changing the language would be worse.

A state carrying `callee` is a **box**: it invokes another component and comes back.

**`App.states` is the live working copy of whichever component is on canvas.** `App.components[active]` is a cache valid only after `flushActiveComponent()`. **Readers flush, writers don't** — the readers are `snapshot()`, `exportWorkspaceState()`, `machineTree()` and descend/ascend. This is why 26 wholesale `App.states = ...` sites across the codebase needed no changes.

Consequences worth knowing:

- **Use `componentView(id)` to touch a component you didn't navigate to.** Pushing onto `getComponent(id).states` for the *active* component appears to work and is silently undone by the next flush. `componentView` resolves to `App.states` when the component is live and to the record otherwise.
- **State/transition id counters are global across the tree**, not per component — two components numbering their own `q0` would collide in `App.domCache` and every `[data-id]` lookup. `resetIds()` walks every component.
- **A component is a document, not an instance.** `enterComponent` navigates to a component already on the breadcrumb rather than nesting a copy, which is what makes a recursive machine editable. The simulator's `followSimFrames` deliberately does *not* dedupe, because during a run the repetition is the call depth.
- **Node kind is part of node identity.** Promoting a state keeps its id, so `renderStates` evicts and rebuilds when `__kind` changes — a `<circle>` ignores `x`/`width` in silence. Grouping a state into a region is the same eviction: it leaves `#states-g` for `#supers-g`. `nodeHalf()` in `superstates.js` is the single rule for how big a node is, across all three shapes; `boundaryOffset()` in `render.js` is the single place that knew "every node is a circle of radius R".
- **`buildMachineIR()` compiles first.** Neither model has a flat state set of its own, so the IR is what the picture *denotes*: the PDA for an RSM with boxes, the flattened NFA/ε-NFA for regions alone. Adding a format still means one IR consumer.

Acceptance is the three-clause one: input consumed, **call stack empty**, and an accepting node of the *root*. The empty-stack clause is the whole difference from a finite automaton.

**The two families are duals, and each borrowed what the other had.** RSM is *navigational* — one component on screen, the path in a breadcrumb, the rest in your head. HSM is *spatial* — all structure on screen, nothing in a widget, no way to focus. Each is unusable at the scale where the other is comfortable, so:

- HSM took the box's **collapsed form** (above) and the **Nest row**, which mirrors the Call row: `buildRsmSteps` walks the containment chain of the active leaf against `component.raw` and the simulator draws it with the same widget as the stack.
- RSM took the region's **visible structure**. A box now shows where a call lands (`Callee → entryState`, the box's version of the region's default-entry marker), and `#components-sec` lists the component tree as objects you can point at — which is where `renameComponent` and `deleteComponent` finally got a caller, having been written, exported and reachable from nowhere.
- A box whose component reaches itself is drawn **marked**, the same move orthogonality makes: single out the thing that changes the language class. The renderer asks `recursiveComponentIds()` — a call graph read straight off the component records — because `recursiveComponents(machineTree())` flattens every component and this runs once per pass. `rsm-borrows.test.js` asserts the cheap read agrees with the flattening one.
- **An accept ring means two different things depending on where you stand**: accept in the root, "return to my caller" in a sub-machine. They were drawn identically; `exit-st` now distinguishes them, because "exits(c) are c.accepts" is the load-bearing half of the call semantics.

### Statechart augmentations

Four features on top of containment. Every one of them **stays regular**, and each is a different constructive proof that succinctness ≠ power:

| | data | what flattening does | cost |
|---|---|---|---|
| **Actions** | `entry`/`exit` on a state, `action` on a transition | composes them along the LCA path | none — a relabelling |
| **History** | `entryMode: 'history' \| 'deep'` on the arrow *into* a region | product with "which child was I in" | ×k per history region |
| **Guards** | `guard`/`assign` on a transition, over `App.flags` | product with the flag valuation | ×2ⁿ |
| **AND-regions** | `parallel: true` on a region | synchronous product of its regions | **kⁿ** |

**They share one engine.** `productFlatten()` in `superstates.js` is entered when *any* of history/guards/orthogonality is present, and its configuration is `{A: active leaves, m: memory, v: valuation}` keyed as `${actKey(A)}@${memKey(m)}#${valsKey(v)}`. A machine using two of them is their **joint** product, not two passes each pretending the other isn't there. It is reachability-driven for the same reason subset construction is, and bounded by `App.config.maxFlatStates` — returning `truncated: true` rather than a quietly wrong machine.

Points that bite:

- **Actions are `hasActions`, deliberately not `isTransducer`.** Σ is still the only thing read, and the accepted language is identical with every action stripped. There is a test asserting exactly that.
- **`composeActions` is bounded by the LCA.** Exits innermost-first up to it, the arrow's own `action`, then entries outermost-first down. An arrow *inside* a region runs none of that region's actions, because it never left it. `entryActionsFor` handles step 0, which has no transition to hang entries on.
- **`App.flags` is an ARRAY, not a Set.** Declaration order is the bit order of the valuation key; re-sorting it silently renumbers every flat state. `addFlag` appends.
- **An undeclared flag reads false** rather than throwing — a guard naming a flag that was just deleted disables its arrow instead of breaking the run. `delFlag` therefore does *not* rewrite the arrows naming it, and the panel offers the chip back.
- **Guards are boolean and only boolean.** [js/guards.js](js/guards.js) is a leaf module (imports nothing) with a recursive-descent parser and **no `eval`**. An integer guard would be an infinite state space, and two would be a two-counter machine — Turing-complete, i.e. a different model wearing the same picture. Counter and NPDA are the honest answer there.
- **AND-regions fire synchronously**: on a symbol every orthogonal region takes a transition, or none does. That is what makes `L(AND-region)` the **intersection** of its regions' languages — literally the product construction for closure under intersection. The interleaved reading would give the shuffle. Same kind of deliberate call as "no transition priority".
- **"Ignore this event" is a self-loop on each LEAF.** A self-loop drawn on the *region* exits and re-enters it, snapping that region to its default entry. Correct statechart semantics and the single most likely thing to get wrong when writing an AND example.
- **An arrow drawn on the AND-region itself is global** — `killedRegion` tears every slice down at once, so there is one `dead` configuration rather than one per surviving pair.
- **Flat nodes carry `origin`/`origins` back to the drawn nodes.** A product configuration is several leaves at once, so `origins` is a list and `simulation.js` highlights `step.states` when it is non-empty.
- **They also carry `mem`/`vals` — the half of the configuration the picture cannot show.** Both are recorded for *every* history region and *every* declared flag, not just the ones the run has touched, so the simulator's Flags and Mem rows keep a stable shape instead of growing a column mid-run. `buildRsmSteps` resolves the region and child names against `component.raw.states` — the component **as drawn** — because `stateById` is keyed by synthesised flat ids and a lookup there silently falls through to showing raw ids.

Rendering an orthogonal region: `laneDividers()` derives the dashed separators from the child rects on every pass and every drag frame, inferring the axis from how the child centres are spread — so dragging one region past another re-flows them. The outer border goes **solid** because an ordinary region is already dashed. A parallel region draws **no default-entry arrow**: every child is entered, so pointing at one would be a claim the simulator doesn't make.

Flags are declared in the left panel (`flags-sec`, shown wherever `hasActions` is), which also reconciles declared against used: a flag an arrow names but nobody declared renders as a click-to-declare chip, and a declared flag nobody uses is marked as doubling the flattening for nothing. The cost line under it reports the **real** flattened size (`drawn → flat`) rather than the ×2ⁿ bound: the product is reachability-driven, so the bound is almost never what you get, and quoting a figure that never moves teaches the reader to ignore it.

Guards are typed in `#m-guard`/`#m-assign`, which go through the same `suggest.js` popover as every other symbol field (`getFlagSuggestState` — the unit completed is the identifier under the caret, since a guard is an expression rather than a symbol). `syncGuardValidity` reports a parse error inline; without it a typo compiles to the constant `false` at flattening time and the arrow silently stops firing, because `productFlatten` swallows the parse error on purpose so one bad arrow cannot break a whole run.

**Naming:** a *region* is a superstate — a container a state is genuinely inside, that flattening reasons about. A *frame* is the decorative rectangle from the `R` shape tool ([js/dividers.js](js/dividers.js)), which changes nothing. They were both called "Region" until the export dialog's "Dividers & regions" checkbox turned out not to cover superstates at all.

### Rendering

The diagram is **SVG**, built imperatively in [js/render.js](js/render.js) (`makeSVG()` + `SVG_NS`) — no virtual DOM and no framework. `renderAll()` **diffs**: it walks `App.states` and `groupTrans()`, reusing the node registered in `App.domCache` for each state id / `"from|to"` edge key, creating only what is new and evicting only what is gone. An idle re-render allocates nothing; a 150-state machine used to recreate 745 elements and 447 listeners on every call.

Two rules follow, and breaking either is silent:

- **Listeners must not close over per-render data.** They are attached once, at node creation, and outlive every later render. Resolve state by id and transitions by edge key at event time — `edgeGroupFor(key)` exists for that. A captured `grp` keeps pointing at transitions that have since been replaced.
- **Write classes and attributes unconditionally in the `sync*` functions.** `canvas.js` and the edge handlers toggle `sel-st`/`sel-t` on these nodes directly, so a "what did we render last time" cache drifts from the DOM and strands selection highlights. Only the label tspans are cache-keyed, because rebuilding them is the one expensive part.

Node internals are reached through `node.__parts` (`shape`, `label`, `ring`, `moore`, `callee`; `pathEl`, `hitEl`, `textEl`, `handle`; `body`, `head`, `label`, `initDot`, `initArm` for a region) rather than `querySelector`. Edge labels live in `#trans-lbl-g`, not inside the edge group, so every label paints above every edge — deleting an edge has to detach both.

Layer order in `#cam-g` is load-bearing: `dividers-g`, `supers-g`, `trans-g`, `trans-lbl-g`, `states-g`. Regions sit under the edges so an arrow crossing a border stays visible, and they are painted outermost-first so a nested region lands on top of the one containing it — which is why `onStateDown` does *not* raise a region to the front the way it raises a state.

`updateFastDOM()` is the drag path: geometry only, every frame, sharing `edgeGeometry()` and `__parts` with the renderer. `buildEdgeIndex()` keeps the "is there an edge the other way?" lookup O(1); without it a pass is O(edges × transitions).

[js/canvas.js](js/canvas.js) owns the camera (`App.cam` = `{x, y, z}`), pan/zoom and pointer gestures, with touch on a deliberately separate path from mouse/pen.

### Views

`setView()` in [js/view.js](js/view.js) is the single entry point. The build view (canvas) is always mounted; `algo`, `grammar` and `theory` render as overlays on top of it, so canvas geometry stays measurable. Algorithms call `setView('build')` to reveal a result.

**`setMachine` discards only what the target cannot express.** `machineSwitchLosses(from, to)` asks what the machine *on the canvas* uses that the target has no way to carry — not what capabilities differ — so a switch with an empty list happens silently and keeps every state and arrow. That matters because DFA and NFA have identical capability flags and HSM's are a strict subset of RSM's: under the old "any states at all, so warn and delete" rule, promoting a DFA to an NFA destroyed the user's work, and the `hsm.json` instruction to switch to RSM and extract a region was impossible to follow. When there *is* a loss, `stripForMachine` keeps the graph and removes just the annotation — and leaving a hierarchical model **flattens** rather than deletes, because regions and guards are arrows and states in disguise and writing them out preserves the language.

### Simulation

[js/simulation.js](js/simulation.js) dispatches from `runSim()` to a per-family simulator (`simDFA`, `simNFA`, `simPDA`, `simNPDA`, `simTM`, `simNDTM`, `sim2DFA`, `simMoore`, …). All produce the same artifact: a flat `App.simSteps` array the UI scrubs with `App.simIdx`. Nondeterministic machines explore first (`exploreNPDA`, `explore2NFA`) then linearize the winning path. Step budgets are in `App.config` (`maxPdaSteps`, `maxTmSteps`, `langStepBudget`).

### Algorithms

[js/algorithms-fa.js](js/algorithms-fa.js) and [js/algorithms-cfg.js](js/algorithms-cfg.js) hold the textbook constructions, one pair per algorithm: `algoXxx(container)` renders the interactive card, `runXxx()`/`buildXxx()` computes and returns a machine or grammar, `loadXxxResult()` puts it on the canvas. Keeping compute separate from render is what makes them testable — tests call the `build*`/`run*` half directly.

The **Hierarchical** group is `algoFlatten` (HSM → NFA) and `algoCompilePDA` (RSM → PDA). Both wrap constructions that already existed for other reasons — `flattenComponent` feeds `machineTree()`, `compileToPDA` feeds the export IR — so the cards are consumers, not new maths. They exist because a model whose whole claim is "this denotes something else" has to be able to show the something else: two shipped examples told the reader to open a flattened view that did not exist, and `flat.expanded` (the number of arrows flattening had to write out, i.e. the succinctness) was computed and discarded. Both cards report drawn-vs-built counts, and `algoFlatten` reports truncation in red — a truncated flattening answers for a different machine.

### Export / codegen

[js/export-core.js](js/export-core.js) normalizes `App` into a machine **IR** via `buildMachineIR()`. Everything downstream consumes only the IR: [js/export-formats.js](js/export-formats.js) (DOT, TikZ, tables, sample words) and [js/codegen.js](js/codegen.js) (JS/Python/Java in table/switch/class styles). Both register their targets into `ExportFormats` from [js/export-registry.js](js/export-registry.js); [js/export-ui.js](js/export-ui.js) owns the dialogs. Adding a target means adding a registry entry and an IR consumer, not touching `App`.

PNG export can embed the workspace JSON in the image; dropping that PNG back on the canvas restores it ([js/persistence.js](js/persistence.js) `handleFiles`). Persistence also covers IndexedDB autosave, `.json` save/load, base64url share links, and JFLAP import ([js/import-jflap.js](js/import-jflap.js)).

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

[tests/examples.test.js](tests/examples.test.js) replays **every example that declares `meta.inputs`** through the real simulator, so shipping a broken example means a red test rather than a silent bug. Adding the input list is the whole opt-in; nothing else needs registering. `out` and `tape` on a sample are checked too, which is what pins the action-composition order down in [js/examples/hsm-actions.json](js/examples/hsm-actions.json).

## Worth knowing

- `js/examples/*.json` are fetched at runtime by name, so they are copied verbatim into `dist/` by a small plugin in [vite.config.js](vite.config.js) rather than hashed as bundler assets.
- The build no longer runs `javascript-obfuscator`. It roughly doubled the bundle and cost ~26% time-to-interactive on a project whose source is public; the desktop build already skipped it. Re-add it as a Vite plugin if that trade is wanted back.
- `exportOpenSamples` in `export-ui.js` has no callers.
