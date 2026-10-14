// The Library of Babel's worker: plumbing around babel-worker-core.js, which
// holds the logic so it can be tested and run in place without a worker. It
// imports the engine and the machine layer, which are DOM-free — see
// tests/parallel.test.js, which keeps js/machines/** that way.
import { handleBabelMessage } from './babel-worker-core.js';

self.onmessage = e => self.postMessage(handleBabelMessage(e.data));
