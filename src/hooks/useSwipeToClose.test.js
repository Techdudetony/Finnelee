import { describe, expect, it, vi } from 'vitest';
import { attachSwipeToClose } from './useSwipeToClose';

// A stand-in for the drawer: Node's EventTarget plus the few DOM bits the listeners use.
function fakeDrawer() {
  const el = new EventTarget();
  const classes = new Set();
  el.style = { transform: '' };
  el.offsetWidth = 280;
  el.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
  el.setPointerCapture = vi.fn();
  return el;
}

// Pointer events carry their fields as plain properties (Node has no PointerEvent).
function pointer(el, type, x, y, t, extra = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, button: 0, ...extra });
  Object.defineProperty(e, 'timeStamp', { value: t });
  el.dispatchEvent(e);
  return e;
}

function setup() {
  const el = fakeDrawer();
  const backdrop = { style: { opacity: '' } };
  const onClose = vi.fn();
  const detach = attachSwipeToClose(el, () => backdrop, onClose);
  return { el, backdrop, onClose, detach };
}

describe('attachSwipeToClose', () => {
  it('a leftward swipe past the threshold closes the drawer', () => {
    const { el, backdrop, onClose } = setup();
    pointer(el, 'pointerdown', 200, 300, 0);
    pointer(el, 'pointermove', 150, 300, 100);
    expect(el.style.transform).toBe('translateX(-50px)');
    expect(el.classList.contains('dragging')).toBe(true);
    expect(Number(backdrop.style.opacity)).toBeLessThan(1);
    pointer(el, 'pointermove', 80, 300, 400);
    pointer(el, 'pointerup', 80, 300, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(el.style.transform).toBe('');
    expect(el.classList.contains('dragging')).toBe(false);
  });

  it('pointercancel mid-drag springs back open: no close, no transform, no dragging state', () => {
    const { el, backdrop, onClose } = setup();
    pointer(el, 'pointerdown', 200, 300, 0);
    pointer(el, 'pointermove', 60, 300, 50); // far and fast enough to close on pointerup
    expect(el.style.transform).toBe('translateX(-140px)');
    pointer(el, 'pointercancel', 60, 300, 60);
    expect(onClose).not.toHaveBeenCalled();
    expect(el.style.transform).toBe('');
    expect(backdrop.style.opacity).toBe('');
    expect(el.classList.contains('dragging')).toBe(false);

    // The next real tap is not swallowed as the end of a drag...
    const click = new Event('click', { cancelable: true });
    el.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    // ...and a pointerup arriving after the cancel does nothing.
    pointer(el, 'pointerup', 60, 300, 70);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a vertical drag is left to the browser and never moves the drawer', () => {
    const { el, onClose } = setup();
    pointer(el, 'pointerdown', 200, 300, 0);
    pointer(el, 'pointermove', 195, 200, 50);
    pointer(el, 'pointercancel', 195, 200, 60); // the browser takes it for scrolling
    expect(el.style.transform).toBe('');
    expect(el.classList.contains('dragging')).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a short, slow drag springs back open', () => {
    const { el, onClose } = setup();
    pointer(el, 'pointerdown', 200, 300, 0);
    pointer(el, 'pointermove', 170, 300, 600);
    pointer(el, 'pointerup', 170, 300, 600);
    expect(onClose).not.toHaveBeenCalled();
    expect(el.style.transform).toBe('');
  });

  it('the click that ends a drag is swallowed, so a nav item is not opened', () => {
    const { el } = setup();
    pointer(el, 'pointerdown', 200, 300, 0);
    pointer(el, 'pointermove', 150, 300, 600);
    pointer(el, 'pointerup', 150, 300, 600);
    const click = new Event('click', { cancelable: true });
    el.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('detaching mid-drag removes the transform and dragging state', () => {
    const { el, backdrop, onClose, detach } = setup();
    pointer(el, 'pointerdown', 200, 300, 0);
    pointer(el, 'pointermove', 120, 300, 50);
    detach();
    expect(el.style.transform).toBe('');
    expect(backdrop.style.opacity).toBe('');
    expect(el.classList.contains('dragging')).toBe(false);
    pointer(el, 'pointerup', 60, 300, 60); // listeners are gone
    expect(onClose).not.toHaveBeenCalled();
  });
});
