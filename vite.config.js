import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

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
      format: { comments: false }
    },
    // The app is one entry; a single chunk avoids a waterfall on first paint and
    // keeps the Electron package to one script file. Vite 8 bundles with Rolldown
    // rather than Rollup, where this is a top-level build flag —
    // rollupOptions.output.inlineDynamicImports still works but warns.
    codeSplitting: false,
    rollupOptions: {
      output: {
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
