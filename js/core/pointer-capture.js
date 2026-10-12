// Pointer capture, asked for and given back without the exceptions.
//
// setPointerCapture throws NotFoundError when the pointer is no longer active
// — a touch that ended between the event and the call, a synthetic event with
// no real pointer behind it — and releasePointerCapture does the same for a
// capture already lost. Either way the drag has nothing to hold on to, which
// is the outcome the caller would have arranged anyway, so neither is an
// error. This is the one place that says so; there used to be one empty
// catch per drag handle.
//
// Import-free.

export function capturePointer(el, pointerId) {
  try { el?.setPointerCapture?.(pointerId); } catch { /* the pointer is already gone */ }
}

export function releasePointer(el, pointerId) {
  try { el?.releasePointerCapture?.(pointerId); } catch { /* the capture is already gone */ }
}
