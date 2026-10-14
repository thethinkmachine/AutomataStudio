// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — ASKING THE WORKER
// ══════════════════════════════════════════════════════════════════
// One worker, started on first use, for the work that takes time: a room's
// map, a Turing machine's halting verdict on a large budget. Where there is no
// Worker — the test DOM, a CSP that refuses one, a worker that failed — the
// same function runs here after a tick: slower to arrive, never missing.
// The pattern is js/library/essay-draw.js's.

import { handleBabelMessage } from './babel-worker-core.js';

let worker = null;
let refused = false;
let nextId = 0;
const waiting = new Map(); // id → { msg, resolve }

function runHere(msg) {
  return new Promise(resolve => setTimeout(() => resolve(handleBabelMessage(msg)), 0));
}

function spawn() {
  if (worker || refused || typeof Worker === 'undefined') return worker;
  try {
    // This exact form is what Vite recognises to emit a worker bundle.
    worker = new Worker(new URL('./babel.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id);
      if (!w) return;
      waiting.delete(data.id);
      w.resolve(data);
    };
    worker.onerror = () => {
      // Whatever was in flight runs here instead; later asks skip the worker.
      refused = true;
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
      for (const [id, w] of waiting) { waiting.delete(id); runHere(w.msg).then(w.resolve); }
    };
  } catch {
    refused = true;
    worker = null;
  }
  return worker;
}

/** Ask the worker (or, failing that, this thread). Resolves with the reply. */
export function askBabel(msg) {
  const id = ++nextId;
  const full = { ...msg, id };
  const w = spawn();
  if (!w) return runHere(full);
  return new Promise(resolve => {
    waiting.set(id, { msg: full, resolve });
    w.postMessage(full);
  });
}

/** For tests: forget the worker so the next ask decides afresh. */
export function _resetBabelClientForTests() {
  if (worker) { try { worker.terminate(); } catch { /* gone */ } }
  worker = null;
  refused = false;
  waiting.clear();
}
