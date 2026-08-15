import { $, App, MachineCategories, MachineTypes } from './state.js';
import { GuideOverview, MachineGuides } from './machine-guide.js';
import { ConceptCategories, ConceptGuides } from './concept-guide.js';

// ══════════════════════════════════════════════════════════════════
//  REFERENCE VIEW
// ══════════════════════════════════════════════════════════════════
//  One explainer per machine the app can build. The content lives in
//  js/machine-guide.js; this module only turns it into DOM.
//
//  The view key is `reference`; ids and classes are prefixed `ref-`.
//
//  The navigation is generated from `MachineCategories`, which is the same
//  list the model picker is built from. A machine added to js/state.js
//  therefore appears here automatically — with an empty page until a guide is
//  written for it, which is the intended nudge.
//
//  Nothing here is reached from an on* attribute, so none of it is in
//  js/bridge.js: the nav links get their listeners at creation time.

// KaTeX is a deferred CDN script, so it may not be parsed yet the first time a
// panel asks to typeset. Poll for it, but give up rather than retrying
// forever: if the CDN is blocked or offline the script never arrives, and an
// unbounded chain of setTimeouts keeps a timer alive for the life of the page.
// Five seconds is far longer than a deferred local script needs.
const MATH_RETRY_MS = 100;
const MATH_MAX_RETRIES = 50;

export function triggerMath(el, attempt = 0) {
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(el || document.body, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false},
        {left: '\\[', right: '\\]', display: true}
      ],
      throwOnError: false
    });
    return;
  }
  if (attempt >= MATH_MAX_RETRIES) return; // KaTeX is not coming; leave the source text as-is
  setTimeout(() => triggerMath(el, attempt + 1), MATH_RETRY_MS);
}

// ── The list of pages, in navigation order ────────────────────────
// Overview, then one page per machine grouped exactly as the model picker
// groups them, then the concept sections. `machine` is the machine key for the
// middle group and null for the rest, which is both what lets the view open on
// whatever is currently on the canvas and what decides whether a page shows a
// machine chip.
export function referencePages() {
  const pages = [{
    machine: null,
    group: 'Start here',
    guide: GuideOverview,
    label: GuideOverview.abbr
  }];
  MachineCategories.forEach(cat => {
    cat.machines.forEach(m => {
      const guide = MachineGuides[m];
      if (!guide) return;
      pages.push({
        machine: m,
        group: cat.label,
        guide,
        label: MachineTypes[m]?.label || m
      });
    });
  });
  ConceptCategories.forEach(cat => {
    cat.pages.forEach(slug => {
      const guide = ConceptGuides[slug];
      if (!guide) return;
      pages.push({
        machine: null,
        group: cat.label,
        guide,
        label: guide.abbr
      });
    });
  });
  return pages;
}

const sectionId = slug => `ref-sec-${slug}`;
const linkId = slug => `ref-link-${slug}`;

// ── Block rendering ───────────────────────────────────────────────
// The block kinds a guide section is built from; the constructors are in
// js/guide-blocks.js and adding one there needs a case here. Content is
// trusted static markup, so it is inserted as written — `<b>`, `<em>`,
// `<code>`, `<sup>` and `<sub>` in a guide are deliberate.
function renderBlock(block) {
  switch (block.t) {
    case 'p':
      return `<p class="ref-p">${block.x}</p>`;
    case 'ul':
      return `<ul class="ref-ul">${block.x.map(item => `<li>${item}</li>`).join('')}</ul>`;
    case 'math':
      return `<div class="ref-math">$$${block.x}$$</div>`;
    case 'note':
      return `<div class="ref-note">${block.x}</div>`;
    case 'table':
      return renderTable(block);
    default:
      return '';
  }
}

// A cell is a plain string, or {v, k} where k tags the verdict for colour.
// The first cell of every row is a header, since each table in the guides is
// keyed by class or by problem. The wrapper scrolls on its own so a wide table
// never widens the page.
function renderCell(cell, tag) {
  const v = typeof cell === 'string' ? cell : cell.v;
  const k = typeof cell === 'string' ? '' : ` class="v-${cell.k}"`;
  return `<${tag}${k}>${v}</${tag}>`;
}

function renderTable(block) {
  const head = `<tr>${block.head.map(h => `<th>${h}</th>`).join('')}</tr>`;
  const rows = block.rows
    .map(row => `<tr>${row.map((cell, i) => renderCell(cell, i === 0 ? 'th' : 'td')).join('')}</tr>`)
    .join('');
  return `<div class="ref-table-wrap"><table class="ref-table">`
    + `<thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

function renderGuide(page) {
  const g = page.guide;
  const chips = [
    page.machine ? `<span class="ref-chip mono">${page.machine}</span>` : '',
    g.klass ? `<span class="ref-chip">${g.klass}</span>` : ''
  ].join('');

  const cards = g.sections.map(section => `
<div class="ref-card" style="--accent-c:${g.accent}">
  <div class="ref-card-title">${section.h}</div>
  <div class="ref-prose">${section.blocks.map(renderBlock).join('')}</div>
</div>`).join('');

  return `
<div class="ref-section" id="${sectionId(g.slug)}" style="display:none">
  <div class="ref-section-title">${g.title}</div>
  <div class="ref-section-sub">${g.tagline}</div>
  <div class="ref-chips">${chips}</div>
  <div class="ref-grid">${cards}</div>
</div>`;
}

// ── Build ─────────────────────────────────────────────────────────
// Built once and kept. The marker lives on the container rather than in a
// module variable so that a torn-down DOM (as in the test harness) rebuilds
// itself instead of rendering into nothing.
function buildReferenceView() {
  const nav = $('ref-nav-list');
  const pages = $('ref-pages');
  if (!nav || !pages) return false;
  if (pages.dataset.refBuilt === '1') return true;

  const list = referencePages();

  let navHtml = '';
  let lastGroup = null;
  list.forEach(page => {
    if (page.group !== lastGroup) {
      navHtml += `<div class="ref-nav-group">${page.group}</div>`;
      lastGroup = page.group;
    }
    navHtml += `<a class="ref-nav-link" id="${linkId(page.guide.slug)}" `
      + `href="#${sectionId(page.guide.slug)}" data-ref-slug="${page.guide.slug}">${page.label}</a>`;
  });
  nav.innerHTML = navHtml;

  // Attached once, at creation, so they outlive nothing — the nav is never
  // rebuilt. Resolving the target from the data attribute at event time keeps
  // the handler free of per-build state.
  nav.querySelectorAll('.ref-nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      userPickedSlug = link.dataset.refSlug;
      showGuide(userPickedSlug);
    });
  });

  pages.innerHTML = list.map(renderGuide).join('');
  pages.dataset.refBuilt = '1';
  return true;
}

// ── Selection ─────────────────────────────────────────────────────
// Typesetting is deferred to first view: there are several hundred display
// formulas across the guides, and typesetting all of them on open costs far
// more than the reader of any one page ever needs.
const typeset = new Set();
let userPickedSlug = null;

export function showGuide(slug) {
  const pages = $('ref-pages');
  if (!pages) return;

  document.querySelectorAll('#ref-nav-list .ref-nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.refSlug === slug);
  });

  let shown = null;
  pages.querySelectorAll('.ref-section').forEach(sec => {
    const match = sec.id === sectionId(slug);
    sec.style.display = match ? '' : 'none';
    if (match) shown = sec;
  });

  if (shown && !typeset.has(slug)) {
    typeset.add(slug);
    triggerMath(shown);
  }

  const content = $('v-reference')?.querySelector('.algo-content');
  if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
}

// Which page to open on. Until the reader picks something, the view follows
// the canvas: opening the Reference while editing an NPDA lands on NPDA.
// After an explicit pick it stays where it was left.
function initialSlug() {
  if (userPickedSlug) return userPickedSlug;
  const guide = MachineGuides[App.machine];
  return guide ? guide.slug : GuideOverview.slug;
}

export function renderReferenceView() {
  if (!buildReferenceView()) return;
  showGuide(initialSlug());
}
