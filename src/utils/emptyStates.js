// Decides what a chart or card shows before it has enough to work with.
// Each function returns a `state`:
//   "ready"        draw the real thing
//   "empty"        nothing has been recorded yet
//   "insufficient" some records, but not enough for this view (with `have` and `need`)
// They only read the numbers each page already computes. Nothing here calculates money
// figures or changes stored data.

/** Full months of spending the spending forecast needs before its trend means anything. */
export const FORECAST_MONTHS = 2;
/** Monthly snapshots the net worth chart needs before it can draw a line. */
export const HISTORY_POINTS = 2;

/**
 * Spending forecast (Forecast page). `history` is monthlySeries(transactions, 6): the
 * last entry is the current, unfinished month, so only the months before it count.
 */
export function spendingForecastState(history) {
  const have = history.slice(0, -1).filter((m) => m.expenses > 0).length;
  if (have >= FORECAST_MONTHS)
    return { state: "ready", have, need: FORECAST_MONTHS };
  const anything = history.some((m) => m.expenses > 0 || m.income > 0);
  return {
    state: anything ? "insufficient" : "empty",
    have,
    need: FORECAST_MONTHS,
  };
}

/** Savings projection (Forecast page): flat at $0 when both inputs are 0. */
export function projectionState({ start, monthly }) {
  return Number(start) > 0 || Number(monthly) > 0 ? "ready" : "empty";
}

/** Income vs. spending chart (Dashboard). `series` is monthlySeries(transactions, 6). */
export function incomeSpendingState(series) {
  return series.some((m) => m.income > 0 || m.expenses > 0) ? "ready" : "empty";
}

/**
 * Net worth over time (Net Worth page). The chart needs HISTORY_POINTS monthly snapshots.
 * Debt Planner debts count toward net worth, so someone with debts but no accounts has
 * meaningful data too: they get the insufficient state, with `needsAccount` because a
 * snapshot is only saved once there is at least one account (utils/netWorth.js). Only
 * with no accounts and no debts at all does the card stay hidden ("No assets yet" and
 * "No debts in the Debt Planner" already explain the page).
 */
export function netWorthHistoryState(points, accountCount, debts = []) {
  const need = HISTORY_POINTS;
  if (points >= need) return { state: "ready", have: points, need };
  const hasDebt = debts.some((d) => Number(d.balance) > 0);
  if (accountCount === 0 && !hasDebt)
    return { state: "hidden", have: points, need };
  return {
    state: "insufficient",
    have: points,
    need,
    needsAccount: accountCount === 0,
  };
}

/**
 * Budget month (Budget page). `plan` is leftToAssign(...). Nothing assigned yet means the
 * month hasn't been planned; with no income either, "left to assign" is $0.00 only
 * because both sides are empty, so it must not read as "every dollar assigned".
 */
export function budgetPlanState(plan) {
  if (plan.assigned > 0) return "ready";
  return plan.income > 0 ? "unassigned" : "empty";
}
