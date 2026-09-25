// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ── StateMate over the Claude Code CLI ────────────────────────────
// `claude -p` as a provider: the reader's own Claude Code login answers, with
// no API key in this app at all. The renderer does not learn that a process is
// involved — this module turns the CLI's stream-json into the same OpenAI-style
// SSE frames an HTTP provider sends, so js/statemate-provider.js reads it with
// the reader it already has.
//
// What the renderer may choose is deliberately small: the prompt text and a
// model alias. It never names the executable, a flag or a path. Those are
// decided here, so a renderer that has been talked into something cannot turn
// this channel into "run a program of my choosing".
//
// The CLI is an agent, and here it must not act like one: no built-in tools,
// no MCP servers, no slash commands, no saved session, and an empty scratch
// directory for a working directory. It answers a prompt and exits.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** The pseudo-URL the renderer addresses; see statemateTarget in main.cjs. */
const CLAUDE_CODE_URL = 'claude-code:';

// An alias (`sonnet`) or a full id (`claude-sonnet-5`, `claude-opus-5-5[1m]`).
// Anything else is refused rather than quoted: it reaches a command line.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,79}$/;

/**
 * Where `claude` lives. PATH first, then the installers' own locations — an app
 * launched from the dock or the Start menu does not inherit a login shell's
 * PATH, so `~/.local/bin` is routinely missing from it on macOS and Linux.
 */
function findClaude(env = process.env, platform = process.platform) {
  const home = os.homedir();
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (platform === 'win32') {
    dirs.push(path.join(home, '.local', 'bin'));
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  } else {
    dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'),
      '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (e) { /* not here */ }
    }
  }
  return null;
}

/**
 * The conversation as one prompt. `claude -p` takes a single user turn, so
 * earlier turns are replayed as a transcript above the live one. The live turn
 * goes last and unwrapped, because it is the thing being answered.
 */
function flattenMessages(messages) {
  const turns = (Array.isArray(messages) ? messages : []).map(m => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    text: contentText(m && m.content)
  }));
  if (!turns.length) return '';
  const last = turns[turns.length - 1];
  if (turns.length === 1) return last.text;
  const history = turns.slice(0, -1)
    .map(t => `<${t.role}>\n${t.text}\n</${t.role}>`)
    .join('\n\n');
  return `<conversation_so_far>\n${history}\n</conversation_so_far>\n\n${last.text}`;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => (part && part.type === 'text' ? String(part.text || '') : ''))
    .filter(Boolean)
    .join('\n');
}

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * One line of `--output-format stream-json`, translated.
 *
 * Returns `{ chunk, done, error }`: `chunk` is SSE text for the renderer (or a
 * comment line, which its reader skips but which still resets its idle clock —
 * a model thinking for forty seconds is streaming, just not text), `done` marks
 * the result line, and `error` is the CLI's own account of a failure.
 */
function translateLine(line, state) {
  let event;
  try { event = JSON.parse(line); } catch (e) { return { chunk: ': \n' }; }
  if (!event || typeof event !== 'object') return { chunk: ': \n' };

  if (event.type === 'stream_event') {
    const inner = event.event || {};
    if (inner.type === 'message_start' && inner.message && inner.message.model) {
      state.model = inner.message.model;
    }
    if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta') {
      const text = String(inner.delta.text || '');
      if (text) {
        state.streamed = true;
        return { chunk: sse({ model: state.model, choices: [{ index: 0, delta: { content: text } }] }) };
      }
    }
    return { chunk: ': \n' };
  }

  // Without partial messages (or from a CLI that does not send them) the text
  // arrives whole on the assistant message. Used only when nothing streamed,
  // or it would be counted twice.
  if (event.type === 'assistant' && !state.streamed) {
    const text = contentText(event.message && event.message.content);
    if (event.message && event.message.model) state.model = event.message.model;
    if (text) return { chunk: sse({ model: state.model, choices: [{ index: 0, delta: { content: text } }] }) };
    return { chunk: ': \n' };
  }

  if (event.type === 'result') {
    if (event.is_error) {
      return { done: true, error: String(event.result || event.error || 'Claude Code reported an error.') };
    }
    const u = event.usage || {};
    const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const finish = event.stop_reason === 'max_tokens' ? 'length' : 'stop';
    return {
      done: true,
      chunk: sse({
        model: state.model,
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
        usage: { prompt_tokens: input, completion_tokens: u.output_tokens || 0 }
      }) + 'data: [DONE]\n\n'
    };
  }

  return { chunk: ': \n' };
}

/** Quote one argument for cmd.exe. Only ever handed our own flags and paths. */
function winQuote(arg) {
  if (arg === '') return '""';
  if (/^[\w.:\\/=@-]+$/.test(arg)) return arg;
  if (/["%^&|<>!]/.test(arg)) throw new Error(`Refusing to pass ${JSON.stringify(arg)} through cmd.exe.`);
  return `"${arg}"`;
}

/**
 * Run one completion. `send(channel, message)` is the stream's own sender from
 * main.cjs; the returned `abort()` kills the process.
 */
function runClaudeCode(body, send, { findExe = findClaude, spawnFn = spawn } = {}) {
  const end = info => send('statemate:end', info);
  const fail = (text, extra = {}) => end({ ok: false, status: 0, cliError: true, body: text, ...extra });

  // The renderer's stream transport serialises the body, as it does for every
  // HTTP provider. Read as "not an object", a string became `{}` here and the
  // CLI was handed an empty stdin.
  let request = body;
  if (typeof body === 'string') {
    try { request = JSON.parse(body); } catch (e) { request = null; }
  }
  if (!request || typeof request !== 'object') {
    fail('The request to Claude Code was malformed.');
    return { abort() { } };
  }
  const prompt = flattenMessages(request.messages);
  if (!prompt.trim()) {
    fail('There was no prompt to send to Claude Code.');
    return { abort() { } };
  }

  const model = String(request.model || '').trim();
  if (model && !MODEL_RE.test(model)) {
    fail(`"${model}" is not a model name Claude Code accepts.`);
    return { abort() { } };
  }

  const exe = findExe();
  if (!exe) {
    fail('Claude Code is not installed, or the app cannot find it. Install it from https://claude.com/claude-code and sign in with `claude` once in a terminal.');
    return { abort() { } };
  }

  // The system prompt goes through a file, not an argument: at ~10k characters
  // it is past what cmd.exe will pass (8191), and a file needs no quoting.
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statemate-cc-'));
    fs.writeFileSync(path.join(dir, 'system.txt'), String(request.system || ''), 'utf8');
  } catch (err) {
    fail(`Could not prepare a scratch directory: ${err.message}`);
    return { abort() { } };
  }
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } };

  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--system-prompt-file', path.join(dir, 'system.txt'),
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    ...(model ? ['--model', model] : [])
  ];

  // A .cmd shim (an npm install on Windows) cannot be spawned without a shell.
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
  let child;
  try {
    child = viaShell
      ? spawnFn(winQuote(exe), args.map(winQuote), { cwd: dir, shell: true, windowsHide: true })
      : spawnFn(exe, args, { cwd: dir, windowsHide: true });
  } catch (err) {
    cleanup();
    fail(`Could not start Claude Code: ${err.message}`);
    return { abort() { } };
  }

  const state = { model: model || 'claude-code', streamed: false };
  let buffer = '';
  let stderr = '';
  let finished = false;
  let aborted = false;
  let failure = null;

  const finish = info => {
    if (finished) return;
    finished = true;
    cleanup();
    end(info);
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    let cut;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      const out = translateLine(line, state);
      if (out.error) failure = out.error;
      else if (out.chunk) send('statemate:chunk', { chunk: out.chunk });
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });

  child.on('error', err => {
    finish({ ok: false, status: 0, cliError: true, body: `Could not start Claude Code: ${err.message}` });
  });
  child.on('close', code => {
    if (aborted) return finish({ ok: false, status: 0, aborted: true, body: 'Cancelled.' });
    if (failure) return finish({ ok: false, status: 0, cliError: true, body: failure });
    if (code !== 0) {
      const why = stderr.trim().split('\n').slice(-3).join(' ').trim();
      return finish({ ok: false, status: 0, cliError: true, body: why || `Claude Code exited with code ${code}.` });
    }
    finish({ ok: true, status: 200 });
  });

  child.stdin.on('error', () => { /* the process died first; `close` reports it */ });
  child.stdin.end(prompt, 'utf8');

  return {
    abort() {
      if (finished) return;
      aborted = true;
      // Through a shell the child is cmd.exe; killing it would orphan claude.
      if (viaShell && child.pid) spawnFn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill();
    }
  };
}

module.exports = { CLAUDE_CODE_URL, findClaude, flattenMessages, translateLine, runClaudeCode, winQuote };
