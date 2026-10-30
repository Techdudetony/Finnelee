import { useEffect, useRef, useState } from 'react';
import { useMotion } from './useMotion';

/**
 * Counts from 0 up to `target` the FIRST time a number appears (about 600ms, easing out).
 * After that, new values show straight away: a number that changes because your data
 * changed should never replay the animation. Below Full motion: no animation at all,
 * and a level that drops to Calm/Off mid-count (a saved setting loading) jumps to the end.
 */
export function useCountUp(target, duration = 600) {
  const full = useMotion() === 'full';
  const finished = useRef(!full);
  const [value, setValue] = useState(finished.current ? target : 0);

  useEffect(() => {
    if (!full) finished.current = true;
    if (finished.current) {
      setValue(target); // already counted once (or reduced motion): just show it
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, Math.max(0, now - start) / duration); // rAF's time can predate start
      const eased = 1 - (1 - t) ** 3; // ease-out cubic: fast at first, gentle at the end
      setValue(t < 1 ? target * eased : target);
      if (t < 1) frame = requestAnimationFrame(tick);
      else finished.current = true; // set at the END, so StrictMode's double effect still animates
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, full]);

  return full ? value : target; // below Full, never show a part-counted number, even for a frame
}
