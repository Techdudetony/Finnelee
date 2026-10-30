// Zero-based budgets with rollover. Pure functions (no React), so every rule is unit-tested.
//
// Stored in settings.budgeting (missing parts are fine: readBudgeting fills them in):
//   limits:        { Groceries: [{ from: null, limit: 450 }, { from: '2026-11', limit: 500 }] }
//                  limit changes, oldest first; each applies from its month until the next one.
//                  from: null = "before the first recorded change". A next-month plan is just
//                  an entry dated next month, so it never touches this month's limit.
//   plannedIncome: { '2026-11': 5200 }   confirmed amounts only; a missing month shows a suggestion
//   rollover:      { Groceries: [{ from: '2026-09', to: null, opening?: 0 }] }
//                  periods, oldest first; to: null = still on; opening = balance it starts with
//
// `budgets` ({ Groceries: 500 }) stays "this month's limits", so insights, the welcome
// summary and old backups keep working. syncBudgets() keeps it current as months pass.

import { monthKey } from "./format";
import { requiredMonthly } from "./finance";

const round2 = (n) => Math.round(n * 100) / 100; // money has 2 decimals
const toAmount = (v) => (Number(v) > 0 ? Number(v) : 0); // '' / undefined / negative -> 0
const sum = (arr, pick) => arr.reduce((total, item) => total + pick(item), 0);

// ---------- Months ('YYYY-MM' strings compare correctly as plain text) ----------

/** '2026-12' + 1 -> '2027-01'. Date handles the year change. */
export function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}

/** The months the Budget page can show: first transaction month (or now) through next month. */
export function budgetMonths(transactions, today = new Date()) {
  const current = monthKey(today);
  const first = transactions
    .reduce((min, t) => (t.date < min ? t.date : min), current)
    .slice(0, 7);
  const months = [];
  for (let k = first; k <= addMonths(current, 1); k = addMonths(k, 1))
    months.push(k);
  return months;
}

/** 'past' (read-only), 'current' or 'next' (both editable). */
export function monthMode(month, today = new Date()) {
  const current = monthKey(today);
  return month === current
    ? "current"
    : month === addMonths(current, 1)
      ? "next"
      : "past";
}

// ---------- Reading settings safely ----------

const isMonth = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const asObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
const byFrom = (a, b) => (a.from ?? "").localeCompare(b.from ?? ""); // null sorts first

// { category: [entries] } keeping only valid entries, sorted oldest first.
const readLists = (raw, valid) =>
  Object.fromEntries(
    Object.entries(asObject(raw))
      .filter(([, list]) => Array.isArray(list))
      .map(([category, list]) => [category, list.filter(valid).sort(byFrom)])
      .filter(([, list]) => list.length),
  );

/**
 * settings.budgeting with every part present and every entry the right shape.
 * Old backups, sample data and new accounts have no budgeting at all: that's fine.
 */
export function readBudgeting(settings) {
  const raw = asObject(settings?.budgeting);
  return {
    limits: readLists(
      raw.limits,
      (e) => (e?.from === null || isMonth(e?.from)) && isNumber(e?.limit),
    ),
    plannedIncome: Object.fromEntries(
      Object.entries(asObject(raw.plannedIncome)).filter(
        ([k, v]) => isMonth(k) && isNumber(v),
      ),
    ),
    rollover: readLists(
      raw.rollover,
      (p) =>
        isMonth(p?.from) &&
        (p.to === null || isMonth(p.to)) &&
        (p.opening === undefined || isNumber(p.opening)),
    ),
  };
}

const withBudgeting = (settings, budgeting) => ({ ...settings, budgeting });

// ---------- Limits (allocations) ----------

/** A category's limit in a month: its latest change on or before that month, else `budgets`. */
export function limitFor(budgets, budgeting, category, month) {
  const history = budgeting.limits[category];
  if (!history) return toAmount(budgets[category]); // never edited: same limit every month
  let limit = 0;
  for (const entry of history)
    if (entry.from === null || entry.from <= month) limit = entry.limit;
  return limit;
}

// Drops entries equal to the one before them: they change nothing.
const compact = (history) =>
  history.filter((e, i) => i === 0 || e.limit !== history[i - 1].limit);

/**
 * Sets a category's limit for `month` (this month or next only; past months are history).
 * Returns { budgets, settings }. Only a current-month edit changes `budgets`.
 */
export function setLimit(
  { budgets, settings },
  category,
  month,
  value,
  today = new Date(),
) {
  if (monthMode(month, today) === "past") return { budgets, settings };
  const budgeting = readBudgeting(settings);
  const limit = toAmount(value);
  // First edit: save the old limit as the starting point, so earlier months keep it.
  const base = budgeting.limits[category] ?? [
    { from: null, limit: toAmount(budgets[category]) },
  ];
  // Typing replaces this month's entry instead of adding one per keystroke.
  const history = compact(
    [...base.filter((e) => e.from !== month), { from: month, limit }].sort(
      byFrom,
    ),
  );
  return {
    // '' stays '' so the input can be cleared while typing.
    budgets:
      month === monthKey(today)
        ? { ...budgets, [category]: value === "" ? "" : limit }
        : budgets,
    settings: withBudgeting(settings, {
      ...budgeting,
      limits: { ...budgeting.limits, [category]: history },
    }),
  };
}

/**
 * Brings `budgets` up to date when the calendar moves into a month that has a planned
 * limit. Returns the SAME object when nothing changed, so React skips a re-render.
 */
export function syncBudgets(budgets, settings, today = new Date()) {
  const budgeting = readBudgeting(settings);
  const month = monthKey(today);
  let next = budgets;
  for (const category of Object.keys(budgeting.limits)) {
    const limit = limitFor(budgets, budgeting, category, month);
    if (toAmount(budgets[category]) !== limit)
      next = { ...next, [category]: limit };
  }
  return next;
}

// ---------- Spending and rollover ----------

/** Expense totals by month and category: Map '2026-10|Groceries' -> 412.5. Built once per render. */
export function spendingByMonth(transactions) {
  const map = new Map();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const key = `${t.date.slice(0, 7)}|${t.category}`;
    map.set(key, (map.get(key) ?? 0) + Number(t.amount));
  }
  return map;
}
const spentIn = (spending, category, month) =>
  spending.get(`${month}|${category}`) ?? 0;

/** The rollover period covering `month`, or undefined. An undone period (to before from) covers nothing. */
export function periodFor(budgeting, category, month) {
  return (budgeting.rollover[category] ?? []).find(
    (p) => p.from <= month && (p.to === null || month <= p.to),
  );
}

/**
 * Balance carried INTO `month`: the period's opening balance plus (limit − spent) for each
 * earlier month of the period. Months before the period never count. Can be negative.
 */
export function carryover(budgets, budgeting, spending, category, month) {
  const period = periodFor(budgeting, category, month);
  if (!period) return 0;
  let carry = period.opening ?? 0;
  for (let k = period.from; k < month; k = addMonths(k, 1))
    carry +=
      limitFor(budgets, budgeting, category, k) -
      spentIn(spending, category, k);
  return round2(carry);
}

/**
 * Turns rollover on or off for a category, effective this month:
 * - on (first time, or in a later month): new period with a fresh $0 balance
 * - off: the open period ends last month, so this month has no carryover
 * - on again in the month it was turned off: reopens it (undo, balance comes back)
 * - off in the month it was turned on: the period becomes empty (as if never on)
 */
export function setRollover(settings, category, on, today = new Date()) {
  const month = monthKey(today);
  const lastMonth = addMonths(month, -1);
  const budgeting = readBudgeting(settings);
  const periods = budgeting.rollover[category] ?? [];
  const last = periods.at(-1);
  const isOn = last?.to === null;
  if (on === isOn) return settings;

  let next;
  if (!on) next = [...periods.slice(0, -1), { ...last, to: lastMonth }];
  else if (last?.to === lastMonth)
    next = [...periods.slice(0, -1), { ...last, to: null }];
  else
    next = [
      ...periods.filter((p) => p.to === null || p.to >= p.from),
      { from: month, to: null },
    ]; // drop undone periods
  return withBudgeting(settings, {
    ...budgeting,
    rollover: { ...budgeting.rollover, [category]: next },
  });
}

/**
 * One row per expense category for the Budget table:
 * { category, allocation, carryover, available, spent, remaining, rollsOver }
 * available = allocation + carryover; remaining = available − spent.
 */
export function budgetRows(
  { budgets, settings, transactions, categories },
  month,
) {
  const budgeting = readBudgeting(settings);
  const spending = spendingByMonth(transactions);
  return categories
    .filter((c) => c.type === "expense")
    .map(({ name }) => {
      const allocation = limitFor(budgets, budgeting, name, month);
      const carry = carryover(budgets, budgeting, spending, name, month);
      const spent = round2(spentIn(spending, name, month));
      const available = round2(allocation + carry);
      return {
        category: name,
        allocation,
        carryover: carry,
        available,
        spent,
        remaining: round2(available - spent),
        rollsOver: Boolean(periodFor(budgeting, name, month)),
      };
    });
}

// ---------- Planned income and Left to assign ----------

/** Average income over the 3 full months before this one (empty months count as $0), or null. */
export function suggestedIncome(transactions, today = new Date()) {
  const current = monthKey(today);
  const months = [1, 2, 3].map((n) => addMonths(current, -n));
  const total = sum(
    transactions.filter(
      (t) => t.type === "income" && months.includes(t.date.slice(0, 7)),
    ),
    (t) => Number(t.amount),
  );
  return total > 0 ? Math.round(total / 3) : null;
}

/** Saves (or with '' clears) the confirmed planned income for a month. Only this month or next. */
export function setPlannedIncome(settings, month, value, today = new Date()) {
  if (monthMode(month, today) === "past") return settings;
  const budgeting = readBudgeting(settings);
  const { [month]: _old, ...others } = budgeting.plannedIncome; // _old: replaced below
  const plannedIncome =
    value === "" ? others : { ...others, [month]: toAmount(value) };
  return withBudgeting(settings, { ...budgeting, plannedIncome });
}

/** Monthly contributions the unfinished goals need, as of the 1st of `month`. */
export function goalContributions(goals, month) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const open = goals.filter((g) => Number(g.saved) < Number(g.target));
  return round2(sum(open, (g) => requiredMonthly(g, first)));
}

/**
 * Zero-based budgeting for one month:
 *   left = planned income − category allocations − goal contributions
 * Carryover is NOT income (it was assigned in an earlier month), and savings counts
 * once, through goals. `confirmed` is false while the suggestion is being used.
 */
export function leftToAssign(
  { budgets, settings, categories, goals, suggestion },
  month,
) {
  const budgeting = readBudgeting(settings);
  const confirmed = budgeting.plannedIncome[month];
  const income = confirmed ?? suggestion ?? 0;
  const allocated = round2(
    sum(
      categories.filter((c) => c.type === "expense"),
      (c) => limitFor(budgets, budgeting, c.name, month),
    ),
  );
  const goalSavings = goalContributions(goals, month);
  const assigned = round2(allocated + goalSavings);
  return {
    income,
    confirmed: confirmed !== undefined,
    allocated,
    goalSavings,
    assigned,
    left: round2(income - assigned),
  };
}
