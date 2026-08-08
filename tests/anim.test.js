import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.js';

// The easing layer (js/anim.js) and its one seam into the renderer.
//
// Two things make this file look unusual. First, animation is *off* under the
// stub: tests/dom-stub.js runs requestAnimationFrame synchronously, anim.js
// detects that and treats it as "always snap", which is what keeps every other
// test file painting final values. So the tests that exercise the easing law
// force the detector off with _setSyncRAF(false) and put it back afterwards.
//
// Second, dt is passed in rather than read from a clock. The law is a pure
// function of (gap, dt), so the tests drive it directly instead of sleeping.

function withAnim(h, fn) {
  const { _setSyncRAF, resetAnim } = h.context;
  _setSyncRAF(false);
  try {
    resetAnim();
    fn();
  } finally {
    resetAnim();
    _setSyncRAF(true);
  }
}

test('a key seen for the first time paints at its target', () => {
  const h = createHarness();
  withAnim(h, () => {
    // A new edge belongs where the layout put it; easing in from wherever the
    // previous value happened to be would mean every edge flies in on creation.
    assert.equal(h.context.easeTrack('e:c', 40, 16), 40);
  });
});

test('easing approaches the target and stops there', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { easeTrack, animRunning } = h.context;
    easeTrack('e:c', 0, 16);
    let v = 0;
    for (let i = 0; i < 200; i++) v = easeTrack('e:c', 100, 16);

    assert.equal(v, 100, 'the epsilon snap lands exactly on the target');
    assert.equal(animRunning(), false, 'and nothing is left in flight');
  });
});

test('easing is monotone and never overshoots', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { easeTrack } = h.context;
    easeTrack('e:c', 0, 16);
    let prev = 0;
    for (let i = 0; i < 40; i++) {
      const v = easeTrack('e:c', 100, 16);
      assert.ok(v >= prev, `step ${i} moved backwards: ${v} < ${prev}`);
      assert.ok(v <= 100, `step ${i} overshot: ${v} > 100`);
      prev = v;
    }
  });
});

test('easing is frame-rate independent', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { easeTrack, resetAnim } = h.context;

    easeTrack('a', 0, 16);
    easeTrack('a', 100, 16);
    const twoShort = easeTrack('a', 100, 16);

    resetAnim();
    easeTrack('b', 0, 16);
    const oneLong = easeTrack('b', 100, 32);

    // exp(-16/T)·exp(-16/T) = exp(-32/T) exactly, so these agree to float noise.
    // A per-frame `cur += gap * k` would put them ~11 apart, i.e. the same drag
    // would settle at two different speeds on a 60Hz and a 120Hz display.
    assert.ok(Math.abs(twoShort - oneLong) < 1e-9,
      `two 16ms steps (${twoShort}) should equal one 32ms step (${oneLong})`);
  });
});

test('a very long frame eases by one clamped step rather than jumping', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { easeTrack } = h.context;
    easeTrack('e:c', 0, 16);
    // A backgrounded tab comes back with a delta in the thousands. Unclamped
    // that is alpha ~= 1, i.e. exactly the teleport this module exists to avoid.
    const v = easeTrack('e:c', 100, 5000);
    assert.ok(v < 100, 'a stalled frame does not resolve the whole gap at once');
  });
});

test('angles take the short way round', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { easeTrack } = h.context;
    const from = 350 * Math.PI / 180, to = 10 * Math.PI / 180;
    easeTrack('e:a', from, 16, true);

    // Going 350 -> 10 the long way sweeps the loop through 180 degrees, i.e.
    // straight across the state it is attached to.
    for (let i = 0; i < 60; i++) {
      const v = easeTrack('e:a', to, 16, true);
      const deg = ((v * 180 / Math.PI) % 360 + 360) % 360;
      assert.ok(deg > 340 || deg < 20, `passed through ${deg.toFixed(1)} degrees`);
    }
  });
});

test('a non-finite target is passed straight through', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { easeTrack, animRunning } = h.context;
    easeTrack('e:c', 0, 16);
    assert.ok(Number.isNaN(easeTrack('e:c', NaN, 16)));
    // |NaN - cur| < eps is false forever, so a track left holding one would keep
    // the settle loop arming itself for the rest of the session.
    assert.equal(animRunning(), false);
  });
});

test('settleAll finishes every track immediately', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { easeTrack, settleAll, animRunning, _animTracks } = h.context;
    easeTrack('x', 0, 16); easeTrack('x', 100, 16);
    easeTrack('y', 0, 16); easeTrack('y', 100, 16);
    assert.equal(animRunning(), true);

    settleAll();
    assert.equal(animRunning(), false);
    assert.equal(_animTracks().get('x').cur, 100);
    assert.equal(_animTracks().get('y').cur, 100);
  });
});

test('a pass drops tracks it did not read', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { beginPass, endPass, easeTrack, animRunning, _animTracks } = h.context;
    beginPass();
    easeTrack('gone', 0, 16);
    easeTrack('gone', 100, 16);
    endPass();
    assert.equal(_animTracks().has('gone'), true, 'still live while it is being read');

    // Deleting the edge means nothing reads its track again. Left behind it
    // would sit at done:false and re-arm the settle loop forever.
    beginPass();
    endPass();
    assert.equal(_animTracks().has('gone'), false);
    assert.equal(animRunning(), false);
  });
});

test('claimGroup reports a swap of the objects behind a key, not a move', () => {
  const h = createHarness();
  withAnim(h, () => {
    const { claimGroup } = h.context;
    const a = { id: 's1', x: 0, y: 0 }, b = { id: 's2', x: 9, y: 9 };

    assert.equal(claimGroup('s1|s2', a, b), false, 'first sight is not a change');
    a.x = 400;
    assert.equal(claimGroup('s1|s2', a, b), false, 'a drag mutates in place');

    // Every wholesale replacement — a load, an undo, a workspace switch —
    // installs new objects, while resetIds hands back the same s1/s2 ids. Object
    // identity is what separates the two.
    assert.equal(claimGroup('s1|s2', { id: 's1' }, { id: 's2' }), true);
  });
});

test('a synchronous rAF host snaps instead of easing', () => {
  const h = createHarness();
  const { easeTrack, animEnabled, _animTracks } = h.context;

  // This is the state the whole test suite runs in: dom-stub.js:188 runs the
  // callback inline, so a self-arming settle loop would recurse rather than
  // spread itself over frames.
  assert.equal(animEnabled(), false);
  easeTrack('e:c', 0, 16);
  assert.equal(easeTrack('e:c', 100, 16), 100, 'reads return the target unchanged');
  assert.equal(_animTracks().size, 0, 'and no tracks accumulate');
});

test('animateLayout:false is exactly the un-eased behaviour', () => {
  const h = createHarness();
  const { App } = h.context;
  withAnim(h, () => {
    const { easeTrack, _animTracks } = h.context;
    easeTrack('e:c', 0, 16);

    App.config.render.animateLayout = false;
    // beginPass re-resolves the flag; without it the pass cache would hold the
    // value from before the setting changed.
    h.context.beginPass();
    assert.equal(easeTrack('e:c', 100, 16), 100);
    assert.equal(_animTracks().size, 0);

    App.config.render.animateLayout = true;
  });
});

test('an absent animateLayout flag reads as on', () => {
  const h = createHarness();
  const { App } = h.context;
  const saved = App.config.render.animateLayout;
  h.context._setSyncRAF(false);
  try {
    // A workspace or preferences blob written before this setting existed must
    // not read as "animation disabled" — the same convention the collision
    // flags follow.
    delete App.config.render.animateLayout;
    h.context.beginPass();
    assert.equal(h.context.animEnabled(), true);
  } finally {
    App.config.render.animateLayout = saved;
    h.context._setSyncRAF(true);
    h.context.resetAnim();
  }
});

// There is no createTransition export — transitions are built inline by the
// transition modal — so these two build the record directly, the same shape the
// rest of the suite uses.
function addTransition(h, from, to, symbol) {
  const t = { id: h.context.newTId(), from, to, symbol };
  h.context.App.transitions.push(t);
  return t;
}

test('drawn geometry equals the layout target once settled', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(120, 120, 'q0');
  h.context.createState(400, 140, 'q1');
  const [a, b] = App.states;
  addTransition(h, a.id, b.id, 'a');
  h.context.renderAll();

  const ctx = h.context.currentLayoutContext();
  const key = `${a.id}|${b.id}`;
  const node = App.domCache.transitions.get(key);

  // The seam this whole change rests on: geometry.js keeps returning targets, so
  // once nothing is in flight the DOM carries exactly what it decided. That is
  // what leaves getContentBounds — and every cropped export — correct for free.
  assert.equal(node.__parts.pathEl.getAttribute('d'), ctx.geo.get(key).d);
});

test('a self-loop still paints an arc through the renderer', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(200, 200, 'q0');
  const s = App.states[0];
  addTransition(h, s.id, s.id, 'a');
  h.context.renderAll();

  const d = App.domCache.transitions.get(`${s.id}|${s.id}`).__parts.pathEl.getAttribute('d');
  assert.match(d, /A/, 'the loop is drawn as an arc, not a chord');
});
