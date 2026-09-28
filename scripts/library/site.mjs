// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY'S WEBSITE
// ══════════════════════════════════════════════════════════════════
// Static HTML, generated from the same index the app reads, published to
// GitHub Pages beside it. Every entry has a page of its own with a stable
// address — which is what makes a machine linkable from a course page, findable
// by a search engine and shareable with someone who has never opened the app —
// and every page's main action is "Open in AutomataStudio".
//
// It is set the way the app's Library view is (css/library.css), so the two
// read as one catalogue: Crimson Pro for the names of things and for prose,
// JetBrains Mono for data, DM Sans for controls; hairline rules, and boxes for
// figures only. Every figure is drawn here, at build time, by the app's own
// js/library/sketch.js, and inked by the stylesheet from the reader's light or
// dark scheme — the plates are the app's plates (card-html.js plateHtml).
//
// The pages are complete without JavaScript. The one script is the home page's
// search and refine, which imports js/library/index-model.js — copied beside
// it — so the website's search and the app's are one implementation. It does
// not draw: every plate is already on the page, and a search reorders them.
//
// `listings` (from build.mjs) carries what only the machine's file can say —
// its diagram with names and labels, its formal definition, its examples
// decided, the author's notes. Without it a page draws from the index alone.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_WEB_URL, protocolLink, repoUrl, sourceUrl, webAppLink } from '../../js/library/config.js';
import { BADGES, DIFFICULTIES, LIBRARY_FAMILIES, SORTS, libraryFacets, pickFrontispiece, recentEntries, remixAncestry, sameLanguageAs, wasUpdated } from '../../js/library/index-model.js';
import { LIBRARY_LICENSES } from '../../js/library/analyze.js';
import { bbchallengeUrl } from '../../js/interop/standard-tm.js';
import { FRONTIS_NOTE, MAST_LEDE, cardPicture, figureHtml, frontispieceWhat, plateHtml, rankBadges, standardSize } from '../../js/library/card-html.js';
import { drawLanguage, drawRun, drawSketch, framesFromStandard, languageRows, sketchAspect, unpackSketch } from '../../js/library/sketch.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Markup ────────────────────────────────────────────────────────

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const enc = id => id.split('/').map(encodeURIComponent).join('/');

/** Relative path from a page at `depth` directories deep back to the site root. */
const up = depth => (depth ? '../'.repeat(depth) : './');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const familyLabel = id => LIBRARY_FAMILIES.find(f => f.id === id)?.label || 'Other';
const count = n => Number(n).toLocaleString('en-US');

function dateSay(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
}

// The app's brand mark (#logo-mark in index.html), inline: four states in a
// diamond, one edge and its target in the accent. The strokes take
// currentColor and the accent pair var(--accent) in a style declaration, as in
// the app, so the mark follows the page's light or dark scheme. The tab icon is
// the app's own file, svgs/favicon.svg, copied into assets/.
const MARK = '<svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><g stroke-width="6" stroke-linecap="round"><line x1="50" y1="16" x2="16" y2="50" stroke="currentColor"/><line x1="50" y1="16" x2="84" y2="50" stroke="currentColor"/><line x1="16" y1="50" x2="50" y2="84" stroke="currentColor"/><line x1="84" y1="50" x2="50" y2="84" style="stroke: var(--accent)"/></g><circle cx="50" cy="16" r="11" fill="currentColor"/><circle cx="16" cy="50" r="11" fill="currentColor"/><circle cx="50" cy="84" r="11" fill="currentColor"/><circle cx="84" cy="50" r="11" style="fill: var(--accent)"/></svg>';

// ── The light/dark switch ──
// The reader's choice is kept in localStorage; until they make one the page
// follows the system, live. THEME_HEAD runs in <head> so the right scheme is
// on the first paint (no flash of the other one); it always writes data-theme,
// which is what the stylesheet and the switch's icon read. Storage can be
// refused (a private window, blocked site data), so every access is guarded
// and the page still follows the system without it.
const THEME_KEY = 'automata-library-theme';
export const THEME_HEAD = `<script>(function(){var d=document.documentElement,t=null;d.classList.add('js');try{t=localStorage.getItem('${THEME_KEY}')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t})()</script>`;
export const THEME_TOGGLE = '<button type="button" class="theme-toggle" aria-label="Switch theme"><svg class="to-light" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg><svg class="to-dark" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></button>';
export const THEME_SCRIPT = `<script>(function(){var d=document.documentElement,b=document.querySelector('.theme-toggle'),K='${THEME_KEY}';if(!b)return;var mq=matchMedia('(prefers-color-scheme: dark)');function chosen(){try{return localStorage.getItem(K)}catch(e){return null}}function say(){var to=d.dataset.theme==='dark'?'light':'dark';b.setAttribute('aria-label','Switch to the '+to+' theme');b.title='Switch to the '+to+' theme'}say();b.addEventListener('click',function(){var t=d.dataset.theme==='dark'?'light':'dark';d.dataset.theme=t;try{localStorage.setItem(K,t)}catch(e){}say()});mq.addEventListener('change',function(e){if(chosen())return;d.dataset.theme=e.matches?'dark':'light';say()})})()</script>`;

/** The app's lockup — mark and wordmark — with the library's name beside it. */
export function brandHtml(href, sub = 'Library') {
  return `<a class="brand" href="${esc(href)}">${MARK}<span class="logo">Automata<em>Studio</em></span><span class="brand-sub">${esc(sub)}</span></a>`;
}
const GLASS = '<svg class="searchbar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 L21 21"/></svg>';
const EMPTY_ART = '<svg class="empty-art" viewBox="0 0 120 64" aria-hidden="true"><circle cx="24" cy="32" r="14"/><circle cx="24" cy="32" r="9.5"/><circle cx="96" cy="32" r="14" class="d"/><path d="M40 32 H74" class="d"/><path d="M69 26 l7 6 -7 6" class="d"/></svg>';
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist';

function layout({ title, description, depth, body, canonical, image, config, nav = '', math = false, script = '', root = up(depth) }) {
  const site = config.site;
  const here = k => (nav === k ? ' aria-current="page"' : '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${canonical !== undefined ? `<link rel="canonical" href="${esc(site + canonical)}"><meta property="og:url" content="${esc(site + canonical)}">` : ''}
${image ? `<meta property="og:image" content="${esc(site + image)}"><meta name="twitter:card" content="summary">` : ''}
<link rel="icon" type="image/svg+xml" href="${root}assets/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
${math ? `<link rel="stylesheet" href="${KATEX}/katex.min.css">
<script defer src="${KATEX}/katex.min.js"></script>
<script defer src="${KATEX}/contrib/auto-render.min.js" onload="renderMathInElement(document.body,{throwOnError:false})"></script>` : ''}
<link rel="stylesheet" href="${root}assets/site.css">
${THEME_HEAD}
</head>
<body>
<header class="top">
  <div class="top-in">
    ${brandHtml(root)}
    <nav class="top-nav" aria-label="Site">
      <a href="${root}#all"${here('browse')}>Browse</a>
      <a href="${root}collections/"${here('collections')}>Collections</a>
      <a href="${root}submit/"${here('submit')}>Submit</a>
      <a class="top-app" href="${esc(webAppLink({ action: 'browse' }))}">Open the app <span aria-hidden="true">↗</span></a>
      ${THEME_TOGGLE}
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="foot">
  <div class="foot-in">
    <p>Every mark on this site was earned by running the machine with the AutomataStudio engine. Machines are © their authors, under the licence on each page.</p>
    <p class="foot-links"><a href="${esc(repoUrl(config.repo))}">Source on GitHub</a><span aria-hidden="true">·</span><a href="${root}index.json">index.json</a><span aria-hidden="true">·</span><a href="${esc(APP_WEB_URL)}">AutomataStudio</a></p>
  </div>
</footer>
${THEME_SCRIPT}
${script}
</body>
</html>
`;
}

// ── Pieces every page uses ────────────────────────────────────────

const plates = (entries, depth) => entries.length
  ? `<div class="plates">${entries.map(e => plateHtml(e, { root: up(depth) })).join('\n')}</div>`
  : emptyState('Nothing here yet', 'When machines are added, they appear here.');

/** A section's heading: a title on a hairline, and what else there is to say or do. */
const sectionHead = (title, aside = '', id = '') =>
  `<div class="sechead"><h2 class="sechead-title"${id ? ` id="${id}"` : ''}>${esc(title)}</h2>${aside}</div>`;

/**
 * A titled handful of plates, with the way to the rest. `when` ('added' or
 * 'updated') shows that date on each plate, for a shelf ordered by it.
 */
function shelf(title, entries, depth, more = null, { when = '' } = {}) {
  if (!entries.length) return '';
  const list = plates(entries, depth);
  return `<section class="shelf">${sectionHead(title, more ? `<a class="textlink" href="${more.href}">${esc(more.say)} →</a>` : '')}${when ? list.replace('<div class="plates">', `<div class="plates" data-when="${when}">`) : list}</section>`;
}

function emptyState(title, body, actions = '') {
  return `<div class="empty-state">${EMPTY_ART}<strong>${esc(title)}</strong>${body ? `<span class="muted">${esc(body)}</span>` : ''}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

/** A collection as one row of a list: three of its figures, its name, what it holds. */
function collectionRow(c, byId, depth) {
  const root = up(depth);
  const strip = c.entries.slice(0, 3).map(id => byId.get(id)).filter(Boolean).map(e => figureHtml(e, { root, w: 160, h: 100 })).join('');
  return `<a class="coll" href="${root}c/${enc(c.id)}/">
  <span class="coll-strip" aria-hidden="true">${strip}</span>
  <span class="coll-text">
    <span class="coll-title">${esc(c.title)}</span>
    ${c.blurb ? `<span class="coll-blurb">${esc(c.blurb)}</span>` : ''}
    <span class="coll-meta">${plural(c.entries.length, 'machine')}${c.curator ? ` · curated by @${esc(c.curator)}` : ''}</span>
  </span>
</a>`;
}

// ── The home page: a masthead, the catalogue's index, and every machine ──

/**
 * The machine the home page opens on, drawn large with its names and labels —
 * `pickFrontispiece` (index-model.js), judged on the drawings the build made:
 * a machine is readable when its drawing carries edge labels. The build runs
 * this once and writes the answer into the index, which is how the app's
 * Discover opens on the same machine.
 */
export function frontispieceOf(index, config, listings) {
  return pickFrontispiece(index, {
    chosen: config.frontispiece,
    readable: e => /class="sk-l"/.test(listings.get(e.id)?.diagram?.svg || ''),
    drawable: e => !!listings.get(e.id)?.diagram
  });
}

function frontispieceHtml(e, listing) {
  if (!e || !listing?.diagram) return '';
  return `<figure class="frontis" data-family="${esc(e.category || 'special')}">
  <a class="frontis-link" href="m/${enc(e.id)}/" aria-label="${esc(e.title)}"><span class="fig is-frontis" style="--fig-aspect: ${listing.diagram.w} / ${listing.diagram.h}">${listing.diagram.svg}</span></a>
  <figcaption class="figcaption-text"><a class="frontis-title" href="m/${enc(e.id)}/">${esc(e.title)}</a>, ${esc(frontispieceWhat(e))}. ${FRONTIS_NOTE}</figcaption>
</figure>`;
}

function homePage(index, config, listings = new Map()) {
  const byId = new Map(index.entries.map(e => [e.id, e]));
  const frontis = frontispieceHtml(frontispieceOf(index, config, listings), listings.get(frontispieceOf(index, config, listings)?.id));

  const families = LIBRARY_FAMILIES.map(f => {
    const members = index.entries.filter(e => e.category === f.id);
    const types = [...new Set(members.map(e => e.machine))].sort((a, b) => a.localeCompare(b));
    return `<a class="family" data-family="${f.id}" href="?family=${f.id}#all">
  <span class="family-head"><i class="dot" aria-hidden="true"></i><span class="family-name">${esc(f.label)}</span><span class="family-count">${members.length}</span></span>
  <span class="family-types">${esc(types.join(' · ') || '—')}</span>
</a>`;
  }).join('');

  const featured = (index.featured || []).map(id => index.collections.find(c => c.id === id)).filter(Boolean).map(c => {
    const list = c.entries.map(x => byId.get(x)).filter(Boolean);
    return shelf(c.title, list.slice(0, 4), 0, { href: `c/${enc(c.id)}/`, say: `All ${list.length}` });
  }).join('\n');

  const recent = [
    shelf('Recently added', recentEntries(index, 'added', 4), 0, { href: '?sort=added#all', say: 'All' }, { when: 'added' }),
    shelf('Recently updated', recentEntries(index, 'updated', 4), 0, { href: '?sort=updated#all', say: 'All' }, { when: 'updated' })
  ].join('\n');
  const colls = index.collections.length
    ? `<section class="shelf">${sectionHead('Collections', `<a class="textlink" href="collections/">All ${index.collections.length} →</a>`)}<div class="colls">${index.collections.slice(0, 6).map(c => collectionRow(c, byId, 0)).join('')}</div></section>`
    : '';

  // The refine column: every facet with its count. The script composes these
  // with the typed query exactly as the app's Browse does (queryLibrary).
  const facets = libraryFacets(index.entries);
  const item = (key, value, label) => `<button type="button" class="refine-item" data-key="${key}" data-value="${esc(value)}"${key === 'family' ? ` data-family="${esc(value)}"` : ''} aria-pressed="false">${key === 'family' ? '<i class="dot" aria-hidden="true"></i>' : ''}<span class="refine-name">${esc(label)}</span><span class="refine-n">${facets[key === 'machine' ? 'machine' : key].find(([v]) => v === value)?.[1] ?? 0}</span></button>`;
  const group = (title, items) => items.length ? `<section class="refine-group"><h3 class="refine-title">${esc(title)}</h3>${items.join('')}</section>` : '';
  const refine = `<aside class="refine" aria-label="Refine">
${group('Family', facets.family.map(([id]) => item('family', id, familyLabel(id))))}
${group('Verified', facets.badge.map(([b]) => item('badge', b, BADGES[b]?.label || b)))}
${group('Type', facets.machine.map(([m]) => item('machine', m, m)))}
${group('Level', DIFFICULTIES.filter(d => facets.level.some(([x]) => x === d)).map(d => item('level', d, d[0].toUpperCase() + d.slice(1))))}
${group('Tags', facets.tag.slice(0, 14).map(([t]) => item('tag', t, t)))}
<button type="button" class="textlink refine-clear" hidden>Clear all</button>
</aside>`;

  const byTitle = [...index.entries].sort((a, b) => a.title.localeCompare(b.title));
  const body = `
<section class="mast${frontis ? ' has-frontis' : ''}">
  <div class="mast-text">
    <h1 class="display">A catalogue of automata,<br><em>tested before they’re listed.</em></h1>
    <p class="lede">${esc(MAST_LEDE)}</p>
    <label class="searchbar">${GLASS}<input id="q" class="search" type="search" placeholder="Search by name, or type:DFA · accepts:0110 · a TM code" aria-label="Search the library" autocomplete="off" spellcheck="false"></label>
    <p class="mast-meta">${plural(index.entries.length, 'machine')} · ${plural(index.collections.length, 'collection')} · <a class="textlink" href="submit/#badges">How they are checked</a></p>
  </div>
  ${frontis}
</section>
<div class="discover">
<nav class="families" aria-label="Families">${families}</nav>
${recent}
${featured}
${colls}
</div>
<section class="shelf browse" id="all">
  ${sectionHead('Every machine', `<label class="sortlabel">Sort <select id="sort" class="sort" aria-label="Sort by">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select><select id="dir" class="sort" aria-label="Order" hidden></select></label>`)}
  <div class="browse-body">
    ${refine}
    <div class="results">
      <p class="count" id="count" aria-live="polite">${plural(index.entries.length, 'machine')}</p>
      ${byTitle.length ? `<div class="plates" id="results">${byTitle.map(e => plateHtml(e, { root: './' })).join('\n')}</div>` : emptyState('Nothing here yet', 'When machines are added, they appear here.')}
      <div class="showmore" id="showmore" hidden><button type="button" class="btn" id="more">Show more</button><span class="showmore-note" id="shown"></span></div>
      <div id="empty" hidden>${emptyState('No machine matches', 'Try fewer words or clear a filter — or build it and submit it, and it will be the first.', '<a class="btn" href="submit/">Submit a machine</a>')}</div>
    </div>
  </div>
</section>`;
  return layout({
    title: 'AutomataStudio Library', description: 'A catalogue of automata, Turing machines and transducers for AutomataStudio, each one tested before it is listed.',
    depth: 0, body, canonical: '', config, script: '<script type="module" src="assets/site.js"></script>'
  });
}

// ── A listing ─────────────────────────────────────────────────────

const METHOD_LABEL = {
  simulation: 'run to its halt',
  cycler: 'a configuration repeats exactly (a cycler)',
  translated: 'the run repeats, shifted along fresh tape (a translated cycler)',
  backward: 'backward reasoning — no halting configuration is reachable'
};

/**
 * The figure: the diagram, and the language beside it when there is one. The
 * switch between them is two radio buttons and a stylesheet, so it works with
 * scripts off.
 */
function entryStage(e, listing, root) {
  const sk = unpackSketch(e.sketch);
  const named = listing?.diagram;
  const H = named?.h || (sk ? Math.round(640 / sketchAspect(sk)) : 400);
  const pictures = [];
  const diagram = named?.svg || (sk ? drawSketch(sk, { w: 640, h: H, label: `Diagram of ${e.title}` }) : null);
  if (diagram) pictures.push({ kind: 'diagram', label: 'Diagram', svg: diagram, say: `The machine as drawn — ${plural(e.stats.states, 'state')}, ${plural(e.stats.transitions, 'transition')}.` });
  else {
    const pic = cardPicture(e);
    if (pic) pictures.push({ kind: 'diagram', label: 'Diagram', svg: `<img src="${root}${enc(pic.path)}" alt="Diagram of ${esc(e.title)}">`, say: `The machine as drawn — ${plural(e.stats.states, 'state')}, ${plural(e.stats.transitions, 'transition')}.` });
  }
  const rows = languageRows(e.dfa);
  if (rows) pictures.push({ kind: 'language', label: 'Language', svg: drawLanguage(rows, { w: 640, h: H }), say: `Every word up to length ${rows.length - 1}, one row per length in shortlex order, inked where it is accepted.` });
  if (!pictures.length) return '';
  const switched = pictures.length > 1;
  return `<figure class="stage${switched ? ' has-switch' : ''}">
  ${switched ? pictures.map((p, i) => `<input class="pic-radio" type="radio" name="pic" id="pic-${p.kind}" aria-label="${p.label}"${i ? '' : ' checked'}>`).join('') : ''}
  <div class="stage-frame" style="--fig-aspect: 640 / ${H}">
    ${pictures.map(p => `<div class="fig is-stage pic-${p.kind}${p.kind === 'language' ? ' is-lang' : ''}">${p.svg}</div>`).join('\n    ')}
  </div>
  <figcaption class="figcaption">
    <span class="figcaption-texts">${pictures.map(p => `<span class="figcaption-text pic-${p.kind}">${esc(p.say)}</span>`).join('')}</span>
    ${switched ? `<span class="figswitch">${pictures.map(p => `<label for="pic-${p.kind}" class="figswitch-btn">${p.label}</label>`).join('')}</span>` : ''}
  </figcaption>
</figure>`;
}

/** The author's examples, decided by the machine when the site was built. */
function examplesHtml(listing) {
  const rows = listing?.examples || [];
  if (!rows.length) return '';
  const chip = r => {
    const w = r.w === '' ? 'ε' : r.w;
    const cls = r.verdict === 'acc' ? 'is-acc' : r.verdict === 'rej' ? 'is-rej' : 'is-unk';
    const v = r.verdict === 'acc' ? 'accept' : r.verdict === 'rej' ? 'reject' : 'no verdict';
    return `<span class="verdict ${cls}"${r.label ? ` title="${esc(r.label)}"` : ''}>${esc(w)} → ${v}${r.output ? ` · ${esc(r.output)}` : ''}</span>`;
  };
  return `<section class="examples"><h3 class="aside-title">The author’s examples, run</h3><div class="chips">${rows.map(chip).join('')}</div></section>`;
}

function behaviourHtml(e, listing) {
  const b = e.behaviour;
  let say;
  if (!b) say = '';
  else if (b.verdict === 'halts') say = `Halts from a blank tape after <strong>${count(b.steps)}</strong> steps${b.ones !== undefined ? `, leaving ${count(b.ones)} non-blank cells` : ''}.`;
  else if (b.verdict === 'never') say = `Never halts from a blank tape. Proven: ${esc(METHOD_LABEL[b.method] || b.method)}${b.period ? `, period ${esc(b.period)}` : ''}.`;
  else say = 'Whether it halts from a blank tape was not settled within the library’s step budget.';
  const frames = e.standard ? framesFromStandard(e.standard, 90) : listing?.runFrames;
  const fig = frames?.length
    ? `<figure class="behaviour-fig"><div class="fig is-run">${drawRun(frames, { w: 360, h: 240 })}</div><figcaption class="figcaption-text">The first steps from a blank tape: one row per step, time running down; the outlined cell is the head.</figcaption></figure>`
    : '';
  const standard = e.standard
    ? `<div class="standard"><span class="aside-title">Standard format</span><code class="code-text">${esc(e.standard)}</code><a class="textlink" href="${esc(bbchallengeUrl(e.standard, { halts: b?.verdict === 'halts' }))}">View on bbchallenge.org ↗</a></div>`
    : '';
  return `<section class="shelf">${sectionHead('Behaviour')}<div class="behaviour-body${fig ? '' : ' is-text'}">${fig}<div class="behaviour-text">${say ? `<p class="behaviour-say">${say}</p>` : ''}${standard}</div></div></section>`;
}

function relatedHtml(e, index, depth) {
  const root = up(depth);
  const byId = new Map(index.entries.map(x => [x.id, x]));
  const ancestry = remixAncestry(index, e.id);
  const kids = e.remixes.map(r => byId.get(r)).filter(Boolean);
  const same = sameLanguageAs(index, e.fingerprint, e.id);
  if (!ancestry.length && !kids.length && !same.length) return '';
  return `<section class="shelf related">${sectionHead('Related')}
${ancestry.length ? `<p class="tree-line">Remixed from ${[...ancestry].reverse().map(a => `<a class="textlink" href="${root}m/${enc(a.id)}/">${esc(a.title)}</a>`).join(' → ')} → <strong>${esc(e.title)}</strong></p>` : ''}
${kids.length ? `<h3 class="aside-title">Remixes of this machine</h3>${plates(kids, depth)}` : ''}
${same.length ? `<h3 class="aside-title">The same language, drawn differently</h3>${plates(same, depth)}` : ''}
</section>`;
}

function entryPage(e, index, config, listing) {
  const depth = 1 + e.id.split('/').length;
  const root = up(depth);
  const req = { action: 'open', id: e.id };
  const byId = new Map(index.entries.map(x => [x.id, x]));

  const byline = [];
  if (e.author.login) byline.push(`<a class="author" href="${root}?q=${encodeURIComponent('by:' + e.author.login)}#all" title="Everything by @${esc(e.author.login)}">${esc(e.author.name ? `${e.author.name} (@${e.author.login})` : '@' + e.author.login)}</a>`);
  byline.push(`version ${e.version}`);
  if (LIBRARY_LICENSES[e.license]) byline.push(esc(e.license.replace(/-/g, ' ')));
  if (e.added) byline.push(`added ${dateSay(e.added)}`);
  if (wasUpdated(e)) byline.push(`updated ${dateSay(e.updated)}`);

  const facts = [
    ['Size', `${plural(e.stats.states, 'state')} · ${plural(e.stats.transitions, 'transition')}${e.stats.tapes > 1 ? ` · ${e.stats.tapes} tapes` : ''}${e.stats.blocks ? ` · ${plural(e.stats.blocks, 'block')}` : ''}`],
    e.difficulty ? ['Level', e.difficulty[0].toUpperCase() + e.difficulty.slice(1)] : null,
    e.chapter ? ['Source', e.chapter] : null,
    ['Licence', LIBRARY_LICENSES[e.license] || e.license || '—']
  ].filter(Boolean);
  const factsHtml = `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}${e.tags.length ? `<dt>Tags</dt><dd>${e.tags.map(t => `<a class="tag" href="${root}?tag=${encodeURIComponent(t)}#all">${esc(t)}</a>`).join('')}</dd>` : ''}</dl>`;

  const ranked = rankBadges(e.badges);
  const verified = ranked.length
    ? `<section class="aside-sec"><h2 class="aside-title">Verified by the library</h2><ul class="verified">${ranked.map(b => `<li class="is-${esc(b.id)}" title="${esc(BADGES[b.id].say)}"><span class="verified-mark" aria-hidden="true">${b.id === 'never-halts' ? '∞' : '✓'}</span><span><strong>${esc(BADGES[b.id].label)}</strong>${b.detail ? `<span class="verified-detail"> — ${esc(b.detail)}</span>` : ''}</span></li>`).join('')}</ul></section>`
    : '';
  const definition = listing?.latex ? `<section class="aside-sec"><h2 class="aside-title">Definition</h2><div class="math">${esc(listing.latex)}</div></section>` : '';
  const notes = String(listing?.readme || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const dup = e.duplicateOf && byId.get(e.duplicateOf);
  const pic = e.art.find(a => a.kind === 'diagram') || cardPicture(e);

  const body = `
<article class="page entry" data-family="${esc(e.category || 'special')}">
  <nav class="crumbs" aria-label="Where this is"><a href="${root}">Library</a><span>/</span><a href="${root}?family=${esc(e.category)}#all">${esc(familyLabel(e.category))}</a><span>/</span><span>${esc(e.machine)}</span></nav>
  <div class="entry-head">
    <p class="kicker"><i class="dot" aria-hidden="true"></i>${esc([e.machine, e.languageClass].filter(Boolean).join(' · '))}</p>
    <h1 class="display entry-title">${esc(e.title)}</h1>
    <p class="byline">${byline.join('<span class="sep">·</span>')}</p>
    ${e.blurb ? `<p class="lede">${esc(e.blurb)}</p>` : ''}
    <div class="actions">
      <a class="btn primary" href="${esc(webAppLink(req))}">Open in AutomataStudio</a>
      <details class="more"><summary class="btn">More <span aria-hidden="true">▾</span></summary><div class="more-menu">
        <a href="${esc(protocolLink(req))}">Open in the desktop app</a>
        <a href="${root}${enc(e.path)}" download>Download the .automaton file</a>
        <a href="${esc(sourceUrl(e.path, config.repo))}">Source on GitHub</a>
      </div></details>
    </div>
  </div>
  ${dup ? `<p class="callout">Recognises the same language as <a class="textlink" href="${root}m/${enc(dup.id)}/">${esc(dup.title)}</a>, which was listed first.</p>` : ''}
  <div class="entry-body">
    <div class="entry-main">
      ${entryStage(e, listing, root)}
      ${examplesHtml(listing)}
    </div>
    <aside class="entry-aside">
      ${definition}
      ${verified}
      ${factsHtml}
    </aside>
  </div>
  ${e.behaviour || e.standard ? behaviourHtml(e, listing) : ''}
  ${notes.length ? `<section class="shelf">${sectionHead('Notes')}<div class="prose">${notes.map(p => `<p>${esc(p)}</p>`).join('')}</div></section>` : ''}
  ${relatedHtml(e, index, depth)}
</article>`;
  return layout({
    title: `${e.title} — ${e.machine} · AutomataStudio Library`,
    description: e.blurb || `A ${e.machine} with ${plural(e.stats.states, 'state')}, verified by the AutomataStudio engine.`,
    depth, body, canonical: `m/${enc(e.id)}/`, image: pic ? enc(pic.path) : null, config, math: !!listing?.latex
  });
}

// ── Collections ───────────────────────────────────────────────────

function collectionsPage(index, config) {
  const byId = new Map(index.entries.map(e => [e.id, e]));
  const body = `<div class="page">
<div class="pagehead">
  <p class="kicker">Collections</p>
  <h1 class="display">Machines gathered the way a course or a question gathers them.</h1>
</div>
${index.collections.length ? `<div class="colls is-wide">${index.collections.map(c => collectionRow(c, byId, 1)).join('')}</div>` : emptyState('No collections yet', '')}
</div>`;
  return layout({ title: 'Collections · AutomataStudio Library', description: 'Curated sets of machines.', depth: 1, body, canonical: 'collections/', config, nav: 'collections' });
}

/**
 * The table a collection of Turing machines is read by: size, steps, ones and
 * the code, one row each. Drawn only when most of the collection has a halting
 * answer or a code — a table of dashes on a collection of DFAs would be noise.
 */
function behaviourTable(list, depth) {
  const tm = list.filter(e => e.behaviour || e.standard);
  if (tm.length < 2 || tm.length < list.length / 2) return '';
  const rows = tm.map(e => {
    const b = e.behaviour || {};
    const steps = b.verdict === 'halts' ? count(b.steps) : b.verdict === 'never' ? '∞' : '?';
    const size = standardSize(e.standard);
    return `<tr><td><a class="board-name" href="${up(depth)}m/${enc(e.id)}/">${esc(e.title)}</a></td><td class="mono" title="states × symbols">${size ? `${size.states} × ${size.symbols}` : ''}</td><td class="num">${steps}</td><td class="num">${b.ones !== undefined ? count(b.ones) : ''}</td><td>${e.standard ? `<code class="code-text">${esc(e.standard)}</code>` : ''}</td><td class="row-actions">${e.standard ? `<a class="textlink" href="${esc(bbchallengeUrl(e.standard, { halts: b.verdict === 'halts' }))}">bbchallenge ↗</a>` : ''}</td></tr>`;
  }).join('');
  return `<section class="shelf">${sectionHead('At a glance')}<div class="table-wrap"><table class="board"><thead><tr><th>Machine</th><th>Size</th><th class="num">Steps</th><th class="num">Non-blank</th><th>Standard format</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function collectionPage(c, index, config) {
  const depth = 1 + c.id.split('/').length;
  const byId = new Map(index.entries.map(e => [e.id, e]));
  const list = c.entries.map(id => byId.get(id)).filter(Boolean);
  const req = { action: 'collection', id: c.id };
  const body = `<div class="page">
<nav class="crumbs"><a href="${up(depth)}collections/">Collections</a><span>/</span></nav>
<div class="pagehead">
  <p class="kicker">Collection · ${plural(list.length, 'machine')}${c.curator ? ` · curated by @${esc(c.curator)}` : ''}</p>
  <h1 class="display">${esc(c.title)}</h1>
  ${c.blurb ? `<p class="lede">${esc(c.blurb)}</p>` : ''}
  <div class="actions"><a class="btn primary" href="${esc(webAppLink(req))}">Open in AutomataStudio</a><a class="btn" href="${esc(protocolLink(req))}" title="Needs the desktop app installed">Open in the desktop app</a></div>
</div>
${behaviourTable(list, depth)}
<section class="shelf">${sectionHead('The machines')}${plates(list, depth)}</section>
</div>`;
  return layout({ title: `${c.title} · AutomataStudio Library`, description: c.blurb || c.title, depth, body, canonical: `c/${enc(c.id)}/`, config, nav: 'collections' });
}

// ── Submitting, and what the marks mean ───────────────────────────

function submitPage(config) {
  const issue = `${repoUrl(config.repo)}/issues/new?template=submit-machine.yml`;
  const body = `<div class="page">
<div class="pagehead">
  <p class="kicker">Contributing</p>
  <h1 class="display">Submit a machine</h1>
  <p class="lede">Anything you can build in AutomataStudio can be listed here. The library runs it before it is published, and the marks it earns are the ones it proved.</p>
</div>
<section class="shelf">${sectionHead('How')}
<ol class="steps">
  <li><strong>Build it</strong> in <a class="textlink" href="${esc(APP_WEB_URL)}">AutomataStudio</a>, and give it a title, a description and a few example words on its card — the examples are what earn <em>Tests pass</em>.</li>
  <li><strong>Open More ▸ Library ▸ Submit a machine.</strong> The app runs the library’s checks first, and tells you what the machine will earn and whether its language is already listed.</li>
  <li><strong>Press Submit on GitHub.</strong> It opens the submission form with everything filled in; you only have to press <em>Submit new issue</em>.</li>
  <li><strong>The library checks it again,</strong> opens a pull request and posts its report on your issue. A maintainer merges it, and it appears here and in the app.</li>
</ol>
<p class="muted">No app to hand? <a class="textlink" href="${esc(issue)}">Fill in the form yourself</a> and paste a share link or attach the <code>.automaton</code> file. Machines are published under CC BY 4.0 or CC0 — you choose — and credited to the GitHub account that submits them.</p>
</section>
<section class="shelf">${sectionHead('What the marks mean', '', 'badges')}
<dl class="facts badge-list">${Object.values(BADGES).map(b => `<dt>${esc(b.label)}</dt><dd>${esc(b.say)}</dd>`).join('')}</dl>
</section>
</div>`;
  return layout({ title: 'Submit · AutomataStudio Library', description: 'Add your machine to the library.', depth: 1, body, canonical: 'submit/', config, nav: 'submit' });
}

function notFoundPage(config) {
  const body = `<div class="page">${emptyState('There is nothing at this address', 'The machine may have moved, or the link may be mistyped.', `<a class="btn primary" href="${esc(config.site)}">Back to the library</a>`)}</div>`;
  // Pages serves this at whatever address was asked for, at any depth, so its
  // links are absolute.
  return layout({ title: 'Not found · AutomataStudio Library', description: 'Not found', depth: 0, root: config.site, body, config });
}

// ── Writing ───────────────────────────────────────────────────────

async function put(out, path, text) {
  const file = join(out, ...path.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

/**
 * `assets` are files copied into assets/ (the modules the search imports);
 * `listings` maps an entry id to what build.mjs read off its file.
 */
export async function writeSite(out, index, config, { assets = {}, listings = new Map() } = {}) {
  await put(out, 'index.html', homePage(index, config, listings));
  for (const e of index.entries) await put(out, `m/${e.id}/index.html`, entryPage(e, index, config, listings.get(e.id)));
  await put(out, 'collections/index.html', collectionsPage(index, config));
  for (const c of index.collections) await put(out, `c/${c.id}/index.html`, collectionPage(c, index, config));
  await put(out, 'submit/index.html', submitPage(config));
  await put(out, '404.html', notFoundPage(config));
  await put(out, 'assets/site.css', await readFile(join(HERE, 'site', 'site.css'), 'utf8'));
  await put(out, 'assets/site.js', await readFile(join(HERE, 'site', 'site.js'), 'utf8'));
  await put(out, 'assets/favicon.svg', await readFile(join(HERE, '../../svgs/favicon.svg'), 'utf8'));
  for (const [name, from] of Object.entries(assets)) {
    await mkdir(join(out, 'assets'), { recursive: true });
    await copyFile(from, join(out, 'assets', name));
  }
  const urls = ['', 'collections/', 'submit/',
    ...index.entries.map(e => `m/${enc(e.id)}/`), ...index.collections.map(c => `c/${enc(c.id)}/`)];
  await put(out, 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(config.site + u)}</loc></url>`).join('\n')}\n</urlset>\n`);
}
