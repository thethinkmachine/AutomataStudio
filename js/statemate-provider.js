// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  STATEMATE — PROVIDER & SETTINGS
// ══════════════════════════════════════════════════════════════════
//  The only module in the feature that knows fetch() exists, and the only
//  one that holds the API key.
//
//  ── Why the settings do NOT live in App.config ──────────────────
//  exportWorkspaceState() deep-copies the whole of App.config into every
//  workspace tab, and getBackupPayload() writes the whole of App.config to
//  IndexedDB and localStorage. A key in App.config is therefore a key on
//  disk in the autosave blob and in every tab snapshot — and one day in a
//  bug report attached to a .json file. Saved files, share links and
//  PNG-embedded workspaces happen to be safe today because
//  getWorkspaceData() allow-lists six config keys, but that is one
//  allow-list edit away from not being true.
//
//  So StateMate keeps its own store, under its own localStorage key, and
//  tests/statemate.test.js asserts the key reaches none of the three
//  serializers.
//
//  This module imports nothing from the app. It is a leaf, reachable from
//  anywhere at any point in evaluation.

const STORAGE_KEY = 'automata-statemate';

// A request that has not answered in this long is not going to.
const REQUEST_TIMEOUT_MS = 45000;

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-ant-',
    // Anthropic blocks browser origins unless the request opts in explicitly.
    browserNote: 'Sent with the direct-browser-access header. In the desktop app the request goes through the main process instead.'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-',
    browserNote: 'Your key is readable by this page. Prefer the desktop app for anything shared.'
  },
  compatible: {
    label: 'OpenAI-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keyLabel: 'API key (optional)',
    keyHint: 'Leave empty for a local server',
    browserNote: 'Local servers must allow this page\'s origin — for Ollama that is OLLAMA_ORIGINS.'
  }
};

const DEFAULTS = {
  enabled: false,
  provider: 'anthropic',
  baseUrl: '',
  model: '',
  apiKey: '',
  // Behaviour
  attachCanvas: true,
  verify: true,
  repairAttempts: 1,
  writeNotes: false,
  newTabForBuild: true,
  confirmReplace: false,
  followUp: true
};

let settings = { ...DEFAULTS };
let loaded = false;

/** True inside the Electron shell, where requests can bypass CORS. */
export function hasNativeTransport() {
  return typeof window !== 'undefined' && !!window.electronAPI?.statemateRequest;
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** Load once per session; later calls return the live object. */
export function getStateMateSettings() {
  if (!loaded) {
    settings = { ...DEFAULTS, ...readStore() };
    loaded = true;
  }
  return settings;
}

export function saveStateMateSettings(patch) {
  const next = { ...getStateMateSettings(), ...patch };
  settings = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    // Private mode or a full quota. The settings still apply for this session;
    // silently losing them on reload is better than refusing the change.
    console.warn('StateMate: settings could not be persisted', e);
  }
  return next;
}

/** Test seam, and the Clear-key button. */
export function resetStateMateSettings() {
  settings = { ...DEFAULTS };
  loaded = true;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
  return settings;
}

export function providerConfig(id = getStateMateSettings().provider) {
  return PROVIDERS[id] || PROVIDERS.anthropic;
}

/** Effective endpoint and model, falling back to the provider's defaults. */
export function resolveEndpoint(s = getStateMateSettings()) {
  const preset = providerConfig(s.provider);
  return {
    baseUrl: (s.baseUrl || preset.baseUrl).replace(/\/+$/, ''),
    model: s.model || preset.model
  };
}

/** Whether a prompt can be sent at all. */
export function isStateMateReady(s = getStateMateSettings()) {
  if (!s.enabled) return false;
  // A local OpenAI-compatible server legitimately has no key.
  if (s.provider === 'compatible') return true;
  return !!s.apiKey;
}

// ══════════════════════════════════════════════════════════════════
//  ERRORS
// ══════════════════════════════════════════════════════════════════

export class ProviderError extends Error {
  constructor(code, message, detail = null, meta = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.detail = detail;
    Object.assign(this, meta);
  }
}

function mapHttpError(status, bodyText, host) {
  const detail = String(bodyText || '').slice(0, 1200);
  if (status === 401 || status === 403) {
    return new ProviderError('auth', 'Your API key was rejected.', detail);
  }
  if (status === 429) {
    return new ProviderError('rate-limit', 'The provider is rate-limiting requests.', detail);
  }
  if (status === 404) {
    return new ProviderError('not-found', `${host} has no endpoint there — check the base URL and model.`, detail);
  }
  if (status >= 500) {
    return new ProviderError('server', 'The provider is having trouble right now.', detail);
  }
  return new ProviderError('http', `The provider refused the request (${status}).`, detail);
}

// ══════════════════════════════════════════════════════════════════
//  REQUEST SHAPES
// ══════════════════════════════════════════════════════════════════

function buildRequest({ system, user, maxTokens, temperature }, s) {
  const { baseUrl, model } = resolveEndpoint(s);
  const streaming = !hasNativeTransport();

  if (s.provider === 'anthropic') {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        stream: streaming,
        messages: [{ role: 'user', content: user }]
      }
    };
  }

  const headers = { 'content-type': 'application/json' };
  if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    stream: streaming,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
  // Only the hosted OpenAI API is reliably happy with a JSON response format;
  // enough compatible servers reject the field outright that asking for it
  // there costs more requests than it saves.
  if (s.provider === 'openai') body.response_format = { type: 'json_object' };
  if (streaming) body.stream_options = { include_usage: true };

  return { url: `${baseUrl}/chat/completions`, headers, body };
}

// ── response readers ──────────────────────────────────────────────

function readWholeResponse(json, provider) {
  if (provider === 'anthropic') {
    const text = (json.content || [])
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('');
    return {
      text,
      usage: { input: json.usage?.input_tokens ?? null, output: json.usage?.output_tokens ?? null },
      model: json.model || null
    };
  }
  return {
    text: json.choices?.[0]?.message?.content || '',
    usage: { input: json.usage?.prompt_tokens ?? null, output: json.usage?.completion_tokens ?? null },
    model: json.model || null
  };
}

function deltaFrom(event, provider) {
  if (provider === 'anthropic') {
    if (event.type === 'content_block_delta') return event.delta?.text || '';
    return '';
  }
  return event.choices?.[0]?.delta?.content || '';
}

function usageFrom(event, provider) {
  if (provider === 'anthropic') {
    if (event.type === 'message_start') return { input: event.message?.usage?.input_tokens ?? null, output: null };
    if (event.type === 'message_delta') return { input: null, output: event.usage?.output_tokens ?? null };
    return null;
  }
  if (event.usage) return { input: event.usage.prompt_tokens ?? null, output: event.usage.completion_tokens ?? null };
  return null;
}

/**
 * Read an SSE body, calling onText with each delta. Both provider dialects
 * are `data: {json}` lines with blank-line separators, so one reader serves
 * both and only the delta extraction differs.
 */
async function readStream(response, provider, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const usage = { input: null, output: null };
  let model = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let event;
      try { event = JSON.parse(payload); } catch (e) { continue; }

      const delta = deltaFrom(event, provider);
      if (delta) {
        text += delta;
        if (onText) onText(text, delta);
      }
      const u = usageFrom(event, provider);
      if (u) {
        if (u.input !== null) usage.input = u.input;
        if (u.output !== null) usage.output = u.output;
      }
      if (event.model) model = event.model;
      if (event.message?.model) model = event.message.model;
    }
  }

  return { text, usage, model };
}

// ══════════════════════════════════════════════════════════════════
//  THE CALL
// ══════════════════════════════════════════════════════════════════

/**
 * One completion.
 *
 * @param {object}   opts
 * @param {string}   opts.system
 * @param {string}   opts.user
 * @param {Function} [opts.onText]  called with (fullText, delta) as it streams
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text: string, usage: object, model: string}>}
 */
export async function callModel({
  system, user, onText, signal,
  maxTokens = 4000, temperature = 0.2
} = {}) {
  const s = getStateMateSettings();
  if (!s.enabled) throw new ProviderError('disabled', 'StateMate is switched off.');
  if (!isStateMateReady(s)) throw new ProviderError('no-key', 'StateMate needs an API key.');

  const request = buildRequest({ system, user, maxTokens, temperature }, s);
  const host = (() => {
    try { return new URL(request.url).host; } catch (e) { return request.url; }
  })();

  // The desktop shell proxies through the main process: no CORS, and the
  // renderer never has to be a trusted origin for the provider.
  if (hasNativeTransport()) {
    let result;
    try {
      result = await window.electronAPI.statemateRequest({
        url: request.url,
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
    } catch (err) {
      throw new ProviderError('network', `Could not reach ${host}.`, String(err?.message || err));
    }
    if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled.');
    if (!result.ok) throw mapHttpError(result.status, result.body, host);
    let json;
    try { json = JSON.parse(result.body); } catch (e) {
      throw new ProviderError('bad-response', `${host} did not return JSON.`, String(result.body).slice(0, 1200));
    }
    const whole = readWholeResponse(json, s.provider);
    if (onText && whole.text) onText(whole.text, whole.text);
    return whole;
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = () => timeout.abort();
  signal?.addEventListener('abort', onOuterAbort);

  try {
    let response;
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: timeout.signal
      });
    } catch (err) {
      if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled.');
      if (err?.name === 'AbortError') {
        throw new ProviderError('timeout', `${resolveEndpoint(s).model} did not answer in time.`);
      }
      // fetch() rejects with a bare TypeError for both a dead host and a CORS
      // refusal, and the two are indistinguishable from script. The provider
      // note is the actionable half.
      throw new ProviderError(
        'network',
        `Your browser could not reach ${host}.`,
        providerConfig(s.provider).browserNote
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const err = mapHttpError(response.status, body, host);
      if (response.status === 429) {
        const retry = Number(response.headers?.get?.('retry-after'));
        if (Number.isFinite(retry) && retry > 0) err.retryAfter = retry;
      }
      throw err;
    }

    // Streaming is the default, but a proxy that buffers the body away leaves
    // no reader — falling back keeps those setups working rather than failing
    // on a feature the user did not ask for.
    if (request.body.stream && response.body?.getReader) {
      return await readStream(response, s.provider, onText);
    }
    const json = await response.json();
    const whole = readWholeResponse(json, s.provider);
    if (onText && whole.text) onText(whole.text, whole.text);
    return whole;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * A minimal round trip for the Test-connection button: cheap, and it proves
 * the key, the base URL and the model name all at once.
 */
export async function testConnection() {
  const started = Date.now();
  const result = await callModel({
    system: 'Reply with the single word: ok',
    user: 'ping',
    maxTokens: 16,
    temperature: 0
  });
  return {
    ms: Date.now() - started,
    model: result.model || resolveEndpoint().model,
    text: (result.text || '').trim().slice(0, 40)
  };
}
