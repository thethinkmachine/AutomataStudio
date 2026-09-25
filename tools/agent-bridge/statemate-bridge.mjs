#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE AGENT BRIDGE
// ══════════════════════════════════════════════════════════════════
//  Lets a running agent session — Claude Code — be StateMate's model.
//
//  One process, two faces:
//
//    StateMate  ──HTTP──▶  127.0.0.1:8765/v1/chat/completions   (OpenAI dialect)
//    Claude Code ──MCP──▶  wait_for_request / respond            (JSON-RPC, stdio)
//
//  StateMate's request is parked, held open with SSE comments so neither of
//  its clocks fires, and answered with whatever the agent passes to
//  `respond`. The answer then goes through StateMate's real pipeline — parse,
//  compile, lint, verify — exactly as a hosted model's would.
//
//  It is a testing instrument: you can watch the agent read the prompt,
//  write the machine, and see what the app makes of it. It is slow by design.
//
//  Zero dependencies, on purpose — `node tools/agent-bridge/statemate-bridge.mjs`
//  must work from a fresh clone. Registered for this repository in .mcp.json;
//  driven by the /statemate-bridge command in .claude/commands.
//
//  Env: STATEMATE_BRIDGE_PORT (default 8765).
//  Nothing is written to stdout except JSON-RPC; logs go to stderr.

import http from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.STATEMATE_BRIDGE_PORT) || 8765;
const HOST = '127.0.0.1';
const PING_MS = 8000;
const MAX_WAIT_S = 55;
const PROTOCOL_VERSION = '2025-06-18';

const log = (...args) => process.stderr.write(`[statemate-bridge] ${args.join(' ')}\n`);

// ══════════════════════════════════════════════════════════════════
//  THE QUEUE
// ══════════════════════════════════════════════════════════════════

/** id → { id, at, body, system, systemHash, messages, status, res, stream, ping } */
const requests = new Map();
let nextId = 1;
let lastSystemHash = null;
const waiters = new Set();

function hash(text) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(p => (p?.type === 'text' ? p.text : p?.type ? `[${p.type} omitted]` : '')).join('\n');
}

function enqueue(body, res, stream) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n\n');
  const entry = {
    id: String(nextId++),
    at: new Date().toISOString(),
    body,
    system,
    systemHash: hash(system),
    messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: textOf(m.content) })),
    status: 'pending',
    delivered: false,
    res,
    stream,
    ping: null
  };
  requests.set(entry.id, entry);
  log(`request ${entry.id} received (${messages.length} messages)`);
  for (const wake of [...waiters]) wake();
  return entry;
}

function pending() {
  return [...requests.values()].filter(r => r.status === 'pending');
}

/** The request as the agent sees it. The system prompt is sent once per change. */
function present(entry, { includeSystem = false } = {}) {
  const sameSystem = entry.systemHash === lastSystemHash;
  const out = {
    id: entry.id,
    received_at: entry.at,
    status: entry.status,
    system_prompt: includeSystem || !sameSystem
      ? entry.system
      : `(unchanged — identical to the system prompt already shown, hash ${entry.systemHash})`,
    messages: entry.messages
  };
  lastSystemHash = entry.systemHash;
  return JSON.stringify(out, null, 1);
}

/**
 * StateMate reads one JSON object. A reply that is not one is sent back to the
 * agent rather than to the app, because the app would spend its single
 * reformat round on a typo the agent can fix for free.
 */
function checkJSON(text) {
  let body = String(text).trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) body = fence[1];
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end < start) return 'No JSON object found.';
  try {
    const value = JSON.parse(body.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The answer must be one JSON object.';
    return null;
  } catch (err) {
    return err.message;
  }
}

function deliver(entry, text) {
  const { res } = entry;
  clearInterval(entry.ping);
  entry.status = 'answered';
  if (entry.stream) {
    const frame = payload => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    frame({ model: 'agent-bridge', choices: [{ index: 0, delta: { content: text } }] });
    frame({ model: 'agent-bridge', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { ...cors(entry.origin), 'content-type': 'application/json' });
    res.end(JSON.stringify({
      model: 'agent-bridge',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
    }));
  }
  log(`request ${entry.id} answered (${text.length} chars)`);
}

// ══════════════════════════════════════════════════════════════════
//  THE HTTP SIDE
// ══════════════════════════════════════════════════════════════════

// A page on any origin could otherwise post into the queue and read back what
// the agent wrote. The app is served from localhost in development, app:// in
// the desktop shell (whose main process sends no Origin at all), and GitHub
// Pages when deployed.
const ALLOWED_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|app:\/\/[\w.-]*|https:\/\/[\w-]+\.github\.io|null)$/;

function cors(origin) {
  if (!origin || !ALLOWED_ORIGIN.test(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin'
  };
}

let server = null;
let listening = null;

function startServer() {
  if (listening) return listening;
  listening = new Promise((resolve, reject) => {
    server = http.createServer(handle);
    server.once('error', err => {
      listening = null;
      reject(err.code === 'EADDRINUSE'
        ? new Error(`Port ${PORT} is already in use — is another bridge running? Set STATEMATE_BRIDGE_PORT to use another.`)
        : err);
    });
    server.listen(PORT, HOST, () => {
      log(`listening on http://${HOST}:${PORT}/v1`);
      resolve();
    });
  });
  return listening;
}

function handle(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    res.writeHead(403);
    return res.end();
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(origin));
    return res.end();
  }
  if (req.method === 'GET' && /\/models\/?$/.test(req.url)) {
    res.writeHead(200, { ...cors(origin), 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'agent', object: 'model' }] }));
  }
  if (req.method !== 'POST' || !/\/chat\/completions\/?$/.test(req.url)) {
    res.writeHead(404, cors(origin));
    return res.end();
  }

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) {
      res.writeHead(400, { ...cors(origin), 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'The request body was not JSON.' } }));
    }
    const stream = body.stream !== false;
    if (stream) {
      res.writeHead(200, { ...cors(origin), 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(': waiting for the agent\n\n');
    }
    const entry = enqueue(body, res, stream);
    entry.origin = origin;
    // Comments are skipped by the app's reader but reset its idle clock, which
    // is what lets an agent take minutes over an answer.
    if (stream) entry.ping = setInterval(() => res.write(': waiting for the agent\n\n'), PING_MS);
    // `res`, not `req`: a request's own `close` fires as soon as its body has
    // been read, which would cancel every request the moment it arrived.
    res.on('close', () => {
      clearInterval(entry.ping);
      if (entry.status === 'pending') {
        entry.status = 'cancelled';
        log(`request ${entry.id} cancelled by the app`);
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════
//  THE MCP SIDE
// ══════════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'wait_for_request',
    description: 'Start the bridge if needed and wait for StateMate\'s next request. Returns the request id, the system prompt (in full the first time and whenever it changes) and the conversation. Answer it with respond. Returns "no request" after the timeout; call again to keep waiting.',
    inputSchema: {
      type: 'object',
      properties: { timeout_seconds: { type: 'number', description: `How long to wait, at most ${MAX_WAIT_S}. Default 45.` } }
    },
    run: async ({ timeout_seconds } = {}) => {
      await startServer();
      const wait = Math.max(1, Math.min(MAX_WAIT_S, Number(timeout_seconds) || 45)) * 1000;
      const next = () => pending().find(r => !r.delivered);
      let entry = next();
      if (!entry) {
        await new Promise(resolve => {
          const wake = () => { waiters.delete(wake); clearTimeout(timer); resolve(); };
          const timer = setTimeout(wake, wait);
          waiters.add(wake);
        });
        entry = next();
      }
      if (!entry) return `No request yet. The bridge is listening on http://${HOST}:${PORT}/v1 — call wait_for_request again.`;
      entry.delivered = true;
      return present(entry);
    }
  },
  {
    name: 'respond',
    description: 'Answer a StateMate request. `text` is the whole model answer, exactly as StateMate should receive it — normally a single JSON object. Invalid JSON is refused so it can be fixed first, unless allow_invalid_json is true (for deliberately testing StateMate\'s parse and repair path).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The request id from wait_for_request.' },
        text: { type: 'string', description: 'The answer.' },
        allow_invalid_json: { type: 'boolean', description: 'Send it even if it does not parse. Default false.' }
      },
      required: ['id', 'text']
    },
    run: async ({ id, text, allow_invalid_json } = {}) => {
      const entry = requests.get(String(id));
      if (!entry) throw new Error(`No request ${id}.`);
      if (entry.status === 'cancelled') throw new Error(`Request ${id} was cancelled in StateMate; nothing was sent.`);
      if (entry.status !== 'pending') throw new Error(`Request ${id} was already answered.`);
      const problem = allow_invalid_json ? null : checkJSON(text);
      if (problem) throw new Error(`Not sent — the answer is not valid JSON: ${problem}`);
      deliver(entry, String(text));
      return `Sent to StateMate (request ${id}, ${String(text).length} chars).`;
    }
  },
  {
    name: 'get_request',
    description: 'Show one request again, optionally with the full system prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        include_system: { type: 'boolean', description: 'Include the full system prompt. Default false.' }
      },
      required: ['id']
    },
    run: async ({ id, include_system } = {}) => {
      const entry = requests.get(String(id));
      if (!entry) throw new Error(`No request ${id}.`);
      return present(entry, { includeSystem: !!include_system });
    }
  },
  {
    name: 'list_requests',
    description: 'List every request this bridge has seen, with its status.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      await startServer();
      const rows = [...requests.values()].map(r => `${r.id}\t${r.status}\t${r.at}\t${r.messages.length} messages`);
      return rows.length ? rows.join('\n') : `No requests yet. Listening on http://${HOST}:${PORT}/v1.`;
    }
  }
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function dispatch(message) {
  const { id, method, params } = message || {};
  const isRequest = id !== undefined && id !== null;
  if (!method) return;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'statemate-bridge', version: '1.0.0' },
      instructions: 'Serves StateMate (AutomataStudio\'s AI assist) requests to this agent. Loop: wait_for_request, write the answer the system prompt asks for, respond.'
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, { tools: TOOLS.map(({ run, ...tool }) => tool) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name);
    if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);
    try {
      const text = await tool.run(params?.arguments || {});
      return reply(id, { content: [{ type: 'text', text }] });
    } catch (err) {
      return reply(id, { content: [{ type: 'text', text: String(err?.message || err) }], isError: true });
    }
  }
  if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let cut;
  while ((cut = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, cut).trim();
    input = input.slice(cut + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch (e) {
      replyError(null, -32700, 'Parse error');
      continue;
    }
    dispatch(message).catch(err => log('dispatch failed:', err?.stack || err));
  }
});
process.stdin.on('end', () => {
  server?.close();
  process.exit(0);
});
