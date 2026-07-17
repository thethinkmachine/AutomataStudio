// ══════════════════════════════════════════════════════════════════
//  CANVAS NOTES — free or anchored comments on states/transitions
// ══════════════════════════════════════════════════════════════════
const NOTE_WIDTH = 170;
const NOTE_PAD = 10;
const NOTE_LINE_H = 15;

function newNoteId() { return 'n' + (++App.noteN); }
function getNote(id) { return App.notes.find(n => n.id === id); }

function normalizeNoteColor(color) {
  return color === 'purple' ? 'violet' : (color || 'default');
}

// ── Anchoring: a note's stored (x, y) is an absolute point when it has no
// anchors, or an offset from its anchors' centroid when it does. This way an
// anchored note rides along automatically whenever a state it's pinned to
// moves, without having to track every drag separately. ──
function noteAnchorPoints(note) {
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
function noteAnchorCentroid(note) {
  const pts = noteAnchorPoints(note);
  if (!pts.length) return null;
  return {
    x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
    y: pts.reduce((a, p) => a + p.y, 0) / pts.length
  };
}
function resolveNotePos(note) {
  const c = noteAnchorCentroid(note);
  return c ? { x: c.x + note.x, y: c.y + note.y } : { x: note.x, y: note.y };
}

// Lets fitToScreen / the minimap / resize-framing include note bodies in
// their world bounding box, so a free-floating note never gets scrolled out
// of view when a saved workspace is loaded.
function includeNoteBounds(cb) {
  App.notes.forEach(note => {
    const pos = resolveNotePos(note);
    const lines = wrapNoteText(note.text);
    const w = NOTE_WIDTH, h = NOTE_PAD * 2 + lines.length * NOTE_LINE_H;
    cb(pos.x - w / 2, pos.y - h / 2, pos.x + w / 2, pos.y + h / 2);
  });
}

// Drops the given state/transition ids from every note's anchors, preserving
// each note's current on-screen position (recomputed against whatever
// anchors survive, or frozen as an absolute point if none do). Must be called
// *before* the ids are actually removed from App.states/App.transitions —
// otherwise their positions can no longer be resolved.
function pruneNoteAnchorsRemoving(removedStateIds, removedTransIds) {
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
function pruneNoteAnchorsExcluding(removedStateIds, removedTransIds) {
  pruneNoteAnchorsRemoving(removedStateIds || [], removedTransIds || []);
}

// Safety net for paths that can't practically call the above ahead of time —
// algorithm rebuilds that wholesale-replace App.states/App.transitions, a
// hand-edited import, etc. Diffs each note's anchors against what currently
// exists. Called from renderAll() on every render, so nothing is ever left
// pointing at a dangling id; the tradeoff is that if the state is *already*
// gone by the time this runs, the note can't recover its exact prior visual
// position and instead settles at its stored offset.
function pruneNoteAnchors() {
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

// ── Word-wrap: plain SVG text/tspan (not foreignObject) so notes survive the
// PNG export pipeline, which rasterizes the SVG via drawImage(). ──
const NOTE_CHARS_PER_LINE = 24;
const NOTE_EMPTY_PLACEHOLDER = 'Double-click to edit';
function wrapNoteText(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  const source = raw.trim() ? raw : NOTE_EMPTY_PLACEHOLDER;
  const lines = [];
  source.split('\n').forEach(para => {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let cur = '';
    words.forEach(word => {
      while (word.length > NOTE_CHARS_PER_LINE) {
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(word.slice(0, NOTE_CHARS_PER_LINE));
        word = word.slice(NOTE_CHARS_PER_LINE);
      }
      const candidate = cur ? cur + ' ' + word : word;
      if (candidate.length > NOTE_CHARS_PER_LINE) { lines.push(cur); cur = word; }
      else cur = candidate;
    });
    if (cur) lines.push(cur);
  });
  return lines.length ? lines : [NOTE_EMPTY_PLACEHOLDER];
}

// ══════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════
function renderNotes() {
  const g = $('notes-g');
  if (!g) return;
  g.innerHTML = '';
  App.notes.forEach(note => renderOneNote(g, note));
}

function renderOneNote(g, note) {
  const pos = resolveNotePos(note);
  const lines = wrapNoteText(note.text);
  const w = NOTE_WIDTH;
  const h = NOTE_PAD * 2 + lines.length * NOTE_LINE_H;
  const x = pos.x - w / 2, y = pos.y - h / 2;

  const grp = makeSVG('g');
  grp.classList.add('note-g');
  if (App.activeNoteId === note.id) grp.classList.add('note-link-active');
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

  const textEl = makeSVG('text');
  textEl.classList.add('note-text');
  lines.forEach((line, i) => {
    const tspan = makeSVG('tspan');
    tspan.textContent = line;
    tspan.setAttribute('x', x + NOTE_PAD);
    tspan.setAttribute('dy', i === 0 ? 0 : NOTE_LINE_H);
    textEl.appendChild(tspan);
  });
  textEl.setAttribute('x', x + NOTE_PAD);
  textEl.setAttribute('y', y + NOTE_PAD + NOTE_LINE_H * 0.72);
  grp.appendChild(textEl);

  const titleEl = makeSVG('title');
  titleEl.textContent = 'Double-click to edit · Right-click for options';
  grp.appendChild(titleEl);

  attachNoteHandlers(grp, note);
  g.appendChild(grp);
}

// Fast path used while dragging: reposition one note's existing DOM in place
// instead of re-rendering the whole notes layer.
function updateOneNoteDOM(note) {
  const grp = App.domCache.notes.get(note.id) || document.querySelector(`.note-g[data-note-id="${note.id}"]`);
  if (!grp) return;
  if (!App.domCache.notes.has(note.id)) App.domCache.notes.set(note.id, grp);

  const pos = resolveNotePos(note);
  const lines = wrapNoteText(note.text);
  const w = NOTE_WIDTH;
  const h = NOTE_PAD * 2 + lines.length * NOTE_LINE_H;
  const x = pos.x - w / 2, y = pos.y - h / 2;

  const rect = grp.querySelector('.note-body');
  if (rect) { rect.setAttribute('x', x); rect.setAttribute('y', y); }
  const textEl = grp.querySelector('.note-text');
  if (textEl) {
    textEl.setAttribute('x', x + NOTE_PAD);
    textEl.setAttribute('y', y + NOTE_PAD + NOTE_LINE_H * 0.72);
    textEl.querySelectorAll('tspan').forEach(ts => ts.setAttribute('x', x + NOTE_PAD));
  }
  const anchorPts = noteAnchorPoints(note);
  grp.querySelectorAll('.note-leader').forEach((line, i) => {
    const pt = anchorPts[i];
    if (!pt) return;
    line.setAttribute('x1', pos.x); line.setAttribute('y1', pos.y);
    line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
  });
}
function updateNotesDOM() {
  App.notes.forEach(updateOneNoteDOM);
}

// ══════════════════════════════════════════════════════════════════
//  INTERACTION: drag, edit, context menu
// ══════════════════════════════════════════════════════════════════
function attachNoteHandlers(grp, note) {
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
    showContextMenu('note', e.clientX, e.clientY);
  });
}

function getNoteTransitionGroupKeys(note) {
  const keys = new Set();
  (note.anchorTransitions || []).forEach(id => {
    const t = getTransition(id);
    if (t) keys.add(`${t.from}|${t.to}`);
  });
  return keys;
}

function clearNoteAnchorHighlight(noteId = null) {
  const noteSelector = noteId ? `.note-g[data-note-id="${noteId}"]` : '.note-g';
  document.querySelectorAll(`${noteSelector}.note-link-active`).forEach(el => el.classList.remove('note-link-active'));
  document.querySelectorAll('.sn.note-link-st, .edge-g.note-link-t').forEach(el => el.classList.remove('note-link-st', 'note-link-t'));
}

function highlightNoteAnchors(id, pin = false) {
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

function clearActiveNoteHighlight() {
  App.activeNoteId = null;
  clearNoteAnchorHighlight();
}

function onNoteDown(e, id) {
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
function dragNoteTo(e) {
  const note = getNote(App.dragNoteId);
  if (!note) return;
  const pt = svgPt(e);
  const nx = pt.x - App.dragNoteOffset.x, ny = pt.y - App.dragNoteOffset.y;
  const c = noteAnchorCentroid(note);
  if (c) { note.x = nx - c.x; note.y = ny - c.y; }
  else { note.x = nx; note.y = ny; }
  updateOneNoteDOM(note);
}

function deleteNote(id) {
  snapshot();
  App.notes = App.notes.filter(n => n.id !== id);
  if (App.activeNoteId === id) clearActiveNoteHighlight();
  renderAll();
}

// ══════════════════════════════════════════════════════════════════
//  CREATE
// ══════════════════════════════════════════════════════════════════
function createNote(x, y, anchorStates = [], anchorTransitions = []) {
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

function addAnchoredNote(states, transitions) {
  const c = noteAnchorCentroid({ anchorStates: states, anchorTransitions: transitions }) || { x: 0, y: 0 };
  const note = createNote(c.x + 95, c.y - 85, states, transitions);
  openNoteModal(note.id);
}

// Resolves which states/transitions a new note should anchor to from a
// context-menu click: the full current selection if the clicked item is part
// of it, otherwise just the clicked item.
function resolveNoteAnchorsForContext() {
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

function ctxAddNoteState() {
  const anchors = resolveNoteAnchorsForContext();
  hideContextMenu();
  addAnchoredNote(anchors.states, anchors.transitions);
}
function ctxAddNoteEdge() {
  const anchors = resolveNoteAnchorsForContext();
  hideContextMenu();
  addAnchoredNote(anchors.states, anchors.transitions);
}
function ctxCanvasAddNote() {
  hideCanvasContextMenu();
  const pt = App.ctxCanvasPt || { x: 0, y: 0 };
  const note = createNote(pt.x, pt.y, [], []);
  openNoteModal(note.id);
}

// ══════════════════════════════════════════════════════════════════
//  CONTEXT MENU ACTIONS (note mode)
// ══════════════════════════════════════════════════════════════════
function ctxEditNote() {
  const id = App.ctxNoteId;
  hideContextMenu();
  if (!id) return;
  openNoteModal(id);
}
function ctxDeleteNote() {
  const id = App.ctxNoteId;
  hideContextMenu();
  if (!id) return;
  deleteNote(id);
}
function ctxSetNoteColor(color) {
  const id = App.ctxNoteId;
  const note = getNote(id);
  hideContextMenu();
  if (!note) return;
  snapshot();
  note.color = normalizeNoteColor(color);
  renderAll();
}
function ctxDetachNote() {
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
function ctxAnchorNoteToSelection() {
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
let _noteModalColor = 'default';
function openNoteModal(id) {
  const note = getNote(id);
  if (!note) return;
  App.editNoteId = id;
  const textEl = $('note-text');
  if (textEl) textEl.value = note.text || '';
  _noteModalColor = normalizeNoteColor(note.color);
  setNoteModalColorUI(_noteModalColor);
  showOverlay('note-modal');
  if (textEl) setTimeout(() => textEl.focus(), 50);
}
function setNoteModalColorUI(color) {
  document.querySelectorAll('#note-modal .note-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}
function setNoteModalColor(color) {
  _noteModalColor = color;
  setNoteModalColorUI(color);
}
function confirmNote() {
  const note = getNote(App.editNoteId);
  if (!note) return closeModal('note-modal');
  snapshot();
  note.text = ($('note-text')?.value || '').slice(0, 500);
  note.color = normalizeNoteColor(_noteModalColor);
  closeModal('note-modal');
  renderAll();
}
function deleteNoteFromModal() {
  const id = App.editNoteId;
  closeModal('note-modal');
  if (!id) return;
  deleteNote(id);
}
