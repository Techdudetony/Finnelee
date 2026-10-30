// Motion helpers for the few animations JavaScript starts (CSS handles the rest).
// CSS animations are switched off by the reduced-motion block in styles.css; JS ones
// must check for themselves, so they all go through prefersReducedMotion().

/** True when the person asked their device for less motion. */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** A short side-to-side shake (wrong password). Does nothing with reduced motion. */
export function shake(element) {
  if (!element?.animate || prefersReducedMotion()) return;
  element.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-8px)' },
      { transform: 'translateX(7px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 380, easing: 'ease-out' },
  );
}
