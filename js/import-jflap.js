import { BLOCK_NAME_SEP, machineSupportsBlocks } from './blocks.js';
import { resolveNodeOverlaps } from './geometry.js';
import { snapshot } from './history.js';
import { CARD_BLURB_MAX, loadData, normalizeCardMeta, validateSchema } from './persistence.js';
import { App, getMachineConfig, R } from './state.js';
import { Change, emit } from './store.js';
import { hasPdaNondeterminism, isAnyTM, hasSingleTapeNondeterminism, performClear, showStatus } from './utils.js';
import { blockSize, viewStates } from './view-graph.js';

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

/** JFLAP's wildcard: read anything, or — as a write — put back what you read. */
export const JFLAP_ANY = '~';
/** The blank, where JFLAP spells it out rather than writing an empty element. */
export const JFLAP_BLANK = '□';

/**
 * A tape symbol as this app spells it.
 *
 * `~` is `App.config.sym.any`, which js/machines/turing.js already reads as
 * "any symbol" and, as a write, as "put back what you read" — so the two
 * notations mean the same thing and only the glyph changes. Left alone, `~`
 * becomes a tape symbol named "~" that no cell holds and every rule misses.
 */
export function jflapTapeSymbol(raw, fallback, sym) {
  if (raw === JFLAP_ANY) return sym.any;
  if (raw === JFLAP_BLANK) return sym.blank;
  return jflapSymbol(raw, fallback);
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
  if (brace === -1) {
    // The bare negation, with nothing bound: "!A" is "any symbol but A", and
    // 6.1 writes it on ordinary transitions as well as on block edges. Read
    // literally it is a two-character tape symbol no cell can ever hold — the
    // edge draws, Γ gains a stray "!A", and the machine silently decides
    // something else. It has no variable, so the write says what happens to
    // the symbol: `~` puts it back.
    if (str.length > 1 && str[0] === '!') {
      const symbols = str.slice(1).split(',').map(t => t.trim()).filter(t => t !== '');
      if (symbols.length) return { kind: 'not', symbols, variable: null };
    }
    return { kind: 'plain', symbol: str };
  }

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

// ══════════════════════════════════════════════════════════════════
//  BUILDING BLOCKS
// ══════════════════════════════════════════════════════════════════
//  A JFLAP <block> is a state whose interior is another whole automaton, and
//  that is this app's building blocks (js/blocks.js) seen from the other side.
//  The two models line up on every point that matters — control enters through
//  the interior's own start state, and leaves from the states it halts in — so
//  the import expands the interior rather than dropping it, and the reader gets
//  a block they can drill into, ungroup, save to the library and run.
//
//  The one place they differ is the *number* of ways out. JFLAP's block has one
//  implicit exit: reaching any of its final states hands control to whatever
//  edge leaves the block in the outer diagram. This app's block has one named
//  exit per halting state. So an outer edge leaving a block is expanded into one
//  edge per exit — the same rule stated in both formalisms, and what keeps the
//  imported machine deciding what the file decided.
//
//  Two facts about the block *as an outer node* still have to travel: <initial/>
//  on the block means the machine starts inside it (at its entry), and <final/>
//  means halting in it accepts (so its exits join F). Every other accept mark
//  inside a block is dropped, exactly as inlineBlock() drops them: a block
//  finishing is not the machine accepting.

/**
 * A block's interior, wherever the file put it.
 *
 * JFLAP does not nest it. `<block>` carries a `<tag>` naming the sub-machine,
 * and the interior is written as a *sibling of `<automaton>`* whose element
 * name is that tag — `createAutomatonElement` appends it to the document
 * element, and `readAutomaton` files it under its own node name. So the tag is
 * a reference into the file, and several blocks may share one interior, which
 * is exactly this app's "two placements of one definition are two copies".
 *
 * A tag naming nothing is the JFLAP 4.x arrangement, where the interior lived
 * in a separate .jff the file only points at; there is nothing to expand and
 * the caller falls back to a plain state.
 *
 * The nested forms are accepted too, because a file written by hand — or by
 * anything that reasonably assumed containment — is still unambiguous.
 */
function blockAutomaton(node, scopes) {
  const nested = jflapChild(jflapChild(node, 'structure'), 'automaton') || jflapChild(node, 'automaton');
  if (nested) return nested;
  const tag = jflapText(node, 'tag');
  if (!tag) return null;
  // Where the interior is put differs between writers, and neither is a
  // superset of the other: 6.1 appends it inside `<automaton>` (after the
  // transitions, under a "list of automata" comment) while jflap-lib's
  // createAutomatonElement appends it to the document element beside it. So
  // both are searched, nearest scope first.
  for (const scope of scopes) {
    const ref = scope && scope.children.find(c => c.tag === tag);
    // The referenced element *is* the automaton — its children are the states
    // — though a file that wrapped one is read the same way.
    if (ref) return jflapChild(ref, 'automaton') || ref;
  }
  return null;
}

/** A name no sibling block at this level is using — see uniqueBlockName(). */
function uniqueSiblingName(base, taken) {
  const root = String(base || 'block').trim() || 'block';
  let name = root;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${root} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Parses one <automaton> — the file's own, or a block's interior — into the
 * flat pieces jflapToWorkspace assembles.
 *
 * `ctx` carries what is file-wide rather than level-wide: the id counters (so
 * a nested state can never collide with an outer one), the alphabets, the
 * warnings, and the widest transition seen. `blockId` is the container every
 * state produced here belongs to, null at the top level — the same `blockId`
 * field js/blocks.js writes when it inlines a definition.
 */
function parseJflapLevel(automaton, sym, ctx, blockId) {
  const plainNodes = jflapChildren(automaton, 'state');
  const blockNodes = jflapChildren(automaton, 'block');

  // JFLAP ids are numeric and reused across files — and reused across nesting
  // levels too — so they are mapped onto fresh internal ids per level.
  const idMap = new Map();
  const plain = [];
  const addPlain = (node, jid, i) => {
    const id = 's' + (ctx.si++);
    idMap.set(String(jid), id);
    const x = parseFloat(jflapText(node, 'x'));
    const y = parseFloat(jflapText(node, 'y'));
    const state = {
      id,
      name: node.attrs.name || jflapText(node, 'name') || ('q' + jid),
      x: Number.isFinite(x) ? x : 120 + (i % 6) * 140,
      y: Number.isFinite(y) ? y : 120 + Math.floor(i / 6) * 140
    };
    if (blockId) state.blockId = blockId;
    const output = jflapText(node, 'output');
    if (output !== null) state.output = output;
    plain.push({ state, node });
    return state;
  };
  plainNodes.forEach((s, i) => addPlain(s, s.attrs.id !== undefined ? s.attrs.id : String(i), i));

  const states = [];
  const blocks = [];
  const transitions = [];

  // ── nested blocks, before the transitions that wire them ──
  // A block's entry and exits have to exist before this level's edges can be
  // resolved, because an edge may name the block where it would otherwise name
  // a state.
  const blockRefs = new Map();
  const siblingNames = new Set();
  blockNodes.forEach((node, i) => {
    const jid = String(node.attrs.id !== undefined ? node.attrs.id : `b${i}`);
    const inner = blockAutomaton(node, [automaton, ctx.root, ctx.structure]);
    const rawName = node.attrs.name || jflapText(node, 'name') || 'block';
    const hasInterior = inner
      && (jflapChildren(inner, 'state').length || jflapChildren(inner, 'block').length);

    // A block the file wrote no interior for has nothing to expand. Importing
    // it as a plain state keeps every edge that names it resolvable, which is
    // strictly better than dropping the node and failing on its transitions.
    if (!hasInterior) {
      addPlain(node, jid, plainNodes.length + i);
      ctx.warnings.push(`Building block "${rawName}" carries no interior in the file — imported as a plain state.`);
      return;
    }

    const name = uniqueSiblingName(rawName, siblingNames);
    const id = 'b' + (++ctx.bi);
    const sub = parseJflapLevel(inner, sym, ctx, id);

    const entry = sub.startId || sub.states[0]?.id || null;
    if (!sub.startId) {
      ctx.warnings.push(`Building block "${name}" declares no initial state — its first state was taken as the entry.`);
    }
    // Exits default to the interior's accepting states, which is the same
    // default exitsOf() applies in js/blocks.js: a block is a machine, and the
    // states it halts in are the answers it hands back. Labelled before the
    // path prefix goes on, so an exit reads as `done` rather than `sub/done`.
    const byId = new Map(sub.states.map(s => [s.id, s]));
    const exits = sub.accepts.map(sid => ({ id: sid, label: byId.get(sid)?.name || sid }));
    if (!exits.length && !jflapFlag(node, 'final')) {
      ctx.warnings.push(`Building block "${name}" has no accepting states, so it has no way out — edges leaving it in the file were dropped.`);
    }

    // Inlining prefixes interior names with the instance name, once per level.
    // A block that itself contains blocks already carries theirs, so the
    // prefixes accumulate into exactly the path blockPathOf() reports.
    const bx = parseFloat(jflapText(node, 'x'));
    const by = parseFloat(jflapText(node, 'y'));
    const dx = Number.isFinite(bx) ? bx : 120 + (i % 6) * 140;
    const dy = Number.isFinite(by) ? by : 120 + Math.floor(i / 6) * 140;
    for (const s of sub.states) {
      s.name = `${name}${BLOCK_NAME_SEP}${s.name}`;
      s.x += dx;
      s.y += dy;
    }
    for (const b of sub.blocks) { b.x += dx; b.y += dy; }

    blocks.push({
      id, name, parent: blockId,
      entry, exits,
      x: dx, y: dy, w: null, h: null,
      source: null, version: 1, collapsed: true
    }, ...sub.blocks);
    states.push(...sub.states);
    transitions.push(...sub.transitions);
    blockRefs.set(jid, { name, entry, exits, node });
  });

  // ── this level's start and accept marks ──
  let startId = null;
  let initialCount = 0;
  const accepts = [];
  plain.forEach(({ state, node }) => {
    if (jflapFlag(node, 'initial')) {
      initialCount++;
      if (startId === null) startId = state.id;
    }
    if (jflapFlag(node, 'final')) accepts.push(state.id);
  });
  for (const ref of blockRefs.values()) {
    // A block marked initial is entered at its entry; marked final, halting at
    // any of its exits is what accepts.
    if (jflapFlag(ref.node, 'initial')) {
      initialCount++;
      if (startId === null) startId = ref.entry;
    }
    if (jflapFlag(ref.node, 'final')) accepts.push(...ref.exits.map(e => e.id));
  }
  if (initialCount > 1) {
    ctx.warnings.push(`File declares ${initialCount} initial states — kept the first, dropped ${initialCount - 1}.`);
  }

  // ── endpoints ──
  // An edge into a block lands on its entry; an edge out of one leaves from
  // every exit, which is JFLAP's single implicit exit written in this app's
  // terms. Both answer a *list*, so the transition body below is unchanged
  // apart from running once per origin.
  const resolveTo = jid => idMap.get(jid) || blockRefs.get(jid)?.entry || null;
  const resolveFrom = jid => {
    if (idMap.has(jid)) return [idMap.get(jid)];
    const ref = blockRefs.get(jid);
    if (!ref) return null;
    return ref.exits.map(e => e.id);
  };

  const sigma = ctx.sigma;
  const stackAlpha = ctx.stackAlpha;
  const outputAlpha = ctx.outputAlpha;
  // Negated variable reads ("! a, b } w") cannot be expanded until the whole
  // alphabet is known, so they are parked here and resolved in a second pass.
  const deferred = ctx.deferred;

  jflapChildren(automaton, 'transition').forEach((t, i) => {
    const rawFrom = String(jflapText(t, 'from'));
    const rawTo = String(jflapText(t, 'to'));
    const froms = resolveFrom(rawFrom);
    const to = resolveTo(rawTo);
    if (froms === null || to === null) {
      throw new Error(`Transition ${i + 1} refers to a state that is not in the file.`);
    }
    // A block with no exits has nothing for an outgoing edge to leave from;
    // the block itself already said so above.
    for (const from of froms) transitions.push(...parseJflapTransition(t, from, to, i, sym, ctx));
  });

  return { states: [...plain.map(p => p.state), ...states], transitions, blocks, startId, accepts };
}

/**
 * One <transition> element, from one origin, as the 0..N transitions it stands
 * for. Split out of the level walk only so a block's several exits can each
 * carry the same edge — the body is the file's own reading, unchanged.
 */
function parseJflapTransition(t, from, to, i, sym, ctx) {
  const { sigma, stackAlpha, outputAlpha, deferred } = ctx;
  const tid = 't' + (ctx.ti++);
  {
    const tr = { id: tid, from, to };

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
      ctx.maxTape = Math.max(ctx.maxTape, rs.length);
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
      // An edge between blocks carries a read and nothing else: JFLAP leaves a
      // block on a symbol without writing or moving, which is this app's
      // `Σ / Σ, S` exit edge said the other way round. Left as a finite-automaton
      // edge it would arrive on a Turing machine with no write and no direction.
      const isBlockEdge = t.attrs.block === 'true';
      const isTape = write !== null || move !== null || isBlockEdge;

      // JFLAP 6.1's variable form stands for one transition per listed
      // symbol; expand it here so what runs is what the file means.
      const parsed = jflapParseRead(read);
      if (parsed.kind !== 'plain') {
        ctx.variableEdges++;
        const dir = (move || 'S').toUpperCase();
        // The bare "!A" binds no variable, so what says the symbol is put back
        // is the wildcard write — the same claim the braced form makes by
        // naming its variable.
        const copies = jflapWritesVariable(write, parsed.variable) || write === JFLAP_ANY;
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
          deferred.push({ ...spec, exclude: parsed.symbols, index: tid });
          return [];
        }
        return parsed.symbols.map((symbol, k) => {
          const out = { id: `${tid}_${k}`, from, to, symbol };
          if (isTape) {
            out.write = copies ? symbol : jflapTapeSymbol(spec.write, symbol, sym);
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
      if (read === null || read === '') ctx.sawEpsilonRead = true;

      if (isTape) {
        tr.symbol = jflapTapeSymbol(read, sym.blank, sym);
        tr.write = jflapTapeSymbol(write, tr.symbol, sym);
        tr.dir = (move || 'S').toUpperCase();
        // The wildcard stands for the alphabet; it is not a member of it.
        if (tr.symbol !== sym.any) stackAlpha.add(tr.symbol);
        if (tr.write !== sym.any) stackAlpha.add(tr.write);
        if (tr.symbol !== sym.blank && tr.symbol !== sym.any) sigma.add(tr.symbol);
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
  }
}

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

  if (!jflapChildren(automaton, 'state').length && !jflapChildren(automaton, 'block').length) {
    throw new Error('This JFLAP file contains no states.');
  }

  // What is file-wide rather than level-wide: the id counters, the alphabets
  // every level contributes to, and the notes the reader is owed. A nested
  // block is parsed with the same ctx, so its states can never take an id or
  // an alphabet symbol away from the machine containing it.
  const ctx = {
    si: 0, ti: 0, bi: 0,
    sigma: new Set(), stackAlpha: new Set(), outputAlpha: new Set(),
    warnings: [], deferred: [],
    maxTape: 1, sawEpsilonRead: false, variableEdges: 0,
    // A block's interior is looked up by name in these — see blockAutomaton().
    structure, root: automaton
  };

  const level = parseJflapLevel(automaton, sym, ctx, null);
  const { warnings, sigma, stackAlpha, outputAlpha, deferred } = ctx;
  const states = level.states;
  const transitions = level.transitions;
  const blocks = level.blocks;
  const startId = level.startId;
  const accepts = level.accepts;

  // Second pass: "! a, b } w" means every symbol the machine uses except
  // those. The alphabet is only complete now, so the subtraction happens
  // here rather than inline.
  deferred.forEach(spec => {
    const universe = [...(spec.isTape ? stackAlpha : sigma)]
      .filter(c => c !== sym.eps && c !== sym.blank && !spec.exclude.includes(c));
    universe.forEach((symbol, k) => {
      const out = { id: `${spec.index}_n${k}`, from: spec.from, to: spec.to, symbol };
      if (spec.isTape) {
        out.write = spec.copies ? symbol : jflapTapeSymbol(spec.write, symbol, sym);
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

  if (ctx.variableEdges) {
    warnings.push(`${ctx.variableEdges} JFLAP 6.1 variable transition${ctx.variableEdges > 1 ? 's' : ''} expanded into explicit symbols.`);
  }

  states.forEach(state => {
    if (state.output !== undefined && state.output !== '') outputAlpha.add(state.output);
  });

  // A multi-tape file states its tape count; the widest transition is only
  // a lower bound, so a 3-tape machine whose edges touch 2 stays 3-tape.
  // This has to be known before the type is decided, or such a file reads
  // as a single-tape TM.
  const declaredTapes = parseInt(jflapText(automaton, 'tapes') || jflapText(structure, 'tapes'), 10);
  const tapes = Math.max(ctx.maxTape, Number.isFinite(declaredTapes) ? declaredTapes : 1);

  const machine = jflapMachineType(type, {
    transitions, sawEpsilonRead: ctx.sawEpsilonRead, maxTape: tapes,
    hasOutputStates: states.some(state => state.output !== undefined)
  });

  // Blocks are a Turing-family feature, because leaving one costs a stay move
  // and a machine without one cannot exit a block without eating a symbol —
  // machineSupportsBlocks() is the single declaration of that. A file that put
  // a block on some other family still imports whole: inlining *is* the
  // semantics, so dropping the grouping loses the boxes and not one state,
  // transition or verdict.
  const keepsBlocks = blocks.length && machineSupportsBlocks(machine);
  if (blocks.length && !keepsBlocks) {
    for (const s of states) delete s.blockId;
    blocks.length = 0;
    warnings.push(`Building blocks were expanded into plain states — ${getMachineConfig(machine).label || machine} does not have blocks.`);
  } else if (keepsBlocks) {
    warnings.push(`${blocks.length} building block${blocks.length > 1 ? 's' : ''} expanded — double-click one on the canvas to go inside it.`);
  }

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
    states,
    transitions,
    startId,
    accepts,
    notes: [],
    dividers: [],
    // A block is a grouping over the flat machine, never a container of its
    // own — every state above is in `states` whatever depth it sits at, which
    // is what lets every simulator, decider and exporter carry on untouched.
    // See js/blocks.js.
    blocks,
    scope: [],
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

// ══════════════════════════════════════════════════════════════════
//  MAKING ROOM FOR THE BOXES
// ══════════════════════════════════════════════════════════════════
// A JFLAP block is a node the size of a state. Here it is a box carrying a
// title, a count and a preview — 165×112 against a radius of 30 — so a layout
// that read perfectly well in JFLAP arrives with its boxes touching, the edges
// between them hidden underneath and their labels with nowhere to go.
//
// The answer is a *uniform scale*, not a shove. The author's layout is the one
// thing worth keeping — these files are drawn by hand, in rows that mean
// something — and scaling preserves it exactly while giving every node the room
// its drawn size needs. Pushing nodes apart pairwise would turn a tidy row of
// eleven blocks into a scatter. The collision pass still runs afterwards, for
// the pair a scale cannot separate.

/** Room between two boxes for an edge and the label riding on it. */
const BLOCK_IMPORT_GAP = 76;

/** However close the file drew two nodes, the diagram does not explode. */
const MAX_IMPORT_SPREAD = 5;

/** Beyond this a pairwise scan is not worth it; the collision pass has a grid. */
const SPREAD_MAX_NODES = 400;

function spreadForBlocks() {
  // Every drawn thing with its drawn extent, filed under what it is drawn
  // *beside*: a state sits with its container's other members, a block box with
  // its parent's. Two nodes in different scopes are never on screen together,
  // so they have no room to make for each other.
  const nodes = [];
  for (const s of App.states || []) {
    nodes.push({ o: s, at: s.blockId || null, w: 2 * R, h: 2 * R });
  }
  for (const b of App.blocks || []) {
    const size = blockSize(b);
    nodes.push({ o: b, at: b.parent || null, w: size.w, h: size.h });
  }
  if (!nodes.length || nodes.length > SPREAD_MAX_NODES) return;

  const groups = new Map();
  for (const n of nodes) {
    if (!groups.has(n.at)) groups.set(n.at, []);
    groups.get(n.at).push(n);
  }

  let scale = 1;
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const dx = Math.abs((a.o.x || 0) - (b.o.x || 0));
        const dy = Math.abs((a.o.y || 0) - (b.o.y || 0));
        const needX = (a.w + b.w) / 2 + BLOCK_IMPORT_GAP;
        const needY = (a.h + b.h) / 2 + BLOCK_IMPORT_GAP;
        // Boxes are rectangles, so clearing on *either* axis is enough — which
        // is why this is not the circumscribed radius the routing passes use.
        // Judged as circles, two wide boxes side by side are "clear" with 34px
        // between them, which is the gap in which an edge label disappears.
        if (dx >= needX || dy >= needY) continue;
        // The cheapest scale that clears them, on whichever axis is nearer.
        const want = Math.min(dx > 0 ? needX / dx : Infinity, dy > 0 ? needY / dy : Infinity);
        if (Number.isFinite(want) && want > scale) scale = Math.min(want, MAX_IMPORT_SPREAD);
      }
    }
  }
  if (scale <= 1) return;

  // About the origin rather than the centroid: a .jff's coordinates start near
  // it, and where the diagram sits is fit-to-screen's business anyway.
  for (const n of nodes) {
    n.o.x = (n.o.x || 0) * scale;
    n.o.y = (n.o.y || 0) * scale;
  }
}

// ── entry point ───────────────────────────────────────────────────
// Reading and applying are two steps, because the caller has to know whether a
// file *is* one before deciding where to put it. A .jff that will not parse
// must not cost the reader a tab, still less the machine they were looking at
// — see WHERE AN OPENED DOCUMENT LANDS in js/persistence.js.
//
// Throws on anything it cannot read, exactly as the combined function did.
export function readJFLAPText(text) {
  const data = jflapToWorkspace(jflapParseXML(text));
  validateSchema(data);
  return data;
}

export function importJFLAPText(text) {
  return importJFLAPData(readJFLAPText(text));
}

export function importJFLAPData(data) {
  performClear();
  loadData(data);

  // A JFLAP layout was drawn for circles, and a block here is a box — 165×112
  // against a radius of 30, four times the footprint of the node it replaces.
  // So a file that looked fine in JFLAP arrives with its boxes painted over the
  // states beside them and the edges running underneath, which is the whole
  // diagram hidden behind the thing that was supposed to summarise it.
  if ((data.blocks || []).length) {
    spreadForBlocks();
    // Whatever the scale left touching — a pair the cheapest axis could not
    // separate — goes to the pass the canvas already runs when a state is
    // dropped, asked of the *projection* rather than of App.states: a block is
    // a node only the view has, and it is precisely the node that needs room.
    resolveNodeOverlaps(viewStates());
    // loadData() has already emitted, so the render that drew these boxes saw
    // the file's coordinates. Say the layout moved, or the diagram on screen is
    // the one from before the spread — boxes at their old positions, and each
    // block's preview drawn for a box that is no longer there.
    emit(Change.GRAPH);
  }

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
