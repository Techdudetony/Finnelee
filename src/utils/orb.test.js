import { describe, expect, it, vi } from 'vitest';
import {
  FILL_MS,
  FRAME_MS,
  createOrbLoop,
  drawOrb,
  easeOut,
  orbSegments,
  paintOrbLayers,
  tracePolygonInCircle,
} from './orb';

const pillar = (id, state, score) => ({ id, state, score });

describe('orbSegments', () => {
  const segs = orbSegments([
    pillar('savings', 'scored', 100),
    pillar('emergency', 'scored', 25),
    pillar('budgets', 'older', 50),
    pillar('bills', 'needs-data', null),
    pillar('debt', 'conflict', 0),
  ]);

  it("gives each pillar an equal arc, clockwise from 12 o'clock, with gaps", () => {
    expect(segs).toHaveLength(5);
    expect(segs[0].start).toBeGreaterThan(-Math.PI / 2);
    for (let i = 1; i < 5; i++) expect(segs[i].start).toBeGreaterThan(segs[i - 1].end);
    const spans = segs.map((s) => s.end - s.start);
    spans.forEach((s) => expect(s).toBeCloseTo(spans[0]));
  });

  it('fills each scored segment to its score', () => {
    const filled = (s) => (s.fillEnd - s.start) / (s.end - s.start);
    expect(filled(segs[0])).toBeCloseTo(1);
    expect(filled(segs[1])).toBeCloseTo(0.25);
    expect(filled(segs[2])).toBeCloseTo(0.5); // an older balance still scores
    expect(filled(segs[4])).toBeCloseTo(0);
  });

  it('draws a needs-data pillar dashed and empty', () => {
    expect(segs[3].dashed).toBe(true);
    expect(segs[3].fillEnd).toBe(segs[3].start);
    expect(segs.filter((s) => s.dashed)).toHaveLength(1);
  });
});

describe('easeOut', () => {
  it('runs 0 to 1 and clamps outside', () => {
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5); // fast start
  });
});

describe('drawOrb', () => {
  // A context that records what was drawn.
  const fakeCtx = () => {
    const calls = [];
    const record =
      (name) =>
      (...args) =>
        calls.push([name, ...args]);
    return {
      calls,
      clearRect: record('clearRect'),
      beginPath: record('beginPath'),
      arc: record('arc'),
      stroke: record('stroke'),
      fill: record('fill'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      closePath: record('closePath'),
      save: record('save'),
      restore: record('restore'),
      clip: record('clip'),
      setLineDash: record('setLineDash'),
      ellipse: record('ellipse'),
      drawImage: record('drawImage'),
      setTransform: record('setTransform'),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
    };
  };
  const colors = {
    series: ['#1', '#2', '#3', '#4', '#5'],
    track: '#t',
    glassInner: '#g',
    glassEdge: '#e',
    rimShade: '#r',
    liquidBack: '#k',
    liquidTop: '#a',
    liquidBottom: '#b',
    crest: '#c',
    bubble: '#u',
    specular: '#s',
  };
  const segments = orbSegments([pillar('a', 'scored', 80)]);

  it('draws no liquid without a score (the orb sits empty)', () => {
    const ctx = fakeCtx();
    drawOrb(ctx, { size: 200, score: null, segments, colors });
    expect(ctx.calls.some(([n]) => n === 'clip')).toBe(false);
  });

  it('draws the liquid when there is a score', () => {
    const ctx = fakeCtx();
    drawOrb(ctx, { size: 200, score: 80, segments, colors });
    expect(ctx.calls.some(([n]) => n === 'clip')).toBe(true);
  });

  it('keeps every save paired with a restore', () => {
    const ctx = fakeCtx();
    drawOrb(ctx, { size: 200, score: 50, segments, colors, phase: 3 });
    const count = (name) => ctx.calls.filter(([n]) => n === name).length;
    expect(count('save')).toBe(count('restore'));
  });

  // Issue #25: the parts that never move are painted once, into two layers.
  const layerCanvas = () => {
    const ctx = fakeCtx();
    return { ctx, getContext: () => ctx };
  };
  const made = [];
  const layers = paintOrbLayers({
    size: 200,
    segments,
    colors,
    dpr: 2,
    makeCanvas: (w, h) => {
      made.push([w, h]);
      return layerCanvas();
    },
  });
  const count = (ctx, name) => ctx.calls.filter(([n]) => n === name).length;

  it('paints the ring and glass under the liquid, the highlights over it', () => {
    expect(made).toEqual([
      [400, 400],
      [400, 400],
    ]);
    expect(layers.under.ctx.calls[0]).toEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
    expect(count(layers.under.ctx, 'setLineDash')).toBeGreaterThan(0); // ring
    expect(count(layers.over.ctx, 'ellipse')).toBe(1); // specular highlight
    expect(count(layers.over.ctx, 'setLineDash')).toBe(0);
  });

  it('gives up on layers when a canvas has no 2D context', () => {
    expect(paintOrbLayers({ size: 200, segments, colors, makeCanvas: () => null })).toBeNull();
  });

  it('after the fill, copies both layers and draws only the liquid', () => {
    const ctx = fakeCtx();
    drawOrb(ctx, { size: 200, score: 50, segments, colors, phase: 0, layers });
    const images = ctx.calls.filter(([n]) => n === 'drawImage').map((c) => c[1]);
    expect(images).toEqual([layers.under, layers.over]); // in that order
    expect(count(ctx, 'setLineDash')).toBe(0); // no ring drawn live
    expect(count(ctx, 'ellipse')).toBe(0); // no highlight drawn live
  });

  it('during the fill, draws the growing ring live and copies only the highlights', () => {
    const ctx = fakeCtx();
    drawOrb(ctx, { size: 200, score: 50, segments, colors, progress: 0.5, layers });
    const images = ctx.calls.filter(([n]) => n === 'drawImage').map((c) => c[1]);
    expect(images).toEqual([layers.over]);
    expect(count(ctx, 'setLineDash')).toBeGreaterThan(0);
  });

  it('clips the bubbles only while one is crossing the glass edge', () => {
    // Over a few seconds of waves: the crest is always clipped (1), and the bubbles too
    // (2) only in the frames where one is rising in through the bottom of the sphere.
    const clips = new Set();
    for (let phase = 0; phase < 20; phase += 0.25) {
      const ctx = fakeCtx();
      drawOrb(ctx, { size: 200, score: 50, segments, colors, phase, layers });
      clips.add(count(ctx, 'clip'));
    }
    expect([...clips].sort()).toEqual([1, 2]);
  });
});

describe('tracePolygonInCircle', () => {
  // Records the path: moveTo, lineTo and arc calls.
  const pathOf = (points) => {
    const calls = [];
    const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
    tracePolygonInCircle(ctx, points, 100, 50);
    return calls.filter(([n]) => n !== 'beginPath');
  };
  const arcSweep = (calls) =>
    calls.filter(([n]) => n === 'arc').reduce((t, [, , , , from, to]) => t + (to - from), 0);

  it('is the whole circle when the polygon covers it', () => {
    const calls = pathOf([
      [0, 200],
      [0, 0],
      [200, 0],
      [200, 200],
    ]);
    expect(calls).toEqual([['arc', 100, 100, 50, 0, Math.PI * 2]]);
  });

  it('is empty when the polygon misses the circle', () => {
    expect(
      pathOf([
        [0, 40],
        [0, 0],
        [200, 0],
        [200, 40],
      ]),
    ).toEqual([]);
  });

  it('is the polygon itself when it fits inside', () => {
    const calls = pathOf([
      [90, 110],
      [90, 90],
      [110, 90],
      [110, 110],
    ]);
    expect(calls.map(([n]) => n)).toEqual(['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']);
  });

  it('a flat surface through the center keeps the lower half, closed along the circle', () => {
    // The liquid at 50%: a level line at y = 100 across the bowl, closed along the bottom.
    const calls = pathOf([
      [40, 160],
      [40, 100],
      [160, 100],
      [160, 160],
    ]);
    expect(calls[0][0]).toBe('moveTo');
    expect(calls.at(-1)).toEqual(['closePath']);
    expect(arcSweep(calls)).toBeCloseTo(Math.PI); // the bottom half of the circle
    for (const [, x, y] of calls.filter(([n]) => n === 'lineTo' || n === 'moveTo')) {
      expect(Math.hypot(x - 100, y - 100)).toBeLessThanOrEqual(50 + 1e-9); // never outside
    }
  });

  // ---- The traced shape matches "polygon under a circle clip", point by point ----

  // Records a path, then flattens it (arcs into short steps) into closed loops.
  const loopsOf = (points, c, r) => {
    const loops = [];
    let loop = null;
    const ctx = {
      beginPath() {},
      moveTo: (x, y) => loops.push((loop = [[x, y]])),
      lineTo: (x, y) => (loop ??= loops.push((loop = [])) && loop).push([x, y]),
      closePath: () => (loop = null),
      arc(cx, cy, rr, from, to) {
        if (!loop) loops.push((loop = []));
        const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 0.02));
        for (let i = 0; i <= steps; i++) {
          const t = from + ((to - from) * i) / steps;
          loop.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
        }
      },
    };
    tracePolygonInCircle(ctx, points, c, r);
    return loops;
  };
  // Nonzero winding (the canvas default fill rule) along one row: where each edge crosses
  // y, and which way. A point at x is filled when the crossings left of it don't cancel.
  const crossings = (loops, y) => {
    const out = [];
    for (const loop of loops)
      for (let i = 0; i < loop.length; i++) {
        const [x1, y1] = loop[i];
        const [x2, y2] = loop[(i + 1) % loop.length];
        if (y1 <= y !== y2 <= y)
          out.push([x1 + ((y - y1) * (x2 - x1)) / (y2 - y1), y2 > y1 ? 1 : -1]);
      }
    return out.sort((a, b) => a[0] - b[0]);
  };
  const filledAt = (row, x) => row.reduce((w, [cx, d]) => (cx < x ? w + d : w), 0) !== 0;
  const nearest = (row, x) => row.reduce((m, [cx]) => Math.min(m, Math.abs(cx - x)), Infinity);
  /** Points (on a 1 px grid) where the traced fill and "polygon ∩ circle" disagree. */
  const mismatches = (points, c = 100, r = 78) => {
    const loops = loopsOf(points, c, r);
    const bad = [];
    for (let y = c - r - 4.071; y <= c + r + 4; y += 1) {
      const traced = crossings(loops, y);
      const shape = crossings([points], y);
      for (let x = c - r - 4.123; x <= c + r + 4; x += 1) {
        const d = Math.hypot(x - c, y - c);
        // Skip points right on an edge, where antialiasing decides anyway.
        if (Math.abs(d - r) < 0.05 || nearest(shape, x) < 0.05) continue;
        if (filledAt(traced, x) !== (filledAt(shape, x) && d < r)) bad.push([x, y]);
      }
    }
    return bad;
  };

  // The Orb's liquid outline: a surface line across the bowl, closed along its bottom.
  // Same shape as drawLiquid's (two sine waves, tipped by lean, 3 px steps).
  const liquid = (score, { phase = 0, lean = 0, c = 100, r = 78 } = {}) => {
    const level = c + r - 2 * r * (score / 100);
    const amp = 2.6 + 2.4 * Math.abs(lean);
    const y = (u) =>
      level +
      Math.sin(u * 2.6 + phase) * amp +
      Math.sin(u * 5.3 - phase * 1.4) * amp * 0.35 +
      u * lean * 9;
    const points = [[c - r, c + r]];
    for (let x = c - r; x <= c + r + 0.1; x += 3) points.push([x, y((x - c) / r)]);
    points.push([c + r, c + r]);
    return points;
  };

  it('matches the clipped liquid at the score limits and in between', () => {
    // phase 0 at score 0 puts a corner exactly on the circle's lowest point.
    for (const score of [0, 1, 2, 50, 98, 99, 100])
      for (const lean of [-1, 0, 0.4, 1])
        for (let phase = 0; phase < 20; phase += 0.7)
          expect(
            mismatches(liquid(score, { phase, lean })),
            `${score} ${lean} ${phase}`,
          ).toEqual([]);
  });

  it('a flat surface exactly at the bottom or top only touches the circle', () => {
    const flat = (y) => [
      [10, 190],
      [10, y],
      [190, y],
      [190, 190],
    ];
    expect(mismatches(flat(178))).toEqual([]); // tangent at the bottom: nothing inside
    expect(mismatches(flat(22))).toEqual([]); // tangent at the top: the whole circle
    expect(mismatches(flat(177.99))).toEqual([]); // a sliver at the bottom
    expect(mismatches(flat(22.01))).toEqual([]); // all but a sliver at the top
  });

  it('handles corners that sit exactly on the circle', () => {
    const on = (deg) => [
      100 + 78 * Math.cos((deg * Math.PI) / 180),
      100 + 78 * Math.sin((deg * Math.PI) / 180),
    ];
    // A square with all four corners on the circle: the square itself.
    expect(mismatches([on(135), on(225), on(315), on(45)])).toEqual([]);
    // One corner on the circle, the others outside.
    expect(mismatches([[0, 200], on(180), [100, 60], [200, 200]])).toEqual([]);
    // One corner on the circle, the others inside.
    expect(mismatches([on(90), [70, 110], [100, 80], [130, 110]])).toEqual([]);
    // A level line through two points on the circle, closed outside it.
    expect(mismatches([[22, 190], [22, 100], [178, 100], [178, 190]])).toEqual([]);
  });

  it('handles edges that only touch the circle', () => {
    // A triangle whose top edge is tangent to the circle at its lowest point.
    expect(mismatches([[40, 178], [160, 178], [100, 240]])).toEqual([]);
    // A tall shape whose side touches the circle at its rightmost point.
    expect(mismatches([[178, 0], [178, 200], [300, 200], [300, 0]])).toEqual([]);
  });

  it('a wave dipping below the bottom splits into separate pieces', () => {
    // A low V: it enters the circle twice, so the path has two closed loops.
    const calls = pathOf([
      [40, 200],
      [40, 80],
      [100, 180],
      [160, 80],
      [160, 200],
    ]);
    expect(calls.filter(([n]) => n === 'closePath')).toHaveLength(2);
  });
});

// A loop with a manual clock and frames held until run().
function setup({ canAnimate = () => true } = {}) {
  let t = 0;
  const frames = new Map();
  let id = 0;
  const raf = vi.fn((fn) => {
    frames.set(++id, fn);
    return id;
  });
  const caf = (n) => frames.delete(n);
  const render = vi.fn();
  const loop = createOrbLoop({
    render,
    canAnimate,
    raf,
    caf,
    now: () => t,
  });
  const runFrame = (ms) => {
    t += ms;
    const fns = [...frames.values()];
    frames.clear();
    fns.forEach((fn) => fn());
  };
  return { loop, raf, render, frames, runFrame };
}

describe('createOrbLoop', () => {
  it('at Full, fills over FILL_MS and then keeps the liquid moving', () => {
    const { loop, render, frames, runFrame } = setup();
    loop.play();
    expect(render).toHaveBeenLastCalledWith(0, expect.any(Number), 0);
    runFrame(FILL_MS / 2);
    expect(render.mock.lastCall[0]).toBeGreaterThan(0);
    expect(render.mock.lastCall[0]).toBeLessThan(1);
    runFrame(FILL_MS);
    expect(render.mock.lastCall[0]).toBe(1);
    const phase = render.mock.lastCall[1];
    runFrame(FRAME_MS);
    expect(render.mock.lastCall[1]).toBeGreaterThan(phase); // still moving
    expect(frames.size).toBe(1);
    expect(loop.running).toBe(true);
  });

  it('draws at about 30 fps: display frames in between are skipped', () => {
    const { loop, render, runFrame } = setup();
    loop.play();
    runFrame(FILL_MS + 1);
    const drawn = render.mock.calls.length;
    runFrame(16); // a 60 Hz frame: too soon
    expect(render.mock.calls.length).toBe(drawn);
    runFrame(18); // 34 ms since the last draw
    expect(render.mock.calls.length).toBe(drawn + 1);
  });

  it('at Calm or Off draws one finished frame and never requests a frame', () => {
    const { loop, raf, render } = setup({ canAnimate: () => false });
    loop.play();
    loop.setLean(1);
    loop.resume();
    loop.redraw();
    expect(raf).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalled();
    render.mock.calls.forEach(([progress]) => expect(progress).toBe(1));
  });

  it('offscreen, hidden or motion turned down: draws the end state and stops', () => {
    let allowed = true;
    const { loop, render, frames, runFrame } = setup({
      canAnimate: () => allowed,
    });
    loop.play();
    allowed = false;
    runFrame(FRAME_MS);
    expect(render.mock.lastCall[0]).toBe(1);
    expect(frames.size).toBe(0);
    expect(loop.running).toBe(false);
  });

  it('resume() after stop() keeps moving without refilling', () => {
    const { loop, render, frames, runFrame } = setup();
    loop.play();
    runFrame(FILL_MS + 1);
    loop.stop();
    expect(frames.size).toBe(0);
    loop.resume();
    expect(frames.size).toBe(1);
    runFrame(FRAME_MS);
    expect(render.mock.lastCall[0]).toBe(1);
  });

  it('the liquid eases toward the pointer instead of jumping', () => {
    const { loop, render, runFrame } = setup();
    loop.play();
    runFrame(FILL_MS + 1);
    loop.setLean(5); // clamped to 1
    runFrame(FRAME_MS);
    const lean = render.mock.lastCall[2];
    expect(lean).toBeGreaterThan(0);
    expect(lean).toBeLessThan(1);
    for (let i = 0; i < 30; i++) runFrame(FRAME_MS);
    expect(render.mock.lastCall[2]).toBeCloseTo(1, 1);
  });

  it('stop() cancels a queued frame without drawing', () => {
    const { loop, render, frames } = setup();
    loop.play();
    const drawn = render.mock.calls.length;
    loop.stop();
    expect(frames.size).toBe(0);
    expect(render.mock.calls.length).toBe(drawn);
  });

  it('redraw() mid-fill finishes at the end state with no frame left', () => {
    const { loop, render, frames } = setup();
    loop.play();
    loop.redraw();
    expect(render.mock.lastCall[0]).toBe(1);
    expect(frames.size).toBe(0);
  });
});
