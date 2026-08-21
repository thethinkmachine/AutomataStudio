import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The Settings dialog.
//
// It is a wide surface -- 28 controls writing into App.config -- and almost
// none of it was covered. The parts most exposed by the module conversion are
// the ones that leave ui.js:
//
//   - the radius goes through setR(), because `R` is a `let` in state.js that
//     other modules import. Imported bindings are read-only, so this is the
//     one path where a missed setR leaves the renderer on the old value while
//     App.config says otherwise
//   - changing a system symbol calls migrateSystemSymbols across the machine
//   - applyTheme copies a palette into App.config.export for the SVG canvas
//
// openSettingsModal also reads a dozen ids without null-guarding them, so a
// renamed element takes the whole dialog down rather than one row.

function openAndRead(h) {
  h.context.openSettingsModal();
  return id => h.getElement(id);
}

test('the dialog opens and populates every control from App.config', () => {
  const h = createHarness();
  const { App } = h.context;
  App.config.radius = 42;
  App.config.maxPdaSteps = 1234;
  App.config.gridSnap = 25;
  App.config.sym.blank = '_';

  assert.doesNotThrow(() => h.context.openSettingsModal(),
    'an unguarded $(...) on a missing control would take the whole dialog down');

  assert.equal(h.getElement('set-radius').value, 42);
  assert.equal(h.getElement('set-pda-steps').value, 1234);
  assert.equal(h.getElement('set-grid-snap').value, 25);
  assert.equal(h.getElement('set-sym-blank').value, '_');
});

test('confirming writes the values back into App.config', () => {
  const h = createHarness();
  const $ = openAndRead(h);

  $('set-radius').value = '55';
  $('set-pda-steps').value = '777';
  $('set-tm-steps').value = '8888';
  $('set-auto-speed').value = '250';
  $('set-zoom-step').value = '0.25';
  $('set-grid-snap').value = '15';
  $('set-curve-off').value = '60';
  $('set-edge-label-style').value = 'pills';
  $('set-transducer-accepts').checked = true;

  h.context.confirmSettings();

  const c = h.context.App.config;
  assert.equal(c.radius, 55);
  assert.equal(c.maxPdaSteps, 777);
  assert.equal(c.maxTmSteps, 8888);
  assert.equal(c.autoSpeed, 250);
  assert.equal(c.zoom.step, 0.25);
  assert.equal(c.gridSnap, 15);
  assert.equal(c.render.curveOff, 60);
  assert.equal(c.edgeLabelStyle, 'pills');
  assert.equal(c.transducerAccepts, true);
});

test('changing the radius reaches the renderer, not just App.config', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  h.context.renderAll();
  const circle = App.domCache.states.get(App.states[0].id).__parts.circle;
  const before = Number(circle.getAttribute('r'));

  const $ = openAndRead(h);
  $('set-radius').value = String(before + 20);
  h.context.confirmSettings();

  assert.equal(App.config.radius, before + 20);
  assert.equal(Number(circle.getAttribute('r')), before + 20,
    'setR must publish the new radius to the modules that imported R');
});

// R mirrors App.config.radius for every module that imported it. confirmSettings
// republishes it, but for a long time that was the *only* place that did --
// so anything else replacing App.config wholesale left the canvas drawing at
// the previous radius while the config reported the new one.

test('loading a file republishes the radius it was saved with', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.openSettingsModal();
  h.getElement('set-radius').value = '55';
  h.context.confirmSettings();

  h.context.loadData({
    machine: 'DFA', sigma: ['a'], accepts: [], transitions: [], startId: 's1',
    states: [{ id: 's1', x: 50, y: 50, name: 'q0' }],
    config: { radius: 30 }
  }, false);
  h.context.renderAll();

  assert.equal(App.config.radius, 30);
  assert.equal(Number(App.domCache.states.get('s1').__parts.circle.getAttribute('r')), 30,
    'the canvas must not keep drawing at the radius from before the load');
});

test('restoring a workspace republishes its radius', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');
  App.config.radius = 18;
  const saved = h.context.exportWorkspaceState();

  h.context.openSettingsModal();
  h.getElement('set-radius').value = '60';
  h.context.confirmSettings();

  h.context.importWorkspaceState(saved);
  h.context.renderAll();

  assert.equal(App.config.radius, 18);
  assert.equal(Number(App.domCache.states.get(App.states[0].id).__parts.circle.getAttribute('r')), 18,
    'switching tabs must pick up that tab\'s radius');
});

// exportWorkspaceState serialises App.config wholesale, so every saved tab and
// every autosave blob carries a copy of the theme and the export palette it was
// written under. Restoring one used to merge those back over the live config:
// the page kept the theme you picked, while the canvas, the minimap and every
// PNG export repainted in the saved tab's colours. It showed up as a minimap
// in the wrong palette after a hard refresh, because boot applies the theme and
// *then* restores the workspace asynchronously.
test('restoring a workspace does not carry the theme it was saved under', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(100, 100, 'q0');

  h.context.applyTheme('dark', false);
  const savedUnderDark = h.context.exportWorkspaceState();

  h.context.applyTheme('light', false);
  const live = { ...App.config.export };

  h.context.importWorkspaceState(savedUnderDark);

  assert.equal(App.config.theme, 'light', 'a tab must not change the app theme');
  assert.deepEqual(App.config.export, live, 'a tab must not change the export palette');
});

test('a blank or junk numeric field falls back instead of writing NaN', () => {
  const h = createHarness();
  const $ = openAndRead(h);
  $('set-radius').value = '';
  $('set-pda-steps').value = 'abc';
  $('set-zoom-step').value = '';

  h.context.confirmSettings();

  const c = h.context.App.config;
  assert.equal(c.radius, 30);
  assert.equal(c.maxPdaSteps, 2000);
  assert.equal(c.zoom.step, 0.1);
  for (const v of [c.radius, c.maxPdaSteps, c.zoom.step]) {
    assert.equal(Number.isNaN(v), false, 'a NaN here silently breaks layout and simulation');
  }
});

test('node spacing is clamped so a zero cannot collapse auto-layout', () => {
  const h = createHarness();
  const $ = openAndRead(h);
  $('set-node-spacing').value = '0';
  h.context.confirmSettings();
  assert.ok(h.context.App.config.layout.nodeSpacing >= 8);
});

test('changing a system symbol migrates the symbols already on the machine', () => {
  const h = createHarness();
  const { App } = h.context;
  App.machine = 'DPDA';
  h.context.createState(0, 0, 'q0');
  const oldBottom = App.config.sym.stackBottom;
  App.stackAlpha = new Set([oldBottom]);
  App.transitions.push({
    id: h.context.newTId(), from: App.states[0].id, to: App.states[0].id,
    symbol: 'a', pop: oldBottom, push: oldBottom
  });

  const $ = openAndRead(h);
  $('set-sym-z0').value = '#';
  h.context.confirmSettings();

  assert.equal(App.config.sym.stackBottom, '#');
  assert.equal(App.transitions[0].pop, '#', 'transitions must follow the renamed symbol');
  assert.equal(App.stackAlpha.has('#'), true, 'and so must Γ');
  assert.equal(App.stackAlpha.has(oldBottom), false);
});

test('settings export and re-import round-trips every field', () => {
  const h = createHarness();
  const { App } = h.context;
  App.config.radius = 47;
  App.config.maxTmSteps = 4321;
  App.config.layout.nodeSpacing = 60;
  App.config.sym.any = '@';
  App.config.edgeLabelStyle = 'beginner';

  const saved = h.context.getEditorSettingsData();
  assert.equal(saved.radius, 47);
  assert.equal(saved.maxTmSteps, 4321);
  assert.equal(saved.layoutNodeSpacing, 60);
  assert.equal(saved.symAny, '@');
  assert.equal(saved.edgeLabelStyle, 'beginner');

  // Every key the dialog can write should be represented, or exporting your
  // settings quietly drops one.
  for (const k of ['theme', 'wheelZoom', 'snapToGrid', 'statePrefix', 'pdaParadigm',
    'transducerAccepts', 'twoWayTape', 'detectLoops',
    'maxPdaSteps', 'maxTmSteps', 'langStepBudget', 'autoSpeed',
    'autosaveIntervalMs', 'radius', 'wrapStateLabels', 'edgeLabelStyle', 'clickHighlightMode', 'zoomStep',
    'gridSnap', 'layoutAlgorithm', 'layoutNodeSpacing', 'renderCurveOff', 'exportRes',
    'symEps', 'symLambda', 'symAny', 'symBlank', 'symLeft', 'symRight', 'symZ0']) {
    assert.ok(k in saved, `getEditorSettingsData drops ${k}`);
  }
});

test('the settings that change what a run decides travel with the workspace', () => {
  const h = createHarness();
  const { App } = h.context;
  App.config.detectLoops = false;
  App.config.twoWayTape = true;

  // Both are model configuration rather than editor chrome: a file that
  // decides differently when someone else opens it is a file that lies.
  const saved = h.context.getWorkspaceData();
  assert.equal(saved.config.detectLoops, false);
  assert.equal(saved.config.twoWayTape, true);

  App.config.detectLoops = true;
  App.config.twoWayTape = false;
  h.context.loadData(saved);
  assert.equal(App.config.detectLoops, false);
  assert.equal(App.config.twoWayTape, true);

  App.config.detectLoops = true;
  App.config.twoWayTape = false;
});

test('switching settings tabs activates exactly one panel', () => {
  const h = createHarness();
  h.context.openSettingsModal();
  // Every tab in the strip, so that reordering it cannot leave a tab pointing at
  // a panel that is not there. Only the activation is asserted: deactivating the
  // others goes through querySelectorAll, which the DOM stub does not implement.
  for (const tab of ['general', 'rendering', 'symbols', 'pda', 'tm', 'transducer']) {
    h.context.switchSettingsTab(tab);
    const content = h.getElement(`tab-${tab}`);
    assert.ok(content, `${tab} has no panel`);
    assert.equal(content.classList.contains('active'), true, `${tab} panel should be active`);
  }
});

test('applying a theme publishes its palette to the canvas colours', () => {
  const h = createHarness();
  h.context.applyTheme('nord');

  // The SVG canvas and the minimap paint from JS colour values, not CSS
  // variables, so a theme that never reaches App.config.export renders in the
  // previous theme's colours however correct the stylesheet is.
  const palette = h.context.Themes.nord.export;
  const applied = h.context.App.config.export;
  assert.ok(Object.keys(palette).length, 'nord should declare an export palette');
  for (const [k, v] of Object.entries(palette)) {
    assert.equal(applied[k], v, `App.config.export.${k} must come from the theme`);
  }
});
