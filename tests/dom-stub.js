// The DOM stand-in lives in js/headless/dom-stub.js, because the CLI ships it
// and shipped code does not import from tests/. This re-export keeps every
// test's `import './dom-stub.js'` meaning what it always meant: the stub is
// installed as a side effect of evaluating the module, and `export *`
// evaluates it.
export * from '../js/headless/dom-stub.js';
