// ══════════════════════════════════════════════════════════════════
//  JFLAP (.jff), WRITTEN
// ══════════════════════════════════════════════════════════════════
// The app reads JFLAP (js/import-jflap.js) and, until the command line, never
// wrote it. This is the other direction for the machines JFLAP has: finite
// automata, single-stack PDAs, one- and multi-tape Turing machines, Mealy and
// Moore. What JFLAP spells differently:
//
//   ε           an empty <read/> (and <pop/>, <push/>)
//   the blank   an empty <read/> or <write/> on a tape
//   the stay    S
//   Σ wildcard  expanded into one transition per symbol — JFLAP's own "~"
//               means something only 6.1 reads, and every version reads a list
//
// A block is written flat: its states are already in the machine, and JFLAP's
// block element needs a separate interior automaton this does not reconstruct.

import { CliError } from '../errors.mjs';

const TYPE = {
  DFA: 'fa', NFA: 'fa', 'ε-NFA': 'fa',
  DPDA: 'pda', NPDA: 'pda', PDA: 'pda',
  TM: 'turing', NDTM: 'turing', ITM: 'turing', MTM: 'turing',
  Mealy: 'mealy', Moore: 'moore'
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function jffText(target, { warn = () => {} } = {}) {
  const type = TYPE[target.machine];
  if (!type) throw new CliError(`JFLAP has no ${target.machine}. It holds finite automata, single-stack PDAs, Turing machines, Mealy and Moore machines.`);
  // JFLAP chooses a PDA's acceptance when it runs one, not in the file, so a
  // machine that accepts by empty stack reads back as accepting by final state.
  if (type === 'pda' && target.config?.pdaParadigm === 'empty') {
    warn('This PDA accepts by empty stack, which a .jff file cannot record: choose "empty stack" in JFLAP when you run it, and it reads back into the app as accepting by final state.');
  }
  const sym = target.config?.sym || {};
  const letters = [...new Set(target.sigma)].filter(s => s !== sym.eps && s !== sym.any);
  const gamma = [...new Set([...(target.stackAlpha || []), ...letters])].filter(s => s !== sym.any);
  const index = new Map(target.states.map((s, i) => [s.id, i]));
  const accepts = new Set(target.accepts || []);
  const cell = (tag, v, attrs = '') => (v === '' || v == null ? `<${tag}${attrs}/>` : `<${tag}${attrs}>${esc(v)}</${tag}>`);
  const blankOr = v => (v === sym.blank ? '' : v);
  const epsOr = v => (v === sym.eps ? '' : v);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?><!--Created with AutomataStudio.-->',
    '<structure>',
    `\t<type>${type}</type>`
  ];
  if (target.machine === 'MTM') lines.push(`\t<tapes>${target.tapeCount || 2}</tapes>`);
  lines.push('\t<automaton>');
  target.states.forEach((s, i) => {
    lines.push(`\t\t<state id="${i}" name="${esc(s.name ?? s.id)}">`);
    lines.push(`\t\t\t<x>${Math.round(s.x ?? 100 + i * 120)}.0</x>`, `\t\t\t<y>${Math.round(s.y ?? 100)}.0</y>`);
    if (s.id === target.startId) lines.push('\t\t\t<initial/>');
    if (accepts.has(s.id)) lines.push('\t\t\t<final/>');
    if (type === 'moore') lines.push(`\t\t\t${cell('output', s.output ?? '')}`);
    lines.push('\t\t</state>');
  });
  const expand = (v, universe) => (v === sym.any ? universe : [v]);
  for (const t of target.transitions) {
    const from = index.get(t.from), to = index.get(t.to);
    const body = [];
    if (type === 'turing' && target.machine === 'MTM') {
      const k = target.tapeCount || 2;
      for (let j = 0; j < k; j++) {
        body.push(cell('read', blankOr(t.tapeSyms?.[j]), ` tape="${j + 1}"`));
        body.push(cell('write', blankOr(t.tapeWrites?.[j]), ` tape="${j + 1}"`));
        body.push(`<move tape="${j + 1}">${t.tapeDirs?.[j] || 'S'}</move>`);
      }
      lines.push(edge(from, to, body));
      continue;
    }
    const universe = type === 'turing' ? gamma : letters;
    for (const a of expand(t.symbol, universe)) {
      const b = [];
      if (type === 'turing') {
        const w = t.write === sym.any ? a : t.write;
        b.push(cell('read', blankOr(a)), cell('write', blankOr(w)), `<move>${t.dir || 'S'}</move>`);
      } else if (type === 'pda') {
        b.push(cell('read', epsOr(a)), cell('pop', epsOr(t.pop)), cell('push', epsOr(t.push)));
      } else {
        b.push(cell('read', epsOr(a)));
        if (type === 'mealy') b.push(cell('transout', t.output ?? ''));
      }
      lines.push(edge(from, to, b));
    }
  }
  lines.push('\t</automaton>', '</structure>');
  return lines.join('\n') + '\n';
}

function edge(from, to, body) {
  return ['\t\t<transition>', `\t\t\t<from>${from}</from>`, `\t\t\t<to>${to}</to>`, ...body.map(b => `\t\t\t${b}`), '\t\t</transition>'].join('\n');
}
