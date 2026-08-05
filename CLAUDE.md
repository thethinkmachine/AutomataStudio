# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev                # Vite dev server (no vite.config; serves index.html at :5173)
npm run build              # scripts/build.mjs -> dist/ (concat + minify + obfuscate)
npm test                   # node --test over tests/*.test.js
node --test tests/language.test.js                       # single file
node --test --test-name-pattern "subset construction"    # single test by name
npm run electron:dev       # vite + electron pointed at the dev server
npm run electron:preview   # production bundle (no obfuscation) inside electron
npm run electron:build     # electron-builder -> release/
```

`SKIP_OBFUSCATION=1` turns off the javascript-obfuscator pass. Desktop builds always set it; the website build does not.

CI: `.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on push to `main`. `.github/workflows/electron-build.yml` packages win/mac/linux installers on every push and publishes a GitHub Release for `v*` tags.

## Architecture

### No modules — one global scope

The app is a classic multi-`<script>` page. `index.html` (~140kB, hand-written) loads `js/*.js` in a fixed order; every top-level `function`/`const` lands in one shared global scope, and roughly 230 inline `onclick=`/`onchange=` attributes in the HTML call ~114 of those globals **by name**. There is no bundler at dev time and no import/export anywhere.

Consequences that constrain nearly every change:

- **Never rename a top-level identifier** without grepping `index.html` for it. The build enforces this via `mangle.toplevel: false` and `renameGlobals: false` — see the header comment in [scripts/build.mjs](scripts/build.mjs).
- Adding a new `js/*.js` file means adding a `<script>` tag in `index.html` (order matters: `js/init.js` runs last and boots everything) and usually a matching entry in `tests/harness.js`'s `SCRIPT_ORDER`.
- New CSS files need a `<link>` in `index.html`; the build concatenates local stylesheets in document order.
- `src/` is empty leftover scaffolding from an abandoned refactor. Ignore it; all code lives in `js/` and `css/`.

### State

`App` in [js/state.js](js/state.js) is the single mutable store: current machine type, `states`/`transitions` arrays, alphabets (as `Set`s), selection, camera, `config`, and simulation cursor. `MachineTypes` there is the capability table (`hasStack`, `hasTape`, `hasEpsilon`, `isTransducer`, `hasEndMarkers`) that most machine-agnostic code branches on — prefer adding a capability flag over `if (App.machine === ...)` chains. `MachineCategories` drives the model picker; note `PDA` is a hidden alias of `DPDA` and is deliberately absent from it.

Multi-tab editing lives in `Workspaces` / `activeWorkspaceId` (also [js/state.js](js/state.js)): each tab is a serialized `exportWorkspaceState()` blob, and switching tabs saves the live `App` into the outgoing workspace and rehydrates the incoming one. Mutations must call `markDirty()` ([js/history.js](js/history.js)) so the tab flags dirty and the save indicator updates; `snapshot()` pushes onto `App.history` for undo.

### Rendering

The diagram is **SVG**, built imperatively in [js/render.js](js/render.js) (`makeSVG()` + `SVG_NS`); there is no virtual DOM or diffing — `renderAll()` rebuilds. [js/canvas.js](js/canvas.js) owns the camera (`App.cam` = `{x, y, z}`), pan/zoom, and pointer gestures, with touch handled on a deliberately separate code path from mouse/pen.

### Views

`setView()` in [js/view.js](js/view.js) is the single entry point. The build view (canvas) is always mounted; `algo`, `grammar`, and `theory` render as modal overlays on top of it, so canvas geometry stays measurable. Algorithms call `setView('build')` to reveal a result on the canvas.

### Simulation

[js/simulation.js](js/simulation.js) dispatches from `runSim()` to a per-family simulator (`simDFA`, `simNFA`, `simPDA`, `simNPDA`, `simTM`, `simNDTM`, `sim2DFA`, `simMoore`, `simMealy`, …). All of them produce the same artifact: a flat `App.simSteps` array of step records that the UI scrubs through via `App.simIdx`. Nondeterministic machines explore first (`exploreNPDA`, `explore2NFA`, …) and then linearize the winning path into steps. Step budgets are in `App.config` (`maxPdaSteps`, `maxTmSteps`, `langStepBudget`).

### Algorithms

[js/algorithms-fa.js](js/algorithms-fa.js) (~180kB) and [js/algorithms-cfg.js](js/algorithms-cfg.js) hold the textbook constructions. The convention is a pair per algorithm: `algoXxx(container)` renders the interactive card, and a separate `runXxx()`/`buildXxx()` does the actual computation and returns a machine/grammar; `loadXxxResult()` loads it onto the canvas. Keeping compute separate from render is what makes these testable — tests call the `build*`/`run*` half directly.

### Export / codegen

[js/export-core.js](js/export-core.js) normalizes `App` into a machine **IR** via `buildMachineIR()`. Everything downstream consumes only the IR: [js/export-formats.js](js/export-formats.js) (DOT, TikZ, CSV/Markdown tables, sample words), [js/codegen.js](js/codegen.js) (JS/Python/Java, each in table/switch/class styles), and [js/export-ui.js](js/export-ui.js) (the modals). Adding a target means adding an IR consumer, not touching `App`.

PNG export can embed the workspace JSON in the image; dropping that PNG back onto the canvas restores it ([js/persistence.js](js/persistence.js) `handleFiles`). Persistence also covers IndexedDB autosave (`persistWorkspaceAsync`, `runAutosave`, restored asynchronously at boot in [js/init.js](js/init.js)), `.json` save/load, base64url share links, and JFLAP import ([js/import-jflap.js](js/import-jflap.js)).

### Themes

Adding a theme touches exactly two places, both documented at the top of [js/themes.js](js/themes.js): a `:root[data-theme="id"]` block in `css/variables.css`, and an entry in the `Themes` registry. The registry entry needs an `export` palette because the SVG canvas and minimap paint from JS colour values, not CSS variables — `applyTheme()` ([js/ui.js](js/ui.js)) copies it into `App.config.export.*` and repaints.

### Electron

`window.electronAPI` (exposed by [electron/preload.js](electron/preload.js)) exists only inside the shell; [js/electron-bridge.js](js/electron-bridge.js) sets `isElectron` and the `.is-electron` root class, and every `isElectron` branch elsewhere falls through to browser behavior on the website. The window is frameless — the page draws its own minimize/maximize/close buttons. The packaged app serves `dist/` over a custom `app://` protocol rather than `loadFile()`, so `fetch`/CORS behave like http.

## Tests

`tests/harness.js` runs the real `js/*.js` sources inside a `node:vm` context against a hand-rolled fake DOM (`getElementById` lazily mints stub elements), fake `localStorage`, and stubs for the renderers. Tests are CommonJS + `node:test`/`node:assert`.

The critical gotcha: **top-level `let`/`const` in the loaded scripts are lexical bindings, not properties of the vm context.** `context.Workspaces` or `context.MachineCategories` reads `undefined`, and assigning to it only creates a shadowing own-property the app code never sees. Reach them with `harness.evalInContext('expr')`, or add an explicit `globalThis.X = X` re-export in the loader loop the way `App`/`MachineTypes`/`Themes` are handled. Only `function` declarations are visible as `context.foo` directly.

`js/history.js` is deliberately absent from `SCRIPT_ORDER` — the harness supplies stub `snapshot`/`markDirty` instead, and the stubbed `markDirty` is kept in sync by hand with the real one.

Known failure: `tests/algorithms.test.js:132` ("model picker categories keep the PDA alias hidden") fails because it reads `context.MachineCategories`, which hits exactly the lexical-binding gotcha above. 355 other tests pass.
