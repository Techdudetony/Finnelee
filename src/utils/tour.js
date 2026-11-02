// The guided tour's eight steps and where its card and highlights go. Loaded only
// with the tour (components/GuidedTour.jsx); who is offered it is utils/onboarding.js.
// Pure functions only (no React, no DOM reads), so all of it is unit-tested.

/*
 * The steps. `targets` are CSS selectors for the real elements to highlight;
 * `phoneTargets` replaces them on phones. `nav` lists page ids that live in the
 * menu: phones highlight the menu button and show a preview of the menu instead
 * of opening the drawer under the tour. A target that isn't on screen gives a
 * centered card with no highlight.
 */
const navTarget = (id) => `[data-tour="${id}"]`;

export const TOUR_STEPS = [
  {
    title: "Finnelee in three ideas",
    text: "Track your money. Plan where it goes. See your progress. Your financial information stays in this browser.",
  },
  {
    title: "Your financial health",
    text: "A score from 0 to 100, built from five areas: savings, emergency fund, budgets, bills and debt. Each colored ring segment is one area. It is an educational planning indicator, not a credit score.",
    targets: [".orb-hero"],
  },
  {
    title: "Each area needs enough data",
    text: "An area counts once it has enough data, and the score appears when at least 3 of the 5 do. An area marked “Needs data” tells you what to add.",
    targets: [".orb-pillars"],
  },
  {
    title: "Start with transactions",
    text: "Start by tracking the money coming in and going out. Add transactions manually or import a CSV or PDF statement to see where your money goes.",
    nav: ["transactions"],
    showMe: {
      label: "Add a transaction",
      page: "transactions",
      focus: ["add-transaction"],
    },
  },
  {
    title: "Give every dollar a job",
    text: "Enter the income you expect this month, then share it out across categories until nothing is left to assign. That is zero-based budgeting: a plan for every dollar, not a cut to every dollar.",
    nav: ["budget"],
    showMe: {
      label: "Enter planned income",
      page: "budget",
      focus: ["planned-income"],
    },
  },
  {
    title: "What you own and owe",
    text: "Begin with a single account on Net Worth. Add debts in the Debt Planner whenever you are ready, and it compares payoff plans for you.",
    nav: ["networth", "debt"],
    showMe: {
      label: "Add an account",
      page: "networth",
      focus: ["add-account"],
    },
  },
  {
    title: "Get around faster",
    text: "Jump to any page or action, or type “motion calm” to change a setting. Press Ctrl K from anywhere.",
    phoneText:
      "Jump to any page or action, or type “motion calm” to change a setting. Tap the search icon at the top right.",
    targets: [".palette-open"],
    phoneTargets: [".palette-phone"],
  },
  {
    title: "Make it yours",
    text: "Choose how much Finnelee moves, back up your data and keep your recovery key in Settings. You can replay this tour there anytime.",
    nav: ["settings"],
    explore: true,
  },
];

// Steps with `nav` point at the sidebar item(s) on wide screens.
for (const step of TOUR_STEPS)
  if (step.nav) {
    step.targets = step.nav.map(navTarget);
    step.phoneTargets = [".menu-button"];
  }

/** The selectors a step highlights on this screen size. */
export const stepTargets = (step, phone) =>
  (phone ? step.phoneTargets : null) ?? step.targets ?? [];

/** "Explore all features": the pages the tour doesn't cover, one line each. */
export const TOUR_FEATURES = [
  {
    page: "forecast",
    name: "Forecast",
    text: "Project your savings with cautious, expected and hopeful growth, and see where spending is heading.",
  },
  {
    page: "goals",
    name: "Goals",
    text: "Set a target and a date, and see how much to put aside each month.",
  },
  {
    page: "bills",
    name: "Bills",
    text: "List recurring bills and your pay schedule, and see what is due before payday.",
  },
  {
    page: "categories",
    name: "Categories",
    text: "Add and organize the categories your transactions and budgets use.",
  },
  {
    page: "settings",
    focus: ["export-backup"],
    name: "Backups and recovery",
    text: "Your data lives only in this browser. Export a backup file in Settings, and keep your recovery key safe: it lets you reset a forgotten password.",
  },
];

/**
 * The rows for the phone menu preview: every highlighted page plus one neighbour on
 * each side, at least four rows, so it reads as a slice of the real menu.
 */
export function previewRows(pages, nav) {
  const at = nav.map((id) => pages.findIndex((p) => p.id === id));
  let from = Math.max(0, Math.min(...at) - 1);
  let to = Math.min(pages.length, Math.max(...at) + 2);
  while (to - from < 4 && (from > 0 || to < pages.length)) {
    if (to < pages.length) to++;
    else from--;
  }
  return pages.slice(from, to).map((p) => ({ ...p, on: nav.includes(p.id) }));
}

// ---------- Geometry (viewport pixels) ----------

/** The smallest box around every rect, or null for none. */
export function unionRect(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

export const MIN_VISIBLE = 40; // a highlight smaller than this is not worth showing

/**
 * The highlight: the target grown by `pad`, clipped to the part that is really
 * visible between `top` and `bottom` (on phones, `bottom` is the card's top edge).
 * Null when too little is visible, which means "use the centered card".
 */
export function visibleHighlight(rect, { width, top = 0, bottom }, pad = 6) {
  if (!rect) return null;
  const left = Math.max(4, rect.left - pad);
  const right = Math.min(width - 4, rect.left + rect.width + pad);
  const y1 = Math.max(top, rect.top - pad);
  const y2 = Math.min(bottom, rect.top + rect.height + pad);
  if (right - left < MIN_VISIBLE || y2 - y1 < MIN_VISIBLE) return null;
  return { left, top: y1, width: right - left, height: y2 - y1 };
}

/**
 * Where the desktop card goes: beside the highlight (right, then left), else
 * below or above it, else centered. Kept 16px inside the viewport.
 */
export function placeCard(highlight, card, viewport, gap = 20, edge = 16) {
  const { width: vw, height: vh } = viewport;
  const centered = {
    left: Math.round((vw - card.width) / 2),
    top: Math.max(edge, Math.round((vh - card.height) / 2)),
    side: "center",
  };
  if (!highlight) return centered;
  const h = highlight;
  const clampTop = (t) =>
    Math.round(Math.max(edge, Math.min(t, vh - card.height - edge)));
  const clampLeft = (l) =>
    Math.round(Math.max(edge, Math.min(l, vw - card.width - edge)));
  const right = h.left + h.width + gap;
  if (right + card.width <= vw - edge)
    return { left: Math.round(right), top: clampTop(h.top), side: "right" };
  const left = h.left - gap - card.width;
  if (left >= edge)
    return { left: Math.round(left), top: clampTop(h.top), side: "left" };
  const below = h.top + h.height + gap;
  if (below + card.height <= vh - edge)
    return { left: clampLeft(h.left), top: Math.round(below), side: "below" };
  const above = h.top - gap - card.height;
  if (above >= edge)
    return { left: clampLeft(h.left), top: Math.round(above), side: "above" };
  return centered;
}
