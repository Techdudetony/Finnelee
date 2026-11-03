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

// A wave across the bowl, closed along the bottom: [[x, y], ...], clockwise on screen.
function wavePoints(c, r, y) {
  const points = [[c - r, c + r]];
  for (let x = c - r; x <= c + r + 0.1; x += 3) points.push([x, y((x - c) / r)]);
  points.push([c + r, c + r]);
  return points;
}

const isInside = ([x, y], c, r) => (x - c) ** 2 + (y - c) ** 2 < r * r;

/**
 * The parts of a closed shape's edges that lie inside the circle (c, c, r), each as
 * { points } from where it enters to where it leaves. Walked from a corner outside the
 * circle, so every part has both ends on the circle.
 */
function insideRuns(points, c, r) {
  const n = points.length;
  const start = points.findIndex((p) => !isInside(p, c, r));
  const runs = [];
  let run = null;
  for (let k = 0; k < n; k++) {
    const p = points[(start + k) % n];
    const q = points[(start + k + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const a = dx * dx + dy * dy;
    const b = 2 * (dx * (p[0] - c) + dy * (p[1] - c));
    const cc = (p[0] - c) ** 2 + (p[1] - c) ** 2 - r * r;
    const disc = b * b - 4 * a * cc;
    if (a === 0 || disc <= 0) continue; // misses the circle, or only touches it
    const t0 = (-b - Math.sqrt(disc)) / (2 * a);
    const t1 = (-b + Math.sqrt(disc)) / (2 * a);
    if (t1 <= 0 || t0 >= 1) continue; // the edge stops short of the circle
    if (t0 > 0) run = { points: [[p[0] + dx * t0, p[1] + dy * t0]] }; // enters
    run ??= { points: [p] }; // p sat right on the circle
    if (t1 < 1) {
      run.points.push([p[0] + dx * t1, p[1] + dy * t1]); // leaves
      runs.push(run);
      run = null;
    } else run.points.push(q); // q is inside: the run goes on
  }
  return runs;
}

/**
 * Traces the part of a clockwise polygon that lies inside the circle (c, c, r): its
 * edges where they're inside, joined by arcs of the circle. Filling this path looks the
 * same as filling the polygon under a circle clip, without the clip's per-pixel cost
 * (issue #25). Exported for tests.
 */
export function tracePolygonInCircle(ctx, points, c, r) {
  const n = points.length;
  const angle = ([x, y]) => Math.atan2(y - c, x - c);
  ctx.beginPath();
  if (points.every((p) => isInside(p, c, r))) {
    // All corners inside: the polygon itself.
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    return;
  }
  const runs = insideRuns(points, c, r);

  if (!runs.length) {
    // No edge crosses: the whole circle is inside the polygon, or none of it is.
    let wraps = false; // ray cast from the center
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > c !== yj > c && c < ((xj - xi) * (c - yi)) / (yj - yi) + xi) wraps = !wraps;
    }
    if (wraps) ctx.arc(c, c, r, 0, Math.PI * 2);
    return;
  }

  // Each exit follows the circle clockwise to the nearest entry, until a loop closes.
  const TAU2 = Math.PI * 2;
  const entries = runs.map((u) => angle(u.points[0]));
  const done = new Set();
  for (let first = 0; first < runs.length; first++) {
    if (done.has(first)) continue;
    let i = first;
    ctx.moveTo(...runs[i].points[0]);
    do {
      done.add(i);
      runs[i].points.forEach((pt) => ctx.lineTo(...pt));
      const from = angle(runs[i].points.at(-1));
      let next = first;
      let best = Infinity;
      runs.forEach((_, j) => {
        const turn = (((entries[j] - from) % TAU2) + TAU2) % TAU2;
        if (turn < best) [best, next] = [turn, j];
      });
      ctx.arc(c, c, r, from, from + best);
      i = next;
    } while (i !== first && !done.has(i));
    ctx.closePath();
  }
}

// Shared sizes: center, ring radius and glass sphere radius.
const geometry = (size) => {
  const ringR = size / 2 - 8;
  return { c: size / 2, ringR, r: ringR - 14 };
};

/**
 * Draws one frame. `progress` (0..1) is how far the fill has run; `phase` moves the
 * waves and bubbles, and `lean` (-1..1) tips the liquid toward the pointer.
 * colors: { series[], track, glassInner, glassEdge, rimShade, liquidBack, liquidTop,
 *           liquidBottom, crest, bubble, specular }
 * layers (optional, from paintOrbLayers): the parts that never move, drawn once. With
 * them, a frame after the fill only copies two images and draws the liquid (issue #25).
 */
export function drawOrb(
  ctx,
  { size, score, segments, colors, progress = 1, phase = 0, lean = 0, layers },
) {
  ctx.clearRect(0, 0, size, size);
  // The ring grows during the fill, so it is drawn live until the fill ends.
  if (layers && progress >= 1) ctx.drawImage(layers.under, 0, 0, size, size);
  else drawUnder(ctx, { size, segments, colors, progress });
  drawLiquid(ctx, { size, score, colors, progress, phase, lean });
  if (layers) ctx.drawImage(layers.over, 0, 0, size, size);
  else drawOver(ctx, { size, colors });
}

/**
 * Paints the still layers once, at the canvas's resolution: `under` (ring and glass,
 * finished fill) and `over` (rim shade and highlights). makeCanvas(w, h) returns a
 * canvas; null when it can't, and drawOrb then draws everything each frame.
 */
export function paintOrbLayers({ size, segments, colors, dpr = 1, makeCanvas }) {
  const layer = (draw) => {
    const canvas = makeCanvas(size * dpr, size * dpr);
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx);
    return canvas;
  };
  const under = layer((ctx) => drawUnder(ctx, { size, segments, colors, progress: 1 }));
  const over = layer((ctx) => drawOver(ctx, { size, colors }));
  return under && over ? { under, over } : null;
}

// Ring segments and the glass sphere: everything behind the liquid.
function drawUnder(ctx, { size, segments, colors, progress }) {
  const { c, ringR, r } = geometry(size);
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
}

// The liquid, clipped to the sphere: the only part that moves after the fill.
function drawLiquid(ctx, { size, score, colors, progress, phase, lean }) {
  const { c, r } = geometry(size);
  if (score != null) {
    // Liquid, clipped to the sphere.
    const level = c + r - 2 * r * (score / 100) * progress;
    const amp = 2.6 + 2.4 * Math.abs(lean);

    // Back wave: darker, out of step, gives the surface depth.
    ctx.fillStyle = colors.liquidBack;
    const back = (u) => surface(u, level - 3, phase * 0.8 + 2, amp * 0.8, lean * 0.6);
    tracePolygonInCircle(ctx, wavePoints(c, r, back), c, r);
    ctx.fill();

    // Front wave: deeper color toward the bottom.
    const front = (u) => surface(u, level, phase, amp, lean);
    const body = ctx.createLinearGradient(0, level - amp, 0, c + r);
    body.addColorStop(0, colors.liquidTop);
    body.addColorStop(1, colors.liquidBottom);
    ctx.fillStyle = body;
    tracePolygonInCircle(ctx, wavePoints(c, r, front), c, r);
    ctx.fill();

    // Bubbles rise from the bottom and pop at the surface. Clipped to the sphere only
    // while one is still crossing its edge (the clip is the costly part).
    const bubbles = [];
    for (const b of BUBBLES) {
      const t = (phase * b.speed + b.offset) % 1;
      const y = c + r - t * (c + r - level);
      const x = c + b.x * r + Math.sin(phase + b.offset * 9) * 2;
      if (y < front((x - c) / r) + 3) continue;
      bubbles.push({ x, y, r: b.r });
    }
    const crossing = bubbles.some((b) => Math.hypot(b.x - c, b.y - c) + b.r > r);
    ctx.save();
    if (crossing) {
      ctx.beginPath();
      ctx.arc(c, c, r, 0, TAU);
      ctx.clip();
    }
    ctx.fillStyle = colors.bubble;
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Bright crest where light catches the surface (thin, so its clip costs little).
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.clip();
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
}

// Rim shade and highlights: everything in front of the liquid.
function drawOver(ctx, { size, colors }) {
  const { c, r } = geometry(size);
  ctx.lineCap = 'round';

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
