import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMotion } from "../hooks/useMotion";

const BURST_MS = 1200; // how long the confetti falls
const GLOW_MS = 1000; // how long a celebrated card keeps its glow class
const REPEAT_MS = 1500; // the same card can't celebrate twice within this

/**
 * Celebrations for a page. celebrate(text, element, target) is called from the event
 * handler that finished something (never from an effect), so loading and rerenders
 * can't start one. Nothing is saved.
 * - Every Motion level: `text` is announced in a polite live region.
 * - Calm and Full: the card gets a short glow (the `celebrate-glow` class).
 * - Full only: a burst of confetti from `element`.
 * Render `node` once on the page; give `celebrate-glow` to the card whose id is `glow`.
 */
export function useCelebration() {
  const [said, setSaid] = useState({ id: 0, text: "" });
  const [burst, setBurst] = useState(null); // { id, x, y }
  const [glow, setGlow] = useState(null); // target id that glows right now
  const last = useRef({ target: null, at: 0 });
  const nextId = useRef(0);
  const glowTimer = useRef(null);
  useEffect(() => () => clearTimeout(glowTimer.current), []);

  const celebrate = useCallback((text, element, target) => {
    const now = Date.now();
    // A fast double click can run the handler twice before React saves the first.
    if (last.current.target === target && now - last.current.at < REPEAT_MS)
      return;
    last.current = { target, at: now };
    const id = ++nextId.current;
    setSaid({ id, text });
    const r = element?.getBoundingClientRect();
    setBurst({
      id,
      x: r ? r.left + r.width / 2 : window.innerWidth / 2,
      y: r ? r.top + r.height / 2 : window.innerHeight / 3,
    });
    setGlow(target);
    clearTimeout(glowTimer.current);
    glowTimer.current = setTimeout(() => setGlow(null), GLOW_MS);
  }, []);

  const node = (
    <>
      {/* Always mounted, so the message is read when it changes. */}
      <div role="status" className="sr-only">
        <span key={said.id}>{said.text}</span>
      </div>
      {burst && (
        <Confetti
          key={burst.id}
          x={burst.x}
          y={burst.y}
          onDone={() => setBurst(null)}
        />
      )}
    </>
  );
  return { celebrate, node, glow };
}

/**
 * The confetti burst, at Full motion only. Drawn on one canvas over the page that
 * ignores clicks and is hidden from screen readers. Animation frames run only while
 * the burst falls; switching Motion below Full or leaving the page ends it for good.
 */
function Confetti({ x, y, onDone }) {
  const motion = useMotion();
  const ref = useRef(null);
  const done = useRef(onDone);
  done.current = onDone;
  const full = motion === "full";

  useEffect(() => {
    // Below Full the burst is dropped, not kept: turning Motion back up later must not
    // start confetti for an old celebration.
    if (!full) return done.current();
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return done.current();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // The theme's own colors, so it matches light and dark.
    const css = getComputedStyle(document.documentElement);
    const colors = ["--accent", "--accent-2", "--warning", "--good"]
      .map((v) => css.getPropertyValue(v).trim())
      .filter(Boolean);
    const parts = Array.from({ length: 80 }, (_, i) => ({
      x,
      y,
      vx: (Math.random() - 0.5) * 10,
      vy: -Math.random() * 8 - 3,
      size: Math.random() * 5 + 4,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.4,
      color: colors[i % colors.length] || "#3fe0a5",
    }));

    let raf = 0;
    let prev = performance.now();
    const startedAt = prev;
    const tick = (now) => {
      const step = Math.min((now - prev) / 16.7, 3); // steady speed at any frame rate
      prev = now;
      const t = (now - startedAt) / BURST_MS;
      ctx.clearRect(0, 0, w, h);
      if (t >= 1) return done.current();
      ctx.globalAlpha = 1 - t * t; // fades out near the end
      for (const p of parts) {
        p.vy += 0.25 * step;
        p.vx *= 0.99;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.angle += p.spin * step;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [full, x, y]);

  if (!full) return null;
  return createPortal(
    <canvas ref={ref} className="confetti" aria-hidden="true" />,
    document.body,
  );
}
