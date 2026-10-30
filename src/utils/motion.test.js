import { describe, expect, it, vi } from 'vitest';
import {
  MOTION_LEVELS,
  applyMotion,
  getMotion,
  prefersReducedMotion,
  resolveMotion,
  setSavedMotion,
  subscribeMotion,
  transitionTo,
} from './motion';

describe('resolveMotion', () => {
  it('uses the saved level when the device has no preference', () => {
    for (const level of MOTION_LEVELS) expect(resolveMotion(level, false)).toBe(level);
  });

  it('defaults to Full, or Calm when the device asks for reduced motion', () => {
    expect(resolveMotion(undefined, false)).toBe('full');
    expect(resolveMotion(undefined, true)).toBe('calm');
  });

  it('a device asking for reduced motion caps a saved Full at Calm, and keeps Calm and Off', () => {
    expect(resolveMotion('full', true)).toBe('calm');
    expect(resolveMotion('calm', true)).toBe('calm');
    expect(resolveMotion('off', true)).toBe('off');
  });

  it('an invalid saved value (old backup, hand edit) reads as no choice', () => {
    for (const bad of ['FULL', 'fast', '', null, 1, {}]) {
      expect(resolveMotion(bad, false)).toBe('full');
      expect(resolveMotion(bad, true)).toBe('calm');
    }
  });
});

describe('the current level', () => {
  it('applyMotion updates the level and notifies subscribers once per change', () => {
    const fn = vi.fn();
    const stop = subscribeMotion(fn);
    applyMotion('off');
    applyMotion('off'); // no change, no notification
    applyMotion('nonsense'); // ignored
    expect(getMotion()).toBe('off');
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    applyMotion('full');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('count-ups and the shake only play at Full', () => {
    applyMotion('full');
    expect(prefersReducedMotion()).toBe(false);
    applyMotion('calm');
    expect(prefersReducedMotion()).toBe(true);
    applyMotion('off');
    expect(prefersReducedMotion()).toBe(true);
  });

  it('setSavedMotion applies the saved choice (no device preference outside a browser)', () => {
    setSavedMotion('calm');
    expect(getMotion()).toBe('calm');
    setSavedMotion(undefined); // signed out: back to the device default
    expect(getMotion()).toBe('full');
  });
});

describe('transitionTo', () => {
  it('without View Transitions (or below Full) it just applies the change', () => {
    applyMotion('full');
    const update = vi.fn();
    transitionTo(update, null);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('at Full, hands the name from the tile to the new title, never both at once', async () => {
    applyMotion('full');
    const classes = new Set();
    const seen = {};
    const from = { style: { viewTransitionName: '' } };
    globalThis.document = {
      documentElement: {
        dataset: {},
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
      },
      startViewTransition(cb) {
        // The old snapshot is taken now: only the tile is named, the old title is not.
        seen.before = { tile: from.style.viewTransitionName, vtFrom: classes.has('vt-from') };
        cb();
        seen.after = { tile: from.style.viewTransitionName, vtFrom: classes.has('vt-from') };
        return { ready: Promise.reject(new Error('Snapshot capture failed')) };
      },
    };
    try {
      const update = vi.fn();
      transitionTo(update, from);
      await Promise.resolve(); // a skipped transition must not leave an unhandled rejection
      expect(update).toHaveBeenCalledTimes(1);
      expect(seen.before).toEqual({ tile: 'page-hero', vtFrom: true });
      expect(seen.after).toEqual({ tile: '', vtFrom: false });
    } finally {
      delete globalThis.document;
    }
  });
});
