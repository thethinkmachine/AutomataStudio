// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ══════════════════════════════════════════════════════════════════
// index.html loads this one module; everything else is reached through the
// import graph. The order below mirrors the old <script> order. ES modules
// derive their own evaluation order from imports, so this mostly just breaks
// ties — but the last entry is load-bearing:
//
//   init.js    is the boot sequence and expects every module initialised —
//              and so every defineActions() call made, which is what the
//              controls in index.html name (js/core/actions.js)
//
// Modules that nothing imports (tooltip.js, electron-bridge.js) are listed
// so their top-level listeners still get installed.

import './core/electron-bridge.js';
import './ui/dropdown.js';
import './core/store.js';
import './ui/modal-registry.js';
import './ui/modal.js';
import './ui/themes.js';
import './core/state.js';
import './core/history.js';
import './ui/view.js';
import './editor/alphabet.js';
import './editor/states-transitions.js';
import './editor/blocks.js';
import './canvas/graph-thumb.js';
import './editor/view-graph.js';
import './canvas/canvas.js';
import './canvas/render.js';
import './canvas/minimap.js';
import './ui/quick-settings.js';
import './canvas/notes.js';
import './canvas/dividers.js';
import './editor/run-scope.js';
import './simulation/simulation.js';
import './algorithms/language.js';
import './editor/suggest.js';
import './io/persistence.js';
import './io/export-registry.js';
import './io/export-core.js';
import './io/export-formats.js';
import './io/export-ui.js';
import './io/codegen.js';
import './io/import-jflap.js';
import './io/import-statechart.js';
import './algorithms/algorithms-fa.js';
import './lexer/lexer-ui.js';
import './exercise/exercise-ui.js';
import './grammar/grammar-ui.js';
import './reference/reference.js';
import './library/library-ui.js';
import './statemate/statemate-spec.js';
import './statemate/statemate-provider.js';
import './statemate/statemate-prompt.js';
import './statemate/statemate-compile.js';
import './statemate/statemate-lint.js';
import './statemate/statemate.js';
import './statemate/statemate-ui.js';
import './ui/wizard-copy.js';
import './ui/wizard.js';
import './ui/wizard-ui.js';
import './io/workspace.js';
import './core/utils.js';
import './ui/ui.js';
import './editor/scope.js';
import './editor/blocks-ui.js';
import './ui/tooltip.js';

import './core/init.js';
