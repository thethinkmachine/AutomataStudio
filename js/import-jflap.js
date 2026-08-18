import { snapshot } from './history.js';
import { CARD_BLURB_MAX, loadData, normalizeCardMeta, validateSchema } from './persistence.js';
import { App, getMachineConfig } from './state.js';
import { Change, emit } from './store.js';
import { hasPdaNondeterminism, isAnyTM, hasSingleTapeNondeterminism, performClear, showStatus } from './utils.js';

// ══════════════════════════════════════════════════════════════════
//  JFLAP IMPORT  (.jff)
// ══════════════════════════════════════════════════════════════════
//  JFLAP is the tool most automata courses already run on, and its
//  files are the format existing assignment banks are written in.
//  Reading them is what lets an instructor bring a decade of material
//  across instead of redrawing it.
//
//  The XML reader below is deliberately small and local rather than
//  DOMParser-based. .jff is machine-written and extremely regular — no
//  namespaces, no mixed content, no processing instructions past the
//  declaration — so a focused reader covers it, works identically in
//  Node and the browser, and keeps the conversion testable without a
//  DOM. Anything it cannot parse fails loudly in jflapToWorkspace()
//  rather than silently importing half a machine.
// ══════════════════════════════════════════════════════════════════

export const JFLAP_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function jflapDecode(str) {
  return String(str).replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X'
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return JFLAP_ENTITIES[ent] !== undefined ? JFLAP_ENTITIES[ent] : m;
  });
}

export function jflapParseAttrs(src) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1]] = jflapDecode(m[3] !== undefined ? m[3] : m[4]);
  return attrs;
}

/** @returns {{tag:string, attrs:object, children:Array, text:string}} synthetic root */
export function jflapParseXML(src) {
  const clean = String(src)
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  const tagRe = /<\s*(\/)?\s*([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?\s*>/g;
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let last = 0, m;

  while ((m = tagRe.exec(clean))) {
    const between = clean.slice(last, m.index);
    if (between) stack[stack.length - 1].text += between;
    last = m.index + m[0].length;

    const [, closing, name, attrStr, selfClose] = m;
    if (closing) {
      // Tolerate a stray close tag rather than unwinding past the root.
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { tag: name, attrs: jflapParseAttrs(attrStr || ''), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

export function jflapChild(node, tag) {
  if (!node) return null;
  return node.children.find(c => c.tag === tag) || null;
}
export function jflapChildren(node, tag) {
  if (!node) return [];
  return node.children.filter(c => c.tag === tag);
}
/** Text of a child element, entity-decoded and trimmed. null when absent. */
export function jflapText(node, tag) {
  const c = jflapChild(node, tag);
  return c ? jflapDecode(c.text).trim() : null;
}
/** True when the child element exists at all — JFLAP's flags are empty tags. */
export function jflapFlag(node, tag) {
  return !!jflapChild(node, tag);
}

// ── conversion ────────────────────────────────────────────────────
// JFLAP writes an omitted symbol as an empty <read/>; that is its lambda.
export function jflapSymbol(raw, eps) {
  return raw === null || raw === '' ? eps : raw;
}

// ── JFLAP 6.1 variable transitions ────────────────────────────────
//  6.1 added a shorthand 4.x has no notion of: a <read> may name a set
//  of symbols bound to a variable, written "y, a } w", and the matching
//  <write>w</write> then means "put back whatever you just read". A
//  single edge therefore stands for one transition per listed symbol.
//
//  This has to be expanded at import rather than modelled, because the
//  app has no variable binding: the symbol on a transition is a symbol.
//  Left unexpanded the whole string imports as one 8-character tape
//  symbol that no tape cell can ever hold — the edge draws, the machine
//  reads, and it silently rejects everything. Expanding is the faithful
//  reading and the only one that runs.
//
//  The negated form, "! a, b } w", means "any symbol except these".
//  That needs an alphabet to subtract from, which is not known until
//  every transition has been read, so it is returned as a marker and
//  resolved by the caller once Σ/Γ are complete.

/**
 * Parses a JFLAP 6.1 <read> body.
 * @returns {{kind:'plain', symbol:string}
 *          |{kind:'set', symbols:string[], variable:string}
 *          |{kind:'not', symbols:string[], variable:string}}
 */
export function jflapParseRead(raw) {
  const str = raw === null || raw === undefined ? '' : String(raw).trim();
  const brace = str.indexOf('}');
  if (brace === -1) return { kind: 'plain', symbol: str };

  const variable = str.slice(brace + 1).trim();
  let list = str.slice(0, brace).trim();
  // A leading "!" negates the set: match anything the list does not name.
  const negated = list.startsWith('!');
  if (negated) list = list.slice(1).trim();

  const symbols = list.split(',').map(t => t.trim()).filter(t => t !== '');
  // "} w" with nothing to its left binds nothing — not a variable form.
  if (!symbols.length || !variable) return { kind: 'plain', symbol: str };

  return { kind: negated ? 'not' : 'set', symbols, variable };
}

/**
 * True when `write` writes the variable `read` bound, i.e. copies the
 * symbol through unchanged. Any other write is a constant for every
 * expanded branch.
 */
export function jflapWritesVariable(write, variable) {
  return write !== null && write !== undefined && String(write).trim() === variable;
}

// JFLAP stack symbols are single characters and a <push> is a *string* of
// them — "AZ" pushes A then Z, it is not a symbol named "AZ". So Γ takes
// the characters and never the whole string; adding both put the push
// string itself into the stack alphabet, where nothing can ever match it.
export function addStackSymbols(str, into) {
  [...String(str)].forEach(c => into.add(c));
  return into;
}

// The structures JFLAP writes that carry no <automaton>. Each gets its own
// sentence, because "no <automaton> element" tells a user who exported a
// regular expression nothing about what went wrong.
export const UNSUPPORTED_TYPES = {
  grammar: 'JFLAP grammar files are not supported — only automata (fa, pda, turing, moore, mealy).',
  re: 'JFLAP regular-expression files are not supported — only automata (fa, pda, turing, moore, mealy).',
  regular: 'JFLAP regular-expression files are not supported — only automata (fa, pda, turing, moore, mealy).',
  pumping: 'JFLAP pumping-lemma files are not supported — only automata (fa, pda, turing, moore, mealy).',
  pumpinglemma: 'JFLAP pumping-lemma files are not supported — only automata (fa, pda, turing, moore, mealy).'
};

/**
 * Converts a parsed .jff tree into the workspace shape loadData() takes.
 * Throws on anything structurally unusable so the caller can report it.
 */
export function jflapToWorkspace(root, symOverride) {
  const sym = symOverride || App.config.sym;
  const structure = jflapChild(root, 'structure');
  if (!structure) throw new Error('Not a JFLAP file — no <structure> element.');

  const type = (jflapText(structure, 'type') || '').toLowerCase();
  const automaton = jflapChild(structure, 'automaton');
  if (!automaton) throw new Error(UNSUPPORTED_TYPES[type] || 'Not a JFLAP automaton — no <automaton> element.');

  const warnings = [];

  const rawStates = jflapChildren(automaton, 'state').concat(jflapChildren(automaton, 'block'));
  if (!rawStates.length) throw new Error('This JFLAP file contains no states.');

  // A <block> is a state whose interior is another whole automaton. That
  // interior cannot be flattened without inlining and renaming its states,
  // so it imports as a plain state — say so rather than lose it quietly.
  const blockCount = jflapChildren(automaton, 'block').length;
  if (blockCount) {
    warnings.push(`${blockCount} building block${blockCount > 1 ? 's' : ''} imported as plain states — their contents were not expanded.`);
  }

  // JFLAP ids are numeric and reused across files; map them onto fresh
  // internal ids so an import can never collide with existing state ids.
  const idMap = new Map();
  const states = rawStates.map((s, i) => {
    const jid = s.attrs.id !== undefined ? s.attrs.id : String(i);
    const id = 's' + i;
    idMap.set(String(jid), id);
    const x = parseFloat(jflapText(s, 'x'));
    const y = parseFloat(jflapText(s, 'y'));
    const state = {
      id,
      name: s.attrs.name || jflapText(s, 'name') || ('q' + jid),
      x: Number.isFinite(x) ? x : 120 + (i % 6) * 140,
      y: Number.isFinite(y) ? y : 120 + Math.floor(i / 6) * 140
    };
    const output = jflapText(s, 'output');
    if (output !== null) state.output = output;
    return { state, node: s };
  });

  let startId = null;
  let initialCount = 0;
  const accepts = [];
  states.forEach(({ state, node }) => {
    if (jflapFlag(node, 'initial')) {
      initialCount++;
      if (startId === null) startId = state.id;
    }
    if (jflapFlag(node, 'final')) accepts.push(state.id);
  });
  if (initialCount > 1) {
    warnings.push(`File declares ${initialCount} initial states — kept the first, dropped ${initialCount - 1}.`);
  }

  const sigma = new Set();
  const stackAlpha = new Set();
  const outputAlpha = new Set();
  let maxTape = 1;
  let sawEpsilonRead = false;
  // Negated variable reads ("! a, b } w") cannot be expanded until the whole
  // alphabet is known, so they are parked here and resolved in a second pass.
  const deferred = [];
  let variableEdges = 0;

  const transitions = jflapChildren(automaton, 'transition').flatMap((t, i) => {
    const from = idMap.get(String(jflapText(t, 'from')));
    const to = idMap.get(String(jflapText(t, 'to')));
    if (!from || !to) throw new Error(`Transition ${i + 1} refers to a state that is not in the file.`);

    const tr = { id: 't' + i, from, to };

    // Multi-tape Turing machines repeat <read>/<write>/<move> with a tape
    // attribute; single-tape files omit it entirely.
    const reads = jflapChildren(t, 'read');
    const tapedReads = reads.filter(r => r.attrs.tape !== undefined);

    if (tapedReads.length > 1) {
      const writes = jflapChildren(t, 'write');
      const moves = jflapChildren(t, 'move');
      const byTape = arr => {
        const out = [];
        arr.forEach(n => { out[(parseInt(n.attrs.tape, 10) || 1) - 1] = jflapDecode(n.text).trim(); });
        return out;
      };
      const rs = byTape(tapedReads), ws = byTape(writes), ms = byTape(moves);
      maxTape = Math.max(maxTape, rs.length);
      tr.tapeSyms = rs.map(v => jflapSymbol(v === undefined ? '' : v, sym.blank));
      tr.tapeWrites = ws.map((v, k) => jflapSymbol(v === undefined ? '' : v, tr.tapeSyms[k]));
      tr.tapeDirs = rs.map((_, k) => (ms[k] || 'S').toUpperCase());
      tr.symbol = tr.tapeSyms[0];
      tr.write = tr.tapeWrites[0];
      tr.dir = tr.tapeDirs[0];
      tr.tapeSyms.forEach(s => { if (s !== sym.blank) sigma.add(s); stackAlpha.add(s); });
      tr.tapeWrites.forEach(s => stackAlpha.add(s));
    } else {
      const read = jflapText(t, 'read');
      const write = jflapText(t, 'write');
      const move = jflapText(t, 'move');
      const isTape = write !== null || move !== null;

      // JFLAP 6.1's variable form stands for one transition per listed
      // symbol; expand it here so what runs is what the file means.
      const parsed = jflapParseRead(read);
      if (parsed.kind !== 'plain') {
        variableEdges++;
        const dir = (move || 'S').toUpperCase();
        const copies = jflapWritesVariable(write, parsed.variable);
        const spec = {
          from, to, dir, isTape, copies,
          write: copies ? null : write,
          variable: parsed.variable,
          transout: jflapText(t, 'transout'),
          pop: jflapText(t, 'pop'),
          push: jflapText(t, 'push')
        };
        if (parsed.kind === 'not') {
          // Resolved once Σ is complete — see the second pass below.
          deferred.push({ ...spec, exclude: parsed.symbols, index: i });
          return [];
        }
        return parsed.symbols.map((symbol, k) => {
          const out = { id: `t${i}_${k}`, from, to, symbol };
          if (isTape) {
            out.write = copies ? symbol : jflapSymbol(spec.write, symbol);
            out.dir = dir;
            stackAlpha.add(out.symbol);
            stackAlpha.add(out.write);
            if (out.symbol !== sym.blank) sigma.add(out.symbol);
          } else {
            sigma.add(symbol);
          }
          if (spec.transout !== null) {
            out.output = spec.transout;
            if (spec.transout) outputAlpha.add(spec.transout);
          }
          if (spec.pop !== null || spec.push !== null) {
            out.pop = jflapSymbol(spec.pop, sym.eps);
            out.push = jflapSymbol(spec.push, sym.eps);
            if (out.pop !== sym.eps) addStackSymbols(out.pop, stackAlpha);
            if (out.push !== sym.eps) addStackSymbols(out.push, stackAlpha);
          }
          return out;
        });
      }

      tr.symbol = jflapSymbol(read, sym.eps);
      if (read === null || read === '') sawEpsilonRead = true;

      if (isTape) {
        tr.symbol = jflapSymbol(read, sym.blank);
        tr.write = jflapSymbol(write, tr.symbol);
        tr.dir = (move || 'S').toUpperCase();
        stackAlpha.add(tr.symbol);
        stackAlpha.add(tr.write);
        if (tr.symbol !== sym.blank) sigma.add(tr.symbol);
      } else {
        if (tr.symbol !== sym.eps) sigma.add(tr.symbol);
      }

      const pop = jflapText(t, 'pop');
      const push = jflapText(t, 'push');
      if (pop !== null || push !== null) {
        tr.pop = jflapSymbol(pop, sym.eps);
        tr.push = jflapSymbol(push, sym.eps);
        if (tr.pop !== sym.eps) addStackSymbols(tr.pop, stackAlpha);
        if (tr.push !== sym.eps) addStackSymbols(tr.push, stackAlpha);
      }

      const transout = jflapText(t, 'transout');
      if (transout !== null) {
        tr.output = transout;
        if (transout) outputAlpha.add(transout);
      }
    }
    return [tr];
  });

  // Second pass: "! a, b } w" means every symbol the machine uses except
  // those. The alphabet is only complete now, so the subtraction happens
  // here rather than inline.
  deferred.forEach(spec => {
    const universe = [...(spec.isTape ? stackAlpha : sigma)]
      .filter(c => c !== sym.eps && c !== sym.blank && !spec.exclude.includes(c));
    universe.forEach((symbol, k) => {
      const out = { id: `t${spec.index}_n${k}`, from: spec.from, to: spec.to, symbol };
      if (spec.isTape) {
        out.write = spec.copies ? symbol : jflapSymbol(spec.write, symbol);
        out.dir = spec.dir;
        stackAlpha.add(out.write);
      }
      if (spec.transout !== null) {
        out.output = spec.transout;
        if (spec.transout) outputAlpha.add(spec.transout);
      }
      if (spec.pop !== null || spec.push !== null) {
        out.pop = jflapSymbol(spec.pop, sym.eps);
        out.push = jflapSymbol(spec.push, sym.eps);
        if (out.pop !== sym.eps) addStackSymbols(out.pop, stackAlpha);
        if (out.push !== sym.eps) addStackSymbols(out.push, stackAlpha);
      }
      transitions.push(out);
    });
    if (!universe.length) {
      warnings.push(`A "! ${spec.exclude.join(', ')}" transition matched no symbols and was dropped.`);
    }
  });

  if (variableEdges) {
    warnings.push(`${variableEdges} JFLAP 6.1 variable transition${variableEdges > 1 ? 's' : ''} expanded into explicit symbols.`);
  }

  states.forEach(({ state }) => {
    if (state.output !== undefined && state.output !== '') outputAlpha.add(state.output);
  });

  // A multi-tape file states its tape count; the widest transition is only
  // a lower bound, so a 3-tape machine whose edges touch 2 stays 3-tape.
  // This has to be known before the type is decided, or such a file reads
  // as a single-tape TM.
  const declaredTapes = parseInt(jflapText(automaton, 'tapes') || jflapText(structure, 'tapes'), 10);
  const tapes = Math.max(maxTape, Number.isFinite(declaredTapes) ? declaredTapes : 1);

  const machine = jflapMachineType(type, {
    transitions, sawEpsilonRead, maxTape: tapes,
    hasOutputStates: states.some(({ state }) => state.output !== undefined)
  });

  if (machine === 'DPDA' || machine === 'NPDA') stackAlpha.add(sym.stackBottom);
  if (machine === 'TM' || machine === 'NDTM' || machine === 'MTM') stackAlpha.add(sym.blank);

  // JFLAP lets a PDA accept by empty stack instead of by final state. This
  // app models final-state acceptance only, so an empty-stack file would
  // otherwise import looking correct and decide a different language.
  if (machine === 'DPDA' || machine === 'NPDA') {
    const mode = (jflapText(structure, 'acceptance') || '').toLowerCase();
    if (mode.includes('stack')) {
      warnings.push('This PDA accepts by empty stack in JFLAP; it was imported as final-state acceptance, which may decide a different language.');
    } else if (!accepts.length) {
      warnings.push('This PDA has no final states — it likely accepts by empty stack in JFLAP, which this app does not model.');
    }
  }

  return {
    machine,
    sigma: [...sigma],
    stackAlpha: [...stackAlpha],
    outputAlpha: [...outputAlpha],
    tapeCount: machine === 'MTM' ? tapes : (machine === 'TM' || machine === 'NDTM' ? 1 : 2),
    states: states.map(s => s.state),
    transitions,
    startId,
    accepts,
    notes: [],
    dividers: [],
    // JFLAP's tape is two-way infinite, unconditionally and for every one of
    // its Turing machines. That is a fact about the file, not a guess about
    // the machine in it, so it is carried as the tape setting rather than
    // detected from the transitions or answered by picking a machine type.
    // A .jff never needs the bounded tape, so there is nothing to infer.
    twoWayTape: isAnyTM(machine) && machine !== 'LBA',
    warnings
  };
}

// JFLAP's <type> only distinguishes families ("fa"), not the determinism
// the app models as separate machine types, so the specific type is read
// off the transitions the same way loadData() does for its own files.
export function jflapMachineType(type, info) {
  const { transitions, sawEpsilonRead, maxTape, hasOutputStates } = info;
  if (type === 'moore') return 'Moore';
  if (type === 'mealy') return 'Mealy';
  if (type === 'turing' || type === 'turingmachine') {
    if (maxTape > 1) return 'MTM';
    return hasSingleTapeNondeterminism(transitions) ? 'NDTM' : 'TM';
  }
  if (type === 'pda' || type === 'pushdown') {
    return hasPdaNondeterminism(transitions) ? 'NPDA' : 'DPDA';
  }
  // "fa" and anything unrecognised but shaped like one.
  if (hasOutputStates) return 'Moore';
  if (sawEpsilonRead) return 'ε-NFA';
  return hasSingleTapeNondeterminism(transitions) ? 'NFA' : 'DFA';
}

// ── entry point ───────────────────────────────────────────────────
export function importJFLAPText(text) {
  const data = jflapToWorkspace(jflapParseXML(text));
  validateSchema(data);
  performClear();
  loadData(data);

  // Conversion caveats go on the machine card rather than into the status
  // bar, which holds one line for 2.5 seconds. These are things the reader
  // has to weigh against the diagram — an expanded variable edge, a PDA
  // whose acceptance mode did not survive — so they belong with the machine
  // and have to still be there a minute later. loadData() has already set
  // App.meta from the file (JFLAP files carry none), so this writes it.
  const warnings = data.warnings || [];
  if (warnings.length) {
    // normalizeCardMeta caps the blurb, and a cap applied to joined notes
    // cuts the last one mid-word — which reads as a rendering bug and, on
    // a note whose whole point is what to do about it, loses the advice.
    // So drop whole notes until they fit and say how many went.
    const header = 'Import notes:';
    const lines = [];
    let used = header.length;
    for (const w of warnings) {
      const line = `\n• ${w}`;
      // Leave room for the "…and N more" tail if this is not the last note.
      if (used + line.length > CARD_BLURB_MAX - 24 && lines.length) break;
      lines.push(line);
      used += line.length;
    }
    const dropped = warnings.length - lines.length;
    if (dropped) lines.push(`\n• …and ${dropped} more.`);

    // performClear() has already run and a .jff carries no card, so this
    // writes the card rather than merging into one.
    App.meta = normalizeCardMeta({
      title: 'Imported from JFLAP',
      blurb: header + lines.join('')
    });
    emit(Change.META);
  }

  const label = getMachineConfig(data.machine).label || data.machine;
  const caveat = warnings.length ? ` — ${warnings.length} import note${warnings.length > 1 ? 's' : ''}, see the (i) card` : '';
  showStatus(`Imported JFLAP ${label} — ${data.states.length} states, ${data.transitions.length} transitions${caveat}`);
  snapshot();
  return data;
}
