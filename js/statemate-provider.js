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

// ── the two clocks ────────────────────────────────────────────────
//  A wall-clock timeout is the wrong instrument for a streamed answer: it
//  cannot tell a hung request from a large machine still arriving, and 45
//  seconds into a 60-state answer it kills a request that was working. So the
//  budget is split — one to prove the provider is there, then one that resets
//  on every delta and only fires when nothing has arrived for a while.
const FIRST_BYTE_TIMEOUT_MS = 45000;
const IDLE_TIMEOUT_MS = 30000;

// ── retry ─────────────────────────────────────────────────────────
//  Base for the exponential backoff, and the ceiling on honouring a
//  `retry-after`: a provider asking for ten minutes is telling us to give up,
//  not to sleep through the user's afternoon.
const RETRY_BASE_MS = 600;
const MAX_RETRY_WAIT_S = 60;

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
    model: 'gpt-5.6-luna',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-',
    browserNote: 'Your key is readable by this page. Prefer the desktop app for anything shared.'
  },
  mistralai: {
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-',
    browserNote: 'Your key is readable by this page. Prefer the desktop app for anything shared.'
  },
  GoogleAiStudio: {
    label: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.7-flash',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-',
    browserNote: 'Your key is readable by this page. Prefer the desktop app for anything shared.'
  },
  cohere: {
    label: 'Cohere',
    baseUrl: 'https://api.cohere.com/v2/',
    model: 'command-xlarge-nightly',
    keyLabel: 'API key',
    keyHint: 'Starts with cohere-',
    browserNote: 'Your key is readable by this page. Prefer the desktop app for anything shared.'
  },
  openrouter_ai: {
    label: 'OpenRouter.ai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-or-',
    browserNote: 'Your key is readable by this page. Prefer the desktop app for anything shared.'
  },
  compatible: {
    label: 'Local Server (OpenAI-compatible)',
    baseUrl: 'http://localhost:8080/v1',
    model: 'unsloth/Qwen3.8-27B-GGUF',
    keyLabel: 'API key (optional)',
    keyHint: 'Leave empty for a local/auth-less server',
    browserNote: 'Local servers must allow this page\'s origin.'
  }
};

const DEFAULTS = {
  enabled: false,
  provider: 'anthropic',
  baseUrl: '',
  model: '',
  apiKey: '',
  // Behaviour
  agentTools: true,
  agentMaxSteps: 16,
  attachCanvas: true,
  verify: true,
  repairAttempts: 1,
  writeNotes: false,
  newTabForBuild: true,
  confirmReplace: false,
  // How many times a *transport* failure is retried before it becomes the
  // user's problem. Distinct from repairAttempts, which is about the quality
  // of an answer that did arrive.
  maxRetries: 2,
  // How many past turns travel with each request. 0 is strict one-shot — the
  // behaviour before the thread existed.
  threadDepth: 10
};

let settings = { ...DEFAULTS };
let loaded = false;

/** True inside the Electron shell, where requests can bypass CORS. */
export function hasNativeTransport() {
  return typeof window !== 'undefined' && !!window.electronAPI?.statemateRequest;
}

/**
 * True when the shell can stream, which is a separate question from whether it
 * can make the request at all — an older build of the desktop app has
 * `statemateRequest` and not this, and must keep working. Without it the
 * desktop had no streaming, no way to cancel a request in flight, and no
 * access to `retry-after`, because `invoke` resolves once with a whole body.
 */
export function hasNativeStreaming() {
  return typeof window !== 'undefined' && !!window.electronAPI?.statemateStream;
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
    const stored = readStore();
    settings = { ...DEFAULTS, ...stored };
    // `followUp` was the thread's one-turn ancestor. Someone who switched it
    // off asked not to be remembered, so honour that rather than silently
    // upgrading them to six turns.
    if (stored.threadDepth === undefined && stored.followUp === false) settings.threadDepth = 0;
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

/**
 * The provider's own account of what went wrong.
 *
 * Both dialects answer a failure with `{error: {type, message}}`, and that
 * message is almost always the actionable half — "Your credit balance is too
 * low" beats "the provider refused the request (400)". describeError already
 * prefers a thrown message over its own generic copy, so reading this out of
 * the body improves every error at once rather than one at a time.
 */
export function readProviderError(bodyText) {
  const raw = String(bodyText ?? '');
  let json = null;
  try { json = JSON.parse(raw); } catch (e) { return { type: '', message: '', raw }; }

  const err = json?.error ?? json;
  const message = typeof err === 'string' ? err
    : typeof err?.message === 'string' ? err.message
    : typeof json?.message === 'string' ? json.message
    : '';
  const type = [err?.type, err?.code, json?.type].find(v => typeof v === 'string' && v) || '';
  return { type, message: String(message).trim(), raw };
}

/**
 * `retry-after` is either a delay in seconds or an HTTP date, and both appear
 * in the wild. A date already in the past is not worth waiting for.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds > 0 ? Math.min(seconds, MAX_RETRY_WAIT_S) : 0;
  const at = Date.parse(String(value));
  if (!Number.isFinite(at)) return 0;
  const wait = Math.ceil((at - now) / 1000);
  return wait > 0 ? Math.min(wait, MAX_RETRY_WAIT_S) : 0;
}

// The three failures whose HTTP status does not identify them. Quota is the
// one that matters most: it arrives as a 429 as often as a 402, so read as a
// rate limit it gets a Retry button that can never succeed.
const CREDIT_HINTS = /insufficient[_ ]quota|credit balance|billing|payment required|exceeded your current quota|quota exceeded|no funds/i;
const CONTEXT_HINTS = /context[_ ]length|context window|prompt is too long|maximum context|too many (?:input )?tokens|reduce the length/i;
const MODEL_HINTS = /model[^.]{0,40}(?:not found|does not exist|unknown|unavailable)|invalid model|no such model|unsupported model/i;

/**
 * HTTP failure → a code the UI has copy for.
 *
 * The order matters, and it is not the order of the statuses: the three hint
 * tests come first precisely because the status is the part that lies about
 * them. Everything below them can be read off the number.
 */
function mapHttpError(status, bodyText, host, { retryAfter = 0 } = {}) {
  const info = readProviderError(bodyText);
  const said = info.message;
  const detail = said && info.raw ? info.raw.slice(0, 1200) : String(bodyText || '').slice(0, 1200);
  const say = fallback => said || fallback;
  const looks = re => re.test(said) || re.test(info.type);

  if (status === 402 || looks(CREDIT_HINTS)) {
    return new ProviderError('credit', say('This account cannot pay for the request.'), detail);
  }
  if (looks(CONTEXT_HINTS)) {
    return new ProviderError('context-length', say('The request was too long for this model.'), detail);
  }
  if (status === 529 || looks(/overloaded/i)) {
    return new ProviderError('overloaded', say(`${host} is overloaded right now.`), detail, { retryAfter });
  }
  if (status === 401 || status === 403) {
    return new ProviderError('auth', say('Your API key was rejected.'), detail);
  }
  if (status === 429) {
    return new ProviderError('rate-limit', say('The provider is rate-limiting requests.'), detail, { retryAfter });
  }
  if (status === 404 || looks(MODEL_HINTS)) {
    return new ProviderError('not-found', say(`${host} has no endpoint or model by that name — check the base URL and model.`), detail);
  }
  if (status >= 500) {
    return new ProviderError('server', say('The provider is having trouble right now.'), detail, { retryAfter });
  }
  if (status === 400 || status === 422) {
    return new ProviderError('bad-request', say(`${host} rejected the request as malformed.`), detail);
  }
  return new ProviderError('http', say(`The provider refused the request (${status}).`), detail);
}

// ══════════════════════════════════════════════════════════════════
//  RETRY
// ══════════════════════════════════════════════════════════════════
//  Which failures are worth asking again about, and how long to wait.
//
//  The list is the whole design. `auth`, `credit`, `not-found` and
//  `bad-request` are settled facts about the request — retrying one is a
//  guaranteed second failure and, on a metered account, a second charge. The
//  rest are statements about right now.

const RETRIABLE = new Set(['rate-limit', 'overloaded', 'server', 'network', 'timeout', 'bad-response']);

export function isRetriableError(err) {
  return !!err && RETRIABLE.has(err.code);
}

/**
 * How long before attempt `n + 1`. A `retry-after` the provider supplied wins
 * outright — it knows when its own window reopens. Otherwise exponential with
 * jitter, floored at half the ceiling so the first wait is a real pause rather
 * than a busy loop that happens to have slept.
 */
export function backoffMs(attempt, retryAfterSeconds = 0, random = Math.random) {
  if (retryAfterSeconds > 0) return Math.min(retryAfterSeconds, MAX_RETRY_WAIT_S) * 1000;
  const ceiling = RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

/**
 * Sleep, but let the user's cancel through.
 *
 * The abort has to interrupt the *wait*, not just the fetch around it:
 * pressing escape during a four-second backoff and having nothing happen for
 * four seconds is indistinguishable from a hang.
 */
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('cancelled', 'Cancelled.'));
    const finish = (fn, arg) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(arg); };
    const onAbort = () => finish(reject, new ProviderError('cancelled', 'Cancelled.'));
    const timer = setTimeout(() => finish(resolve), ms);
    signal?.addEventListener('abort', onAbort);
  });
}

// ══════════════════════════════════════════════════════════════════
//  REQUEST SHAPES
// ══════════════════════════════════════════════════════════════════

/**
 * A turn's content, in the dialect of whichever provider is configured.
 *
 * A turn is a plain string almost always, and stays one — the two dialects
 * only diverge once a picture is in it. The app's own neutral shape is
 * `{type: 'text', text}` and `{type: 'image', mime, data}` with `data` the
 * bare base64, because that is what Anthropic wants and a `data:` URL is one
 * template literal away from it, while the reverse means parsing the URL back
 * apart at the boundary.
 */
function toProviderContent(content, provider) {
  if (!Array.isArray(content)) return content;
  const parts = content.map(part => {
    if (part?.type === 'tool_use' || part?.type === 'tool_result') return part;
    if (part?.type !== 'image') return { type: 'text', text: String(part?.text ?? '') };
    return provider === 'anthropic'
      ? { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } }
      : { type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } };
  });
  // A one-part text turn is written back out as a string: enough compatible
  // servers only accept the string form that sending an array for a turn with
  // no picture in it would break setups that work today.
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

function buildRequest({ system, messages, maxTokens, temperature, tools }, s) {
  const { baseUrl, model } = resolveEndpoint(s);
  messages = (messages || []).map(m => ({ ...m, content: toProviderContent(m.content, s.provider) }));
  // The shell used to force this off, because `invoke` resolves once with a
  // whole body and cannot deliver a stream. It can now, so the only setup left
  // without streaming is an older desktop build.
  // Native tool calls are returned as structured blocks. Keep that round
  // buffered so the provider boundary can preserve call ids and arguments;
  // text-envelope turns continue to stream as before.
  const streaming = !tools?.length && (!hasNativeTransport() || hasNativeStreaming());

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
        // Anthropic carries the system prompt beside the turns rather than as
        // one of them, which is the only structural difference between the two
        // dialects now that both take a thread.
        system,
        stream: streaming,
        messages,
        ...(tools?.length ? { tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters
        })) } : {})
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
    messages: [{ role: 'system', content: system }, ...messages]
  };
  // Only the hosted OpenAI API is reliably happy with a JSON response format;
  // enough compatible servers reject the field outright that asking for it
  // there costs more requests than it saves.
  if (s.provider === 'openai' && !tools?.length) body.response_format = { type: 'json_object' };
  if (s.provider === 'openai' && tools?.length) body.tools = tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
  if (streaming) body.stream_options = { include_usage: true };

  return { url: `${baseUrl}/chat/completions`, headers, body };
}

// ── response readers ──────────────────────────────────────────────

function readWholeResponse(json, provider) {
  if (provider === 'anthropic') {
    const blocks = json.content || [];
    const text = blocks
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('');
    return {
      text,
      rawContent: blocks,
      toolCalls: blocks.filter(part => part.type === 'tool_use').map(part => ({
        id: part.id,
        name: part.name,
        arguments: part.input && typeof part.input === 'object' ? part.input : {}
      })),
      usage: { input: json.usage?.input_tokens ?? null, output: json.usage?.output_tokens ?? null },
      model: json.model || null,
      stop: json.stop_reason || null
    };
  }
  const message = json.choices?.[0]?.message || {};
  return {
    text: message.content || '',
    rawToolCalls: message.tool_calls || [],
    toolCalls: (message.tool_calls || []).map(call => {
      let argumentsValue = {};
      try { argumentsValue = JSON.parse(call.function?.arguments || '{}'); } catch (_error) { }
      return { id: call.id, name: call.function?.name || '', arguments: argumentsValue };
    }),
    usage: { input: json.usage?.prompt_tokens ?? null, output: json.usage?.completion_tokens ?? null },
    model: json.model || null,
    stop: json.choices?.[0]?.finish_reason || null
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

// Why the answer stopped. `max_tokens` / `length` is the one that used to be
// invisible: a machine cut off at the cap arrived as unparseable JSON and burnt
// a repair round at the same cap, which could only fail the same way.
function stopFrom(event, provider) {
  if (provider === 'anthropic') return event.delta?.stop_reason || event.message?.stop_reason || null;
  return event.choices?.[0]?.finish_reason || null;
}

/**
 * An incremental SSE reader: text in, deltas out.
 *
 * Split from the body loop so the same parser serves both transports — the
 * browser's `ReadableStream` and the desktop shell's IPC chunks, which arrive
 * as strings from another process. Both dialects are `data: {json}` lines with
 * blank-line separators, so only the three extractors above differ.
 */
function createSSEReader(provider, onText) {
  let buffer = '';
  let text = '';
  const usage = { input: null, output: null };
  let model = null;
  let stop = null;
  let firstTokenAt = null;

  return {
    push(chunk) {
      buffer += chunk;
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
          if (firstTokenAt === null) firstTokenAt = Date.now();
          text += delta;
          if (onText) onText(text, delta);
        }
        const u = usageFrom(event, provider);
        if (u) {
          if (u.input !== null) usage.input = u.input;
          if (u.output !== null) usage.output = u.output;
        }
        const s = stopFrom(event, provider);
        if (s) stop = s;
        if (event.model) model = event.model;
        if (event.message?.model) model = event.message.model;
      }
    },
    result(startedAt) {
      return {
        text, usage, model, stop,
        // Two numbers, because they answer different questions. Time to first
        // token is why a run feels slow; tokens per second is how fast the
        // answer then arrived, and averaging the wait into it hides both.
        timing: { startedAt, firstTokenAt, finishedAt: Date.now(), streamed: true }
      };
    }
  };
}

/**
 * Drain a `fetch` body through the reader above, keeping the idle clock alive.
 *
 * `startedAt` is passed in rather than taken here, and that is the whole of
 * what "time to first token" means. Taken here it would start after `fetch`
 * has already resolved — that is, after the response *headers* have arrived —
 * so it measured headers-to-first-frame, which is approximately zero on every
 * provider that flushes the first chunk with the headers. The console showed
 * "0.0s to first token" beside a rate implying a three-second answer.
 */
async function readStream(response, provider, onText, keepAlive = () => { }, startedAt = Date.now()) {
  const reader = createSSEReader(provider, onText);
  const body = response.body.getReader();
  const decoder = new TextDecoder();

  for (;;) {
    const { done, value } = await body.read();
    if (done) break;
    keepAlive();
    reader.push(decoder.decode(value, { stream: true }));
  }
  return reader.result(startedAt);
}

/**
 * The same, over the desktop shell's IPC channel.
 *
 * `statemateRequest` resolves once with a whole body, which is why the shell
 * had no streaming, no cancellation and no `retry-after`. This is a channel
 * instead: chunks arrive as they are read in the main process, and the end
 * event carries the status and headers the renderer never used to see.
 */
function nativeStream(request, provider, onText, signal, keepAlive, host, startedAt = Date.now()) {
  return new Promise((resolve, reject) => {
    const reader = createSSEReader(provider, onText);
    let handle = null;
    let settled = false;

    const done = () => { settled = true; signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => {
      if (settled) return;
      try { handle?.abort(); } catch (e) { /* the channel is already gone */ }
      done();
      reject(new ProviderError('cancelled', 'Cancelled.'));
    };
    signal?.addEventListener('abort', onAbort);

    handle = window.electronAPI.statemateStream(
      { url: request.url, headers: request.headers, body: JSON.stringify(request.body) },
      {
        onChunk: chunk => { if (!settled) { keepAlive(); reader.push(String(chunk || '')); } },
        onEnd: end => {
          if (settled) return;
          done();
          const info = end || {};
          if (info.aborted) return reject(new ProviderError('cancelled', 'Cancelled.'));
          if (info.timedOut) {
            return reject(new ProviderError('timeout', `${host} stopped responding mid-answer.`));
          }
          if (!info.ok) {
            if (!info.status) {
              return reject(new ProviderError('network', `Could not reach ${host}.`, String(info.body || '')));
            }
            return reject(mapHttpError(info.status, info.body, host, {
              retryAfter: parseRetryAfter(info.retryAfter)
            }));
          }
          resolve(reader.result(startedAt));
        }
      }
    );

    // An abort that landed between constructing the promise and receiving the
    // handle would otherwise never reach the channel.
    if (signal?.aborted) onAbort();
  });
}

// ══════════════════════════════════════════════════════════════════
//  THE CALL
// ══════════════════════════════════════════════════════════════════

/**
 * Why the answer stopped, when that is itself the failure.
 *
 * A truncated answer is not a malformed one, and the difference decides what
 * to do about it: the orchestrator raises the cap and asks again, where
 * `bad-json` would have sent the same request back to be reformatted at the
 * same cap and failed identically.
 */
function checkStopReason(out, model, maxTokens) {
  if (out.stop === 'max_tokens' || out.stop === 'length') {
    throw new ProviderError(
      'truncated',
      `${model} ran out of room mid-answer.`,
      String(out.text || '').slice(-800),
      { maxTokens, partial: out.text }
    );
  }
  if (out.stop === 'refusal') {
    throw new ProviderError('refusal', `${model} declined to answer that.`, String(out.text || '').slice(0, 800));
  }
  return out;
}

/** One request, no retries. Everything that can throw a ProviderError. */
async function requestOnce({ system, turns, maxTokens, temperature, onText, signal, tools }, s) {
  const request = buildRequest({ system, messages: turns, maxTokens, temperature, tools }, s);
  const host = (() => {
    try { return new URL(request.url).host; } catch (e) { return request.url; }
  })();
  const model = resolveEndpoint(s).model;

  // The two clocks. `arm` replaces whatever is pending, so handing it the idle
  // budget on every delta is how a long answer keeps itself alive.
  const timeout = new AbortController();
  let timer = null;
  let timedOut = false;
  const arm = ms => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; timeout.abort(); }, ms);
  };
  const keepAlive = () => arm(IDLE_TIMEOUT_MS);
  const onOuterAbort = () => timeout.abort();
  signal?.addEventListener('abort', onOuterAbort);

  const startedAt = Date.now();
  const wholeTiming = () => ({ startedAt, firstTokenAt: null, finishedAt: Date.now(), streamed: false });

  try {
    // The desktop shell proxies through the main process: no CORS, and the
    // renderer never has to be a trusted origin for the provider.
    if (hasNativeTransport()) {
      if (hasNativeStreaming() && request.body.stream) {
        arm(FIRST_BYTE_TIMEOUT_MS);
        const out = await nativeStream(request, s.provider, onText, timeout.signal, keepAlive, host, startedAt);
        if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled.');
        if (timedOut) throw new ProviderError('timeout', `${model} stopped responding mid-answer.`);
        return checkStopReason(out, model, maxTokens);
      }

      let result;
      arm(FIRST_BYTE_TIMEOUT_MS);
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
      if (!result.ok) {
        throw mapHttpError(result.status, result.body, host, { retryAfter: parseRetryAfter(result.retryAfter) });
      }
      let json;
      try { json = JSON.parse(result.body); } catch (e) {
        throw new ProviderError('bad-response', `${host} did not return JSON.`, String(result.body).slice(0, 1200));
      }
      const whole = { ...readWholeResponse(json, s.provider), timing: wholeTiming() };
      if (onText && whole.text) onText(whole.text, whole.text);
      return checkStopReason(whole, model, maxTokens);
    }

    let response;
    arm(FIRST_BYTE_TIMEOUT_MS);
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: timeout.signal
      });
    } catch (err) {
      if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled.');
      if (timedOut || err?.name === 'AbortError') {
        throw new ProviderError('timeout', `${model} did not answer in time.`);
      }
      // Being offline is the one case fetch's bare TypeError can be told apart
      // from — and the only one where the answer is neither the key nor CORS.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new ProviderError('offline', 'This device is offline.');
      }
      // Beyond that, fetch() rejects identically for a dead host and a CORS
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
      throw mapHttpError(response.status, body, host, {
        retryAfter: parseRetryAfter(response.headers?.get?.('retry-after'))
      });
    }

    // Streaming is the default, but a proxy that buffers the body away leaves
    // no reader — falling back keeps those setups working rather than failing
    // on a feature the user did not ask for.
    // Some proxies and test transports expose an SSE body even when the
    // request was buffered for native tool calls. Prefer the readable body
    // whenever JSON parsing is unavailable, so those transports keep the
    // same streaming-compatible behavior.
    if (response.body?.getReader && (request.body.stream || typeof response.json !== 'function')) {
      keepAlive();
      const out = await readStream(response, s.provider, onText, keepAlive, startedAt);
      if (timedOut) throw new ProviderError('timeout', `${model} stopped responding mid-answer.`);
      return checkStopReason(out, model, maxTokens);
    }
    const json = await response.json();
    const whole = { ...readWholeResponse(json, s.provider), timing: wholeTiming() };
    if (onText && whole.text) onText(whole.text, whole.text);
    return checkStopReason(whole, model, maxTokens);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * One completion over a thread of turns, retried when the failure is about
 * right now rather than about the request.
 *
 * @param {object}   opts
 * @param {string}   opts.system
 * @param {Array}    [opts.messages]   [{role: 'user'|'assistant', content}]
 * @param {string}   [opts.user]       sugar for a single user turn
 * @param {Function} [opts.onText]     called with (fullText, delta) as it streams
 * @param {Function} [opts.onRetry]    ({attempt, of, waitMs, error}) before each wait
 * @param {number}   [opts.maxRetries] defaults to the setting
 * @param {Function} [opts.sleep]      test seam; must reject on abort
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text, usage, model, stop, timing}>}
 */
export async function callModel({
  system, user, messages, onText, onRetry, signal,
  maxTokens = 4000, temperature = 0.7, maxRetries, sleep = delay, tools = []
} = {}) {
  const s = getStateMateSettings();
  if (!s.enabled) throw new ProviderError('disabled', 'StateMate is switched off.');
  if (!isStateMateReady(s)) throw new ProviderError('no-key', 'StateMate needs an API key.');

  const turns = Array.isArray(messages) && messages.length
    ? messages
    : [{ role: 'user', content: user ?? '' }];

  const budget = Math.max(0, Math.min(5, maxRetries ?? s.maxRetries ?? 0));
  const once = () => requestOnce({ system, turns, maxTokens, temperature, onText, signal, tools }, s);

  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await once();
    } catch (err) {
      const canRetry = attempt <= budget && isRetriableError(err) && !signal?.aborted;
      if (!canRetry) throw err;

      const waitMs = backoffMs(attempt, err.retryAfter || 0);
      // Announced, not silent: an eight-second stall with no explanation is
      // indistinguishable from a hang, and the user's only move is to give up
      // on a request that was about to succeed.
      if (onRetry) onRetry({ attempt, of: budget, waitMs, error: err });
      await sleep(waitMs, signal);
    }
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
    temperature: 0,
    // Someone watching a button wants the verdict, not a patient retry loop:
    // "rate-limited" is itself a useful answer to "is this configured".
    maxRetries: 0
  });
  return {
    ms: Date.now() - started,
    model: result.model || resolveEndpoint().model,
    text: (result.text || '').trim().slice(0, 40)
  };
}

// ══════════════════════════════════════════════════════════════════
//  MODEL DISCOVERY
// ══════════════════════════════════════════════════════════════════
//  Every provider here answers `GET /models` with the list of names its key
//  may actually use, so the model field does not have to be a spelling test.
//  Three dialects, the same shape as the completion endpoints: Anthropic and
//  the OpenAI-compatible crowd return `{data: [...]}`, Google returns
//  `{models: [...]}` with a `models/` prefix on every name, Cohere returns
//  `{models: [...]}` keyed by `name`.
//
//  A failure here is never fatal: the field stays a free-text input and the
//  list is a convenience over it. That is why listModels() throws a
//  ProviderError like everything else, and every caller in the UI swallows it.

/** Where the list lives, per dialect. */
function modelsRequest(s) {
  const { baseUrl } = resolveEndpoint(s);
  if (s.provider === 'anthropic') {
    return {
      url: `${baseUrl}/v1/models?limit=1000`,
      headers: {
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    };
  }
  if (s.provider === 'GoogleAiStudio') {
    // The key rides in the query string here rather than in a header, which is
    // Google's own convention for this API and the reason this is not simply
    // the generic branch below.
    const key = s.apiKey ? `?key=${encodeURIComponent(s.apiKey)}&pageSize=1000` : '?pageSize=1000';
    return { url: `${baseUrl}/models${key}`, headers: {} };
  }
  const headers = {};
  if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
  return { url: `${baseUrl}/models`, headers };
}

// Models that are not chat models at all. Offering an embedding or a
// text-to-speech model as something to build a DFA with is worse than offering
// nothing: the request fails at the provider with an error about the model.
const NOT_CHAT = /(embed|embedding|whisper|tts|audio-speech|dall-e|moderation|rerank|image-gen|imagen|veo|stable-diffusion)/i;

/**
 * What can read a picture, when nothing but the name is known.
 *
 * An ordered table rather than one alternation, because the interesting cases
 * are *exceptions*: o3 reads images and o3-mini does not, Llama 3.2 90B does
 * and 3.2 1B does not, Gemma 3 does and Gemma 3 1B does not. A flat regex
 * cannot say "this family, except these", so it got them wrong in both
 * directions — `o[34]-` tagged o3-mini as vision while leaving bare o3 and o1
 * as text, and `grok-[2-9]` claimed vision for every Grok when only Grok 4 and
 * the models with `vision` in the name have it.
 *
 * First match wins, so a narrower rule is written *above* the family rule it
 * carves out. `undefined` — no rule matched — is not "text only": it is
 * nobody having said, which is a distinction supportsImages needs to make.
 */
const VISION_RULES = [
  // ── what the name says outright ──
  // Above everything, because a model that describes itself outranks any
  // guess made from the family it belongs to — it is what keeps grok-2-vision
  // out of the Grok exception two rules below. The trailing class allows a
  // digit so deepseek-vl2 and its kind still read as what they say they are.
  [/(^|[-_./])(vl|vision|multimodal|omni)([-_./\d]|$)/i, true],

  // ── exceptions, each above the family rule it contradicts ──
  // The distilled o-series: same generation, no image input.
  [/(^|[-_./])o[13]-mini/i, false],
  // Llama 3.2 is two model families under one number; only 11B and 90B see.
  [/llama-?3[._]?2-(1b|3b)/i, false],
  [/gemma-3-1b/i, false],
  // GPT-4 as originally shipped, before turbo. `gpt-4o` and `gpt-4.1` are
  // other models entirely and must not be caught here.
  [/^gpt-4(-(?!turbo)|$)/i, false],
  // Grok gained image input at 4. The vision-named variants were taken by the
  // first rule, so this is safe to state flatly.
  [/grok-[23](-|$)/i, false],

  // ── families ──
  [/gpt-4o|chatgpt-4o|gpt-4\.|gpt-4-turbo|gpt-5/i, true],
  // o1, o3, o4 and whatever follows — the minis were taken out above.
  [/(^|[-_./])o[1-9](-|$)/i, true],
  [/claude-(3|4|5|opus|sonnet|haiku)/i, true],
  [/gemini|gemma-3/i, true],
  [/llama-?3[._]?2|llama-?4/i, true],
  [/pixtral|mistral-small-3\.[1-9]|mistral-medium-3/i, true],
  [/grok-([4-9]|\d\d)/i, true],
  [/glm-[\d.]*v(-|$)/i, true],
  [/llava|internvl|cogvlm|idefics|moondream|minicpm-v|nvlm|step-1v/i, true],
  [/phi-[\w.]*(vision|multimodal)/i, true]
];

/**
 * The name's verdict, or `undefined` when no rule covers it.
 * Exported for the tests: every pair in the table above is a claim about a
 * real model, and a claim is worth pinning.
 */
export function visionFromName(model) {
  const name = String(model || '');
  if (!name) return undefined;
  for (const [pattern, verdict] of VISION_RULES) if (pattern.test(name)) return verdict;
  return undefined;
}

/**
 * What the *listing* said about image input, or `undefined` if it did not say.
 *
 * A provider that states its modalities is the authority and always outranks
 * the name. Only OpenRouter's shape was read before, so every gateway that
 * publishes the fact in one of the other shapes was answered by guesswork.
 */
function listedVision(m) {
  const arch = m?.architecture || {};
  const mods = arch.input_modalities || m?.input_modalities || m?.modalities;
  if (Array.isArray(mods)) return mods.some(x => String(x).toLowerCase() === 'image');
  // OpenRouter's older single string, e.g. "text+image->text".
  if (typeof arch.modality === 'string') return /(^|\+)image(\+|-|$)/i.test(arch.modality);
  if (typeof m?.vision === 'boolean') return m.vision;
  const caps = m?.capabilities;
  if (Array.isArray(caps)) return caps.some(c => String(c).toLowerCase() === 'vision');
  if (caps && typeof caps.vision === 'boolean') return caps.vision;
  return undefined;
}

/**
 * Read one provider's list into `{id, label, vision}` rows.
 *
 * `vision` carries three answers, not two: true, false, and `undefined` for
 * "neither the listing nor the name table knows". Collapsing the third into
 * false made a model nobody had heard of indistinguishable from one known to
 * be text-only — which is how a local server that lists its models ended up
 * contradicting supportsImages' own rule that an unknown local name is
 * trusted.
 */
export function readModelList(json, provider) {
  const rows = [];
  const push = (id, label, vision) => {
    const name = String(id || '').trim();
    if (!name || NOT_CHAT.test(name)) return;
    rows.push({
      id: name,
      label: label && label !== name ? String(label) : '',
      // The listing when it said anything, the name table when it did not,
      // and undefined when neither could answer.
      vision: vision === undefined ? visionFromName(name) : !!vision
    });
  };

  // listedVision is asked on every branch rather than only on the one shape it
  // was written for: a gateway that publishes modalities is the authority
  // whichever dialect it speaks, and which dialect that is has nothing to do
  // with whether it says.
  if (provider === 'GoogleAiStudio') {
    (json?.models || []).forEach(m => {
      const methods = m?.supportedGenerationMethods || m?.supportedActions || [];
      if (methods.length && !methods.includes('generateContent')) return;
      push(String(m?.name || '').replace(/^models\//, ''), m?.displayName, listedVision(m));
    });
  } else if (Array.isArray(json?.models)) {
    // Cohere's shape, and the compatible servers that copied it.
    json.models.forEach(m => push(m?.name || m?.id, m?.display_name, listedVision(m)));
  } else {
    (json?.data || []).forEach(m => {
      push(m?.id || m?.name, m?.display_name || m?.name, listedVision(m));
    });
  }

  const seen = new Set();
  return rows
    .filter(r => (seen.has(r.id) ? false : seen.add(r.id)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// One list per endpoint, because the settings panel asks on open, on every
// provider change and on every keystroke in the model field.
const modelCache = new Map();

function modelCacheKey(s) {
  const { baseUrl } = resolveEndpoint(s);
  return `${s.provider} ${baseUrl} ${s.apiKey ? '1' : '0'}`;
}

/**
 * The models this key may use, or a ProviderError saying why not.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.refresh]  ignore the cache
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{id, label, vision}>>}
 */
export async function listModels({ refresh = false, signal, settings } = {}) {
  // The settings are a parameter because the panel asks about the endpoint
  // being *typed*, which has not been saved yet and must not be saved just to
  // populate a completion list.
  const s = settings || getStateMateSettings();
  const key = modelCacheKey(s);
  if (!refresh && modelCache.has(key)) return modelCache.get(key);

  const request = modelsRequest(s);
  const host = (() => {
    try { return new URL(request.url).host; } catch (e) { return request.url; }
  })();

  let bodyText = '';
  if (hasNativeTransport()) {
    let result;
    try {
      result = await window.electronAPI.statemateRequest({
        url: request.url, headers: request.headers, method: 'GET'
      });
    } catch (err) {
      throw new ProviderError('network', `Could not reach ${host}.`, String(err?.message || err));
    }
    bodyText = String(result.body || '');
    if (!result.ok) {
      if (!result.status) throw new ProviderError('network', `Could not reach ${host}.`, bodyText);
      throw mapHttpError(result.status, bodyText, host);
    }
  } else {
    let response;
    try {
      response = await fetch(request.url, { method: 'GET', headers: request.headers, signal });
    } catch (err) {
      if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled.');
      throw new ProviderError('network', `Your browser could not reach ${host}.`,
        providerConfig(s.provider).browserNote);
    }
    bodyText = await response.text().catch(() => '');
    if (!response.ok) throw mapHttpError(response.status, bodyText, host);
  }

  let json;
  try { json = JSON.parse(bodyText); } catch (e) {
    throw new ProviderError('bad-response', `${host} did not return a model list.`, bodyText.slice(0, 800));
  }

  const models = readModelList(json, s.provider);
  modelCache.set(key, models);
  return models;
}

/** Whatever a previous listModels() learnt, without asking again. */
export function cachedModels(s = getStateMateSettings()) {
  return modelCache.get(modelCacheKey(s)) || null;
}

export function clearModelCache() {
  modelCache.clear();
}

/**
 * Whether a model can be sent a picture.
 *
 * The listing is the authority when it said anything — OpenRouter and Google
 * both publish input modalities — and the name is the fallback. An unknown
 * name answers *true* for a local server, whose model names are arbitrary and
 * whose owner knows what they are running; elsewhere the hint list decides,
 * because silently accepting an attachment a hosted model will reject costs a
 * request and an error about a field the user cannot see.
 */
export function supportsImages(model = resolveEndpoint().model, s = getStateMateSettings()) {
  const name = String(model || '');
  if (!name) return false;
  const known = (modelCache.get(modelCacheKey(s)) || []).find(m => m.id === name);
  // A listed row only decides when it actually knows. `known.vision` being
  // undefined means the row is in the listing and nothing said what it can
  // read, which is the same state as a name that was never listed at all —
  // so it falls through to the same two answers below rather than being read
  // as a listed "no".
  if (known && known.vision !== undefined) return known.vision;
  const byName = visionFromName(name);
  if (byName !== undefined) return byName;
  return s.provider === 'compatible';
}
