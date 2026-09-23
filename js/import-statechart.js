// ══════════════════════════════════════════════════════════════════
//  PLACING AN IMPORTED STATECHART
// ══════════════════════════════════════════════════════════════════
// The UI half of js/interop/statechart.js, split the way js/import-jflap.js
// splits readJFLAPText from importJFLAPData: the reading happens first, so a
// file that will not convert leaves the reader where they were and costs no
// tab; this runs only once there is a machine to put on the canvas.

import { snapshot } from './history.js';
import { CARD_BLURB_MAX, SCHEMA_VERSION, WORKSPACE_FORMAT, loadData, normalizeCardMeta } from './persistence.js';
import { App, getMachineConfig } from './state.js';
import { Change, emit } from './store.js';
import { performClear, showStatus } from './utils.js';

export function importStatechartData(data, kindLabel) {
  performClear();
  // Stamped with the current schema: the flattener spells ε and the wildcard
  // with this reader's own symbols, so the v0 symbol migration — keyed on a
  // missing schema — must not run over it.
  loadData({
    format: WORKSPACE_FORMAT,
    schema: SCHEMA_VERSION,
    machine: data.machine,
    sigma: data.sigma,
    outputAlpha: data.outputAlpha,
    states: data.states,
    transitions: data.transitions,
    startId: data.startId,
    accepts: data.accepts,
    notes: [],
    dividers: []
  });

  // Caveats go on the machine card, for the reason importJFLAPData gives:
  // the status bar holds one line for 2.5 seconds, and these are things to
  // weigh against the diagram a minute later.
  const warnings = data.warnings || [];
  const lines = [];
  let used = 0;
  for (const w of warnings) {
    const line = `\n• ${w}`;
    if (used + line.length > CARD_BLURB_MAX - 40 && lines.length) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length < warnings.length) lines.push(`\n• …and ${warnings.length - lines.length} more.`);
  App.meta = normalizeCardMeta({
    title: data.title ? `${data.title} (from ${kindLabel})` : `Imported from ${kindLabel}`,
    blurb: warnings.length
      ? 'Import notes:' + lines.join('')
      : `Flattened from a ${kindLabel} statechart: one state per leaf, named by its path.`
  });
  emit(Change.META);

  const label = getMachineConfig(data.machine).label || data.machine;
  const caveat = warnings.length ? ` — ${warnings.length} import note${warnings.length > 1 ? 's' : ''}, see the (i) card` : '';
  showStatus(`Imported ${kindLabel} as a ${label} — ${data.states.length} states, ${data.transitions.length} transitions${caveat}`);
  snapshot();
  return data;
}
