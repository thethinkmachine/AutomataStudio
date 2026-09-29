// The command line as one self-contained file: npm run cli:build → dist-cli/.
//
// Two things make it more than a copy of cli/. Solid resolves to its server
// build under Node's default conditions, and the app refuses that stub; the
// source CLI re-runs itself with --conditions=browser, while the bundle has
// the browser build resolved in at build time, so `node dist-cli/automata.mjs`
// needs no flag and no checkout of the repository. And every dependency is
// bundled (noExternal), so installing the package needs nothing at runtime.
//
// The halting classifier's worker is a second entry, emitted beside the main
// file as worker.mjs, which is where cli/tm/pool.mjs looks for it.
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

// The same Required Notice the app bundle carries (vite.config.js): the
// license asks for it on any part of the software that is passed on.
const BANNER = `#!/usr/bin/env node
/*!
 * AutomataStudio command line -- https://github.com/thethinkmachine/AutomataStudio
 * Required Notice: Copyright (c) 2026 Shreyan Chaubey (https://github.com/thethinkmachine)
 * Licensed under the PolyForm Noncommercial License 1.0.0, with a supplemental
 * grant converting this release to AGPL-3.0-or-later on 2030-08-15. See LICENSE.
 * "AutomataStudio" is a trademark of Shreyan Chaubey and is not licensed for use
 * as the branding of derivative works.
 */`;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { conditions: ['browser'] },
  ssr: {
    noExternal: true,
    target: 'node',
    resolve: { conditions: ['browser'], externalConditions: ['browser'] }
  },
  build: {
    ssr: true,
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      input: { automata: resolve(ROOT, 'cli/bundle.mjs'), worker: resolve(ROOT, 'cli/tm/worker.mjs') },
      output: {
        format: 'es',
        entryFileNames: '[name].mjs',
        chunkFileNames: '[name]-[hash].mjs',
        banner: chunk => (chunk.name === 'automata' ? BANNER : BANNER.replace(/^#!.*\n/, ''))
      }
    }
  }
});
