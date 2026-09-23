// ══════════════════════════════════════════════════════════════════
//  A SMALL XML READER
// ══════════════════════════════════════════════════════════════════
// Import-free, and not DOMParser, for the reason js/import-jflap.js gives for
// its own reader: the formats it serves are machine-written and regular, and
// a reader with no DOM is one the test suite can run. It handles elements,
// attributes, self-closing tags, text, comments, CDATA, processing
// instructions and a DOCTYPE without an internal subset, and decodes the five
// named entities plus numeric references. It does not validate, resolve
// namespaces (a prefix stays part of the name; `local` strips it) or read
// DTDs.
//
// An element is `{ name, local, attrs, children, text }`, where `children`
// holds elements only and `text` is the concatenated character data directly
// inside it.

export class XmlError extends Error {
  constructor(message, index) { super(message); this.index = index; }
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return e in ENTITIES ? ENTITIES[e] : m;
  });
}

export function parseXml(src) {
  src = String(src);
  let pos = 0;
  const fail = (msg, at = pos) => { throw new XmlError(`${msg} (at character ${at})`, at); };
  const root = { name: '#document', local: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];

  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > pos) stack[stack.length - 1].text += decodeEntities(src.slice(pos, textEnd));
    if (lt < 0) break;
    pos = lt;
    if (src.startsWith('<!--', pos)) {
      const end = src.indexOf('-->', pos + 4);
      if (end < 0) fail('unterminated comment');
      pos = end + 3;
    } else if (src.startsWith('<![CDATA[', pos)) {
      const end = src.indexOf(']]>', pos);
      if (end < 0) fail('unterminated CDATA section');
      stack[stack.length - 1].text += src.slice(pos + 9, end);
      pos = end + 3;
    } else if (src.startsWith('<?', pos)) {
      const end = src.indexOf('?>', pos);
      if (end < 0) fail('unterminated processing instruction');
      pos = end + 2;
    } else if (src.startsWith('<!', pos)) {
      const end = src.indexOf('>', pos);
      if (end < 0) fail('unterminated declaration');
      pos = end + 1;
    } else if (src.startsWith('</', pos)) {
      const end = src.indexOf('>', pos);
      if (end < 0) fail('unterminated closing tag');
      const name = src.slice(pos + 2, end).trim();
      const open = stack.pop();
      if (!open || open === root || open.name !== name) fail(`</${name}> does not close <${open?.name}>`);
      pos = end + 1;
    } else {
      const m = /^<([A-Za-z_][\w.:-]*)/.exec(src.slice(pos, pos + 256));
      if (!m) fail('malformed tag');
      const el = { name: m[1], local: m[1].includes(':') ? m[1].split(':').pop() : m[1], attrs: {}, children: [], text: '' };
      pos += m[0].length;
      while (true) {
        while (/\s/.test(src[pos] || '')) pos++;
        if (src[pos] === '>') { pos++; stack[stack.length - 1].children.push(el); stack.push(el); break; }
        if (src.startsWith('/>', pos)) { pos += 2; stack[stack.length - 1].children.push(el); break; }
        const a = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(pos, pos + 65536));
        if (!a) fail(`malformed attribute in <${el.name}>`);
        el.attrs[a[1]] = decodeEntities(a[3] !== undefined ? a[3] : a[4]);
        pos += a[0].length;
      }
    }
  }
  if (stack.length > 1) fail(`<${stack[stack.length - 1].name}> is never closed`, src.length);
  const top = root.children;
  if (top.length !== 1) fail('an XML document has exactly one root element', 0);
  return top[0];
}
