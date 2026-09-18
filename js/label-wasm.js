// The compiled label-stage kernel, instantiated once at module scope.
//
// **Synchronously**, which is the whole reason this module looks the way it
// does. `buildLayoutContext` runs inside a frame — `updateFastDOM` calls it
// sixty times a second during a drag — so it cannot await anything, and the
// usual `WebAssembly.instantiateStreaming` off a URL is therefore unavailable
// to it. A module already in the bundle is not: the bytes arrive as base64 in
// js/wasm/, and `new WebAssembly.Module(bytes)` compiles them here and now.
//
// That path has a limit: Chrome refuses synchronous compilation of more than
// 4KB on the main thread. The kernel is 3,440 bytes and scripts/build-wasm.mjs
// warns when a change crosses the line — but the limit is a browser's to
// change, not ours, so **the failure is handled rather than prevented**. Every
// way this can go wrong (the size limit, a CSP that forbids `wasm-eval`, an
// engine with no WebAssembly at all, a corrupt artifact) ends in `null`, and
// js/geometry.js keeps the JS implementation of every function in here for
// exactly that case.
//
// Which is also why tests/label-penalty-wasm.test.js pins the two against each
// other on the same fixtures: the fallback is not a degraded mode, it is the
// same answer computed the other way, and a reader whose browser takes the
// JS path must get the identical diagram.
import { LABEL_PENALTY_WASM } from './wasm/label-penalty-bytes.js';

function decodeBase64(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node, where the test suite runs.
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
  return null;
}

function instantiate() {
  if (typeof WebAssembly === 'undefined') return null;
  try {
    const bytes = decodeBase64(LABEL_PENALTY_WASM);
    if (!bytes) return null;
    const mod = new WebAssembly.Module(bytes);
    // `--runtime stub` still emits an `abort` import for the bounds checks that
    // survive --noAssert. Nothing here should reach it; if anything does, it
    // must throw rather than return a wrong number quietly.
    const inst = new WebAssembly.Instance(mod, {
      env: { abort() { throw new Error('label-penalty.wasm aborted'); } }
    });
    const e = inst.exports;
    if (typeof e.labelPenalty !== 'function' || typeof e.resetGrids !== 'function') return null;
    return e;
  } catch {
    return null;
  }
}

/** The kernel's exports, or `null` where it could not be compiled. */
export const labelWasm = instantiate();
