// Depth and touch for cards. One set of listeners on the document (no per-card React state):
//
//   - Stat tiles (.grid-stats > .card) tilt a few degrees toward the pointer.
//   - Stat tiles and paired cards (.grid-2 > .card) get a soft glow under the pointer.
//
// Mouse and pen only, at Full motion only. Touch never tilts (a finger on a card is
// usually the start of a scroll); it gets the CSS press instead. Work happens in at most
// one requestAnimationFrame per pointer move, and nothing runs while the pointer is still.

import { getMotion, subscribeMotion } from './motion';

export const TILT_SELECTOR = '.grid-stats > .card';
export const LIT_SELECTOR = `${TILT_SELECTOR}, .grid-2 > .card`;
export const MAX_TILT = 5; // degrees: enough to feel physical, not enough to blur the number

/**
 * Tilt and glow position for a pointer at (x, y) over a card's rect. Pure, so it's tested.
 * rx tips the top edge toward the pointer, ry the side; mx/my place the glow.
 */
export function tiltFor(x, y, rect) {
  const px = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
  const py = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
  const round = (n) => Math.round(n * 100) / 100;
  return {
    rx: round((0.5 - py) * 2 * MAX_TILT),
    ry: round((px - 0.5) * 2 * MAX_TILT),
    mx: round(px * 100),
    my: round(py * 100),
  };
}

const VARS = ['--rx', '--ry', '--mx', '--my'];

/**
 * Starts the listeners on `doc`; returns a function that removes them.
 * `raf`/`caf` are injectable so tests can hold a frame and run it later.
 */
export function startSurfaces(
  doc = document,
  raf = (fn) => requestAnimationFrame(fn),
  caf = (id) => cancelAnimationFrame(id),
) {
  let card = null; // the card under the pointer
  let pending = null; // { card, x, y }: the latest move, waiting for the next frame
  let frame = 0; // id of the queued frame, 0 when none

  // Drops any queued frame and its move, so nothing paints after this point.
  const cancelFrame = () => {
    if (frame) caf(frame);
    frame = 0;
    pending = null;
  };

  const release = () => {
    cancelFrame();
    if (!card) return;
    VARS.forEach((v) => card.style.removeProperty(v));
    card.classList.remove('lit', 'tilting'); // CSS eases it back to flat
    card = null;
  };

  const paint = () => {
    frame = 0;
    const move = pending;
    pending = null;
    // A frame queued for an earlier card, or before a switch to Calm/Off, does nothing.
    if (!move || move.card !== card || getMotion() !== 'full') return;
    const t = tiltFor(move.x, move.y, card.getBoundingClientRect());
    card.style.setProperty('--mx', `${t.mx}%`);
    card.style.setProperty('--my', `${t.my}%`);
    if (card.matches(TILT_SELECTOR)) {
      card.style.setProperty('--rx', `${t.rx}deg`);
      card.style.setProperty('--ry', `${t.ry}deg`);
      card.classList.add('tilting');
    }
    card.classList.add('lit');
  };

  const move = (e) => {
    if (e.pointerType === 'touch' || getMotion() !== 'full') return release();
    const next = e.target?.closest?.(LIT_SELECTOR) ?? null;
    if (next !== card) release(); // also cancels a frame queued for the old card
    if (!next) return;
    card = next;
    pending = { card, x: e.clientX, y: e.clientY };
    if (!frame) frame = raf(paint);
  };
  // Leaving the window puts the card back (relatedTarget is null when the pointer leaves).
  const leave = (e) => {
    if (!e.relatedTarget) release();
  };

  doc.addEventListener('pointermove', move, { passive: true });
  doc.addEventListener('pointerout', leave, { passive: true });
  doc.addEventListener('pointercancel', release, { passive: true });
  const unsubscribe = subscribeMotion(() => {
    if (getMotion() !== 'full') release(); // switching to Calm/Off flattens at once
  });
  return () => {
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerout', leave);
    doc.removeEventListener('pointercancel', release);
    unsubscribe();
    release();
  };
}
