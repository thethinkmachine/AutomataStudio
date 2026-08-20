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
- **`Change.META` is the info card's text, and it is its own kind for two reasons.** It *is* persisted, so unlike `CANVAS` it dirties the tab; it is not the machine, so unlike `GRAPH` it must not drag the panels and the whole diagram through a re-render because a blurb was reworded. `persistence.js` subscribes the card renderer to `META` and only the button's visibility to `GRAPH` — a full redraw on `GRAPH` would wipe StateMate's result strip off the card between the run and the reading of it.
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

**Everything on the canvas is selected the same way.** Four id sets on `App` — `selectedStates`, `selectedTransitions`, `selectedNotes`, `selectedDividers` — and one `clearSelection()` that empties all four, because a kind that clears separately is a kind that survives an Escape and is then deleted by the next Delete. That is what notes and dividers used to be: notes had no selection at all, and a divider had a single `App.selectedDividerId` that no marquee, select-all or Delete-with-a-state-selected knew about. `pickObject(set, id, multi)` is the shared click rule (shift/ctrl toggles; a plain click on something unselected replaces the selection; a plain click on something already selected keeps it, so a drag can start from any member), and `beginSelectionDrag(pt)` captures offsets for all three movable kinds at once so one gesture moves the whole selection whichever member it started on. Adding a selectable kind means a set, a `sync*SelectionClasses()` that repaints its class from that set, and entries in `clearSelection` / `selectAllStates` / the Delete branch — not a second selection model.

Dividers and notes take their undo point on the first *movement* (`App.dragPendingSnapshot`), the way states always did; pressing one is a selection, not an edit. `removeNotes`/`removeDividers` delete without snapshotting so that Delete over a mixed selection costs exactly one history step.

### The sidebars

**The two panels are one component twice**, and everything that says so is in one place each. [js/panel-state.js](js/panel-state.js) is the import-free registry of tabs, sides and selection; `syncPanelTabs` / `activatePanelTab` / `showPanelTab` / `revealPanel` / `togglePanelPin` in [js/ui.js](js/ui.js) each take a side or read one, rather than existing twice; and [css/panels.css](css/panels.css) holds both panels plus the chrome they share (`.panel-header`, `.panel-tabs`, `.panel-tab`, `.pin-btn`, `.panel-resizer`, `.mobile-panel-close`).

That file is the point. The left panel's rules lived in `css/lpanel.css`, the right panel's in `views.css` and its tab strip in `modals.css`, which is how the two drifted: different header padding, a title where the other had tabs, and — the one that mattered — `.lpanel.unpinned` hiding a *hand-picked list* of its children while `.rpanel.unpinned` hid all of them, so a third tabpanel hosted on the left would have stayed painted over the canvas with the panel collapsed to its hover rail. Both now hide `> :not(style)`.

`togglePanelPin(side)` is the same shape of fix: it was two copies differing in three string literals. `toggleLPanelPin`/`toggleRPanelPin` survive as one-line wrappers only because `bridge.js` and the `onclick=` attributes know those names.

**A tab is drawn by breaking the header's rule, not by painting over it.** The selected tab has rounded top corners, a hairline outline with no bottom edge, and the panel body's own `--bg2`; `.panel-tabs` carries `margin-bottom: -1px` so that fill lands *on* `.panel-header`'s `border-bottom` and covers exactly the pixel under the tab. The line separates chrome from content everywhere except under the tab you are reading, where the two are the same thing — which is the whole metaphor, and it is why the accent moved to the tab's *top* edge: under the tab is where that hairline is, and a second rule there would be drawing back what the shape just removed.

Two things that shape depends on. **The header keeps `--bg2`** — see the note over `header` in [css/layout.css](css/layout.css): the app header and both panels are meant to read as one surface, and recessing this strip would cut it horizontally the way a hairline there would cut it vertically. So the contrast comes from the other side: **`.panel-tab:not(.active)` is recessed toward `--bg`**, which is the ground under everything and darker than `--bg2` in every theme, so it deepens whichever way a palette runs. Without that, an outline on a header and a body of identical paint is a curve drawn on flat colour. And **the border is `transparent` on every tab** rather than present only on the selected one, or the label shifts a pixel each way as selection moves.

Two more worth keeping straight. **A strip holds one tab or two** — `grid-auto-flow: column` rather than a fixed pair, because StateMate moving changes both counts at once — and **a lone tab drops the shape entirely**, outline, fill and cap, since with nothing to be selected *instead of* a tab cut out of the header rule says nothing. **`.panel-header`'s bottom padding is zero on both sides** now that both carry a strip: the strip's own 36px is what meets the header's 44px minimum, and the tab has to reach the header's bottom edge to break its rule.

**A tab name is an element, not a text node.** `text-overflow` has nothing to apply to on the anonymous flex item a loose string becomes, so `.panel-tab-label` is what ellipsizes; before it, a name simply drew over the next tab, since the tracks are `minmax(0, 1fr)` and a tab is *allowed* to be narrower than its own text. Below 300px — measured by `@container`, because these panels are resized and pinned independently of the window — the tab icon is dropped rather than the words, two glyphs that repeat the names being cheaper to lose than the ends of both names.

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

### The tape

**Where the head may go is a property of the tape, not of the machine driving it**, and [js/tape.js](js/tape.js) is the object that holds it. Determinism, tape count and end markers were already independent axes; boundedness-at-the-left was a fourth with nowhere to live, so it was written out as `if (head < 0) head = 0` in `testTM3`, `testMTM3` and `simTM`, again as `Math.max(0, …)` in the two nondeterministic explorers, and a sixth time inside `normalizeTapeConfig`.

That clamp is not a tape model. A bounded tape should refuse to move left; re-reading cell 0 forever is neither halting nor moving, and since the loop detector then calls the configuration repeated, a machine that scans off the front of its input is **decided wrongly rather than refused** — reported as a clean rejection, indistinguishable from a real one. Every Turing machine imported from a `.jff` hit exactly that, JFLAP's tape being two-way.

One implementation serves all three models: cells live in a `Map` keyed by integer, which has no least index; a bounded tape is that `Map` plus a floor at 0; and an **LBA's is that plus a ceiling (`rightBound`) and two cells that refuse to be written (`immutable`)** — which is the whole of what makes it linear-bounded, stated once in `makeLbaTape` rather than reassembled in `testLBA3` and `simLBA`. `tape.js` imports nothing and takes `blank` as an argument, so a tape is testable without a machine, an `App` or a DOM.

**`move()` and `write()` report a refusal rather than acting on one**, because the callers disagree about what it means: a bounded TM shrugs and re-reads the cell, an LBA rejects. Baking either answer into the tape would just move the old duplication somewhere new.

Points worth keeping in mind:

- **`usesTwoWayTape` in [js/state.js](js/state.js) answers from two places, and the order matters.** `ITM` says so by *being* what it is — no setting may make a machine labelled "Two-Way Infinite TM" bounded — while `TM`, `NDTM` and `MTM` read `App.config.twoWayTape`. That setting is what makes a two-way multi-tape or nondeterministic machine a *tape choice* rather than two more rows in the machine picker. `LBA` is excluded outright: bounded at both ends is its definition, not its tape's.
- **`key()` is origin-independent, and that is the whole of loop detection.** A two-way tape renumbers every cell the moment it grows leftward, so a key built from absolute indices calls two identical configurations different and the frontier never closes. It is built from `snapshot()`, whose window starts at the leftmost of the head and the written cells — pointedly *not* at cell 0, which would anchor it to an origin the machine cannot see. Trailing blanks are trimmed for the same reason: a head that ran right over blank tape and came back is in the configuration it started from.
- **A blank write deletes the cell** rather than storing a blank, or a tape scrubbed back to empty keeps every cell it ever touched and no two such configurations compare equal. The trailing-blank trim in `key()` is therefore **off for a right-bounded tape**: there a trailing blank is a cell the machine wrote, not tape the head has not reached, and trimming would call two different configurations the same.
- **The storage abstraction stops at the tape.** The PDA family was already factored this way — `applyPdaStoreTransition`/`pdaPeek`/`pdaStoreToString` take a `queueMode` flag, so DPDA/NPDA/QA/Counter/2PDA share one store. The two-way *heads* (`2DFA`, `2NFA`, `2DFT`) deliberately stay separate: they never write, and running off an end is a halt condition rather than a move to refuse, so `Tape` would be the wrong shape for them.
- **The drawn head index is not the cell number.** `snapshot()` returns both; on a two-way tape they diverge as soon as it grows left, which is why `simTM` puts the cell in its note.
- `testITM3` and `simITM` are now one-line delegations to the `TM` pair — the difference lives in the tape, and a second copy of the loop is only a way for the two to drift.

`App.config.twoWayTape` defaults to **false**, so an existing machine keeps deciding what it decided; the setting is in Settings → Turing, and travels with a workspace through `getWorkspaceData`'s allow-list. [tests/tape.test.js](tests/tape.test.js) pins the tape itself, the axis, and that one machine decides differently under the two models.

### Algorithms

[js/algorithms-fa.js](js/algorithms-fa.js) and [js/algorithms-cfg.js](js/algorithms-cfg.js) hold the textbook constructions, one pair per algorithm: `algoXxx(container)` renders the interactive card, `runXxx()`/`buildXxx()` computes and returns a machine or grammar, `loadXxxResult()` puts it on the canvas. Keeping compute separate from render is what makes them testable — tests call the `build*`/`run*` half directly.

### Export / codegen

[js/export-core.js](js/export-core.js) normalizes `App` into a machine **IR** via `buildMachineIR()`. Everything downstream consumes only the IR: [js/export-formats.js](js/export-formats.js) (DOT, TikZ, tables, sample words) and [js/codegen.js](js/codegen.js) (JS/Python/Java in table/switch/class styles). Both register their targets into `ExportFormats` from [js/export-registry.js](js/export-registry.js); [js/export-ui.js](js/export-ui.js) owns the dialogs. Adding a target means adding a registry entry and an IR consumer, not touching `App`.

PNG export can embed the workspace JSON in the image; dropping that PNG back on the canvas restores it ([js/persistence.js](js/persistence.js) `handleFiles`). Persistence also covers IndexedDB autosave, `.json` save/load, base64url share links, and JFLAP import ([js/import-jflap.js](js/import-jflap.js)).

### JFLAP import

The reader is hand-rolled rather than `DOMParser`-based — `.jff` is machine-written and regular enough that a focused reader covers it and stays testable without a DOM. `<type>` names a *family*, so the specific machine type is read back off the transitions by `jflapMachineType` the same way `loadData()` does for the app's own files.

**JFLAP 6.1 added a notation 4.x has no equivalent for, and reading it literally fails silently.** A `<read>` may name a set of symbols bound to a variable — `y, a } w` — with `<write>w</write>` meaning "put back whatever you just read", so one edge stands for one transition per listed symbol. Read as a plain symbol it becomes an eight-character tape symbol no cell can ever hold: the edge draws, Σ and Γ fill with garbage, and the machine rejects everything with no error anywhere. `jflapParseRead` classifies the three forms and the transition loop `flatMap`s a set into one transition per symbol; **the negated form `! a, b } w` cannot be expanded inline** because it subtracts from an alphabet that is not complete until every transition has been read, so it is parked in `deferred` and resolved in a second pass.

Points worth keeping in mind:

- **A `<push>` string is characters, not a symbol.** JFLAP stack symbols are single characters and `AZ` pushes A then Z; putting `"AZ"` in Γ adds a symbol nothing can match. `addStackSymbols` is the one place that decides this.
- **`<tapes>` has to be read before `jflapMachineType`**, or a 3-tape file whose transitions only touch 2 classifies as a single-tape `TM`. The widest transition is a lower bound on the tape count, never the answer.
- **What could not be converted is reported, never dropped quietly.** `jflapToWorkspace` returns a `warnings` array — an expanded variable edge, a `<block>` whose interior was not inlined, a second `<initial/>`, a PDA whose empty-stack acceptance the app does not model — and `importJFLAPText` writes it to the machine card rather than the status bar, which holds one line for 2.5 seconds. These are caveats the reader has to weigh against the diagram, so they have to still be there a minute later. `warnings` is not part of the save format; `getWorkspaceData` is an allow-list and drops it.
- **Structures with no `<automaton>` each name themselves** (`UNSUPPORTED_TYPES`) — "no `<automaton>` element" tells someone who exported a regular expression nothing.

**JFLAP's tape is two-way infinite, unconditionally, for every Turing machine it writes.** That is a fact about the file rather than a guess about the machine in it, so `jflapToWorkspace` returns `twoWayTape: true` and `loadData` applies it — there is nothing to detect from the transitions and no machine type to pick. See [the tape](#the-tape) for why that is a setting rather than a family of extra machine types.

### The machine card

The (i) button over the canvas opens **`App.meta`** — `{title, blurb, inputs}`, what this machine is in its author's words, with the test words worth trying on it as runnable chips. Rendering and editing are both the card section at the end of [js/persistence.js](js/persistence.js).

**It is on `App` rather than in that module because it is document content, and that is the whole of the design.** It used to be a module-scoped `cardMeta`, written only by the example loader and by StateMate, and two things followed: a machine you drew yourself could never have a card, and a machine that did have one lost it on the first save, because `getWorkspaceData` never wrote `meta` back out. Putting it on `App` fixes both at once — `exportWorkspaceState` carries it between tabs, `getWorkspaceData` writes it to the `.json`, the embedded PNG and the share link, and `serializeState` puts it on the undo stack, so one Ctrl+Z reverts a reworded blurb the same way it reverts a dragged state.

Points worth keeping in mind:

- **`normalizeCardMeta()` is the gate, and it runs on the way in from every writer.** Blank fields are dropped rather than stored as `''`, and a card of nothing but blanks normalizes to `null` — so "has a description" stays one truthiness test everywhere else. A row is dropped for having no `w` at all, never for `w === ''`: the empty word is a legitimate test, drawn as `ε` and run as `""`.
- **The editor is inline, and edits are held in a draft.** A dialog would cover the machine the description is about. `cardDraft` is a working copy that only reaches `App.meta` at Save, so Cancel is free, an abandoned edit never dirties the tab, and a form opened and closed unchanged spends no undo point.
- **The button is offered for an *undescribed* machine too** — that is the entry point, and without it the editor is unreachable for anything you drew yourself. With a description it opens the card; with none it opens the editor; with neither a description nor a machine it stays away, because a button that opens an empty card is worse than no button.
- Every path that hydrates `App` from a blob has to announce `Change.META` or the card is left describing the machine it replaced: both tab-activation paths in `ui.js`, `restoreSnapshot`, and StateMate's `restoreCheckpoint`.
- Nothing here is reached from an `on*` attribute — chrome is wired at creation the way `reference.js` does it, so the whole feature adds no names to `bridge.js`.

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

  Three consequences worth keeping straight. **The transcript is the surface** — `Session.log` holds richer entries than the thread does (the live run with its stages, errors, `/examples` output, system notes), and `syncLogWithThread()` rebuilds it from `getThread()` whenever the two disagree; it counts only entries flagged `turn`, so a failed or interrupted run leaves its error on screen instead of being erased by the next open. **The console stays visible after a machine result** in the right panel beside the canvas; `decorateResultCard` still writes the canvas card, which outlives the console and carries the runnable test words. **An exact algorithm is a note above the composer, never a row** (`renderNudge`): `algorithms-fa.js` being correct is a reason to offer the tool, not a reason to reinterpret the sentence being typed.

  **It is a native sidebar tab, not a modal or a modal-shaped dock, and either sidebar will host it.** [js/panel-state.js](js/panel-state.js) is the import-free single source of truth for both panels' selection *and* for which panel a movable tab is on; `ui.js` maps that state to `aria-selected`, roving `tabindex`, `hidden`, `aria-hidden` and `data-active-panel`. StateMate never enters `ModalStack`, never adds `body.modal-open`, never traps Tab and never needs an overlay pointer exception. `openStateMate()` and `stowStateMate()` remain the public lifecycle entry points: selection state belongs to the panel controller, while transcript resumption, unread accounting, scroll restoration and focus return belong to `statemate-ui.js`. Nothing in `statemate-ui.js` names an edge — `homeSide()` asks, which is what lets the Escape claim, the stow target and the reveal all follow the panel when it moves.

  **`PANEL_TABS` there is the whole registry — the names, the element ids, the home side, the order and the defaults, for both edges at once.** It was three lists: a frozen name array in the leaf, an id map duplicated in `ui.js`, and `data-rp-tab` attributes nothing read. A name known to the controller but missing from the map coerces silently to the default, which reads as a tab that refuses to select, so adding a sibling means adding one entry rather than editing three places. Declaration order is tab order — `panelTabNames(side)` drives the Arrow/Home/End walk, read at event time because a movable tab changes both strips at once — and a side's default is its first **fixed** tab, deliberately not its first tab, since a default that can walk off the panel is not a default.

  **`movable: true` is the whole of "StateMate can live on either panel".** It is a property of the tab, so `setTabSide` is the only thing that decides, `applyPanelLayout()` in `ui.js` is the only thing that moves DOM (the tab button, the tabpanel, and StateMate's ⋯ menu, which is part of the tab rather than of the right panel), and `setStateMatePanel()` is the only thing that persists it — under its own `automata-statemate-panel` key, never `App.config`, which is deep-copied into every workspace tab and written to IndexedDB. A tab that was showing keeps showing: it is selected on the side it arrives at and the side it left falls back to its default, or the move would take the panel out from under a reader mid-conversation.

  **`revealPanel(side)` is for openings only**, and `showPanelTab` never calls it: the strip is *inside* the panel, so reaching it means the panel is already readable, and pinning writes to localStorage — clicking "Inspector" on a hover-revealed panel would quietly change a preference the reader set on purpose. Selecting StateMate still reveals, because that path runs `openStateMate`, which ends by focusing the composer, and an unpinned panel is a hover rail whose content is `visibility: hidden` with no `:focus-within` exception — the alternative is a caret in a field that disappears when the pointer leaves.

  **`hidden` is what the controller sets, so `hidden` has to be what hides.** Every tabpanel in both sidebars is a flex column, and `display: flex` in an author rule beats the user agent's `[hidden] { display: none }` — an unselected panel stays laid out and paints straight through the selected one. One rule in [css/panels.css](css/panels.css) covers all of them; what it replaced was a single hand-written `.rpanel[data-active-panel=…]` selector that had to be remembered for each new tab.

  **Selecting Inspector is a non-destructive leave.** Nothing about the session lives in the visible DOM, so the transcript, thread, held proposal and request in flight survive a tab switch. `minSince` anchors at a live run rather than after it, so the entry replaced in place by a machine, reply or error is counted once as whatever it became; the StateMate tab shows that unread count or the in-flight ellipsis. `openStateMate()` always selects and focuses the panel, so the sparkle button, ⌘K and “ask about this selection” never become no-ops. ⌘K in the composer selects Inspector, matching the shortcut that opened it.

  **Stepping back onto the tab keeps your scroll position; opening StateMate goes to the newest line.** Those are different acts, and `openStateMate({ resume })` is where they differ — only the tab strip passes `resume: true`, so the sparkle button, ⌘K and "ask about this selection" all re-pin to the tail. It is a parameter rather than a flag on `Session` because the flag could only mean "the last leave was a stow", which is true of every return: set in `stowStateMate()`, it made the sparkle button resume a scroll the reader had abandoned, and put the caller's intent one function away from the call site.

  Because the canvas moves under an open console, the console subscribes: `Change.CANVAS` re-renders the status line and the context chips, and `Change.GRAPH` also invalidates any held proposal, whose card compares `machineSignature()` at render time. That is what makes a selection made *while* the console is open reach the context basket — the status line offers it, which was impossible when reaching the canvas meant closing the dialog.

  **The transcript is diffed, not rebuilt.** `renderLog()` walks `Session.log` against `Session.nodes`, keyed by entry *object identity* the way `renderAll()` keys states by id, and reuses the node that is already on screen. Clearing and rebuilding cost more than time: it collapsed whatever `<details>` the reader had opened, destroyed a part-made text selection, re-ran KaTeX over every past reply, and — with `aria-live` on the container — re-announced the whole session, all of it several times per run, because a stage event is a render. The rules that keep it correct: a changed entry is a **new object** (`replaceEntry` builds one), the two places that mutate an entry in place call **`invalidate()`** (`acceptProposal`, and `keyEntry` when the thread hands back the turn id the branch stepper is keyed on), `rebuildFromThread()` drops the whole cache because a stepper reads `siblingsOf()` at render time, and the live run entry is the one always rebuilt. The live region moved to `#sm-live`, which carries one line per turn.

  **And it follows its tail only while the reader is at it.** `Session.pinned` is maintained by the log's own scroll listener; `scrollLogToEnd()` is a no-op when the reader has scrolled away, and `#sm-jump` offers the way back. Scrolling up to re-read a turn is a decision, and a streaming reply used to undo it several times a second.

  **A turn is a bubble, and the transcript scrolls in one direction.** Both are one bug seen twice. `overflow-y: auto` does not mean "scroll vertically": a box that scrolls on one axis computes `visible` to `auto` on the other, so `.sm-log` was a two-axis scroller and *one* wide thing anywhere in a session — a display formula, a fenced block, a long identifier — made the whole column horizontally scrollable and cut every turn above and below it off at both edges. The wide things all carry their own `overflow-x: auto` (`.md-pre`, `.md-table-wrap`, `.katex-display`), so the log clamps its axis and the one block that needs to scroll does. `scrollbar-gutter: stable` reserves the track either way, or a bubble ends somewhere different the moment a session gets long enough to scroll.

  The other half was the card. `.sm-card` was a hairline rule with the content hanging under it — which reads as a section of a document rather than as something said back to you, the user's side being a bubble and the assistant's side a horizontal line — and it had **no horizontal padding**, correct for a rule and disastrous the moment a variant painted a fill behind the same box: the held proposal's tint ran the full width of the column with its text flush against two square edges, so it read as a bubble the panel had cut off. `.sm-card` is now the bubble — padded, rounded, capped at the same ~74-character measure a reply always had, hugging its own content — and the variants (`is-reply` violet, `is-warn` gold, `is-error` red, `is-pending` the one with a falloff and the transcript's only shadow) change nothing but the tint. `.sm-stream` is given the same shape so a reply does not change form under the reader when it finishes parsing. The corner nearest the gutter mark is the tight one, opposite to `.sm-user-text`'s, because the two turns point at each other.

  Escape has three jobs — dismiss the completion menu, interrupt a run, then select the host panel's other tab. `handleStateMateEscape()` owns the first two and the panel's capture listener owns the last; it stands down whenever `topModal()` reports a real dialog above the panel. **It is claimed only for a keystroke inside the panel StateMate is on** — `homeSide()`, not a literal `.rpanel`, or moving it to the left edge would both disable Escape on the right and fail to claim it where the console actually is. Being the selected tab is a sticky state, not a standing claim on the keyboard, and the listener is capture-phase on `document`, so its `stopPropagation` pre-empts not just every bubble-phase handler but every element-level one too. Unscoped, merely *having* StateMate selected disabled Escape across the whole app: the canvas shortcuts in `ui.js` (dismissing the tools menu, closing an aux view, clearing the selection, cancelling a half-drawn transition), the machine-card editor in `persistence.js`, the symbol-suggest popover, quick settings, the theme picker, `dropdown.js` and `tooltip.js` — none of which are near the panel. The test is the panel rather than `.sm-panel` because the ⋯ head menu lives in `.panel-header`, a *sibling* of `#statemate-panel`, and `!stowed()` already means the panel is showing StateMate; `modal.js` makes the same shape of exemption for the suggest popover. Dismissing the menu leaves the line alone (`Session.menuHidden`, cleared by the next keystroke); it used to clear the composer, so escaping a completion list deleted the command being written. Listeners are attached at creation the way `reference.js` does, so the whole feature still adds exactly one name to `bridge.js`.

  **Opening a dialog from the ⋯ menu does not stow the panel.** `showOverlay` records `document.activeElement` as the modal's return focus, so stowing first captured the *Inspector* tab: closing AI settings landed the reader on the Inspector with StateMate put away, and made `applyStateMateSettings`'s `if (!stowed())` re-render unreachable on the primary route. The dock-era `closeModal(MODAL_ID)` had to go because the dock and the modal were both overlays; a panel and a dialog are not, so the panel stays where it is and the settings a reader just changed are visible behind, then re-rendered under, the dialog they changed them in.

  **The composer has one submit path and one send button.** `submitComposer()` serves ⏎ and the click both, because they were two functions and the button's copy dropped the `branch` — so "Rewriting a turn: ⏎ replaces it" was true of the keystroke and false of the button beside it. That state is now a bar above the composer with a way out (`renderEditing`) plus a mark on the turn itself, written straight to the cached node the way `canvas.js` writes selection. While a request is in flight the send button **becomes the stop button** rather than going grey — Escape has always interrupted, but a keystroke named in a placeholder is not a control. And ↑/↓ walk the whole prompt history: the old gate was "the line is empty", which the first recall broke, leaving a history exactly one deep with no way forward. **A refusal keeps the sentence**: `submitComposer()` clears the composer before `send()` runs and the error card never prints the prompt it is handed, so the transcript is the only place a typed sentence can survive — both refusals, unconfigured and switched off, push the user turn before the error.

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

It also **records `document` listeners with their phase**, and `dispatchDocumentEvent(type, init)` (re-exported by the harness) delivers capture before bubble and stops on `stopPropagation`. Several features listen for the same key on `document` — `modal.js`, the canvas shortcuts, StateMate's Escape ladder — so which of them may claim a keystroke is a question about phase rather than about registration order, and a capture-phase listener that stops the event silently disables every handler below it. That is not something a per-element stub can express, and it is the failure mode worth a test.

[tests/store.test.js](tests/store.test.js) subscribes and unsubscribes its own handlers rather than resetting the registry, because its last two cases assert on the app's real wiring. [tests/render-incremental.test.js](tests/render-incremental.test.js) is about node *identity* — a renderer that drew the right picture by rebuilding everything would pass a screenshot test and fail most of that file.

`codegen.test.js` still uses `node:vm` — legitimately, to sandbox and execute the *generated* code and check it decides the same language as the simulator.

## Worth knowing

- `js/examples/*.json` are fetched at runtime by name, so they are copied verbatim into `dist/` by a small plugin in [vite.config.js](vite.config.js) rather than hashed as bundler assets.
- The build no longer runs `javascript-obfuscator`. It roughly doubled the bundle and cost ~26% time-to-interactive on a project whose source is public; the desktop build already skipped it. Re-add it as a Vite plugin if that trade is wanted back.
- `exportOpenSamples` in `export-ui.js` has no callers.
