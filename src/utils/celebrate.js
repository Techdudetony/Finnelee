// When to celebrate. Pure rules, so each one is unit tested. A celebration starts only
// from a user action on the page that changed the numbers (never from loading, a reload,
// a backup restore or a rerender), and nothing about it is ever saved.
// All money is compared in whole cents, so 0.1 + 0.2 style float errors can't hide a
// $0.00 or invent one.

/** A money value as whole cents ("" and bad input count as 0). */
export function toCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Adds money to one goal (a negative amount takes it out; saved never goes below 0).
 * Used both for the saved update and for the celebration check, so the check always
 * sees the same before and after that gets saved. Returns { goals, before, after };
 * before/after are null when there's no goal with that id.
 */
export function addToGoal(goals, id, amount) {
  let before = null;
  let after = null;
  const next = goals.map((g) => {
    if (g.id !== id) return g;
    before = g;
    after = { ...g, saved: Math.max(0, g.saved + amount) };
    return after;
  });
  return { goals: next, before, after };
}

/**
 * True when a goal went from below its target to at or above it because money was
 * added. Lowering the target alone never counts, and neither does a goal that was
 * already reached. before/after: { saved, target }.
 */
export function goalReached(before, after) {
  const target = toCents(after.target);
  const saved = toCents(after.saved);
  return (
    target > 0 &&
    toCents(before.saved) < toCents(before.target) &&
    saved >= target &&
    saved > toCents(before.saved)
  );
}

/** A zero-based month is complete: confirmed income above $0, exactly $0.00 left. */
export const budgetComplete = (plan) =>
  plan.confirmed === true &&
  toCents(plan.income) > 0 &&
  toCents(plan.left) === 0;

/**
 * True when a change made the month complete and it wasn't before: left to assign
 * moved to exactly $0.00, or income was confirmed while $0.00 was left. before and
 * after are leftToAssign() results.
 */
export const budgetCompleted = (before, after) =>
  budgetComplete(after) && !budgetComplete(before);

/**
 * Budget amounts are typed one key at a time, so a typed value can pass through $0.00
 * on the way to another number ("10" on the way to "100"). This waits until typing
 * pauses for `delay` ms, then calls onSettle(startValue, latestValue): the value before
 * the first keystroke and the value now. Timers are injected for tests.
 */
export function createSettleWatcher(
  onSettle,
  { delay = 700, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  let timer = null;
  let start;
  let latest;
  return {
    change(before, after) {
      if (timer === null)
        start = before; // first change since the last pause
      else clearTimer(timer);
      latest = after;
      timer = setTimer(() => {
        timer = null;
        onSettle(start, latest);
      }, delay);
    },
    /** Drops a pending check (month changed, page closed). */
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

/** What screen readers hear, at every Motion level. */
export const goalMessage = (name, saved) =>
  `${name} goal reached: ${saved} saved.`;
export const budgetMessage = (month) => `Every dollar assigned for ${month}.`;
