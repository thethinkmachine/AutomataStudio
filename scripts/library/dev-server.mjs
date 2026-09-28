#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY, ON THIS MACHINE
// ══════════════════════════════════════════════════════════════════
// A local stand-in for everything the published library does, so the whole
// library can be tried without a GitHub repository, Pages or a network:
//
//   · a library checkout (seeded on first run) under .library-dev/
//   · built with the same build.mjs CI runs, served with CORS open, exactly
//     the files Pages would serve
//   · rebuilt whenever a file in it changes — edit a machine, press Refresh
//     in the app
//   · GitHub's issue form, emulated: the app's "Submit on GitHub" opens a local
//     page shaped like the real form, and submitting it runs the same
//     issue-to-entry.mjs the Submission workflow runs. The only step skipped is
//     the maintainer's review — the entry is merged at once, and the page says so.
//
//   npm run library:dev                      then open the link it prints
//   npm run library:dev -- --port 9000 --library ../automata-library --app http://localhost:5173/
//
// The link sets the app's library source to this server (a #library-source=
// link, accepted for localhost only). How it works ▸ Source ▸ Reset in the
// Library puts it back on the published library.

import './env.mjs';
import { existsSync, watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLibrary, writeLibrary } from './build.mjs';
import { seedLibrary } from './seed.mjs';
import { FORM_FIELDS, processIssue } from './issue-to-entry.mjs';
import { esc } from './site.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = resolve(HERE, '../..');

// The issue form's fields are issue-to-entry.mjs's; re-exported for the test
// that holds them to the YAML form.
export { FORM_FIELDS };

/** The form's answers as GitHub renders an issue-form issue: `### Label` sections. */
export function issueBody(values) {
  return FORM_FIELDS.map(f => {
    let v = values[f.id];
    if (f.kind === 'checkbox') v = `- [${v ? 'X' : ' '}] ${f.text}`;
    else if (!v || !String(v).trim()) v = '_No response_';
    else if (f.render) v = '```' + f.render + '\n' + String(v).trim() + '\n```';
    return `### ${f.label}\n\n${v}`;
  }).join('\n\n');
}

// ── Options ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { library: join(APP_ROOT, '.library-dev'), port: 8765, app: 'http://localhost:5173/', author: 'octocat' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--library') { a.library = resolve(v); i++; }
    else if (k === '--port') { a.port = Number(v); i++; }
    else if (k === '--app') { a.app = v.replace(/\/?$/, '/'); i++; }
    else if (k === '--author') { a.author = v; i++; }
    else throw new Error(`Unknown flag ${k}`);
  }
  return a;
}

// ── The library, built and rebuilt ────────────────────────────────

export function createLibraryServer(opts) {
  const root = resolve(opts.library);
  const out = join(root, '_site');
  const base = `http://127.0.0.1:${opts.port}/`;
  const state = { built: null, building: null, again: false, submissions: [], next: 1, lastBuild: null, lastError: null };
  const cache = new Map();

  async function rebuild(reason = '') {
    if (state.building) { state.again = true; return state.building; }
    state.building = (async () => {
      do {
        state.again = false;
        const t0 = Date.now();
        try {
          const b = await buildLibrary({ library: root, commit: '', site: base, submit: `${base}_emulator/issues/new`, emulator: true, cache });
          await writeLibrary({ library: root, out }, b);
          state.built = b;
          state.lastBuild = new Date();
          state.lastError = null;
          const failed = b.results.filter(r => r.errors.length);
          console.log(`[library] built${reason ? ` (${reason})` : ''}: ${b.raw.entries.length} entries, ${failed.length} failing — ${Date.now() - t0} ms`);
          for (const r of failed) console.log(`          ✗ ${r.file}: ${r.errors[0]}`);
        } catch (e) {
          state.lastError = e;
          console.error('[library] build failed:', e.message);
        }
      } while (state.again);
    })().finally(() => { state.building = null; });
    return state.building;
  }

  // ── pages of the emulator itself ──

  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/assets/site.css">
<style>.emu{border:1px dashed var(--accent);border-radius:10px;padding:10px 14px;background:var(--accent-soft);margin:0 0 18px}
form label{display:block;margin:14px 0 4px;font-weight:600}form .hint{font-weight:400;color:var(--text2);font-size:.85rem}
form input[type=text],form textarea{width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit}
form textarea{min-height:90px;font-family:'JetBrains Mono',monospace;font-size:.82rem}.report{white-space:pre-wrap;padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.ok{color:var(--green)}.bad{color:var(--red)}</style></head>
<body><header class="top"><a class="brand" href="/"><span class="brand-mark"></span>AutomataStudio <span class="brand-sub">Library · local emulator</span></a>
<nav class="top-nav"><a href="/">Website</a><a href="/_emulator/">Emulator</a><a class="top-app" href="${esc(appLink())}">Open the app on this library</a></nav></header>
<main class="wrap">${body}</main></body></html>`;

  const appLink = (hash = '') => `${opts.app}#library-source=${encodeURIComponent(base)}${hash}`;

  function dashboard() {
    const b = state.built;
    const failed = b ? b.results.filter(r => r.errors.length) : [];
    const subs = state.submissions.slice().reverse().map(s =>
      `<li><a href="/_emulator/issues/${s.number}">#${s.number} ${esc(s.title || '(untitled)')}</a> by @${esc(s.author)} — <span class="${s.ok ? 'ok' : 'bad'}">${s.ok ? `merged as ${esc(s.id)}` : 'needs changes'}</span></li>`).join('');
    return page('Library emulator', `
<p class="emu">This is a local stand-in for the published library: the same build CI runs, served from <code>${esc(root)}</code>, with GitHub's submission form emulated. Nothing leaves this machine.</p>
<h1>Library emulator</h1>
<p><a class="btn primary" href="${esc(appLink())}">Open AutomataStudio on this library</a> <a class="btn" href="/">The library's website</a> <a class="btn" href="/_emulator/issues/new">Submit by hand</a></p>
<h2>Library</h2>
<p>${b ? `${b.raw.entries.length} entries · ${b.raw.collections.length} collections · built ${state.lastBuild.toLocaleTimeString()}` : 'Building…'}${state.lastError ? ` · <span class="bad">last build failed: ${esc(state.lastError.message)}</span>` : ''}</p>
${failed.length ? `<p class="bad">${failed.length} file(s) fail their checks and are left out:</p><ul>${failed.map(r => `<li><code>${esc(r.file)}</code> — ${esc(r.errors[0])}</li>`).join('')}</ul>` : ''}
<p class="muted">Edit or add files under <code>${esc(join(root, 'machines'))}</code> and the library rebuilds; press Refresh in the app's Library to see it.</p>
<h2>Submissions</h2>${subs ? `<ul>${subs}</ul>` : '<p class="muted">None yet. In the app: Library ▸ Submit a machine ▸ Submit on GitHub.</p>'}`);
  }

  function issueForm(query) {
    const v = id => query.get(id) ?? FORM_FIELDS.find(f => f.id === id)?.value ?? '';
    const fields = FORM_FIELDS.map(f => {
      const req = f.required ? ' required' : '';
      if (f.kind === 'checkbox') return `<label><input type="checkbox" name="${f.id}"${req}> ${esc(f.text)}</label>`;
      const control = f.kind === 'textarea'
        ? `<textarea name="${f.id}"${req}>${esc(v(f.id))}</textarea>`
        : `<input type="text" name="${f.id}" value="${esc(v(f.id))}"${req}>`;
      return `<label>${esc(f.label)}${f.required ? ' *' : ''}${f.hint ? ` <span class="hint">— ${esc(f.hint)}</span>` : ''}</label>${control}`;
    }).join('\n');
    return page('Submit a machine · emulator', `
<p class="emu">Emulating GitHub's <em>Submit a machine</em> issue form. On GitHub you would be signed in and the entry credited to your account; here you say which account to pretend to be.</p>
<h1>${esc(query.get('title') || 'Submit a machine')}</h1>
<form method="post" action="/_emulator/issues">
<input type="hidden" name="title" value="${esc(query.get('title') || '')}">
<label>Signed in as <span class="hint">— the emulated GitHub account the entry will be credited to</span></label>
<input type="text" name="account" value="${esc(opts.author)}" required pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})">
${fields}
<p><button class="btn primary" type="submit">Submit new issue</button></p>
</form>`);
  }

  async function submit(form) {
    const number = state.next++;
    const values = Object.fromEntries(FORM_FIELDS.map(f => [f.id, f.kind === 'checkbox' ? form.has(f.id) : (form.get(f.id) || '')]));
    const title = form.get('title') || `[Machine] ${values.name}`;
    const author = String(form.get('account') || opts.author).trim();
    const r = await processIssue({ body: issueBody(values), author, number, root, title });
    const record = { number, title, author, ok: r.ok, id: r.id, report: r.report || r.problems.map(p => `- ${p}`).join('\n') };
    state.submissions.push(record);
    if (r.ok) await rebuild(`submission #${number}`);
    return record;
  }

  function issuePage(s) {
    const merged = s.ok
      ? `<p class="emu"><strong>Merged.</strong> On GitHub the Submission workflow would open a pull request here and a maintainer would merge it; the emulator merges at once and has rebuilt the library.</p>
<p><a class="btn primary" href="${esc(appLink(''))}">Open the app on this library</a> <a class="btn" href="${esc(opts.app)}#library=${encodeURIComponent(s.id)}">See it in the app</a> <a class="btn" href="/m/${s.id.split('/').map(encodeURIComponent).join('/')}/">See its web page</a></p>`
      : '<p class="emu">On GitHub, editing the issue runs the check again. Here: go back, fix it and submit again.</p>';
    return page(`#${s.number} ${s.title}`, `<h1>#${s.number} ${esc(s.title)}</h1><p class="muted">Opened by @${esc(s.author)}</p>${merged}
<h2>github-actions commented</h2><div class="report">${esc(s.report)}</div>`);
  }

  // ── the server ──

  const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.automaton': 'application/json', '.py': 'text/plain; charset=utf-8', '.java': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.png': 'image/png' };
  const send = (res, status, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(body);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      const path = decodeURIComponent(url.pathname);
      if (path === '/_emulator' || path === '/_emulator/') return send(res, 200, dashboard());
      if (path === '/_emulator/issues/new') return send(res, 200, issueForm(url.searchParams));
      if (path === '/_emulator/issues' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 4e6) return send(res, 413, 'Too large'); }
        const s = await submit(new URLSearchParams(raw));
        res.writeHead(303, { location: `/_emulator/issues/${s.number}` });
        return res.end();
      }
      const m = /^\/_emulator\/issues\/(\d+)$/.exec(path);
      if (m) {
        const s = state.submissions.find(x => x.number === Number(m[1]));
        return s ? send(res, 200, issuePage(s)) : send(res, 404, page('Not found', '<h1>No such issue</h1>'));
      }
      if (state.building && !state.built) await state.building;
      // Everything else is the built site, as Pages would serve it.
      let file = resolve(out, '.' + path);
      if (!file.startsWith(out + sep) && file !== out) return send(res, 403, 'Forbidden');
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { /* 404 below */ }
      const body = await readFile(file).catch(() => null);
      if (!body) return send(res, 404, await readFile(join(out, '404.html')).catch(() => 'Not found'));
      return send(res, 200, body, TYPES[extname(file)] || 'application/octet-stream');
    } catch (e) {
      console.error(e);
      send(res, 500, esc(e.message));
    }
  });

  let watcher = null, timer = null;
  function startWatching() {
    try {
      watcher = watch(root, { recursive: true }, (_event, file) => {
        const f = String(file || '').split(sep).join('/');
        if (!/^(machines|collections)\/|^library\.config\.json$/.test(f)) return;
        clearTimeout(timer);
        timer = setTimeout(() => rebuild(`${f} changed`), 300);
      });
    } catch (e) {
      console.warn(`[library] not watching for changes: ${e.message}`);
    }
  }

  return {
    state, rebuild, server, appLink, base, root,
    async start() {
      if (!existsSync(join(root, 'machines'))) {
        console.log(`[library] seeding a library in ${root}`);
        await seedLibrary(root, { author: 'thethinkmachine' });
      }
      // The port first: a second copy started while one is running must fail
      // here, before it has a file watcher — a watcher keeps the process alive
      // with no server, rebuilding the library with whatever code it loaded.
      // Loopback only: the emulator writes files for whoever posts its form,
      // and nobody else on the network should be able to.
      await new Promise((ok, fail) => { server.once('error', fail); server.listen(opts.port, '127.0.0.1', ok); });
      await rebuild('start');
      startWatching();
      return this;
    },
    async stop() {
      watcher?.close();
      clearTimeout(timer);
      await new Promise(ok => server.close(ok));
    }
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lib = createLibraryServer(opts);
  await lib.start();
  console.log(`
  Library emulator running.

    Open the app on it:   ${lib.appLink()}
    The library website:  ${lib.base}
    Emulator dashboard:   ${lib.base}_emulator/
    Library files:        ${lib.root}

  Edits under machines/ and collections/ rebuild it; press
  Refresh in the app's Library. Ctrl+C to stop.
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
