// ══════════════════════════════════════════════════════════════════
//  MAKING AND REUSING BLOCKS
// ══════════════════════════════════════════════════════════════════
// The three things a reader does with building blocks: wrap what they have
// drawn into one, keep it so they can drop copies of it elsewhere, and take one
// apart again.
//
// Nothing here touches the machine directly. Every action goes through
// js/blocks.js and is wrapped in commit(), so grouping fifty states is one undo
// step and a refused action leaves the canvas exactly as it was — the same
// contract StateMate and the wizard hold to.
//
// ── The library is a store, not a setting ─────────────────────────
// A block definition is a whole machine, so it lives in IndexedDB beside the
// workspace snapshots rather than in localStorage, which is where this app's
// quota failures already are. It is emphatically **not** in `App.config`:
// exportWorkspaceState deep-copies that into every workspace tab and
// getBackupPayload writes it to disk, so a library kept there would be copied
// into every file the reader ever saved.

import {
  blockAncestry, blockChildren, blockMembers, getBlock, inlineBlock, liveBlocks,
  blockRemovalIds, machineSupportsBlocks, outlineBlock, removeBlock, uniqueBlockName,
  validateBlockDefinition, blockDefinitionCycle, BLOCK_NAME_SEP
} from './blocks.js';
import { clearSelection } from './canvas.js';
import { commit } from './history.js';
import { askConfirm } from './modal.js';
import { pruneNoteAnchorsExcluding } from './notes.js';
import { openWorkspaceDb } from './persistence.js';
import { enterBlockScope, syncScopeBar } from './scope.js';
import { $, App, getState, stateNameKey } from './state.js';
import { hideContextMenu } from './states-transitions.js';
import { Change, emit } from './store.js';
import { showStatus } from './utils.js';
import { blockSize, invalidateViewGraph, scopeId, viewStates } from './view-graph.js';

export const BLOCK_STORE_NAME = 'blocks';

// ══════════════════════════════════════════════════════════════════
//  GROUPING
// ══════════════════════════════════════════════════════════════════

/**
 * Which of the selected states control enters the group at.
 *
 * The one an edge arrives at from outside, or the machine's start state when it
 * is in the selection, or the first one. Asked of the wiring rather than of the
 * reader, because the answer is nearly always obvious from the diagram and a
 * dialog for it would be a question with one sensible answer.
 */
function pickEntry(ids) {
  const inside = new Set(ids);
  if (inside.has(App.startId)) return App.startId;
  for (const t of App.transitions || []) {
    if (inside.has(t.to) && !inside.has(t.from)) return t.to;
  }
  return ids[0];
}

/**
 * Which of the selected states control leaves the group at.
 *
 * The ones an edge leaves the selection from — those are the block's answers,
 * and their names become the exit labels. Failing that, the accepting ones;
 * failing that, the entry, so a block always has at least one way out.
 */
function pickExits(ids) {
  const inside = new Set(ids);
  const out = [];
  const seen = new Set();
  for (const t of App.transitions || []) {
    if (!inside.has(t.from) || inside.has(t.to)) continue;
    if (seen.has(t.from)) continue;
    seen.add(t.from);
    out.push(t.from);
  }
  if (out.length) return out;
  const accepting = ids.filter(id => App.accepts.has(id));
  return accepting.length ? accepting : [];
}

/**
 * Wrap the selection into a block on this level.
 *
 * Deliberately *not* an inline of a definition: the states are already here and
 * already wired, so grouping is a re-parenting rather than a copy. Nothing is
 * added, nothing is removed, and the machine decides exactly what it decided a
 * moment ago — which is the property that makes this safe to offer on a
 * diagram someone has spent an hour on.
 */
export function groupSelectionIntoBlock(name) {
  if (!machineSupportsBlocks()) {
    showStatus(`${App.machine} has no stay move, so it cannot have blocks`);
    return null;
  }
  const here = scopeId();
  const ids = [...App.selectedStates].filter(id => getState(id));
  const childBlocks = [...App.selectedStates].map(id => getBlock(id)).filter(Boolean);
  if (!ids.length && !childBlocks.length) {
    showStatus('Select the states to group first');
    return null;
  }
  if (!ids.length) {
    showStatus('A block needs at least one state of its own');
    return null;
  }

  const label = uniqueBlockName(name || 'block', here);
  const entry = pickEntry(ids);
  const exits = pickExits(ids);
  const members = ids.map(id => getState(id));
  const cx = members.reduce((a, s) => a + s.x, 0) / members.length;
  const cy = members.reduce((a, s) => a + s.y, 0) / members.length;

  let created = null;
  commit(() => {
    const block = {
      id: 'b' + (++App.blockN),
      name: label,
      parent: here,
      entry,
      exits: (exits.length ? exits : [entry]).map(id => ({ id, label: getState(id)?.name || id })),
      x: Math.round(cx),
      y: Math.round(cy),
      w: null, h: null,
      source: null,
      version: 1,
      collapsed: true
    };
    // Names are prefixed the way inlineBlock prefixes them, so a grouped block
    // and a placed one have the same shape — blockPathOf and localStateName are
    // positional, and a group whose members kept bare names would report a path
    // one segment short of every other block's.
    const taken = new Set((App.states || []).map(s => stateNameKey(s.name)));
    for (const s of members) {
      s.blockId = block.id;
      const wanted = `${label}${BLOCK_NAME_SEP}${s.name}`;
      if (!taken.has(stateNameKey(wanted))) { s.name = wanted; taken.add(stateNameKey(wanted)); }
    }
    // A selected block becomes a child of the new one, which is how a CPU is
    // built: select four ALUs and the control states, and group the lot.
    for (const b of childBlocks) b.parent = block.id;
    App.blocks = [...(App.blocks || []), block];
    const size = blockSize(block);
    block.w = size.w;
    block.h = size.h;
    invalidateViewGraph();
    created = block;
  }, Change.GRAPH);

  clearSelection();
  if (created) {
    App.selectedStates.add(created.id);
    emit(Change.CANVAS);
    showStatus(`Grouped ${ids.length} state${ids.length === 1 ? '' : 's'} into ${label}`);
  }
  return created;
}

/**
 * Put a block's contents back on this level and drop the box.
 *
 * The states stay exactly where they are — they were never anywhere else — so
 * this is the inverse of grouping and not a deletion. Child blocks are
 * re-parented to whatever contained this one, which keeps the tree a tree.
 */
export function ungroupBlock(id) {
  const b = getBlock(id);
  if (!b) return false;
  const parent = b.parent || null;
  commit(() => {
    for (const s of blockMembers(id)) {
      if (parent) s.blockId = parent; else delete s.blockId;
    }
    for (const child of blockChildren(id)) child.parent = parent;
    // The notes written inside this block come up with its states. Left behind,
    // `noteScopeOf` would answer null for a block that no longer exists and they
    // would all surface at the *top* level rather than at the one their states
    // just landed on — the right rescue for a deleted block and the wrong answer
    // for a dissolved one, which knows its own parent.
    for (const n of App.notes || []) {
      if (n.scope !== id) continue;
      if (parent) n.scope = parent; else delete n.scope;
    }
    App.blocks = (App.blocks || []).filter(x => x.id !== id);
    invalidateViewGraph();
  }, Change.GRAPH);
  showStatus(`Ungrouped ${b.name}`);
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY
// ══════════════════════════════════════════════════════════════════

async function withStore(mode, fn) {
  const db = await openWorkspaceDb();
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(BLOCK_STORE_NAME)) return null;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOCK_STORE_NAME, mode);
      const out = fn(tx.objectStore(BLOCK_STORE_NAME), resolve, reject);
      tx.oncomplete = () => resolve(out === undefined ? null : out);
      tx.onerror = () => reject(tx.error || new Error('Block library unavailable'));
      tx.onabort = () => reject(tx.error || new Error('Block library unavailable'));
    });
  } finally {
    db.close();
  }
}

/** Every saved definition, newest first. `[]` where there is no store at all. */
export async function listBlockLibrary() {
  try {
    const rows = await withStore('readonly', (store, resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
    return (rows || []).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch (e) {
    return [];
  }
}

export async function readBlockDefinition(key) {
  try {
    return await withStore('readonly', (store, resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * Keep a definition under `key`, refusing one that would contain itself.
 *
 * Inlining makes a cycle impossible on the canvas — you cannot place something
 * that does not exist yet — but the library can create one: edit a machine that
 * already contains ALU and save it back over ALU. A recursive block is not a
 * Turing machine with a subroutine; the expansion would not terminate.
 */
export async function saveBlockDefinition(def, key) {
  const problems = validateBlockDefinition(def);
  if (problems.length) throw new Error(problems[0]);
  const library = await listBlockLibrary();
  const byKey = new Map(library.map(d => [d.key, d]));
  const cycle = blockDefinitionCycle(def, key, k => byKey.get(k) || null);
  if (cycle) {
    throw new Error(`That would make ${cycle[0]} contain itself (${cycle.join(' → ')}).`);
  }
  const row = { ...def, key, savedAt: Date.now() };
  await withStore('readwrite', store => { store.put(row, key); });
  return row;
}

export async function deleteBlockDefinition(key) {
  await withStore('readwrite', store => { store.delete(key); });
}

/** Drop a copy of a saved definition onto the canvas at this level. */
export function placeBlockDefinition(def, at = {}) {
  if (!machineSupportsBlocks()) {
    showStatus(`${App.machine} has no stay move, so it cannot have blocks`);
    return null;
  }
  let result = null;
  commit(() => {
    result = inlineBlock(def, { ...at, parent: scopeId() });
    invalidateViewGraph();
  }, Change.GRAPH, Change.ALPHABET);
  if (!result) return null;
  for (const w of result.warnings) showStatus(w);
  showStatus(`Placed ${result.block.name}`);
  return result.block;
}

/** Somewhere clear of what is already drawn, so a placed block is visible. */
export function freeSpotForBlock() {
  const drawn = viewStates();
  if (!drawn.length) return { x: 260, y: 200 };
  let maxX = -Infinity, minY = Infinity;
  for (const s of drawn) {
    const hw = s.box ? s.box.w / 2 : 30;
    if (s.x + hw > maxX) maxX = s.x + hw;
    if (s.y < minY) minY = s.y;
  }
  return { x: Math.round(maxX + 200), y: Math.round(minY) };
}

// ══════════════════════════════════════════════════════════════════
//  CONTEXT-MENU ACTIONS
// ══════════════════════════════════════════════════════════════════

export function ctxGroupIntoBlock() {
  hideContextMenu();
  promptForName('Group into Block', 'block', name => groupSelectionIntoBlock(name));
}

export function ctxOpenBlock() {
  const id = App.ctxId;
  hideContextMenu();
  if (id) enterBlockScope(id);
}

export function ctxRenameBlock() {
  const id = App.ctxId;
  const b = getBlock(id);
  hideContextMenu();
  if (!b) return;
  promptForName('Rename Block', b.name, name => {
    commit(() => { b.name = uniqueBlockName(name, b.parent || null); }, Change.GRAPH);
    syncScopeBar();
  });
}

export function ctxUngroupBlock() {
  const id = App.ctxId;
  hideContextMenu();
  if (id) ungroupBlock(id);
}

export function ctxDeleteBlock() {
  const id = App.ctxId;
  const b = getBlock(id);
  hideContextMenu();
  if (!b) return;
  const n = blockMembers(id).length + blockChildren(id).length;
  askConfirm({
    title: `Delete ${b.name}?`,
    message: `This removes the block and everything inside it — ${n} item${n === 1 ? '' : 's'} `
      + 'at this level, and anything nested below them. One Ctrl+Z brings it all back.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      commit(() => {
        // While the ids are still resolvable, so a note *outside* the block that
        // anchors into it keeps the position it was drawn at rather than jumping
        // to its stored offset. The notes written inside go with the block —
        // removeBlock takes those.
        const gone = blockRemovalIds(id);
        pruneNoteAnchorsExcluding([...gone.states], gone.transitions);
        removeBlock(id);
        invalidateViewGraph();
      }, Change.GRAPH);
      showStatus(`Deleted ${b.name}`);
    }
  });
}

export function ctxSaveBlockToLibrary() {
  const id = App.ctxId;
  const b = getBlock(id);
  hideContextMenu();
  if (!b) return;
  promptForName('Save to Library', b.name, async name => {
    const def = outlineBlock(id, { name });
    if (!def) { showStatus('Nothing to save'); return; }
    try {
      await saveBlockDefinition(def, stateNameKey(name));
      commit(() => { b.source = stateNameKey(name); }, Change.GRAPH);
      showStatus(`Saved ${name} to the block library`);
      renderBlockLibrary();
    } catch (e) {
      showStatus(e.message || 'Could not save that block');
    }
  });
}

// A one-field prompt, through the confirm dialog the app already has rather
// than a dialog of its own: naming a block is the whole interaction, and a
// registered modal for it would be a thirteenth overlay in the DOM for one
// text field.
function promptForName(title, initial, onName) {
  const input = document.createElement('input');
  input.className = 'inp';
  input.type = 'text';
  input.value = initial || '';
  input.setAttribute('aria-label', title);
  askConfirm({
    title,
    message: 'Give it a name you will recognise on the canvas.',
    confirmLabel: 'OK',
    field: input,
    onConfirm: () => {
      const name = (input.value || '').trim();
      if (name) onName(name);
    }
  });
}

// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY, ON SCREEN
// ══════════════════════════════════════════════════════════════════
// Saving a definition wrote to IndexedDB and said so, and there was nothing
// anywhere that could list, place or delete one — a write-only store, which is
// worse than no store, because the reader is told the thing was kept.
//
// It lives under the Blocks section rather than in a dialog of its own: "the
// blocks in this machine" and "the blocks I can drop into it" are one question
// asked twice, and a fourteenth overlay to answer the second half would be a
// surface to go and find rather than a list already in front of you.
//
// Rows are built rather than written as HTML, with their listeners attached at
// creation the way js/reference.js does it — so the whole feature still adds no
// name to js/bridge.js.

/** A definition's one-line description: the machine it is, and how big. */
function libraryRowSub(def) {
  const n = (def.states || []).length;
  const parts = [def.machine || 'TM', `${n} state${n === 1 ? '' : 's'}`];
  const kids = (def.blocks || []).length;
  if (kids) parts.push(`${kids} block${kids === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export async function renderBlockLibrary() {
  const host = $('block-library-list');
  const head = $('block-library-head');
  if (!host) return;
  const rows = await listBlockLibrary();
  host.innerHTML = '';
  // The heading and the list appear together or not at all: a "Library" rule
  // over nothing is a section that looks broken rather than empty.
  const show = rows.length > 0;
  host.hidden = !show;
  if (head) head.hidden = !show;
  if (!show) return;

  for (const def of rows) {
    const row = document.createElement('div');
    row.className = 'blib-row';

    const open = document.createElement('button');
    open.className = 'bi';
    open.type = 'button';
    open.setAttribute('data-tip', `Place a copy of ${def.name} on the canvas`);
    const body = document.createElement('div');
    body.className = 'lp-row-body';
    const name = document.createElement('div');
    name.className = 'bi-name';
    name.textContent = def.name;
    const sub = document.createElement('div');
    sub.className = 'bi-sub';
    sub.textContent = libraryRowSub(def);
    body.appendChild(name);
    body.appendChild(sub);
    open.appendChild(body);
    open.addEventListener('click', () => {
      placeBlockDefinition(def, freeSpotForBlock());
    });

    const acts = document.createElement('div');
    acts.className = 'lp-row-acts';
    const del = document.createElement('button');
    del.className = 'lp-row-btn is-del';
    del.type = 'button';
    del.setAttribute('aria-label', `Delete ${def.name} from the library`);
    del.setAttribute('data-tip', `Delete ${def.name} from the library`);
    del.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">'
      + '<path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,'
      + '16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,'
      + '8,8v8H96Zm96,168H64V64H192Z" /></svg>';
    del.addEventListener('click', e => {
      e.stopPropagation();
      askConfirm({
        title: `Delete ${def.name}?`,
        message: 'This removes the saved definition from your block library. '
          + 'Copies already placed on a canvas are not affected.',
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: async () => {
          await deleteBlockDefinition(def.key);
          showStatus(`Deleted ${def.name} from the library`);
          renderBlockLibrary();
        }
      });
    });
    acts.appendChild(del);

    row.appendChild(open);
    row.appendChild(acts);
    host.appendChild(row);
  }
}

/**
 * Every block in the machine, for the panel and for StateMate.
 *
 * `path` is the *ancestors*, not the block itself: the list already shows the
 * name, and what it needs beside it is what tells two blocks called `add` in
 * different ALUs apart. Derived from the tree rather than sliced off a state's
 * name — that name may have been edited by hand, and the tree cannot be.
 */
export function allBlocks() {
  return liveBlocks().map(b => ({
    id: b.id,
    name: b.name,
    path: blockAncestry(b.id).slice(0, -1).map(a => a.name).join(BLOCK_NAME_SEP),
    members: blockMembers(b.id).length,
    children: blockChildren(b.id).length,
    exits: (b.exits || []).length
  }));
}

/** The Blocks panel's row click: open that block, wherever it is in the tree. */
export function openBlockFromList(id) {
  enterBlockScope(id);
}
