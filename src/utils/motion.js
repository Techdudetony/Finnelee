// Motion levels for the whole app. One attribute on <html> (data-motion) drives both the
// CSS (styles.css keys every animation off it) and the few animations JavaScript starts.
//
//   full: page transitions, cards that grow into pages, count-ups, springy details
//   calm: short fades, plus a brief slide for the phone menu (it shows where the menu
//         lives). Nothing else travels, scales or counts.
//   off:  everything shows its end state at once
//
// The person picks a level in Settings (settings.motion). Until they do, it follows the
// device: Full, or Calm when the device asks for reduced motion. A device that asks for
// reduced motion also caps a saved "full" at Calm, so the OS setting is always respected.

export const MOTION_LEVELS = ['full', 'calm', 'off'];

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the device asks for less motion. */
export const deviceReducesMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCE_QUERY).matches);

/** The level to use: the saved choice (if valid), capped at Calm by the device setting. */
export function resolveMotion(saved, deviceReduces = deviceReducesMotion()) {
  const level = MOTION_LEVELS.includes(saved) ? saved : 'full';
  return deviceReduces && level === 'full' ? 'calm' : level;
}

// ---------- The current level (a tiny store, so React can subscribe) ----------

const listeners = new Set();
let current = 'full';

/** The level in effect right now. */
export const getMotion = () => current;

/** Applies a level: sets <html data-motion> and tells subscribers (useMotion). */
export function applyMotion(level) {
  if (!MOTION_LEVELS.includes(level) || level === current) return;
  current = level;
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = level;
  listeners.forEach((fn) => fn());
}

export function subscribeMotion(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let saved; // the signed-in person's choice, or undefined

/** App.jsx calls this with settings.motion (undefined when signed out or never chosen). */
export function setSavedMotion(level) {
  saved = level;
  applyMotion(resolveMotion(saved));
}

/** Call once at startup: applies the device default before the first paint, then follows it. */
export function startMotion() {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = current;
  applyMotion(resolveMotion(saved));
  window.matchMedia?.(REDUCE_QUERY).addEventListener?.('change', () =>
    applyMotion(resolveMotion(saved)),
  );
}

/**
 * Kept for older callers: true unless the level is Full. Count-ups and the error shake
 * only play at Full.
 */
export const prefersReducedMotion = () => current !== 'full';

/** A short side-to-side shake (wrong password). Full motion only. */
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

/**
 * Switches the visible page. At Full, and where the browser supports View Transitions,
 * the change cross-fades and `from` (a Dashboard card, say) grows into the new page's
 * title, which carries the same view-transition-name in styles.css. Everywhere else the
 * page just changes. `update` must apply the change synchronously (flushSync).
 *
 * Whatever the browser does (runs the transition, skips it, or throws), `update` runs
 * exactly once and the temporary naming below is always removed.
 */
let latestTransition = 0;

export function transitionTo(update, from) {
  const id = ++latestTransition;
  let navigated = false;
  const navigate = () => {
    if (navigated) return;
    navigated = true;
    update();
  };
  if (current !== 'full' || typeof document === 'undefined' || !document.startViewTransition) {
    navigate();
    return;
  }
  // While `from` carries the name, the outgoing page's own title must not (vt-from in
  // styles.css), or the name is duplicated and the browser skips the transition.
  const root = document.documentElement;
  const cleanUp = () => {
    if (from) from.style.viewTransitionName = ''; // the new page's title takes it over
    // A late safety-net call must not undo a newer transition's setup.
    if (id === latestTransition) root.classList.remove('vt-from');
  };
  const finish = () => {
    cleanUp();
    navigate();
  };
  if (from) {
    from.style.viewTransitionName = 'page-hero';
    root.classList.add('vt-from');
  }
  let transition;
  try {
    transition = document.startViewTransition(finish);
  } catch {
    finish(); // the API threw: switch pages without the animation
    return;
  }
  // A skipped transition (tab hidden, snapshot failed) rejects `ready`, which is not an
  // error worth reporting. `finished` settles in every case, so it is the safety net
  // should a browser skip without calling `finish`.
  transition?.ready?.catch(() => {});
  transition?.finished?.then(finish, finish);
}
