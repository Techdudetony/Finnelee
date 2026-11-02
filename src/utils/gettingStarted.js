// The Dashboard's Getting Started checklist: which steps are done, who sees it, and its
// record in settings. Pure and unit-tested. Every step is DERIVED from the data, never
// ticked by hand, so deleting your only bill un-ticks "Add a recurring bill" (until the
// checklist is finished; after that it never comes back).
//
// Saved as settings.gettingStarted, so it travels with backups:
//   {
//     hiddenAt: ISO | null,        // "Hide" pressed; Settings or the palette clears it
//     completedAt: ISO | null,     // first time all five were done; never overwritten
//     acknowledgedAt: ISO | null,  // the "You're all set up" card was dismissed
//   }
// Older backups have no record at all, which reads as "not hidden, not finished".
// It never reads or writes settings.onboarding except onboarding.newAccount.

import { monthKey } from "./format";
import { limitFor, readBudgeting } from "./budgeting";

/** The five steps, in a fixed order (the same order the guided tour teaches). */
export const GETTING_STARTED_ITEMS = [
  {
    id: "transaction",
    title: "Track your first transaction",
    hint: "See where your money comes from and goes.",
    action: "Add a transaction",
    page: "transactions",
    focus: ["add-transaction"],
  },
  {
    id: "budget",
    title: "Plan this month's budget",
    hint: "Confirm this month's income or set a category limit.",
    action: "Plan your budget",
    page: "budget",
    focus: ["planned-income"],
  },
  {
    id: "account",
    title: "Add an account",
    hint: "Start your net worth with one balance.",
    action: "Add an account",
    page: "networth",
    focus: ["add-account"],
  },
  {
    id: "bill",
    title: "Add a recurring bill",
    hint: "See what's due before payday.",
    action: "Add a bill",
    page: "bills",
    focus: ["add-bill"],
  },
  {
    id: "goal",
    title: "Set a goal",
    hint: "Give what you're saving for a target and a date.",
    action: "Add a goal",
    page: "goals",
    focus: ["add-goal"],
  },
];

const count = (list) => (Array.isArray(list) ? list.length : 0);

/**
 * True when this month has a budget, using the Budget page's own rules:
 * - planned income CONFIRMED for this month and above $0 (a suggestion is never saved,
 *   so it never counts), or
 * - any category whose limit for this month (limitFor: the latest change on or before
 *   this month) is above $0. A limit that was set to $0 this month doesn't count, and
 *   neither does one planned only for next month.
 */
export function budgetPlanned(budgets, settings, month) {
  const budgeting = readBudgeting(settings);
  if (Number(budgeting.plannedIncome[month]) > 0) return true;
  const categories = new Set([
    ...Object.keys(budgets ?? {}),
    ...Object.keys(budgeting.limits),
  ]);
  for (const category of categories)
    if (limitFor(budgets ?? {}, budgeting, category, month) > 0) return true;
  return false;
}

/** { transaction, budget, account, bill, goal } -> true when that step is done. */
export function checklistDone(
  { transactions, budgets, accounts, bills, goals, settings },
  today = new Date(),
) {
  return {
    transaction: count(transactions) > 0,
    budget: budgetPlanned(budgets, settings, monthKey(today)),
    account: count(accounts) > 0,
    bill: count(bills) > 0,
    goal: count(goals) > 0,
  };
}

export const doneCount = (done) =>
  GETTING_STARTED_ITEMS.filter((item) => done[item.id]).length;
const allDone = (done) => doneCount(done) === GETTING_STARTED_ITEMS.length;

/** The saved record with every field present (missing record = all null). */
export function readGettingStarted(settings) {
  const raw = settings?.gettingStarted;
  const at = (v) => (typeof v === "string" ? v : null);
  return {
    exists: Boolean(raw && typeof raw === "object" && !Array.isArray(raw)),
    hiddenAt: at(raw?.hiddenAt),
    completedAt: at(raw?.completedAt),
    acknowledgedAt: at(raw?.acknowledgedAt),
  };
}

/**
 * Who gets the checklist:
 * - a new account (onboarding.newAccount, written only at sign-up), or
 * - an account that already has a record (it was eligible before and started), or
 * - a genuinely empty account: none of the five steps has any data yet.
 * An existing account with bills, goals or a budget is not empty, so it never gets it.
 */
export function isEligible(settings, done) {
  return (
    settings?.onboarding?.newAccount === true ||
    readGettingStarted(settings).exists ||
    doneCount(done) === 0
  );
}

/**
 * What the Dashboard shows: "checklist", "complete" (the one-time "all set up" card)
 * or null (nothing). All five done but not yet recorded shows nothing: App records it
 * on the same render pass.
 */
export function checklistView(settings, done) {
  if (!isEligible(settings, done)) return null;
  const record = readGettingStarted(settings);
  if (record.completedAt) return record.acknowledgedAt ? null : "complete";
  if (record.hiddenAt || allDone(done)) return null;
  return "checklist";
}

/** Settings and the palette offer "Show Getting Started" only while it's hidden and unfinished. */
export function canRestore(settings, done) {
  const record = readGettingStarted(settings);
  return (
    isEligible(settings, done) &&
    record.hiddenAt !== null &&
    !record.completedAt &&
    !allDone(done)
  );
}

const withRecord = (settings, changes) => {
  const { exists, ...record } = readGettingStarted(settings); // exists isn't saved
  return { ...settings, gettingStarted: { ...record, ...changes } };
};

export const markHidden = (settings, now) =>
  withRecord(settings, { hiddenAt: now });
export const markShown = (settings) => withRecord(settings, { hiddenAt: null });
export const markAcknowledged = (settings, now) =>
  readGettingStarted(settings).acknowledgedAt
    ? settings
    : withRecord(settings, { acknowledgedAt: now });

/**
 * Keeps the record in step with the data. Called by App after every change, on any page
 * (so a hidden checklist, or a step finished on another page, still counts).
 *   previous: the `done` map from the last check in this session, or null right after
 *             loading, signing in, or replacing all data (sample data, a backup, Clear).
 * Returns { settings, celebrate }. `settings` is the same object when nothing changed.
 * - An eligible account gets a record (so it stays eligible once it has data).
 * - The first time all five are done, completedAt is saved once and never overwritten.
 * - celebrate is true only when the last step was seen going from not done to done
 *   during this session, by normal use, while the checklist wasn't hidden. Then the
 *   "all set up" card waits for its Done (acknowledgedAt stays null).
 *   Otherwise (data that arrived already complete, or a hidden checklist) it is
 *   acknowledged quietly at the same moment, so no celebration is ever shown for it.
 */
export function trackChecklist(settings, done, previous, now) {
  if (!isEligible(settings, done)) return { settings, celebrate: false };
  const record = readGettingStarted(settings);
  if (record.completedAt) return { settings, celebrate: false };
  if (!allDone(done)) {
    const next = record.exists
      ? settings
      : withRecord(settings, { hiddenAt: null, completedAt: null });
    return { settings: next, celebrate: false };
  }
  const celebrate = previous !== null && !allDone(previous) && !record.hiddenAt;
  return {
    settings: withRecord(settings, {
      completedAt: now,
      acknowledgedAt: celebrate ? null : now,
    }),
    celebrate,
  };
}

/**
 * Clear all data starts the money over, not the checklist: a finished checklist stays
 * finished (completedAt and acknowledgedAt carried over). An unfinished one starts
 * fresh, like everything else that's cleared.
 */
export function keepFinished(before, after) {
  const { completedAt, acknowledgedAt } = readGettingStarted(before);
  if (!completedAt) return after;
  return withRecord(after, { hiddenAt: null, completedAt, acknowledgedAt });
}

/** Steps that went from not done to done between two checks (for announcements). */
export function newlyDone(previous, done) {
  if (!previous) return [];
  return GETTING_STARTED_ITEMS.filter(
    (item) => done[item.id] && !previous[item.id],
  );
}
