import { afterEach, describe, expect, it } from 'vitest';
import { applyMotion } from './motion';
import { MAX_TILT, startSurfaces, tiltFor } from './surfaces';

const RECT = { left: 100, top: 50, width: 200, height: 100 };

describe('tiltFor', () => {
  it('is flat with the glow centred when the pointer is in the middle', () => {
    expect(tiltFor(200, 100, RECT)).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 });
  });

  it('tips toward the corner under the pointer, never past MAX_TILT', () => {
    expect(tiltFor(100, 50, RECT)).toEqual({ rx: MAX_TILT, ry: -MAX_TILT, mx: 0, my: 0 });
    expect(tiltFor(300, 150, RECT)).toEqual({ rx: -MAX_TILT, ry: MAX_TILT, mx: 100, my: 100 });
  });

  it('clamps a pointer just outside the card (fast moves, rounding at the edge)', () => {
    expect(tiltFor(9999, -9999, RECT)).toEqual({ rx: MAX_TILT, ry: MAX_TILT, mx: 100, my: 0 });
  });
});

// A card stand-in: what surfaces.js reads (rect, matches, closest) and writes (style, classes).
function fakeCard(isTile) {
  const props = new Map();
  const classes = new Set();
  const card = {
    style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
    },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
    },
    getBoundingClientRect: () => RECT,
    matches: () => isTile,
    props,
    classes,
  };
  card.closest = () => card;
  return card;
}

function setup() {
  const doc = new EventTarget();
  const frames = [];
  const stop = startSurfaces(doc, (fn) => frames.push(fn) && frames.length);
  const flush = () => frames.splice(0).forEach((fn) => fn());
  const move = (target, x, y, pointerType = 'mouse') => {
    const e = new Event('pointermove');
    Object.assign(e, { clientX: x, clientY: y, pointerType });
    Object.defineProperty(e, 'target', { value: target });
    doc.dispatchEvent(e);
  };
  return { doc, frames, flush, move, stop };
}

describe('startSurfaces', () => {
  afterEach(() => applyMotion('full'));

  it('tilts and lights a stat tile at Full, once per frame however many moves', () => {
    applyMotion('full');
    const { frames, flush, move, stop } = setup();
    const tile = fakeCard(true);
    move(tile, 100, 50);
    move(tile, 120, 60);
    move(tile, 300, 150);
    expect(frames).toHaveLength(1); // three moves, one frame of work
    flush();
    expect(tile.props.get('--rx')).toBe(`${-MAX_TILT}deg`); // the latest move wins
    expect(tile.props.get('--mx')).toBe('100%');
    expect([...tile.classes]).toEqual(['tilting', 'lit']);
    stop();
  });

  it('only lights a paired card: no tilt', () => {
    applyMotion('full');
    const { flush, move, stop } = setup();
    const card = fakeCard(false);
    move(card, 150, 75);
    flush();
    expect(card.props.has('--rx')).toBe(false);
    expect(card.props.get('--mx')).toBe('25%');
    expect([...card.classes]).toEqual(['lit']);
    stop();
  });

  it('ignores touch, and does nothing at Calm or Off', () => {
    const { frames, move, stop } = setup();
    const tile = fakeCard(true);
    applyMotion('full');
    move(tile, 150, 75, 'touch');
    applyMotion('calm');
    move(tile, 150, 75);
    applyMotion('off');
    move(tile, 150, 75);
    expect(frames).toHaveLength(0);
    expect(tile.props.size).toBe(0);
    stop();
  });

  it('flattens the card when the pointer moves to another card or leaves the window', () => {
    applyMotion('full');
    const { doc, flush, move, stop } = setup();
    const a = fakeCard(true);
    const b = fakeCard(true);
    move(a, 150, 75);
    flush();
    move(b, 150, 75);
    expect(a.props.size).toBe(0);
    expect(a.classes.size).toBe(0);
    flush();
    const out = new Event('pointerout');
    Object.defineProperty(out, 'relatedTarget', { value: null });
    doc.dispatchEvent(out);
    expect(b.props.size).toBe(0);
    expect(b.classes.size).toBe(0);
    stop();
  });

  it('switching to Calm flattens a tilted card at once', () => {
    applyMotion('full');
    const { flush, move, stop } = setup();
    const tile = fakeCard(true);
    move(tile, 100, 50);
    flush();
    applyMotion('calm');
    expect(tile.props.size).toBe(0);
    expect(tile.classes.size).toBe(0);
    stop();
  });

  it('stop() removes the listeners and flattens the card', () => {
    applyMotion('full');
    const { frames, flush, move, stop } = setup();
    const tile = fakeCard(true);
    move(tile, 100, 50);
    flush();
    stop();
    expect(tile.props.size).toBe(0);
    move(tile, 100, 50);
    expect(frames).toHaveLength(0);
  });
});
