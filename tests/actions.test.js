import { dispatchDocumentEvent } from './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
// The harness imports every app module, so every defineActions() call in the
// app has run by the time the markup checks below ask the registry.
import './harness.js';
import { actionNames, defineActions, getAction } from '../js/action-registry.js';
import { SPEC_EVENT_NAMES, dispatchActions, installActions, parseActionSpec } from '../js/actions.js';

// data-action in place of on*="...": js/action-registry.js holds the names,
// js/actions.js delivers events to them. The first half of this file is the
// mechanism; the second is the markup — that every name it uses exists, and
// that the inline-handler seam it replaces only ever shrinks.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Fixtures ──────────────────────────────────────────────────────

const calls = [];
defineActions({
  'test.record': ({ el, event }) => calls.push(['record', el.id, event.type]),
  'test.outer': ({ el }) => calls.push(['outer', el.id]),
  'test.stop': ({ event }) => { calls.push(['stop']); event.stopPropagation(); },
  'test.throws': () => { throw new Error('boom'); },
  'test.focus': ({ el }) => calls.push(['focus', el.id]),
  'test.claim': {
    keydown: ({ event }) => { calls.push(['claim', event.key]); if (event.key === 'Tab') event.preventDefault(); },
    blur: ({ el }) => calls.push(['claim-blur', el.id])
  }
});

function node(id, action, parent) {
  const el = document.createElement('div');
  el.id = id;
  if (action) el.setAttribute('data-action', action);
  if (parent) parent.appendChild(el);
  return el;
}

function event(type, target, init = {}) {
  const e = {
    type,
    target,
    defaultPrevented: false,
    cancelBubble: false,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { e.cancelBubble = true; },
    ...init
  };
  return e;
}

function withReportedErrors(fn) {
  const errors = [];
  const saved = globalThis.reportError;
  globalThis.reportError = error => errors.push(error);
  try { fn(); } finally { globalThis.reportError = saved; }
  return errors;
}

// ── The registry ──────────────────────────────────────────────────

test('a name is defined once: a second claim on it throws rather than silently winning', () => {
  assert.throws(() => defineActions({ 'test.record': () => {} }), /already defined/);
});

test('an action is a function or an object of event handlers, and nothing else', () => {
  assert.throws(() => defineActions({ 'test.bad1': 'loadSubsetAsDFA()' }), TypeError);
  assert.throws(() => defineActions({ 'test.bad2': {} }), TypeError);
  assert.throws(() => defineActions({ 'test.bad3': { click: 'nope' } }), TypeError);
  assert.equal(getAction('test.bad1'), undefined, 'a rejected action is not half-registered');
});

// ── Reading a spec ────────────────────────────────────────────────

test('a spec is tokens of [event[.key]->]name[:modifier], run in the order written', () => {
  const plain = { event: null, key: null, prevent: false, stop: false };
  assert.deepEqual(parseActionSpec('algo.loadSubsetAsDFA'),
    [{ ...plain, name: 'algo.loadSubsetAsDFA' }]);
  assert.deepEqual(parseActionSpec('  suggest.symbols   keydown.Enter->algo.buildNFATree '), [
    { ...plain, name: 'suggest.symbols' },
    { ...plain, event: 'keydown', key: 'enter', name: 'algo.buildNFATree' }
  ]);
  assert.deepEqual(parseActionSpec('blur->x.y_z'), [{ ...plain, event: 'blur', name: 'x.y_z' }]);
  assert.deepEqual(parseActionSpec('mousedown->suggest.accept:prevent:stop'),
    [{ ...plain, event: 'mousedown', name: 'suggest.accept', prevent: true, stop: true }]);
});

test('a spec that cannot mean anything is refused, naming the token', () => {
  assert.throws(() => parseActionSpec('hover->algo.x'), /Unknown event "hover"/);
  assert.throws(() => parseActionSpec('click.enter->algo.x'), /key filter needs keydown or keyup/);
  assert.throws(() => parseActionSpec('loadSubsetAsDFA()'), /Unreadable action token/);
  assert.throws(() => parseActionSpec('algo.'), /Unreadable/);
  assert.throws(() => parseActionSpec('algo.x:once'), /Unknown modifier ":once"/);
});

// ── Delivering an event ───────────────────────────────────────────

test('a click on something inside a control runs the control\'s action, with the control as el', () => {
  calls.length = 0;
  const root = node('root');
  const button = node('btn', 'test.record', root);
  const icon = node('icon', null, button);
  dispatchActions(event('click', icon), root);
  assert.deepEqual(calls, [['record', 'btn', 'click']]);
});

test('actions bubble from the target outwards, and stopPropagation ends the walk', () => {
  calls.length = 0;
  const root = node('root', 'test.outer');
  const inner = node('inner', 'test.record', root);
  dispatchActions(event('click', inner), root);
  assert.deepEqual(calls, [['record', 'inner', 'click'], ['outer', 'root']]);

  calls.length = 0;
  const stopper = node('stopper', 'test.stop', root);
  dispatchActions(event('click', stopper), root);
  assert.deepEqual(calls, [['stop']], 'the outer action must not run once propagation is stopped');
});

test('the walk stops at its root and does not reach the page above it', () => {
  calls.length = 0;
  const page = node('page', 'test.outer');
  const root = node('root', null, page);
  const child = node('child', 'test.record', root);
  dispatchActions(event('click', child), root);
  assert.deepEqual(calls, [['record', 'child', 'click']]);
});

test('a function action runs on click by default and on nothing else unless it says so', () => {
  calls.length = 0;
  const el = node('field', 'test.record');
  dispatchActions(event('keydown', el, { key: 'a' }), el);
  dispatchActions(event('input', el), el);
  assert.deepEqual(calls, [], 'a bare token is a click');

  el.setAttribute('data-action', 'input->test.record');
  dispatchActions(event('input', el), el);
  dispatchActions(event('click', el), el);
  assert.deepEqual(calls, [['record', 'field', 'input']]);
});

test('a key filter runs the action for that key only', () => {
  calls.length = 0;
  const el = node('field', 'keydown.enter->test.record keyup.esc->test.outer');
  dispatchActions(event('keydown', el, { key: 'a' }), el);
  dispatchActions(event('keydown', el, { key: 'Enter' }), el);
  dispatchActions(event('keyup', el, { key: 'Enter' }), el);
  dispatchActions(event('keyup', el, { key: 'Escape' }), el);
  assert.deepEqual(calls, [['record', 'field', 'keydown'], ['outer', 'field']]);
});

test('a key a behaviour has claimed is not also delivered to the field\'s next action', () => {
  // The symbol popover takes Tab to accept a suggestion and preventDefaults it;
  // `if (trySymSuggestKeydown(event)) return;` used to say this by hand.
  calls.length = 0;
  const el = node('field', 'test.claim keydown->test.record');
  dispatchActions(event('keydown', el, { key: 'Tab' }), el);
  assert.deepEqual(calls, [['claim', 'Tab']]);

  calls.length = 0;
  dispatchActions(event('keydown', el, { key: 'x' }), el);
  assert.deepEqual(calls, [['claim', 'x'], ['record', 'field', 'keydown']]);
});

test('focus and blur are for the element whose focus changed, as onfocus and onblur were', () => {
  calls.length = 0;
  const form = node('form', 'focus->test.focus focusin->test.outer');
  const field = node('field', 'focus->test.focus', form);
  dispatchActions(event('focusin', field), form);
  assert.deepEqual(calls, [['focus', 'field'], ['outer', 'form']],
    'focusin bubbles to the container; focus does not');
});

test('a bare behaviour runs whichever of its handlers the event matches', () => {
  calls.length = 0;
  const el = node('field', 'test.claim');
  dispatchActions(event('click', el), el);
  assert.deepEqual(calls, [], 'the behaviour has no click handler');
  dispatchActions(event('focusout', el), el);
  assert.deepEqual(calls, [['claim-blur', 'field']]);
});

test('a failing action is reported and the rest still run; an unknown name is reported once', () => {
  calls.length = 0;
  const el = node('field', 'test.throws test.missing test.record');
  const errors = withReportedErrors(() => {
    dispatchActions(event('click', el), el);
    dispatchActions(event('click', el), el);
  });
  assert.deepEqual(calls, [['record', 'field', 'click'], ['record', 'field', 'click']]);
  assert.equal(errors.filter(e => e.message === 'boom').length, 2);
  assert.equal(errors.filter(e => /No action named "test.missing"/.test(e.message)).length, 1,
    'a missing name is a bug in the markup, worth saying once rather than on every keystroke');
});

test(':prevent and :stop act before the action, and only when it runs', () => {
  calls.length = 0;
  const root = node('root', 'test.outer');
  const btn = node('btn', 'test.record:prevent:stop', root);
  const click = event('click', btn);
  dispatchActions(click, root);
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(calls, [['record', 'btn', 'click']], ':stop keeps the row behind it from running');

  const key = event('keydown', btn, { key: 'a' });
  dispatchActions(key, root);
  assert.equal(key.defaultPrevented, false, 'a token that did not run prevents nothing');
});

test('activate is a click, or Enter or Space on something that is not natively a button', () => {
  calls.length = 0;
  const item = node('item', 'activate->test.record');
  const space = event('keydown', item, { key: ' ' });
  dispatchActions(space, item);
  dispatchActions(event('keydown', item, { key: 'Enter' }), item);
  dispatchActions(event('keydown', item, { key: 'a' }), item);
  dispatchActions(event('click', item), item);
  assert.deepEqual(calls.map(c => c[2]), ['keydown', 'keydown', 'click']);
  assert.equal(space.defaultPrevented, true, 'Space must not also scroll the page');

  // A <button> turns Enter into a click by itself; answering the key too
  // would run the action twice.
  calls.length = 0;
  const button = document.createElement('button');
  button.setAttribute('data-action', 'activate->test.record');
  dispatchActions(event('keydown', button, { key: 'Enter' }), button);
  dispatchActions(event('click', button), button);
  assert.equal(calls.length, 1);
});

test('mouseenter and mouseleave run for an element the pointer crossed, not one it moved within', () => {
  calls.length = 0;
  const row = node('row', 'mouseenter->test.record mouseleave->test.outer');
  const label = node('label', null, row);
  row.contains = other => other === row || other === label;
  dispatchActions(event('mouseover', label, { relatedTarget: null }), row);
  dispatchActions(event('mouseover', label, { relatedTarget: row }), row);
  dispatchActions(event('mouseout', row, { relatedTarget: label }), row);
  dispatchActions(event('mouseout', label, { relatedTarget: null }), row);
  assert.deepEqual(calls, [['record', 'row', 'mouseover'], ['outer', 'row']],
    'one enter from outside, one leave to outside; moving between the row and its label is neither');
});

test('scroll runs for the element scrolled only', () => {
  calls.length = 0;
  const outer = node('outer', 'scroll->test.outer');
  const log = node('log', 'scroll->test.record', outer);
  dispatchActions(event('scroll', log), outer);
  assert.deepEqual(calls, [['record', 'log', 'scroll']]);
});

// ── Installed on the page ─────────────────────────────────────────

test('installed on <html>, actions run before any document listener sees the event', () => {
  // view.js closes the aux window on Escape unless the key was already claimed;
  // the symbol popover claims it from its field. That only works if the field's
  // action runs first — which an inline handler always did.
  calls.length = 0;
  const seen = [];
  const late = e => seen.push(['document', e.defaultPrevented]);
  document.addEventListener('keydown', late);
  const uninstall = installActions();
  assert.equal(installActions(), uninstall, 'installing twice is one installation');
  try {
    const field = node('field', 'test.claim');
    dispatchDocumentEvent('keydown', { target: field, key: 'Tab' });
    assert.deepEqual(calls, [['claim', 'Tab']]);
    assert.deepEqual(seen, [['document', true]], 'the document listener saw the key already claimed');
  } finally {
    uninstall();
    document.removeEventListener('keydown', late);
  }
  calls.length = 0;
  dispatchDocumentEvent('keydown', { target: node('field', 'test.claim'), key: 'Tab' });
  assert.deepEqual(calls, [], 'uninstalling removes every listener');
});

// ── The markup ────────────────────────────────────────────────────

function sourceFiles() {
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') ? [path] : [];
  });
  // The mechanism's own two files describe the syntax in comments and error
  // messages; they are not markup.
  const mechanism = new Set(['js/actions.js', 'js/action-registry.js']);
  return [join(ROOT, 'index.html'), ...walk(join(ROOT, 'js'))]
    .map(path => [relative(ROOT, path).replaceAll('\\', '/'), path])
    .filter(([file]) => !mechanism.has(file))
    .map(([file, path]) => [file, readFileSync(path, 'utf8')]);
}

/** Every data-action value written in the app, with where it is. */
function actionSpecs() {
  const out = [];
  const forms = [
    /data-action="([^"]*)"/g,
    /setAttribute\(\s*'data-action'\s*,\s*'([^']*)'/g,
    /dataset\.action\s*=\s*'([^']*)'/g
  ];
  for (const [file, src] of sourceFiles()) {
    for (const rx of forms) {
      for (const m of src.matchAll(rx)) {
        out.push({ spec: m[1], where: `${file}:${src.slice(0, m.index).split('\n').length}` });
      }
    }
  }
  return out;
}

test('every data-action in the app is literal, readable, and names an action that exists', () => {
  const problems = [];
  for (const { spec, where } of actionSpecs()) {
    // Literal so that a search for an action's name finds every control using
    // it, and so this check sees what the browser will.
    if (spec.includes('${')) { problems.push(`${where}: interpolated data-action="${spec}"`); continue; }
    let tokens;
    try { tokens = parseActionSpec(spec); } catch (e) { problems.push(`${where}: ${e.message}`); continue; }
    for (const { event, name } of tokens) {
      const action = getAction(name);
      if (!action) { problems.push(`${where}: no action named "${name}"`); continue; }
      if (typeof action === 'object' && event && !action[event]) {
        problems.push(`${where}: behaviour "${name}" has no ${event} handler`);
      }
      if (typeof action === 'object' && !event && !Object.keys(action).every(k => SPEC_EVENT_NAMES.includes(k))) {
        problems.push(`${where}: behaviour "${name}" handles an event the dispatcher does not deliver`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('every registered action is used by some control: the registry does not grow dead names', () => {
  const used = new Set(actionSpecs().flatMap(({ spec }) => {
    try { return parseActionSpec(spec).map(t => t.name); } catch { return []; }
  }));
  const unused = actionNames().filter(name => !name.startsWith('test.') && !used.has(name));
  assert.deepEqual(unused, []);
});

test('the scan sees generated markup, not only index.html', () => {
  // A guard on the guard: a scan that found nothing would pass both tests above.
  const specs = actionSpecs();
  assert.ok(specs.some(s => s.where.startsWith('js/algorithms-fa.js') && s.spec === 'algo.loadSubsetAsDFA'));
  assert.ok(specs.some(s => s.spec.startsWith('suggest.symbols ')), 'a behaviour followed by a key action');
});

// ── The seam is gone ──────────────────────────────────────────────
// There is no on*="..." left in the app and no bridge.js to put names on
// window for one. These keep it that way: a handler written in any of the
// shapes the app ever used fails here, wherever it is.

test('bridge.js is gone, and nothing puts the app\'s functions on window', () => {
  assert.throws(() => statSync(join(ROOT, 'js', 'bridge.js')), /ENOENT/);
  const offenders = sourceFiles()
    .filter(([file, src]) => /Object\.assign\(\s*window/.test(src))
    .map(([file]) => file);
  assert.deepEqual(offenders, []);
});

test('no inline handler anywhere in index.html or js/', () => {
  // The four shapes handlers were written in: an attribute in markup, an
  // attribute assembled from a name, setAttribute('onclick', …), and an
  // attribute map ({ onclick: … }).
  const on = 'on(?:click|dblclick|auxclick|contextmenu|input|change|submit|key(?:down|up|press)|focus|blur|'
    + 'mouse[a-z]+|pointer[a-z]+|drag[a-z]*|drop|scroll|load|wheel|touch[a-z]+)';
  const inline = new RegExp(`\\s${on}\\s*=\\s*\\\\?["'\`]|setAttribute\\(\\s*['"\`]${on}['"\`]|\\b${on}:\\s*['"\`]`, 'g');
  const found = [];
  for (const [file, src] of sourceFiles()) {
    // Comments may say what used to be here; code may not do it. Blanked
    // rather than removed, so line numbers still point at the source.
    const blank = text => text.replace(/[^\n]/g, ' ');
    const code = file.endsWith('.js')
      ? src.replace(/\/\/[^\n]*/g, blank)
      : src.replace(/<!--[\s\S]*?-->/g, blank);
    for (const m of code.matchAll(inline)) {
      found.push(`${file}:${code.slice(0, m.index).split('\n').length}  ${m[0].trim()}`);
    }
  }
  assert.deepEqual(found, []);
});
