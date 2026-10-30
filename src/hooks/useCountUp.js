import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../utils/motion';

/**
 * Counts from 0 up to `target` the FIRST time a number appears (about 600ms, easing out).
 * After that, new values show straight away: a number that changes because your data
 * changed should never replay the animation. Reduced motion: no animation at all.
 */
export function useCountUp(target, duration = 600) {
  const finished = useRef(prefersReducedMotion());
  const [value, setValue] = useState(finished.current ? target : 0);

  useEffect(() => {
    if (finished.current) {
      setValue(target); // already counted once (or reduced motion): just show it
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic: fast at first, gentle at the end
      setValue(t < 1 ? target * eased : target);
      if (t < 1) frame = requestAnimationFrame(tick);
      else finished.current = true; // set at the END, so StrictMode's double effect still animates
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
