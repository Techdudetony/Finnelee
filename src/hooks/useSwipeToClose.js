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
    let start = null; // { x, y, t, id } of the pointer that started the drag
    let dx = 0;
    let dragging = false;
    let moved = false; // swallow the click that ends a drag, so a nav item isn't opened

    const setOffset = (x) => {
      el.style.transform = x ? `translateX(${x}px)` : '';
      if (backdropRef.current)
        backdropRef.current.style.opacity = x ? String(1 + x / el.offsetWidth) : '';
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
    const click = (e) => {
      if (!moved) return;
      moved = false;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      el.classList.remove('dragging');
      setOffset(0);
    };
  }, [ref, backdropRef, enabled, onClose]);
}
