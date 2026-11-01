import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawOrb, surface } from "./orb";
import {
  WARMUP_FRAMES,
  bubbleSpots,
  liquidLevel,
  parseColor,
  startOrbGl,
  warmupPassed,
} from "./orbGl";

// A canvas context that records the calls drawOrb makes.
function recorder() {
  const calls = [];
  const gradient = { addColorStop() {} };
  return new Proxy(
    { calls },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key.startsWith("create")) return () => gradient;
        return (...args) => calls.push([key, ...args]);
      },
      set: () => true,
    },
  );
}
const colors = new Proxy(
  { series: ["#000"] },
  { get: (t, k) => t[k] ?? "#000000" },
);

describe("the 3D liquid means the same as the flat Orb", () => {
  for (const [score, progress] of [
    [0, 1],
    [42, 1],
    [85, 0.5],
    [100, 1],
  ]) {
    it(`same surface height for score ${score} at fill ${progress}`, () => {
      const ctx = recorder();
      drawOrb(ctx, { size: 200, score, segments: [], colors, progress });
      // The crest is the only path that starts at the sphere's left edge, off the bottom.
      const crest = ctx.calls.find(
        (c) => c[0] === "moveTo" && c[1] === 22 && c[2] !== 178,
      );
      const level = liquidLevel(score, progress);
      expect(crest[2]).toBeCloseTo(surface(-1, level, 0, 2.6, 0));
    });
  }

  it("fills from the bottom (score 0) to the top (score 100) of the sphere", () => {
    expect(liquidLevel(0, 1)).toBe(178);
    expect(liquidLevel(100, 1)).toBe(22);
    expect(liquidLevel(50, 1)).toBe(100);
    expect(liquidLevel(100, 0)).toBe(178);
  });

  it("puts the bubbles where the flat Orb does", () => {
    for (const phase of [0, 1.7, 9.3]) {
      const ctx = recorder();
      drawOrb(ctx, { size: 200, score: 70, segments: [], colors, phase });
      const flat = ctx.calls
        .filter((c) => c[0] === "arc" && c[3] < 3)
        .map(([, x, y, r]) => ({ x, y, r }));
      const level = liquidLevel(70, 1);
      const front = (u) => surface(u, level, phase, 2.6, 0);
      expect(bubbleSpots(level, phase, front)).toEqual(flat);
    }
  });
});

describe("parseColor", () => {
  it("reads the Orb's hex and rgb() colors", () => {
    expect(parseColor("#ff8000")).toEqual([1, 128 / 255, 0, 1]);
    expect(parseColor("rgb(10 125 86 / 0.22)")).toEqual([
      10 / 255,
      125 / 255,
      86 / 255,
      0.22,
    ]);
    expect(parseColor("rgb(255 255 255)")).toEqual([1, 1, 1, 1]);
  });
});

describe("warmupPassed", () => {
  const frames = (ms, n = WARMUP_FRAMES) => Array(n).fill(ms);
  it("passes only when the first 30 frames average under 12 ms", () => {
    expect(warmupPassed(frames(11.9))).toBe(true);
    expect(warmupPassed(frames(12))).toBe(false);
    expect(warmupPassed([...frames(5, 29), 250])).toBe(false); // one bad frame counts
    expect(warmupPassed(frames(1, 29))).toBe(false); // not enough frames yet
  });
});

// ---------- Lifecycle, with a fake WebGL context ----------

function fakeGL({ link = true, pixel = 255, fence = true } = {}) {
  const gl = {
    deleted: [],
    lost: false,
    loseCalls: 0,
    draws: 0,
    LINK_STATUS: "link",
    NO_ERROR: 0,
    SIGNALED: "signaled",
    getExtension: (name) =>
      name === "WEBGL_lose_context"
        ? {
            loseContext: () => {
              gl.loseCalls++;
              gl.lost = true;
            },
          }
        : null,
    isContextLost: () => gl.lost,
    getProgramParameter: () => link,
    getError: () => 0,
    readPixels: (x, y, w, h, f, t, out) => {
      out[3] = pixel;
    },
    drawArrays: () => gl.draws++,
    getSyncParameter: () => "signaled",
    deleteBuffer: () => gl.deleted.push("buffer"),
    deleteShader: () => gl.deleted.push("shader"),
    deleteProgram: () => gl.deleted.push("program"),
    deleteSync: () => {},
  };
  if (fence) gl.fenceSync = () => ({});
  return new Proxy(gl, {
    get: (t, k) => (k in t ? t[k] : () => ({})), // every other GL call is a no-op
  });
}

function fakeCanvas(gl) {
  const listeners = {};
  const canvas = {
    style: {},
    classes: new Set(),
    classList: { add: (c) => canvas.classes.add(c) },
    setAttribute() {},
    contexts: [],
    getContext(type) {
      if (canvas.contexts.length) return null; // a canvas only ever gets one kind
      canvas.contexts.push(type);
      return gl;
    },
    addEventListener: (type, fn) => (listeners[type] = fn),
    removeEventListener: (type) => delete listeners[type],
    fire: (type) => listeners[type]?.(),
    removed: false,
    remove: () => (canvas.removed = true),
  };
  return canvas;
}

describe("startOrbGl", () => {
  let canvas;
  let clock;
  const host = { insertBefore: vi.fn(), querySelector: () => null };
  const args = {
    size: 200,
    score: 60,
    segments: [],
    colors,
    progress: 1,
    phase: 0,
    lean: 0,
  };
  const start = (gl, onFail = vi.fn()) => {
    canvas = fakeCanvas(gl);
    vi.stubGlobal("document", { createElement: () => canvas });
    return { orb: startOrbGl(host, onFail), onFail };
  };
  // Runs frames until it is live or failed; each warm-up frame "takes" `ms`.
  const run = (orb, ms, n = WARMUP_FRAMES + 3) => {
    for (let i = 0; i < n; i++) {
      orb.frame(recorder(), args);
      clock += ms;
    }
  };

  beforeEach(() => {
    clock = 0;
    vi.stubGlobal("window", { devicePixelRatio: 3 });
    vi.stubGlobal("performance", { now: () => clock, measure() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stays hidden while warming up, then shows when the frames are fast enough", () => {
    const gl = fakeGL();
    const { orb, onFail } = start(gl);
    expect(canvas.width).toBe(312); // 156 px at the 2x cap, not 3x
    expect(canvas.style.opacity).toBe(0);
    run(orb, 0, WARMUP_FRAMES + 1); // compile, prime, then 29 timed frames: not yet
    expect(canvas.classes.has("is-live")).toBe(false);
    run(orb, 0, 2);
    expect(canvas.classes.has("is-live")).toBe(true);
    expect(canvas.style.opacity).toBe(1);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("falls back as 'slow' when the warm-up averages 12 ms or more", () => {
    const gl = fakeGL();
    const { orb, onFail } = start(gl);
    // Each frame's draw + pixel read takes 13 ms on the fake clock.
    gl.readPixels = (x, y, w, h, f, t, out) => {
      clock += 13;
      out[3] = 255;
    };
    run(orb, 0);
    expect(onFail).toHaveBeenCalledWith("slow");
    expect(canvas.removed).toBe(true);
    expect(gl.loseCalls).toBe(1);
  });

  it("falls back as 'shader' when the program fails or the first frame is blank", () => {
    const failed = start(fakeGL({ link: false }));
    run(failed.orb, 0, 1);
    expect(failed.onFail).toHaveBeenCalledWith("shader");

    const blank = start(fakeGL({ pixel: 0 }));
    run(blank.orb, 0, 4);
    expect(blank.onFail).toHaveBeenCalledWith("shader");
  });

  it("falls back as 'unsupported' without WebGL", () => {
    const { orb, onFail } = start(null);
    expect(orb).toBe(null);
    expect(onFail).toHaveBeenCalledWith("unsupported");
    expect(canvas.removed).toBe(true);
  });

  it("falls back as 'lost' when the graphics context is lost", () => {
    const { orb, onFail } = start(fakeGL());
    run(orb, 0);
    canvas.fire("webglcontextlost");
    expect(onFail).toHaveBeenCalledWith("lost");
    expect(canvas.removed).toBe(true);
  });

  it("draws the flat Orb until it is live, then only when the ring changes", () => {
    const gl = fakeGL();
    const { orb } = start(gl);
    const flat = recorder();
    for (let i = 0; i < WARMUP_FRAMES + 2; i++) orb.frame(flat, args);
    const before = flat.calls.length;
    expect(before).toBeGreaterThan(0);
    orb.frame(flat, args); // live: first frame redraws the flat ring once
    const once = flat.calls.length;
    orb.frame(flat, { ...args, phase: 2 }); // only the liquid moved
    expect(flat.calls.length).toBe(once);
    orb.frame(flat, { ...args, progress: 0.5 }); // the ring is filling
    expect(flat.calls.length).toBeGreaterThan(once);
  });

  it("releases everything on dispose, and is plain drawOrb afterwards", () => {
    const gl = fakeGL();
    const { orb, onFail } = start(gl);
    run(orb, 0);
    const draws = gl.draws;
    orb.dispose();
    expect(gl.deleted).toEqual(["buffer", "shader", "shader", "program"]);
    expect(gl.loseCalls).toBe(1);
    expect(canvas.removed).toBe(true);
    const flat = recorder();
    orb.frame(flat, args);
    expect(flat.calls.length).toBeGreaterThan(0);
    expect(gl.draws).toBe(draws);
    canvas.fire("webglcontextlost"); // releasing it on purpose is not a failure
    expect(onFail).not.toHaveBeenCalled();
  });

  it("keeps one context: starting again releases the previous one", () => {
    const first = fakeGL();
    start(first);
    start(fakeGL());
    expect(first.loseCalls).toBe(1);
  });

  it("works without WebGL 2 fences (WebGL 1)", () => {
    const gl = fakeGL({ fence: false });
    const { orb, onFail } = start(gl);
    run(orb, 0);
    expect(canvas.classes.has("is-live")).toBe(true);
    expect(onFail).not.toHaveBeenCalled();
  });
});
