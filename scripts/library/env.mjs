// The app's engine, loaded in Node for the library's CI.
//
// The machine layer is DOM-free, but the analysis also reaches the exporters,
// the statechart reader and the save format — and several of those modules
// resolve elements at module scope. So the test suite's DOM stand-in is
// installed first, exactly as tests/harness.js does it: imports evaluate before
// any module body, which is why this is a module of its own and every script
// here imports it before anything else.
//
// Not js/main.js: that runs the boot sequence — the backup restore, autosave,
// the share-link reader — none of which a CI job wants. The simulation module
// is imported for its side effect: it installs the painter the machine layer
// calls through, and a run with no painter installed is a run that throws.
//
// Solid resolves to its SSR build in Node unless the browser condition is set,
// and js/reactive.js throws when it gets the stub. The scripts are therefore
// run as `node --conditions=browser --conditions=development …`; the npm
// scripts in package.json say so.

import '../../tests/dom-stub.js';
import '../../js/simulation.js';
import '../../js/machines/index.js';

export { App, APP_VERSION } from '../../js/state.js';
