// ══════════════════════════════════════════════════════════════════
//  DRILLING IN
// ══════════════════════════════════════════════════════════════════
// Double-click a block and the canvas shows what is inside it. A breadcrumb
// over the diagram says where you are; clicking a crumb goes back.
//
// **Scope is a camera, not a mode.** Entering a block changes `App.scope` and
// nothing else — the machine is flat and stays flat, so undo, selection, a
// running simulation, the formal definition and every decider are untouched by
// a drill-in. Under a hierarchical model, going inside would mean swapping
// `App.states`, and each of those would have to learn what a scope change is.
// This is the whole payoff of js/blocks.js keeping the machine flat.
//
// The camera *is* remembered per scope, so drilling out puts you back where you
// were rather than at wherever the outer diagram's origin happens to be.

import { blockAncestry, getBlock } from './blocks.js';
import { applyCamera } from './canvas.js';
import { fitToScreen, layoutCanvasOverlays } from './ui.js';
import { $, App } from './state.js';
import { Change, emit, subscribe } from './store.js';
import { invalidateViewGraph, liveScope, scopeTrail } from './view-graph.js';
import { showStatus } from './utils.js';

// Where the camera was, per scope path. Session state rather than document
// state: it is a property of this reader's navigation, not of the machine, so
// it never reaches a serializer.
const cameras = new Map();

function scopeKey(scope) { return (scope || []).join('/'); }

/** The scope path, live and pruned. */
export function currentScope() { return liveScope(); }

export function atTopLevel() { return currentScope().length === 0; }

/**
 * Go into a block, or out of one.
 *
 *   enterBlockScope('b7')            → into b7, from wherever you are
 *   enterBlockScope(null, {up: 1})   → out one level
 *   enterBlockScope(null, {to: []})  → to an explicit path
 */
export function enterBlockScope(blockId, opts = {}) {
  const from = currentScope();
  let next;
  if (Array.isArray(opts.to)) next = opts.to.slice();
  else if (opts.up) next = from.slice(0, Math.max(0, from.length - opts.up));
  else if (blockId) {
    const b = getBlock(blockId);
    if (!b) return false;
    // Addressed by the block's own ancestry rather than by appending to where
    // the reader happens to be: the Blocks panel offers every block in the
    // machine, and "open the multiplier" has to work from the top level.
    next = [...blockAncestry(blockId).map(x => x.id)];
  } else next = [];

  if (scopeKey(next) === scopeKey(from)) return false;

  cameras.set(scopeKey(from), { ...App.cam });
  App.scope = next;
  invalidateViewGraph();

  const remembered = cameras.get(scopeKey(next));
  emit(Change.GRAPH, Change.CANVAS);
  if (remembered) {
    App.cam = { ...remembered };
    applyCamera();
  } else if (typeof fitToScreen === 'function') {
    fitToScreen(true);
  }
  renderBreadcrumb();

  const b = next.length ? getBlock(next[next.length - 1]) : null;
  showStatus(b ? `Inside ${b.name}` : 'Back to the top level');
  return true;
}

/** Out one level, or false when there is nowhere to go. */
export function leaveBlockScope() {
  if (atTopLevel()) return false;
  return enterBlockScope(null, { up: 1 });
}

/** Forget the remembered cameras. A load replaces the machine they belonged to. */
export function resetScopeCameras() { cameras.clear(); }

// ══════════════════════════════════════════════════════════════════
//  THE BREADCRUMB
// ══════════════════════════════════════════════════════════════════
// Built rather than written into index.html because it exists only while the
// reader is inside something, and because its content is the scope. Listeners
// are attached at creation the way js/reference.js does it, so the whole
// feature adds no name to js/bridge.js.

// The Phosphor `arrow-up` the rest of the app's chrome uses. A `↑` typed as
// text picks up whatever glyph the reader's font has for it and sits on the
// text baseline rather than on the button's centre line.
const BACK_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false">'
  + '<path d="M205.66,114.34a8,8,0,0,1-11.32,11.32L136,67.31V216a8,8,0,0,1-16,0V67.31L61.66,'
  + '125.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0Z" /></svg>';

// What the bar is currently showing, so an unchanged scope is not rebuilt. The
// bar is subscribed to every GRAPH emit — a state dragged, an accept toggled, a
// simulation step — and an innerHTML rebuild on each of those takes the focus
// out of any crumb a keyboard reader is on.
let painted = null;

export function renderBreadcrumb() {
  const host = $('scope-bar');
  if (!host) return;
  const trail = scopeTrail();
  const key = trail.map(b => b.id + ':' + b.name).join('/');
  const wasShown = !host.hidden;
  if (!trail.length) {
    if (painted !== null) { host.innerHTML = ''; painted = null; }
    host.hidden = true;
    // The bar is an obstacle the info pill routes around, so appearing and
    // disappearing both have to re-run the overlay layout — otherwise the pill
    // keeps dodging a bar that has gone, or is sat on by one that has arrived.
    if (wasShown && typeof layoutCanvasOverlays === 'function') layoutCanvasOverlays();
    return;
  }
  host.hidden = false;
  if (!wasShown && typeof layoutCanvasOverlays === 'function') layoutCanvasOverlays();
  if (key === painted && host.childNodes.length) return;
  painted = key;
  host.innerHTML = '';

  const crumb = (label, path, isLast) => {
    const b = document.createElement('button');
    b.className = 'scope-crumb' + (isLast ? ' is-current' : '');
    b.type = 'button';
    b.textContent = label;
    if (isLast) {
      b.setAttribute('aria-current', 'true');
      // Really disabled, not merely styled inert: a button that looks unpressable
      // and still takes Tab is a stop on the keyboard path that does nothing.
      b.disabled = true;
    } else {
      b.addEventListener('click', () => enterBlockScope(null, { to: path }));
    }
    host.appendChild(b);
  };

  const back = document.createElement('button');
  back.className = 'scope-back';
  back.type = 'button';
  back.innerHTML = BACK_ICON;
  back.setAttribute('data-tip', 'Out one level');
  back.setAttribute('aria-label', 'Out one level');
  back.addEventListener('click', () => leaveBlockScope());
  host.appendChild(back);

  crumb('Machine', [], false);
  trail.forEach((b, i) => {
    const sep = document.createElement('span');
    sep.className = 'scope-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '/';
    host.appendChild(sep);
    crumb(b.name, trail.slice(0, i + 1).map(x => x.id), i === trail.length - 1);
  });

  host.onscroll = updateScopeBarOverflowShadows;
  // A plain vertical wheel does not become horizontal scroll on its own —
  // js/ui.js's tab strip carries the same handler for the same reason. It has
  // to sit here rather than rely on the browser default, and js/canvas.js
  // excludes `.scope-bar` from its own wheel handler so the camera does not
  // zoom out from under it first.
  host.onwheel = (e) => {
    if (e.deltaY !== 0) {
      host.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };
  updateScopeBarOverflowShadows();
}

// Reads scrollWidth/scrollLeft the same way js/ui.js's updateTabOverflowShadows
// does for the workspace tab strip — same fade, same test, same reasoning: a
// scroller dropped over the canvas needs to say so rather than just clipping.
function updateScopeBarOverflowShadows() {
  const host = $('scope-bar');
  if (!host) return;
  const maxScroll = Math.max(0, host.scrollWidth - host.clientWidth);
  const hasOverflow = maxScroll > 2;
  host.classList.toggle('has-overflow-left', hasOverflow && host.scrollLeft > 2);
  host.classList.toggle('has-overflow-right', hasOverflow && host.scrollLeft < maxScroll - 2);
}

// The bar is a function of the scope and of the block names in it, and every
// path that can change either ends in a GRAPH emit — a rename, an undo back
// past one, a load that replaces the machine the scope pointed into. Subscribed
// beside the function it calls, at module scope, the way render.js and
// history.js register theirs.
export function syncScopeBar() { renderBreadcrumb(); }
subscribe(Change.GRAPH, syncScopeBar);

// The bar's own width tracks the canvas well (`max-width: min(70%, 640px)`),
// so a window resize or a panel pin/unpin can flip whether it overflows with
// the scope itself never changing — nothing else here would re-check it.
window.addEventListener('resize', updateScopeBarOverflowShadows);
