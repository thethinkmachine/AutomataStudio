import { defineActions } from './action-registry.js';
import { beginSelectionDrag, clearSelection, hideCanvasContextMenu, pickObject, svgPt } from './canvas.js';
import { snapshot } from './history.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { drawnEdgeEl, drawnStateEl, makeSVG, renderAll } from './render.js';
import { $, App } from './state.js';
import { getBlock } from './blocks.js';
import { nodeIdAtScope, scopeId } from './view-graph.js';
import { getState, getTransition, hideContextMenu, showContextMenu } from './states-transitions.js';
import { showStatus } from './utils.js';
import { RUN_STYLES } from './markdown.js';
import { INLINE_MARKERS, insertTable, toggleInline, toggleList } from './note-editor-text.js';
import { layoutNoteMarkdown, noteNaturalWidth } from './note-layout.js';

// ══════════════════════════════════════════════════════════════════
//  CANVAS NOTES — free or anchored comments on states/transitions
// ══════════════════════════════════════════════════════════════════
export const NOTE_WIDTH = 170;          // default/auto width when a note has never been resized
export const NOTE_MIN_W = 120;
export const NOTE_MIN_H = 54;
export const NOTE_MAX_W = 640;
export const NOTE_MAX_H = 480;
export const NOTE_PAD = 10;
export const NOTE_LINE_H = 15;
export const NOTE_MAX_CHARS = 2000;

export function newNoteId() { return 'n' + (++App.noteN); }
export function getNote(id) { return App.notes.find(n => n.id === id); }

// A note is auto-sized (grows/shrinks with its text) until the user drags its
// resize handle, at which point note.w/note.h are pinned and text wraps/clips
// to that box instead.
export function noteIsResized(note) { return note && note.w != null && note.h != null; }

export function normalizeNoteColor(color) {
  return color === 'purple' ? 'violet' : (color || 'default');
}

// ══════════════════════════════════════════════════════════════════
//  WHICH LEVEL A NOTE LIVES ON
// ══════════════════════════════════════════════════════════════════
// A note is written *somewhere* — at the top level, or inside a block a reader
// had drilled into — and until it said so it was drawn at every level at once.
// That is not a highlight bug like the ones around it; it is a note being in
// the wrong place. `note.scope` is the block it belongs to, absent for the top
// level, which is what every note written before this existed already was.
//
// **Absent means the top level, so nothing had to be added to a serializer.**
// `roundForSave` copies a note whole and rounds only the fields it names, and
// `exportWorkspaceState` is a JSON deep copy — so `scope` rides along exactly
// as `blockId` does on a state, and the field is written only when it is not
// null, which keeps a file with no blocks in it byte-identical to before.

/** The scope a note belongs to, with a block that has since gone dropped. */
export function noteScopeOf(note) {
  const id = note && note.scope;
  // Validated on read rather than invalidated: nothing announces that a block
  // record went, and a note whose block was deleted must surface at the top
  // level rather than become invisible everywhere. The same rule liveScope()
  // and blockIsIntact() follow.
  return id && getBlock(id) ? id : null;
}

/** True when a note belongs on the level currently being drawn. */
export function noteInScope(note) {
  return noteScopeOf(note) === scopeId();
}

/** The notes this level draws. */
export function visibleNotes() {
  return (App.notes || []).filter(noteInScope);
}

// ── Anchoring: a note's stored (x, y) is an absolute point when it has no
// anchors, or an offset from its anchors' centroid when it does. This way an
// anchored note rides along automatically whenever a state it's pinned to
// moves, without having to track every drag separately. ──

/**
 * Where an anchor sits, as seen from one particular level.
 *
 * **The level is the note's own, never the reader's**, and that is the whole of
 * what makes this safe. A note anchored to a state that has since been grouped
 * into a block should point at the box — that is the "one level down" case and
 * the reason any of this projects at all. But `pruneNoteAnchorsRemoving` calls
 * this to *hold a note still* while its anchors are taken away, and it runs over
 * every note at every level: resolved against whatever scope the reader happens
 * to be standing on, the same note answers two different positions and the prune
 * freezes it at the wrong one. Asking about the note's own level gives one
 * answer whoever is asking.
 *
 * Which also means no view graph is consulted: `nodeIdAtScope` walks the block
 * tree, and both a state and a block carry their own coordinates. Nothing here
 * depends on what is currently drawn.
 */
function anchorPoint(stateId, scope) {
  const nodeId = nodeIdAtScope(stateId, scope);
  // Not under this level at all, or under it directly: either way the state's
  // own position is the honest answer — the first is a note whose anchor has
  // gone somewhere else entirely, and freezing it where the state is keeps the
  // prune's bookkeeping exactly as it was.
  if (!nodeId || nodeId === stateId) {
    const s = getState(stateId);
    return s ? { x: s.x, y: s.y } : null;
  }
  const b = getBlock(nodeId);
  return b ? { x: b.x || 0, y: b.y || 0 } : null;
}

export function noteAnchorPoints(note) {
  const scope = noteScopeOf(note);
  const pts = [];
  (note.anchorStates || []).forEach(id => {
    const p = anchorPoint(id, scope);
    if (p) pts.push(p);
  });
  (note.anchorTransitions || []).forEach(id => {
    const t = getTransition(id);
    if (!t) return;
    const from = anchorPoint(t.from, scope), to = anchorPoint(t.to, scope);
    // Both ends against the same level, so an edge crossing into a block is a
    // midpoint between the state outside and the box — the line the reader can
    // actually see — rather than between one drawn node and one that is not.
    if (from && to) pts.push({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  });
  return pts;
}
export function noteAnchorCentroid(note) {
  const pts = noteAnchorPoints(note);
  if (!pts.length) return null;
  return {
    x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
    y: pts.reduce((a, p) => a + p.y, 0) / pts.length
  };
}
export function resolveNotePos(note) {
  const c = noteAnchorCentroid(note);
  return c ? { x: c.x + note.x, y: c.y + note.y } : { x: note.x, y: note.y };
}

// Computes a note's effective on-screen box: for an auto-sized note the
// width is fixed (NOTE_WIDTH) and the height grows with content; for a
// user-resized note both are pinned and content wraps/clips to fit, showing
// as many lines as fit (plus a "…" overflow marker) rather than spilling out.
export function noteBoxLayout(note) {
  if (noteIsResized(note)) {
    const w = Math.max(NOTE_MIN_W, Math.min(NOTE_MAX_W, note.w));
    const h = Math.max(NOTE_MIN_H, Math.min(NOTE_MAX_H, note.h));
    const allLines = layoutNoteText(note.text, noteCharsPerLine(w));
    const maxLines = Math.max(1, Math.floor((h - NOTE_PAD * 2) / NOTE_LINE_H));
    const overflow = allLines.length > maxLines;
    const lines = overflow ? allLines.slice(0, maxLines) : allLines;
    if (overflow && lines.length) {
      const lastRuns = lines[lines.length - 1];
      lines[lines.length - 1] = [...lastRuns, { text: ' …', ellipsis: true }];
    }
    return { w, h, lines };
  }
  // Wider than NOTE_WIDTH only for a table that needs it, and no wider than
  // a note may be resized to (js/note-layout.js, noteNaturalWidth).
  const chars = Math.max(NOTE_CHARS_PER_LINE, Math.min(noteNaturalWidth(note.text), noteCharsPerLine(NOTE_MAX_W)));
  const lines = layoutNoteText(note.text, chars);
  const w = chars === NOTE_CHARS_PER_LINE ? NOTE_WIDTH : noteWidthForChars(chars);
  const h = NOTE_PAD * 2 + lines.length * NOTE_LINE_H;
  return { w, h, lines };
}

// Lets fitToScreen / the minimap / resize-framing include note bodies in
// their world bounding box, so a free-floating note never gets scrolled out
// of view when a saved workspace is loaded.
export function includeNoteBounds(cb) {
  // The drawn ones. Fit-to-screen and a cropped export frame what is on screen,
  // and a note two levels down would otherwise pull the frame out to wherever
  // its anchors happen to sit.
  visibleNotes().forEach(note => {
    const pos = resolveNotePos(note);
    const { w, h } = noteBoxLayout(note);
    cb(pos.x - w / 2, pos.y - h / 2, pos.x + w / 2, pos.y + h / 2);
  });
}

// Drops the given state/transition ids from every note's anchors, preserving
// each note's current on-screen position (recomputed against whatever
// anchors survive, or frozen as an absolute point if none do). Must be called
// *before* the ids are actually removed from App.states/App.transitions —
// otherwise their positions can no longer be resolved.
export function pruneNoteAnchorsRemoving(removedStateIds, removedTransIds) {
  if (!App.notes || !App.notes.length) return;
  const removedS = new Set(removedStateIds), removedT = new Set(removedTransIds);
  if (!removedS.size && !removedT.size) return;
  App.notes.forEach(note => {
    const as = note.anchorStates || [], at = note.anchorTransitions || [];
    const staleS = as.some(id => removedS.has(id));
    const staleT = at.some(id => removedT.has(id));
    if (!staleS && !staleT) return;
    const pos = resolveNotePos(note);
    const keepStates = as.filter(id => !removedS.has(id));
    const keepTrans = at.filter(id => !removedT.has(id));
    note.anchorStates = keepStates;
    note.anchorTransitions = keepTrans;
    if (!keepStates.length && !keepTrans.length) {
      note.x = pos.x; note.y = pos.y;
    } else {
      const c = noteAnchorCentroid(note);
      note.x = pos.x - c.x; note.y = pos.y - c.y;
    }
  });
}

// Call this before mutating App.states/App.transitions (e.g. at the top of a
// delete handler), while the ids being removed are still resolvable.
export function pruneNoteAnchorsExcluding(removedStateIds, removedTransIds) {
  pruneNoteAnchorsRemoving(removedStateIds || [], removedTransIds || []);
}

// Safety net for paths that can't practically call the above ahead of time —
// algorithm rebuilds that wholesale-replace App.states/App.transitions, a
// hand-edited import, etc. Diffs each note's anchors against what currently
// exists. Called from renderAll() on every render, so nothing is ever left
// pointing at a dangling id; the tradeoff is that if the state is *already*
// gone by the time this runs, the note can't recover its exact prior visual
// position and instead settles at its stored offset.
export function pruneNoteAnchors() {
  if (!App.notes || !App.notes.length) return;
  const stateIds = new Set(App.states.map(s => s.id));
  const transIds = new Set(App.transitions.map(t => t.id));
  const goneStates = [], goneTrans = [];
  App.notes.forEach(note => {
    (note.anchorStates || []).forEach(id => { if (!stateIds.has(id)) goneStates.push(id); });
    (note.anchorTransitions || []).forEach(id => { if (!transIds.has(id)) goneTrans.push(id); });
  });
  pruneNoteAnchorsRemoving(goneStates, goneTrans);
}

// ── Rich text: a note is Markdown, the app's one dialect (js/markdown.js,
// markdown-it's conventions). Each line is read into styled runs — bold,
// italic, strikethrough, code — and laid out as plain SVG tspans (not
// foreignObject), so notes survive the PNG export pipeline, which rasterizes
// the SVG via drawImage(). Word-wrap operates on runs, so a style is never
// split from the text it covers. ──
export const NOTE_EMPTY_PLACEHOLDER = 'Double-click to edit';
// Derived, not hardcoded, so an auto-sized note and one resized to exactly
// NOTE_WIDTH wrap identically instead of differing by a character.
export const NOTE_CHARS_PER_LINE = noteCharsPerLine(NOTE_WIDTH);

// Full layout: a note's Markdown -> array of lines, each an array of styled
// runs, in `charsPerLine` characters (js/note-layout.js does the work: tables,
// lists, quotes and code as well as wrapped paragraphs). Blank source shows a
// placeholder run. Cached, because a drag re-lays a note out every frame and
// its text does not change during one.
const _layoutCache = new Map();
const LAYOUT_CACHE_MAX = 256;

export function layoutNoteText(text, charsPerLine) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return [[{ text: NOTE_EMPTY_PLACEHOLDER, placeholder: true }]];
  const key = `${charsPerLine}\u0000${raw}`;
  let lines = _layoutCache.get(key);
  if (!lines) {
    lines = layoutNoteMarkdown(raw, charsPerLine);
    if (_layoutCache.size >= LAYOUT_CACHE_MAX) _layoutCache.delete(_layoutCache.keys().next().value);
    _layoutCache.set(key, lines);
  }
  // Callers append to a line (the overflow mark), so each gets its own copy.
  return lines.map(line => line.slice());
}

// How many characters fit per line for a note of the given pixel width.
// Hoisted above its use in NOTE_CHARS_PER_LINE by function declaration.
export function noteWidthForChars(chars) {
  return Math.ceil(chars * 6.25 + NOTE_PAD * 2);
}

export function noteCharsPerLine(widthPx) {
  // ~ monospace 10.5px advance width, calibrated so NOTE_WIDTH yields exactly
  // the 24 chars/line that auto-sized notes have always wrapped at.
  const approxCharPx = 6.25;
  return Math.max(6, Math.floor((widthPx - NOTE_PAD * 2) / approxCharPx));
}

// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════
export function renderNotes() {
  const g = $('notes-g');
  if (!g) return;
  g.innerHTML = '';
  visibleNotes().forEach(note => renderOneNote(g, note));
}

// ── Drawing made of box characters ───────────────────────────────
// A table's borders, a rule and a quote's bar arrive from js/note-layout.js as
// box-drawing characters on the note's character grid. They are drawn as
// lines rather than as text: the webfont of JetBrains Mono carries no box
// drawing, so the browser substitutes another face whose characters are
// narrower and shorter — horizontals stopped short of the corners and
// verticals did not meet between rows. Geometry is exact whatever the font,
// joins across lines (a vertical spans the whole line), and exports as itself.
//
// The grid's pitch is JetBrains Mono's advance at the note's 10.5px: 0.6em.
export const NOTE_CHAR_ADVANCE = 6.3;

// Each box character as segments in its cell, x and y from 0 to 1: the half
// lines from the centre to each edge it reaches.
const BOX_ARMS = {
  '─': 'lr', '│': 'tb', '┌': 'rb', '┐': 'lb', '└': 'rt', '┘': 'lt',
  '├': 'tbr', '┤': 'tbl', '┬': 'lrb', '┴': 'lrt', '┼': 'lrtb'
};
const ARM = { l: [0, 0.5], r: [1, 0.5], t: [0.5, 0], b: [0.5, 1] };
const isBoxChar = ch => ch in BOX_ARMS;
// A line that carries drawing is placed on the grid run by run.
const isGridLine = runs => runs.some(r => r.rule && [...r.text].some(isBoxChar));

/** The box characters of `lines` as one path, the first line's top at `top`. */
export function noteRulePath(lines, xLeft, top) {
  const d = [];
  const pt = (x, y) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
  lines.forEach((runs, i) => {
    let col = 0;
    for (const run of runs) {
      for (const ch of run.text) {
        if (run.rule && isBoxChar(ch)) {
          const x0 = xLeft + col * NOTE_CHAR_ADVANCE, y0 = top + i * NOTE_LINE_H;
          const cx = x0 + NOTE_CHAR_ADVANCE / 2, cy = y0 + NOTE_LINE_H / 2;
          for (const arm of BOX_ARMS[ch]) {
            const [ax, ay] = ARM[arm];
            d.push(`M${pt(cx, cy)}L${pt(x0 + ax * NOTE_CHAR_ADVANCE, y0 + ay * NOTE_LINE_H)}`);
          }
        }
        col++;
      }
    }
  });
  return d.join('');
}

// Fills `textEl` with one tspan per styled run, laid out as wrapped lines.
// Shared by the initial render and the fast in-place update path. A line with
// drawing in it (a table row) has every run placed at its grid column, and its
// box characters left to noteRulePath.
export function fillNoteTextEl(textEl, lines, xLeft) {
  textEl.innerHTML = '';
  lines.forEach((runs, i) => {
    const grid = isGridLine(runs);
    let col = 0, first = true;
    const place = (tspan, at) => {
      if (grid) { tspan.__gridCol = at; tspan.setAttribute('x', xLeft + at * NOTE_CHAR_ADVANCE); }
      else if (first) tspan.setAttribute('x', xLeft);
      if (first) tspan.setAttribute('dy', i === 0 ? 0 : NOTE_LINE_H);
      first = false;
    };
    runs.forEach(run => {
      const at = col;
      col += [...run.text].length;
      // A border run is all box characters on a grid line: nothing to write.
      if (grid && run.rule && [...run.text].every(ch => isBoxChar(ch) || ch === ' ')) return;
      const tspan = makeSVG('tspan');
      tspan.textContent = run.text;
      place(tspan, at);
      if (run.bold) tspan.setAttribute('font-weight', '700');
      if (run.italic) tspan.setAttribute('font-style', 'italic');
      if (run.strike) tspan.setAttribute('text-decoration', 'line-through');
      if (run.code) tspan.classList.add('note-code');
      if (run.rule) tspan.classList.add('note-rule');
      if (run.placeholder) tspan.classList.add('note-placeholder');
      if (run.ellipsis) tspan.classList.add('note-overflow-mark');
      textEl.appendChild(tspan);
    });
    if (first && i > 0) {
      // A line that wrote nothing — blank, or all border: an empty tspan so
      // the dy-stacking stays correct.
      const tspan = makeSVG('tspan');
      tspan.textContent = '​';
      tspan.setAttribute('x', xLeft);
      tspan.setAttribute('dy', NOTE_LINE_H);
      textEl.appendChild(tspan);
    }
  });
}

export function renderOneNote(g, note) {
  const pos = resolveNotePos(note);
  const { w, h, lines } = noteBoxLayout(note);
  const x = pos.x - w / 2, y = pos.y - h / 2;

  const grp = makeSVG('g');
  grp.classList.add('note-g');
  if (App.selectedNotes.has(note.id)) grp.classList.add('sel-note');
  if (App.activeNoteId === note.id) grp.classList.add('note-link-active');
  if (noteIsResized(note)) grp.classList.add('note-resized');
  grp.setAttribute('data-note-id', note.id);
  grp.setAttribute('data-color', normalizeNoteColor(note.color));

  const anchorPts = noteAnchorPoints(note);
  grp.__geoKey = noteGeoKey(x, y, w, h, anchorPts);
  const leaders = anchorPts.map(pt => {
    const line = makeSVG('line');
    line.classList.add('note-leader');
    line.setAttribute('x1', pos.x); line.setAttribute('y1', pos.y);
    line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
    grp.appendChild(line);
    return line;
  });

  const rect = makeSVG('rect');
  rect.classList.add('note-body');
  rect.setAttribute('x', x); rect.setAttribute('y', y);
  rect.setAttribute('width', w); rect.setAttribute('height', h);
  rect.setAttribute('rx', 6);
  grp.appendChild(rect);

  // Clip text to the box so a resized-down note never lets long words bleed
  // past its border (the layout already caps line count to fit height).
  const clipId = `note-clip-${note.id}`;
  const clip = makeSVG('clipPath');
  clip.setAttribute('id', clipId);
  const clipRect = makeSVG('rect');
  clipRect.setAttribute('x', x + 1); clipRect.setAttribute('y', y + 1);
  clipRect.setAttribute('width', Math.max(0, w - 2)); clipRect.setAttribute('height', Math.max(0, h - 2));
  clipRect.setAttribute('rx', 5);
  clip.appendChild(clipRect);
  grp.appendChild(clip);

  const textEl = makeSVG('text');
  textEl.classList.add('note-text');
  textEl.setAttribute('clip-path', `url(#${clipId})`);
  fillNoteTextEl(textEl, lines, x + NOTE_PAD);
  textEl.setAttribute('x', x + NOTE_PAD);
  textEl.setAttribute('y', y + NOTE_PAD + NOTE_LINE_H * 0.72);
  grp.appendChild(textEl);

  // A table's borders, a rule, a quote's bar (see noteRulePath).
  const rulesEl = makeSVG('path');
  rulesEl.classList.add('note-rules');
  rulesEl.setAttribute('clip-path', `url(#${clipId})`);
  rulesEl.setAttribute('d', noteRulePath(lines, x + NOTE_PAD, y + NOTE_PAD));
  grp.appendChild(rulesEl);

  // Two paths, mirroring the .tarr / .tarr-hit split used for edges: a wide
  // transparent stroke catches the pointer, the thin visible one is decoration
  // only. A 1.5px stroke is far too small a target to grab on its own.
  const handleHit = makeSVG('path');
  handleHit.classList.add('note-resize-hit');
  handleHit.setAttribute('d', noteResizeHandlePath(x + w, y + h));
  handleHit.addEventListener('pointerdown', e => onNoteResizeDown(e, note.id));
  grp.appendChild(handleHit);

  const handle = makeSVG('path');
  handle.classList.add('note-resize-handle');
  handle.setAttribute('d', noteResizeHandlePath(x + w, y + h));
  grp.appendChild(handle);

  // What updateOneNoteDOM writes to on a drag frame — held rather than
  // queried, the same as a state's or an edge's __parts in render.js.
  grp.__parts = { leaders, rect, clipRect, textEl, rulesEl, handleHit, handle };

  const noteTip = 'Double-click to edit · Right-click for options · Drag corner to resize';
  grp.setAttribute('data-tip', noteTip);
  grp.setAttribute('aria-label', noteTip);

  attachNoteHandlers(grp, note);
  g.appendChild(grp);
}

// Everything a move can change about a drawn note: its box and where its
// leader lines end.
function noteGeoKey(x, y, w, h, anchorPts) {
  return `${x},${y},${w},${h}|${anchorPts.map(pt => `${pt.x},${pt.y}`).join(';')}`;
}

export function noteResizeHandlePath(cx, cy) {
  const s = 9;
  return `M ${cx - s} ${cy} L ${cx} ${cy} L ${cx} ${cy - s}`;
}

// Fast path used while dragging: reposition one note's existing DOM in place
// instead of re-rendering the whole notes layer. Pass refillText:false when the
// text can't have changed (a plain move) to skip rebuilding every tspan — that
// teardown runs on each pointermove and is pure waste while only x/y shift.
export function updateOneNoteDOM(note, { refillText = true } = {}) {
  const grp = App.domCache.notes.get(note.id) || document.querySelector(`.note-g[data-note-id="${note.id}"]`);
  if (!grp || !grp.__parts) return;
  if (!App.domCache.notes.has(note.id)) App.domCache.notes.set(note.id, grp);

  const pos = resolveNotePos(note);
  const { w, h, lines } = noteBoxLayout(note);
  const x = pos.x - w / 2, y = pos.y - h / 2;
  const anchorPts = noteAnchorPoints(note);

  // A move that left this note's box and leaders where they were writes
  // nothing. updateNotesDOM runs for every visible note on every drag frame,
  // and a note pinned nowhere near the dragged state is most of them. A refill
  // always writes: the text is what it came to change, and the key says
  // nothing about the text.
  const geoKey = noteGeoKey(x, y, w, h, anchorPts);
  if (!refillText && grp.__geoKey === geoKey) return;
  grp.__geoKey = geoKey;

  const { leaders, rect, clipRect, textEl, rulesEl, handleHit, handle } = grp.__parts;
  rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', w); rect.setAttribute('height', h);
  clipRect.setAttribute('x', x + 1); clipRect.setAttribute('y', y + 1);
  clipRect.setAttribute('width', Math.max(0, w - 2)); clipRect.setAttribute('height', Math.max(0, h - 2));
  if (refillText) {
    fillNoteTextEl(textEl, lines, x + NOTE_PAD);
  } else {
    // Only line-leading tspans carry an x — and every run of a grid line,
    // at its own column; setting it on a continuation run of ordinary text
    // would break it out of inline flow onto a column of its own.
    for (const ts of textEl.childNodes) {
      if (ts.getAttribute('x') != null) ts.setAttribute('x', x + NOTE_PAD + (ts.__gridCol || 0) * NOTE_CHAR_ADVANCE);
    }
  }
  if (rulesEl) rulesEl.setAttribute('d', noteRulePath(lines, x + NOTE_PAD, y + NOTE_PAD));
  textEl.setAttribute('x', x + NOTE_PAD);
  textEl.setAttribute('y', y + NOTE_PAD + NOTE_LINE_H * 0.72);
  for (const p of [handleHit, handle]) p.setAttribute('d', noteResizeHandlePath(x + w, y + h));
  leaders.forEach((line, i) => {
    const pt = anchorPts[i];
    if (!pt) return;
    line.setAttribute('x1', pos.x); line.setAttribute('y1', pos.y);
    line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
  });
}
// The drag path's note pass (updateFastDOM). A state moving can carry a note
// with it but cannot change what the note says, so the text is repositioned
// and never rebuilt. This was `forEach(updateOneNoteDOM)`, which passed the
// array index as the options — so `refillText` kept its default and every
// tspan of every note was torn down and rebuilt on every drag frame.
export function updateNotesDOM() {
  for (const note of visibleNotes()) updateOneNoteDOM(note, { refillText: false });
}

// ══════════════════════════════════════════════════════════════════
//  INTERACTION: drag, edit, context menu
// ══════════════════════════════════════════════════════════════════
export function attachNoteHandlers(grp, note) {
  grp.addEventListener('pointerdown', e => onNoteDown(e, note.id));
  grp.addEventListener('pointerenter', () => highlightNoteAnchors(note.id));
  grp.addEventListener('pointerleave', () => {
    if (App.activeNoteId === note.id) return;
    clearNoteAnchorHighlight();
    if (App.activeNoteId) highlightNoteAnchors(App.activeNoteId);
  });
  grp.addEventListener('dblclick', e => {
    e.stopPropagation();
    openNoteModal(note.id);
  });
  grp.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    // Right-clicking an unselected note takes it, the way it does for an edge;
    // a note already part of a larger selection keeps that selection intact.
    if (!App.selectedNotes.has(note.id)) {
      clearSelection();
      App.selectedNotes.add(note.id);
      syncNoteSelectionClasses();
    }
    App.ctxId = null;
    App.ctxEdge = null;
    App.ctxMode = 'note';
    App.ctxNoteId = note.id;
    const anchored = (note.anchorStates && note.anchorStates.length) || (note.anchorTransitions && note.anchorTransitions.length);
    const detachItem = $('ctx-note-detach');
    if (detachItem) detachItem.style.display = anchored ? '' : 'none';
    const anchorItem = $('ctx-note-anchor');
    if (anchorItem) anchorItem.classList.toggle('disabled', !(App.selectedStates.size || App.selectedTransitions.size));
    const resetSizeItem = $('ctx-note-reset-size');
    if (resetSizeItem) resetSizeItem.style.display = noteIsResized(note) ? '' : 'none';
    showContextMenu('note', e.clientX, e.clientY);
  });
}

export function clearNoteAnchorHighlight(noteId = null) {
  const noteSelector = noteId ? `.note-g[data-note-id="${noteId}"]` : '.note-g';
  document.querySelectorAll(`${noteSelector}.note-link-active`).forEach(el => el.classList.remove('note-link-active'));
  document.querySelectorAll('.sn.note-link-st, .edge-g.note-link-t').forEach(el => el.classList.remove('note-link-st', 'note-link-t'));
}

export function highlightNoteAnchors(id, pin = false) {
  const note = getNote(id);
  if (!note) return;
  clearNoteAnchorHighlight();
  if (pin) App.activeNoteId = id;

  const noteEl = App.domCache.notes.get(id) || document.querySelector(`.note-g[data-note-id="${id}"]`);
  if (noteEl && (pin || App.activeNoteId === id)) noteEl.classList.add('note-link-active');

  // The box a state is inside when it is not drawn itself — the same rule the
  // playback highlight follows. A note anchored to something in a block should
  // point at the block, not at nothing.
  (note.anchorStates || []).forEach(stateId => {
    const el = drawnStateEl(stateId);
    if (el) el.classList.add('note-link-st');
  });

  (note.anchorTransitions || []).forEach(id => {
    const el = drawnEdgeEl(id);
    if (el) el.classList.add('note-link-t');
  });
}

export function clearActiveNoteHighlight() {
  App.activeNoteId = null;
  clearNoteAnchorHighlight();
}

// Repaints .sel-note from App.selectedNotes. Notes are rebuilt wholesale by
// renderNotes, but selection also changes without a render (click, marquee),
// so it has to be writable straight onto the nodes.
export function syncNoteSelectionClasses() {
  document.querySelectorAll('.note-g').forEach(el => {
    el.classList.toggle('sel-note', App.selectedNotes.has(el.getAttribute('data-note-id')));
  });
}

export function onNoteDown(e, id) {
  if (App.spacePan) return;
  e.stopPropagation();
  if (e.button === 2) return;
  if (e.button !== 0) return;
  if (App.tool === 'del') { deleteNote(id); return; }
  if (App.tool !== 'pointer' && App.tool !== 'move') return;

  const note = getNote(id);
  if (!note) return;
  const multi = e.shiftKey || e.ctrlKey || e.metaKey;
  if (App.tool === 'move') {
    clearSelection();
    App.selectedNotes.add(id);
    syncNoteSelectionClasses();
  } else if (!pickObject(App.selectedNotes, id, multi)) {
    return;   // ctrl-click deselected it
  }
  if (!multi) highlightNoteAnchors(id, true);
  // The whole selection travels together, and the undo point is taken on the
  // first real movement — so a plain click on a note costs no history step.
  beginSelectionDrag(svgPt(e));
  // Deliberately no setPointerCapture here: move-tracking already works via
  // the document-level pointermove listener, and capturing on `wrap` would
  // retarget the resulting dblclick to it — misfiring the canvas background's
  // "empty double-click creates a state" handler instead of opening this note.
}

// Called from canvas.js's handlePointerMove: moves every selected note the
// drag captured an offset for.
export function dragSelectedNotesTo(pt) {
  const offsets = App.dragNoteOffsets;
  if (!offsets) return;
  Object.keys(offsets).forEach(id => {
    const note = getNote(id);
    if (!note) return;
    const nx = pt.x - offsets[id].x, ny = pt.y - offsets[id].y;
    const c = noteAnchorCentroid(note);
    if (c) { note.x = nx - c.x; note.y = ny - c.y; }
    else { note.x = nx; note.y = ny; }
    updateOneNoteDOM(note, { refillText: false });
  });
}

// ── Resize: drag the bottom-right handle to pin an explicit width/height.
// Once resized, a note stops auto-growing with its text and instead wraps/
// clips content to the box (see noteBoxLayout). ──
export function onNoteResizeDown(e, id) {
  if (App.spacePan) return;
  e.stopPropagation();
  e.preventDefault();
  if (e.button !== 0) return;
  const note = getNote(id);
  if (!note) return;
  const { w, h } = noteBoxLayout(note);
  snapshot();
  App.resizeNoteId = id;
  App.resizeNoteStart = { pt: svgPt(e), w, h };
}

// Called from canvas.js's handlePointerMove while App.resizeNoteId is set.
export function resizeNoteTo(e) {
  const note = getNote(App.resizeNoteId);
  const start = App.resizeNoteStart;
  if (!note || !start) return;
  const pt = svgPt(e);
  const dx = (pt.x - start.pt.x), dy = (pt.y - start.pt.y);
  note.w = Math.max(NOTE_MIN_W, Math.min(NOTE_MAX_W, start.w + dx * 2));
  note.h = Math.max(NOTE_MIN_H, Math.min(NOTE_MAX_H, start.h + dy * 2));
  updateOneNoteDOM(note);
}

export function endNoteResize() {
  App.resizeNoteId = null;
  App.resizeNoteStart = null;
}

// Drops back to auto-sizing (grows/shrinks with content again).
export function ctxResetNoteSize() {
  const id = App.ctxNoteId;
  hideContextMenu();
  const note = getNote(id);
  if (!note) return;
  snapshot();
  delete note.w; delete note.h;
  renderAll();
  showStatus('Note size reset to auto');
}

export function deleteNote(id) {
  snapshot();
  removeNotes([id]);
  renderAll();
}

// Drops notes without taking an undo point — the caller owns the snapshot,
// which is what lets Delete remove a mixed selection in one history step.
/**
 * Drops from the selection any note this level does not draw.
 *
 * Called on a scope change. Before notes had a level they were all drawn, so a
 * stale selection was at least a visible one; now Delete over a selection made
 * on the way past would take a note nobody can see. Narrow on purpose — it is
 * about the kind this change made invisible, and says nothing about the rest of
 * the selection.
 */
export function dropOffscreenNoteSelection() {
  if (!App.selectedNotes || !App.selectedNotes.size) return;
  const here = new Set(visibleNotes().map(n => n.id));
  for (const id of [...App.selectedNotes]) if (!here.has(id)) App.selectedNotes.delete(id);
}

export function removeNotes(ids) {
  const gone = new Set(ids);
  if (!gone.size) return;
  App.notes = App.notes.filter(n => !gone.has(n.id));
  gone.forEach(id => App.selectedNotes.delete(id));
  if (gone.has(App.activeNoteId)) clearActiveNoteHighlight();
}

// ══════════════════════════════════════════════════════════════════
//  CREATE
// ══════════════════════════════════════════════════════════════════
export function createNote(x, y, anchorStates = [], anchorTransitions = []) {
  snapshot();
  const id = newNoteId();
  let note;
  if (anchorStates.length || anchorTransitions.length) {
    const c = noteAnchorCentroid({ anchorStates, anchorTransitions }) || { x: 0, y: 0 };
    note = { id, text: '', color: 'yellow', anchorStates: [...anchorStates], anchorTransitions: [...anchorTransitions], x: x - c.x, y: y - c.y };
  } else {
    note = { id, text: '', color: 'yellow', anchorStates: [], anchorTransitions: [], x, y };
  }
  // Written only when it is not the top level, so a machine with no blocks in
  // it saves exactly the bytes it saved before.
  const scope = scopeId();
  if (scope) note.scope = scope;
  App.notes.push(note);
  renderAll();
  return note;
}

export function addAnchoredNote(states, transitions) {
  const c = noteAnchorCentroid({ anchorStates: states, anchorTransitions: transitions }) || { x: 0, y: 0 };
  const note = createNote(c.x + 95, c.y - 85, states, transitions);
  openNoteModal(note.id, { isNew: true });
}

// Resolves which states/transitions a new note should anchor to from a
// context-menu click: the full current selection if the clicked item is part
// of it, otherwise just the clicked item.
export function resolveNoteAnchorsForContext() {
  if (App.ctxMode === 'state' && App.ctxId) {
    if (App.selectedStates.has(App.ctxId) && (App.selectedStates.size > 1 || App.selectedTransitions.size > 0)) {
      return { states: [...App.selectedStates], transitions: [...App.selectedTransitions] };
    }
    return { states: [App.ctxId], transitions: [] };
  }
  if (App.ctxMode === 'edge' && App.ctxEdge) {
    const edgeSelected = App.ctxEdge.transitionIds.some(id => App.selectedTransitions.has(id));
    if (edgeSelected && (App.selectedStates.size > 0 || App.selectedTransitions.size > 1)) {
      return { states: [...App.selectedStates], transitions: [...App.selectedTransitions] };
    }
    return { states: [], transitions: [...App.ctxEdge.transitionIds] };
  }
  return { states: [], transitions: [] };
}

export function ctxAddNoteState() {
  const anchors = resolveNoteAnchorsForContext();
  hideContextMenu();
  addAnchoredNote(anchors.states, anchors.transitions);
}
export function ctxAddNoteEdge() {
  const anchors = resolveNoteAnchorsForContext();
  hideContextMenu();
  addAnchoredNote(anchors.states, anchors.transitions);
}
export function ctxCanvasAddNote() {
  hideCanvasContextMenu();
  const pt = App.ctxCanvasPt || { x: 0, y: 0 };
  const note = createNote(pt.x, pt.y, [], []);
  openNoteModal(note.id, { isNew: true });
}

// ══════════════════════════════════════════════════════════════════
//  CONTEXT MENU ACTIONS (note mode)
// ══════════════════════════════════════════════════════════════════
export function ctxEditNote() {
  const id = App.ctxNoteId;
  hideContextMenu();
  if (!id) return;
  openNoteModal(id);
}
export function ctxDeleteNote() {
  const id = App.ctxNoteId;
  hideContextMenu();
  if (!id) return;
  deleteNote(id);
}
export function ctxSetNoteColor(color) {
  const id = App.ctxNoteId;
  const note = getNote(id);
  hideContextMenu();
  if (!note) return;
  snapshot();
  note.color = normalizeNoteColor(color);
  renderAll();
}
export function ctxDetachNote() {
  const id = App.ctxNoteId;
  hideContextMenu();
  const note = getNote(id);
  if (!note) return;
  const pos = resolveNotePos(note);
  snapshot();
  note.anchorStates = [];
  note.anchorTransitions = [];
  note.x = pos.x; note.y = pos.y;
  renderAll();
  showStatus('Note detached');
}
export function ctxAnchorNoteToSelection() {
  const id = App.ctxNoteId;
  hideContextMenu();
  const note = getNote(id);
  if (!note) return;
  if (!App.selectedStates.size && !App.selectedTransitions.size) {
    showStatus('Select states/transitions first');
    return;
  }
  const pos = resolveNotePos(note);
  snapshot();
  note.anchorStates = [...App.selectedStates];
  note.anchorTransitions = [...App.selectedTransitions];
  const c = noteAnchorCentroid(note);
  note.x = pos.x - c.x; note.y = pos.y - c.y;
  renderAll();
  showStatus('Note anchored to selection');
}

// ══════════════════════════════════════════════════════════════════
//  EDIT MODAL
// ══════════════════════════════════════════════════════════════════
export let _noteModalColor = 'default';
let _noteModalIsNew = false;
let _noteModalCommitted = false;

// Enter inserts a newline in the note textarea; Ctrl/Cmd+Enter saves.
registerModal('note-modal', {
  submit: () => confirmNote(),
  // The editor, not the first toolbar button showOverlay would otherwise pick.
  initialFocus: '#note-text',
  onClose: () => {
    if (_noteModalIsNew && !_noteModalCommitted && App.editNoteId) {
      App.notes = App.notes.filter(n => n.id !== App.editNoteId);
      if (App.history.length) App.history.pop();
      renderAll();
    }
    App.editNoteId = null;
    _noteModalIsNew = false;
    _noteModalCommitted = false;
  }
});

export function openNoteModal(id, { isNew = false } = {}) {
  const note = getNote(id);
  if (!note) return;
  App.editNoteId = id;
  _noteModalIsNew = isNew;
  _noteModalCommitted = false;
  const editor = $('note-text');
  if (editor) {
    editor.value = note.text || '';
    editor.setAttribute('maxlength', String(NOTE_MAX_CHARS));
    // Open at the top: the caret goes where focus would otherwise scroll to.
    editor.setSelectionRange?.(0, 0);
    editor.scrollTop = 0;
  }
  _noteModalColor = normalizeNoteColor(note.color);
  setNoteModalColorUI(_noteModalColor);
  showNotePane('write');
  updateNoteCharCount();
  renderNotePreview();
  showOverlay('note-modal');
}
export function setNoteModalColorUI(color) {
  document.querySelectorAll('#note-modal .note-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}
export function setNoteModalColor(color) {
  _noteModalColor = color;
  setNoteModalColorUI(color);
  renderNotePreview();
}
export function confirmNote() {
  const note = getNote(App.editNoteId);
  if (!note) return closeModal('note-modal');
  const nextText = String($('note-text')?.value || '').replace(/\r\n?/g, '\n').slice(0, NOTE_MAX_CHARS);
  const nextColor = normalizeNoteColor(_noteModalColor);
  if (note.text !== nextText || normalizeNoteColor(note.color) !== nextColor) {
    if (!_noteModalIsNew) snapshot();
    note.text = nextText;
    note.color = nextColor;
  }
  _noteModalCommitted = true;
  closeModal('note-modal');
  renderAll();
}

// ── The editor: the Markdown in a text box, the note beside it ─────────────
// What is typed is the note's Markdown, character for character — markdown-it's
// conventions, as everywhere in the app (js/markdown.js) — and the preview is
// the note drawn by renderOneNote, the function that draws it on the canvas,
// so a table, a list or a code span looks there exactly as it will here. The
// toolbar writes syntax around the selection (js/note-editor-text.js).
//
// It used to be a rich-text box that turned its own HTML back into markup on
// save, and the two halves never agreed: Chrome's Enter made a <div> the
// serializer glued to the line before, typed asterisks came back as bold, and
// a table was neither one thing nor the other.
const NOTE_FORMATS = {
  bold: (text, a, b) => toggleInline(text, a, b, INLINE_MARKERS.bold),
  italic: (text, a, b) => toggleInline(text, a, b, INLINE_MARKERS.italic),
  strike: (text, a, b) => toggleInline(text, a, b, INLINE_MARKERS.strike),
  code: (text, a, b) => toggleInline(text, a, b, INLINE_MARKERS.code),
  bullet: (text, a, b) => toggleList(text, a, b, 'bullet'),
  numbered: (text, a, b) => toggleList(text, a, b, 'numbered'),
  table: (text, a, b) => insertTable(text, a, b)
};

export function applyNoteFormat(kind) {
  const editor = $('note-text');
  const format = NOTE_FORMATS[kind];
  if (!editor || !format) return;
  const edit = format(editor.value, editor.selectionStart, editor.selectionEnd);
  editor.focus();
  editor.setSelectionRange(edit.from, edit.to);
  // Through the box's own editing where there is one, so Ctrl+Z undoes it.
  const typed = typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.insert);
  if (!typed || editor.value.slice(edit.from, edit.from + edit.insert.length) !== edit.insert) {
    editor.setRangeText(edit.insert, edit.from, edit.to, 'end');
  }
  editor.setSelectionRange(...edit.select);
  updateNoteEditor();
}

const NOTE_SHORTCUTS = { b: 'bold', i: 'italic', e: 'code' };

export function handleNoteEditorKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const kind = NOTE_SHORTCUTS[String(e.key).toLowerCase()];
  if (!kind) return;
  e.preventDefault();
  e.stopPropagation();
  applyNoteFormat(kind);
}

export function updateNoteCharCount() {
  const editor = $('note-text');
  const counter = $('note-char-count');
  if (!editor || !counter) return;
  const len = String(editor.value || '').length;
  counter.textContent = `${len} / ${NOTE_MAX_CHARS}`;
  counter.classList.toggle('note-char-count-max', len >= NOTE_MAX_CHARS);
}

// The note as the canvas will draw it: its own renderer, into an SVG of its
// own, at the size the note will have. A frame's worth of typing is one draw.
let _previewFrame = 0;

export function renderNotePreview() {
  _previewFrame = 0;
  const host = $('note-preview');
  const note = getNote(App.editNoteId);
  if (!host || !note) return;
  const editor = $('note-text');
  const draft = {
    ...note,
    id: 'preview',
    text: editor ? String(editor.value || '') : note.text,
    color: _noteModalColor,
    anchorStates: [], anchorTransitions: [], x: 0, y: 0
  };
  const { w, h } = noteBoxLayout(draft);
  const margin = 6;
  draft.x = w / 2 + margin;
  draft.y = h / 2 + margin;
  const svg = makeSVG('svg');
  svg.classList.add('note-preview-svg');
  svg.setAttribute('viewBox', `0 0 ${w + margin * 2} ${h + margin * 2}`);
  svg.setAttribute('width', w + margin * 2);
  svg.setAttribute('height', h + margin * 2);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Preview of the note');
  const g = makeSVG('g');
  svg.appendChild(g);
  renderOneNote(g, draft);
  host.innerHTML = '';
  host.appendChild(svg);
}

export function updateNoteEditor() {
  updateNoteCharCount();
  if (typeof requestAnimationFrame !== 'function') { renderNotePreview(); return; }
  if (!_previewFrame) _previewFrame = requestAnimationFrame(renderNotePreview);
}

// A phone has room for one pane at a time; the tabs say which.
export function showNotePane(pane) {
  const editor = $('note-editor');
  if (!editor) return;
  editor.dataset.pane = pane === 'preview' ? 'preview' : 'write';
  document.querySelectorAll('#note-editor [data-pane-tab]').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.paneTab === editor.dataset.pane));
  });
  if (editor.dataset.pane === 'preview') renderNotePreview();
  else $('note-text')?.focus();
}

export function deleteNoteFromModal() {
  const id = App.editNoteId;
  if (_noteModalIsNew) { closeModal('note-modal'); return; }
  _noteModalCommitted = true;
  closeModal('note-modal');
  if (!id) return;
  deleteNote(id);
}

// What index.html names, beside the functions it runs (js/actions.js).
defineActions({
  'notes.applyNoteFormat': ({ el }) => applyNoteFormat(el.dataset.format),
  'notes.confirmNote': () => confirmNote(),
  'notes.ctxAddNoteEdge': () => ctxAddNoteEdge(),
  'notes.ctxAddNoteState': () => ctxAddNoteState(),
  'notes.ctxAnchorNoteToSelection': () => ctxAnchorNoteToSelection(),
  'notes.ctxCanvasAddNote': () => ctxCanvasAddNote(),
  'notes.ctxDeleteNote': () => ctxDeleteNote(),
  'notes.ctxDetachNote': () => ctxDetachNote(),
  'notes.ctxEditNote': () => ctxEditNote(),
  'notes.ctxResetNoteSize': () => ctxResetNoteSize(),
  'notes.ctxSetNoteColor': ({ el }) => ctxSetNoteColor(el.dataset.color),
  'notes.deleteNoteFromModal': () => deleteNoteFromModal(),
  'notes.handleNoteEditorKeydown': ({ event }) => handleNoteEditorKeydown(event),
  'notes.showNotePane': ({ el }) => showNotePane(el.dataset.paneTab),
  'notes.setNoteModalColor': ({ el }) => setNoteModalColor(el.dataset.color),
  'notes.updateNoteEditor': () => updateNoteEditor()
});
