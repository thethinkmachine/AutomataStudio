// ══════════════════════════════════════════════════════════════════
//  A LIBRARY CARD, AS HTML
// ══════════════════════════════════════════════════════════════════
// The website's card, written once for both the pages the build generates
// (scripts/library/site.mjs) and the search results the site's own script
// draws in the browser (copied beside it as assets/card-html.js). The app
// builds its cards as DOM nodes in js/library-ui.js from the same rules — the
// same picture, the same two badges in the same order, the same stat — and
// takes those rules from here.
//
// Imports only index-model.js, which is copied beside it on the website.

import { shortCount } from './index-model.js';

/** The badges a card shows first. Rarest and most specific leads. */
export const BADGE_RANK = ['halts', 'never-halts', 'tested', 'minimal', 'deterministic'];

const ICON = { tested: '✓', deterministic: '◆', minimal: '✂', halts: '■', 'never-halts': '∞' };
const LABEL = { tested: 'Tests pass', deterministic: 'Deterministic', minimal: 'Minimal', halts: 'Halts', 'never-halts': 'Never halts' };
const ART_LABEL = { spacetime: 'Run', diagram: 'Diagram', language: 'Language' };

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const encPath = p => String(p || '').split('/').map(encodeURIComponent).join('/');

export function rankBadges(badges) {
  return [...(badges || [])].sort((a, b) => BADGE_RANK.indexOf(a.id) - BADGE_RANK.indexOf(b.id));
}

export function badgeLabel(e, b) {
  if (b.id === 'halts' && Number.isFinite(e.behaviour?.steps)) return `${ICON.halts} Halts · ${shortCount(e.behaviour.steps)} steps`;
  if (b.id === 'never-halts') return `${ICON['never-halts']} Never halts${b.detail ? ` · ${b.detail}` : ''}`;
  return `${ICON[b.id] || ''} ${LABEL[b.id] || b.id}`;
}

export function cardStat(e) {
  const b = e.behaviour;
  if (b?.verdict === 'halts') return `${shortCount(b.steps)} steps`;
  if (b?.verdict === 'never') return '∞ steps';
  return `${e.stats.states} state${e.stats.states === 1 ? '' : 's'}`;
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

export function cardKicker(e) {
  const size = standardSize(e.standard);
  if (size) return `${e.machine} · ${size.states}×${size.symbols}`;
  return [e.machine, e.languageClass].filter(Boolean).join(' · ');
}

/** The one picture a card shows: a Turing machine's run, else its diagram. */
export function cardPicture(e) {
  const art = Array.isArray(e.art) ? e.art : [];
  return art.find(a => a.kind === 'spacetime') || art.find(a => a.kind === 'diagram') || art[0] || null;
}

/** One card. `root` is the relative path back to the site root. */
export function cardHtml(e, { root = './' } = {}) {
  const pic = cardPicture(e);
  const ranked = rankBadges(e.badges);
  const pills = ranked.slice(0, 2).map(b => `<span class="pill is-${escHtml(b.id)}">${escHtml(badgeLabel(e, b))}</span>`).join('')
    + (ranked.length > 2 ? `<span class="pill is-more" title="${escHtml(ranked.slice(2).map(b => LABEL[b.id]).join(' · '))}">+${ranked.length - 2}</span>` : '');
  const img = pic ? `<img class="art-img" data-kind="${escHtml(pic.kind)}" src="${root}${encPath(pic.path)}" alt="${escHtml(`${ART_LABEL[pic.kind] || pic.kind} of ${e.title}`)}" loading="lazy">` : '';
  return `<a class="card" data-family="${escHtml(e.category || 'special')}" href="${root}m/${encPath(e.id)}/">
  <span class="art">${img}</span>
  <span class="card-body">
    <span class="card-kick"><span class="card-type">${escHtml(cardKicker(e))}</span><span class="card-stat">${escHtml(cardStat(e))}</span></span>
    <span class="card-title">${escHtml(e.title)}</span>
    <span class="pills">${pills}</span>
    <span class="card-by">${e.author?.login ? `@${escHtml(e.author.login)}` : ''}</span>
  </span>
</a>`;
}
