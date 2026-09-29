// The entry of the bundled CLI (npm run cli:build → dist-cli/automata.mjs).
//
// Solid's browser build was chosen when the bundle was made, so there is no
// --conditions flag to add and nothing to re-execute.
//
// The two static imports are what keep the bundle's evaluation order right.
// In the source, env.mjs imports the DOM stand-in first and ES modules do the
// rest; in a bundle, modules are regrouped into chunks, and a chunk holding
// app modules can be evaluated before the chunk holding the stub. Importing
// the stub statically from the entry puts it in the entry chunk, which runs
// before anything the entry imports dynamically — i.e. before the whole app.
import './node-globals.mjs';
import '../js/headless/dom-stub.js';

process.env.AUTOMATA_CLI_BUNDLED = '1';
await import('./automata.mjs');
