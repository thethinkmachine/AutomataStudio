// ══════════════════════════════════════════════════════════════════
//  THE GUIDE TO WRITING AN ESSAY
// ══════════════════════════════════════════════════════════════════
// essay-guide.md is the one text; this renders it. It is written in the essay
// format itself, and every ```example block in it is shown twice — the source,
// and what the real renderer (article.js) makes of it, with a real machine's
// facts and figures — so the guide cannot describe a feature the renderer does
// not have without its own example showing the gap. The website builds it
// into /writing/ (site.mjs); the app shows it beside the essay editor.
//
// tests/essay.test.js holds it to the code: it renders with no warnings, and
// it names every fact, figure, callout kind and HTML tag the renderer accepts.

import { renderArticle } from './article.js';
import { essayFacts, essayLinkTarget } from './essay.js';

/**
 * The machine the examples are about: BB(2), the library's own entry when the
 * index has it — so an example's facts and links are the listing's — and
 * otherwise these numbers, which are that entry's.
 */
export const GUIDE_SAMPLE_ID = 'turing/busy-beaver/bb2';
export const GUIDE_SAMPLE = {
  id: GUIDE_SAMPLE_ID, title: 'BB(2) champion', category: 'tm', machine: 'ITM', standard: '1RB1LB_1LA1RZ',
  stats: { states: 3, transitions: 4 }, behaviour: { verdict: 'halts', steps: 6, ones: 4, cells: 4 }
};

/** The index the guide's examples resolve against: the real one, with the sample in it for sure. */
export function guideIndex(index) {
  const entries = index?.entries || [];
  return entries.some(e => e.id === GUIDE_SAMPLE_ID)
    ? index
    : { ...(index || {}), entries: [...entries, GUIDE_SAMPLE], collections: index?.collections || [] };
}

export function guideSample(index) {
  return guideIndex(index).entries.find(e => e.id === GUIDE_SAMPLE_ID);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Every ```example (or ````example, for one that holds a fence) block, in order. */
const EXAMPLE_RE = /^(`{3,})example[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm;

/**
 * The guide → { html, toc, warnings, examples }. `ctx` is what the page's
 * essays get — `figure` and `link` — and the facts are the sample's. Each
 * example is rendered on its own, with ids of its own, and shown beside its
 * source; the rest is rendered as one essay, contents list and all.
 */
export function renderGuide(md, { index = null, figure = () => null, link = null, idPrefix = '', newTab = false } = {}) {
  const idx = guideIndex(index);
  const sample = guideSample(index);
  const fact = essayFacts(idx, sample);
  const linkTo = link || (id => (essayLinkTarget(idx, id) ? `#${id}` : null));
  const sources = [];
  const withSlots = String(md || '').replace(EXAMPLE_RE, (_, _fence, body) => {
    sources.push(body);
    return `::: example ${sources.length - 1}\n:::`;
  });
  const warnings = [];
  const guideFigure = (name, args) => {
    if (name !== 'example') return figure(name, args);
    const n = Number(args._[0]);
    const src = sources[n];
    // An example's ids are its own; its #links reach the guide's headings.
    const out = renderArticle(src, { fact, figure, link: linkTo, idPrefix: `${idPrefix}ex${n}-`, anchorPrefix: idPrefix, newTab });
    warnings.push(...out.warnings.map(w => `Example ${n + 1}: ${w}`));
    return {
      plain: true,
      html: `<div class="essay-example"><pre class="essay-code essay-example-src" aria-label="Markdown"><code>${esc(src)}</code></pre><div class="essay-example-out" aria-label="Becomes">${out.html}</div></div>\n`
    };
  };
  const art = renderArticle(withSlots, { fact, figure: guideFigure, link: linkTo, idPrefix, newTab });
  return { html: art.html, toc: art.toc, warnings: [...art.warnings, ...warnings], examples: sources.length };
}
