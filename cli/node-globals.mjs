// Node's own globals, saved before js/headless/dom-stub.js replaces them with
// test fakes. It has to be a module of its own and imported first: imports
// evaluate before the importing module's body, so env.mjs could not save them
// itself in time.
export const nodeGlobals = { fetch: globalThis.fetch, Blob: globalThis.Blob };
