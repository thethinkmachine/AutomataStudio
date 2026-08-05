import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context } = harness;

function reset() {
  harness.resetApp();
}

test('createDivider stores geometry and assigns sequential ids', () => {
  reset();
  const { App, createDivider } = context;
  const a = createDivider('line', 0, 0, 100, 0);
  const b = createDivider('line', 0, 50, 100, 50);
  assert.strictEqual(App.dividers.length, 2);
  assert.strictEqual(a.id, 'd1');
  assert.strictEqual(b.id, 'd2');
  assert.deepStrictEqual(
    { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 },
    { x1: 0, y1: 0, x2: 100, y2: 0 }
  );
  assert.strictEqual(a.style, 'dashed');
  assert.strictEqual(a.color, 'slate');
  assert.strictEqual(a.kind, 'line');
});

test('deleteDivider removes only the target and clears its selection', () => {
  reset();
  const { App, createDivider, deleteDivider, selectDivider } = context;
  createDivider('line', 0, 0, 10, 0);
  const b = createDivider('line', 0, 20, 10, 20);
  selectDivider(b.id);
  deleteDivider(b.id);
  assert.strictEqual(App.dividers.length, 1);
  assert.strictEqual(App.dividers[0].id, 'd1');
  assert.strictEqual(App.selectedDividerId, null);
});

test('shift-constrain snaps a segment to the nearest 45° spoke', () => {
  const { constrainDividerPoint } = context;
  const anchor = { x: 0, y: 0 };
  // Nearly horizontal → exactly horizontal, length preserved.
  const flat = constrainDividerPoint(anchor, { x: 100, y: 7 }, true, 'line');
  assert.ok(Math.abs(flat.y) < 1e-9, `expected y≈0, got ${flat.y}`);
  assert.ok(Math.abs(flat.x - Math.hypot(100, 7)) < 1e-9);
  // Nearly vertical → exactly vertical.
  const upright = constrainDividerPoint(anchor, { x: -5, y: -80 }, true, 'line');
  assert.ok(Math.abs(upright.x) < 1e-9, `expected x≈0, got ${upright.x}`);
  // Nearly diagonal → exactly 45°.
  const diag = constrainDividerPoint(anchor, { x: 60, y: 55 }, true, 'line');
  assert.ok(Math.abs(diag.x - diag.y) < 1e-9);
  // Without Shift the point passes through untouched.
  const passthrough = constrainDividerPoint(anchor, { x: 3, y: 9 }, false, 'line');
  assert.deepEqual({ x: passthrough.x, y: passthrough.y }, { x: 3, y: 9 });
});

test('grid snap applies only when snapToGrid is enabled', () => {
  reset();
  const { App, snapDividerPoint } = context;
  App.config.gridSnap = 20;
  App.config.snapToGrid = false;
  const loose = snapDividerPoint({ x: 27, y: 33 });
  assert.deepEqual({ x: loose.x, y: loose.y }, { x: 27, y: 33 });
  App.config.snapToGrid = true;
  const snapped = snapDividerPoint({ x: 27, y: 33 });
  assert.deepEqual({ x: snapped.x, y: snapped.y }, { x: 20, y: 40 });
});

test('label angle keeps text upright for right-to-left segments', () => {
  const { dividerLabelAngle } = context;
  // Drawn leftward: raw atan2 is 180°, which would render the label mirrored.
  assert.strictEqual(dividerLabelAngle({ x1: 100, y1: 0, x2: 0, y2: 0 }), 0);
  assert.strictEqual(dividerLabelAngle({ x1: 0, y1: 0, x2: 100, y2: 0 }), 0);
  const steep = dividerLabelAngle({ x1: 0, y1: 100, x2: 0, y2: 0 });
  assert.ok(steep >= -90 && steep <= 90, `angle ${steep} outside upright range`);
});

test('straighten snaps to the dominant axis about the midpoint', () => {
  reset();
  const { App, createDivider, ctxStraightenDivider } = context;
  const d = createDivider('line', 0, 0, 100, 12);
  App.ctxDividerId = d.id;
  ctxStraightenDivider();
  assert.strictEqual(d.y1, d.y2, 'a mostly-horizontal line should end up horizontal');
  assert.strictEqual(d.y1, 6, 'it should pivot about its own midpoint');

  const v = createDivider('line', 0, 0, 9, 100);
  App.ctxDividerId = v.id;
  ctxStraightenDivider();
  assert.strictEqual(v.x1, v.x2, 'a mostly-vertical line should end up vertical');
});

test('dividers survive a save/load round trip', () => {
  reset();
  const { App, createDivider, getWorkspaceData, loadData } = context;
  const d = createDivider('line', 10, 20, 110, 20);
  d.label = 'Phase 1 / Phase 2';
  d.color = 'blue';
  d.style = 'solid';

  const saved = JSON.parse(JSON.stringify(getWorkspaceData()));
  reset();
  assert.strictEqual(App.dividers.length, 0);

  loadData(saved, false);
  assert.strictEqual(App.dividers.length, 1);
  assert.deepEqual({ ...App.dividers[0] }, {
    id: 'd1', kind: 'line', x1: 10, y1: 20, x2: 110, y2: 20,
    color: 'blue', style: 'solid', label: 'Phase 1 / Phase 2'
  });
  // resetIds must count dividers too, or the next new divider reuses 'd1'.
  assert.strictEqual(App.dividerN, 1);
});

test('loading a file without dividers leaves the list empty, not undefined', () => {
  reset();
  const { App, loadData } = context;
  loadData({ machine: 'DFA', states: [], transitions: [], sigma: ['a'] }, false);
  assert.ok(Array.isArray(App.dividers) || App.dividers.length === 0);
  assert.strictEqual(App.dividers.length, 0);
});

test('validation rejects dividers with non-finite coordinates', () => {
  const { validateSchema } = context;
  const base = { machine: 'DFA', sigma: ['a'], accepts: [], states: [], transitions: [] };
  assert.throws(
    () => validateSchema({ ...base, dividers: [{ id: 'd1', x1: 0, y1: 0, x2: 'oops', y2: 0 }] }),
    /finite/
  );
  assert.throws(
    () => validateSchema({ ...base, dividers: [{ x1: 0, y1: 0, x2: 1, y2: 1 }] }),
    /'id'/
  );
  assert.doesNotThrow(
    () => validateSchema({ ...base, dividers: [{ id: 'd1', x1: 0, y1: 0, x2: 1, y2: 1 }] })
  );
});

test('normalizers fall back to defaults for unknown values', () => {
  const { normalizeDividerColor, normalizeDividerStyle, normalizeDividerKind } = context;
  assert.strictEqual(normalizeDividerColor('chartreuse'), 'slate');
  assert.strictEqual(normalizeDividerColor('blue'), 'blue');
  assert.strictEqual(normalizeDividerStyle('wavy'), 'dashed');
  assert.strictEqual(normalizeDividerStyle('dotted'), 'dotted');
  assert.strictEqual(normalizeDividerKind('blob'), 'line');
  assert.strictEqual(normalizeDividerKind('rect'), 'rect');
  // Files written before rectangles existed have no `kind` and must read as lines.
  assert.strictEqual(normalizeDividerKind(undefined), 'line');
});

// ── Rectangles ──────────────────────────────────────────────────────

test('rect box is normalized no matter which corner was dragged from', () => {
  const { dividerRectBox } = context;
  const drawnDownRight = dividerRectBox({ kind: 'rect', x1: 10, y1: 20, x2: 110, y2: 90 });
  const drawnUpLeft = dividerRectBox({ kind: 'rect', x1: 110, y1: 90, x2: 10, y2: 20 });
  assert.deepEqual({ ...drawnDownRight }, { x: 10, y: 20, w: 100, h: 70 });
  assert.deepEqual({ ...drawnUpLeft }, { x: 10, y: 20, w: 100, h: 70 });
});

test('shift on a rect produces a square anchored at the start corner', () => {
  const { constrainDividerPoint } = context;
  const anchor = { x: 0, y: 0 };
  const sq = constrainDividerPoint(anchor, { x: 100, y: 40 }, true, 'rect');
  assert.deepEqual({ x: sq.x, y: sq.y }, { x: 100, y: 100 }, 'longest side wins');
  // Dragging up-left must stay up-left, not flip across the anchor.
  const up = constrainDividerPoint(anchor, { x: -80, y: -20 }, true, 'rect');
  assert.deepEqual({ x: up.x, y: up.y }, { x: -80, y: -80 });
  const mixed = constrainDividerPoint(anchor, { x: 60, y: -90 }, true, 'rect');
  assert.deepEqual({ x: mixed.x, y: mixed.y }, { x: 90, y: -90 });
});

test('a rect exposes four corner handles, a line exposes two endpoints', () => {
  const { dividerHandles } = context;
  const line = dividerHandles({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 });
  assert.strictEqual(line.length, 2);
  const rect = dividerHandles({ kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
  assert.strictEqual(rect.length, 4);
  assert.deepEqual(
    rect.map(h => [h.x, h.y]).sort(),
    [[0, 0], [0, 50], [100, 0], [100, 50]].sort()
  );
});

test('dragging a rect corner pivots on the diagonally opposite corner', () => {
  const { dividerHandleAnchor } = context;
  const d = { kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 };
  // Corner 1 is (x1,y1); its opposite is corner 3 at (x2,y2).
  assert.deepEqual({ ...dividerHandleAnchor(d, 1) }, { x: 100, y: 50 });
  assert.deepEqual({ ...dividerHandleAnchor(d, 2) }, { x: 0, y: 50 });
  assert.deepEqual({ ...dividerHandleAnchor(d, 3) }, { x: 0, y: 0 });
  assert.deepEqual({ ...dividerHandleAnchor(d, 4) }, { x: 100, y: 0 });
});

test('a rect label sits on the top edge and is never rotated', () => {
  const { dividerLabelAnchor, dividerLabelAngle } = context;
  const d = { kind: 'rect', x1: 10, y1: 20, x2: 110, y2: 90 };
  assert.deepEqual({ ...dividerLabelAnchor(d) }, { x: 60, y: 20 });
  assert.strictEqual(dividerLabelAngle(d), 0);
});

test('straighten is a no-op on a rect, which is axis-aligned already', () => {
  reset();
  const { App, createDivider, ctxStraightenDivider } = context;
  const r = createDivider('rect', 0, 0, 100, 40);
  App.ctxDividerId = r.id;
  ctxStraightenDivider();
  assert.deepEqual(
    { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 },
    { x1: 0, y1: 0, x2: 100, y2: 40 }
  );
});

test('rects round-trip through save/load alongside lines', () => {
  reset();
  const { App, createDivider, getWorkspaceData, loadData } = context;
  createDivider('line', 0, 0, 100, 0);
  const r = createDivider('rect', 20, 40, 200, 160);
  r.label = 'Accepting region';
  r.color = 'green';

  const saved = JSON.parse(JSON.stringify(getWorkspaceData()));
  reset();
  loadData(saved, false);

  assert.strictEqual(App.dividers.length, 2);
  assert.strictEqual(App.dividers[0].kind, 'line');
  const loaded = App.dividers[1];
  assert.strictEqual(loaded.kind, 'rect');
  assert.strictEqual(loaded.label, 'Accepting region');
  assert.strictEqual(loaded.color, 'green');
  assert.deepEqual(
    { x1: loaded.x1, y1: loaded.y1, x2: loaded.x2, y2: loaded.y2 },
    { x1: 20, y1: 40, x2: 200, y2: 160 }
  );
});

test('a rect contributes its full box to canvas bounds', () => {
  reset();
  const { createDivider, includeDividerBounds } = context;
  createDivider('rect', 200, 150, 40, 30); // drawn from the bottom-right corner
  const seen = [];
  includeDividerBounds((x0, y0, x1, y1) => seen.push([x0, y0, x1, y1]));
  assert.deepStrictEqual(seen, [[40, 30, 200, 150]]);
});

test('includeDividerBounds reports a normalized box regardless of draw direction', () => {
  reset();
  const { createDivider, includeDividerBounds } = context;
  createDivider('line', 100, 80, 20, 10); // drawn bottom-right → top-left
  const seen = [];
  includeDividerBounds((x0, y0, x1, y1) => seen.push([x0, y0, x1, y1]));
  assert.deepStrictEqual(seen, [[20, 10, 100, 80]]);
});
