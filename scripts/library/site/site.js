// The home page's search and refine, on the app's own query engine
// (index-model.js, copied beside this file). Every plate is already on the page,
// drawn when the site was built; a search only chooses which of them show, and
// in what order — so the results are the same pictures the pages were built with.
//
// They are shown a batch at a time, as the app's Browse shows them (BATCH is
// its BROWSE_BATCH): a new search starts again at one batch, and how many are
// out is kept in the history entry, so coming back from a listing returns to
// the same place rather than to the first batch.

import { normalizeIndex, queryLibrary, SORTS } from './index-model.js';

const $ = s => document.querySelector(s);
const q = $('#q'), grid = $('#results'), count = $('#count'), empty = $('#empty'), sort = $('#sort');
const refine = [...document.querySelectorAll('.refine-item')];
const clear = $('.refine-clear');
const KEYS = ['family', 'machine', 'badge', 'tag', 'level'];
const plates = new Map([...(grid?.querySelectorAll('.plate') || [])].map(p => [p.dataset.id, p]));
const more = $('#more'), moreRow = $('#showmore'), moreNote = $('#shown');
const BATCH = 48;
let index = null;
let filters = {};
let limit = Number(history.state?.limit) || BATCH;

function readUrl() {
  const u = new URL(location.href);
  q.value = u.searchParams.get('q') || '';
  filters = {};
  for (const k of KEYS) { const v = u.searchParams.get(k); if (v) filters[k] = v; }
  const s = u.searchParams.get('sort');
  sort.value = SORTS[s] ? s : 'relevance';
}

function writeUrl() {
  const u = new URL(location.href);
  const text = q.value.trim();
  if (text) u.searchParams.set('q', text); else u.searchParams.delete('q');
  for (const k of KEYS) { if (filters[k]) u.searchParams.set(k, filters[k]); else u.searchParams.delete(k); }
  if (sort.value !== 'relevance') u.searchParams.set('sort', sort.value); else u.searchParams.delete('sort');
  history.replaceState({ limit }, '', u);
}

function draw({ keep = false } = {}) {
  if (!index || !grid) return;
  if (!keep) limit = BATCH;
  const text = q.value.trim();
  const list = queryLibrary(index, text, { sort: sort.value, filters });
  const out = list.slice(0, limit).map(e => plates.get(e.id)).filter(Boolean);
  grid.replaceChildren(...out);
  const left = list.length - out.length;
  moreRow.hidden = left <= 0;
  more.textContent = `Show ${Math.min(BATCH, left)} more`;
  moreNote.textContent = `${out.length} of ${list.length} shown`;
  const searching = !!text || Object.keys(filters).length > 0;
  document.body.classList.toggle('is-searching', searching);
  count.textContent = searching ? `${list.length} of ${index.entries.length} machines` : `${index.entries.length} machines`;
  empty.hidden = list.length > 0;
  grid.hidden = !list.length;
  const say = empty.querySelector('strong');
  if (say) say.textContent = text ? `No machine matches “${text}”` : 'No machine matches these filters';
  for (const b of refine) {
    const on = filters[b.dataset.key] === b.dataset.value;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (clear) clear.hidden = !Object.keys(filters).length;
  writeUrl();
}

const toResults = () => $('#all')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

/** Bring the results into view: the masthead's search is above the fold, the list is not. */
function reveal() {
  const all = $('#all');
  if (all && all.getBoundingClientRect().top > innerHeight * 0.6) toResults();
}

let timer = null;
q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 120); });
q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); draw(); reveal(); } });
sort.addEventListener('change', () => draw());
more?.addEventListener('click', () => {
  const from = grid.children.length;
  limit += BATCH;
  draw({ keep: true });
  grid.children[from]?.focus();
});
for (const b of refine) {
  b.addEventListener('click', () => {
    const k = b.dataset.key, v = b.dataset.value;
    if (filters[k] === v) delete filters[k]; else filters[k] = v;
    draw();
  });
}
clear?.addEventListener('click', () => { filters = {}; draw(); });
// The families index and the shelves' "All" links point back at this page with
// a filter in the address: apply it here rather than reloading.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href^="?"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  history.replaceState(null, '', a.getAttribute('href'));
  readUrl();
  draw();
  toResults();
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { e.preventDefault(); q.focus(); }
});

readUrl();
fetch('index.json').then(r => r.json()).then(raw => {
  index = normalizeIndex(raw);
  draw({ keep: true });
}).catch(() => { /* the page still lists every machine, by title */ });
