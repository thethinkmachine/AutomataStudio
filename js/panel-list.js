// ══════════════════════════════════════════════════════════════════
//  WINDOWED PANEL LISTS
// ══════════════════════════════════════════════════════════════════
// States Q and Transitions δ draw one row per state and one per transition. On
// a 1000-state machine that is three thousand rows, each with two buttons and
// five inline handlers, rebuilt from an innerHTML string on every structural
// edit — and then walked a second time by the search filter, which set
// `style.display` on every one of them.
//
// The panel is 300px tall. Twenty of those rows are visible.
//
// So the list keeps its data and draws a window: the rows around the scroll
// position, with a spacer above and below standing in for the rest. Scrolling
// redraws the window; nothing else about the panel changes.
//
// Three things this has to get right, and they are why it is a module rather
// than a loop inside updateLPanel:
//
//   * **The filter moves to the data.** Hiding rows that were never built is
//     meaningless, so the search box filters the array and redraws.
//   * **Scroll position survives a redraw.** updateLPanel runs on every graph
//     change — including the ones a row's own buttons cause — and an innerHTML
//     write resets scrollTop, so deleting the fortieth transition used to throw
//     the reader back to the top of the list.
//   * **The pitch is measured, not assumed.** Row height comes from the theme's
//     font and the panel's padding, both of which the reader can change. It is
//     read back off the first drawn window and re-read whenever a redraw
//     produces a different one.
//
// Imports nothing. It is handed markup and hands back events; what a row *says*
// stays in render.js next to the rest of the drawing.

// Below this a full list is a handful of nodes and windowing would only add a
// scroll listener and a measurement to something already instant.
export const WINDOW_MIN_ROWS = 120;

// Rows drawn beyond each edge of the viewport, so a flick of the wheel lands on
// rows that already exist and a redraw is not visible as a flash of blank.
const OVERSCAN = 8;

// Used until a real row has been measured. Only ever wrong for one frame.
const FALLBACK_PITCH = 28;

/** hostId -> {host, items, html, text, empty, pitch, gap, start, end, onScroll} */
const lists = new Map();

function readGap(host) {
  const view = host.ownerDocument && host.ownerDocument.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return 0;
  const cs = view.getComputedStyle(host);
  const g = parseFloat(cs.rowGap || cs.gap);
  return Number.isFinite(g) ? g : 0;
}

/**
 * Declares what a list holds and how to draw one row of it.
 *
 * @param {Element} host      the scroll container
 * @param {Array} items       every row's data
 * @param {object} opts
 * @param {(item:any)=>string} opts.html   markup for one row
 * @param {(item:any)=>string} [opts.text] what the search box matches against
 * @param {string} [opts.empty]            markup when there is nothing to draw
 */
export function setListItems(host, items, opts = {}) {
  if (!host) return;
  const id = host.id || (host.id = 'lw-' + Math.random().toString(36).slice(2));
  let rec = lists.get(id);
  if (!rec) {
    rec = { host, pitch: 0, gap: 0, start: -1, end: -1, query: '' };
    rec.onScroll = () => draw(rec, false);
    if (typeof host.addEventListener === 'function') {
      host.addEventListener('scroll', rec.onScroll, { passive: true });
    }
    lists.set(id, rec);
  }
  rec.host = host;
  rec.items = items || [];
  rec.html = opts.html;
  rec.text = opts.text;
  rec.empty = opts.empty || '';
  rec.gap = readGap(host);
  rec.start = rec.end = -1;   // the window's contents changed, so force a redraw
  draw(rec, true);
}

/** The rows a windowed list is currently holding, filter included. */
export function listItems(host) {
  const rec = host && lists.get(host.id);
  return rec ? visible(rec) : [];
}

/**
 * Narrows a declared list to the rows whose text contains `query`. Redrawing
 * from the top is deliberate: a filter result is a new list, and holding the
 * old scroll offset would open it somewhere in the middle of nowhere.
 */
export function filterList(host, query) {
  const rec = host && lists.get(host.id);
  if (!rec) return 0;
  rec.query = String(query || '').toLowerCase();
  rec.start = rec.end = -1;
  if (host.scrollTop) host.scrollTop = 0;
  draw(rec, true);
  return visible(rec).length;
}

function visible(rec) {
  if (!rec.query) return rec.items;
  const q = rec.query;
  const text = rec.text || (x => String(x));
  return rec.items.filter(item => text(item).toLowerCase().includes(q));
}

function draw(rec, force) {
  const host = rec.host;
  if (!host) return;
  const rows = visible(rec);
  const n = rows.length;

  if (!n) {
    if (force || host.dataset.lwState !== 'empty') {
      host.innerHTML = rec.empty;
      host.dataset.lwState = 'empty';
      rec.start = rec.end = -1;
    }
    return;
  }

  // A short list is drawn whole, which also means no spacers and no
  // measurement — the small-machine path is exactly what it was.
  if (n <= WINDOW_MIN_ROWS) {
    if (!force && host.dataset.lwState === 'all' && rec.start === 0 && rec.end === n) return;
    const keep = host.scrollTop;
    host.innerHTML = rows.map(rec.html).join('');
    host.dataset.lwState = 'all';
    rec.start = 0; rec.end = n;
    host.scrollTop = keep;
    measure(rec);
    return;
  }

  const pitch = rec.pitch || FALLBACK_PITCH;
  const view = host.clientHeight || 320;
  const first = Math.max(0, Math.floor((host.scrollTop || 0) / pitch) - OVERSCAN);
  const last = Math.min(n, first + Math.ceil(view / pitch) + OVERSCAN * 2);
  if (!force && first === rec.start && last === rec.end && host.dataset.lwState === 'win') return;

  // The spacers stand in for the rows outside the window. `gap` is subtracted
  // because the flex gap adds one more between a spacer and the row next to it —
  // without that the list grows by one gap per page and the scrollbar drifts
  // away from the content it is supposed to be indexing.
  const before = Math.max(0, first * pitch - rec.gap);
  const after = Math.max(0, (n - last) * pitch - rec.gap);
  const keep = host.scrollTop;
  host.innerHTML =
    (first > 0 ? '<div class="lw-pad" style="height:' + before + 'px;flex:0 0 auto"></div>' : '') +
    rows.slice(first, last).map(rec.html).join('') +
    (last < n ? '<div class="lw-pad" style="height:' + after + 'px;flex:0 0 auto"></div>' : '');
  host.dataset.lwState = 'win';
  rec.start = first; rec.end = last;
  host.scrollTop = keep;
  measure(rec);
}

// Pitch is row height plus the flex gap, taken from two consecutive drawn rows
// so it needs no knowledge of either. A changed pitch invalidates the window it
// was measured in, so the next draw reslices against the real number.
function measure(rec) {
  const host = rec.host;
  const kids = [];
  for (const el of host.children || []) {
    if (el.classList && el.classList.contains('lw-pad')) continue;
    kids.push(el);
    if (kids.length === 2) break;
  }
  if (!kids.length) return;
  let pitch = 0;
  if (kids.length === 2 && Number.isFinite(kids[1].offsetTop) && Number.isFinite(kids[0].offsetTop)) {
    pitch = kids[1].offsetTop - kids[0].offsetTop;
  }
  if (!(pitch > 0)) {
    const h = kids[0].offsetHeight || 0;
    pitch = h ? h + rec.gap : 0;
  }
  if (pitch > 0 && Math.abs(pitch - rec.pitch) > 0.5) {
    rec.pitch = pitch;
    rec.start = rec.end = -1;
  }
}

/** Tests reset module singletons; a stale host would keep a detached listener. */
export function resetPanelLists() {
  for (const rec of lists.values()) {
    try { rec.host.removeEventListener('scroll', rec.onScroll); } catch (e) { }
  }
  lists.clear();
}
