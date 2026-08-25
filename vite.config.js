import { defineConfig } from 'vite';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// package.json is the single source of truth for the version — it is what
// electron-builder stamps on the installers and what the updater compares
// against, so the About dialog must not carry a second hand-edited copy.
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

// Prepended to the bundle. The PolyForm Noncommercial License requires that every
// "Required Notice:" line travels with any part of the software that is passed on,
// and the deployed bundle is the copy most people will ever hold. It is a `/*!`
// legal comment, and terser is configured below to keep those — the default
// `comments: false` would strip this along with everything else.
const LICENSE_BANNER = `/*!
 * AutomataStudio -- https://github.com/thethinkmachine/AutomataStudio
 * Required Notice: Copyright (c) 2026 Shreyan Chaubey (https://github.com/thethinkmachine)
 * Licensed under the PolyForm Noncommercial License 1.0.0, with a supplemental
 * grant converting this release to AGPL-3.0-or-later on 2030-08-15. See LICENSE.
 * "AutomataStudio" is a trademark of Shreyan Chaubey and is not licensed for use
 * as the branding of derivative works.
 */`;

// Example machines are fetched at runtime as `js/examples/<name>.json` (see
// loadExampleFile in js/persistence.js), so they must keep that exact path.
// During dev Vite serves them straight from the project root; for the build they
// are copied verbatim rather than hashed, because the URL is constructed at
// runtime from the machine name and cannot be rewritten by the bundler.
function copyExamples() {
  return {
    name: 'copy-examples',
    apply: 'build',
    closeBundle() {
      const from = resolve(ROOT, 'js/examples');
      const to = resolve(ROOT, 'dist/js/examples');
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true });
    }
  };
}

export default defineConfig({
  // Relative asset URLs. The site is served from a GitHub Pages project subpath
  // (/<repo>/) and the desktop build serves dist/ over the custom app:// scheme,
  // so neither can assume the document sits at the domain root.
  base: './',
  plugins: [copyExamples()],
  // Read back in js/workspace.js, which guards on `typeof` so the Node test
  // run — which imports the modules directly, with no Vite in the way — does
  // not trip over an undefined global.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // js/parallel/decide.worker.js is loaded with `{ type: 'module' }`, so the
  // built worker has to be a module too. Vite's default worker format is
  // 'iife', which happens to parse as a module while it stays self-contained —
  // that is a coincidence, not a guarantee, and it stops being true the moment
  // the worker bundle needs a shared chunk. Declaring it keeps the two ends of
  // the contract stated in one place.
  worker: {
    format: 'es'
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Terser rather than the esbuild default: it compresses noticeably harder on
    // this codebase, and unlike the old hand-rolled pipeline it can now mangle
    // top-level names freely. Nothing depends on a module-scope identifier
    // surviving — the only names the HTML reaches are the object keys in
    // js/bridge.js, and minifiers never rename property keys.
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      // Strip every comment except `/*!` legal ones, so LICENSE_BANNER survives
      // minification. Nothing else in the source uses that marker.
      format: { comments: /^!/ }
    },
    // The app is one entry; a single chunk avoids a waterfall on first paint and
    // keeps the Electron package to one script file. Vite 8 bundles with Rolldown
    // rather than Rollup, where this is a top-level build flag —
    // rollupOptions.output.inlineDynamicImports still works but warns.
    codeSplitting: false,
    rollupOptions: {
      output: {
        banner: LICENSE_BANNER,
        entryFileNames: 'assets/app.[hash].js',
        assetFileNames: 'assets/app.[hash][extname]'
      }
    },
    // Rollup warns about the circular imports that remain between UI modules
    // (canvas <-> render <-> ui and friends). They are safe — every one is a
    // function-declaration reference resolved at call time, not at module
    // evaluation — and untangling them is a later step, so keep the build quiet
    // about them rather than training everyone to ignore real warnings.
    chunkSizeWarningLimit: 2000
  },
  server: {
    port: 5173
  }
});
