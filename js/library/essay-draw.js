// ══════════════════════════════════════════════════════════════════
//  AN ESSAY'S FIGURES, IN THE APP
// ══════════════════════════════════════════════════════════════════
// The website draws an essay's figures when it is built; the app draws them
// when the essay is read, from the same code (article-figures.js), in a worker
// — one, started on first use, since figures are drawn one page at a time.
// A drawn figure is kept by what it was drawn from, so going back to an essay
// does not run BB(5) again.
//
// Where there is no Worker (the test DOM, a CSP that refuses one) the figure
// is drawn here instead, after a tick: slower to arrive, never missing.

import { drawStandardFigure } from './article-figures.js';

const drawn = new Map();     // key → Promise<string|null>
let worker = null;
let refused = false;
let nextId = 0;
const waiting = new Map();   // id → resolve

function spawn() {
  if (worker || refused || typeof Worker === 'undefined') return worker;
  try {
    // This exact form is what Vite recognises to emit a worker bundle.
    worker = new Worker(new URL('./essay-figures.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { waiting.get(data.id)?.(data.svg); waiting.delete(data.id); };
    worker.onerror = () => {
      // Whatever was in flight is drawn here instead; later figures skip the worker.
      refused = true;
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
      for (const [id, resolve] of waiting) resolve(undefined);
      waiting.clear();
    };
  } catch {
    refused = true;
    worker = null;
  }
  return worker;
}

function drawHere(kind, code, opts) {
  return new Promise(resolve => setTimeout(() => {
    try { resolve(drawStandardFigure(kind, code, opts)); } catch { resolve(null); }
  }, 0));
}

/** A figure's SVG, drawn off the main thread when it can be; null if it cannot be drawn. */
export function drawEssayFigure(kind, code, opts = {}) {
  const key = JSON.stringify([kind, code, opts]);
  if (!drawn.has(key)) {
    const w = spawn();
    const job = w
      ? new Promise(resolve => {
        const id = ++nextId;
        waiting.set(id, resolve);
        w.postMessage({ id, kind, code, opts });
      }).then(svg => (svg === undefined ? drawHere(kind, code, opts) : svg))
      : drawHere(kind, code, opts);
    // A failure is not remembered: the next look tries again.
    drawn.set(key, job.then(svg => { if (!svg) drawn.delete(key); return svg; }));
  }
  return drawn.get(key);
}

/** Test seam. */
export function _resetEssayFiguresForTests() {
  drawn.clear();
  waiting.clear();
  try { worker?.terminate(); } catch { /* gone */ }
  worker = null;
  refused = false;
}
