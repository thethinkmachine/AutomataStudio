// mcp — the engine as Model Context Protocol tools, over stdio.
//
// JSON-RPC 2.0, one message per line on stdin and stdout (the MCP stdio
// transport). Nothing but protocol goes to stdout; anything else is stderr.
// Register it with an agent as a stdio server whose command is
// `automata mcp`.
import { createInterface } from 'node:readline';

import { App, APP_VERSION, getMachineConfig } from '../../js/state.js';
import { decideRaw, outputText } from '../../js/library/analyze.js';
import { readMachine, readMachineText, CliError } from '../io.mjs';
import { formatFor, serialize } from '../writers.mjs';
import { complement, determinize, epsilonFree, fromRegex, minimize, reverse, star } from '../fa.mjs';
import { infoOf, lintTarget } from './info.mjs';
import { compare } from './compare.mjs';
import { answerComparison, evaluate } from './ops.mjs';
import { traceSteps } from './run.mjs';
import { loadTuringMachines } from './tm.mjs';
import { decide as decideTm, METHOD_NAMES } from '../tm/core.mjs';
import { listAccepted } from '../fa.mjs';
import { wordOf } from '../out.mjs';

const MACHINE = {
  type: 'string',
  description: 'A machine: a file path (.automaton, .json, .jff, .hoa, .scxml, …), a machine code (fa.01:+AB_BA), a Turing machine in the standard notation (1RB1LB_1LA1RZ), or a whole .automaton document as JSON text.'
};

function machineOf(spec) {
  const s = String(spec ?? '').trim();
  if (!s) throw new CliError('No machine given.');
  if (s.startsWith('{') || s.startsWith('<') || /^HOA:/.test(s)) return readMachineText(s);
  return readMachine(s);
}

const docOf = t => JSON.parse(serialize(t, 'automaton'));

const TOOLS = {
  decide: {
    description: 'Decide words on a machine: accept, reject or unknown (no verdict within the step budget), plus a transducer\'s output. An ω-automaton reads u(v).',
    inputSchema: { type: 'object', properties: { machine: MACHINE, words: { type: 'array', items: { type: 'string' }, description: 'Words to decide; "" is the empty word.' } }, required: ['machine', 'words'] },
    run: ({ machine, words }) => {
      const { target } = machineOf(machine);
      return words.map(w => {
        const r = decideRaw(target, w);
        return { word: w, verdict: { acc: 'accept', rej: 'reject', unk: 'unknown', err: 'error' }[r.verdict], ...(r.output != null ? { output: outputText(r.output) } : {}), ...(r.error ? { error: r.error.replace(/<[^>]+>/g, '') } : {}) };
      });
    }
  },
  info: {
    description: 'What a machine is: type, language class, size, alphabets, start and accepting states, determinism; for finite automata the minimal DFA size, emptiness/finiteness/universality and a regex; the machine code that names it.',
    inputSchema: { type: 'object', properties: { machine: MACHINE }, required: ['machine'] },
    run: ({ machine }) => { const { target, doc } = machineOf(machine); return infoOf(target, doc); }
  },
  lint: {
    description: 'Problems in a machine: unreachable or dead states, symbols outside Σ, duplicate edges, a deterministic type that branches, a weak automaton whose SCCs straddle F, and more.',
    inputSchema: { type: 'object', properties: { machine: MACHINE }, required: ['machine'] },
    run: ({ machine }) => lintTarget(machineOf(machine).target)
  },
  equiv: {
    description: 'Whether two machines accept the same language. Exact for finite automata (with the shortest word they disagree on); bounded for everything else, and says so.',
    inputSchema: { type: 'object', properties: { a: MACHINE, b: MACHINE, max_length: { type: 'integer' } }, required: ['a', 'b'] },
    run: ({ a, b, max_length }) => {
      const r = compare(machineOf(a).target, machineOf(b).target, { maxLength: max_length ?? 8 });
      const word = r.tokens ? wordOf(r.tokens, App.config.sym.eps) : r.u ? `${wordOf(r.u, '')}(${wordOf(r.v, '')})` : null;
      return { equal: r.equal, exact: r.method === 'exact', method: r.method, counterexample: r.equal === false ? word : null };
    }
  },
  transform: {
    description: 'A finite-automaton construction: determinize, minimize, complement, reverse, star or eps-elim. Returns the new machine as an .automaton document.',
    inputSchema: { type: 'object', properties: { machine: MACHINE, op: { type: 'string', enum: ['determinize', 'minimize', 'complement', 'reverse', 'star', 'eps-elim'] } }, required: ['machine', 'op'] },
    run: ({ machine, op }) => {
      const t = machineOf(machine).target;
      const f = { determinize, minimize, complement, reverse, star, 'eps-elim': epsilonFree }[op];
      if (!f) throw new CliError(`Unknown op ${op}.`);
      return docOf(f(t));
    }
  },
  from_regex: {
    description: 'A regular expression → an ε-NFA by Thompson\'s construction (syntax: | concatenation * + ? {n,m} [a-z] . ε), optionally minimized. Returns an .automaton document.',
    inputSchema: { type: 'object', properties: { regex: { type: 'string' }, sigma: { type: 'string', description: 'The alphabet for . and [^…], e.g. "ab".' }, minimize: { type: 'boolean' } }, required: ['regex'] },
    run: ({ regex, sigma, minimize: min }) => {
      let t = fromRegex(regex, { sigma: sigma ? [...sigma] : null });
      if (min) t = minimize(t);
      return docOf(t);
    }
  },
  eval: {
    description: 'Evaluate an expression over finite automata: ~ complement, * star, . concat, & intersect, \\ difference, | union, functions min det comp rev eps, /regex/ literals. With ==, !=, <= or >= at the top it answers true/false with a counterexample.',
    inputSchema: { type: 'object', properties: { expression: { type: 'string' }, bindings: { type: 'object', additionalProperties: MACHINE, description: 'Names used in the expression → machines.' } }, required: ['expression'] },
    run: ({ expression, bindings = {} }) => {
      const env = new Map(Object.entries(bindings).map(([k, v]) => [k, machineOf(v).target]));
      const r = evaluate(expression, env);
      if (!r.cmp) return docOf(r);
      const a = answerComparison(r);
      return { holds: a.ok, counterexample: a.word ? wordOf(a.word, App.config.sym.eps) : null };
    }
  },
  convert: {
    description: 'Write a machine in another format: automaton, jff, hoa, ba, timbuk, code, standard, svg, dot, tikz, table-csv, table-md, code-js, code-py, code-java, code-c, code-xstate, code-scxml, test-jest, test-pytest, samples, coverage.',
    inputSchema: { type: 'object', properties: { machine: MACHINE, to: { type: 'string' } }, required: ['machine', 'to'] },
    run: ({ machine, to }) => { const { target, doc } = machineOf(machine); return serialize(target, formatFor(to), { doc }); }
  },
  trace: {
    description: 'The run the player would show on a word, step by step: states, what each step did, and the tape, stack, unread input or output.',
    inputSchema: { type: 'object', properties: { machine: MACHINE, word: { type: 'string' }, limit: { type: 'integer' } }, required: ['machine', 'word'] },
    run: ({ machine, word, limit }) => traceSteps(machineOf(machine).target, word, limit ?? 100)
  },
  words: {
    description: 'The shortest accepted words of a finite automaton, in shortlex order.',
    inputSchema: { type: 'object', properties: { machine: MACHINE, max_length: { type: 'integer' }, limit: { type: 'integer' } }, required: ['machine'] },
    run: ({ machine, max_length, limit }) => listAccepted(machineOf(machine).target, max_length ?? 8, limit ?? 30).map(w => wordOf(w, App.config.sym.eps))
  },
  halts: {
    description: 'Whether a deterministic one-tape Turing machine halts from a blank tape, with the method that proved it (simulation, cycler, translated cycler, backward reasoning, closed position set, busy beaver bound) — or unknown, with how fast its tape grows.',
    inputSchema: { type: 'object', properties: { machine: MACHINE, budget: { type: 'integer' } }, required: ['machine'] },
    run: ({ machine, budget }) => {
      const [it] = loadTuringMachines([String(machine)]);
      if (!it?.p) throw new CliError(it?.error || 'Not a Turing machine.');
      const v = decideTm(it.p, { budget: budget ?? 1e6, growth: true });
      return { verdict: v.verdict, method: v.method ? METHOD_NAMES[v.method] : null, steps: v.steps, growth: v.growth ? v.growth.say : undefined };
    }
  }
};

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

export async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'automata', title: 'AutomataStudio', version: APP_VERSION },
        instructions: 'Tools over the AutomataStudio engine: decide words, inspect, lint, compare, transform and convert automata, and classify Turing machines. Machines are passed as file paths, machine codes, standard TM notation, or .automaton JSON text.'
      };
    case 'ping': return {};
    case 'tools/list':
      return { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) };
    case 'tools/call': {
      const tool = TOOLS[params.name];
      if (!tool) throw Object.assign(new Error(`Unknown tool ${params.name}`), { rpc: -32602 });
      try {
        const out = tool.run(params.arguments || {});
        const text = typeof out === 'string' ? out : JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
        return { content: [{ type: 'text', text }], isError: false };
      } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
    default:
      if (isNotification) return undefined;
      throw Object.assign(new Error(`Method not found: ${method}`), { rpc: -32601 });
  }
}

const mcp = {
  usage: `automata mcp

Serves the engine over the Model Context Protocol on stdin/stdout, for an AI
agent to call. Tools: ${Object.keys(TOOLS).join(', ')}.

  claude mcp add automata -- automata mcp`,
  options: {},
  async run() {
    process.env.AUTOMATA_KEEP_ALIVE = '1';
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
      try {
        const result = await handle(msg);
        if (msg.id !== undefined && msg.id !== null && result !== undefined) reply(msg.id, result);
      } catch (e) {
        if (msg.id !== undefined && msg.id !== null) fail(msg.id, e.rpc || -32603, e.message);
      }
    }
    return 0;
  }
};

export const commands = { mcp };
export { TOOLS };
