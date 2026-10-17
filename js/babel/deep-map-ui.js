// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — THE DEEP MAP, ON SCREEN
// ══════════════════════════════════════════════════════════════════
// Every room's map (deep-map.js holds the layout and the camera): one canvas,
// zoomed with the wheel, dragged, flown into by holding the pointer down, or
// set to any depth on the rail beside it. Tiles are read in the Babel worker,
// nearest the centre first, at most two at a time, and kept per room — so
// leaving for a volume and coming back finds the map where it was and reads
// nothing twice. A tile not read yet stays the "not read" fill.
//
// A finite room is one layout, from the whole room down to single volumes. An
// endless room has no whole to fit on screen, so its top level is its shelf:
// a row of its sizes, one cell each, going on to the right for as long as the
// reader pans. Zooming into a size goes into that size's own layout
// (sizeLayout) — finite, so from there it is a finite room's map — and zooming
// out past the whole size comes back to the shelf.
//
// What a cell means is said by the page: babel-ui.js passes hooks for the
// reading pane, the plates (drawn as DOM over the canvas once a volume's cell
// is PLATE_FROM wide, so they are the same plateFigure drawings as everywhere
// else, and buttons), opening a volume and the census bar's tally. Every
// volume a hook is given is the room's own number.

import { h } from '../library/dom.js';
import { capturePointer, releasePointer } from '../core/pointer-capture.js';
import { askBabel } from './babel-client.js';
import { cellClassesOf } from './census.js';
import { roomId, roomShape } from './wings.js';
import { volumesBefore } from './shape.js';
import {
  PLATE_FROM, UNKNOWN, VOID, bigLog10, blockAt, cellAt, coordKey, deepLayout, depthOf, depthRange, fitCamera, levelDepth,
  majorityOf, makeCamera, normalize, panBy, samplesFor, samplesOf, screenOf, sizeLayout, stripSamples,
  visibleCells, visibleTiles, zoomAt
} from './deep-map.js';

const IN_FLIGHT = 2;        // tiles asked of the worker at once
const TILE_CAP = 4000;      // tiles kept per room
const PLATE_CAP = 160;      // plates kept per room
const WHEEL_STEP = 1.25;    // zoom per wheel notch
const HOLD_MS = 260;        // a press this long without moving flies
const FLY_MAX = 4;          // decades of zoom a second, at full speed
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

const STRIP_CHUNK = 16;     // sizes the worker reads for the shelf at once
const STRIP_MIN = 14;       // the narrowest a size's cell on the shelf gets
const STRIP_START = 120;    // and how wide the shelf opens: wide enough to name each size and its count
const STRIP_INSIDE = 160;   // from this wide, a size's cell shows its own first level
const STRIP_SHARE = 0.12;   // the top of the rail that is the shelf
// A layout whose numbers are this long (log10) works out a cell's block on
// the main thread when its tile has not come back yet; past it, a cold walk
// down from the top is too long for a frame, and the cell waits for the tile.
const CHEAP_DIGITS = 20000;

/** Per room: where the camera was and what has been read. Outlives the page. */
const rooms = new Map();

function roomState(wing, params) {
  const id = roomId(wing, params);
  let r = rooms.get(id);
  if (!r) {
    // `view` is the map on screen: a page re-rendered while tiles are in
    // flight builds a new one, and the answers must wake that one, not the
    // map they were asked for.
    r = {
      id, cam: null, size: null, strip: null,
      tiles: new Map(), strips: new Map(), inflight: new Set(), plates: new Map(), view: null, wake: () => {}
    };
    rooms.set(id, r);
    if (rooms.size > 4) rooms.delete(rooms.keys().next().value);
  }
  return r;
}

export function resetDeepMapsForTests() {
  // A map on a page the test has left still has its frames and tiles going
  // (the DOM stub never disconnects a canvas): detach it, so it stops.
  for (const r of rooms.values()) { r.view = null; r.wake = () => {}; }
  rooms.clear();
}

function powerOfTen(log10) {
  if (log10 < 9) return Math.round(10 ** log10).toLocaleString('en-US');
  const e = Math.floor(log10);
  return `${(10 ** (log10 - e)).toFixed(1)} × 10${String(e).split('').map(c => SUP[Number(c)]).join('')}`;
}

/** A count for a label: exact while short, a power of ten when long. */
function countWords(n) {
  return n < 1000000000n ? BigInt(n).toLocaleString('en-US') : powerOfTen(bigLog10(n));
}

function reducedMotion() {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
}

const clamp01 = x => Math.max(0, Math.min(1, x));

// ── Colours: a canvas cannot read var(), so the theme is resolved through a probe ──

let rgbaCtx;
function toRGBA(colour) {
  if (rgbaCtx === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      rgbaCtx = c.getContext?.('2d', { willReadFrequently: true }) || null;
    } catch { rgbaCtx = null; }
  }
  if (!rgbaCtx || !colour) return [128, 128, 128, 60];
  rgbaCtx.clearRect(0, 0, 1, 1);
  rgbaCtx.fillStyle = '#000';
  rgbaCtx.fillStyle = colour;
  rgbaCtx.fillRect(0, 0, 1, 1);
  return [...rgbaCtx.getImageData(0, 0, 1, 1).data];
}

function resolvePalette(host, wing) {
  const resolve = name => {
    try {
      const probe = h('span', { class: 'bab-probe', style: `color: var(${name})` });
      host.append(probe);
      const col = getComputedStyle(probe).color;
      probe.remove();
      return col || null;
    } catch { return null; }
  };
  const classes = cellClassesOf(wing).map(k => resolve(`--bab-${wing.kind}-${k.key}`) || '#888');
  const pending = resolve('--bab-pending') || 'rgba(128,128,128,.12)';
  const well = resolve('--lib-well') || '#fff', ink = resolve('--text') || '#222';
  const wellRgba = toRGBA(well);
  // A class colour may be translucent: judge it over the well it is drawn on.
  const light = ([r, g, b, a]) => {
    const mix = (x, y) => (x * a + y * (255 - a)) / 255;
    return (0.2126 * mix(r, wellRgba[0]) + 0.7152 * mix(g, wellRgba[1]) + 0.0722 * mix(b, wellRgba[2])) / 255 > 0.55;
  };
  const rgba = classes.map(toRGBA);
  const labelOn = rgba.map(c => (light(c) ? ink : well));
  labelOn[UNKNOWN] = ink;
  return {
    labelOn,
    classes, pending,
    unknown: resolve(`--bab-${wing.kind}-x`) || pending,
    well, ink, rgba,
    unknownRgba: toRGBA(resolve(`--bab-${wing.kind}-x`) || pending),
    pendingRgba: toRGBA(pending)
  };
}

/**
 * The map. `hooks`:
 *   lit            the class key the census bar has picked, or null
 *   reading(info)  paint the reading pane (info null: nothing under the pointer;
 *                  info.strip: a size on an endless room's shelf)
 *   plate(volume)  a plate button for one volume
 *   open(volume)   go to a volume's page
 *   tally(t)       what is on screen: { counts: Map key → n, done, total, exact }
 * Returns { el, pane } — the pane is the page's to fill.
 */
export function deepMapView(wing, params, hooks) {
  const room = roomState(wing, params);
  const shape = roomShape(wing, params);
  const endless = !shape.finite;
  const classes = cellClassesOf(wing);
  const litIndex = hooks.lit ? classes.findIndex(k => k.key === hooks.lit) : -1;

  const canvas = h('canvas', {
    class: 'bab-deep-canvas', tabindex: '0', role: 'img',
    'aria-label': endless
      ? `A map of ${room.id}: its sizes in a row, each zooming down to single volumes. Scroll or press + and − to zoom, drag or use the arrow keys to move, Enter to go into the size or block at the centre.`
      : `A map of ${room.id} that zooms from the whole room to single volumes. Scroll or press + and − to zoom, drag or use the arrow keys to move, Enter to zoom into the block at the centre.`
  });
  const plateLayer = h('div', { class: 'bab-deep-plates' });
  const thumb = h('div', { class: 'bab-deep-thumb' });
  const ticks = h('div', { class: 'bab-deep-ticks' });
  const track = h('div', { class: 'bab-deep-track' }, ticks, thumb);
  const rail = h('div', { class: 'bab-deep-rail', title: 'Depth: drag to go straight to any level' },
    h('span', { class: 'bab-deep-rail-end', text: endless ? 'sizes' : 'room' }), track, h('span', { class: 'bab-deep-rail-end', text: 'one' }));
  const frame = h('div', { class: 'bab-deep-frame lib-fig' }, canvas, plateLayer, rail);
  const scale = h('span', { class: 'bab-deep-scale' });
  const picks = h('span', { class: 'bab-deep-picks' });
  const pane = h('aside', { class: 'bab-reading', 'aria-live': 'polite' });
  const tool = (label, title, fn) => h('button', { type: 'button', class: 'lib-textbtn', title, on: { click: fn } }, label);
  const bar = h('div', { class: 'bab-map-bar bab-deep-bar' },
    h('div', { class: 'bab-deep-where' }, scale, picks),
    h('div', { class: 'bab-deep-tools' },
      tool(endless ? 'All sizes' : 'Whole room', endless ? 'Back out to the row of sizes (Home)' : 'Back out to the whole room (Home)', () => { wholeRoom(); afterMove(); }),
      tool('Zoom out', 'Out one level (−)', () => { zoomBy(1 / levelFan(), view.w / 2, view.h / 2); afterMove(); }),
      tool('Zoom in', 'In one level (+)', () => { zoomBy(levelFan(), view.w / 2, view.h / 2); afterMove(); })));
  const el = h('section', { class: 'bab-map-sec bab-deep' },
    bar,
    h('div', { class: 'bab-map-row' }, frame, pane),
    h('p', { class: 'bab-deep-how' }, endless
      ? 'Scroll to zoom · drag to move along the sizes · hold to fly in, with Shift to fly out · click a size to go into it, a block to zoom into it, a volume to open it'
      : 'Scroll to zoom · drag to move · hold to fly in, with Shift to fly out · click a block to zoom into it, a volume to open it'));

  // The rail runs down the right edge: the whole room is fitted clear of it.
  const view = { w: 640, h: 440, inset: 40 };
  const measure = () => {
    const w = Math.round(frame.clientWidth || 0), ht = Math.round(frame.clientHeight || 0);
    if (w > 40 && ht > 40) { view.w = w; view.h = ht; }
  };
  measure();

  // `layout` is what the camera is in: the room, or in an endless room the
  // size it is inside — null while it is on the shelf.
  let layout = null, cam = null, samples = samplesFor(wing);
  const strip = room.strip || (room.strip = { X: 0, s: STRIP_START });
  const useLayout = (lay, camera = null) => {
    layout = lay;
    cam = lay ? camera || makeCamera(lay, view) : null;
    if (lay) { normalize(cam, layout, view); samples = samplesFor(wing, lay); } else samples = samplesFor(wing);
    room.cam = cam;
  };
  if (!endless) useLayout(deepLayout(wing, params), room.cam);
  else if (room.size !== null) {
    const lay = sizeLayout(wing, params, room.size);
    if (lay) useLayout(lay, room.cam);
    else room.size = null;
  }
  const me = {};
  room.view = me;
  const base = () => layout?.base ?? 0n;
  const levelFan = () => (layout ? layout.levels[Math.min(cam.L, layout.D - 1)].cols : 2);

  let palette = null, themeKey = null, dead = false, connected = false;
  let waking = false;
  let raf = 0, lastT = 0, fly = null, anim = null, hover = null, readingDue = true, tallyAt = 0, tallyDirty = true;
  let lastScale = '', lastPicks = '', movedAt = 0;
  const SETTLE_MS = 140;

  // ── The frame loop: one frame per change, never a loop while only waiting ──
  const requestDraw = () => {
    if (raf || dead) return;
    raf = 1;
    let sync = true;
    const run = () => { if (sync) setTimeout(frameStep, 0); else frameStep(performance.now()); };
    (globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16)))(run);
    sync = false;
  };
  room.wake = () => { tallyDirty = true; if (hover) readingDue = true; requestDraw(); };
  const afterMove = () => { movedAt = performance.now(); tallyDirty = true; readingDue = true; requestDraw(); };

  function frameStep(t = performance.now()) {
    raf = 0;
    if (canvas.isConnected) connected = true;
    if (room.view !== me || (connected && !canvas.isConnected)) { dead = true; observer?.disconnect?.(); return; }
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
    lastT = t;
    if (fly) {
      const rate = Math.min(FLY_MAX, 0.8 + 2.2 * ((t - fly.t0) / 1000));
      zoomBy(10 ** (fly.dir * rate * dt), fly.x, fly.y);
      tallyDirty = true; readingDue = true; movedAt = t;
    }
    if (anim) stepAnimation(t);
    draw();
    ask();
    hud();
    const settled = t - movedAt > SETTLE_MS;
    if (readingDue && settled) { readingDue = false; hooks.reading(hover ? readingInfo(hover) : null); }
    if (tallyDirty && settled && t - tallyAt > 150) { tallyAt = t; tallyDirty = false; hooks.tally(tally()); }
    if ((readingDue || tallyDirty) && !waking) { waking = true; setTimeout(() => { waking = false; requestDraw(); }, SETTLE_MS + 20); }
    if (fly || anim || platesLeft) requestDraw();
    else lastT = 0;
  }

  // ── Moving: the shelf and the sizes are one zoom ─────────────────
  const enterWidth = () => 0.94 * Math.min(view.w - 2 * view.inset, view.h);
  // Size 0's left edge never comes in from the view's left edge — until a
  // cell is wider than half the view, when size 0 may sit in the middle.
  const clampStrip = () => { strip.X = Math.max(0.5, view.w / 2 / strip.s, strip.X); };

  function enterSize(size, over = 1) {
    const lay = sizeLayout(wing, params, size);
    if (!lay) return false;
    room.size = size;
    useLayout(lay);
    if (over > 1) zoomAt(cam, layout, view, over, view.w / 2, view.h / 2);
    hover = null;
    buildTicks();
    return true;
  }

  function leaveSize(scaleBy = 1) {
    const size = room.size;
    room.size = null;
    useLayout(null, null);
    strip.s = Math.max(STRIP_MIN, enterWidth() * 0.999 * scaleBy);
    if (size !== null) strip.X = size + 0.5;
    clampStrip();
    hover = null;
    buildTicks();
  }

  function stripZoom(f, px) {
    const world = strip.X + (px - view.w / 2) / strip.s;
    strip.s = Math.max(STRIP_MIN, strip.s * f);
    strip.X = world - (px - view.w / 2) / strip.s;
    clampStrip();
    if (strip.s >= enterWidth()) {
      // The size whose cell fills the view: from here it is a finite room.
      const size = Math.max(0, Math.floor(strip.X));
      if (!enterSize(size, strip.s / enterWidth())) strip.s = enterWidth() * 0.999;
    }
  }

  function zoomBy(f, px, py) {
    if (!layout) { stripZoom(f, px); return; }
    if (endless && f < 1 && cam.L === 1) {
      // Out past the whole size: back to the shelf, by as much as is left over.
      const r = depthRange(layout, view), d = depthOf(cam, layout) - Math.log10(f);
      if (d > r.top + 1e-9) { leaveSize(10 ** (r.top - d)); return; }
    }
    zoomAt(cam, layout, view, f, px, py);
  }

  function panPx(dx, dy) {
    if (!layout) { strip.X -= dx / strip.s; clampStrip(); return; }
    panBy(cam, layout, view, dx, dy);
  }

  function wholeRoom() {
    anim = null;
    if (!endless) { fitCamera(cam, layout, view); return; }
    if (layout) leaveSize();
    strip.s = STRIP_START;
    strip.X = 0;
    clampStrip();
  }

  // ── Tiles ───────────────────────────────────────────────────────
  const tileKey = (lay, key) => `${lay.id}#${key}`;

  function tileOf(key) {
    const t = room.tiles.get(key);
    if (t) { room.tiles.delete(key); room.tiles.set(key, t); }
    return t || null;
  }

  function keepTile(key, t) {
    room.tiles.set(key, t);
    while (room.tiles.size > TILE_CAP) room.tiles.delete(room.tiles.keys().next().value);
  }

  function askTile(lay, v) {
    const key = tileKey(lay, v.key);
    room.inflight.add(key);
    askBabel({
      type: 'tile', key: wing.key, params, size: lay.size ?? null,
      level: v.a, tx: `0x${v.TX.toString(16)}`, ty: `0x${v.TY.toString(16)}`, samples: samplesFor(wing, lay)
    }).then(reply => {
      room.inflight.delete(key);
      if (reply?.type === 'tile') {
        const big = s => (s === null || s === undefined ? null : BigInt(`0x${s}`));
        keepTile(key, { cells: reply.cells, spp: reply.spp, a: v.a, TX: v.TX, TY: v.TY, lo: big(reply.lo), hi: big(reply.hi) });
      }
      room.wake();
    });
  }

  function ask() {
    if (room.inflight.size >= IN_FLIGHT) return;
    const cx = view.w / 2, cy = view.h / 2;
    const byDistance = (p, q) => Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy) - Math.hypot(q.x + q.w / 2 - cx, q.y + q.h / 2 - cy);
    if (!layout) { askStrip(byDistance); return; }
    const missing = visibleTiles(cam, layout, view).filter(v => !room.tiles.has(tileKey(layout, v.key)) && !room.inflight.has(tileKey(layout, v.key)));
    missing.sort(byDistance);
    for (const v of missing.slice(0, IN_FLIGHT - room.inflight.size)) askTile(layout, v);
  }

  /** A tile as an image: one pixel a sample, so a cell of five samples is five stripes. */
  function bitmapOf(t, lv) {
    const key = `${themeKey}|${litIndex}`;
    if (t.bmp && t.bmpKey === key) return t.bmp;
    const w = lv.cols * t.spp, ht = lv.rows;
    const c = document.createElement('canvas');
    c.width = w; c.height = ht;
    const x = c.getContext?.('2d');
    if (!x) return null;
    const img = x.createImageData(w, ht), d = img.data;
    for (let i = 0; i < lv.cols * lv.rows; i++) {
      const row = Math.floor(i / lv.cols), col = i % lv.cols;
      for (let s = 0; s < t.spp; s++) {
        const k = t.cells[i * t.spp + s];
        if (k === VOID) continue;
        const rgba = colourOf(k);
        const o = (row * w + col * t.spp + s) * 4;
        d[o] = rgba[0]; d[o + 1] = rgba[1]; d[o + 2] = rgba[2]; d[o + 3] = rgba[3];
      }
    }
    x.putImageData(img, 0, 0);
    t.bmp = c; t.bmpKey = key;
    return c;
  }

  const colourOf = k => (litIndex >= 0 && k !== litIndex ? palette.pendingRgba : k === UNKNOWN ? palette.unknownRgba : palette.rgba[k] || palette.pendingRgba);

  /**
   * The block under a cell of the current layout: from its tile's run, which
   * the worker sends back, so the page never walks down from the top of a deep
   * room. Null past the room; undefined while it is not known yet.
   */
  function cellBlock(L, X, Y) {
    if (X < 0n || Y < 0n || X >= layout.W[L] || Y >= layout.H[L]) return null;
    const lv = layout.levels[L - 1];
    const t = room.tiles.get(tileKey(layout, `${L - 1}|${coordKey(X / lv.colsB)}|${coordKey(Y / lv.rowsB)}`));
    if (t) {
      if (t.lo === null || t.lo === undefined) return null;
      const lo = t.lo + BigInt(Number(Y % lv.rowsB) * lv.cols + Number(X % lv.colsB)) * lv.child;
      if (lo >= t.hi) return null;
      return { lo, hi: lo + lv.child < t.hi ? lo + lv.child : t.hi };
    }
    return layout.lvol[0] < CHEAP_DIGITS ? blockAt(layout, L, X, Y) : undefined;
  }

  // ── Drawing ─────────────────────────────────────────────────────
  let platesLeft = false;

  function draw() {
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const tk = document.documentElement?.getAttribute?.('data-theme') || '';
    if (!palette || tk !== themeKey) { palette = resolvePalette(frame, wing); themeKey = tk; }
    const dpr = globalThis.devicePixelRatio || 1;
    if (canvas.width !== Math.round(view.w * dpr) || canvas.height !== Math.round(view.h * dpr)) {
      canvas.width = Math.round(view.w * dpr); canvas.height = Math.round(view.h * dpr);
      canvas.style.width = `${view.w}px`; canvas.style.height = `${view.h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (!layout) { drawStrip(ctx); placePlates(false); return; }
    const sc = screenOf(cam, layout, view);
    const L = cam.L, W = layout.W[L], H = layout.H[L];
    const plates = L === layout.D && sc.cw >= PLATE_FROM;

    // The room, as "not read yet", then every tile that has been read.
    const rx0 = Math.max(0, sc.x(0n)), rx1 = Math.min(view.w, sc.x(W));
    const ry0 = Math.max(0, sc.y(0n)), ry1 = Math.min(view.h, sc.y(H));
    ctx.fillStyle = palette.pending;
    ctx.fillRect(rx0, ry0, Math.max(0, rx1 - rx0), Math.max(0, ry1 - ry0));
    ctx.imageSmoothingEnabled = false;
    const tiles = visibleTiles(cam, layout, view);
    const lv = layout.levels[L - 1];
    for (const v of tiles) {
      const t = tileOf(tileKey(layout, v.key));
      const bmp = t && bitmapOf(t, lv);
      if (bmp) ctx.drawImage(bmp, v.x, v.y, v.w, v.h);
    }

    // Gaps between cells, wider between blocks, once a cell is big enough to have them.
    const { X0, X1, Y0, Y1 } = visibleCells(cam, layout, view);
    if (Math.min(sc.cw, sc.ch) >= 5) {
      ctx.fillStyle = palette.well;
      const wide = Math.min(sc.cw, sc.ch) >= 14;
      for (let X = X0; X <= X1 + 1n; X++) {
        const edge = wide && X % lv.colsB === 0n;
        ctx.fillRect(sc.x(X) - (edge ? 1.5 : 0.5), ry0, edge ? 3 : 1, ry1 - ry0);
      }
      for (let Y = Y0; Y <= Y1 + 1n; Y++) {
        const edge = wide && Y % lv.rowsB === 0n;
        ctx.fillRect(rx0, sc.y(Y) - (edge ? 1.5 : 0.5), rx1 - rx0, edge ? 3 : 1);
      }
    }

    // At the bottom: a volume's last digits, then its plate.
    if (L === layout.D && !plates && sc.cw >= 34 && sc.ch >= 18) {
      ctx.font = `400 ${Math.min(12, Math.round(sc.cw / 6))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const v of tiles) {
        const t = room.tiles.get(tileKey(layout, v.key));
        if (!t || t.lo === null || t.lo === undefined) continue;
        const low = Number((base() + t.lo) % 10000n);
        const span = inView(v, X0, X1, Y0, Y1);
        for (let r = span.r0; r <= span.r1; r++) for (let c = span.c0; c <= span.c1; c++) {
          const i = r * lv.cols + c;
          const k = t.cells[i];
          if (k === VOID) continue;
          ctx.fillStyle = litIndex >= 0 && k !== litIndex ? palette.ink : palette.labelOn[k] || palette.ink;
          ctx.fillText(`…${String((low + i) % 10000).padStart(4, '0')}`, v.x + (c + 0.5) * sc.cw, v.y + (r + 0.5) * sc.ch);
        }
      }
    }
    placePlates(plates, sc, X0, X1, Y0, Y1);

    const mark = hover && !hover.strip && hover.L === L ? hover : null;
    if (mark && !plates) {
      ctx.strokeStyle = palette.ink; ctx.lineWidth = 1.5;
      ctx.strokeRect(sc.x(mark.X) + 0.75, sc.y(mark.Y) + 0.75, sc.cw - 1.5, sc.ch - 1.5);
    }
  }

  // ── The shelf ───────────────────────────────────────────────────
  /** A size's cell on the shelf: a square as wide as the zoom, never taller than the view. */
  function stripCell(size) {
    const side = Math.min(strip.s, view.h * 0.94);
    return { x: view.w / 2 + (size - strip.X) * strip.s, y: (view.h - side) / 2, w: strip.s, h: side };
  }

  function stripRange() {
    const first = Math.max(0, Math.floor(strip.X - view.w / 2 / strip.s));
    return { first, last: Math.max(first, Math.ceil(strip.X + view.w / 2 / strip.s)) };
  }

  function stripCells(size) {
    const chunk = room.strips.get(Math.floor(size / STRIP_CHUNK));
    if (!chunk) return null;
    const i = size % STRIP_CHUNK;
    return { cells: chunk.cells.slice(i * chunk.spp, (i + 1) * chunk.spp), spp: chunk.spp };
  }

  function drawStrip(ctx) {
    const { first, last } = stripRange();
    ctx.imageSmoothingEnabled = false;
    const gap = strip.s >= 24 ? 2 : 1;
    for (let size = first; size <= last; size++) {
      const r = stripCell(size);
      const got = stripCells(size);
      const cw = r.w - gap;
      if (!got) { ctx.fillStyle = palette.pending; ctx.fillRect(r.x, r.y, cw, r.h); continue; }
      if (got.cells[0] === VOID) continue;   // no machine is this size
      // The samples as stripes, as a tile's cell is drawn.
      for (let k = 0; k < got.spp; k++) {
        const rgba = colourOf(got.cells[k]);
        ctx.fillStyle = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${(rgba[3] / 255).toFixed(3)})`;
        ctx.fillRect(r.x + (cw * k) / got.spp, r.y, cw / got.spp + 0.5, r.h);
      }
      // Wide enough, a size shows its own first level, as going into it will draw it.
      if (strip.s >= STRIP_INSIDE) {
        const lay = sizeLayout(wing, params, size);
        const t = lay && room.tiles.get(tileKey(lay, '0|0|0'));
        const bmp = t && bitmapOf(t, lay.levels[0]);
        if (bmp) {
          const asp = (Number(lay.W[1]) * lay.aspect[1]) / Number(lay.H[1]);
          const fw = Math.min(cw * 0.94, r.h * 0.94 * asp), fh = fw / asp;
          ctx.fillStyle = palette.well;
          ctx.fillRect(r.x, r.y, cw, r.h);
          ctx.drawImage(bmp, r.x + (cw - fw) / 2, r.y + (r.h - fh) / 2, fw, fh);
        }
      }
    }
    // Each size's name and how many volumes it holds, once a cell has room for them.
    if (strip.s >= 44) {
      ctx.font = `400 ${strip.s >= 90 ? 12 : 10}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (let size = first; size <= last; size++) {
        const r = stripCell(size);
        const c = shape.count(size);
        const say = strip.s >= 90 ? `size ${size} · ${countWords(c)}` : String(size);
        ctx.fillStyle = palette.well;
        const tw = Math.min(r.w - 6, ctx.measureText?.(say)?.width ?? say.length * 7);
        ctx.fillRect(r.x + (r.w - tw) / 2 - 3, r.y + r.h - 18, tw + 6, 16);
        ctx.fillStyle = palette.ink;
        ctx.fillText(say, r.x + r.w / 2, r.y + r.h - 4, r.w - 6);
      }
    }
    if (hover?.strip) {
      const r = stripCell(hover.size);
      ctx.strokeStyle = palette.ink; ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.75, r.y + 0.75, r.w - gap - 1.5, r.h - 1.5);
    }
  }

  function askStrip(byDistance) {
    const { first, last } = stripRange();
    const want = [];
    for (let c = Math.floor(first / STRIP_CHUNK); c <= Math.floor(last / STRIP_CHUNK); c++) {
      const key = `strip#${c}`;
      if (!room.strips.has(c) && !room.inflight.has(key)) want.push({ c, key, x: stripCell(c * STRIP_CHUNK).x, y: 0, w: STRIP_CHUNK * strip.s, h: view.h });
    }
    // A wide cell shows its size's first level: read those too, once the shelf is in.
    if (strip.s >= STRIP_INSIDE && !want.length) {
      for (let size = first; size <= last; size++) {
        const lay = sizeLayout(wing, params, size);
        if (!lay) continue;
        const key = tileKey(lay, '0|0|0');
        if (room.tiles.has(key) || room.inflight.has(key)) continue;
        const r = stripCell(size);
        want.push({ lay, key, x: r.x, y: r.y, w: r.w, h: r.h });
      }
    }
    want.sort(byDistance);
    for (const v of want.slice(0, IN_FLIGHT - room.inflight.size)) {
      if (v.lay) { askTile(v.lay, { a: 0, TX: 0n, TY: 0n, key: '0|0|0' }); continue; }
      room.inflight.add(v.key);
      askBabel({ type: 'strip', key: wing.key, params, from: v.c * STRIP_CHUNK, count: STRIP_CHUNK, samples: samplesFor(wing) }).then(reply => {
        room.inflight.delete(v.key);
        if (reply?.type === 'strip') room.strips.set(v.c, { cells: reply.cells, spp: reply.spp });
        room.wake();
      });
    }
  }

  /** Plates are DOM: a few dozen at most, positioned over the canvas each frame. */
  function placePlates(on, sc, X0, X1, Y0, Y1) {
    platesLeft = false;
    plateLayer.hidden = !on;
    if (!on) { if (plateLayer.firstChild) plateLayer.innerHTML = ''; return; }
    const want = new Set();
    const started = performance.now();
    let made = 0;
    const pad = Math.max(4, sc.cw * 0.04);
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
      const b = cellBlock(cam.L, X, Y);
      if (!b) continue;
      const volume = base() + b.lo;
      const key = coordKey(volume);
      let p = room.plates.get(key);
      if (!p) {
        if (made >= 4 || performance.now() - started > 10) { platesLeft = true; continue; }
        made++;
        p = hooks.plate(volume);
        const at = { L: layout.D, X, Y };
        p.addEventListener('pointerenter', () => { hover = at; readingDue = true; requestDraw(); });
        room.plates.set(key, p);
        while (room.plates.size > PLATE_CAP) room.plates.delete(room.plates.keys().next().value);
      }
      want.add(p);
      p.style.transform = `translate(${(sc.x(X) + pad).toFixed(1)}px, ${(sc.y(Y) + pad).toFixed(1)}px)`;
      p.style.width = `${(sc.cw - pad * 2).toFixed(1)}px`;
      p.style.height = `${(sc.ch - pad * 2).toFixed(1)}px`;
      if (p.parentNode !== plateLayer) plateLayer.append(p);
    }
    for (const node of Array.from(plateLayer.children || [])) if (!want.has(node)) node.remove();
  }

  // ── Words above the map, and the rail ─────────────────────────────
  function hud() {
    let sLine, say;
    if (!layout) {
      const { first, last } = stripRange();
      sLine = `1 cell = 1 size · sizes ${first}–${last}`;
      say = 'each cell holds every volume of one size, and goes on to the right';
    } else {
      const L = cam.L;
      const s = L === layout.D ? '1 cell = 1 volume' : `1 cell ≈ ${powerOfTen(layout.lvol[L])} volumes`;
      const p = layout.picks[L - 1];
      say = '';
      // A room of one level is all one grid: there is nothing to tell its cells apart by but the cell.
      const names = [...new Set(p?.names || [])];
      if (layout.D === 1) say = '';
      else if (p?.down) say = `${p.down} ↓ · ${p.across} →`;
      else if (names.length) say = `${p.whole ? '' : 'part of '}${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
      if (say) say = `this level sets ${say}`;
      sLine = `${endless ? `size ${room.size} · ` : ''}${s} · level ${L} of ${layout.D}`;
    }
    if (sLine !== lastScale) { lastScale = sLine; scale.textContent = sLine; }
    if (say !== lastPicks) {
      lastPicks = say;
      picks.textContent = say;
      picks.title = layout ? 'What tells neighbouring cells apart at this level: the parts of the number it decides, rows then columns' : 'An endless room has no whole to fit on screen: its sizes are its top level';
    }
    thumb.style.top = `${(railAt() * 100).toFixed(2)}%`;
  }

  /** Where the view is on the rail, 0 (the top) to 1 (one volume). An endless room's shelf is its top part. */
  function railAt() {
    if (!layout) return STRIP_SHARE * clamp01(Math.log(strip.s / STRIP_MIN) / Math.log(enterWidth() / STRIP_MIN));
    const r = depthRange(layout, view);
    const at = clamp01((r.top - depthOf(cam, layout)) / (r.top - r.bottom || 1));
    return endless ? STRIP_SHARE + (1 - STRIP_SHARE) * at : at;
  }

  function buildTicks() {
    ticks.innerHTML = '';
    const put = at => ticks.append(h('i', { style: `top: ${(clamp01(at) * 100).toFixed(2)}%` }));
    if (endless) put(STRIP_SHARE);
    if (!layout) return;
    const r = depthRange(layout, view);
    const every = Math.max(1, Math.ceil(layout.D / 60));
    for (let l = 1; l <= layout.D; l += every) {
      const at = clamp01((r.top - levelDepth(layout, l)) / (r.top - r.bottom || 1));
      put(endless ? STRIP_SHARE + (1 - STRIP_SHARE) * at : at);
    }
  }

  function railTo(ev) {
    const box = track.getBoundingClientRect?.();
    if (!box || !box.height) return;
    let at = clamp01((ev.clientY - box.top) / box.height);
    if (endless) {
      if (at <= STRIP_SHARE) {
        if (layout) leaveSize();
        strip.s = Math.min(enterWidth() * 0.999, STRIP_MIN * (enterWidth() / STRIP_MIN) ** (at / STRIP_SHARE));
        clampStrip();
        afterMove();
        return;
      }
      if (!layout && !enterSize(Math.max(0, Math.floor(strip.X)))) return;
      at = (at - STRIP_SHARE) / (1 - STRIP_SHARE);
    }
    const r = depthRange(layout, view);
    const target = r.top - at * (r.top - r.bottom);
    zoomAt(cam, layout, view, 10 ** (depthOf(cam, layout) - target), view.w / 2, view.h / 2);
    afterMove();
  }
  rail.addEventListener('pointerdown', ev => {
    ev.preventDefault?.();
    capturePointer(rail, ev.pointerId);
    anim = null;
    railTo(ev);
    const move = e => railTo(e);
    const up = e => { releasePointer(rail, e.pointerId); rail.removeEventListener('pointermove', move); rail.removeEventListener('pointerup', up); };
    rail.addEventListener('pointermove', move);
    rail.addEventListener('pointerup', up);
  });

  // ── The reading pane's information ──────────────────────────────
  function readingInfo(at) {
    if (at.strip) {
      const got = stripCells(at.size);
      const count = shape.count(at.size);
      if (!(count > 0n)) return { strip: true, shelfSize: at.size, size: 0n, empty: true };
      const before = volumesBefore(shape, at.size);
      const key = k => (k === UNKNOWN ? 'x' : classes[k]?.key || null);
      const found = got ? Array.from(got.cells) : null;
      return {
        strip: true, shelfSize: at.size, size: count, block: { lo: before, hi: before + count },
        volumes: stripSamples(wing, params, at.size, samplesFor(wing)),
        classes: found ? found.map(key) : null,
        majority: found ? key(majorityOf(Uint8Array.from(found), 0, found.length)) : null
      };
    }
    const block = cellBlock(at.L, at.X, at.Y);
    if (!block) return null;
    const exact = block.hi - block.lo === 1n;
    const spp = exact ? 1 : samples;
    const lv = layout.levels[at.L - 1];
    const t = room.tiles.get(tileKey(layout, `${at.L - 1}|${coordKey(at.X / lv.colsB)}|${coordKey(at.Y / lv.rowsB)}`));
    const i = Number(at.Y % lv.rowsB) * lv.cols + Number(at.X % lv.colsB);
    const found = t ? Array.from(t.cells.slice(i * t.spp, (i + 1) * t.spp)) : null;
    const key = k => (k === UNKNOWN ? 'x' : classes[k]?.key || null);
    const b = base();
    return {
      level: at.L, levels: layout.D, inSize: endless ? room.size : null,
      block: { lo: b + block.lo, hi: b + block.hi }, exact, size: block.hi - block.lo,
      volumes: samplesOf(layout, at.L, at.X, at.Y, block, spp).map(v => b + v),
      classes: found ? found.map(key) : null,
      majority: found ? key(majorityOf(Uint8Array.from(found), 0, found.length)) : null
    };
  }

  /** The cells of a tile that are in view, as local rows and columns. */
  function inView(v, X0, X1, Y0, Y1) {
    const lv = layout.levels[v.a];
    const bx = v.TX * lv.colsB, by = v.TY * lv.rowsB;
    const local = (lo, hi, base, n) => [Math.max(0, Number(lo - base)), Math.min(n - 1, Number(hi - base))];
    const [c0, c1] = local(X0, X1, bx, lv.cols), [r0, r1] = local(Y0, Y1, by, lv.rows);
    return { c0, c1, r0, r1 };
  }

  function tally() {
    const counts = new Map();
    let done = 0, total = 0;
    const count = k => {
      const name = k === UNKNOWN ? 'x' : classes[k]?.key;
      counts.set(name, (counts.get(name) || 0) + 1);
      done++;
    };
    if (!layout) {
      const { first, last } = stripRange();
      for (let size = first; size <= last; size++) {
        const got = stripCells(size);
        if (got && got.cells[0] === VOID) continue;
        total += got ? got.spp : samples;
        if (got) for (const k of got.cells) count(k);
      }
      return { counts, done, total, exact: false };
    }
    const { X0, X1, Y0, Y1 } = visibleCells(cam, layout, view);
    const lv = layout.levels[cam.L - 1];
    for (const v of visibleTiles(cam, layout, view)) {
      const t = room.tiles.get(tileKey(layout, v.key));
      const span = inView(v, X0, X1, Y0, Y1);
      for (let r = span.r0; r <= span.r1; r++) {
        for (let c = span.c0; c <= span.c1; c++) {
          const i = r * lv.cols + c;
          const spp = t ? t.spp : (cam.L === layout.D ? 1 : samples);
          if (t && t.cells[i * spp] === VOID) continue;
          total += spp;
          if (!t) continue;
          for (let s = 0; s < spp; s++) count(t.cells[i * spp + s]);
        }
      }
    }
    // At the bottom level a cell is one volume and its one reading is the
    // volume's own answer: the counts are exact, not a sample.
    return { counts, done, total, exact: cam.L === layout.D };
  }

  // ── Moving smoothly ─────────────────────────────────────────────
  /** Zoom smoothly until one cell fills most of the view. */
  function zoomInto(at) {
    const now = performance.now();
    anim = { ...at, t0: now, last: now, T: reducedMotion() ? 0 : 340 };
    requestDraw();
  }
  function stepAnimation(t) {
    const left = anim.T - (t - anim.t0);
    const k = left <= 1 ? 1 : Math.min(1, (t - anim.last) / left);
    anim.last = t;
    if (anim.strip) {
      // Into a size: centre it and grow it until it is the size's own map.
      if (layout) { anim = null; return; }
      const r = stripCell(anim.size);
      panPx((view.w / 2 - (r.x + r.w / 2)) * k, 0);
      stripZoom((enterWidth() * 1.0005 / strip.s) ** k, view.w / 2);
      tallyDirty = true; readingDue = true; movedAt = t;
      if (k >= 1 || layout) anim = null;
      return;
    }
    if (!layout) { anim = null; return; }
    // Where the target cell is now, at whatever level the camera has reached.
    let X = anim.X, Y = anim.Y, w = 1, ht = 1;
    const sc = screenOf(cam, layout, view);
    if (cam.L >= anim.L) {
      for (let l = anim.L; l < cam.L; l++) { X *= layout.levels[l].colsB; Y *= layout.levels[l].rowsB; w *= layout.levels[l].cols; ht *= layout.levels[l].rows; }
      w *= sc.cw; ht *= sc.ch;
    } else { anim = null; return; }
    const px = sc.x(X) + w / 2, py = sc.y(Y) + ht / 2;
    const want = 0.8 * Math.min(view.w, view.h * (w / ht));
    panBy(cam, layout, view, (view.w / 2 - px) * k, (view.h / 2 - py) * k);
    zoomAt(cam, layout, view, (want / w) ** k, view.w / 2, view.h / 2);
    tallyDirty = true; readingDue = true; movedAt = t;
    if (k >= 1) anim = null;
  }

  // Measuring the canvas forces a layout once plates have moved, so a burst of
  // wheel events reuses one measurement; a press always measures afresh.
  let rect = null, rectAt = 0;
  const local = (ev, fresh = false) => {
    const now = performance.now();
    if (fresh || !rect || now - rectAt > 250) { rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 }; rectAt = now; }
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  /** What is under a point of the view: a size on the shelf, a cell of the layout, or nothing. */
  function pointAt(p) {
    if (!layout) {
      const size = Math.floor(strip.X + (p.x - view.w / 2) / strip.s);
      const r = stripCell(size);
      return size >= 0 && p.y >= r.y && p.y <= r.y + r.h ? { strip: true, size } : null;
    }
    const c = cellAt(cam, layout, view, p.x, p.y);
    return cellBlock(cam.L, c.X, c.Y) === null ? null : { L: cam.L, X: c.X, Y: c.Y };
  }
  const same = (a, b) => (a && b && (a.strip ? b.strip && a.size === b.size : !b.strip && a.L === b.L && a.X === b.X && a.Y === b.Y));

  const setHover = p => {
    if (!p) { if (hover) { hover = null; readingDue = true; requestDraw(); } return; }
    const next = pointAt(p);
    if (same(next, hover)) return;
    if (!next && !hover) return;
    hover = next; readingDue = true; requestDraw();
  };

  /** A click or Enter on a point: open a volume, zoom into a block, or go into a size. */
  function activate(p) {
    const at = pointAt(p);
    if (!at) return;
    if (at.strip) { if (shape.count(at.size) > 0n) zoomInto(at); return; }
    const b = cellBlock(at.L, at.X, at.Y);
    if (b && b.hi - b.lo === 1n) hooks.open(base() + b.lo);
    else zoomInto(at);
  }

  const pointers = new Map();
  let press = null, holdTimer = 0, pinch = null;
  canvas.addEventListener('pointerdown', ev => {
    canvas.focus?.({ preventScroll: true });
    capturePointer(canvas, ev.pointerId);
    const p = local(ev, true);
    pointers.set(ev.pointerId, p);
    clearTimeout(holdTimer);
    anim = null;
    if (pointers.size === 2) {
      const [A, B] = [...pointers.values()];
      pinch = { d: Math.hypot(A.x - B.x, A.y - B.y), mx: (A.x + B.x) / 2, my: (A.y + B.y) / 2 };
      press = null; fly = null;
      return;
    }
    press = { x: p.x, y: p.y, lx: p.x, ly: p.y, moved: false, flew: false };
    const dir = ev.shiftKey || ev.button === 2 ? -1 : 1;
    holdTimer = setTimeout(() => {
      if (!press || press.moved) return;
      fly = { dir, t0: performance.now(), x: press.lx, y: press.ly };
      press.flew = true;
      frame.classList.add('is-flying');
      requestDraw();
    }, HOLD_MS);
  });
  canvas.addEventListener('pointermove', ev => {
    const p = local(ev);
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [A, B] = [...pointers.values()];
      const d = Math.hypot(A.x - B.x, A.y - B.y), mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      panPx(mx - pinch.mx, my - pinch.my);
      if (pinch.d > 0 && d > 0) zoomBy(d / pinch.d, mx, my);
      pinch = { d, mx, my };
      afterMove();
      return;
    }
    if (press) {
      if (fly) { fly.x = p.x; fly.y = p.y; return; }
      if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 4) { press.moved = true; clearTimeout(holdTimer); frame.classList.add('is-panning'); }
      if (press.moved) { panPx(p.x - press.lx, p.y - press.ly); press.lx = p.x; press.ly = p.y; afterMove(); }
      return;
    }
    setHover(p);
  });
  const release = ev => {
    releasePointer(canvas, ev.pointerId);
    pointers.delete(ev.pointerId);
    clearTimeout(holdTimer);
    frame.classList.remove('is-flying', 'is-panning');
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    const tap = press && !press.moved && !press.flew && ev.type === 'pointerup' && ev.button !== 2;
    press = null; fly = null;
    if (tap) activate(local(ev));
    requestDraw();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!press) setHover(null); });
  canvas.addEventListener('contextmenu', ev => ev.preventDefault?.());
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault?.();
    anim = null;
    const p = local(ev);
    const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
    zoomBy(WHEEL_STEP ** Math.max(-4, Math.min(4, -dy / 100)), p.x, p.y);
    hover = null;
    setHover(p);
    afterMove();
  }, { passive: false });
  canvas.addEventListener('keydown', ev => {
    const k = ev.key;
    if (k === '+' || k === '=') zoomBy(WHEEL_STEP ** 2, view.w / 2, view.h / 2);
    else if (k === '-' || k === '_') zoomBy(WHEEL_STEP ** -2, view.w / 2, view.h / 2);
    else if (k === 'ArrowLeft') panPx(60, 0);
    else if (k === 'ArrowRight') panPx(-60, 0);
    else if (k === 'ArrowUp') panPx(0, 60);
    else if (k === 'ArrowDown') panPx(0, -60);
    else if (k === 'Home') wholeRoom();
    else if (k === 'Enter') activate({ x: view.w / 2, y: view.h / 2 });
    else return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    afterMove();
  });

  let observer = null;
  const refit = () => { if (layout) normalize(cam, layout, view); else clampStrip(); };
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      const w = view.w, ht = view.h;
      measure();
      if (w !== view.w || ht !== view.h) { refit(); buildTicks(); afterMove(); }
    });
    observer.observe?.(frame);
  }
  refit();
  buildTicks();
  setTimeout(() => { measure(); refit(); buildTicks(); afterMove(); }, 0);
  return { el, pane };
}
