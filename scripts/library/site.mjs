// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY'S WEBSITE
// ══════════════════════════════════════════════════════════════════
// Static HTML, generated from the same index the app reads, published to
// GitHub Pages beside it. Every entry has a page of its own with a stable
// address — which is what makes a machine linkable from a course page, findable
// by a search engine and shareable with someone who has never opened the app —
// and every page's main action is "Open in AutomataStudio".
//
// The pages are complete without JavaScript. The one script is the search on
// the home page, which imports js/library/index-model.js — copied beside it —
// so the website's search and the app's are one implementation.

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { APP_WEB_URL, protocolLink, repoUrl, sourceUrl, webAppLink } from '../../js/library/config.js';
import { BADGES, LIBRARY_FAMILIES } from '../../js/library/index-model.js';
import { LIBRARY_LICENSES } from '../../js/library/analyze.js';
import { bbchallengeUrl } from '../../js/interop/standard-tm.js';
import { cardHtml, cardPicture, rankBadges, standardSize } from '../../js/library/card-html.js';

// ── Markup ────────────────────────────────────────────────────────

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const enc = id => id.split('/').map(encodeURIComponent).join('/');

/** Relative path from a page at `depth` directories deep back to the site root. */
const up = depth => (depth ? '../'.repeat(depth) : './');

function layout({ title, description, depth, body, canonical, image, config }) {
  const root = up(depth);
  const site = config.site;
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
${canonical ? `<link rel="canonical" href="${esc(site + canonical)}"><meta property="og:url" content="${esc(site + canonical)}">` : ''}
${image ? `<meta property="og:image" content="${esc(site + image)}"><meta name="twitter:card" content="summary">` : ''}
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="11" cy="16" r="7" fill="none" stroke="#4f7cff" stroke-width="2.5"/><circle cx="23" cy="16" r="5" fill="#4f7cff"/></svg>')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${root}assets/site.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${root}"><span class="brand-mark"></span>AutomataStudio <span class="brand-sub">Library</span></a>
  <nav class="top-nav">
    <a href="${root}">Browse</a>
    <a href="${root}collections/">Collections</a>
    <a href="${root}submit/">Submit</a>
    <a class="top-app" href="${esc(webAppLink({ action: 'browse' }))}">Open the app</a>
  </nav>
</header>
<main class="wrap">
${body}
</main>
<footer class="foot">
  <p>Every badge on this site was earned by running the machine with the AutomataStudio engine. Machines are © their authors, under the licence on each page.</p>
  <p><a href="${esc(repoUrl(config.repo))}">Source on GitHub</a> · <a href="${root}index.json">index.json</a> · <a href="${esc(APP_WEB_URL)}">AutomataStudio</a></p>
</footer>
</body>
</html>
`;
}

function card(e, depth) {
  return cardHtml(e, { root: up(depth) });
}

const grid = (entries, depth) => entries.length
  ? `<div class="grid">${entries.map(e => card(e, depth)).join('\n')}</div>`
  : '<p class="empty">Nothing here yet.</p>';

function openButtons(req) {
  return `<a class="btn primary" href="${esc(webAppLink(req))}">Open in AutomataStudio</a>
<a class="btn" href="${esc(protocolLink(req))}" title="Needs the desktop app installed">Open in the desktop app</a>`;
}

// ── Pages ─────────────────────────────────────────────────────────

function homePage(index, config) {
  const byTitle = [...index.entries].sort((a, b) => a.title.localeCompare(b.title));
  const families = LIBRARY_FAMILIES.map(f => {
    const n = index.entries.filter(e => e.category === f.id).length;
    return `<button type="button" class="family" data-family="${f.id}"><i></i>${esc(f.label)} <span>${n}</span></button>`;
  }).join('');
  const body = `
<section class="hero">
  <h1>The machine library</h1>
  <p>${index.entries.length} automata, Turing machines and transducers — busy beavers, textbook constructions and everything between. Every badge was earned by running the machine.</p>
  <input id="q" class="search" type="search" placeholder="Search — busy beaver, type:DFA, accepts:0110, or paste 1RB1LB_1LA1RZ" autocomplete="off" aria-label="Search the library">
  <div class="families">${families}</div>
</section>
${(index.featured || []).map(id => index.collections.find(c => c.id === id)).filter(Boolean).map(c => `<section class="sec shelf"><h2><a href="c/${enc(c.id)}/">${esc(c.title)} →</a></h2>${grid(c.entries.map(x => index.entries.find(e => e.id === x)).filter(Boolean).slice(0, 4), 0)}</section>`).join('\n')}
<p id="count" class="muted">${index.entries.length} machines</p>
<div id="results">${grid(byTitle, 0)}</div>
<script type="module" src="assets/site.js"></script>`;
  return layout({ title: 'AutomataStudio Library', description: 'A browsable, verified library of automata, Turing machines and transducers for AutomataStudio.', depth: 0, body, canonical: '', config });
}

const METHOD_LABEL = {
  cycler: 'a configuration repeats exactly (cycler)',
  translated: 'the run repeats, shifted along fresh tape (translated cycler)',
  backward: 'backward reasoning — no halting configuration is reachable'
};

function entryPage(e, index, config) {
  const depth = 1 + e.id.split('/').length;
  const root = up(depth);
  const req = { action: 'open', id: e.id };
  const facts = [
    ['Type', e.machine + (e.languageClass ? ` — ${e.languageClass}` : '')],
    ['Size', `${e.stats.states} states · ${e.stats.transitions} transitions${e.stats.tapes > 1 ? ` · ${e.stats.tapes} tapes` : ''}`],
    e.stats.sigma.length ? ['Σ', `{ ${e.stats.sigma.join(', ')} }`] : null,
    e.difficulty ? ['Level', e.difficulty] : null,
    e.chapter ? ['Chapter', e.chapter] : null,
    ['Licence', LIBRARY_LICENSES[e.license] || e.license],
    ['Version', `${e.version}${e.updated ? ` · updated ${e.updated.slice(0, 10)}` : ''}`]
  ].filter(Boolean);
  const byId = new Map(index.entries.map(x => [x.id, x]));
  const parent = e.forkOf && byId.get(e.forkOf);
  const kids = e.remixes.map(x => byId.get(x)).filter(Boolean);
  const same = e.fingerprint ? index.entries.filter(x => x.fingerprint === e.fingerprint && x.id !== e.id) : [];
  const standard = e.standard ? `<p class="standard"><span class="kicker">Standard format</span> <code>${esc(e.standard)}</code> <a class="btn" href="${esc(bbchallengeUrl(e.standard, { halts: e.behaviour?.verdict === 'halts' }))}">View on bbchallenge.org</a></p>` : '';
  let behaviour = '';
  if (e.behaviour) {
    const b = e.behaviour;
    const run = e.art.find(a => a.kind === 'spacetime');
    const say = b.verdict === 'halts'
      ? `Halts from a blank tape after <strong>${Number(b.steps).toLocaleString('en-US')}</strong> steps${b.ones !== undefined ? `, leaving ${Number(b.ones).toLocaleString('en-US')} non-blank cells` : ''}.`
      : b.verdict === 'never'
        ? `Never halts from a blank tape — proven by ${esc(METHOD_LABEL[b.method] || b.method)}.`
        : 'Whether it halts from a blank tape was not settled within the step budget.';
    behaviour = `<section class="sec"><h2>Behaviour</h2><p>${say}</p>${standard}${run ? `<figure class="st"><img src="${root}${enc(run.path)}" alt="Space-time diagram"><figcaption class="muted">The first steps from a blank tape — one row per step, time running down.</figcaption></figure>` : ''}</section>`;
  }
  const pic = e.art.find(a => a.kind === 'diagram') || cardPicture(e);
  const ranked = rankBadges(e.badges);
  const cert = ranked.length ? `<div class="cert"><p class="cert-head">Verified by the library</p><ul>${ranked.map(b => `<li title="${esc(BADGES[b.id].say)}"><span class="cert-mark">${esc(BADGES[b.id].icon)}</span><span><strong>${esc(BADGES[b.id].label)}</strong>${b.detail ? ` — ${esc(b.detail)}` : ''}</span></li>`).join('')}</ul></div>` : '';
  const body = `
<nav class="crumbs"><a href="${root}">Library</a> / ${esc(e.id)}</nav>
<article class="entry">
  <div class="entry-head">
    <div class="stage" data-family="${esc(e.category)}"><span class="art">${pic ? `<img class="art-img" data-kind="${esc(pic.kind)}" src="${root}${enc(pic.path)}" alt="${esc(pic.kind)} of ${esc(e.title)}">` : ''}</span></div>
    <div class="entry-info" data-family="${esc(e.category)}">
      <p class="kicker"><span class="chip">${esc(e.machine)}</span> ${esc(e.languageClass)} · ${e.stats.states} state${e.stats.states === 1 ? '' : 's'}</p>
      <h1>${esc(e.title)}</h1>
      ${e.author.login ? `<a class="author" href="${root}?q=${encodeURIComponent('by:' + e.author.login)}">${esc(e.author.name ? `${e.author.name} (@${e.author.login})` : '@' + e.author.login)}</a>` : ''}
      ${e.blurb ? `<p class="blurb">${esc(e.blurb)}</p>` : ''}
      <div class="actions"><a class="btn primary" href="${esc(webAppLink(req))}">Open in AutomataStudio</a><details class="more"><summary class="btn" aria-label="More ways to get it">⋯</summary><div class="more-menu"><a href="${esc(protocolLink(req))}">Open in the desktop app</a><a href="${root}${enc(e.path)}" download>Download the .automaton file</a><a href="${esc(sourceUrl(e.path, config.repo))}">Source on GitHub</a></div></details></div>
      ${cert}
    </div>
  </div>
  ${behaviour}
  <section class="sec"><h2>About</h2><dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}${e.tags.length ? `<dt>Tags</dt><dd>${e.tags.map(t => `<a class="tag" href="${root}?q=${encodeURIComponent('tag:' + t)}">#${esc(t)}</a>`).join(' ')}</dd>` : ''}</dl></section>
  ${e.duplicateOf && byId.get(e.duplicateOf) ? `<p class="callout">Recognises the same language as <a href="${root}m/${enc(e.duplicateOf)}/">${esc(byId.get(e.duplicateOf).title)}</a>, which was listed first.</p>` : ''}
  ${parent || kids.length ? `<section class="sec"><h2>Remix tree</h2>${parent ? `<p>Remixed from <a href="${root}m/${enc(parent.id)}/">${esc(parent.title)}</a>.</p>` : ''}${kids.length ? grid(kids, depth) : ''}</section>` : ''}
  ${same.length ? `<section class="sec"><h2>Same language, different machine</h2>${grid(same, depth)}</section>` : ''}
</article>`;
  return layout({
    title: `${e.title} — ${e.machine} · AutomataStudio Library`,
    description: e.blurb || `A ${e.machine} with ${e.stats.states} states, verified by the AutomataStudio engine.`,
    depth, body, canonical: `m/${enc(e.id)}/`, image: pic ? enc(pic.path) : null, config
  });
}

function collectionsPage(index, config) {
  const body = `<h1>Collections</h1><p class="muted">Machines grouped the way a course or a question groups them.</p>
<div class="list">${index.collections.map(c => `<a class="row" href="../c/${enc(c.id)}/"><strong>${esc(c.title)}</strong><span class="muted">${c.entries.length} machine${c.entries.length === 1 ? '' : 's'}${c.curator ? ` · curated by @${esc(c.curator)}` : ''}</span></a>`).join('') || '<p class="empty">No collections yet.</p>'}</div>`;
  return layout({ title: 'Collections · AutomataStudio Library', description: 'Curated sets of machines.', depth: 1, body, canonical: 'collections/', config });
}

function collectionPage(c, index, config) {
  const depth = 1 + c.id.split('/').length;
  const byId = new Map(index.entries.map(e => [e.id, e]));
  const list = c.entries.map(id => byId.get(id)).filter(Boolean);
  const tm = list.filter(e => e.behaviour || e.standard);
  const table = tm.length >= 2 && tm.length >= list.length / 2
    ? `<section class="sec"><h2>At a glance</h2><div class="table-wrap"><table class="board"><thead><tr><th>Machine</th><th>Size</th><th>Steps</th><th>Non-blank</th><th>Standard format</th><th></th></tr></thead><tbody>${tm.map(e => {
        const b = e.behaviour || {};
        const steps = b.verdict === 'halts' ? Number(b.steps).toLocaleString('en-US') : b.verdict === 'never' ? '∞' : '?';
        const size = standardSize(e.standard);
        return `<tr><td><a href="${up(depth)}m/${enc(e.id)}/">${esc(e.title)}</a></td><td>${size ? `${size.states} × ${size.symbols}` : ''}</td><td class="num">${steps}</td><td class="num">${b.ones !== undefined ? Number(b.ones).toLocaleString('en-US') : ''}</td><td>${e.standard ? `<code>${esc(e.standard)}</code>` : ''}</td><td>${e.standard ? `<a href="${esc(bbchallengeUrl(e.standard, { halts: b.verdict === 'halts' }))}">bbchallenge</a>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div></section>`
    : '';
  const body = `<nav class="crumbs"><a href="${up(depth)}collections/">Collections</a></nav>
<h1>${esc(c.title)}</h1>${c.blurb ? `<p class="blurb">${esc(c.blurb)}</p>` : ''}
<div class="actions">${openButtons({ action: 'collection', id: c.id })}</div>
${table}
${grid(c.entries.map(id => byId.get(id)).filter(Boolean), depth)}`;
  return layout({ title: `${c.title} · AutomataStudio Library`, description: c.blurb || c.title, depth, body, canonical: `c/${enc(c.id)}/`, config });
}

function submitPage(config) {
  const issue = `${repoUrl(config.repo)}/issues/new?template=submit-machine.yml`;
  const body = `<h1>Submit a machine</h1>
<ol class="steps">
  <li>Build it in <a href="${esc(APP_WEB_URL)}">AutomataStudio</a>, and give it a title, a description and a few example words on its card — the examples are what earn the <em>Tests pass</em> badge.</li>
  <li>Open <strong>More ▸ Library ▸ Submit a machine</strong>. The app runs the library's checks on it first, tells you which badges it will earn, and whether the language is already listed.</li>
  <li>Press <strong>Submit on GitHub</strong>. It opens the submission form with everything filled in; you only have to press <em>Submit new issue</em>.</li>
  <li>The library's CI checks it again, opens a pull request and posts its report on your issue. A maintainer merges it, and it appears here and in the app.</li>
</ol>
<p>No app to hand? <a class="btn" href="${esc(issue)}">Fill in the form yourself</a> and paste a share link or attach the <code>.automaton</code> file.</p>
<p class="muted">Machines are published under CC-BY-4.0 or CC0 — you choose — and credited to the GitHub account that submits them.</p>`;
  return layout({ title: 'Submit · AutomataStudio Library', description: 'Add your machine to the library.', depth: 1, body, canonical: 'submit/', config });
}

// ── Assets ────────────────────────────────────────────────────────

const SITE_CSS = `
:root{--bg:#f7f8fb;--surface:#fff;--surface2:#eef1f6;--border:#dfe3ec;--text:#1a2233;--text2:#5b6475;--text3:#8a93a5;--accent:#3b6cf6;--accent-soft:#e8eefe;--green:#16a34a;--red:#dc2626;--gold:#b7791f;--gold-soft:#fdf6e3;--violet:#7c3aed;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--surface:#141b2d;--surface2:#1b2438;--border:#26314a;--text:#dbe3f5;--text2:#94a3c2;--text3:#64728f;--accent:#6ea0ff;--accent-soft:#18264a;--green:#4ade80;--red:#f87171;--gold:#fbbf24;--gold-soft:#2a2410;--violet:#a78bfa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 'DM Sans',system-ui,sans-serif}
a{color:var(--accent)}code,.chip,.kicker,.pop,.bi{font-family:'JetBrains Mono',ui-monospace,monospace}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:5}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:var(--text);text-decoration:none}.brand-sub{color:var(--text2);font-weight:500}
.brand-mark{width:16px;height:16px;border-radius:50%;border:3px solid var(--accent)}
.top-nav{display:flex;gap:14px;flex-wrap:wrap;align-items:center}.top-nav a{color:var(--text2);text-decoration:none;font-size:.9rem}.top-nav a:hover{color:var(--text)}
.top-app{padding:6px 12px;border-radius:8px;background:var(--accent);color:#fff!important}
.wrap{max-width:1120px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.8rem;line-height:1.2;margin:.2em 0 .4em}h2{font:500 .72rem 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin:0 0 10px}
.muted{color:var(--text2);font-size:.9rem}.empty{color:var(--text2);padding:24px;border:1px dashed var(--border);border-radius:10px;text-align:center}
.hero{padding:24px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(135deg,var(--accent-soft),var(--surface));margin-bottom:18px}
.search{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;margin:8px 0 12px}
.families{display:flex;flex-wrap:wrap;gap:8px}.family{padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;cursor:pointer}.family span{color:var(--text3);font-size:.8rem}.family.on{border-color:var(--accent);color:var(--accent)}
.kicker{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
:root{--coral:#d3631f}@media (prefers-color-scheme:dark){:root{--coral:#ff9e6b}}
[data-family]{--h:var(--accent)}[data-family=omega]{--h:var(--violet)}[data-family=mem]{--h:var(--gold)}[data-family=tm]{--h:var(--coral)}[data-family=special]{--h:var(--green)}
.art{position:relative;display:block;aspect-ratio:16/9;background:#0d1322;overflow:hidden}.art-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.art-img[data-kind=spacetime]{image-rendering:pixelated}
.card-kick{display:flex;justify-content:space-between;gap:8px;font:500 .66rem 'JetBrains Mono',monospace;letter-spacing:.04em}.card-type{color:var(--h);text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-stat{color:var(--text3);white-space:nowrap}
.pills{display:flex;flex-wrap:wrap;gap:5px}.pill{--c:var(--text2);font-size:.7rem;font-weight:500;padding:2px 8px;border-radius:999px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;color:var(--c);border:1px solid color-mix(in srgb,var(--c) 38%,transparent);background:color-mix(in srgb,var(--c) 9%,transparent)}
.pill.is-tested{--c:var(--green)}.pill.is-minimal{--c:var(--violet)}.pill.is-halts{--c:var(--accent)}.pill.is-never-halts{--c:var(--red)}
.card-by{display:flex;gap:10px;font-size:.78rem;color:var(--text2)}
.family i{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--h);margin-right:7px;vertical-align:-1px}
.card{position:relative;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden;text-decoration:none;color:var(--text);transition:border-color .18s,transform .18s,box-shadow .18s}.card::before{content:'';position:absolute;inset:0 0 auto;height:3px;background:var(--h);z-index:1}.card:hover{border-color:color-mix(in srgb,var(--h) 55%,transparent);transform:translateY(-3px);box-shadow:0 12px 28px -14px color-mix(in srgb,var(--h) 60%,transparent)}
.card-body{display:flex;flex-direction:column;gap:7px;padding:11px 14px 13px}.card-title{font-weight:600;font-size:1rem;line-height:1.25}.card-meta{font-size:.82rem;color:var(--text2)}.card-foot{display:flex;justify-content:space-between;align-items:center;min-height:20px}.pop{font-size:.72rem;color:var(--text3)}
.chip{font-size:.7rem;padding:1px 6px;border-radius:4px;background:var(--accent-soft);color:var(--accent)}
.badges{display:inline-flex;gap:3px}.bi{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:5px;border:1px solid var(--border);font-size:.7rem;color:var(--text2)}
.is-tested .mark,.bi.is-tested{color:var(--green)}.is-minimal .mark,.bi.is-minimal{color:var(--violet)}.is-halts .mark,.bi.is-halts{color:var(--accent)}.is-never-halts .mark,.bi.is-never-halts{color:var(--red)}
.crumbs{font-size:.85rem;color:var(--text2);margin-bottom:10px}
.entry-head{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr);gap:24px;align-items:start}
.author{display:inline-flex;align-items:center;gap:8px;color:var(--text2);text-decoration:none}.author img{border-radius:50%}
.blurb{font-size:1rem;max-width:70ch}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.btn{display:inline-block;padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text);text-decoration:none;font-size:.9rem}.btn:hover{border-color:var(--accent)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.stage{position:relative;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#0d1322;min-width:0}.stage::before{content:'';position:absolute;inset:0 0 auto;height:3px;background:var(--h);z-index:2}.stage .art{aspect-ratio:16/9}
.entry-info .kicker{color:var(--h)}
.more{position:relative;display:inline-block}.more summary{list-style:none;cursor:pointer}.more summary::-webkit-details-marker{display:none}.more-menu{position:absolute;z-index:5;top:calc(100% + 6px);left:0;min-width:240px;display:flex;flex-direction:column;padding:6px;border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:0 16px 40px -12px rgba(0,0,0,.45)}.more-menu a{padding:7px 10px;border-radius:6px;color:var(--text);text-decoration:none;font-size:.88rem}.more-menu a:hover{background:var(--surface2)}
.cert{border:1px solid color-mix(in srgb,var(--green) 40%,transparent);border-radius:10px;padding:12px 14px;background:linear-gradient(180deg,color-mix(in srgb,var(--green) 10%,transparent),transparent)}.cert-head{margin:0 0 8px;font:500 .66rem 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--green)}.cert ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:.88rem;color:var(--text2)}.cert li{display:grid;grid-template-columns:18px 1fr;gap:6px}.cert strong{color:var(--text)}.cert-mark{color:var(--green);text-align:center}
.sec{margin:26px 0}.badge-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.badge{display:flex;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.badge small{display:block;color:var(--text2)}.mark{flex:0 0 28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:7px;border:1px solid var(--border)}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0}.facts dt{color:var(--text3);font:.78rem 'JetBrains Mono',monospace;padding-top:2px}.facts dd{margin:0}
.tag{margin-right:6px}.callout{padding:10px 14px;border-radius:10px;background:var(--accent-soft)}
.st img{max-width:100%;image-rendering:pixelated;border:1px solid var(--border);border-radius:6px}
.list{display:flex;flex-direction:column;gap:8px}.row{display:flex;flex-direction:column;gap:2px;padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);text-decoration:none;color:var(--text)}
.board{width:100%;border-collapse:collapse}.board td,.board th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
.steps li{margin-bottom:10px}.table-wrap{overflow-x:auto}.num{text-align:right;font-family:'JetBrains Mono',monospace;white-space:nowrap}.standard{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.standard code,.board code{padding:2px 6px;border-radius:5px;background:var(--surface2);font-size:.82rem;overflow-wrap:anywhere}
.foot{border-top:1px solid var(--border);padding:18px;text-align:center;color:var(--text3);font-size:.82rem}
@media (max-width:760px){.entry-head{grid-template-columns:1fr}.top{position:static}}
`;

const SITE_JS = `// The home page's search, using the app's own query engine (index-model.js)
// and the same cards the pages were generated with (card-html.js).
import { normalizeIndex, queryLibrary } from './index-model.js';
import { cardHtml } from './card-html.js';

const q = document.getElementById('q'), out = document.getElementById('results'), count = document.getElementById('count');
let index = null, family = null;

function draw() {
  if (!index) return;
  const list = queryLibrary(index, q.value, { sort: q.value.trim() ? 'relevance' : 'title', filters: family ? { family } : {} });
  count.textContent = list.length + ' of ' + index.entries.length + ' machines';
  out.innerHTML = list.length
    ? '<div class="grid">' + list.map(e => cardHtml(e, { root: './' })).join('') + '</div>'
    : '<p class="empty">No machine matches that. Try fewer words.</p>';
  const url = new URL(location.href);
  if (q.value.trim()) url.searchParams.set('q', q.value.trim()); else url.searchParams.delete('q');
  history.replaceState(null, '', url);
}

fetch('index.json').then(r => r.json()).then(raw => {
  index = normalizeIndex(raw);
  const initial = new URL(location.href).searchParams.get('q');
  if (initial) { q.value = initial; draw(); }
});
let t = null;
q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 120); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { e.preventDefault(); q.focus(); }
});
document.querySelectorAll('.family').forEach(b => b.addEventListener('click', () => {
  family = family === b.dataset.family ? null : b.dataset.family;
  document.querySelectorAll('.family').forEach(x => x.classList.toggle('on', x.dataset.family === family));
  draw();
}));
`;

// ── Writing ───────────────────────────────────────────────────────

async function put(out, path, text) {
  const file = join(out, ...path.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

export async function writeSite(out, index, config, { assets = {} } = {}) {
  await put(out, 'index.html', homePage(index, config));
  for (const e of index.entries) await put(out, `m/${e.id}/index.html`, entryPage(e, index, config));
  await put(out, 'collections/index.html', collectionsPage(index, config));
  for (const c of index.collections) await put(out, `c/${c.id}/index.html`, collectionPage(c, index, config));
  await put(out, 'submit/index.html', submitPage(config));
  await put(out, '404.html', layout({ title: 'Not found · AutomataStudio Library', description: 'Not found', depth: 0, body: `<h1>Not here</h1><p><a href="${esc(config.site)}">Back to the library</a></p>`, config }));
  await put(out, 'assets/site.css', SITE_CSS.trim() + '\n');
  await put(out, 'assets/site.js', SITE_JS);
  for (const [name, from] of Object.entries(assets)) {
    await mkdir(join(out, 'assets'), { recursive: true });
    await copyFile(from, join(out, 'assets', name));
  }
  const urls = ['', 'collections/', 'submit/',
    ...index.entries.map(e => `m/${enc(e.id)}/`), ...index.collections.map(c => `c/${enc(c.id)}/`)];
  await put(out, 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(config.site + u)}</loc></url>`).join('\n')}\n</urlset>\n`);
}
