// The app's engine, loaded in Node for the command line.
//
// The same three imports as scripts/library/env.mjs, for the same reasons: the
// machine layer is DOM-free but the readers, the exporters and the analysis
// reach modules that resolve elements at module scope, so the DOM stand-in is
// installed first; the simulation module is imported for its side effect of
// installing the painter the machine layer calls through; and js/main.js is
// never imported, because its boot sequence restores a backup, starts autosave
// and reads a share link — none of which a command wants.
//
// Solid has to resolve to its browser build, which is a Node *flag*, not
// something a module can ask for. cli/automata.mjs re-executes itself with it;
// the bundle (npm run cli:build) has the choice made at build time.

import { nodeGlobals } from './node-globals.mjs';
import '../js/headless/dom-stub.js';
import '../js/simulation.js';
import '../js/machines/index.js';

// The stub's fetch throws, which is right for a test and wrong for a command
// that reads the machine library; the real one comes back.
for (const [key, value] of Object.entries(nodeGlobals)) {
  if (value) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: true });
}

export { App, APP_VERSION } from '../js/state.js';
