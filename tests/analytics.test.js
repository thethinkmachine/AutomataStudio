import test from 'node:test';
import assert from 'node:assert/strict';
import { MEASUREMENT_ID, shouldMeasure, startAnalytics } from '../js/analytics.js';

// The website reports its visits and nothing else does: the dev server and
// `vite preview` are http://localhost, and the desktop app is app://.

function fakeWindow(href) {
  const appended = [];
  return {
    location: new URL(href),
    document: {
      createElement: tag => ({ tagName: tag.toUpperCase() }),
      head: { appendChild: el => appended.push(el) }
    },
    appended
  };
}

test('only a page served over https is measured', () => {
  assert.equal(shouldMeasure(new URL('https://thethinkmachine.github.io/AutomataStudio/')), true);
  assert.equal(shouldMeasure(new URL('http://localhost:5173/')), false, 'dev server');
  assert.equal(shouldMeasure(new URL('http://localhost:4173/')), false, 'vite preview');
  assert.equal(shouldMeasure(new URL('app://index.html/')), false, 'desktop app');
  assert.equal(shouldMeasure(new URL('file:///C:/app/index.html')), false);
  assert.equal(shouldMeasure(undefined), false);
});

test('nothing is loaded or queued where nothing is measured', () => {
  const win = fakeWindow('app://index.html/');
  assert.equal(startAnalytics(win), false);
  assert.equal(win.dataLayer, undefined);
  assert.deepEqual(win.appended, []);
});

test('on the website the tag is queued as gtag.js expects, and loaded once', () => {
  const win = fakeWindow('https://thethinkmachine.github.io/AutomataStudio/');
  assert.equal(startAnalytics(win), true);
  assert.equal(startAnalytics(win), false, 'a second call does nothing');

  // gtag.js reads each entry as an Arguments object; an array is ignored.
  const kinds = win.dataLayer.map(entry => Object.prototype.toString.call(entry));
  assert.deepEqual(kinds, ['[object Arguments]', '[object Arguments]']);
  assert.equal(win.dataLayer[0][0], 'js');
  assert.deepEqual([...win.dataLayer[1]], ['config', MEASUREMENT_ID]);

  assert.equal(win.appended.length, 1);
  assert.equal(win.appended[0].src, `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
  assert.equal(win.appended[0].async, true);
});
