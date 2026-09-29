#!/usr/bin/env node
// The `automata` executable.
//
// Solid resolves to its server build under Node's default conditions, and the
// app's js/reactive.js refuses to run on that stub. The browser build is a
// Node *flag* (--conditions=browser), which a shebang cannot pass portably —
// `env -S` is not on Windows, and npm's Windows launcher ignores shebang
// arguments anyway. So when the flag is missing, this re-runs itself once with
// it, forwarding stdio, signals and the exit code. The bundled build
// (npm run cli:build) has the choice made at build time and never re-runs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONDITIONS = ['--conditions=browser', '--conditions=development'];

function hasConditions() {
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS || '').split(/\s+/)];
  return flags.some(f => f === '--conditions=browser' || f === '-C=browser')
    || flags.some((f, i) => (f === '--conditions' || f === '-C') && flags[i + 1] === 'browser');
}

if (hasConditions() || process.env.AUTOMATA_CLI_BUNDLED) {
  const { main } = await import('./main.mjs');
  const code = await main(process.argv.slice(2));
  // Long-lived commands (mcp, test --watch) resolve only when they are done.
  process.exitCode = code;
  // Let the event loop drain on its own: forcing process.exit() while fetch's
  // sockets are still closing aborts Node on Windows (a libuv assertion). The
  // unref'd timer is the backstop for anything an app module leaves running —
  // it cannot keep the process alive itself, and fires only if something else does.
  if (!process.env.AUTOMATA_KEEP_ALIVE) setTimeout(() => process.exit(code), 300).unref();
} else {
  const child = spawn(process.execPath, [...process.execArgv, ...CONDITIONS, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit'
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { try { child.kill(sig); } catch { /* already gone */ } });
  }
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 3);
  });
}
