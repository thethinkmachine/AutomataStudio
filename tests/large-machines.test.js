import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context, getElement } from './harness.js';

// What makes a thousand-state machine usable.
//
// Every optimisation here trades completeness of the *DOM* for speed, and never
// completeness of the model — so what these pin is that the two stayed separate.
// The machine on App is whole at every point: it is simulated whole, measured
// whole, exported whole, and only drawn in part.

const { App } = context;

function build(nStates, nTrans, machine = 'TM') {
  createHarness();
  App.machine = machine;
  App.sigma = new Set(['a', 'b']);
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < nStates; i++) {
    App.states.push({
      id: 's' + i, name: 'q' + i,
      x: 100 + (i % 40) * 90, y: 100 + Math.floor(i / 40) * 90
    });
  }
  App.startId = 's0';
  App.accepts.add('s' + (nStates - 1));
  App.stateN = nStates;
  for (let i = 0; i < nTrans; i++) {
    App.transitions.push({
      id: 't' + i, from: 's' + (i % nStates), to: 's' + ((i * 7 + 3) % nStates),
      symbol: i % 2 ? 'a' : 'b', read: i % 2 ? 'a' : 'b',
      write: i % 2 ? 'b' : 'a', dir: i % 2 ? 'R' : 'L'
    });
  }
  App.transN = nTrans;
}

// ── the id index ──────────────────────────────────────────────────

test('getState answers from an index that follows the model without being told', () => {
  build(50, 60);
  assert.equal(context.getState('s7').name, 'q7');

  // push
  App.states.push({ id: 'sx', name: 'extra', x: 0, y: 0 });
  assert.equal(context.getState('sx').name, 'extra');

  // filter — a new array of the same objects
  App.states = App.states.filter(s => s.id !== 'sx');
  assert.equal(context.getState('sx'), undefined);
  assert.equal(context.getState('s7').name, 'q7');

  // wholesale replacement at the same length
  App.states = App.states.map(s => ({ ...s, name: s.name + '!' }));
  assert.equal(context.getState('s7').name, 'q7!');

  // an id that was never there
  assert.equal(context.getState('nope'), undefined);
});

test('getTransition is indexed the same way', () => {
  build(20, 30);
  assert.equal(context.getTransition('t5').id, 't5');
  App.transitions = App.transitions.filter(t => t.id !== 't5');
  assert.equal(context.getTransition('t5'), undefined);
  assert.equal(context.getTransition('t6').id, 't6');
});

// ── culling ───────────────────────────────────────────────────────

test('a large machine draws a window, and the window is smaller than the machine', () => {
  build(1000, 2000);
  assert.equal(context.cullingActive(), true);
  context.renderAll();
  assert.ok(App.domCache.states.size > 0, 'the window is not empty');
  assert.ok(App.domCache.states.size < App.states.length,
    `drew ${App.domCache.states.size} of ${App.states.length} states`);
  assert.ok(App.domCache.transitions.size < 2000);
});

test('a small machine is drawn whole', () => {
  build(12, 20, 'DFA');
  assert.equal(context.cullingActive(), false);
  context.renderAll();
  assert.equal(App.domCache.states.size, 12);
});

test('culling never touches the model', () => {
  build(1000, 2000);
  const before = context.exportWorkspaceState();
  context.renderAll();
  assert.deepEqual(context.exportWorkspaceState(), before);
  assert.equal(App.states.length, 1000);
  assert.equal(App.transitions.length, 2000);
});

test('the layout pass still measures the whole diagram, so fit-to-screen frames it', () => {
  build(1000, 2000);
  context.renderAll();
  // No viewport passed: this is the pass getContentBounds and the exporters
  // read, and it has to know about every edge, not the drawn ones.
  const ctx = context.currentLayoutContext();
  assert.equal(ctx.geo.size, ctx.groups.length);
  const bounds = context.getContentBounds(30);
  const xs = App.states.map(s => s.x);
  assert.ok(bounds.minX <= Math.min(...xs), 'the leftmost state is inside the bounds');
  assert.ok(bounds.maxX >= Math.max(...xs), 'the rightmost state is inside the bounds');
});

test('an export sees every state, and the window comes back afterwards', () => {
  build(1000, 2000);
  context.renderAll();
  const windowed = App.domCache.states.size;
  assert.ok(windowed < 1000);

  let sawAll = 0;
  context.withFullRender(() => { sawAll = App.domCache.states.size; });
  assert.equal(sawAll, 1000, 'the export saw the whole machine');
  assert.ok(App.domCache.states.size < 1000,
    'the window was rebuilt rather than left holding every node');
});

test('the cull rect is only recomputed when the camera leaves the drawn window', () => {
  build(1000, 2000);
  context.cullViewport();
  assert.equal(context.cullNeedsRepaint(), false, 'standing still needs no repaint');
  App.cam.x -= 40;
  assert.equal(context.cullNeedsRepaint(), false, 'a small pan stays inside the margin');
  App.cam.x -= 100000;
  assert.equal(context.cullNeedsRepaint(), true, 'a long pan leaves it');
});

test('zooming far enough out drops the labels, and zooming back in restores them', () => {
  // Asserted on the label's children rather than its innerHTML: the DOM stub
  // does not parse markup, so innerHTML reads back only what was assigned to it.
  const labelled = () => {
    let n = 0;
    for (const [, node] of App.domCache.transitions) {
      n += node.__parts.textEl.childNodes.length + node.__parts.pillEl.childNodes.length;
    }
    return n;
  };

  build(1000, 2000);
  // The camera is the axis under test. A machine this size is also past the
  // large-machine profile, which hides the labels at every zoom — so the
  // profile is switched off here, or the assertions below would pass without
  // the LOD threshold doing any of the work. The profile has its own file.
  App.config.render.largeMachineAuto = false;
  App.cam.z = 1;
  assert.equal(context.edgeLabelLOD(), false);
  context.renderAll();
  assert.ok(labelled() > 0, 'labels are built at normal zoom');

  App.cam.z = 0.15;
  assert.equal(context.edgeLabelLOD(), true);
  context.renderAll();
  assert.equal(labelled(), 0, 'no label survives the zoom-out');

  App.cam.z = 1;
  context.renderAll();
  assert.ok(labelled() > 0, 'the label is rebuilt rather than matching a stale cache key');
});

test('a state name is dropped at extreme zoom and rebuilt on the way back', () => {
  build(1000, 2000);
  const named = () => {
    let n = 0;
    for (const [, node] of App.domCache.states) n += node.__parts.label.childNodes.length;
    return n;
  };
  App.cam.z = 1;
  context.renderAll();
  assert.ok(named() > 0);
  App.cam.z = 0.1;
  assert.equal(context.stateLabelLOD(), true);
  context.renderAll();
  assert.equal(named(), 0);
  App.cam.z = 1;
  context.renderAll();
  assert.ok(named() > 0);
});

test('a small machine is never level-of-detailed, however far out it is zoomed', () => {
  build(10, 12, 'DFA');
  App.cam.z = 0.05;
  assert.equal(context.edgeLabelLOD(), false);
  assert.equal(context.stateLabelLOD(), false);
});

test('switching windowing off draws everything', () => {
  build(1000, 2000);
  App.config.render.cullOffscreen = false;
  assert.equal(context.cullingActive(), false);
  context.renderAll();
  assert.equal(App.domCache.states.size, 1000);
  delete App.config.render.cullOffscreen;
  assert.equal(context.cullingActive(), true, 'absent reads as on');
});

// ── the panel lists ───────────────────────────────────────────────

test('the panel lists draw a window and say how many rows they stand for', () => {
  build(1000, 2000);
  context.updateLPanel();
  const html = getElement('states-list').innerHTML;
  const rows = html.match(/class="si /g) || [];
  assert.ok(rows.length > 0 && rows.length < 200,
    `drew ${rows.length} rows for 1000 states`);
  assert.match(html, /class="lw-pad"/);
  assert.equal(getElement('lp-count-states').textContent, '1000');
});

test('a short list is drawn whole and has no spacers', () => {
  build(12, 20, 'DFA');
  context.updateLPanel();
  const html = getElement('states-list').innerHTML;
  assert.equal((html.match(/class="si /g) || []).length, 12);
  assert.ok(!html.includes('lw-pad'));
});

test('the search box filters the data, not the drawn rows', () => {
  build(1000, 2000);
  context.updateLPanel();
  getElement('state-search').value = 'q999';
  context.filterStates();
  const html = getElement('states-list').innerHTML;
  assert.ok(html.includes('>q999<'), 'the match is drawn even though it was off the window');
  assert.equal((html.match(/class="si /g) || []).length, 1);
  assert.ok(!html.includes('display:none'), 'nothing is drawn only to be hidden');
});

// ── the derived regular expression ────────────────────────────────

test('a machine too large to convert says so instead of converting it', () => {
  build(400, 800, 'DFA');
  const started = Date.now();
  context.updateRegex();
  assert.ok(Date.now() - started < 2000, 'it declined rather than ran');
  assert.match(App._regexBoxPlain, /too large/);
  assert.equal(App._regexIsDerived, false, 'and says the claim is asserted, not derived');
});

test('a machine small enough is still converted', () => {
  createHarness();
  App.machine = 'DFA';
  App.states = [{ id: 's0', name: 'q0', x: 0, y: 0 }, { id: 's1', name: 'q1', x: 90, y: 0 }];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
  App.transitions = [{ id: 't0', from: 's0', to: 's1', symbol: 'a' }];
  context.updateRegex();
  assert.equal(App._regexIsDerived, true);
  assert.ok(!/too large/.test(App._regexBoxPlain));
});

// ── the formal definition ─────────────────────────────────────────

test('a very large set is printed with its ends and its size', () => {
  const big = Array.from({ length: 1000 }, (_, i) => 'q' + i);
  const out = context.formatSet(big);
  assert.match(out, /\\ldots/);
  assert.match(out, /1000/);
  assert.ok(out.length < 2000, 'it is a line, not a thousand of them');
  // A set that fits is untouched.
  assert.equal(context.formatSet(['q0', 'q1']), '\\{ q_{0}, q_{1} \\}');
});

// ── overlap resolution ────────────────────────────────────────────

test('a state dropped on a crowd is the one that moves, and both paths agree', () => {
  // The case the function actually exists for, and the one the threshold
  // between the two implementations has to be invisible in.
  const r = App.config.radius, gap = 8, min = 2 * r + gap;
  const pitch = min * 3;
  const run = (grid) => {
    const crowd = Array.from({ length: 400 }, (_, i) => ({
      id: 'c' + i, x: (i % 20) * pitch, y: Math.floor(i / 20) * pitch
    }));
    crowd.push({ id: 'drop', x: 5 * pitch, y: 5 * pitch });
    assert.equal(context.resolveNodeOverlaps(crowd, { gap, movable: ['drop'], grid }), true);
    crowd.slice(0, 400).forEach((s, i) => {
      assert.equal(s.x, (i % 20) * pitch, `crowd member ${i} stayed put`);
      assert.equal(s.y, Math.floor(i / 20) * pitch);
    });
    const drop = crowd[400];
    for (let i = 0; i < 400; i++) {
      assert.ok(Math.hypot(drop.x - crowd[i].x, drop.y - crowd[i].y) > min - 1,
        `dropped state still overlaps ${crowd[i].id}`);
    }
    return drop;
  };
  const a = run(false), b = run(true);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.001,
    `the grid put it at (${b.x}, ${b.y}) and the all-pairs loop at (${a.x}, ${a.y})`);
});

test('the grid sweep separates a dense field as well as the all-pairs loop', () => {
  // Neither fully converges from a large regular lattice — the relaxation has a
  // fixed iteration budget and a half-pixel stopping tolerance, which is true of
  // both and always was. The claim is that switching to the grid did not make it
  // worse.
  const r = App.config.radius, gap = 8, min = 2 * r + gap;
  const make = () => Array.from({ length: 150 }, (_, i) => ({
    id: 'n' + i, x: (i % 15) * min * 0.95, y: Math.floor(i / 15) * min * 0.95
  }));
  const worst = (list) => {
    let w = Infinity;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        w = Math.min(w, Math.hypot(list[j].x - list[i].x, list[j].y - list[i].y));
      }
    }
    return w;
  };
  const pairs = make(), grid = make();
  context.resolveNodeOverlaps(pairs, { gap, grid: false });
  context.resolveNodeOverlaps(grid, { gap, grid: true });
  assert.ok(worst(grid) > min - 3, `grid left ${worst(grid).toFixed(1)} against ${min}`);
  assert.ok(worst(grid) >= worst(pairs) - 2,
    `grid ${worst(grid).toFixed(1)} vs all-pairs ${worst(pairs).toFixed(1)}`);
});

test('separating a thousand states is not quadratic', () => {
  const list = Array.from({ length: 1500 }, (_, i) => ({
    id: 'n' + i, x: (i % 50) * 70, y: Math.floor(i / 50) * 70
  }));
  const started = Date.now();
  context.resolveNodeOverlaps(list, { movable: ['n0'] });
  assert.ok(Date.now() - started < 1500, 'a drop settles in well under a second');
});

// ── the run ───────────────────────────────────────────────────────

test('the trace log holds a tail, not the whole run', () => {
  build(20, 40);
  App.simSteps = Array.from({ length: 5000 }, (_, i) => ({ state: 's0', note: 'step ' + i }));
  App.simIdx = 4999;
  context.renderSimStep();
  const html = getElement('trace-log').innerHTML;
  const lines = (html.match(/<div/g) || []).length;
  assert.ok(lines <= context.SIM_LOG_TAIL + 1, `${lines} lines for a 5000-step run`);
  assert.match(html, /earlier steps/);
  assert.ok(html.includes('4999: step 4999'), 'the current step is the last line');
});

test('the trail is carried forward rather than rebuilt from step 0', () => {
  build(20, 40);
  App.simSteps = Array.from({ length: 4000 }, (_, i) => ({
    state: 's' + (i % 20), tid: 't' + (i % 40), note: 'n' + i
  }));
  const started = Date.now();
  for (let i = 0; i < 4000; i++) {
    App.simIdx = i;
    context.updateSimCanvasHighlights(App.simSteps[i]);
  }
  assert.ok(Date.now() - started < 4000, 'playing 4000 steps does not take quadratic time');
  // The trail is still the right answer: every state the run passed through.
  assert.equal(App._simTrail.visited.size, 20);
});

test('scrubbing backwards rebuilds the trail rather than keeping a longer one', () => {
  build(6, 6);
  App.simSteps = Array.from({ length: 6 }, (_, i) => ({ state: 's' + i, note: 'n' + i }));
  App.simIdx = 5;
  context.updateSimCanvasHighlights(App.simSteps[5]);
  assert.equal(App._simTrail.visited.size, 5);
  App.simIdx = 2;
  context.updateSimCanvasHighlights(App.simSteps[2]);
  assert.equal(App._simTrail.visited.size, 2, 'the trail shrank back to where the playhead is');
});

// ── the undo stack ────────────────────────────────────────────────

test('undo history is bounded by bytes as well as by depth', () => {
  build(1200, 2400);
  for (let i = 0; i < 200; i++) {
    App.states[0].x += 1;
    context.snapshot();
  }
  let bytes = 0;
  for (const entry of App.history) bytes += entry.length;
  assert.ok(bytes <= context.HISTORY_MAX_BYTES,
    `${(bytes / 1e6).toFixed(1)}MB retained`);
  assert.ok(App.history.length >= 1, 'at least one step back is always kept');
});

test('a small machine still gets the full depth', () => {
  build(6, 8, 'DFA');
  for (let i = 0; i < 320; i++) {
    App.states[0].x += 1;
    context.snapshot();
  }
  assert.equal(App.history.length, context.HISTORY_MAX_ENTRIES);
});

// ── how far out the camera may go ─────────────────────────────────
//
// A fixed 20% floor is a wall on exactly the machines that need to be seen
// whole: fit-to-screen was clamped up to a zoom that does not fit, so the
// button silently stopped fitting and panning by hand was the only way around
// the diagram.

test('the zoom floor follows the diagram, so a big machine can be seen whole', () => {
  build(1000, 2000);
  const floor = context.minZoom();
  assert.ok(floor < App.config.zoom.min,
    `a 1000-state machine may zoom past the configured floor (got ${floor})`);
  assert.ok(floor >= context.ZOOM_HARD_FLOOR, 'and never past the hard floor');
  assert.equal(context.clampZoom(0.0001), floor, 'the clamp is that floor');
});

test('a small machine keeps the configured floor', () => {
  build(6, 8, 'DFA');
  assert.equal(context.minZoom(), App.config.zoom.min);
});

test('fit-to-screen actually frames a thousand-state machine', () => {
  build(1000, 2000);
  // Spread it out until framing it genuinely needs less than the configured
  // 20% — which is the case the old clamp turned into a promise it could not
  // keep, silently leaving a third of the machine off screen.
  App.states.forEach((st, i) => {
    st.x = 100 + (i % 40) * 220;
    st.y = 100 + Math.floor(i / 40) * 220;
  });
  context.fitToScreen(true);
  assert.ok(App.cam.z < App.config.zoom.min, 'this machine needs to go past the old floor');
  const b = context.getContentBounds(App.config.radius + 4);
  const z = App.cam.z;
  const left = App.cam.x + b.minX * z, right = App.cam.x + b.maxX * z;
  const top = App.cam.y + b.minY * z, bottom = App.cam.y + b.maxY * z;
  const w = getElement('canvas-wrap');
  assert.ok(left >= -1 && right <= w.clientWidth + 1,
    `the whole width is on screen (${left.toFixed(0)}..${right.toFixed(0)} in ${w.clientWidth})`);
  assert.ok(top >= -1 && bottom <= w.clientHeight + 1,
    `the whole height is on screen (${top.toFixed(0)}..${bottom.toFixed(0)} in ${w.clientHeight})`);
});
