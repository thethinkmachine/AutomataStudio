import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The varispeed: playback speed as a knob in the transport rather than a
// dropdown after it. js/speed-control.js.
//
// What is pinned here is the dial's arithmetic and its gestures. The value it
// turns is App.config.autoSpeed — milliseconds per step, 0 for Max — which is
// the same number Settings edits and the settings profile saves, so the rest
// of the app sees no change in kind.

const harness = createHarness();
const { context } = harness;

function freshDial(ms = 500) {
  harness.resetApp();
  const el = context.$('sim-speed');
  el.__speedWired = false;
  el._listeners = {};
  context.App.config.autoSpeed = ms;
  context.initSpeedControl();
  return el;
}

const fire = (el, type, init = {}) => el._listeners[type]({ preventDefault() {}, stopPropagation() {}, ...init });

test('the detents run slowest to Max, and 1× is unity', () => {
  const { SPEED_DETENTS, UNITY_MS, speedLabel } = context;
  assert.deepEqual([...SPEED_DETENTS].map(speedLabel), ['0.5×', '1×', '2×', '5×', '10×', '50×', '500×', 'Max']);
  assert.equal(speedLabel(UNITY_MS), '1×');
  // A value typed in Settings reads as what it is, not as the nearest stop.
  assert.equal(speedLabel(300), '1.7×');
  assert.equal(speedLabel(30), '17×');
});

test('the dial places a detent evenly and a typed value between its neighbours', () => {
  const { dialFraction } = context;
  assert.equal(dialFraction(1000), 0);
  assert.equal(dialFraction(0), 1, 'Max is the end stop');
  assert.ok(Math.abs(dialFraction(500) - 1 / 7) < 1e-12);
  const between = dialFraction(300);   // 1.67×, between 1× and 2×
  assert.ok(between > dialFraction(500) && between < dialFraction(250));
});

test('stepping moves one stop, and from between two it lands on the neighbour', () => {
  const { stepDetent } = context;
  assert.equal(stepDetent(500, 1), 250);
  assert.equal(stepDetent(500, -1), 1000);
  assert.equal(stepDetent(300, 1), 250, 'up from 1.7× is 2×');
  assert.equal(stepDetent(300, -1), 500, 'down from 1.7× is 1×');
  assert.equal(stepDetent(0, 1), 0, 'Max is an end stop without wrap');
  assert.equal(stepDetent(0, 1, { wrap: true }), 1000, 'and comes round to the slowest with it');
  assert.equal(stepDetent(1000, -1, { wrap: true }), 0);
});

test('click is faster, shift-click slower, alt-click back to 1×', () => {
  const el = freshDial(500);
  fire(el, 'click');
  assert.equal(context.App.config.autoSpeed, 250);
  fire(el, 'click', { shiftKey: true });
  fire(el, 'click', { shiftKey: true });
  assert.equal(context.App.config.autoSpeed, 1000);
  fire(el, 'click', { altKey: true });
  assert.equal(context.App.config.autoSpeed, 500);
});

test('the readout, the arc and the slider value follow the setting', () => {
  const el = freshDial(50);
  assert.equal(el.getAttribute('aria-valuenow'), '4');
  assert.match(el.getAttribute('aria-valuetext'), /^10×, 20 steps a second$/);
  context.setPlaybackSpeed(0);
  assert.match(el.getAttribute('aria-valuetext'), /^Max, as fast as the page can go$/);
  assert.ok(el.classList.contains('is-max'));
  assert.match(el.getAttribute('data-tip'), /Speed Max/);
});

test('a wheel turns it a detent per notch, and a trackpad has to travel', () => {
  const el = freshDial(500);
  fire(el, 'wheel', { deltaY: -100, deltaMode: 0 });
  assert.equal(context.App.config.autoSpeed, 250, 'wheel up is faster');
  fire(el, 'wheel', { deltaY: 20, deltaMode: 0 });
  assert.equal(context.App.config.autoSpeed, 250, 'a small trackpad delta alone does not move it');
  fire(el, 'wheel', { deltaY: 50, deltaMode: 0 });
  assert.equal(context.App.config.autoSpeed, 500, 'but enough of them do');
});

test('a drag turns the dial and does not also count as a click', () => {
  const el = freshDial(500);
  fire(el, 'pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  fire(el, 'pointermove', { clientX: 100, clientY: 72, pointerId: 1 });   // 28px up: two detents
  assert.equal(context.App.config.autoSpeed, 100);
  fire(el, 'pointerup', { pointerId: 1 });
  fire(el, 'click');
  assert.equal(context.App.config.autoSpeed, 100, 'the click ending the drag is swallowed');
  fire(el, 'click');
  assert.equal(context.App.config.autoSpeed, 50, 'and the next one is a click again');
});

test('the keyboard steps it, and Home and End go to the stops', () => {
  const el = freshDial(500);
  let stopped = 0;
  const key = k => fire(el, 'keydown', { key: k, stopPropagation() { stopped++; } });
  key('ArrowUp');
  assert.equal(context.App.config.autoSpeed, 250);
  key('ArrowLeft');
  assert.equal(context.App.config.autoSpeed, 500);
  key('End');
  assert.equal(context.App.config.autoSpeed, 0);
  key('Home');
  assert.equal(context.App.config.autoSpeed, 1000);
  assert.equal(stopped, 4, 'arrows turning the dial never reach the canvas shortcuts');
});

test('changing speed while playing keeps the clock and re-phases it', () => {
  freshDial(500);
  context.toggleAuto();
  const clock = context.App.autoTimer;
  assert.ok(clock, 'playing');
  context.setPlaybackSpeed(0);
  assert.equal(context.App.autoTimer, clock, 'the same clock, not a restarted one');
  context.stopAutoPlay();
});
