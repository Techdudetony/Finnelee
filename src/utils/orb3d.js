// The experimental 3D Orb's switch and its session-long fallback. Kept tiny because it is
// in the main bundle; the renderer itself (orbGl.js) only loads when this says yes.

let failure = null; // why the 3D Orb stopped this session, or null

/**
 * Whether to try the WebGL Orb: the Settings switch is on (settings.orb3d, off unless
 * it is exactly true, so older backups read as off), motion is Full, the browser has
 * WebGL, and it hasn't already failed this session.
 */
export const orb3dAllowed = (on, full) =>
  on === true &&
  full &&
  !failure &&
  typeof WebGLRenderingContext !== "undefined";

/**
 * Remembers why the 3D Orb stopped, until the page is reloaded:
 * "unsupported", "shader", "lost" (graphics context lost) or "slow" (failed warm-up).
 */
export const failOrb3d = (why) => {
  failure = why;
};

export const orb3dFailure = () => failure;
