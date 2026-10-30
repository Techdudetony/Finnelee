import { useEffect } from 'react';

// How far (share of the drawer's width) or how fast (px per ms) a leftward drag must go
// to close the drawer. Anything less springs back open.
const CLOSE_SHARE = 0.3;
const FLICK_SPEED = 0.5;
const SLOP = 8; // px before deciding whether a drag is sideways (ours) or a scroll (the browser's)

/**
 * Swipe-to-close for the phone drawer: while `enabled`, a leftward drag on `ref`'s element
 * moves it with the finger (and fades `backdropRef` to match), then closes or springs back.
 * Vertical drags stay normal scrolling (the element has `touch-action: pan-y`). Keyboard
 * and screen-reader users close the drawer with Escape or the close button as before.
 */
export function useSwipeToClose(ref, backdropRef, enabled, onClose) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    return attachSwipeToClose(el, () => backdropRef.current, onClose);
  }, [ref, backdropRef, enabled, onClose]);
}

/**
 * The listeners behind useSwipeToClose, kept apart from React so they can be tested.
 * Returns a function that removes them and puts the drawer back where it was.
 */
export function attachSwipeToClose(el, getBackdrop, onClose) {
  let start = null; // { x, y, t, id } of the pointer that started the drag
  let dx = 0;
  let dragging = false;
  let moved = false; // swallow the click that ends a drag, so a nav item isn't opened

  const setOffset = (x) => {
    el.style.transform = x ? `translateX(${x}px)` : '';
    const backdrop = getBackdrop();
    if (backdrop) backdrop.style.opacity = x ? String(1 + x / el.offsetWidth) : '';
  };
  const down = (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    dx = 0;
    dragging = false;
    moved = false;
  };
  const move = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const x = e.clientX - start.x;
    const y = e.clientY - start.y;
    if (!dragging) {
      if (Math.abs(x) < SLOP && Math.abs(y) < SLOP) return;
      if (Math.abs(y) > Math.abs(x)) {
        start = null; // a scroll: leave it to the browser
        return;
      }
      dragging = true;
      moved = true;
      el.classList.add('dragging'); // no transition while following the finger
      el.setPointerCapture?.(e.pointerId);
    }
    dx = Math.min(0, x); // the drawer only moves left (closed); never past its open spot
    setOffset(dx);
  };
  const up = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const speed = dx / Math.max(1, e.timeStamp - start.t);
    start = null;
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging'); // the CSS transition finishes the move from here
    setOffset(0);
    if (dx < -el.offsetWidth * CLOSE_SHARE || speed < -FLICK_SPEED) onClose();
  };
  // The browser took the pointer (a scroll, a system gesture, a lost touch): the drag is
  // over and nothing was decided, so the drawer springs back open and is never closed.
  const cancel = (e) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    if (!dragging) return;
    dragging = false;
    moved = false; // no click follows a cancel, so don't swallow the next real one
    el.classList.remove('dragging');
    setOffset(0);
  };
  const click = (e) => {
    if (!moved) return;
    moved = false;
    e.preventDefault();
    e.stopPropagation();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', click, true);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('click', click, true);
    el.classList.remove('dragging');
    setOffset(0);
  };
}
