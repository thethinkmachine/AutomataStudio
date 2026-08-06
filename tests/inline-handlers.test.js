import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHarness } from './harness.js';
// Importing the bridge is the point of this file: it is what puts the handler
// names on window in the real app, and what this asserts against.
import '../js/bridge.js';

// The on*= -> window seam.
//
// Inline handlers are evaluated as global-scope code, so they can only reach
// functions bridge.js has put on window. A name that is missing does not throw
// at build time, at boot, or anywhere a normal test would look -- the control
// just quietly does nothing when clicked. That is how selectModel shipped
// broken: the model picker rendered fine and every item was dead.
//
// Two thirds of these attributes are in markup the JS builds at runtime, so
// reading index.html is not enough. Neither is parsing the handler as JS: when
// the whole value is one interpolation,
//
//     onclick="${isDisabled ? '' : `selectModel('${mid}')`}"
//
// the call being checked lives inside the ${...}. So this scans the raw text
// for `name(` and accepts the false positives instead of risking a false
// negative.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Names that appear as `name(` inside a handler but are not handler calls.
const NOT_HANDLERS = new Set([
  // Evaluated while the markup is being built, not when it is clicked.
  'jsAttr',
  // Loaded from a CDN by index.html.
  'renderMathInElement',
  // Language keywords and standard globals.
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'throw', 'case',
  'alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'isNaN', 'Number',
  'String', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'Set', 'Map',
  'RegExp', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout',
  'clearTimeout', 'requestAnimationFrame', 'fetch'
]);

// Reads the full value of every on*= attribute, tracking ${...} nesting so a
// quote inside an interpolation does not end the value early.
function inlineHandlers(src) {
  const out = [];
  const rx = /\son([a-z]+)\s*=\s*(\\?["'])/g;
  let m;
  while ((m = rx.exec(src))) {
    const quote = m[2].replace('\\', '');
    let depth = 0, value = '', esc = false, i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (esc) { value += ch; esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '$' && src[i + 1] === '{') { depth++; value += '${'; i++; continue; }
      if (ch === '}' && depth) { depth--; value += ch; continue; }
      if (ch === quote && !depth) break;
      value += ch;
    }
    out.push({ attr: 'on' + m[1], value, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

function sources() {
  const files = [['index.html', readFileSync(join(ROOT, 'index.html'), 'utf8')]];
  for (const f of readdirSync(join(ROOT, 'js')).filter(x => x.endsWith('.js'))) {
    files.push([`js/${f}`, readFileSync(join(ROOT, 'js', f), 'utf8')]);
  }
  return files;
}

function calledNames() {
  const calls = new Map(); // name -> "file:line attr"
  for (const [file, src] of sources()) {
    for (const h of inlineHandlers(src)) {
      for (const c of h.value.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (h.value[c.index - 1] === '.') continue; // obj.method(...)
        if (NOT_HANDLERS.has(c[1])) continue;
        if (!calls.has(c[1])) calls.set(c[1], `${file}:${h.line} ${h.attr}`);
      }
    }
  }
  return calls;
}

test('every function called from an inline handler is on window', () => {
  createHarness();
  const missing = [];
  for (const [name, where] of calledNames()) {
    if (typeof globalThis[name] !== 'function') missing.push(`${name}  (${where})`);
  }
  assert.deepEqual(missing, [],
    'these controls are silently dead — add them to js/bridge.js');
});

test('the scan reaches handlers in runtime-generated markup, not just index.html', () => {
  // A guard on the guard: if the attribute reader regressed to only matching
  // plain HTML, the test above would pass by checking almost nothing.
  const calls = calledNames();
  assert.ok(calls.size > 150, `expected the full seam, saw ${calls.size} names`);
  // selectModel is reachable only from a fully-interpolated attribute value,
  // which is exactly the shape the first version of this scan missed.
  assert.ok(calls.has('selectModel'), 'interpolated handler values must be scanned');
});

test('picking a model from the picker switches the machine', () => {
  const h = createHarness();
  const { App } = h.context;
  assert.equal(App.machine, 'DFA');

  h.context.selectModel('NFA');
  assert.equal(App.machine, 'NFA', 'selecting an implemented model switches to it');
});

test('the model picker renders an onclick naming a function that exists', () => {
  const h = createHarness();
  h.context.renderModelPicker();
  const html = h.getElement('model-picker-menu').innerHTML;

  const names = [...html.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]);
  assert.ok(names.length, 'the picker should render clickable model items');
  for (const n of new Set(names)) {
    assert.equal(typeof globalThis[n], 'function', `${n} is named by the picker but not on window`);
  }
});
