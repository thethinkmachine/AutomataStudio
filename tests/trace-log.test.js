// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// The trace log: its own card, and the rest of the run reachable from it.
//
// Only the tail is written, and that is not an optimisation — the log used to
// be rebuilt from step 0 on every tick, which is quadratic in the length of the
// run and the reason playing back a Turing machine got slower the longer it
// ran. But "the rest is gone" is a different claim from "the rest is not
// drawn", and the elided line used to make the first one: a count, and no way
// to reach what it counted.
//
// The rule that keeps the quadratic from coming back: **an expansion lasts only
// while the cursor is still.** Every path that moves the playhead drops the
// window back to the tail, because a reader watching playback is not reading
// history, and re-rendering a thousand revealed rows per tick is exactly the
// cost the tail exists to avoid.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context, getElement } from './harness.js';

const harness = createHarness();

function longRun(n) {
  harness.resetApp();
  const { App } = context;
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }];
  App.transitions = [{ id: 't1', from: 's1', to: 's1', symbol: 'a' }];
  App.startId = 's1';
  App.simSteps = Array.from({ length: n }, (_, i) => ({ state: 's1', note: 'step ' + i }));
  App.simIdx = n - 1;
  return App;
}

const rows = () => getElement('trace-log').innerHTML.split('<div').length - 1;
const more = () => /sim-log-more/.test(getElement('trace-log').innerHTML);

test('the trace log is a card of its own, with the log as the part that grows', () => {
  // A transport you operate and a history you read are two things. Sharing one
  // box meant reading back through a run pushed the play button off the top of
  // the panel, and collapsing the transport took the log with it.
  assert.ok(context.declaredSectionIds('rpanel').includes('rp-trace'));
  assert.equal(context.sectionFill('rp-trace'), '.trace-log');
  assert.equal(context.sectionFill('rp-simulate'), null,
    'and Simulate has nothing left to grow: its window fits the transport and the tape');
  assert.ok(getElement('rp-trace'), 'the markup is there for the registry to find');
});

test('a short run draws every step and offers nothing to load', () => {
  longRun(12);
  context.renderTraceLog();
  assert.equal(rows(), 12);
  assert.equal(more(), false);
});

test('a long run draws the tail and says how to reach the rest', () => {
  const tail = context.SIM_LOG_TAIL;
  longRun(tail * 3);
  context.renderTraceLog();
  assert.equal(rows(), tail, 'the tail only — the whole run is quadratic to draw');
  assert.ok(more(), 'and the rest is a control, not a dead count');
  assert.match(getElement('trace-log').innerHTML, /earlier steps/);
});

test('revealing draws the previous page, and only that page', () => {
  const tail = context.SIM_LOG_TAIL;
  longRun(tail * 3);
  context.renderTraceLog();
  context.revealEarlierTrace();
  assert.equal(rows(), tail * 2, 'one page more, not the whole run');
  assert.ok(more(), 'and there is still a page above it');
  context.revealEarlierTrace();
  assert.equal(rows(), tail * 3);
  assert.equal(more(), false, 'now the log is whole, so nothing is offered');
});

test('reaching the top of the log pulls the next page in', () => {
  // The button is the affordance and the scroll is the convenience; either
  // alone is wrong — a button nobody sees at the top of a scroller is a dead
  // end, and an auto-load with nothing naming it reads as the page jumping.
  const tail = context.SIM_LOG_TAIL;
  longRun(tail * 3);
  context.renderTraceLog();
  const el = getElement('trace-log');
  el.scrollTop = 0;
  context.handleTraceScroll();
  assert.equal(rows(), tail * 2);

  el.scrollTop = 400;
  context.handleTraceScroll();
  assert.equal(rows(), tail * 2, 'and it does not fire from the middle');
});

test('moving the playhead drops the window back to the tail', () => {
  // The whole of what keeps the quadratic from coming back. A reader watching
  // playback is not reading history.
  const tail = context.SIM_LOG_TAIL;
  const App = longRun(tail * 3);
  context.renderTraceLog();
  context.revealEarlierTrace();
  assert.equal(rows(), tail * 2);

  App.simIdx = tail * 3 - 1;
  context.stepBack();
  assert.equal(rows(), tail, 'back to the tail, so a tick costs what it always did');
});

test('a reveal holds the reader where they were', () => {
  // The rows arrive *above* what is in view, so the content moves down by
  // exactly the height added. Without this a reveal throws the reader to the
  // top of the page they have already read.
  const tail = context.SIM_LOG_TAIL;
  longRun(tail * 3);
  context.renderTraceLog();
  const el = getElement('trace-log');
  el.scrollHeight = 4000;
  el.scrollTop = 500;
  context.revealEarlierTrace();
  assert.equal(el.scrollTop, 500 + (el.scrollHeight - 4000),
    'moved by exactly the height that arrived above, and by nothing else');
  assert.notEqual(el.scrollTop, el.scrollHeight,
    'and not snapped to the bottom, which is what the tail render does');
});

test('the card counts the run', () => {
  longRun(37);
  context.renderTraceLog();
  assert.equal(getElement('rp-count-trace').textContent, '37');
});

// ── the window slides ─────────────────────────────────────────────
// Playing forward, a frame moves the tail by a step or two. Rebuilding four
// hundred rows to show that was most of the cost of a frame of playback, so a
// forward move appends what is new and drops what fell off the top — and the
// rows that stay are the same nodes.

const logRows = () => getElement('trace-log').children.filter(n => n.tagName === 'DIV' && !/sim-log-stream/.test(n.className));

test('a step forward appends one row and keeps the rest', () => {
  const App = longRun(50);
  App.simIdx = 10;
  context.renderTraceLog();
  const before = logRows();
  assert.equal(before.length, 11);

  App.simIdx = 11;
  context.renderTraceLog();
  const after = logRows();
  assert.equal(after.length, 12);
  assert.equal(after[0], before[0], 'the first row is the node it was');
  assert.equal(after[10], before[10], 'and so is the row that was current');
  assert.equal(after[10].className, '', 'which is no longer marked current');
  assert.equal(after[11].className, 't-step', 'the new row is');
  assert.match(after[11].innerHTML, /^11: step 11$/);
});

test('past the tail, the window slides: one in at the bottom, one out at the top', () => {
  const tail = context.SIM_LOG_TAIL;
  const App = longRun(tail * 2);
  App.simIdx = tail + 10;
  context.renderTraceLog();
  const before = logRows();
  assert.equal(before.length, tail);

  App.simIdx = tail + 11;
  context.renderTraceLog();
  const after = logRows();
  assert.equal(after.length, tail, 'still the tail');
  assert.equal(after[0], before[1], 'the oldest row left and the rest stayed');
  assert.match(after[after.length - 1].innerHTML, new RegExp(`^${tail + 11}: `));
  // Step tail + 11 is current, so the tail starts at 12 and twelve are above it.
  assert.ok(/↑ 12 earlier steps/.test(getElement('trace-log').innerHTML),
    'and the count of what is above it moved with it');
});

test('a log someone else wrote to is rebuilt, not extended', () => {
  // log() and StateMate both assign innerHTML, which detaches every row the
  // window was holding; extending it would append to a log that is gone.
  const App = longRun(20);
  App.simIdx = 5;
  context.renderTraceLog();
  context.log('<span>an error</span>');
  App.simIdx = 6;
  context.renderTraceLog();
  assert.equal(logRows().length, 7);
  assert.doesNotMatch(getElement('trace-log').innerHTML, /an error/);
});

test('a step back rebuilds rather than extending backwards', () => {
  const App = longRun(20);
  App.simIdx = 9;
  context.renderTraceLog();
  App.simIdx = 4;
  context.renderTraceLog();
  const rows = logRows();
  assert.equal(rows.length, 5);
  assert.equal(rows[4].className, 't-step');
});
