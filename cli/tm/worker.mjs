// One halting classifier per core. The table arrives already compiled (a
// structured clone of typed arrays), so the worker needs the classifier and
// nothing else of the app — but the classifier imports state.js, which wants
// Solid's browser build, and workers inherit the parent's --conditions.
import { parentPort } from 'node:worker_threads';
// Static, and first, for the reason cli/bundle.mjs gives: in the bundle this
// file is an entry of its own, and the stub has to run before the app does.
import '../node-globals.mjs';
import '../../js/headless/dom-stub.js';

await import('../env.mjs');
const { decide } = await import('./core.mjs');
const { bbStep } = await import('./search.mjs');

parentPort.on('message', msg => {
  try {
    if (msg.kind === 'search') parentPort.postMessage({ id: msg.id, result: bbStep(msg.node, msg.opts) });
    else parentPort.postMessage({ id: msg.id, result: decide(msg.p, msg.opts) });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: e?.message || String(e) });
  }
});
parentPort.postMessage({ ready: true });
