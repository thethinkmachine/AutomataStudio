// The worker entry point. Plumbing only — the logic it runs is in
// decide-core.js so that it can be tested without a worker; see the header
// there.
//
// This file's one job beyond the wiring is the import: it pulls in the machine
// layer and nothing else, which is only legal because js/machines/** is a
// closed set of leaves. Adding a UI import anywhere under js/machines/ breaks
// this file at load, and tests/parallel.test.js is what catches that.
//
// The painter in machines/paint.js is left uninstalled here, so a simulator's
// renderSimStep() is a no-op — never reached anyway, since this worker only
// ever calls the decide path.
import { handleMessage } from './decide-core.js';

const state = { loaded: -1 };
self.onmessage = (e) => self.postMessage(handleMessage(e.data, state));
