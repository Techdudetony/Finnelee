// The experimental 3D Orb: the Health Orb's glass and liquid drawn by a small WebGL
// shader. Loaded on demand (import()) only when Settings > 3D Orb is on at Full motion;
// the flat Orb in orb.js stays the default and the fallback.
// It uses the flat Orb's wave (surface) and bubbles, and the same fill height and colors,
// so the liquid means exactly the same thing. The ring and score stay as they are.
import { BUBBLES, MAX_DPR, drawOrb, surface } from "./orb";

// The sphere inside the 200 px orb: centre 100, radius 78. The WebGL canvas covers only
// the square around it (22..178), so the ring and score around it are untouched.
const C = 100;
const R = 78;
const BOX = 2 * R;

/**
 * Where the liquid's surface sits (y, in orb px): `score` (0..100) of the sphere's height,
 * times the fill `progress`. The same formula as drawOrb; orbGl.test.js checks they agree.
 */
export const liquidLevel = (score, progress) =>
  C + R - 2 * R * (score / 100) * progress;

/** The bubbles below the surface this frame, as { x, y, r }: the same as drawOrb's. */
export function bubbleSpots(level, phase, front) {
  const spots = [];
  for (const b of BUBBLES) {
    const t = (phase * b.speed + b.offset) % 1;
    const y = C + R - t * (C + R - level);
    const x = C + b.x * R + Math.sin(phase + b.offset * 9) * 2;
    if (y >= front((x - C) / R) + 3) spots.push({ x, y, r: b.r });
  }
  return spots;
}

/** Frames the warm-up times before the 3D Orb is shown, and their average budget. */
export const WARMUP_FRAMES = 30;
export const WARMUP_MS = 12;

/** True when the warm-up frames averaged under the budget. */
export const warmupPassed = (times) =>
  times.length >= WARMUP_FRAMES &&
  times.reduce((a, t) => a + t, 0) / times.length < WARMUP_MS;

/** "#rrggbb" or "rgb(r g b / a)" (the Orb's color formats) as 0..1 [r, g, b, a]. */
export function parseColor(css) {
  if (css[0] === "#") {
    const n = parseInt(css.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const [r, g, b, a = 1] = css.match(/[\d.]+/g).map(Number);
  return [r / 255, g / 255, b / 255, a];
}

// Shader color uniform -> the Orb color it takes (HealthOrb.jsx ORB_COLORS).
const COLORS = {
  gi: "glassInner",
  ge: "glassEdge",
  rs: "rimShade",
  lb: "liquidBack",
  lt: "liquidTop",
  lo: "liquidBottom",
  cr: "crest",
  bu: "bubble",
  sp: "specular",
};

const VERTEX = `attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

// Per pixel, in orb coordinates (CSS px, y down), painted back to front like drawOrb.
// s: CSS px per device pixel; lv/am/ph/ln: level, wave height, phase, lean; b: bubbles.
const FRAGMENT = `precision mediump float;
uniform float s, lv, am, ph, ln;
uniform vec3 b[5];
uniform vec4 gi, ge, rs, lb, lt, lo, cr, bu, sp;
float surf(float u, float l, float p, float a, float n) {
  return l + sin(u * 2.6 + p) * a + sin(u * 5.3 - p * 1.4) * a * 0.35 + u * n * 9.0;
}
vec3 over(vec3 c, vec4 k, float m) { return mix(c, k.rgb, k.a * clamp(m, 0.0, 1.0)); }
float band(float d, float w) { return 1.0 - smoothstep(w, w + s, abs(d)); }
void main() {
  vec2 p = vec2(22.0 + gl_FragCoord.x * s, 178.0 - gl_FragCoord.y * s);
  vec2 d = (p - 100.0) / 78.0;
  float dl = length(d);
  float edge = 1.0 - smoothstep(1.0 - s / 78.0, 1.0, dl);
  if (edge <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 n = vec3(d, sqrt(max(0.0, 1.0 - dl * dl)));
  vec3 c = mix(gi.rgb, ge.rgb, clamp(length(p - vec2(72.7, 68.8)) / 105.0, 0.0, 1.0));
  vec2 q = p - d * 7.0 * (1.0 - n.z);
  float u = (q.x - 100.0) / 78.0;
  float yb = surf(u, lv - 3.0, ph * 0.8 + 2.0, am * 0.8, ln * 0.6);
  c = over(c, lb, smoothstep(yb - s, yb + s, q.y));
  float yf = surf(u, lv, ph, am, ln);
  float top = lv - am;
  c = over(c, mix(lt, lo, clamp((q.y - top) / (178.0 - top), 0.0, 1.0)), smoothstep(yf - s, yf + s, q.y));
  for (int i = 0; i < 5; i++) c = over(c, bu, band(length(q - b[i].xy), b[i].z) * step(0.1, b[i].z));
  c = over(c, cr, band(q.y - yf, 0.75));
  c = over(c, rs, smoothstep(0.6, 1.0, dl));
  c = over(c, sp, pow(1.0 - n.z, 3.0) * 0.25);
  c = over(c, sp, pow(max(dot(n, normalize(vec3(-0.45, -0.55, 1.0))), 0.0), 60.0) * 0.35);
  vec2 e = p - vec2(61.0, 53.2);
  vec2 el = vec2(e.x * 0.809 - e.y * 0.588, e.x * 0.588 + e.y * 0.809) / vec2(20.28, 10.92);
  c = over(c, sp, (1.0 - smoothstep(0.9, 1.0, length(el))) * (1.0 - clamp(length(e) / 21.06, 0.0, 1.0)));
  float an = atan(d.y, d.x);
  c = over(c, sp, band(dl * 78.0 - 75.0, 0.75) * step(0.314, an) * step(an, 1.319) * 0.45);
  gl_FragColor = vec4(c * edge, edge);
}`;

let active = null; // the one renderer alive, so there is never more than one context

const measure = (name, start, detail) => {
  try {
    performance.measure(name, { start, detail });
  } catch {
    // Older browsers without measure options: timings are only for the benchmark.
  }
};

/**
 * Starts the WebGL Orb in a canvas of its own over the sphere in `host` (the .orb box).
 * It stays invisible while it gets ready: the shader compiles (in the background where
 * supported), one untimed draw primes it, then the first frame must render (checked by
 * reading a pixel back) and the first WARMUP_FRAMES frames, each timed through a pixel
 * read that waits for the GPU, must average under WARMUP_MS. Only then does it fade in over the flat
 * Orb. Any failure removes it and calls onFail(reason) once, after releasing everything:
 * "unsupported", "shader", "lost" or "slow".
 * Returns { frame, dispose }, or null if it failed straight away. frame(ctx, args)
 * stands in for drawOrb(ctx, args) in the Orb's own loop, so it pauses and stops with it:
 * it draws the flat Orb as usual until the 3D one is live, then only the flat ring (while
 * it changes) under the 3D glass. Once released it is plain drawOrb again.
 */
export function startOrbGl(host, onFail) {
  active?.dispose();
  const canvas = document.createElement("canvas");
  canvas.className = "orb-gl";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "absolute",
    left: `${C - R}px`,
    top: `${C - R}px`,
    width: `${BOX}px`,
    height: `${BOX}px`,
    opacity: 0,
    transition: "opacity 0.4s ease",
  });
  host.insertBefore(canvas, host.querySelector(".orb-score")); // the score stays on top
  const start = performance.now();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const px = Math.round(BOX * dpr);
  canvas.width = px;
  canvas.height = px;
  // WebGL 2 where there is one (it can tell when the GPU has finished without waiting),
  // else WebGL 1. The shader is written for both. Either way, one context.
  const options = {
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  };
  const gl =
    canvas.getContext("webgl2", options) || canvas.getContext("webgl", options);
  if (!gl) {
    canvas.remove();
    onFail("unsupported");
    return null;
  }

  let disposed = false;
  let stage = 0; // 0 compiling, 1 priming, 2 warming up, 3 live
  let fence = null;
  let primed = false;
  let colorsFor = null;
  let warmStart = 0;
  const times = [];
  const pixel = new Uint8Array(4);
  const bubbles = new Float32Array(15);

  const program = gl.createProgram();
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    gl.attachShader(program, s);
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  gl.linkProgram(program);
  const buffer = gl.createBuffer();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("webglcontextlost", onLost);
    if (!gl.isContextLost()) {
      if (fence) gl.deleteSync(fence);
      gl.deleteBuffer(buffer);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    canvas.remove();
    if (active === api) active = null;
  };
  const fail = (why) => {
    if (disposed) return;
    dispose();
    onFail(why);
  };
  const onLost = () => fail("lost");
  canvas.addEventListener("webglcontextlost", onLost);
  const api = { frame, dispose };
  active = api;

  // Compiling happens in the background where the browser supports it, so start-up
  // never waits on it; set up once it has finished (checked once per frame).
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const at = (name) => gl.getUniformLocation(program, name);
  let u;
  function setUp() {
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail("shader");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const corner = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, px, px);
    u = {
      s: at("s"),
      lv: at("lv"),
      am: at("am"),
      ph: at("ph"),
      ln: at("ln"),
      b: at("b"),
    };
    gl.uniform1f(u.s, BOX / px);
    measure("orb3d:init", start);
    stage = 1;
  }

  function draw({ score, colors, progress, phase, lean }) {
    if (colors !== colorsFor) {
      for (const [name, key] of Object.entries(COLORS))
        gl.uniform4fv(at(name), parseColor(colors[key]));
      colorsFor = colors;
    }
    const level = score == null ? 1e3 : liquidLevel(score, progress);
    const amp = 2.6 + 2.4 * Math.abs(lean);
    const front = (x) => surface(x, level, phase, amp, lean);
    bubbles.fill(0);
    if (score != null)
      bubbleSpots(level, phase, front).forEach((b, i) =>
        bubbles.set([b.x, b.y, b.r], i * 3),
      );
    gl.uniform1f(u.lv, level);
    gl.uniform1f(u.am, amp);
    gl.uniform1f(u.ph, phase);
    gl.uniform1f(u.ln, lean);
    gl.uniform3fv(u.b, bubbles);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let flat = []; // what the flat canvas last drew under the live 3D Orb
  function frame(ctx, args) {
    const { progress, segments, colors } = args;
    const same =
      stage === 3 &&
      flat[0] === progress &&
      flat[1] === segments &&
      flat[2] === colors;
    if (disposed || !same) drawOrb(ctx, args);
    flat = [progress, segments, colors];
    if (disposed) return;
    if (stage === 3) return draw(args);
    if (stage === 0) {
      if (
        !parallel ||
        gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)
      )
        setUp();
      return;
    }
    if (stage === 1) {
      // One untimed draw first, so the driver's one-off shader preparation runs on the
      // GPU side; WebGL 2 then waits (without blocking) until the GPU has finished it.
      if (!primed) {
        primed = true;
        draw(args);
        fence = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) ?? null;
        gl.flush();
        return;
      }
      if (fence) {
        if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
        gl.deleteSync(fence);
        fence = null;
      }
      stage = 2;
    }
    const t = performance.now();
    if (!times.length) warmStart = t;
    draw(args);
    // The centre is solid glass, so a drawn frame reads back opaque there. Reading it
    // waits for the GPU, so the time includes the GPU's work on this frame.
    gl.readPixels(px >> 1, px >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    times.push(performance.now() - t);
    if (times.length === 1) {
      if (gl.getError() !== gl.NO_ERROR || pixel[3] < 250)
        return fail("shader");
      measure("orb3d:first-frame", start);
    }
    if (times.length < WARMUP_FRAMES) return;
    const avg = times.reduce((a, x) => a + x, 0) / times.length;
    measure("orb3d:warmup", warmStart, { avg, max: Math.max(...times) });
    if (!warmupPassed(times)) return fail("slow");
    stage = 3;
    canvas.style.opacity = 1;
    canvas.classList.add("is-live");
    measure("orb3d:visible", start);
  }

  return api;
}
