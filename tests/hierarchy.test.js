import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Boxes, navigation and the component CRUD around them.
//
// A box is a state with a `callee`, drawn as a <rect> instead of a <circle>.
// That difference is where the renderer's key-by-id diff gets dangerous: the
// node registry would happily hand back the circle it built last time, and a
// <circle> ignores x/y/width/height in silence. Nothing throws, nothing logs,
// the box just never appears. Hence the eviction test below.

function boxUp(h, name) {
  const s = h.context.createState(100, 100, name || 'call');
  h.context.applyMachineSwitch('RSM');
  h.context.promoteToSubmachine(s.id);
  return s;
}

test('promoting a state turns it into a call site and creates the component', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = h.context.createState(100, 100, 'expr');
  assert.equal(App.components.length, 1, 'just the root to begin with');

  h.context.promoteToSubmachine(s.id);

  assert.ok(s.callee, 'the state now names a component');
  assert.equal(App.components.length, 2);
  assert.equal(h.context.getComponent(s.callee).name, 'expr');
  assert.equal(App.states.length, 1, 'the state itself stays on the parent canvas');
});

test('promoting keeps the id, so edges already attached survive', () => {
  const h = createHarness();
  const { App } = h.context;
  const a = h.context.createState(0, 0, 'a');
  const b = h.context.createState(200, 0, 'b');
  App.transitions.push({ id: h.context.newTId(), from: a.id, to: b.id, symbol: 'x' });

  h.context.promoteToSubmachine(b.id);

  assert.equal(App.transitions.length, 1);
  assert.equal(App.transitions[0].to, b.id, 'the incoming edge still points at the box');
});

// The silent one.
test('promoting a rendered state rebuilds its node as a rect', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = h.context.createState(100, 100, 'q0');
  h.context.renderAll();
  const before = App.domCache.states.get(s.id);
  assert.equal(before.__kind, 'state');
  assert.equal(before.__parts.shape.tagName, 'circle');

  h.context.promoteToSubmachine(s.id);
  h.context.renderAll();

  const after = App.domCache.states.get(s.id);
  assert.notEqual(after, before, 'the cached circle node must be evicted, not reused');
  assert.equal(after.__kind, 'box');
  assert.equal(after.__parts.shape.tagName, 'rect');
  assert.equal(Number(after.__parts.shape.getAttribute('width')) > 0, true,
    'a rect that kept circle attributes would have no width');
});

test('demoting rebuilds it back into a circle', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h);
  h.context.renderAll();
  assert.equal(App.domCache.states.get(s.id).__parts.shape.tagName, 'rect');

  h.context.demoteToState(s.id);
  h.context.renderAll();

  assert.equal(App.domCache.states.get(s.id).__parts.shape.tagName, 'circle');
  assert.equal(App.domCache.states.get(s.id).__kind, 'state');
});

test('a box renders the component it invokes underneath its own name', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h, 'call');
  h.context.renameComponent(s.callee, 'Expr');
  h.context.renderAll();

  const node = App.domCache.states.get(s.id);
  assert.ok(node.__parts.callee, 'a box carries a callee label');
  assert.equal(node.__parts.callee.textContent, 'Expr');
});

test('edges trim to the box boundary, not to the state radius', () => {
  const h = createHarness();
  const { App } = h.context;
  const a = h.context.createState(0, 0, 'a');
  const b = h.context.createState(400, 0, 'b');
  App.transitions.push({ id: h.context.newTId(), from: a.id, to: b.id, symbol: 'x' });
  h.context.renderAll();
  const circleD = App.domCache.transitions.get(`${a.id}|${b.id}`).__parts.pathEl.getAttribute('d');

  h.context.applyMachineSwitch('RSM');
  h.context.promoteToSubmachine(b.id);
  h.context.renderAll();
  const boxD = App.domCache.transitions.get(`${a.id}|${b.id}`).__parts.pathEl.getAttribute('d');

  assert.notEqual(boxD, circleD, 'the arrow must stop further out for a wider box');
  // Straight horizontal edge, so the endpoint x is the interesting number.
  const endX = Number(boxD.match(/L\s+([\d.]+)/)[1]);
  const { hw } = h.context.boxHalf(App.states[1]);
  assert.ok(endX < 400 - hw + 1, `arrow should stop at the box edge, ended at ${endX}`);
});

test('the start arrow clears a box that is the start node', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h, 'entry');
  App.startId = s.id;
  h.context.renderAll();

  const d = App.domCache.startArrow.getAttribute('d');
  const startX = Number(d.match(/M\s+(-?[\d.]+)/)[1]);
  const { hw } = h.context.boxHalf(s);
  assert.ok(startX <= s.x - hw - 1, `arrow should start left of the box edge, got ${startX}`);
});

test('dragging a box moves the rect, not phantom cx/cy', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h);
  h.context.renderAll();

  s.x = 300; s.y = 220;
  h.context.updateFastDOM();

  const shape = App.domCache.states.get(s.id).__parts.shape;
  const { hw, hh } = h.context.boxHalf(s);
  assert.equal(Number(shape.getAttribute('x')), 300 - hw);
  assert.equal(Number(shape.getAttribute('y')), 220 - hh);
});

// ── Navigation ──

test('descending into a box puts its component on the canvas', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h, 'Expr');
  const rootId = App.rootComponentId;

  assert.equal(h.context.descendIntoBox(s.id), true);
  assert.deepEqual(App.componentPath, [rootId, s.callee]);
  assert.equal(App.states.length, 0, 'the sub-machine starts empty');

  h.context.createState(50, 50, 'inner');
  assert.equal(h.context.ascendTo(rootId), true);
  assert.equal(App.states.length, 1, 'back to the parent, which still has the box');
  assert.equal(App.states[0].id, s.id);
});

test('a component that calls itself does not nest another canvas', () => {
  const h = createHarness();
  const { App } = h.context;
  const outer = boxUp(h, 'Expr');
  h.context.descendIntoBox(outer.id);
  const exprId = App.componentPath[App.componentPath.length - 1];

  // Inside Expr, a box that invokes Expr again — the recursive case.
  const inner = h.context.createState(60, 60, 'recurse');
  inner.callee = exprId;

  const depthBefore = App.componentPath.length;
  h.context.descendIntoBox(inner.id);

  assert.equal(App.componentPath.length, depthBefore,
    'a component is one document however many call sites it has');
  assert.equal(h.context.activeComponentId(), exprId, 'and we are still editing it');
});

test('ascending to a component already passed truncates the path', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h, 'A');
  const rootId = App.rootComponentId;
  h.context.descendIntoBox(s.id);

  const deeper = h.context.createState(10, 10, 'b');
  h.context.promoteToSubmachine(deeper.id);
  h.context.descendIntoBox(deeper.id);
  assert.equal(App.componentPath.length, 3);

  h.context.ascendTo(rootId);
  assert.deepEqual(App.componentPath, [rootId]);
});

test('ascendOne steps up exactly one level and stops at the root', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h, 'A');
  h.context.descendIntoBox(s.id);
  assert.equal(App.componentPath.length, 2);

  assert.equal(h.context.ascendOne(), true);
  assert.equal(App.componentPath.length, 1);
  assert.equal(h.context.ascendOne(), false, 'nothing above the root');
});

// ── CRUD safety ──

test('demoting one of two call sites keeps the shared component', () => {
  const h = createHarness();
  const { App } = h.context;
  const a = boxUp(h, 'Shared');
  const b = h.context.createState(300, 100, 'also');
  b.callee = a.callee;
  assert.equal(App.components.length, 2);

  h.context.demoteToState(a.id);

  assert.equal(App.components.length, 2, 'something else still calls it');
  assert.equal(b.callee, a.callee === undefined ? b.callee : b.callee);
  assert.equal(App.states.find(s => s.id === b.id).callee, App.components[1].id);
});

test('demoting the last call site removes the orphaned component', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h, 'Only');
  assert.equal(App.components.length, 2);

  h.context.demoteToState(s.id);

  assert.equal(App.components.length, 1, 'nothing called it, so it goes');
  assert.equal(App.states[0].callee, undefined);
});

test('deleting a component turns every box that called it back into a state', () => {
  const h = createHarness();
  const { App } = h.context;
  const a = boxUp(h, 'Gone');
  const b = h.context.createState(300, 100, 'also');
  b.callee = a.callee;
  const target = a.callee;

  h.context.deleteComponent(target);

  assert.equal(h.context.getComponent(target), undefined);
  assert.equal(App.states.find(s => s.id === a.id).callee, undefined);
  assert.equal(App.states.find(s => s.id === b.id).callee, undefined,
    'no call site may be left pointing at nothing');
});

test('deleting the component you are standing in walks back up', () => {
  const h = createHarness();
  const { App } = h.context;
  const s = boxUp(h, 'Inner');
  const rootId = App.rootComponentId;
  const target = s.callee;
  h.context.descendIntoBox(s.id);

  h.context.deleteComponent(target);

  assert.equal(h.context.activeComponentId(), rootId);
  assert.deepEqual(App.componentPath, [rootId]);
});

test('the root component cannot be deleted', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'q0');
  const rootId = h.context.ensureRootComponent().id;

  assert.equal(h.context.deleteComponent(rootId), false);
  assert.ok(h.context.getComponent(rootId));
});

test('component names are kept distinct', () => {
  const h = createHarness();
  const a = h.context.createState(0, 0, 'dup');
  const b = h.context.createState(200, 0, 'dup');
  h.context.promoteToSubmachine(a.id);
  h.context.promoteToSubmachine(b.id);

  const names = h.context.App.components.map(c => c.name);
  assert.equal(new Set(names).size, names.length, `duplicate component names: ${names}`);
});

// ── Breadcrumb ──

test('the breadcrumb stays hidden for a flat machine', () => {
  const h = createHarness();
  h.context.createState(0, 0, 'q0');
  h.context.renderBreadcrumb();
  assert.equal(h.getElement('hier-crumbs').style.display, 'none',
    'a one-component tree has no path worth showing');
});

test('the breadcrumb shows the path and links every ancestor', () => {
  const h = createHarness();
  const s = boxUp(h, 'Expr');
  h.context.renameComponent(s.callee, 'Expr');
  h.context.descendIntoBox(s.id);
  h.context.renderBreadcrumb();

  const el = h.getElement('hier-crumbs');
  assert.notEqual(el.style.display, 'none');
  assert.ok(el.innerHTML.includes('Main'), 'the root is on the path');
  assert.ok(el.innerHTML.includes('Expr'), 'and so is where we are');
  assert.ok(el.innerHTML.includes('ascendTo('), 'ancestors are clickable');
  assert.ok(el.innerHTML.includes('crumb-here'), 'the current component is marked, not linked');
});

test('a component name with markup in it is escaped', () => {
  const h = createHarness();
  const s = boxUp(h, 'x');
  h.context.renameComponent(s.callee, '<img src=x onerror=alert(1)>');
  h.context.descendIntoBox(s.id);
  h.context.renderBreadcrumb();

  const html = h.getElement('hier-crumbs').innerHTML;
  assert.ok(!html.includes('<img'), 'component names are user input and must be escaped');
  assert.ok(html.includes('&lt;img'), 'and escaped rather than stripped');
});
