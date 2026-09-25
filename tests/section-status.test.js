import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// What a folded section says about itself — js/section-status.js.
//
// A collapsed section and a minimized window are both a title strip, and a
// strip that said only "SIMULATE" had folded the verdict away with the body.
// Pinned here: that the chip is made on first use and nowhere else, that it
// sits before the header's controls, and that the three reporters say what
// the run, the batch and the profile actually say.

const harness = createHarness();
const { context } = harness;

/** A section with the header index.html gives it: title, then the arrow. */
function section(id, headerClass = 'rp-section-header') {
  const el = context.$(id);
  el.innerHTML = '';
  delete el.__secStatus;
  const header = context.document.createElement('div');
  header.className = headerClass;
  const title = context.document.createElement('span');
  const arrow = context.document.createElement('span');
  arrow.className = headerClass === 'rp-section-header' ? 'rp-toggle-arrow' : 'lp-toggle-arrow';
  header.appendChild(title);
  header.appendChild(arrow);
  header.querySelector = sel => (sel.includes(arrow.className) ? arrow : null);
  el.appendChild(header);
  return { el, header, arrow };
}

test('a section that never reports never grows a chip', () => {
  harness.resetApp();
  const { el, header } = section('rp-simulate');
  context.setSectionStatus('rp-simulate', '');
  assert.equal(el.__secStatus, undefined);
  assert.equal(header.children.length, 2);
});

test('the chip goes before the header\'s controls and carries its tone', () => {
  harness.resetApp();
  const { header, arrow } = section('rp-batch');
  context.setSectionStatus('rp-batch', '3 / 4 passed', 'rej');
  const chip = header.children[1];
  assert.equal(chip.className, 'sec-status');
  assert.equal(header.children[2], arrow, 'name, then what it knows, then what you can do');
  assert.deepEqual(context.sectionStatus('rp-batch'), { text: '3 / 4 passed', tone: 'rej' });
  assert.equal(chip.getAttribute('data-tip'), '3 / 4 passed', 'the full text for a narrow header');

  context.setSectionStatus('rp-batch', '4 / 4 passed', 'acc');
  assert.equal(header.children.length, 3, 'reused, not stacked');
  context.setSectionStatus('rp-batch', 'x', 'not-a-tone');
  assert.equal(context.sectionStatus('rp-batch').tone, '', 'a typo is no tone, not an error');
  context.setSectionStatus('rp-batch', '');
  assert.equal(context.sectionStatus('rp-batch').text, '', 'emptied, and hidden by :empty');
});

test('Simulate reports the step, then the verdict once the run has one', () => {
  harness.resetApp();
  section('rp-simulate');
  context.App.simInput = 'ab';
  context.App.simSteps = [{ state: 'q0' }, { state: 'q1' }, { state: 'q2', final: 'accept' }];
  context.App.simIdx = 0;
  context.syncSimStatus();
  assert.match(context.sectionStatus('rp-simulate').text, /^ab · 1 \/ 3/);

  context.App.simIdx = 2;
  context.syncSimStatus();
  assert.deepEqual(context.sectionStatus('rp-simulate'), { text: 'ab · accepted', tone: 'acc' });

  context.App.simSteps[2].final = 'timeout';
  context.syncSimStatus();
  assert.deepEqual(context.sectionStatus('rp-simulate'), { text: 'ab · no verdict', tone: 'warn' },
    'a run cut off by the step limit is not a rejection');

  context.App.simSteps[2].final = 'loop';
  context.syncSimStatus();
  assert.equal(context.sectionStatus('rp-simulate').text, 'ab · never halts');

  context.resetSim();
  assert.equal(context.sectionStatus('rp-simulate').text, '', 'a reset clears it');
});

test('Batch Test reports expectations when there are any, acceptances when not', () => {
  harness.resetApp();
  section('rp-batch');
  context.syncBatchStatus({ results: [{}, {}, {}], expected: 3, passCount: 2, allPassed: false });
  assert.deepEqual(context.sectionStatus('rp-batch'), { text: '2 / 3 passed', tone: 'rej' });

  context.syncBatchStatus({ results: [{ accepted: true }, { accepted: false }, { error: true }], expected: 0 });
  assert.deepEqual(context.sectionStatus('rp-batch'), { text: '1 / 2 accepted', tone: '' },
    'a word that could not be tokenized was not decided');

  context.syncBatchStatus(null);
  assert.equal(context.sectionStatus('rp-batch').text, '');
});
