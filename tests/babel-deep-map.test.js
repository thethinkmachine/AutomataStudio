// The deep map: a finite Babel room from the whole room down to single volumes.
// The layout must cover the room exactly and in number order, the camera must
// keep its BigInt cell honest fifty levels down, and the tiles must be the same
// every time they are read — in the worker or here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, resetApp } from './harness.js';
import { bits, fin, tuple } from '../js/babel/shape.js';
import { WINGS, roomProblem, roomShape, wingByKey } from '../js/babel/wings.js';
import { cellClassesOf, classifyVolume } from '../js/babel/census.js';
import { handleBabelMessage } from '../js/babel/babel-worker-core.js';
import { activeCensusForTests, resetBabelUiForTests } from '../js/babel/babel-ui.js';
import {
  MAP_FLOOR, MAP_MAX_CELL, MAX_LEVELS, VOID, blockAt, cellAt, cellOfVolume, deepLayout, depthOf, depthRange, fitCamera,
  makeCamera, mapClassifier, panBy, readTile, samplesFor, samplesOf, visibleTiles, zoomAt
} from '../js/babel/deep-map.js';

const VIEW = { w: 900, h: 560 };

/** A uniformly random volume below `total`, reproducibly. */
function randomBelow(total, seed) {
  let s = seed >>> 0 || 1, v = 0n;
  for (let i = 0; i < Math.ceil(total.toString(2).length / 30) + 2; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    v = (v << 30n) | BigInt(s & 0x3fffffff);
  }
  return v % total;
}

/** A wing with nothing but a shape, for layouts no real room has. */
function shapeWing(key, shape) {
  return { key, type: 'DFA', kind: 'fa', params: [], shape: () => shape };
}

const ROOMS = [['dfa', [3, 2]], ['dfa', [6, 6]], ['dfa', [10, 10]], ['tm', [2, 2]], ['nfa', [2, 2]], ['nba', [2, 2]]];

test('a layout covers its room exactly: every volume has one cell at every level, and back', () => {
  for (const [key, params] of ROOMS) {
    const wing = wingByKey(key);
    const L = deepLayout(wing, params);
    assert.ok(L, `${key}-${params} is finite`);
    assert.equal(L.sizes[0], L.total);
    assert.equal(L.sizes[L.D], 1n);
    for (let t = 0; t < 120; t++) {
      const v = randomBelow(L.total, t * 7919 + params[0]);
      for (const l of [1, Math.ceil(L.D / 2), L.D]) {
        const c = cellOfVolume(L, v, l);
        const b = blockAt(L, l, c.X, c.Y);
        assert.ok(b && b.lo <= v && v < b.hi, `${key}-${params} level ${l} holds ${v}`);
      }
      const c = cellOfVolume(L, v);
      assert.equal(blockAt(L, L.D, c.X, c.Y).lo, v);
    }
  }
});

test('a block’s children run in number order, left to right and top to bottom', () => {
  const L = deepLayout(wingByKey('dfa'), [6, 6]);
  for (const l of [0, 5, L.D - 1]) {
    const lv = L.levels[l];
    const X = BigInt(3 % Number(L.W[l])), Y = BigInt(1 % Number(L.H[l]));
    const parent = blockAt(L, l, X, Y);
    let next = parent.lo;
    for (let i = 0; i < lv.cols * lv.rows; i++) {
      const b = blockAt(L, l + 1, X * lv.colsB + BigInt(i % lv.cols), Y * lv.rowsB + BigInt(Math.floor(i / lv.cols)));
      if (!b) { assert.equal(next, parent.hi, 'only past the parent’s end is a cell empty'); continue; }
      assert.equal(b.lo, next, `child ${i} of level ${l} follows on`);
      next = b.hi;
    }
    assert.equal(next, parent.hi);
  }
});

test('a DFA room zooms two moves a level, then the accept set', () => {
  const L = deepLayout(wingByKey('dfa'), [10, 10]);
  assert.equal(L.D, 51);
  assert.ok(L.levels.slice(0, 50).every(lv => lv.cols === 10 && lv.rows === 10));
  assert.deepEqual([L.levels[50].cols, L.levels[50].rows], [32, 32]);
  assert.deepEqual([L.picks[0].down, L.picks[0].across], ['q9 · j', 'q9 · i'], 'rows are the higher digit');
  assert.deepEqual([L.picks[49].down, L.picks[49].across], ['q0 · b', 'q0 · a']);
  assert.deepEqual(L.picks[50].names, ['F']);
  // A level whose digits cannot fill a grid exactly is avoided when one can: the 6·6 room is 6 × 6 grids.
  assert.ok(deepLayout(wingByKey('dfa'), [6, 6]).levels.slice(0, 17).every(lv => lv.cols === 6 && lv.rows === 6));
});

test('a digit too big for one level is narrowed over several, and a short last row is empty', () => {
  const huge = deepLayout(shapeWing('huge', tuple(bits(3), fin(10 ** 7))), []);
  assert.equal(huge.total, 8n * 10n ** 7n);
  assert.ok(huge.levels.every(lv => lv.cols * lv.rows <= 1024), 'no level exceeds the fan limit');
  for (let t = 0; t < 50; t++) {
    const v = randomBelow(huge.total, t + 1);
    const c = cellOfVolume(huge, v);
    assert.equal(blockAt(huge, huge.D, c.X, c.Y).lo, v);
  }
  // 1,501 volumes: 251 children of six, the last of one — and the grid's tail is empty.
  const odd = deepLayout(shapeWing('odd', fin(1501)), []);
  const tile = readTile(odd, 0, 0n, 0n, () => 0, 1);
  const lv = odd.levels[0];
  const filled = [...tile.cells].filter(k => k !== VOID).length;
  assert.equal(filled, Number((odd.total + lv.child - 1n) / lv.child));
  assert.ok(lv.cols * lv.rows > filled, 'the grid has room to spare');
  const last = blockAt(odd, 1, BigInt((filled - 1) % lv.cols), BigInt(Math.floor((filled - 1) / lv.cols)));
  assert.equal(last.hi, 1501n);
});

test('the flat DFA classifier agrees with classifyBody', () => {
  for (const params of [[2, 1], [3, 2], [4, 3], [6, 6], [10, 10]]) {
    const wing = wingByKey('dfa');
    const keys = cellClassesOf(wing).map(c => c.key);
    const classify = mapClassifier(wing, params);
    const total = deepLayout(wing, params).total;
    for (let t = 0; t < 600; t++) {
      const v = randomBelow(total, t * 31 + params[0] * 1009);
      assert.equal(keys[classify(v)], classifyVolume(wing, params, v), `dfa-${params.join('-')}/${v}`);
    }
  }
});

test('a tile reads the same every time, here or in the worker, sorted cell by cell', () => {
  const wing = wingByKey('dfa'), params = [6, 6];
  const L = deepLayout(wing, params);
  const classify = mapClassifier(wing, params);
  const a = readTile(L, 3, 11n, 4n, classify, samplesFor(wing));
  const b = readTile(L, 3, 11n, 4n, classify, samplesFor(wing));
  assert.deepEqual(a, b);
  assert.equal(a.spp, 5);
  for (let i = 0; i < a.cells.length; i += 5) for (let s = 1; s < 5; s++) assert.ok(a.cells[i + s - 1] <= a.cells[i + s]);
  const reply = handleBabelMessage({ type: 'tile', key: 'dfa', params, level: 3, tx: '11', ty: '4', samples: 5, id: 1 });
  assert.equal(reply.type, 'tile');
  assert.deepEqual(Array.from(reply.cells), Array.from(a.cells));
  // The bottom level is read exactly, one machine a cell.
  assert.equal(readTile(L, L.D - 1, 0n, 0n, classify, 5).spp, 1);
  // A cell's samples are the volumes the reading pane shows.
  const block = blockAt(L, 4, 11n * 6n, 4n * 6n);
  const vols = samplesOf(L, 4, 11n * 6n, 4n * 6n, block, 5);
  assert.deepEqual(vols.map(classify).sort(), Array.from(a.cells.slice(0, 5)).sort());
  assert.ok(vols.every(v => block.lo <= v && v < block.hi));
  // Turing machines and the rooms read by running machines take one sample, not five.
  assert.equal(samplesFor(wingByKey('tm')), 1);
});

test('the camera goes fifty levels down and back to the whole room', () => {
  const L = deepLayout(wingByKey('dfa'), [10, 10]);
  const cam = makeCamera(L, VIEW);
  assert.equal(cam.L, 1);
  const top = depthOf(cam, L);
  let steps = 0;
  while (!(cam.L === L.D && cam.s >= MAP_MAX_CELL - 1e-6) && steps++ < 2000) zoomAt(cam, L, VIEW, 1.25, 610, 190);
  assert.equal(cam.L, L.D);
  assert.ok(Math.abs(depthOf(cam, L) - depthRange(L, VIEW).bottom) < 1e-6);
  // Every level drawn has cells at least the floor across.
  for (let i = 0; i < 40; i++) {
    zoomAt(cam, L, VIEW, 0.8, 300, 400);
    assert.ok(Math.min(cam.s, cam.s / L.aspect[cam.L]) >= MAP_FLOOR - 1e-9 || cam.L === 1);
  }
  while (cam.L > 1 && steps++ < 4000) zoomAt(cam, L, VIEW, 0.8, 450, 280);
  for (let i = 0; i < 20; i++) zoomAt(cam, L, VIEW, 0.8, 450, 280);
  assert.ok(Math.abs(depthOf(cam, L) - depthRange(L, VIEW).top) < 1e-6, 'zooming out stops at the whole room');
});

test('every finite room zooms down to single volumes, its cells never more than 2.5 times longer than wide', () => {
  // An NFA's number is binary digits. Each level used to split its own grid
  // squarest (16 × 8), halving the cells' width every time; fifty levels down
  // they were too thin for the camera to reach the next level, and the zoom
  // went on for ever at the same one.
  const view = { w: 900, h: 560, inset: 40 };
  const rooms = [[wingByKey('nfa'), [5, 3]], [wingByKey('nfa'), [10, 10]], [wingByKey('tm'), [5, 3]], [wingByKey('itm'), [8, 3]], [wingByKey('nba'), [6, 2]]];
  for (const w of WINGS) for (const n of [2, 3]) {
    const p = w.params.map((q, i) => Math.max(q.min ?? 1, i === 0 ? n : 2));
    if (!roomProblem(w, p) && roomShape(w, p).finite) rooms.push([w, p]);
  }
  for (const [w, p] of rooms) {
    const L = deepLayout(w, p);
    for (const a of L.aspect) assert.ok(Math.max(a, 1 / a) <= 2.5 + 1e-9, `${w.type} ${p.join('·')}: a cell ${a.toFixed(2)} wide per unit of height`);
    const cam = makeCamera(L, view);
    const bottom = depthRange(L, view).bottom;
    let n = 0;
    while (!(cam.L === L.D && Math.abs(depthOf(cam, L) - bottom) < 1e-9) && n++ < 5000) zoomAt(cam, L, view, 1.25, 450, 280);
    assert.ok(n < 5000, `${w.type} ${p.join('·')} reaches its volumes (stuck at level ${cam.L} of ${L.D})`);
    // …and back out to the whole room, never past it: a fitted room is often
    // drawn a level down, and the limit held only at level 1 let the zoom
    // overshoot and snap back.
    const top = depthRange(L, view).top;
    let m = 0;
    while (Math.abs(depthOf(cam, L) - top) > 1e-9 && m++ < 5000) {
      zoomAt(cam, L, view, 0.8, 450, 280);
      assert.ok(depthOf(cam, L) <= top + 1e-9, `${w.type} ${p.join('·')} zoomed out past the whole room`);
    }
    assert.ok(m < 5000, `${w.type} ${p.join('·')} returns to the whole room`);
  }
});

test('a zoom keeps the point under the pointer, and a pan never leaves the room', () => {
  const L = deepLayout(wingByKey('dfa'), [6, 6]);
  const cam = makeCamera(L, VIEW);
  for (let i = 0; i < 25; i++) zoomAt(cam, L, VIEW, 1.25, 700, 120);
  const before = cellAt(cam, L, VIEW, 700, 120), atL = cam.L;
  const outer = blockAt(L, atL, before.X, before.Y);
  for (let i = 0; i < 12; i++) zoomAt(cam, L, VIEW, 1.25, 700, 120);
  const after = cellAt(cam, L, VIEW, 700, 120);
  const inner = blockAt(L, cam.L, after.X, after.Y);
  assert.ok(cam.L > atL, 'went down a level or more');
  assert.ok(outer.lo <= inner.lo && inner.hi <= outer.hi, 'the cell under the pointer is inside the one that was');
  panBy(cam, L, VIEW, 1e9, -1e9);
  assert.ok(cam.AX >= 0n && cam.AX < L.W[cam.L] && cam.AY >= 0n && cam.AY < L.H[cam.L]);
  assert.ok(visibleTiles(cam, L, VIEW).length > 0);
  fitCamera(cam, L, VIEW);
  assert.ok(Math.abs(depthOf(cam, L) - depthRange(L, VIEW).top) < 1e-6, 'Whole room is the top again');
});

// ── The page ──────────────────────────────────────────────────────

function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent;
  return (node.textContent || '') + (node.children || []).map(textOf).join('');
}

function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  (node.children || []).forEach(c => findAll(c, pred, out));
  return out;
}

function seedTab() {
  resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.Workspaces.push({ id: 'w0', name: 'Mine', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

test('a finite room’s map is the deep map, and its bar counts what is on screen; an endless room keeps the census map', async () => {
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-room', 'dfa-3-2', { reset: true });
  const host = context.document.getElementById('lib-content');
  assert.equal(findAll(host, n => n.classList?.contains('bab-deep')).length, 1);
  assert.match(textOf(host), /Point at the map/);
  // The tiles are read off the main thread (here: after a tick each); the bar fills as they land.
  const barText = () => textOf(findAll(host, n => n.classList?.contains('bab-census'))[0]);
  for (let i = 0; i < 100 && !/on screen/.test(barText()); i++) await new Promise(r => setTimeout(r, 100));
  const bar = barText();
  assert.match(bar, /on screen · 5 machines read per block/);
  assert.match(bar, /something else\s*[1-9]/);
  context.go('babel-room', 'counter-2-2', { reset: true });
  assert.equal(findAll(host, n => n.classList?.contains('bab-deep')).length, 0);
  assert.equal(findAll(host, n => n.classList?.contains('bab-map')).length, 1);
  // Back to a finite room: the endless room's census stops reading.
  assert.notEqual(activeCensusForTests(), null);
  context.go('babel-room', 'dfa-3-2', { reset: true });
  assert.equal(activeCensusForTests(), null);
});

test('a room too deep to fly through has no deep layout, and its page keeps the census map', () => {
  // dfa-300-300 is 90,000 levels deep: its layout ran out of memory.
  const started = performance.now();
  assert.equal(deepLayout(wingByKey('dfa'), [300, 300]), null);
  assert.equal(handleBabelMessage({ id: 1, key: 'dfa', params: [300, 300], type: 'tile', level: 0, tx: '0', ty: '0', samples: 1 }).type, 'failed');
  assert.ok(performance.now() - started < 5000);
  // Just inside the line, every level reaches single volumes.
  const L = deepLayout(wingByKey('dfa'), [100, 20]);
  assert.ok(L.D > 2000 && L.D <= MAX_LEVELS);
  assert.equal(L.sizes[L.D], 1n);
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-room', 'dfa-120-50', { reset: true });
  const host = context.document.getElementById('lib-content');
  assert.equal(findAll(host, n => n.classList?.contains('bab-deep')).length, 0);
  assert.equal(findAll(host, n => n.classList?.contains('bab-map')).length, 1);
  assert.match(textOf(host), /Too deep to fly through/);
});
