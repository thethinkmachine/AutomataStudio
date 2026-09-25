import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { createHarness } from './harness.js';

// StateMate over the Claude Code CLI. Two halves meet at one IPC channel: the
// main-process module that runs `claude -p` and speaks SSE, and the renderer's
// provider, which must not be able to tell that from an HTTP stream. Each half
// is driven here without the other — the CLI through a fake spawn, the
// renderer through a fake `electronAPI.statemateStream`.

const require = createRequire(import.meta.url);
const cc = require('../electron/claude-code.cjs');

const streamEvent = event => JSON.stringify({ type: 'stream_event', event });
const textDelta = text => streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } });
const resultLine = (extra = {}) => JSON.stringify({
  type: 'result', is_error: false, stop_reason: 'end_turn',
  usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 0, output_tokens: 7 },
  ...extra
});

/** The SSE text a chunk carries, read back the way the renderer reads it. */
function contentOf(chunks) {
  let text = '';
  for (const chunk of chunks) {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      text += JSON.parse(payload).choices?.[0]?.delta?.content || '';
    }
  }
  return text;
}

// ── the translation ───────────────────────────────────────────────

test('text deltas become OpenAI SSE frames; thinking only keeps the clock alive', () => {
  const state = { model: 'x', streamed: false };
  cc.translateLine(streamEvent({ type: 'message_start', message: { model: 'claude-sonnet-5' } }), state);
  assert.equal(state.model, 'claude-sonnet-5');

  const thinking = cc.translateLine(streamEvent({
    type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' }
  }), state);
  assert.match(thinking.chunk, /^:/, 'a comment the reader skips — but it still arrives, which resets the idle clock');
  assert.equal(contentOf([thinking.chunk]), '', 'thinking never reaches the answer');

  const a = cc.translateLine(textDelta('{"kind":'), state);
  const b = cc.translateLine(textDelta('"reply"}'), state);
  assert.equal(contentOf([a.chunk, b.chunk]), '{"kind":"reply"}');
});

test('the result line carries usage and the stop reason, cache reads counted as input', () => {
  const out = cc.translateLine(resultLine(), { model: 'm', streamed: true });
  assert.equal(out.done, true);
  const frame = JSON.parse(out.chunk.split('\n')[0].slice(5));
  assert.deepEqual(frame.usage, { prompt_tokens: 15, completion_tokens: 7 });
  assert.equal(frame.choices[0].finish_reason, 'stop');
  assert.match(out.chunk, /data: \[DONE\]/);

  const cut = cc.translateLine(resultLine({ stop_reason: 'max_tokens' }), { model: 'm' });
  assert.equal(JSON.parse(cut.chunk.split('\n')[0].slice(5)).choices[0].finish_reason, 'length',
    'a truncated answer is reported as one, so StateMate raises the cap instead of reformatting');
});

test('an error result is the CLI\'s own sentence', () => {
  const out = cc.translateLine(JSON.stringify({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login' }), {});
  assert.equal(out.error, 'Invalid API key · Please run /login');
});

test('a whole assistant message is used only when nothing streamed', () => {
  const message = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } });
  assert.equal(contentOf([cc.translateLine(message, { streamed: false }).chunk]), 'hello');
  assert.equal(contentOf([cc.translateLine(message, { streamed: true }).chunk]), '',
    'after partial messages it would be the same text twice');
});

test('the thread becomes one prompt, the live turn last and unwrapped', () => {
  assert.equal(cc.flattenMessages([{ role: 'user', content: 'only' }]), 'only');
  const text = cc.flattenMessages([
    { role: 'user', content: 'build a DFA' },
    { role: 'assistant', content: '[built: parity]' },
    { role: 'user', content: [{ type: 'text', text: 'now add a trap' }, { type: 'image_url', image_url: {} }] }
  ]);
  assert.match(text, /<conversation_so_far>[\s\S]*<user>\nbuild a DFA\n<\/user>[\s\S]*<assistant>\n\[built: parity\]/);
  assert.ok(text.endsWith('</conversation_so_far>\n\nnow add a trap'));
});

test('cmd.exe quoting refuses anything a shell would interpret', () => {
  assert.equal(cc.winQuote(''), '""');
  assert.equal(cc.winQuote('--model'), '--model');
  assert.equal(cc.winQuote('C:\\Users\\a b\\x.txt'), '"C:\\Users\\a b\\x.txt"');
  for (const bad of ['a&b', 'a|b', '%PATH%', 'a"b', 'a^b', 'a>b', 'a!b']) {
    assert.throws(() => cc.winQuote(bad), /Refusing/, bad);
  }
});

// ── the process ───────────────────────────────────────────────────

function fakeSpawn(script) {
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = text => { calls[calls.length - 1].stdin = text; setImmediate(() => script(child)); };
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); };
    child.pid = 42;
    calls.push({ cmd, args, opts });
    return child;
  };
  return { spawnFn, calls };
}

function run(body, script, extra = {}) {
  const { spawnFn, calls } = fakeSpawn(script);
  const events = [];
  return new Promise(resolve => {
    // A refusal ends synchronously, before the handle has been returned.
    const handle = cc.runClaudeCode(body, (channel, message) => {
      events.push({ channel, ...message });
      if (channel === 'statemate:end') setImmediate(() => resolve({ events, calls }));
    }, { findExe: () => '/usr/bin/claude', spawnFn, ...extra });
    if (extra.onHandle) extra.onHandle(handle);
  });
}

test('the CLI runs with every tool off, and the prompt goes in on stdin, never on the command line', async () => {
  const { events, calls } = await run(
    { system: 'SYSTEM & "quoted"', messages: [{ role: 'user', content: 'REQUEST; rm -rf /' }], model: 'sonnet' },
    child => {
      child.stdout.emit('data', textDelta('ok') + '\n' + resultLine() + '\n');
      child.emit('close', 0);
    }
  );
  const { args, stdin, opts } = calls[0];
  const flag = name => args[args.indexOf(name) + 1];
  assert.equal(flag('--tools'), '', 'no built-in tools');
  assert.ok(args.includes('--strict-mcp-config'), 'no MCP servers from the reader\'s config');
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(args.includes('--disable-slash-commands'));
  assert.equal(flag('--model'), 'sonnet');
  assert.ok(!args.some(a => /REQUEST|SYSTEM/.test(a)), 'no text the model or the reader wrote is an argument');
  assert.equal(stdin, 'REQUEST; rm -rf /');
  assert.match(opts.cwd, /statemate-cc-/, 'an empty scratch directory, not the app\'s or the reader\'s');

  assert.equal(contentOf(events.filter(e => e.channel === 'statemate:chunk').map(e => e.chunk)), 'ok');
  assert.deepEqual(events.at(-1), { channel: 'statemate:end', ok: true, status: 200 });
});

test('the body arrives serialised, exactly as the renderer sends it', async () => {
  // The two halves were each tested with the shape they assumed — the renderer
  // sends a JSON string, the CLI half was handed an object — so a string read
  // as `{}` sent the CLI an empty stdin and nothing failed but the real app.
  const body = JSON.stringify({ system: 'SYS', messages: [{ role: 'user', content: 'make a TM' }], model: '', stream: true });
  const { events, calls } = await run(body, child => {
    child.stdout.emit('data', resultLine() + '\n');
    child.emit('close', 0);
  });
  assert.equal(calls[0].stdin, 'make a TM');
  assert.ok(!calls[0].args.includes('--model'), 'an empty model leaves the CLI its own default');
  assert.equal(events.at(-1).ok, true);

  const empty = await run(JSON.stringify({ messages: [] }), () => {});
  assert.equal(empty.calls.length, 0, 'an empty prompt is refused, not sent');
  assert.match(empty.events.at(-1).body, /no prompt/);
});

test('the scratch directory is gone once the run ends', async () => {
  const fs = await import('node:fs');
  const { calls } = await run({ system: 's', messages: [{ role: 'user', content: 'u' }] }, child => {
    child.stdout.emit('data', resultLine() + '\n');
    child.emit('close', 0);
  });
  assert.equal(fs.existsSync(calls[0].opts.cwd), false);
});

test('failures come back as the CLI\'s words, flagged so the renderer says them plainly', async () => {
  const errored = await run({ messages: [{ role: 'user', content: 'u' }] }, child => {
    child.stdout.emit('data', JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }) + '\n');
    child.emit('close', 1);
  });
  assert.deepEqual(errored.events.at(-1), { channel: 'statemate:end', ok: false, status: 0, cliError: true, body: 'Not logged in' });

  const crashed = await run({ messages: [{ role: 'user', content: 'u' }] }, child => {
    child.stderr.emit('data', 'something\nwent wrong\n');
    child.emit('close', 3);
  });
  assert.equal(crashed.events.at(-1).body, 'something went wrong');

  const missing = await run({ messages: [{ role: 'user', content: 'u' }] }, () => {}, { findExe: () => null });
  assert.match(missing.events.at(-1).body, /not installed/);
  assert.equal(missing.calls.length, 0);
});

test('a model name that is not one is refused before anything runs', async () => {
  const { events, calls } = await run({ messages: [{ role: 'user', content: 'u' }], model: 'sonnet; calc.exe' }, () => {});
  assert.equal(calls.length, 0);
  assert.equal(events.at(-1).cliError, true);
});

test('abort kills the process and reports a cancellation, not a failure', async () => {
  let handle;
  const { events } = await run({ messages: [{ role: 'user', content: 'u' }] }, () => { handle.abort(); }, { onHandle: h => { handle = h; } });
  assert.equal(events.at(-1).aborted, true);
  assert.equal(events.at(-1).ok, false);
});

// ── the renderer ──────────────────────────────────────────────────

const h = createHarness();
const { context } = h;

function installStream(respond) {
  const seen = [];
  context.window.electronAPI = {
    statemateRequest: async () => ({ ok: false, status: 0, body: 'unused' }),
    statemateStream: (payload, handlers) => {
      seen.push(payload);
      setImmediate(() => respond(handlers, payload));
      return { abort() {} };
    }
  };
  return seen;
}

test('Claude Code is ready only where the desktop shell can run it', () => {
  context.resetStateMateSettings();
  context.saveStateMateSettings({ enabled: true, provider: 'claude_code' });
  delete context.window.electronAPI;
  assert.equal(context.isStateMateReady(), false, 'a web page cannot start a process');
  installStream(() => {});
  assert.equal(context.isStateMateReady(), true, 'and it needs no key');
  delete context.window.electronAPI;
});

test('a Claude Code request goes to the shell as words and a model, and reads back like any stream', async () => {
  context.resetStateMateSettings();
  context.saveStateMateSettings({ enabled: true, provider: 'claude_code', model: 'opus', apiKey: 'sk-should-not-travel' });
  const seen = installStream(handlers => {
    handlers.onChunk(': thinking\n');
    handlers.onChunk(`data: ${JSON.stringify({ model: 'claude-opus-5', choices: [{ delta: { content: '{"kind":"reply","text":"hi"}' } }] })}\n\n`);
    handlers.onChunk(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4 } })}\n\n`);
    handlers.onEnd({ ok: true, status: 200 });
  });
  try {
    const out = await context.callModel({ system: 'SYS', user: 'hello' });
    assert.equal(seen[0].url, 'claude-code:');
    assert.deepEqual(Object.keys(JSON.parse(seen[0].body)).sort(), ['messages', 'model', 'stream', 'system']);
    assert.ok(!seen[0].body.includes('sk-should-not-travel'), 'no key is sent to a provider that uses none');
    assert.equal(out.text, '{"kind":"reply","text":"hi"}');
    assert.deepEqual(out.usage, { input: 12, output: 4 });
    assert.equal(out.model, 'claude-opus-5');
  } finally {
    delete context.window.electronAPI;
  }
});

test('a CLI failure surfaces as the CLI\'s sentence with a settings action', async () => {
  context.resetStateMateSettings();
  context.saveStateMateSettings({ enabled: true, provider: 'claude_code', maxRetries: 0 });
  installStream(handlers => handlers.onEnd({ ok: false, status: 0, cliError: true, body: 'Not logged in · Please run /login' }));
  try {
    await assert.rejects(context.callModel({ system: 's', user: 'u' }), err => {
      assert.equal(err.code, 'cli');
      const copy = context.describeError(err);
      assert.equal(copy.text, 'Not logged in · Please run /login');
      assert.equal(copy.action, 'settings');
      return true;
    });
  } finally {
    delete context.window.electronAPI;
  }
});

test('the keyless providers offer no picture attachment and list their own models', async () => {
  context.resetStateMateSettings();
  assert.equal(context.supportsImages('claude-opus-5', { provider: 'claude_code' }), false);
  assert.equal(context.supportsImages('claude-opus-5', { provider: 'agent_bridge' }), false);
  const models = await context.listModels({ settings: { provider: 'claude_code', baseUrl: '', apiKey: '' } });
  assert.deepEqual(models.map(m => m.id), ['sonnet', 'opus', 'haiku']);
  context.saveStateMateSettings({ enabled: true, provider: 'agent_bridge' });
  assert.equal(context.isStateMateReady(), true, 'the bridge needs no key either');
  context.resetStateMateSettings();
});
