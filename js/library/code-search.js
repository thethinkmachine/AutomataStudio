// ══════════════════════════════════════════════════════════════════
//  A MACHINE CODE IN THE SEARCH BOX
// ══════════════════════════════════════════════════════════════════
// Pasting a machine code (js/interop/smtf.js) into a search box should find
// that machine — however its states were named or laid out — rather than
// search for the code's characters as words. This turns such a text into the
// query language's `code:<machine id>` term (index-model.js), and leaves every
// other text alone.
//
// One module for both faces of the library: the app's Browse and the
// website's search box import it, so they cannot disagree about what a pasted
// code finds. It imports only hash.js and the codec, both import-free, and the
// site's build copies all three beside the page in the repo's own layout
// (assets/ for js/library, interop/ for js/interop), so the relative imports
// resolve unchanged there — see build.mjs.
//
// A bare STF string is left as words: the index's `standard` field already
// finds those, and a one-way and a two-way tape running the same rows are
// different machines, which an id read off the STF string alone could not
// tell apart.

import { DEFAULT_SYM, machineCodeText, readMachineCode } from '../interop/smtf.js';
import { machineIdOf } from './hash.js';

/** The search text, with a machine code in it replaced by `code:<id>`. */
export function codeSearchText(text, sym = DEFAULT_SYM) {
  const src = machineCodeText(text);
  if (!src) return text;
  try {
    const data = readMachineCode(src, { sym });
    const id = machineIdOf({ ...data, config: { ...data.config, sym } });
    return id ? `code:${id}` : text;
  } catch {
    // Recognisably a code but not a readable one: search it as words, which
    // finds nothing and says so, rather than throwing out of a keystroke.
    return text;
  }
}
