import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import Status from './Status';
import { useColorScheme } from '../hooks/useColorScheme';
import { useMotion } from '../hooks/useMotion';
import { getPalette } from '../utils/colors';
import { healthScore } from '../utils/health';
import { MAX_DPR, createOrbLoop, drawOrb, orbSegments } from '../utils/orb';

// Which page improves each pillar (the pillar's button opens it).
const PILLAR_PAGE = {
  savings: 'transactions',
  emergency: 'networth',
  budgets: 'budget',
  bills: 'networth',
  debt: 'debt',
};
const PAGE_NAME = {
  transactions: 'Transactions',
  networth: 'Net Worth',
  budget: 'Budget',
  debt: 'Debt Planner',
};
const STATE_LABEL = {
  scored: 'Scored',
  older: 'Scored, older balance',
  conflict: 'Scored, amounts differ',
  'needs-data': 'Needs data',
};
// Band word + status tone: the color always comes with the word, never alone.
const BAND_TONE = {
  Strong: 'good',
  Steady: 'good',
  Building: 'warning',
  'Needs attention': 'critical',
};
// Glass and liquid colors per theme. Chosen so the score text keeps 4.5:1 or more.
const ORB_COLORS = {
  light: {
    glassInner: '#fbfdfc',
    glassEdge: '#dbe7e1',
    rimShade: 'rgb(16 60 44 / 0.18)',
    liquidBack: 'rgb(10 125 86 / 0.22)',
    liquidTop: 'rgb(30 170 120 / 0.4)',
    liquidBottom: 'rgb(6 96 66 / 0.62)',
    crest: 'rgb(255 255 255 / 0.85)',
    bubble: 'rgb(255 255 255 / 0.55)',
    specular: 'rgb(255 255 255 / 0.9)',
  },
  dark: {
    glassInner: '#22352f',
    glassEdge: '#0f1a17',
    rimShade: 'rgb(0 0 0 / 0.35)',
    liquidBack: 'rgb(63 224 165 / 0.14)',
    liquidTop: 'rgb(63 224 165 / 0.3)',
    liquidBottom: 'rgb(18 140 98 / 0.44)',
    crest: 'rgb(150 240 205 / 0.3)',
    bubble: 'rgb(200 255 235 / 0.25)',
    specular: 'rgb(255 255 255 / 0.4)',
  },
};
const ORB_SIZE = 200; // CSS pixels

/**
 * Financial health on the Dashboard: the Orb (decorative canvas), the headline, and the
 * five pillars as plain HTML buttons. Everything the canvas shows is also text here,
 * so nothing depends on animation, hover or the canvas itself.
 */
export default function HealthOrb({ store, goTo }) {
  const { transactions, budgets, bills, debts, accounts, settings, categories, goals } = store;
  const health = useMemo(
    () =>
      healthScore({
        transactions,
        budgets,
        bills,
        debts,
        accounts,
        settings,
        categories,
        goals,
      }),
    [transactions, budgets, bills, debts, accounts, settings, categories, goals],
  );
  const [showHow, setShowHow] = useState(false);
  const series = getPalette(useColorScheme()).series; // same colors as the ring
  const scored = health.score != null;
  const tone = health.band ? BAND_TONE[health.band] : undefined;

  return (
    <section className="card orb-card" aria-labelledby="orb-title">
      <div className="orb-hero">
        <OrbCanvas health={health} />
        <div className="orb-summary">
          <h2 id="orb-title">Financial health</h2>
          {health.band && <Status tone={tone}>{health.band}</Status>}
          <p className="orb-headline">{health.headline}</p>
          {health.basis && <p className="small muted">{health.basis}</p>}
          {health.nextStep && <p className="small">{health.nextStep}</p>}
          {!scored && (
            <p className="small">Fill in at least 3 of the 5 areas below to see your score.</p>
          )}
        </div>
      </div>

      <ul className="orb-pillars">
        {health.pillars.map((p, i) => (
          <li key={p.id}>
            <PillarRow pillar={p} color={series[i]} goTo={goTo} />
          </li>
        ))}
      </ul>

      <div className="orb-foot">
        <button type="button" className="btn" onClick={() => setShowHow(true)}>
          <Icon name="info" />
          How this is scored
        </button>
        <p className="small muted orb-disclosure">{health.disclosure}</p>
      </div>
      {showHow && <HowScored health={health} onClose={() => setShowHow(false)} />}
    </section>
  );
}

/** One pillar: name, state, raw value, score and its sentence, always as visible text. */
function PillarRow({ pillar: p, color, goTo }) {
  const page = PILLAR_PAGE[p.id];
  const missing = p.state === 'needs-data';
  return (
    <button
      type="button"
      className={`orb-pillar${missing ? ' is-missing' : ''}`}
      onClick={() => goTo(page)}
    >
      <span className="orb-pillar-head">
        <span className="orb-pillar-name">
          {/* Matches its ring segment; dashed and grey there when it needs data. */}
          <span
            className="orb-dot"
            style={{ background: missing ? 'transparent' : color }}
            aria-hidden="true"
          />
          {p.name}
        </span>
        <span className="orb-pillar-score">{missing ? 'Needs data' : `${p.score} / 100`}</span>
      </span>
      <span className="orb-pillar-value">
        {missing ? (
          p.action
        ) : (
          <>
            {p.valueText}
            <span className="muted"> · {STATE_LABEL[p.state] ?? p.state}</span>
          </>
        )}
      </span>
      {!missing && <span className="orb-pillar-detail">{p.detail}</span>}
      {p.note && <span className="orb-pillar-detail">{p.note}</span>}
      {p.warnings.map((w) => (
        <span key={w} className="orb-pillar-detail status-warning">
          <Icon name="warning" size={14} /> {w}
        </span>
      ))}
      <span className="sr-only">. Opens {PAGE_NAME[page]}</span>
    </button>
  );
}

/**
 * The canvas. Its label carries the same words as the text beside it, and the score is
 * HTML on top (crisp, never animated). At Full motion the liquid moves whenever the orb
 * is on screen in a visible tab; offscreen, hidden, Calm or Off, no frames run.
 */
function OrbCanvas({ health }) {
  const canvasRef = useRef(null);
  const loopRef = useRef(null);
  const visibleRef = useRef(true);
  const scheme = useColorScheme();
  const full = useMotion() === 'full';
  const fullRef = useRef(full);
  fullRef.current = full;

  const segments = useMemo(() => orbSegments(health.pillars), [health]);
  const colors = useMemo(() => {
    const palette = getPalette(scheme);
    return {
      ...ORB_COLORS[scheme],
      series: palette.series,
      track: palette.grid,
    };
  }, [scheme]);

  // Build the loop for this score and theme, and play the fill once.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = ORB_SIZE * dpr;
    canvas.height = ORB_SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const loop = createOrbLoop({
      render: (progress, phase, lean) =>
        drawOrb(ctx, {
          size: ORB_SIZE,
          score: health.score,
          segments,
          colors,
          progress,
          phase,
          lean,
        }),
      canAnimate: () => fullRef.current && visibleRef.current && !document.hidden,
      raf: (fn) => requestAnimationFrame(fn),
      caf: (id) => cancelAnimationFrame(id),
      now: () => performance.now(),
    });
    loopRef.current = loop;
    loop.play();
    return () => loop.stop();
  }, [health.score, segments, colors]);

  // Motion turned down: draw the finished frame now. Turned up: start moving.
  useEffect(() => {
    if (full) loopRef.current?.resume();
    else loopRef.current?.redraw();
  }, [full]);

  // Offscreen or a hidden tab stops the loop; coming back starts it again.
  useEffect(() => {
    const canvas = canvasRef.current;
    const onVisibility = () => {
      if (document.hidden) loopRef.current?.stop();
      else loopRef.current?.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    let observer;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => {
        visibleRef.current = entry.isIntersecting;
        if (!entry.isIntersecting) loopRef.current?.stop();
        else loopRef.current?.resume();
      });
      observer.observe(canvas);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, []);

  // The liquid tips toward a pointer or finger over the orb (Full only).
  const onPointerMove = (e) => {
    if (!fullRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    loopRef.current?.setLean(((e.clientX - r.left) / r.width) * 2 - 1);
  };
  const onPointerLeave = () => loopRef.current?.setLean(0);

  // Announce a changed score once (not on first render, not on every rerender).
  const [announcement, setAnnouncement] = useState('');
  const firstLabel = useRef(health.label);
  useEffect(() => {
    if (health.label !== firstLabel.current) setAnnouncement(health.label);
  }, [health.label]);

  const lowConfidence = health.confidence === 'low';
  return (
    <div className="orb-wrap">
      <div
        className="orb"
        role="img"
        aria-label={health.label}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <canvas ref={canvasRef} width={ORB_SIZE} height={ORB_SIZE} aria-hidden="true" />
        <span className="orb-score" aria-hidden="true">
          {health.score == null ? (
            <span className="orb-score-empty">No score yet</span>
          ) : (
            <>
              {lowConfidence && <span className="orb-about">about</span>}
              <span className="orb-number">{health.score}</span>
              <span className="orb-of">of 100</span>
            </>
          )}
        </span>
      </div>
      {/* Outside role="img", whose contents screen readers skip. */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

/** "How this is scored": benchmarks, formulas, today's inputs, what was left out and why. */
function HowScored({ health, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
  }, []);
  const byId = Object.fromEntries(health.pillars.map((p) => [p.id, p]));
  const leftOut = health.pillars.filter((p) => p.state === 'needs-data');
  const confidenceRule = {
    high: 'High: all 5 areas scored with recent balances.',
    medium: 'Medium: 4 of 5 areas scored, or some balances are older or payment amounts differ.',
    low: 'Low: only 3 of 5 areas scored, so the score is rounded to the nearest 5.',
    none: 'Not scored: fewer than 3 of 5 areas have enough data.',
  }[health.confidence];

  return (
    <dialog ref={ref} className="summary-dialog" onClose={onClose} aria-labelledby="how-title">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <h2 id="how-title">How this is scored</h2>
        <span className="spacer" />
        <button className="btn-icon" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <p className="sub">
        The score is the plain average of the scored areas, each 0 to 100 against its benchmark.
      </p>
      <dl className="how-list">
        {health.benchmarks.map((b) => {
          const p = byId[b.id];
          return (
            <div key={b.id}>
              <dt>{b.name}</dt>
              <dd>
                Benchmark: {b.benchmark}. Formula: {b.formula}.
                <br />
                Today:{' '}
                {p.state === 'needs-data'
                  ? `not scored. ${p.action}`
                  : `${p.valueText}, ${p.score} of 100. ${p.detail}`}
              </dd>
            </div>
          );
        })}
      </dl>
      {leftOut.length > 0 && (
        <p className="small">
          Left out: {leftOut.map((p) => p.name).join(', ')}, until their data is added.
        </p>
      )}
      <p className="small">Confidence. {confidenceRule}</p>
      {health.warnings.map((w) => (
        <p key={w} className="small status-warning">
          <Icon name="warning" size={14} /> {w}
        </p>
      ))}
      <p className="small muted">
        {health.disclosure} {health.benchmarkNote}
      </p>
    </dialog>
  );
}
