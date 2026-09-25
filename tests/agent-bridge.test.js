import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The agent bridge, driven the way it is used: the real script as a child
// process, JSON-RPC on its stdin as Claude Code would send it, and an HTTP
// request on the other side as StateMate would send it.

const SCRIPT = fileURLToPath(new URL('../tools/agent-bridge/statemate-bridge.mjs', import.meta.url));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}/v1`;

function startBridge() {
  const child = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, STATEMATE_BRIDGE_PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    let cut;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 1);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params) => new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args = {}) => {
    const { result } = await rpc('tools/call', { name, arguments: args });
    return { text: result.content[0].text, isError: !!result.isError };
  };
  return { child, rpc, call, stop: () => child.stdin.end() };
}

/** Post a chat request and collect the streamed answer's text. */
async function ask(messages, { origin } = {}) {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ model: 'agent', stream: true, messages })
  });
  const raw = await response.text();
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
    text += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content || '';
  }
  return { status: response.status, text, raw };
}

test('a request goes out over MCP and the answer comes back as a stream', async t => {
  const bridge = startBridge();
  t.after(() => bridge.stop());

  const init = await bridge.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(init.result.serverInfo.name, 'statemate-bridge');
  const { result } = await bridge.rpc('tools/list');
  assert.deepEqual(result.tools.map(tool => tool.name).sort(), ['get_request', 'list_requests', 'respond', 'wait_for_request']);

  // The first call starts the HTTP side; with nothing queued it times out.
  const idle = await bridge.call('wait_for_request', { timeout_seconds: 1 });
  assert.match(idle.text, /No request yet/);

  const system = { role: 'system', content: 'You build automata. Answer with JSON.' };
  const answer = ask([system, { role: 'user', content: 'binary numbers divisible by 3' }]);

  const got = JSON.parse((await bridge.call('wait_for_request', { timeout_seconds: 10 })).text);
  assert.equal(got.system_prompt, system.content, 'the system prompt is shown in full the first time');
  assert.deepEqual(got.messages, [{ role: 'user', content: 'binary numbers divisible by 3' }]);

  const refused = await bridge.call('respond', { id: got.id, text: '{"kind": "reply", "text": "a\\{b"}' });
  assert.equal(refused.isError, true, 'invalid JSON goes back to the agent, not to the app');
  assert.match(refused.text, /not valid JSON/);

  const sent = await bridge.call('respond', { id: got.id, text: '{"kind":"reply","text":"ok"}' });
  assert.equal(sent.isError, false);
  const { status, text, raw } = await answer;
  assert.equal(status, 200);
  assert.equal(text, '{"kind":"reply","text":"ok"}');
  assert.match(raw, /^: waiting for the agent/, 'held open with comments, which keep the app\'s idle clock alive');

  const again = await bridge.call('respond', { id: got.id, text: '{}' });
  assert.match(again.text, /already answered/);

  // The second request has the same system prompt, so it is not repeated.
  const second = ask([system, { role: 'user', content: 'again' }]);
  const next = JSON.parse((await bridge.call('wait_for_request', { timeout_seconds: 10 })).text);
  assert.match(next.system_prompt, /^\(unchanged/);
  const full = JSON.parse((await bridge.call('get_request', { id: next.id, include_system: true })).text);
  assert.equal(full.system_prompt, system.content);
  await bridge.call('respond', { id: next.id, text: 'not json at all', allow_invalid_json: true });
  assert.equal((await second).text, 'not json at all', 'a deliberate malformed answer is allowed for testing the parse path');
});

test('a request the app abandons is marked cancelled and cannot be answered', async t => {
  const bridge = startBridge();
  t.after(() => bridge.stop());
  await bridge.call('list_requests');

  const controller = new AbortController();
  const request = fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'x' }] }),
    signal: controller.signal
  }).then(r => r.text()).catch(() => null);

  const got = JSON.parse((await bridge.call('wait_for_request', { timeout_seconds: 10 })).text);
  controller.abort();
  await request;
  await new Promise(resolve => setTimeout(resolve, 100));
  const late = await bridge.call('respond', { id: got.id, text: '{}' });
  assert.equal(late.isError, true);
  assert.match(late.text, /cancelled/);
});

test('only the app\'s own origins may reach the queue', async t => {
  const bridge = startBridge();
  t.after(() => bridge.stop());
  await bridge.call('list_requests');

  const evil = await fetch(`${BASE}/models`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const local = await fetch(`${BASE}/models`, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const desktop = await fetch(`${BASE}/models`);
  assert.equal(desktop.status, 200, 'the desktop shell\'s main process sends no Origin at all');
});
