import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMotion } from "../hooks/useMotion";
import {
  placeCard,
  previewRows,
  stepTargets,
  TOUR_FEATURES,
  TOUR_STEPS,
  unionRect,
  visibleHighlight,
} from "../utils/tour";

/**
 * The guided tour on the Dashboard: eight steps that point at real parts of the app.
 *
 * It is one native modal <dialog>, so it is the only thing that can take focus: the
 * browser keeps Tab inside it and makes the page behind it inert. A highlight is
 * only a hole in a dimmed layer: the real element shows through but can't be clicked
 * or focused. On phones the menu stays closed; the card shows a preview of it instead.
 *
 * Props:
 *  - replay: started from Settings (step 1 then reads Skip tour / Next, not an offer)
 *  - phone: the phone layout is showing
 *  - pages: [{ id, label }] in menu order, for the phone menu preview
 *  - onEnd(outcome, open?): "done" | "skipped" | "showme"; `open` is
 *    { page, focus, label } when the tour hands over to a page
 */
export default function GuidedTour({ replay, phone, pages, onEnd }) {
  const dialogRef = useRef(null);
  const cardRef = useRef(null);
  const nextRef = useRef(null);
  const featuresTitleRef = useRef(null);
  const motion = useMotion();
  const [index, setIndex] = useState(0);
  const [features, setFeatures] = useState(false); // the "Explore all features" list
  const [holes, setHoles] = useState([]); // visible target boxes; none = centered card
  const [cardPos, setCardPos] = useState(null); // desktop card { left, top }
  const [announcement, setAnnouncement] = useState("");
  const step = TOUR_STEPS[index];
  const last = TOUR_STEPS.length - 1;
  const offer = index === 0 && !replay;

  // Open as a modal once it's in the page (the `open` check covers StrictMode's double
  // run), then put focus on the main button.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    nextRef.current?.focus();
  }, []);

  // ---------- Finding and following the highlighted element ----------
  const targets = features ? [] : stepTargets(step, phone);
  const targetKey = targets.join(",");

  // Measures the real elements and the card, then places both. Runs on every step
  // change, scroll and resize, and while the card changes size.
  const measure = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const cardBox = card.getBoundingClientRect();
    // Phones: the card docks at the bottom, so only the space above it counts. (Use
    // the docked position even while it's centered, or a centered card would hide
    // its own target and never move back.)
    const bottom = phone ? vh - 24 - cardBox.height : vh;
    // One hole per target (Net Worth and Debt Planner aren't next to each other).
    const next = targets
      .map((s) => document.querySelector(s)?.getBoundingClientRect())
      .filter((r) => r && r.width > 0 && r.height > 0)
      .map((r) => visibleHighlight(r, { width: vw, bottom }))
      .filter(Boolean);
    setHoles((prev) =>
      prev.length === next.length && prev.every((b, i) => sameBox(b, next[i]))
        ? prev
        : next,
    );
    if (!phone) {
      const pos = placeCard(
        unionRect(next),
        { width: cardBox.width, height: cardBox.height },
        { width: vw, height: vh },
      );
      setCardPos((prev) =>
        prev && prev.left === pos.left && prev.top === pos.top ? prev : pos,
      );
    }
    // targetKey stands in for `targets` (a new array every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, phone]);

  // A new step: scroll its target into view if needed, then measure. The Dashboard may
  // still be appearing (just switched to), so look again each frame for up to a second.
  useLayoutEffect(() => {
    let frames = 0;
    let id = 0;
    const look = () => {
      const el = targets.length ? document.querySelector(targets[0]) : null;
      if (targets.length && !el && frames++ < 60) {
        id = requestAnimationFrame(look);
        return;
      }
      if (el) scrollIntoSight(el, phone, cardRef.current, motion === "full");
      measure();
    };
    look();
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, index, features, measure]);

  useEffect(() => {
    let id = 0;
    const soon = () => {
      cancelAnimationFrame(id);
      id = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", soon);
    window.addEventListener("scroll", soon, { capture: true, passive: true });
    const observer = new ResizeObserver(soon); // the card grows or shrinks with its text
    if (cardRef.current) observer.observe(cardRef.current);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", soon);
      window.removeEventListener("scroll", soon, { capture: true });
      observer.disconnect();
    };
  }, [measure]);

  // ---------- Moving between steps ----------
  // Step changes are read out once, from one live region. The first step isn't: the
  // dialog's own name and description are read when it opens.
  const goToStep = (n) => {
    setIndex(n);
    const s = TOUR_STEPS[n];
    setAnnouncement(
      `Step ${n + 1} of ${TOUR_STEPS.length}: ${s.title}. ${textFor(s, phone)}`,
    );
  };
  const next = () => (index === last ? onEnd("done") : goToStep(index + 1));
  const back = () => index > 0 && goToStep(index - 1);
  const skip = () => onEnd("skipped");

  const openFeatures = () => {
    setFeatures(true);
    setAnnouncement("");
  };
  const closeFeatures = () => {
    setFeatures(false);
    requestAnimationFrame(() => nextRef.current?.focus());
  };
  useEffect(() => {
    if (features) featuresTitleRef.current?.focus();
  }, [features]);

  // Escape: the browser fires "cancel". It ends the tour (as skipped, or as done from
  // the features list, which is past the last step) instead of just closing the dialog.
  const onCancel = (e) => {
    e.preventDefault();
    onEnd(features ? "done" : "skipped");
  };
  // Arrow keys move between steps, except while typing or on the features list.
  const onKeyDown = (e) => {
    // Tab wraps around inside the tour; it never reaches the browser's own controls.
    if (e.key === "Tab") {
      const all = [...dialogRef.current.querySelectorAll("button")].filter(
        (b) => b.offsetParent && getComputedStyle(b).visibility !== "hidden",
      );
      const first = all[0];
      const lastButton = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastButton.focus();
      } else if (!e.shiftKey && document.activeElement === lastButton) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (features || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" && index < last) goToStep(index + 1);
    else if (e.key === "ArrowLeft" && index > 0) goToStep(index - 1);
  };

  // ---------- Drawing ----------
  const level = motion === "full" ? "full" : motion === "calm" ? "calm" : "off";
  const cardStyle = phone
    ? undefined
    : cardPos
      ? { left: cardPos.left, top: cardPos.top }
      : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  const phoneCentered = phone && !holes.length;
  // Phones: next to a top-bar button (menu, search) or with no target, the card may grow
  // taller; under a Dashboard card it stays at about half the screen.
  const phoneTall = phone && (features || !!step.phoneTargets);
  const vw =
    typeof window === "undefined" ? 0 : document.documentElement.clientWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  const navPreview =
    phone && step.nav && !features ? previewRows(pages, step.nav) : null;
  const navNames = step.nav?.map((id) => pages.find((p) => p.id === id)?.label);

  return (
    <dialog
      ref={dialogRef}
      className={`tour tour-${level}`}
      aria-labelledby={features ? "tour-features-title" : "tour-title"}
      aria-describedby={features ? undefined : "tour-text"}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
    >
      {/* The dim layer, with a rounded hole over each highlighted element, and a ring
          around each hole. All decoration: hidden from screen readers, never clickable. */}
      <svg className="tour-shade" aria-hidden="true" focusable="false">
        <path
          fillRule="evenodd"
          style={{ d: `path("${shadePath(vw, vh, holes)}")` }}
        />
      </svg>
      {holes.map((b, i) => (
        <div
          key={i}
          className="tour-ring"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
          aria-hidden="true"
        />
      ))}

      <div
        ref={cardRef}
        className={`tour-card${phone ? " is-phone" : ""}${phoneTall ? " is-tall" : ""}${phoneCentered ? " is-centered" : ""}`}
        style={cardStyle}
      >
        {features ? (
          <>
            <div className="tour-body" key="features">
              <h2 id="tour-features-title" ref={featuresTitleRef} tabIndex={-1}>
                More in Finnelee
              </h2>
              <ul className="tour-features">
                {TOUR_FEATURES.map((f) => (
                  <li key={f.name}>
                    <button
                      type="button"
                      onClick={() =>
                        onEnd("done", {
                          page: f.page,
                          focus: f.focus ?? [],
                          label: f.name,
                        })
                      }
                    >
                      <span className="tour-feature-name">{f.name}</span>
                      <span className="tour-feature-text">{f.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="tour-foot">
              <span className="tour-foot-gap" />
              <button type="button" className="btn" onClick={closeFeatures}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onEnd("done")}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tour-head">
              <span className="tour-count">
                Step {index + 1} of {TOUR_STEPS.length}
              </span>
              <span className="tour-progress" aria-hidden="true">
                {TOUR_STEPS.map((s, i) => (
                  <span key={s.title} className={i <= index ? "is-done" : ""} />
                ))}
              </span>
            </div>
            {/* key: each step's text fades in fresh (Full and Calm). */}
            <div className="tour-body" key={index}>
              <h2 id="tour-title">{step.title}</h2>
              <p id="tour-text">{textFor(step, phone)}</p>
              {step.showMe && !offer && (
                <button
                  type="button"
                  className="btn tour-action"
                  onClick={() => onEnd("showme", step.showMe)}
                >
                  Show me: {step.showMe.label}
                </button>
              )}
              {step.explore && (
                <button
                  type="button"
                  className="btn tour-action"
                  onClick={openFeatures}
                >
                  Explore all features
                </button>
              )}
              {navPreview && (
                <div className="tour-menu">
                  <p className="tour-menu-label">
                    Menu preview: {navNames.join(" and ")}
                  </p>
                  <ul aria-hidden="true">
                    {navPreview.map((p) => (
                      <li key={p.id} className={p.on ? "is-on" : ""}>
                        {p.label}
                      </li>
                    ))}
                  </ul>
                  <p className="tour-menu-hint">
                    Not clickable during the tour. Afterwards, tap the menu
                    button (☰) at the top left to find{" "}
                    {navNames.length > 1 ? "them" : "it"}.
                  </p>
                </div>
              )}
            </div>
            {/* Fixed footer: the buttons keep their places on every step. */}
            <div className="tour-foot">
              <button
                type="button"
                className="btn-link tour-skip"
                onClick={skip}
              >
                {offer ? "Not now" : "Skip tour"}
              </button>
              <span className="tour-foot-gap" />
              <button
                type="button"
                className="btn"
                onClick={back}
                // Hidden but still taking its space on step 1, so nothing shifts.
                style={index === 0 ? { visibility: "hidden" } : undefined}
              >
                Back
              </button>
              <button
                ref={nextRef}
                type="button"
                className="btn btn-primary"
                onClick={next}
              >
                {offer ? "Take the tour" : index === last ? "Done" : "Next"}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </dialog>
  );
}

const textFor = (step, phone) => (phone && step.phoneText) || step.text;

const sameBox = (a, b) =>
  a === b ||
  (a &&
    b &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height);

/** The dim layer's outline: the whole window, minus a rounded hole per box. */
function shadePath(width, height, holes, r = 14) {
  const hole = ({ left: x, top: y, width: w, height: h }) => {
    const k = Math.min(r, w / 2, h / 2);
    return (
      `M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}` +
      `V${y + h - k}A${k} ${k} 0 0 1 ${x + w - k} ${y + h}` +
      `H${x + k}A${k} ${k} 0 0 1 ${x} ${y + h - k}` +
      `V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`
    );
  };
  return `M0 0H${width}V${height}H0Z` + holes.map(hole).join("");
}

/**
 * Scrolls the page so the target is fully visible: below the phone's top bar and
 * above the docked card, or anywhere in the window on wide screens.
 */
function scrollIntoSight(el, phone, card, smooth) {
  if (el.closest(".mobile-bar, .sidebar")) return; // fixed in place: scrolling can't help
  const r = el.getBoundingClientRect();
  const bar = phone
    ? (document.querySelector(".mobile-bar")?.offsetHeight ?? 0)
    : 0;
  const top = bar + 16;
  const bottom =
    phone && card
      ? card.getBoundingClientRect().top - 16
      : window.innerHeight - 16;
  if (r.top >= top && r.bottom <= bottom) return;
  window.scrollBy({ top: r.top - top, behavior: smooth ? "smooth" : "auto" });
}
