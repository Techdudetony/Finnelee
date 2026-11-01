// The Health Orb's drawing and its render loop, kept apart from React so both are tested.
// Canvas 2D only (no WebGL, no library). The orb is decorative: every number it shows is
// also plain text in the pillar list, so nothing here is needed to read the score.

export const FILL_MS = 1200; // fill animation on page open (spec: at most 1.6 s)
export const FRAME_MS = 1000 / 30; // idle animation runs at about 30 fps to save battery
export const MAX_DPR = 2; // canvas resolution cap

const TAU = Math.PI * 2;
const GAP = 0.06; // radians between ring segments
const PHASE_MS = 900; // wave speed: higher is slower
const LEAN_MS = 220; // how quickly the liquid follows the pointer

// Rising bubbles: horizontal spot (-1..1), size, speed and start offset. They stay to
// the sides so they never pass behind the score text.
const BUBBLES = [
  { x: -0.62, r: 1.6, speed: 0.11, offset: 0.1 },
  { x: -0.48, r: 2.2, speed: 0.08, offset: 0.55 },
  { x: 0.5, r: 1.4, speed: 0.13, offset: 0.3 },
  { x: 0.64, r: 1.9, speed: 0.09, offset: 0.8 },
  { x: -0.7, r: 1.1, speed: 0.15, offset: 0.95 },
];

/**
 * One ring segment per pillar, clockwise from 12 o'clock. A scored pillar fills its
 * segment to its score; a "needs-data" pillar is a dashed, unfilled segment.
 */
export function orbSegments(pillars) {
  const span = TAU / pillars.length;
  return pillars.map((p, i) => {
    const start = -Math.PI / 2 + i * span + GAP / 2;
    const end = start + span - GAP;
    const missing = p.state === 'needs-data' || p.score == null;
    return {
      id: p.id,
      start,
      end,
      fillEnd: missing ? start : start + (end - start) * (p.score / 100),
      dashed: missing,
      color: i,
    };
  });
}

/** Eases 0..1 the way the rest of the app does (fast start, gentle end). */
export const easeOut = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

// The liquid's surface height at x: two sine waves, tipped by `lean`.
const surface = (u, level, phase, amp, lean) =>
  level +
  Math.sin(u * 2.6 + phase) * amp +
  Math.sin(u * 5.3 - phase * 1.4) * amp * 0.35 +
  u * lean * 9;

// Traces a wave across the bowl and closes it along the bottom.
function wavePath(ctx, c, r, y) {
  ctx.beginPath();
  ctx.moveTo(c - r, c + r);
  for (let x = c - r; x <= c + r + 0.1; x += 3) ctx.lineTo(x, y((x - c) / r));
  ctx.lineTo(c + r, c + r);
  ctx.closePath();
}

/**
 * Draws one frame. `progress` (0..1) is how far the fill has run; `phase` moves the
 * waves and bubbles, and `lean` (-1..1) tips the liquid toward the pointer.
 * colors: { series[], track, glassInner, glassEdge, rimShade, liquidBack, liquidTop,
 *           liquidBottom, crest, bubble, specular }
 */
export function drawOrb(ctx, { size, score, segments, colors, progress = 1, phase = 0, lean = 0 }) {
  const c = size / 2;
  const ringR = size / 2 - 8;
  const r = ringR - 14; // glass sphere radius
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';

  // Ring: a faint track, then each pillar's segment filled to its score.
  for (const s of segments) {
    ctx.lineWidth = 7;
    ctx.setLineDash(s.dashed ? [3, 6] : []);
    ctx.strokeStyle = colors.track;
    ctx.beginPath();
    ctx.arc(c, c, ringR, s.start, s.end);
    ctx.stroke();
    if (s.dashed) continue;
    const end = s.start + (s.fillEnd - s.start) * progress;
    if (end <= s.start) continue;
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.series[s.color % colors.series.length];
    ctx.beginPath();
    ctx.arc(c, c, ringR, s.start, end);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Glass sphere: lit from the top left, darker toward the rim.
  const glass = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
  glass.addColorStop(0, colors.glassInner);
  glass.addColorStop(1, colors.glassEdge);
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fill();

  if (score != null) {
    // Liquid, clipped to the sphere.
    const level = c + r - 2 * r * (score / 100) * progress;
    const amp = 2.6 + 2.4 * Math.abs(lean);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.clip();

    // Back wave: darker, out of step, gives the surface depth.
    ctx.fillStyle = colors.liquidBack;
    wavePath(ctx, c, r, (u) => surface(u, level - 3, phase * 0.8 + 2, amp * 0.8, lean * 0.6));
    ctx.fill();

    // Front wave: deeper color toward the bottom.
    const front = (u) => surface(u, level, phase, amp, lean);
    const body = ctx.createLinearGradient(0, level - amp, 0, c + r);
    body.addColorStop(0, colors.liquidTop);
    body.addColorStop(1, colors.liquidBottom);
    ctx.fillStyle = body;
    wavePath(ctx, c, r, front);
    ctx.fill();

    // Bubbles rise from the bottom and pop at the surface.
    ctx.fillStyle = colors.bubble;
    for (const b of BUBBLES) {
      const t = (phase * b.speed + b.offset) % 1;
      const y = c + r - t * (c + r - level);
      const x = c + b.x * r + Math.sin(phase + b.offset * 9) * 2;
      if (y < front((x - c) / r) + 3) continue;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, TAU);
      ctx.fill();
    }

    // Bright crest where light catches the surface.
    ctx.strokeStyle = colors.crest;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = c - r; x <= c + r + 0.1; x += 3) {
      const y = front((x - c) / r);
      if (x === c - r) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Rim shade: curves the glass so it reads as a sphere, not a disc.
  const rim = ctx.createRadialGradient(c, c, r * 0.6, c, c, r);
  rim.addColorStop(0, 'rgb(0 0 0 / 0)');
  rim.addColorStop(1, colors.rimShade);
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fill();

  // Specular highlight, top left (clear of the score in the middle).
  const sx = c - r * 0.5;
  const sy = c - r * 0.6;
  const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.27);
  spec.addColorStop(0, colors.specular);
  spec.addColorStop(1, 'rgb(255 255 255 / 0)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.26, r * 0.14, -Math.PI / 5, 0, TAU);
  ctx.fill();

  // Thin reflected light along the lower right rim.
  ctx.strokeStyle = colors.specular;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(c, c, r - 3, Math.PI * 0.1, Math.PI * 0.42);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The render loop. At Full motion, on screen, in a visible tab (`canAnimate()`), it fills
 * on open and then keeps the liquid moving at about 30 fps. The moment any of those stops
 * being true, it draws one finished frame and asks for no more frames.
 * render(progress, phase, lean) draws; raf/caf/now are injected for tests.
 */
export function createOrbLoop({ render, canAnimate, raf, caf, now }) {
  let frame = 0;
  let fillStart = null; // when the fill began, or null once it's done
  let phase = 0;
  let lean = 0;
  let leanTarget = 0;
  let last = 0; // time of the last drawn frame

  const progress = (t) => (fillStart == null ? 1 : easeOut((t - fillStart) / FILL_MS));

  const tick = () => {
    frame = 0;
    if (!canAnimate()) return settle();
    frame = raf(tick); // keep going while the orb can animate
    const t = now();
    const dt = t - last;
    if (dt < FRAME_MS - 1) return; // ~30 fps: skip this display frame
    last = t;
    const step = Math.min(dt, 100); // no jump after a stalled tab
    phase += step / PHASE_MS;
    lean += (leanTarget - lean) * Math.min(1, step / LEAN_MS);
    const p = progress(t);
    render(p, phase, lean);
    if (p >= 1) fillStart = null;
  };
  const start = () => {
    if (frame || !canAnimate()) return;
    last = now();
    frame = raf(tick);
  };
  // Draws the finished frame once and cancels any queued frame.
  const settle = () => {
    if (frame) caf(frame);
    frame = 0;
    fillStart = null;
    lean = leanTarget;
    render(1, phase, lean);
  };

  return {
    /** Page open: fill from empty at Full motion, otherwise one finished frame. */
    play() {
      if (!canAnimate()) return settle();
      fillStart = now();
      render(0, phase, lean);
      start();
    },
    /** Back on screen, tab shown, or motion turned up: keep moving (no refill). */
    resume() {
      if (canAnimate()) start();
    },
    /** Tip the liquid toward a pointer: -1 left, 0 level, 1 right. */
    setLean(value) {
      leanTarget = Math.max(-1, Math.min(1, value));
    },
    /** Motion turned down, or a redraw is needed: draw the end state and stop. */
    redraw: settle,
    /** Unmount, offscreen or hidden tab: stop without drawing. */
    stop() {
      if (frame) caf(frame);
      frame = 0;
    },
    get running() {
      return frame !== 0;
    },
  };
}
