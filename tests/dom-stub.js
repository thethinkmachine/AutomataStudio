// Minimal DOM/browser stand-in, installed on globalThis as an import side
// effect. It has to be in its own module because ES modules evaluate all their
// imports before any of their own code: js/ modules touch document at module
// scope (canvas.js resolves #canvas-wrap, several files attach listeners), so
// the stubs must already exist when those modules are imported. harness.mjs
// imports this first, and ES modules evaluate imports in source order.
const elements = new Map();

function detach(node) {
  if (node && typeof node === 'object' && node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

export function createElement(id = '') {
  const classSet = new Set();
  const el = {
    id,
    tagName: String(id || 'DIV').toUpperCase(),
    value: '',
    textContent: '',
    className: '',
    dataset: {},
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    children: [],
    parentNode: null,
    disabled: false,
    checked: false,
    clientWidth: 800,
    clientHeight: 600,
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    scrollWidth: 0,
    offsetWidth: 800,
    offsetHeight: 600,
    _listeners: {},
    // Elements count as laid out unless a test says otherwise; the overlay code
    // uses this to skip members that are display:none.
    offsetParent: {},
    classList: {
      add: (...names) => names.forEach(n => classSet.add(n)),
      remove: (...names) => names.forEach(n => classSet.delete(n)),
      toggle: (name, force) => {
        if (force === true) { classSet.add(name); return true; }
        if (force === false) { classSet.delete(name); return false; }
        if (classSet.has(name)) { classSet.delete(name); return false; }
        classSet.add(name);
        return true;
      },
      contains: name => classSet.has(name)
    },
    // appendChild/insertBefore detach from the previous parent first, the way a
    // real DOM does. The incremental renderer relies on it: reordering a node
    // is a single insertBefore, not a remove-then-insert pair.
    appendChild(child) {
      detach(child);
      this.children.push(child);
      if (child && typeof child === 'object') child.parentNode = this;
      return child;
    },
    // append() takes several nodes at once and accepts bare strings. The app
    // reaches for it wherever a row is assembled from parts — showExampleCard
    // and the whole of statemate-ui.js — so a stub without it would fail on
    // code paths that work perfectly in a browser.
    append(...nodes) {
      nodes.forEach(node => {
        if (node === null || node === undefined) return;
        if (typeof node === 'object') this.appendChild(node);
        else this.textContent += String(node);
      });
    },
    prepend(...nodes) {
      const first = this.children[0] || null;
      nodes.forEach(node => {
        if (node === null || node === undefined) return;
        if (typeof node === 'object') this.insertBefore(node, first);
        else this.textContent = String(node) + this.textContent;
      });
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) {
        this.children.splice(i, 1);
        if (child && typeof child === 'object') child.parentNode = null;
      }
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    insertBefore(newNode, referenceNode) {
      detach(newNode);
      if (referenceNode == null) {
        this.children.push(newNode);
      } else {
        const idx = this.children.indexOf(referenceNode);
        if (idx === -1) throw new Error('insertBefore: referenceNode is not a child of this node');
        this.children.splice(idx, 0, newNode);
      }
      if (newNode && typeof newNode === 'object') newNode.parentNode = this;
      return newNode;
    },
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get childNodes() { return this.children; },
    get nextSibling() {
      const p = this.parentNode;
      if (!p) return null;
      const i = p.children.indexOf(this);
      return i === -1 ? null : (p.children[i + 1] || null);
    },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] === undefined ? null : this[name]; },
    removeAttribute(name) { delete this[name]; },
    hasAttribute(name) { return this[name] !== undefined; },
    addEventListener(type, handler) { this._listeners[type] = handler; },
    removeEventListener(type) { delete this._listeners[type]; },
    dispatchEvent() { return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, x: 0, y: 0, width: this.clientWidth, height: this.clientHeight };
    },
    focus() {},
    blur() {},
    click() {},
    scrollIntoView() {},
    getContext: () => null
  };
  // Assigning innerHTML has to detach the children, or code that clears a group
  // with `g.innerHTML = ''` would leave the stub reporting them as still there.
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: value => {
      html = String(value);
      for (const child of el.children.slice()) {
        if (child && typeof child === 'object') child.parentNode = null;
      }
      el.children.length = 0;
    },
    enumerable: true,
    configurable: true
  });
  return el;
}

// A recording CanvasRenderingContext2D. It implements the whole surface the
// minimap paints through rather than the handful of calls one test happened to
// need, because a missing method here is a TypeError in production code that
// works fine in a browser — the failure mode is "the test stub is out of date",
// which is not a useful thing to rediscover.
//
// Every call lands in `ops` as [name, ...args], and the settable properties are
// captured alongside so a test can ask what colour something was drawn in.
export function createContext2D() {
  const ops = [];
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
  const record = name => (...args) => {
    ops.push([name, ...args, { ...state }]);
  };
  const ctx = {
    ops,
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'),
    arc: record('arc'),
    arcTo: record('arcTo'),
    ellipse: record('ellipse'),
    rect: record('rect'),
    roundRect: record('roundRect'),
    fill: record('fill'),
    stroke: record('stroke'),
    clip: record('clip'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    rotate: record('rotate'),
    setTransform: record('setTransform'),
    resetTransform: record('resetTransform'),
    setLineDash: record('setLineDash'),
    getLineDash: () => [],
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  };
  for (const key of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'lineCap',
    'lineJoin', 'font', 'textAlign', 'textBaseline', 'shadowBlur', 'shadowColor',
    'globalCompositeOperation', 'miterLimit', 'imageSmoothingEnabled']) {
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: v => { state[key] = v; },
      enumerable: true,
      configurable: true
    });
  }
  /** Every recorded call to `name`, each as [...args, propertiesAtCallTime]. */
  ctx.calls = name => ops.filter(o => o[0] === name).map(o => o.slice(1));
  ctx.reset = () => { ops.length = 0; };
  return ctx;
}

/**
 * Turn an element into a canvas whose 2D context records what was drawn, and
 * give it a measurable CSS box so devicePixelRatio sizing has something to work
 * from. Returns the context.
 */
export function stubCanvas(el, cssW = 160, cssH = 100) {
  const ctx = createContext2D();
  el.isConnected = true;
  el.width = cssW;
  el.height = cssH;
  el.getContext = () => ctx;
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: cssW, bottom: cssH, x: 0, y: 0, width: cssW, height: cssH
  });
  return ctx;
}

export function getElement(id) {
  if (!elements.has(id)) elements.set(id, createElement(id));
  return elements.get(id);
}

export function clearElements() {
  elements.clear();
}

// Document-level listeners, recorded so a test can deliver a key to them.
// Several features listen for the same key on document — modal.js, the canvas
// shortcuts, StateMate's Escape ladder — and which of them may claim it is a
// question about *phase*, not about registration order, so the delivery below
// models capture-before-bubble and honours stopPropagation.
const documentListeners = [];

const documentStub = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: createElement().classList },
  body: createElement('body'),
  head: createElement('head'),
  activeElement: null,
  addEventListener(type, handler, options) {
    if (typeof handler !== 'function') return;
    documentListeners.push({
      type,
      handler,
      capture: options === true || !!(options && options.capture)
    });
  },
  removeEventListener(type, handler) {
    const at = documentListeners.findIndex(l => l.type === type && l.handler === handler);
    if (at !== -1) documentListeners.splice(at, 1);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById(id) { return getElement(id); },
  getElementsByClassName() { return []; },
  createElement(name) { return createElement(name); },
  createElementNS(ns, name) { return createElement(name); },
  createDocumentFragment() { return createElement(); },
  createTextNode(text) { return { nodeType: 3, textContent: String(text), children: [] }; },
  // view.js checks document.contains(previouslyFocused) before restoring focus.
  contains() { return false; },
  execCommand() { return true; }
};

/**
 * Deliver an event to the document listeners the app registered at module scope.
 *
 * Capture listeners run first and `stopPropagation` ends the delivery, the way a
 * real DOM behaves — a capture-phase listener on document that stops the event
 * pre-empts every bubble-phase one, which is exactly the failure mode worth
 * testing. Returns the event so the caller can read `defaultPrevented`.
 *
 * @param {string} type
 * @param {object} [init]  event fields; `target` defaults to document.body.
 */
export function dispatchDocumentEvent(type, init = {}) {
  const event = {
    type,
    target: documentStub.body,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() { event.propagationStopped = true; },
    stopImmediatePropagation() { event.propagationStopped = true; },
    ...init
  };
  const phase = capture => documentListeners.filter(l => l.type === type && l.capture === capture);
  for (const listener of [...phase(true), ...phase(false)]) {
    if (event.propagationStopped) break;
    listener.handler(event);
  }
  return event;
}

const localStorageData = new Map();
const localStorageStub = {
  getItem(key) { return localStorageData.has(key) ? localStorageData.get(key) : null; },
  setItem(key, value) { localStorageData.set(key, String(value)); },
  removeItem(key) { localStorageData.delete(key); },
  clear() { localStorageData.clear(); }
};

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

// defineProperty rather than Object.assign: modern Node already defines some of
// these (navigator, URL, fetch) as getter-only accessors on globalThis, which a
// plain assignment throws on.
const globals = {
  document: documentStub,
  localStorage: localStorageStub,
  navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  // renderTabs defers overflow measurement to a frame; run it inline so the
  // DOM-dependent tail is exercised rather than silently dropped.
  requestAnimationFrame: fn => { fn(); return 0; },
  cancelAnimationFrame: () => {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  fetch: async () => { throw new Error('fetch not available in tests'); },
  Blob: function Blob(parts) { this.parts = parts; },
  ResizeObserver: ObserverStub,
  IntersectionObserver: ObserverStub,
  MutationObserver: ObserverStub,
  getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block' }),
  alert: () => {},
  confirm: () => true,
  indexedDB: undefined,
  // Supplied by the KaTeX CDN bundle in the browser. Without it triggerMath()
  // polls for the real one, and every Reference page render would sit through the
  // full retry budget before giving up.
  renderMathInElement: () => {},
  // loadSharedLinkFromURL reads location.hash at boot and clears it through
  // history.replaceState.
  location: { hash: '', pathname: '/', search: '', href: 'http://localhost/', origin: 'http://localhost' },
  history: { replaceState() {}, pushState() {}, back() {}, forward() {} }
};

for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: true });
}

// URL is a real class in Node and some app code may still want it; only the two
// object-URL helpers need stubbing.
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};

// The app reads both `window.x` and bare `x` for browser globals, so window has
// to be the global object itself rather than a separate stub.
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

export { documentStub as document, localStorageStub as localStorage, localStorageData };
