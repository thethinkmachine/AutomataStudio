// The label stage's inner loop, compiled to WebAssembly.
//
// This is a port of labelPenalty and the grid it queries out of
// js/geometry.js, and it is deliberately a *port* rather than a second design:
// the two have to answer the same number for the same diagram, so the grid's
// probe order, its insertion order within a cell and the arithmetic of each
// predicate are all reproduced exactly. tests/label-penalty-wasm.test.js is
// what holds them together.
//
// Three grids live here rather than one because labelPenalty asks all three per
// candidate box, and the crossing back into JS between them was most of what
// this exists to remove.

const NODE: i32 = 0;    // stride 3: x, y, radius
const LABEL: i32 = 1;   // stride 5: rect x, y, w, h, edge id
const SAMPLE: i32 = 2;  // stride 3: x, y, edge id

const STRIDES: StaticArray<i32> = [3, 5, 3];

class Grid {
  cell: f64 = 1;
  stride: i32 = 3;
  slots: i32 = 32;
  mask: i32 = 31;
  used: i32 = 0;
  count: i32 = 0;
  keys: Int32Array = new Int32Array(32);
  head: Int32Array = new Int32Array(32);
  tail: Int32Array = new Int32Array(32);
  next: Int32Array = new Int32Array(64);
  data: Float64Array = new Float64Array(64 * 3);
  out: Int32Array = new Int32Array(64);

  reset(cell: f64, stride: i32): void {
    this.cell = cell < 1 ? 1 : cell;
    this.stride = stride;
    this.slots = 32; this.mask = 31; this.used = 0; this.count = 0;
    this.keys = new Int32Array(32);
    this.head = new Int32Array(32);
    this.tail = new Int32Array(32);
    for (let i = 0; i < 32; i++) unchecked(this.head[i] = -1);
    if (this.next.length < 64) this.next = new Int32Array(64);
    if (this.out.length < 64) this.out = new Int32Array(64);
    if (this.data.length < 64 * stride) this.data = new Float64Array(64 * stride);
  }

  @inline slot(k: i32): i32 {
    let i = gridHash(k) & this.mask;
    while (unchecked(this.head[i]) != -1 && unchecked(this.keys[i]) != k) i = (i + 1) & this.mask;
    return i;
  }

  grow(): void {
    const oldSlots = this.slots;
    const oldKeys = this.keys, oldHead = this.head, oldTail = this.tail;
    const slots = oldSlots * 2;
    const keys = new Int32Array(slots), head = new Int32Array(slots), tail = new Int32Array(slots);
    for (let i = 0; i < slots; i++) unchecked(head[i] = -1);
    this.slots = slots; this.mask = slots - 1;
    this.keys = keys; this.head = head; this.tail = tail;
    for (let i = 0; i < oldSlots; i++) {
      if (unchecked(oldHead[i]) == -1) continue;
      const k = unchecked(oldKeys[i]);
      const s = this.slot(k);
      unchecked(keys[s] = k);
      unchecked(head[s] = unchecked(oldHead[i]));
      unchecked(tail[s] = unchecked(oldTail[i]));
    }
  }

  // Returns the new item's index, which is where `stride` numbers go in `data`.
  add(x: f64, y: f64): i32 {
    const id = this.count++;
    if (id >= this.next.length) {
      const cap = this.next.length * 2;
      const next = new Int32Array(cap); next.set(this.next); this.next = next;
      const data = new Float64Array(cap * this.stride); data.set(this.data); this.data = data;
      this.out = new Int32Array(cap);
    }
    unchecked(this.next[id] = -1);

    const k = gridKey(<i32>Math.floor(x / this.cell), <i32>Math.floor(y / this.cell));
    let s = this.slot(k);
    if (unchecked(this.head[s]) == -1) {
      if ((this.used + 1) * 2 > this.slots) { this.grow(); s = this.slot(k); }
      unchecked(this.keys[s] = k);
      unchecked(this.head[s] = id);
      this.used++;
    } else {
      unchecked(this.next[unchecked(this.tail[s])] = id);
    }
    unchecked(this.tail[s] = id);
    return id;
  }

  // Fills `out` with the indices in the cells covering the box, and answers how
  // many. Past the cell budget it degrades to every index, exactly as the JS
  // does — an edge long enough to span the diagram is cheaper to scan whole.
  query(x0: f64, y0: f64, x1: f64, y1: f64): i32 {
    const c = this.cell;
    const cx0 = <i32>Math.floor(x0 / c), cx1 = <i32>Math.floor(x1 / c);
    const cy0 = <i32>Math.floor(y0 / c), cy1 = <i32>Math.floor(y1 / c);
    const count = this.count;
    const out = this.out;
    const cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (cells > 512 || cells < 0) {
      for (let i = 0; i < count; i++) unchecked(out[i] = i);
      return count;
    }
    const mask = this.mask, keys = this.keys, head = this.head, next = this.next;
    let n = 0;
    for (let ix = cx0; ix <= cx1; ix++) {
      for (let iy = cy0; iy <= cy1; iy++) {
        const k = gridKey(ix, iy);
        let s = gridHash(k) & mask;
        while (unchecked(head[s]) != -1 && unchecked(keys[s]) != k) s = (s + 1) & mask;
        if (unchecked(head[s]) == -1) continue;
        for (let id = unchecked(head[s]); id != -1; id = unchecked(next[id])) unchecked(out[n++] = id);
      }
    }
    return n;
  }
}

@inline function gridKey(ix: i32, iy: i32): i32 { return ((ix & 0xffff) << 16) | (iy & 0xffff); }

@inline function gridHash(k: i32): i32 {
  let h = k;
  h = (h ^ (h >>> 16)) * 0x45d9f3b;
  h = (h ^ (h >>> 16)) * 0x45d9f3b;
  return (h ^ (h >>> 16));
}

const grids: StaticArray<Grid> = [new Grid(), new Grid(), new Grid()];

export function resetGrids(cell: f64): void {
  for (let i = 0; i < 3; i++) unchecked(grids[i]).reset(cell, unchecked(STRIDES[i]));
}

export function addNode(x: f64, y: f64, r: f64): void {
  const g = unchecked(grids[NODE]);
  const b = g.add(x, y) * 3;
  const d = g.data;
  unchecked(d[b] = x); unchecked(d[b + 1] = y); unchecked(d[b + 2] = r);
}

export function addSample(x: f64, y: f64, keyId: f64): void {
  const g = unchecked(grids[SAMPLE]);
  const b = g.add(x, y) * 3;
  const d = g.data;
  unchecked(d[b] = x); unchecked(d[b + 1] = y); unchecked(d[b + 2] = keyId);
}

// Filed by its centre and tested as a rect, so the cell coordinates are not the
// payload — the same split the JS side makes.
export function addLabel(x: f64, y: f64, w: f64, h: f64, keyId: f64): void {
  const g = unchecked(grids[LABEL]);
  const b = g.add(x + w / 2, y + h / 2) * 5;
  const d = g.data;
  unchecked(d[b] = x); unchecked(d[b + 1] = y);
  unchecked(d[b + 2] = w); unchecked(d[b + 3] = h);
  unchecked(d[b + 4] = keyId);
}

// How much trouble a label box is in where it is: nothing at all, or a weighted
// sum of how deep into each obstacle it sits. The three loops and their weights
// are the JS function's, line for line.
export function labelPenalty(
  bx: f64, by: f64, bw: f64, bh: f64, ownKeyId: f64, gap: f64, pad: f64
): f64 {
  const bx1 = bx + bw, by1 = by + bh;
  let penalty: f64 = 0;

  const nodes = unchecked(grids[NODE]);
  let n = nodes.query(bx - pad, by - pad, bx1 + pad, by1 + pad);
  let out = nodes.out;
  let d = nodes.data;
  for (let i = 0; i < n; i++) {
    const b = unchecked(out[i]) * 3;
    const cx = unchecked(d[b]), cy = unchecked(d[b + 1]);
    const nx = cx < bx ? bx : (cx > bx1 ? bx1 : cx);
    const ny = cy < by ? by : (cy > by1 ? by1 : cy);
    const dx = cx - nx, dy = cy - ny;
    const over = (unchecked(d[b + 2]) + gap) - Math.sqrt(dx * dx + dy * dy);
    if (over > 0) penalty += over * 3;
  }

  const gx = bx - gap, gy = by - gap;
  const gx1 = bx1 + gap, gy1 = by1 + gap;

  const boxes = unchecked(grids[LABEL]);
  n = boxes.query(gx, gy, gx1, gy1);
  out = boxes.out;
  d = boxes.data;
  for (let i = 0; i < n; i++) {
    const b = unchecked(out[i]) * 5;
    const lx = unchecked(d[b]), ly = unchecked(d[b + 1]);
    const rx = lx + unchecked(d[b + 2]), ry = ly + unchecked(d[b + 3]);
    const ox = (gx1 < rx ? gx1 : rx) - (gx > lx ? gx : lx);
    if (ox <= 0) continue;
    const oy = (gy1 < ry ? gy1 : ry) - (gy > ly ? gy : ly);
    if (oy <= 0) continue;
    penalty += (ox < oy ? ox : oy) * 2;
  }

  const edges = unchecked(grids[SAMPLE]);
  n = edges.query(gx, gy, gx1, gy1);
  out = edges.out;
  d = edges.data;
  for (let i = 0; i < n; i++) {
    const b = unchecked(out[i]) * 3;
    if (unchecked(d[b + 2]) == ownKeyId) continue;
    const px = unchecked(d[b]), py = unchecked(d[b + 1]);
    if (px >= gx && px <= gx1 && py >= gy && py <= gy1) penalty += 5;
  }

  return penalty;
}
