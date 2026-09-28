// ══════════════════════════════════════════════════════════════════
//  A MACHINE IN THE CATALOGUE
// ══════════════════════════════════════════════════════════════════
// The rules both faces of the library share, so a machine reads the same in
// the app's Library view (js/library-ui.js, as DOM) and on the website
// (scripts/library/site.mjs, as HTML): which figure it is known by, the one
// line of facts under its name, what the library checked in words, and the
// plate those make.
//
// Imports index-model.js and sketch.js only — no DOM, so the website's build
// runs it in Node.

import { BADGES, dateOf, shortCount } from './index-model.js';
import { drawRun, drawSketch, framesFromStandard, unpackSketch } from './sketch.js';

/** The order the library's checks are listed in. Rarest and most specific leads. */
export const BADGE_RANK = ['halts', 'never-halts', 'tested', 'minimal', 'deterministic'];

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const encPath = p => String(p || '').split('/').map(encodeURIComponent).join('/');

export function rankBadges(badges) {
  return [...(badges || [])].sort((a, b) => BADGE_RANK.indexOf(a.id) - BADGE_RANK.indexOf(b.id));
}

/**
 * A Turing machine's size the way the literature writes it, states × symbols,
 * read off its standard code — one `_`-separated group per working state, three
 * characters per symbol — so a halt state drawn on the canvas is never counted
 * as a state. Null for a machine without a code.
 */
export function standardSize(code) {
  const groups = String(code || '').split('_').filter(Boolean);
  if (!groups.length || groups[0].length % 3) return null;
  return { states: groups.length, symbols: groups[0].length / 3 };
}

/** A machine in one line: its type, its size, and what it does from a blank tape. */
export function plateCaption(e) {
  const size = standardSize(e.standard);
  const b = e.behaviour;
  const parts = [e.machine, size ? `${size.states}×${size.symbols}` : `${e.stats.states} state${e.stats.states === 1 ? '' : 's'}`];
  if (b?.verdict === 'halts') parts.push(`halts in ${shortCount(b.steps)}`);
  else if (b?.verdict === 'never') parts.push('never halts');
  return parts.join(' · ');
}

/**
 * "Added 3 Sep 2026" / "Updated …" — shown on a plate when its list is ordered
 * by that date, so the order can be read off the page. A calendar date rather
 * than "3 days ago", because the website's plates are written once, at build
 * time, and a relative date would be wrong a day later.
 */
export function plateDate(e, which) {
  const t = dateOf(e?.[which]);
  if (t === null || (which !== 'added' && which !== 'updated')) return '';
  const day = new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${which === 'added' ? 'Added' : 'Updated'} ${day}`;
}

/** The frontispiece's caption, after its title: "DFA, minimal". */
export function frontispieceWhat(e) {
  return [e.machine, ...rankBadges(e.badges).filter(b => b.id === 'minimal').map(b => BADGES[b.id].label.toLowerCase())].join(', ');
}

export const FRONTIS_NOTE = 'Every figure in the library is drawn from the machine’s own file.';

/** The masthead's lede, under the statement, on both home pages. */
export const MAST_LEDE = 'Finite and ω-automata, pushdown and Turing machines, transducers — each with its diagram, its language and its formal definition, and each one click from your canvas.';

const MARK_LABEL = { tested: 'Tested', minimal: 'Minimal', deterministic: 'Deterministic' };

/** What the library checked, as words — the halting answer is already in the caption. */
export function plateMarks(e) {
  return rankBadges(e.badges).filter(b => MARK_LABEL[b.id]).map(b => ({ id: b.id, label: MARK_LABEL[b.id], say: BADGES[b.id]?.say || '' }));
}

/** The build's picture a machine too large to carry a sketch falls back on: its run, else its diagram. */
export function cardPicture(e) {
  const art = Array.isArray(e.art) ? e.art : [];
  return art.find(a => a.kind === 'spacetime') || art.find(a => a.kind === 'diagram') || art[0] || null;
}

/**
 * The one figure a machine is known by, as SVG drawn from the index: a Turing
 * machine's run when its code can be run, else its diagram. `{svg, run}`, or
 * null when the index carries nothing to draw from (then cardPicture).
 */
export function figureSvg(e, { w = 320, h = 200 } = {}) {
  const frames = e.standard && e.behaviour ? framesFromStandard(e.standard, 60) : null;
  if (frames && frames.length > 2) return { svg: drawRun(frames, { w, h }), run: true };
  const sk = unpackSketch(e.sketch);
  if (sk) return { svg: drawSketch(sk, { w, h, label: `Diagram of ${e.title}` }), run: false };
  return null;
}

/** A figure's well, as HTML. `root` is the relative path back to the site root. */
export function figureHtml(e, { root = './', w = 320, h = 200, cls = '' } = {}) {
  const f = figureSvg(e, { w, h });
  const c = ['fig', f?.run ? 'is-run' : '', cls].filter(Boolean).join(' ');
  if (f) return `<span class="${c}">${f.svg}</span>`;
  const pic = cardPicture(e);
  return `<span class="${pic?.kind === 'spacetime' ? `${c} is-run` : c}">${pic ? `<img src="${root}${encPath(pic.path)}" alt="Diagram of ${escHtml(e.title)}" loading="lazy">` : ''}</span>`;
}

/**
 * One machine on the website: its figure, its name, one line of facts, what was
 * checked. Both of its dates are written and hidden; a list ordered by one says
 * so in `data-when` and the stylesheet shows that one — the home page reorders
 * its plates without redrawing them, so the plate cannot be told which.
 */
export function plateHtml(e, { root = './' } = {}) {
  const marks = plateMarks(e);
  const when = ['added', 'updated'].map(k => plateDate(e, k) ? `<span class="plate-when" data-when="${k}">${escHtml(plateDate(e, k))}</span>` : '').join('');
  return `<a class="plate" data-family="${escHtml(e.category || 'special')}" data-id="${escHtml(e.id)}" href="${root}m/${encPath(e.id)}/">
  ${figureHtml(e, { root })}
  <span class="plate-body">
    <span class="plate-title">${escHtml(e.title)}</span>
    <span class="plate-cap"><i class="dot" aria-hidden="true"></i>${escHtml(plateCaption(e))}</span>
    ${marks.length ? `<span class="plate-marks" title="${escHtml(marks.map(m => m.say).join('\n'))}">${marks.map(m => escHtml(m.label)).join(' · ')}</span>` : ''}
    ${when}
  </span>
</a>`;
}
