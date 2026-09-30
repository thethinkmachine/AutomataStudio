// ══════════════════════════════════════════════════════════════════
//  WHAT AN ESSAY MAY ASK OF THE LIBRARY
// ══════════════════════════════════════════════════════════════════
// An essay (article.js) is the author's words; this is the half that is not.
// A {{fact}} is read off the index — the analysis that earned the badges — and
// a figure's arguments are checked here before anything draws them. The
// website's build (scripts/library/site.mjs) and the app's Library view
// (library-ui.js) both ask through this module, so an essay says the same
// numbers on both faces and a figure is drawn from the same run.
//
// Imports card-html.js (for a TM's size read off its code) and article.js,
// neither of which touches the DOM.

import { standardSize } from './card-html.js';
import { ARTICLE_MAX_CHARS, renderArticle } from './article.js';

const count = n => Number(n).toLocaleString('en-US');

/** Every fact an essay can name, and where each comes from. */
export const ESSAY_FACTS = {
  steps: e => e.behaviour?.verdict === 'halts' && { value: count(e.behaviour.steps), say: `Steps from a blank tape to the halt, counted by the library running ${e.title}` },
  ones: e => e.behaviour?.ones !== undefined && { value: count(e.behaviour.ones), say: `Non-blank cells at the halt, counted by the library running ${e.title}` },
  cells: e => e.behaviour?.cells !== undefined && { value: count(e.behaviour.cells), say: `Cells ${e.title} visits before it halts, counted by the library` },
  states: e => ({ value: count(e.stats.states), say: `States in ${e.title} as drawn` }),
  transitions: e => ({ value: count(e.stats.transitions), say: `Transitions in ${e.title} as drawn` }),
  size: e => { const z = standardSize(e.standard); return z && { value: `${z.states} × ${z.symbols}`, say: `States × symbols of ${e.title}, read off its standard code` }; },
  standard: e => e.standard && { value: e.standard, say: `${e.title} in the standard text format` },
  title: e => ({ value: e.title, say: e.id })
};

/**
 * The `fact` callback for renderArticle: `{{steps}}` asks `self` (the entry
 * the essay belongs to; null for a collection's essay), `{{steps <id>}}` asks
 * another entry. Null for a fact the library does not know.
 */
export function essayFacts(index, self = null) {
  const byId = new Map((index?.entries || []).map(e => [e.id, e]));
  return (name, ref) => {
    const e = ref ? byId.get(ref) : self;
    return (e && Object.hasOwn(ESSAY_FACTS, name) && ESSAY_FACTS[name](e)) || null;
  };
}

/** Where a `lib:<id>` link goes: an entry, a collection, or nowhere. */
export function essayLinkTarget(index, id) {
  if ((index?.entries || []).some(e => e.id === id)) return { kind: 'entry', id };
  if ((index?.collections || []).some(c => c.id === id)) return { kind: 'collection', id };
  return null;
}

// The largest run a figure may ask for. A space-time diagram is drawn row by
// row, and past this many steps its rows are samples of samples; a growth
// chart runs the machine to its halt, bounded like the library's own analysis.
export const SPACETIME_MAX_STEPS = 200000;
export const GROWTH_MAX_STEPS = 1e8;

/**
 * A figure directive (`::: spacetime steps=4029 h=440`) → what to draw, with
 * its arguments parsed and clamped, or null when the machine cannot be drawn
 * that way. `entry` is the machine the figure is of. Both faces draw from
 * this, so an argument means the same thing on each.
 */
export function essayFigureSpec(name, args, entry) {
  if (name === 'spacetime' || name === 'growth') {
    if (!entry?.standard) return null;
    if (name === 'spacetime') {
      const steps = clampInt(args.steps, 2000, 1, SPACETIME_MAX_STEPS);
      const h = clampInt(args.h, 420, 160, 900);
      return { kind: 'spacetime', code: entry.standard, opts: { steps, w: 680, h }, aspect: `680 / ${h}` };
    }
    return {
      kind: 'growth', code: entry.standard,
      opts: { maxSteps: GROWTH_MAX_STEPS, scale: args.scale === 'linear' ? 'linear' : 'log', yScale: args.y === 'log' ? 'log' : 'linear' }
    };
  }
  if (name === 'diagram') return entry ? { kind: 'diagram' } : null;
  return null;
}

function clampInt(v, fallback, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== undefined ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/**
 * What is wrong with an essay, as the build reports it on the entry: a fact
 * the library does not know, a figure the machine cannot draw, a link to
 * nothing, a note never written, a file past the length the renderer reads.
 * Nothing is drawn — the check asks only whether it could be — so this is
 * cheap enough to run on every build, and an author sees it on their pull
 * request instead of on the published page.
 */
export function essayWarnings(md, index, self = null) {
  const byId = new Map((index?.entries || []).map(e => [e.id, e]));
  const could = { html: '' };
  const figure = (name, args) => {
    if (name === 'machines') return args._.length && args._.every(id => byId.has(id)) ? could : null;
    return essayFigureSpec(name, args, args.id ? byId.get(args.id) : self) ? could : null;
  };
  const { warnings } = renderArticle(md, { fact: essayFacts(index, self), figure, link: id => (essayLinkTarget(index, id) ? '#' : null) });
  const out = warnings.map(w => `Essay: ${w}`);
  if (String(md).length > ARTICLE_MAX_CHARS) out.push(`Essay: longer than ${ARTICLE_MAX_CHARS.toLocaleString('en-US')} characters; the rest is not shown.`);
  return out;
}
