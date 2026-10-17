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
  MAP_FLOOR, MAP_MAX_CELL, VOID, blockAt, cellAt, cellOfVolume, deepLayout, depthOf, depthRange, fitCamera,
  makeCamera, mapClassifier, panBy, readTile, samplesFor, samplesOf, sizeLayout, stripSamples, visibleTiles, zoomAt
} from '../js/babel/deep-map.js';
import { volumesBefore } from '../js/babel/shape.js';
import { volumeAt } from '../js/babel/volumes.js';

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

async function until(fn, what) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('every room’s map is the deep map: a finite room’s bar counts what is on screen, an endless room starts at its sizes', async () => {
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-room', 'dfa-3-2', { reset: true });
  const host = context.document.getElementById('lib-content');
  assert.equal(findAll(host, n => n.classList?.contains('bab-deep')).length, 1);
  assert.match(textOf(host), /Point at the map/);
  // The tiles are read off the main thread (here: after a tick each); the bar fills as they land.
  const barText = () => textOf(findAll(host, n => n.classList?.contains('bab-census'))[0]);
  await until(() => /every volume read|machines read per block/.test(barText()), 'the census bar');
  const bar = barText();
  // dfa-3-2 fits on one screen at its bottom level, one volume a cell: the bar
  // is the room's exact census and says so, never "5 machines read per block".
  assert.match(bar, /the whole room · every volume read/);
  assert.doesNotMatch(bar, /read per block/);
  assert.match(bar, /something else\s*[1-9]/);
  const counts = [...bar.matchAll(/(?:∅|Σ\*|cofinite|else)\s*([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')));
  assert.equal(counts.reduce((a, b) => a + b, 0), 5832);

  // An endless room has no whole to fit: its map opens on the row of its sizes.
  context.go('babel-room', 'counter-2-2', { reset: true });
  assert.equal(findAll(host, n => n.classList?.contains('bab-deep')).length, 1);
  assert.equal(findAll(host, n => n.classList?.contains('bab-map')).length, 0);
  const scaleText = () => textOf(findAll(host, n => n.classList?.contains('bab-deep-scale'))[0]);
  await until(() => /sizes 0–/.test(scaleText()), 'the shelf');
  assert.match(scaleText(), /^1 cell = 1 size · sizes 0–\d+$/);
  // Any class with a count: what the classes are called is the census's business.
  await until(() => /[^\d\s,]\s*[1-9]/.test(barText().replace(/on screen.*$/, '')), 'the shelf’s census');
  // Enter goes into the size at the centre, and from there it is a finite room's map.
  const canvas = findAll(host, n => n.classList?.contains('bab-deep-canvas'))[0];
  const press = key => canvas._listeners.keydown({ key, preventDefault() {}, stopPropagation() {} });
  press('Enter');
  await until(() => /^size \d+ · /.test(scaleText()), 'going into a size');
  assert.match(scaleText(), /^size \d+ · 1 cell (=|≈) .* · level \d+ of \d+$/);
  // Out past the whole size is the shelf again.
  press('Home');
  await until(() => /^1 cell = 1 size/.test(scaleText()), 'back to the shelf');
  // The Plates view reads a census; the map stops it.
  const plates = findAll(host, n => n.classList?.contains('bab-toggle') && /Plates/.test(textOf(n)))[0];
  plates._listeners.click({ preventDefault() {} });
  assert.notEqual(activeCensusForTests(), null);
  const map = findAll(host, n => n.classList?.contains('bab-toggle') && /Map/.test(textOf(n)))[0];
  map._listeners.click({ preventDefault() {} });
  assert.equal(activeCensusForTests(), null);
});

test('an endless room’s sizes each lay out as a finite room, numbered as the room numbers them', () => {
  const wing = wingByKey('counter'), params = [2, 2];
  const shape = roomShape(wing, params);
  for (const s of [0, 1, 3, 6]) {
    const L = sizeLayout(wing, params, s);
    assert.equal(L.total, shape.count(s));
    assert.equal(L.base, volumesBefore(shape, s));
    assert.equal(L.sizes[L.D], 1n);
    // The size's last volume, found through its layout, is the room's last volume of that size.
    const c = cellOfVolume(L, L.total - 1n);
    assert.equal(L.base + blockAt(L, L.D, c.X, c.Y).lo, volumesBefore(shape, s + 1) - 1n);
  }
  const strip = handleBabelMessage({ id: 2, key: 'counter', params, type: 'strip', from: 0, count: 4, samples: 1 });
  assert.equal(strip.type, 'strip');
  assert.equal(strip.cells.length, 4);
  assert.ok([...strip.cells].every(k => k !== VOID));
  const tile = handleBabelMessage({ id: 3, key: 'counter', params, type: 'tile', size: 3, level: 0, tx: '0x0', ty: '0x0', samples: 1 });
  assert.equal(tile.type, 'tile');
  assert.equal(tile.lo, '0');
  assert.equal(BigInt(`0x${tile.hi}`), shape.count(3));
  // The shelf's samples for a size are volumes of that size.
  for (const v of stripSamples(wing, params, 3, 5)) assert.equal(volumeAt(wing, params, v).size, 3);
});

test('a room 90,000 levels deep has a map, laid out in a moment', () => {
  // dfa-300-300 ran out of memory when every level held its sizes as BigInts,
  // and rooms past 2,500 levels kept the census map.
  const started = performance.now();
  const L = deepLayout(wingByKey('dfa'), [300, 300]);
  assert.ok(L && L.D > 80000, `D = ${L?.D}`);
  assert.equal(L.sizes[0], L.total);
  assert.equal(L.sizes[L.D], 1n);
  assert.ok(performance.now() - started < 5000);
  // Deep rooms read their tiles, and send back the block's run with them.
  const reply = handleBabelMessage({ id: 1, key: 'dfa', params: [60, 60], type: 'tile', level: 0, tx: '0', ty: '0', samples: 1 });
  assert.equal(reply.type, 'tile');
  assert.equal(reply.lo, '0');
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-room', 'dfa-120-50', { reset: true });
  const host = context.document.getElementById('lib-content');
  assert.equal(findAll(host, n => n.classList?.contains('bab-deep')).length, 1);
  assert.doesNotMatch(textOf(host), /Too deep to fly through/);
  resetBabelUiForTests();   // its tiles are slow to read: stop the map
});

test('the new layout cuts every room as the old one did: a 4,000-level room’s grid holds to its digits', () => {
  // Built from digit indices rather than BigInt sizes, a layout must still be
  // the same layout: a block's children are runs of its volumes in number order.
  const L = deepLayout(wingByKey('tm'), [40, 40]);
  assert.ok(L.D > 2500);
  for (const l of [1, 2, Math.floor(L.D / 2), L.D - 1, L.D]) {
    const lv = L.levels[l - 1];
    const fan = Number((L.sizes[l - 1] + lv.child - 1n) / lv.child);
    assert.ok(fan <= lv.cols * lv.rows, `level ${l}: ${fan} children in ${lv.cols} × ${lv.rows}`);
    assert.equal(L.W[l], L.W[l - 1] * lv.colsB);
  }
  for (let t = 0; t < 6; t++) {
    const v = randomBelow(L.total, t * 31 + 7);
    const c = cellOfVolume(L, v);
    assert.equal(blockAt(L, L.D, c.X, c.Y).lo, v);
  }
});

test('a jump across 10,000 levels lands in one step, where walking there would', () => {
  // The rail dragged from top to bottom: walking a level at a time multiplied
  // the camera's cell 10,000 times (9 s back to the top of dfa-300-300).
  const L = deepLayout(wingByKey('dfa'), [100, 100]);
  const view = { w: 900, h: 560, inset: 40 };
  const cam = makeCamera(L, view), r = depthRange(L, view);
  const started = performance.now();
  zoomAt(cam, L, view, 10 ** (depthOf(cam, L) - r.bottom), 450, 280);
  assert.equal(cam.L, L.D);
  assert.ok(Math.abs(depthOf(cam, L) - r.bottom) < 1e-6);
  assert.ok(blockAt(L, cam.L, cam.AX, cam.AY), 'the centre is a volume');
  zoomAt(cam, L, view, 10 ** (depthOf(cam, L) - r.top), 450, 280);
  assert.equal(cam.L, 1);
  assert.ok(Math.abs(depthOf(cam, L) - r.top) < 1e-6);
  assert.ok(performance.now() - started < 2000);
  // And a short move is the walk itself, level by level, unchanged.
  const a = makeCamera(L, view), b = makeCamera(L, view);
  for (let i = 0; i < 40; i++) zoomAt(a, L, view, 1.25, 300, 200);
  zoomAt(b, L, view, 1.25 ** 40, 300, 200);
  assert.equal(a.L, b.L);
});

test('a size is laid out by its ranks’ decimal digits: full 10 × 10 grids, empty only past its last volume', () => {
  const L = sizeLayout(wingByKey('counter'), [2, 2], 4);
  assert.deepEqual(L.levels.map(lv => [lv.cols, lv.rows]), [[10, 5], [10, 10], [10, 10]]);
  // Every block but the last is full: narrowed as one huge digit, a run of 7
  // in a 3 × 3 left a hole at the end of every block.
  for (let l = 1; l < L.D; l++) assert.equal(L.sizes[l], L.sizes[l + 1] * BigInt(L.levels[l].cols * L.levels[l].rows));
  const c = cellOfVolume(L, L.total);
  assert.equal(blockAt(L, L.D, c.X, c.Y), null, 'past the last volume is past the room');
});
