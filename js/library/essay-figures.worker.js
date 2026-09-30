// Draws an essay's figures off the main thread. A growth chart runs its
// machine to the halt — BB(5) is 47 million steps, about half a second — and
// the Library view should not stop answering the mouse while it does.
// article-figures.js is import-free, so this worker loads nothing else.

import { drawStandardFigure } from './article-figures.js';

self.onmessage = ({ data }) => {
  let svg = null;
  try { svg = drawStandardFigure(data.kind, data.code, data.opts); } catch { /* drawn as missing */ }
  self.postMessage({ id: data.id, svg });
};
