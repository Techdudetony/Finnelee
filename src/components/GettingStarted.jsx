import { useEffect, useRef } from "react";
import Icon from "./Icon";
import Status from "./Status";
import { useCelebration } from "./Celebrate";
import {
  GETTING_STARTED_ITEMS,
  checklistView,
  doneCount,
} from "../utils/gettingStarted";

const TOTAL = GETTING_STARTED_ITEMS.length;

/**
 * The Dashboard's Getting Started card. Ordinary page content: never a dialog, never a
 * focus trap. It shows only what utils/gettingStarted.js decides (checklistView), and
 * App.jsx (`checklist`) keeps the record and does Hide, Show and Done.
 * - "checklist": five steps in a fixed order; each ticks itself off from the data.
 * - "complete": a one-time "all set up" card, until Done is pressed.
 */
export default function GettingStarted({
  store,
  openTask,
  startTour,
  checklist,
}) {
  const view = checklist ? checklistView(store.settings, checklist.done) : null;
  if (view === "complete") return <AllSetUp checklist={checklist} />;
  if (view !== "checklist") return null;

  const { done } = checklist;
  const count = doneCount(done);
  // Only when the first-run tour was skipped: a quiet way back to it.
  const tourSkipped = store.settings.onboarding?.outcome === "skipped";

  return (
    <section className="card getting-started" aria-labelledby="gs-title">
      <header className="gs-head">
        <div>
          <h2 id="gs-title" tabIndex={-1} data-focus-target="getting-started">
            Getting started
          </h2>
          <p className="sub">
            Set up your financial picture. Each step ticks itself off when your
            data is in.
          </p>
        </div>
        <button className="btn gs-hide" onClick={checklist.hide}>
          Hide
        </button>
      </header>

      <div className="gs-progress">
        <span className="gs-count">
          {count} of {TOTAL} done
        </span>
        <div
          className="progress"
          role="progressbar"
          aria-label="Getting started progress"
          aria-valuemin={0}
          aria-valuemax={TOTAL}
          aria-valuenow={count}
          aria-valuetext={`${count} of ${TOTAL} steps done`}
        >
          <span style={{ width: `${(count / TOTAL) * 100}%` }} />
        </div>
      </div>

      {/* Fixed order whatever is done; state is always in words, not just color. */}
      <ol className="gs-items">
        {GETTING_STARTED_ITEMS.map((item) => {
          const isDone = done[item.id];
          return (
            <li key={item.id} className={`gs-item${isDone ? " is-done" : ""}`}>
              <span className="gs-mark" aria-hidden="true">
                {isDone && <Icon name="check" size={16} />}
              </span>
              <div className="gs-text">
                <h3>{item.title}</h3>
                <p>{item.hint}</p>
              </div>
              <div className="gs-action">
                {isDone ? (
                  <Status tone="good">Done</Status>
                ) : (
                  // Same path as the tour's "Show me": the real page, real focus.
                  <button
                    className="btn btn-primary"
                    onClick={() => openTask(item.page, item.focus, item.action)}
                  >
                    {item.action}
                    <span className="sr-only">: not done yet</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {tourSkipped && startTour && (
        <p className="gs-foot">
          New here?{" "}
          <button className="link-btn" onClick={startTour}>
            Take the tour
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * Shown once, after the last step was finished by normal use (never for data that
 * arrived complete). The burst plays only in the session it happened, at the Motion
 * level allowed (confetti at Full, a glow at Calm, nothing moving at Off); after a
 * reload the card waits quietly for Done.
 */
function AllSetUp({ checklist }) {
  const ref = useRef(null);
  const { celebrate, node, glow } = useCelebration();
  const { celebrate: fresh, onCelebrated } = checklist;
  useEffect(() => {
    if (!fresh) return;
    celebrate("You're all set up.", ref.current, "getting-started");
    onCelebrated();
  }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section
      ref={ref}
      className={`card getting-started gs-complete${glow === "getting-started" ? " celebrate-glow" : ""}`}
      aria-labelledby="gs-title"
    >
      <span className="gs-mark is-big" aria-hidden="true">
        <Icon name="check" size={22} />
      </span>
      <div className="gs-text">
        <h2 id="gs-title" tabIndex={-1} data-focus-target="getting-started">
          You're all set up
        </h2>
        <p className="sub">
          All five first steps are done. Your Dashboard fills in as you keep
          tracking.
        </p>
      </div>
      <button className="btn btn-primary" onClick={checklist.acknowledge}>
        Done
      </button>
      {node}
    </section>
  );
}
