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

test('a spec is tokens of [event[.key]->]name, run in the order written', () => {
  assert.deepEqual(parseActionSpec('algo.loadSubsetAsDFA'),
    [{ event: null, key: null, name: 'algo.loadSubsetAsDFA' }]);
  assert.deepEqual(parseActionSpec('  suggest.symbols   keydown.Enter->algo.buildNFATree '), [
    { event: null, key: null, name: 'suggest.symbols' },
    { event: 'keydown', key: 'enter', name: 'algo.buildNFATree' }
  ]);
  assert.deepEqual(parseActionSpec('blur->x.y_z'), [{ event: 'blur', key: null, name: 'x.y_z' }]);
});

test('a spec that cannot mean anything is refused, naming the token', () => {
  assert.throws(() => parseActionSpec('hover->algo.x'), /Unknown event "hover"/);
  assert.throws(() => parseActionSpec('click.enter->algo.x'), /key filter needs keydown or keyup/);
  assert.throws(() => parseActionSpec('loadSubsetAsDFA()'), /Unreadable action token/);
  assert.throws(() => parseActionSpec('algo.'), /Unreadable/);
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

// ── The seam only shrinks ─────────────────────────────────────────
// Each batch moved to data-action lowers the ceiling and adds its files to
// the list below; nothing may raise the one or leave the other. CLAUDE.md,
// "Modules, and the one global seam", and issue #141 hold the plan.

const BRIDGE_CEILING = 185;

const FREE_OF_INLINE_HANDLERS = [
  'js/algorithms-fa.js',
  'js/action-registry.js',
  'js/actions.js'
];

function bridgedNames() {
  const src = readFileSync(join(ROOT, 'js', 'bridge.js'), 'utf8');
  const open = src.indexOf('Object.assign(window, {');
  const body = src.slice(open + 'Object.assign(window, {'.length, src.lastIndexOf('});'));
  return body.replace(/\/\/[^\n]*/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

test(`bridge.js puts at most ${BRIDGE_CEILING} names on window`, () => {
  const names = bridgedNames();
  assert.ok(names.length <= BRIDGE_CEILING,
    `bridge.js exposes ${names.length} names; the ceiling is ${BRIDGE_CEILING}. `
    + 'Wire the new control with data-action (js/actions.js) instead of adding to the bridge.');
  if (names.length < BRIDGE_CEILING) {
    console.log(`# bridge.js is down to ${names.length}: lower BRIDGE_CEILING in tests/actions.test.js`);
  }
});

test('files moved to data-action stay free of inline handlers', () => {
  // The three shapes a handler is written in across the app: an attribute in
  // markup, setAttribute('onclick', …), and an attribute map ({ onclick: … }).
  const on = 'on(?:click|dblclick|contextmenu|input|change|submit|key(?:down|up|press)|focus|blur|'
    + 'mouse[a-z]+|pointer[a-z]+|drag[a-z]*|drop|scroll|load|wheel|touch[a-z]+)';
  const inline = new RegExp(`\\s${on}\\s*=\\s*\\\\?["'\`]|setAttribute\\(\\s*['"\`]${on}['"\`]|\\b${on}:\\s*['"\`]`, 'g');
  const found = [];
  for (const file of FREE_OF_INLINE_HANDLERS) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const m of src.matchAll(inline)) {
      found.push(`${file}:${src.slice(0, m.index).split('\n').length}  ${m[0].trim()}`);
    }
  }
  assert.deepEqual(found, []);
});
