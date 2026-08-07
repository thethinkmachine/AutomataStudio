import { hideCanvasContextMenu, svgPt } from './canvas.js';
import { snapshot } from './history.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { makeSVG, renderAll } from './render.js';
import { $, App } from './state.js';
import { getState, getTransition, hideContextMenu, showContextMenu } from './states-transitions.js';
import { showStatus } from './utils.js';

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

// ── Anchoring: a note's stored (x, y) is an absolute point when it has no
// anchors, or an offset from its anchors' centroid when it does. This way an
// anchored note rides along automatically whenever a state it's pinned to
// moves, without having to track every drag separately. ──
export function noteAnchorPoints(note) {
  const pts = [];
  (note.anchorStates || []).forEach(id => {
    const s = getState(id);
    if (s) pts.push({ x: s.x, y: s.y });
  });
  (note.anchorTransitions || []).forEach(id => {
    const t = getTransition(id);
    if (!t) return;
    const from = getState(t.from), to = getState(t.to);
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
  const lines = layoutNoteText(note.text, NOTE_CHARS_PER_LINE);
  const w = NOTE_WIDTH, h = NOTE_PAD * 2 + lines.length * NOTE_LINE_H;
  return { w, h, lines };
}

// Lets fitToScreen / the minimap / resize-framing include note bodies in
// their world bounding box, so a free-floating note never gets scrolled out
// of view when a saved workspace is loaded.
export function includeNoteBounds(cb) {
  App.notes.forEach(note => {
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

// ── Rich text: a minimal inline markup (**bold**, *italic*, __underline__)
// parsed into styled runs and laid out as plain SVG tspans (not
// foreignObject), so notes survive the PNG export pipeline, which rasterizes
// the SVG via drawImage(). Word-wrap operates on run boundaries so a bold
// word never gets silently split from its markers. ──
export const NOTE_EMPTY_PLACEHOLDER = 'Double-click to edit';
// Derived, not hardcoded, so an auto-sized note and one resized to exactly
// NOTE_WIDTH wrap identically instead of differing by a character.
export const NOTE_CHARS_PER_LINE = noteCharsPerLine(NOTE_WIDTH);

// Splits raw markup text into { text, bold, italic, underline } runs, one per
// styled span, without crossing newlines (callers split on '\n' first).
// Recognizes **bold**, *italic*, __underline__ — non-greedy and non-nested.
//
// Markers must "flank" a word the way CommonMark requires: the opener sits at
// line start or after whitespace/opening punctuation, the closer at line end or
// before whitespace/closing punctuation, and the content may not begin or end
// with a space. Without that rule this markup would eat notation that shows up
// constantly in this domain — `a*b*`, `Σ*`, `(0|1)*` would silently italicize,
// and `q_start to q_end` would silently underline. Those now render literally;
// the trade-off is that markers can only wrap whole words, not word interiors.
export const NOTE_MARKUP_RE = /(^|[\s([{"'])(\*\*|__|\*)(?=\S)(.*?\S)\2(?=$|[\s)\]}"'.,;:!?])/g;
export function parseNoteRuns(line) {
  const runs = [], active = { bold: 0, italic: 0, underline: 0 };
  const markerStyles = { '**': ['bold'], '***': ['bold', 'italic'], '*': ['italic'], '__': ['underline'] };
  const markerRe = /\*{1,3}|__/g;
  let cursor = 0, match;
  const pushText = text => {
    if (!text) return;
    const prev = runs[runs.length - 1];
    const style = { bold: active.bold > 0, italic: active.italic > 0, underline: active.underline > 0 };
    if (prev && prev.bold === style.bold && prev.italic === style.italic && prev.underline === style.underline) prev.text += text;
    else runs.push({ text, ...style });
  };
  while ((match = markerRe.exec(line))) {
    const marker = match[0], styles = markerStyles[marker];
    const before = match.index ? line[match.index - 1] : '';
    const after = line[match.index + marker.length] || '';
    const leftBoundary = !before || /[\s([{"']/.test(before) || before === '*' || before === '_';
    const rightBoundary = !after || /[\s)\]}"'.,;:!?]/.test(after) || after === '*' || after === '_';
    const canClose = styles && styles.every(style => active[style] > 0) && rightBoundary;
    let closeAt = line.indexOf(marker, match.index + marker.length);
    let hasCloser = false;
    while (closeAt !== -1) {
      const closeAfter = line[closeAt + marker.length] || '';
      if (!closeAfter || /[\s)\]}"'.,;:!?]/.test(closeAfter) || closeAfter === '*' || closeAfter === '_') { hasCloser = true; break; }
      closeAt = line.indexOf(marker, closeAt + marker.length);
    }
    const canOpen = styles && leftBoundary && !/^\s$/.test(after) && hasCloser;
    if (!canClose && !canOpen) continue;
    pushText(line.slice(cursor, match.index));
    styles.forEach(style => { active[style] += canClose ? -1 : 1; });
    cursor = match.index + marker.length;
  }
  pushText(line.slice(cursor));
  return runs;
}

// Word-wraps one paragraph's runs to `charsPerLine`, preserving styling
// across the break. Returns an array of lines, each an array of runs.
export function wrapNoteRuns(runs, charsPerLine) {
  const lines = [];
  let curLine = [], curLen = 0;
  // Commits the current line, dropping the separator space that would
  // otherwise dangle past the wrap point and skew the next line's budget.
  const flushLine = () => {
    while (curLine.length && !curLine[curLine.length - 1].text.trim()) curLine.pop();
    lines.push(curLine);
    curLine = []; curLen = 0;
  };
  runs.forEach(run => {
    const style = { bold: run.bold, italic: run.italic, underline: run.underline };
    run.text.split(/(\s+)/).forEach(chunk => { // keep separators so we know where spaces were
      if (!chunk) return;
      if (/^\s+$/.test(chunk)) {
        // Whitespace: collapse to a single separator between words.
        if (curLen) { curLine.push({ text: ' ' }); curLen += 1; }
        return;
      }
      let word = chunk;
      while (word.length > charsPerLine) {
        if (curLine.length) flushLine();
        lines.push([{ text: word.slice(0, charsPerLine), ...style }]);
        word = word.slice(charsPerLine);
      }
      if (!word) return;
      if (curLen && curLen + word.length > charsPerLine) flushLine();
      curLine.push({ text: word, ...style });
      curLen += word.length;
    });
  });
  if (curLine.length) flushLine();
  return lines.length ? lines : [[]];
}

// Full layout: raw markup text -> array of lines, each an array of styled
// runs, wrapped to `charsPerLine`. Blank source shows a placeholder run.
export function layoutNoteText(text, charsPerLine) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return [[{ text: NOTE_EMPTY_PLACEHOLDER, placeholder: true }]];
  const out = [];
  raw.split('\n').forEach(para => {
    if (!para) { out.push([]); return; }
    wrapNoteRuns(parseNoteRuns(para), charsPerLine).forEach(l => out.push(l));
  });
  return out.length ? out : [[]];
}

// Back-compat helper: plain-text lines only (used by bounds/export math that
// doesn't need per-run styling).
export function wrapNoteText(text) {
  return layoutNoteText(text, NOTE_CHARS_PER_LINE).map(runs => runs.map(r => r.text).join(''));
}

// How many characters fit per line for a note of the given pixel width.
// Hoisted above its use in NOTE_CHARS_PER_LINE by function declaration.
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
  App.notes.forEach(note => renderOneNote(g, note));
}

// Fills `textEl` with one tspan per styled run, laid out as wrapped lines.
// Shared by the initial render and the fast in-place update path.
export function fillNoteTextEl(textEl, lines, xLeft) {
  textEl.innerHTML = '';
  lines.forEach((runs, i) => {
    runs.forEach((run, j) => {
      const tspan = makeSVG('tspan');
      tspan.textContent = run.text;
      if (j === 0) {
        tspan.setAttribute('x', xLeft);
        tspan.setAttribute('dy', i === 0 ? 0 : NOTE_LINE_H);
      }
      if (run.bold) tspan.setAttribute('font-weight', '700');
      if (run.italic) tspan.setAttribute('font-style', 'italic');
      if (run.underline) tspan.setAttribute('text-decoration', 'underline');
      if (run.placeholder) tspan.classList.add('note-placeholder');
      if (run.ellipsis) tspan.classList.add('note-overflow-mark');
      textEl.appendChild(tspan);
    });
    if (!runs.length && i > 0) {
      // Blank line: emit an empty tspan so dy-stacking stays correct.
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
  if (App.activeNoteId === note.id) grp.classList.add('note-link-active');
  if (noteIsResized(note)) grp.classList.add('note-resized');
  grp.setAttribute('data-note-id', note.id);
  grp.setAttribute('data-color', normalizeNoteColor(note.color));

  noteAnchorPoints(note).forEach(pt => {
    const line = makeSVG('line');
    line.classList.add('note-leader');
    line.setAttribute('x1', pos.x); line.setAttribute('y1', pos.y);
    line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
    grp.appendChild(line);
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

  const noteTip = 'Double-click to edit · Right-click for options · Drag corner to resize';
  grp.setAttribute('data-tip', noteTip);
  grp.setAttribute('aria-label', noteTip);

  attachNoteHandlers(grp, note);
  g.appendChild(grp);
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
  if (!grp) return;
  if (!App.domCache.notes.has(note.id)) App.domCache.notes.set(note.id, grp);

  const pos = resolveNotePos(note);
  const { w, h, lines } = noteBoxLayout(note);
  const x = pos.x - w / 2, y = pos.y - h / 2;

  const rect = grp.querySelector('.note-body');
  if (rect) { rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', w); rect.setAttribute('height', h); }
  const clipRect = grp.querySelector('clipPath rect');
  if (clipRect) {
    clipRect.setAttribute('x', x + 1); clipRect.setAttribute('y', y + 1);
    clipRect.setAttribute('width', Math.max(0, w - 2)); clipRect.setAttribute('height', Math.max(0, h - 2));
  }
  const textEl = grp.querySelector('.note-text');
  if (textEl) {
    if (refillText) {
      fillNoteTextEl(textEl, lines, x + NOTE_PAD);
    } else {
      // Only line-leading tspans carry an x; setting it on continuation runs
      // would break them out of inline flow onto their own column.
      textEl.querySelectorAll('tspan[x]').forEach(ts => ts.setAttribute('x', x + NOTE_PAD));
    }
    textEl.setAttribute('x', x + NOTE_PAD);
    textEl.setAttribute('y', y + NOTE_PAD + NOTE_LINE_H * 0.72);
  }
  grp.querySelectorAll('.note-resize-handle, .note-resize-hit')
    .forEach(p => p.setAttribute('d', noteResizeHandlePath(x + w, y + h)));
  const anchorPts = noteAnchorPoints(note);
  grp.querySelectorAll('.note-leader').forEach((line, i) => {
    const pt = anchorPts[i];
    if (!pt) return;
    line.setAttribute('x1', pos.x); line.setAttribute('y1', pos.y);
    line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
  });
}
export function updateNotesDOM() {
  App.notes.forEach(updateOneNoteDOM);
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

export function getNoteTransitionGroupKeys(note) {
  const keys = new Set();
  (note.anchorTransitions || []).forEach(id => {
    const t = getTransition(id);
    if (t) keys.add(`${t.from}|${t.to}`);
  });
  return keys;
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

  (note.anchorStates || []).forEach(stateId => {
    const el = App.domCache.states.get(stateId) || document.querySelector(`.sn[data-id="${stateId}"]`);
    if (el) el.classList.add('note-link-st');
  });

  getNoteTransitionGroupKeys(note).forEach(key => {
    const el = App.domCache.transitions.get(key) || document.querySelector(`.edge-g[data-edge="${key}"]`);
    if (el) el.classList.add('note-link-t');
  });
}

export function clearActiveNoteHighlight() {
  App.activeNoteId = null;
  clearNoteAnchorHighlight();
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
  highlightNoteAnchors(id, true);
  const pos = resolveNotePos(note);
  const pt = svgPt(e);
  snapshot();
  App.dragNoteId = id;
  App.dragNoteOffset = { x: pt.x - pos.x, y: pt.y - pos.y };
  // Deliberately no setPointerCapture here: move-tracking already works via
  // the document-level pointermove listener, and capturing on `wrap` would
  // retarget the resulting dblclick to it — misfiring the canvas background's
  // "empty double-click creates a state" handler instead of opening this note.
}

// Called from canvas.js's handlePointerMove while App.dragNoteId is set.
export function dragNoteTo(e) {
  const note = getNote(App.dragNoteId);
  if (!note) return;
  const pt = svgPt(e);
  const nx = pt.x - App.dragNoteOffset.x, ny = pt.y - App.dragNoteOffset.y;
  const c = noteAnchorCentroid(note);
  if (c) { note.x = nx - c.x; note.y = ny - c.y; }
  else { note.x = nx; note.y = ny; }
  updateOneNoteDOM(note, { refillText: false });
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
  App.notes = App.notes.filter(n => n.id !== id);
  if (App.activeNoteId === id) clearActiveNoteHighlight();
  renderAll();
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
let _noteEditorLastValid = '';

// Enter inserts a newline in the note textarea; Ctrl/Cmd+Enter saves.
registerModal('note-modal', {
  submit: () => confirmNote(),
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
  const textEl = $('note-text');
  _noteEditorLastValid = note.text || '';
  if (textEl) setNoteEditorMarkdown(textEl, _noteEditorLastValid);
  _noteModalColor = normalizeNoteColor(note.color);
  setNoteModalColorUI(_noteModalColor);
  updateNoteEditor();
  showOverlay('note-modal');
  if (textEl) setTimeout(() => textEl.focus(), 50);
}
export function setNoteModalColorUI(color) {
  document.querySelectorAll('#note-modal .note-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}
export function setNoteModalColor(color) {
  _noteModalColor = color;
  setNoteModalColorUI(color);
}
export function confirmNote() {
  const note = getNote(App.editNoteId);
  if (!note) return closeModal('note-modal');
  const nextText = noteEditorMarkdown($('note-text')).slice(0, NOTE_MAX_CHARS);
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

// ── Formatting toolbar: wraps (or unwraps, if already applied to an
// identical selection) the textarea's current selection with markup
// markers, mirroring the classic "bold/italic in a plain textarea" pattern
// used by Markdown editors everywhere. ──
export function applyNoteFormat(kind) {
  const editor = $('note-text');
  const command = { bold: 'bold', italic: 'italic', underline: 'underline' }[kind];
  if (!editor || !command) return;
  editor.focus();
  document.execCommand(command, false);
  updateNoteEditor();
}

export function clearNoteFormatting() {
  const editor = $('note-text');
  if (!editor) return;
  editor.focus();
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed) document.execCommand('selectAll', false);
  document.execCommand('removeFormat', false);
  updateNoteEditor();
}

export function handleNoteEditorKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const kind = { b: 'bold', i: 'italic', u: 'underline' }[String(e.key).toLowerCase()];
  if (!kind) return;
  e.preventDefault();
  e.stopPropagation();
  applyNoteFormat(kind);
}

export function insertNoteNewline() {
  const editor = $('note-text');
  if (!editor) return;
  editor.focus();
  document.execCommand('insertLineBreak', false);
  updateNoteEditor();
}

// Commits an edit to the note textarea, rejecting it whole if it would exceed
// the character cap. Returns whether the value was applied.
export function setNoteTextareaValue(editor, next) {
  if (next.length > NOTE_MAX_CHARS) {
    showStatus(`Note is at the ${NOTE_MAX_CHARS}-character limit`);
    editor.focus();
    return false;
  }
  setNoteEditorMarkdown(editor, next);
  _noteEditorLastValid = next;
  editor.focus();
  updateNoteCharCount();
  return true;
}

export function updateNoteCharCount() {
  const ta = $('note-text');
  const counter = $('note-char-count');
  if (!ta || !counter) return;
  const len = noteEditorMarkdown(ta).length;
  counter.textContent = `${len} / ${NOTE_MAX_CHARS}`;
  counter.classList.toggle('note-char-count-max', len >= NOTE_MAX_CHARS);
}

export function setNoteEditorMarkdown(editor, markdown) {
  if (!editor) return;
  editor.innerHTML = '';
  String(markdown || '').replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (i) editor.appendChild(document.createElement('br'));
    parseNoteRuns(line).forEach(run => {
      let node = document.createTextNode(run.text);
      if (run.underline) { const el = document.createElement('u'); el.appendChild(node); node = el; }
      if (run.italic) { const el = document.createElement('em'); el.appendChild(node); node = el; }
      if (run.bold) { const el = document.createElement('strong'); el.appendChild(node); node = el; }
      editor.appendChild(node);
    });
  });
}

function serializeNoteEditorNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'BR') return '\n';
  const inner = Array.from(node.childNodes || node.children || []).map(serializeNoteEditorNode).join('');
  if (tag === 'B' || tag === 'STRONG') return `**${inner}**`;
  if (tag === 'I' || tag === 'EM') return `*${inner}*`;
  if (tag === 'U') return `__${inner}__`;
  return inner;
}

export function noteEditorMarkdown(editor) {
  if (!editor) return '';
  return Array.from(editor.childNodes || editor.children || []).map(serializeNoteEditorNode).join('').replace(/\n+$/, '');
}

export function updateNoteEditor() {
  const editor = $('note-text');
  const markdown = noteEditorMarkdown(editor);
  if (markdown.length > NOTE_MAX_CHARS) {
    setNoteEditorMarkdown(editor, _noteEditorLastValid);
    showStatus(`Note is at the ${NOTE_MAX_CHARS}-character limit`);
  } else {
    _noteEditorLastValid = markdown;
  }
  updateNoteCharCount();
}
export function deleteNoteFromModal() {
  const id = App.editNoteId;
  if (_noteModalIsNew) { closeModal('note-modal'); return; }
  _noteModalCommitted = true;
  closeModal('note-modal');
  if (!id) return;
  deleteNote(id);
}
