// words, profile — the language as a list, and the cost of deciding it.
import { aMachine } from '../grammar.mjs';
import { App, getMachineConfig } from '../../js/state.js';
import { withMachine } from '../../js/exercise/grade.js';
import { decideRaw } from '../../js/library/analyze.js';
import { growthEstimate, profileCSV, profileRun } from '../../js/complexity.js';
import { spaceTimeKind } from '../../js/spacetime-ui.js';
import { readMachine, CliError } from '../io.mjs';
import { FA_TYPES, countByLength, lettersOf, listAccepted, sampleAccepted, seeded } from '../fa.mjs';
import { c, print, printJson, table, wordOf } from '../out.mjs';

function* shortlex(sigma, maxLen) {
  let level = [[]];
  for (let len = 0; len <= maxLen; len++) {
    for (const w of level) yield w;
    if (len === maxLen) break;
    const next = [];
    for (const w of level) for (const a of sigma) next.push([...w, a]);
    level = next;
  }
}

const words = {
  usage: `automata words <machine>

The accepted words, shortest first. For a finite automaton this walks its DFA,
so it is exact and fast; anything else is run word by word up to --max-len.

  --max-len N       longest word (default 8)
  --limit N         at most N words (default 50)
  --rejected        list the rejected words instead
  --count           how many words of each length are accepted (finite
                    automata: exact, any length, by dynamic programming)
  --sample N        N accepted words of length --len, uniformly at random
  --len L           the length for --sample (default --max-len)
  --seed S          make --sample repeatable
  --json`,
  options: {
    'max-len': { type: 'string' }, limit: { type: 'string' }, rejected: { type: 'boolean' }, count: { type: 'boolean' },
    sample: { type: 'string' }, len: { type: 'string' }, seed: { type: 'string' }
  },
  async run({ args, opts }) {
    const { target } = readMachine(args[0] ?? '-');
    const maxLen = Number(opts['max-len'] ?? 8);
    const limit = Number(opts.limit ?? 50);
    const eps = App.config.sym.eps;
    const fa = FA_TYPES.has(target.machine);
    const cfg = getMachineConfig(target.machine) || {};
    if (cfg.isOmega) throw new CliError('An ω-automaton accepts infinite words, which cannot be listed one by one. Use run with u(v) words, or equiv.');
    if (cfg.isTransducer && !target.config?.transducerAccepts) {
      throw new CliError(`${aMachine(target.machine, true)} has no accept/reject verdict here — it maps words to outputs. Use run to see them, or turn on acceptance in the machine's settings.`);
    }

    if (opts.count) {
      let counts;
      if (fa) counts = countByLength(target, maxLen);
      else {
        counts = Array(maxLen + 1).fill(0n);
        for (const w of shortlex(lettersOf(target), maxLen)) if (decideRaw(target, w.join(' ')).verdict === 'acc') counts[w.length]++;
      }
      const sigma = lettersOf(target).length;
      if (opts.json) printJson(counts.map((n, len) => ({ length: len, accepted: n, of: BigInt(sigma) ** BigInt(len) })));
      else print(table(counts.map((n, len) => [String(len), n.toString(), c.dim(`of ${(BigInt(sigma) ** BigInt(len)).toString()}`)]), { head: ['length', 'accepted', ''] }));
      return 0;
    }

    if (opts.sample !== undefined) {
      if (!fa) throw new CliError('Uniform sampling needs a finite automaton (it counts words through the DFA).');
      const len = Number(opts.len ?? maxLen);
      const rnd = opts.seed !== undefined ? seeded(opts.seed) : Math.random;
      const { total, words: ws } = sampleAccepted(target, len, Number(opts.sample), rnd);
      if (opts.json) printJson({ length: len, accepted: total, words: ws.map(w => wordOf(w, eps)) });
      else {
        if (!total) print(c.yellow(`No word of length ${len} is accepted.`));
        ws.forEach(w => print(wordOf(w, eps)));
      }
      return total ? 0 : 1;
    }

    let list;
    if (fa && !opts.rejected) list = listAccepted(target, maxLen, limit);
    else {
      list = [];
      for (const w of shortlex(lettersOf(target), maxLen)) {
        const v = decideRaw(target, w.join(' ')).verdict;
        if ((opts.rejected ? v === 'rej' : v === 'acc')) list.push(w);
        if (list.length >= limit) break;
      }
    }
    if (opts.json) printJson(list.map(w => wordOf(w, eps)));
    else if (!list.length) process.stderr.write(c.yellow(`No ${opts.rejected ? 'rejected' : 'accepted'} word up to length ${maxLen}.\n`));
    else list.forEach(w => print(wordOf(w, eps)));
    return 0;
  }
};

const profile = {
  usage: `automata profile <machine>

Runs the machine on inputs of length --from … --to and measures each run:
steps, and space (cells visited on a tape, the tallest the store got on a
stack). Prints the Complexity section's CSV — worst and mean per length — and
a growth estimate for each. An estimate from a few lengths, not a proof.

  --from N --to N     lengths (default 1 … 12)
  --family PATTERN    one word per length from a pattern: a^n b^n, (ab)^{2n}, 1^n+1^n
  --cap N             words per length when sampling Σⁿ (default 64)
  --json`,
  options: { from: { type: 'string' }, to: { type: 'string' }, family: { type: 'string' }, cap: { type: 'string' } },
  async run({ args, opts }) {
    const { target } = readMachine(args[0] ?? '-');
    const kind = withMachine(target, () => spaceTimeKind(target.machine));
    if (kind !== 'tape' && kind !== 'store') throw new CliError(`${aMachine(target.machine, true)} has no tape or store whose run length is worth profiling; its run is as long as its input.`);
    const plan = {
      mode: opts.family ? 'family' : 'all', pattern: opts.family || '',
      from: Number(opts.from ?? 1), to: Number(opts.to ?? 12), cap: Number(opts.cap ?? 64),
      space: kind === 'store' ? 'store' : 'cells', symbols: lettersOf(target)
    };
    const rows = [];
    withMachine(target, () => {
      let gen;
      try { gen = profileRun(target.machine, plan); }
      catch (e) { throw new CliError(e.message); }
      for (const step of gen) if (step.done) rows.push({ ...step.row, verdicts: { ...step.row.verdicts } });
    });
    // Words the machine cannot read are counted, not measured; when that is
    // every word, the profile is empty for a reason the reader has to hear.
    if (rows.length && rows.every(r => !r.count)) {
      const why = rows.find(r => r.error)?.error?.replace(/<[^>]+>/g, '') || 'no word could be run';
      throw new CliError(`No input could be measured: ${why}`);
    }
    const spaceName = kind === 'store' ? 'store' : 'cells';
    const growth = metric => growthEstimate(rows.filter(r => r.count).map(r => ({
      n: r.n, v: metric === 'steps' ? r.worst : r.spaceWorst, limited: r.limited > 0
    })));
    const gs = growth('steps'), gp = growth('space');
    if (opts.json) {
      printJson({ rows, growth: { steps: gs, space: gp }, space: spaceName });
      return 0;
    }
    process.stdout.write(profileCSV(rows, spaceName) + '\n');
    process.stderr.write(`${c.bold('steps')}  ${gs ? `${gs.label} — ${gs.detail}` : 'too few points to say'}\n`);
    process.stderr.write(`${c.bold(spaceName)}  ${gp ? `${gp.label} — ${gp.detail}` : 'too few points to say'}\n`);
    if (rows.some(r => r.limited)) process.stderr.write(c.yellow('Some runs hit the step budget; their values are lower bounds and were left out of the estimate. Raise --max-steps.\n'));
    return 0;
  }
};

export const commands = { words, profile };
