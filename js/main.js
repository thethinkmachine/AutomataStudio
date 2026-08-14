// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ══════════════════════════════════════════════════════════════════
// index.html loads this one module; everything else is reached through the
// import graph. The order below mirrors the old <script> order. ES modules
// derive their own evaluation order from imports, so this mostly just breaks
// ties — but the last two entries are load-bearing:
//
//   bridge.js  must run before init.js, so window handlers exist at boot
//   init.js    is the boot sequence and expects every module initialised
//
// Modules that nothing imports (tooltip.js, electron-bridge.js) are listed
// so their top-level listeners still get installed.

import './electron-bridge.js';
import './dropdown.js';
import './store.js';
import './modal-registry.js';
import './modal.js';
import './themes.js';
import './state.js';
import './history.js';
import './view.js';
import './alphabet.js';
import './states-transitions.js';
import './canvas.js';
import './render.js';
import './minimap.js';
import './quick-settings.js';
import './notes.js';
import './dividers.js';
import './simulation.js';
import './language.js';
import './suggest.js';
import './persistence.js';
import './export-registry.js';
import './export-core.js';
import './export-formats.js';
import './export-ui.js';
import './codegen.js';
import './import-jflap.js';
import './algorithms-fa.js';
import './algorithms-cfg.js';
import './theory.js';
import './workspace.js';
import './utils.js';
import './ui.js';
import './tooltip.js';

import './bridge.js';
import './init.js';
