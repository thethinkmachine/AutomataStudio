const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_ORDER = [
  'js/state.js',
  'js/modal.js',
  'js/utils.js',
  'js/states-transitions.js',
  'js/simulation.js',
  'js/suggest.js',
  'js/render.js',
  'js/language.js',
  'js/dividers.js',
  'js/workspace.js',
  'js/persistence.js',
  'js/ui.js',
  'js/algorithms-fa.js',
  'js/algorithms-cfg.js'
];

function createElement(id = '') {
  const classSet = new Set();
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    className: '',
    dataset: {},
    style: {},
    children: [],
    disabled: false,
    clientWidth: 800,
    clientHeight: 600,
    scrollTop: 0,
    scrollHeight: 0,
    _listeners: {},
    // Elements are considered laid out unless a test says otherwise; the
    // overlay code uses this to skip members that are display:none.
    offsetParent: {},
    classList: {
      add: (...names) => names.forEach(name => classSet.add(name)),
      remove: (...names) => names.forEach(name => classSet.delete(name)),
      toggle: (name, force) => {
        if (force === true) { classSet.add(name); return true; }
        if (force === false) { classSet.delete(name); return false; }
        if (classSet.has(name)) { classSet.delete(name); return false; }
        classSet.add(name);
        return true;
      },
      contains: name => classSet.has(name)
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(newNode, referenceNode) {
      if (referenceNode == null) { this.children.push(newNode); return newNode; }
      const idx = this.children.indexOf(referenceNode);
      if (idx === -1) throw new Error('insertBefore: referenceNode is not a child of this node');
      this.children.splice(idx, 0, newNode);
      return newNode;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    getAttribute(name) {
      return this[name] === undefined ? null : this[name];
    },
    removeAttribute(name) {
      delete this[name];
    },
    hasAttribute(name) {
      return this[name] !== undefined;
    },
    addEventListener(type, handler) {
      this._listeners[type] = handler;
    },
    removeEventListener(type) {
      delete this._listeners[type];
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    },
    click() {}
  };
}

function createHarness() {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };

  const document = {
    documentElement: { dataset: {}, style: {} },
    body: createElement('body'),
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById(id) {
      return getElement(id);
    },
    createElement() {
      return createElement();
    },
    createElementNS() {
      return createElement();
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text), children: [] };
    }
  };

  const localStorageData = new Map();
  const localStorage = {
    getItem(key) {
      return localStorageData.has(key) ? localStorageData.get(key) : null;
    },
    setItem(key, value) {
      localStorageData.set(key, String(value));
    },
    removeItem(key) {
      localStorageData.delete(key);
    }
  };

  const context = vm.createContext({
    console,
    Math,
    JSON,
    Set,
    Map,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    document,
    localStorage,
    window: null,
    navigator: {},
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // renderTabs defers overflow measurement to a frame; run it inline so the
    // DOM-dependent tail is exercised rather than silently dropped.
    requestAnimationFrame: fn => { fn(); return 0; },
    cancelAnimationFrame: () => {},
    fetch: async () => { throw new Error('fetch not available in tests'); },
    Blob: function Blob(parts) { this.parts = parts; },
    URL: { createObjectURL: () => 'blob:test' },
    snapshot: () => {},
    // closeModal/showOverlay come from js/modal.js, loaded in SCRIPT_ORDER.
    setView: () => {},
    renderSigma: () => {},
    renderGamma: () => {},
    renderOutputAlpha: () => {},
    clearTempLine: () => {},
    applyCamera: () => {},
    fitToScreen: () => {}
  });
  context.window = context;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  // Desktop by default; tests that exercise the compact layout override this.
  context.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  context.setMachine = m => { context.App.machine = m; };
  context.applyMachineSwitch = m => { context.App.machine = m; };

  for (const rel of SCRIPT_ORDER) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, context, { filename: rel });
    if (rel === 'js/state.js') {
      vm.runInContext('globalThis.App = App; globalThis.MachineTypes = MachineTypes; globalThis.SVG_NS = SVG_NS; globalThis.R = R; globalThis.$ = $;', context);
    }
  }

  const baseConfig = JSON.parse(JSON.stringify(context.App.config));
  const baseDirections = JSON.parse(JSON.stringify(context.App.directions));

  function resetApp() {
    const App = context.App;
    App.machine = 'DFA';
    App.tool = 'move';
    App.view = 'build';
    App.sigma = new Set(['a', 'b']);
    App.outputAlpha = new Set(['0', '1']);
    App.stackAlpha = new Set([baseConfig.sym.stackBottom]);
    App.tapeCount = 2;
    App.states = [];
    App.transitions = [];
    App.startId = null;
    App.accepts = new Set();
    App.selectedStates = new Set();
    App.selectedTransitions = new Set();
    App.stateN = 0;
    App.transN = 0;
    App.notes = [];
    App.noteN = 0;
    App.dividers = [];
    App.dividerN = 0;
    App.selectedDividerId = null;
    App.config = JSON.parse(JSON.stringify(baseConfig));
    App.cam = { x: 0, y: 0, z: 1 };
    App.history = [];
    App.future = [];
    App.drag = null;
    App.dragOff = { x: 0, y: 0 };
    App.transFrom = null;
    App.ctxId = null;
    App.editId = null;
    App.simSteps = [];
    App.simIdx = 0;
    App.autoTimer = null;
    if (App.grammar) {
      App.grammar.vars = new Set(['S']);
      App.grammar.start = 'S';
      App.grammar.productions = [];
    } else {
      App.grammar = { vars: new Set(['S']), start: 'S', productions: [] };
    }
    App.currentAlgo = 'table';
    App.stateClassification = null;
    App.workspaceB = null;
    App.directions = JSON.parse(JSON.stringify(baseDirections));
    context.R = App.config.radius;
    elements.clear();
  }

  resetApp();

  // Top-level `let`/`const` in the loaded scripts (Workspaces,
  // activeWorkspaceId, ...) are lexical bindings, not properties of the
  // context object — reading or assigning context.X only ever touches a
  // shadowing own-property the module code never sees. This reaches the
  // real binding.
  const evalInContext = expr => vm.runInContext(expr, context, { filename: 'test-eval' });

  return {
    context,
    getElement,
    resetApp,
    evalInContext
  };
}

module.exports = { createHarness };
