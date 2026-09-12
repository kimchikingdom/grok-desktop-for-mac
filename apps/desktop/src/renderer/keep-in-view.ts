export type Span = { top: number; bottom: number };

/**
 * How far a scroll container has to move so `item` sits fully inside `view`.
 * Negative scrolls up, positive scrolls down, 0 means it is already visible.
 * Keyboard lists (slash, @, ⌘P, review files) move the selection without the
 * mouse, so nothing else scrolls the active row back into sight.
 */
export function scrollDelta(view: Span, item: Span): number {
  if (item.top < view.top) return item.top - view.top;
  if (item.bottom > view.bottom) return item.bottom - view.bottom;
  return 0;
}

/** Scrolls `container` the least amount that brings its active row into view. */
export function keepInView(container: HTMLElement | null, item: Element | null | undefined): void {
  if (!container || !item) return;
  const delta = scrollDelta(container.getBoundingClientRect(), item.getBoundingClientRect());
  if (delta !== 0) container.scrollTop += delta;
}
