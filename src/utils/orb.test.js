import { describe, expect, it, vi } from 'vitest';
import { FILL_MS, FRAME_MS, createOrbLoop, drawOrb, easeOut, orbSegments } from './orb';

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
