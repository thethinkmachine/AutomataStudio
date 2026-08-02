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

const JFLAP_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function jflapDecode(str) {
  return String(str).replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X'
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10FFFF
        ? String.fromCodePoint(code)
        : m;
    }
    return JFLAP_ENTITIES[ent] !== undefined ? JFLAP_ENTITIES[ent] : m;
  });
}

function jflapParseAttrs(src) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1]] = jflapDecode(m[3] !== undefined ? m[3] : m[4]);
  return attrs;
}

/** @returns {{tag:string, attrs:object, children:Array, text:string}} synthetic root */
function jflapParseXML(src) {
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

function jflapChild(node, tag) {
  if (!node) return null;
  return node.children.find(c => c.tag === tag) || null;
}
function jflapChildren(node, tag) {
  if (!node) return [];
  return node.children.filter(c => c.tag === tag);
}
/** Text of a child element, entity-decoded and trimmed. null when absent. */
function jflapText(node, tag) {
  const c = jflapChild(node, tag);
  return c ? jflapDecode(c.text).trim() : null;
}
/** True when the child element exists at all — JFLAP's flags are empty tags. */
function jflapFlag(node, tag) {
  return !!jflapChild(node, tag);
}

// ── conversion ────────────────────────────────────────────────────
// JFLAP writes an omitted symbol as an empty <read/>; that is its lambda.
function jflapSymbol(raw, eps) {
  return raw === null || raw === '' ? eps : raw;
}

/**
 * Converts a parsed .jff tree into the workspace shape loadData() takes.
 * Throws on anything structurally unusable so the caller can report it.
 */
function jflapToWorkspace(root, symOverride) {
  const sym = symOverride || App.config.sym;
  const structure = jflapChild(root, 'structure');
  if (!structure) throw new Error('Not a JFLAP file — no <structure> element.');

  const type = (jflapText(structure, 'type') || '').toLowerCase();
  const automaton = jflapChild(structure, 'automaton');
  if (!automaton) {
    if (type === 'grammar') throw new Error('JFLAP grammar files are not supported yet — only automata (fa, pda, turing, moore, mealy).');
    throw new Error('Not a JFLAP automaton — no <automaton> element.');
  }

  const rawStates = jflapChildren(automaton, 'state').concat(jflapChildren(automaton, 'block'));
  if (!rawStates.length) throw new Error('This JFLAP file contains no states.');

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
  const accepts = [];
  states.forEach(({ state, node }) => {
    if (jflapFlag(node, 'initial') && startId === null) startId = state.id;
    if (jflapFlag(node, 'final')) accepts.push(state.id);
  });

  const sigma = new Set();
  const stackAlpha = new Set();
  const outputAlpha = new Set();
  let maxTape = 1;
  let sawEpsilonRead = false;

  const transitions = jflapChildren(automaton, 'transition').map((t, i) => {
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
      tr.symbol = jflapSymbol(read, sym.eps);
      if (read === null || read === '') sawEpsilonRead = true;

      const write = jflapText(t, 'write');
      const move = jflapText(t, 'move');
      if (write !== null || move !== null) {
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
        if (tr.pop !== sym.eps) [...tr.pop].forEach(c => stackAlpha.add(c));
        if (tr.push !== sym.eps) [...tr.push].forEach(c => stackAlpha.add(c));
      }

      const transout = jflapText(t, 'transout');
      if (transout !== null) {
        tr.output = transout;
        if (transout) outputAlpha.add(transout);
      }
    }
    return tr;
  });

  states.forEach(({ state }) => {
    if (state.output !== undefined && state.output !== '') outputAlpha.add(state.output);
  });

  const machine = jflapMachineType(type, {
    transitions, sawEpsilonRead, maxTape,
    hasOutputStates: states.some(({ state }) => state.output !== undefined)
  });

  if (machine === 'DPDA' || machine === 'NPDA') stackAlpha.add(sym.stackBottom);
  if (machine === 'TM' || machine === 'NDTM' || machine === 'MTM') stackAlpha.add(sym.blank);

  return {
    machine,
    sigma: [...sigma],
    stackAlpha: [...stackAlpha],
    outputAlpha: [...outputAlpha],
    tapeCount: machine === 'MTM' ? maxTape : (machine === 'TM' || machine === 'NDTM' ? 1 : 2),
    states: states.map(s => s.state),
    transitions,
    startId,
    accepts,
    notes: [],
    dividers: []
  };
}

// JFLAP's <type> only distinguishes families ("fa"), not the determinism
// the app models as separate machine types, so the specific type is read
// off the transitions the same way loadData() does for its own files.
function jflapMachineType(type, info) {
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
function importJFLAPText(text) {
  const data = jflapToWorkspace(jflapParseXML(text));
  validateSchema(data);
  performClear();
  loadData(data);
  const label = getMachineConfig(data.machine).label || data.machine;
  showStatus(`Imported JFLAP ${label} — ${data.states.length} states, ${data.transitions.length} transitions`);
  snapshot();
  return data;
}
