// ══════════════════════════════════════════════════════════════════
//  ANALYTICS — Google Analytics 4, through the Google tag (gtag.js)
// ══════════════════════════════════════════════════════════════════
// The published website measures its visits; nothing else does. This used to
// be Google's inline snippet in index.html's <head>, which ran everywhere the
// page did: the dev server and `vite preview` counted every reload of a
// developer's own tab, and the desktop app reported from app://, an origin
// the property knows nothing about. It is a module now for that reason, and
// because an inline script is one more hash in the Content-Security-Policy.
//
// Measured means served over https: — which is the website and nothing else
// this app runs as (dev and preview are http://localhost, the desktop app is
// app://). The CSP admits https://www.googletagmanager.com, where gtag.js and
// the scripts it fetches for itself come from.

export const MEASUREMENT_ID = 'G-R1LKJ6JFEF';

/** Whether a page at this location should report to the property. */
export function shouldMeasure(location) {
  return location?.protocol === 'https:';
}

/**
 * Queue the configuration and load gtag.js, which drains the queue when it
 * arrives. Safe to call twice. Returns whether it started.
 */
export function startAnalytics(win = window) {
  if (!shouldMeasure(win.location) || win.dataLayer?.__automataStarted) return false;
  win.dataLayer = win.dataLayer || [];
  // gtag.js reads each entry as an Arguments object — an array pushed in its
  // place is ignored — so this is a function, not an arrow, and it pushes
  // `arguments` itself. It is Google's snippet, written as a module.
  function gtag() { win.dataLayer.push(arguments); }
  win.gtag = gtag;
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);
  Object.defineProperty(win.dataLayer, '__automataStarted', { value: true });

  const script = win.document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  win.document.head.appendChild(script);
  return true;
}
