// All the financial math lives here as PURE functions: same input -> same output,
// no React, no side effects. That makes them easy to reason about, reuse and unit-test.

import { monthKey, monthLabel, parseDate, toISODate } from './format';

const sum = (arr, pick = (x) => x) => arr.reduce((total, item) => total + Number(pick(item) || 0), 0);

// ---------------------------------------------------------------------------
// Monthly totals
// ---------------------------------------------------------------------------

/** Keys for the last `count` months ending with the month of `end`, oldest first. ['2026-05', ..., '2026-10'] */
export function lastMonthKeys(count = 6, end = new Date()) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(end.getFullYear(), end.getMonth() - i, 1)));
  }
  return keys;
}

/** Income, expenses, net and savings rate for one month ('YYYY-MM'). */
export function monthTotals(transactions, key) {
  const inMonth = transactions.filter((t) => t.date.startsWith(key));
  const income = sum(inMonth.filter((t) => t.type === 'income'), (t) => t.amount);
  const expenses = sum(inMonth.filter((t) => t.type === 'expense'), (t) => t.amount);
  const net = income - expenses;
  return { income, expenses, net, savingsRate: income > 0 ? net / income : 0 };
}

/** One row per month for charts: [{ key, label, income, expenses, net }, ...] */
export function monthlySeries(transactions, count = 6, end = new Date()) {
  return lastMonthKeys(count, end).map((key) => ({
    key,
    label: monthLabel(key),
    ...monthTotals(transactions, key),
  }));
}

/** Spending per category for a month, largest first: [{ category, amount }] */
export function spendingByCategory(transactions, key) {
  const totals = {};
  for (const t of transactions) {
    if (t.type === 'expense' && t.date.startsWith(key)) {
      totals[t.category] = (totals[t.category] || 0) + Number(t.amount);
    }
  }
  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/**
 * Least-squares linear regression on evenly spaced values (x = 0, 1, 2, ...).
 * Finds the straight line y = intercept + slope * x that best fits the points.
 */
export function linearRegression(values) {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0] };
  const meanX = (n - 1) / 2;
  const meanY = sum(values) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  const slope = num / den;
  return { slope, intercept: meanY - slope * meanX };
}

/** Predict the value one step after the series ends (never below 0). */
export function predictNext(values) {
  const { slope, intercept } = linearRegression(values);
  return Math.max(0, intercept + slope * values.length);
}

/**
 * Compound growth with a monthly contribution.
 * Each month: balance grows by (annualRate / 12), then the contribution is added.
 * Returns one point per month: [{ month, balance, contributed }]
 */
export function projectSavings({ start = 0, monthly = 0, annualRate = 0, years = 10 }) {
  const r = annualRate / 100 / 12;
  let balance = Number(start);
  let contributed = Number(start);
  const points = [{ month: 0, balance, contributed }];
  for (let month = 1; month <= years * 12; month++) {
    balance = balance * (1 + r) + Number(monthly);
    contributed += Number(monthly);
    points.push({ month, balance, contributed });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Debt payoff: Snowball vs Avalanche
// ---------------------------------------------------------------------------

const MAX_MONTHS = 600; // 50-year safety stop in case payments never cover the interest

/**
 * Simulates paying off debts month by month.
 *
 * The monthly budget is fixed at (sum of minimums + extra). When a debt is paid off,
 * its minimum keeps being spent on the next target: that's the "rollover" that makes
 * both methods accelerate over time.
 *
 * strategy: 'snowball'  -> smallest balance first (motivating quick wins)
 *           'avalanche' -> highest APR first (mathematically least interest)
 */
export function simulateDebtPayoff(debts, extraPayment = 0, strategy = 'avalanche') {
  // Copy the debts so we never mutate the app's state objects.
  const list = debts
    .filter((d) => Number(d.balance) > 0)
    .map((d) => ({ ...d, balance: Number(d.balance), apr: Number(d.apr), minPayment: Number(d.minPayment) }));

  const budget = sum(list, (d) => d.minPayment) + Number(extraPayment);
  const totalBalance = () => sum(list, (d) => d.balance);
  const timeline = [{ month: 0, balance: totalBalance() }];
  const payoffOrder = [];
  let totalInterest = 0;
  let month = 0;

  while (list.some((d) => d.balance > 0.005) && month < MAX_MONTHS) {
    month++;

    // 1) Interest accrues on what's still owed.
    for (const d of list) {
      if (d.balance <= 0) continue;
      const interest = d.balance * (d.apr / 100 / 12);
      d.balance += interest;
      totalInterest += interest;
    }

    // 2) Pay the minimum on every open debt.
    let remaining = budget;
    for (const d of list) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minPayment, d.balance, remaining);
      d.balance -= pay;
      remaining -= pay;
    }

    // 3) Throw everything left at the target debt(s), in strategy order.
    const order = list
      .filter((d) => d.balance > 0)
      .sort(strategy === 'snowball' ? (a, b) => a.balance - b.balance : (a, b) => b.apr - a.apr);
    for (const d of order) {
      if (remaining <= 0) break;
      const pay = Math.min(remaining, d.balance);
      d.balance -= pay;
      remaining -= pay;
    }

    // 4) Record any debt that just hit zero.
    for (const d of list) {
      if (d.balance <= 0.005 && !d.paidOff) {
        d.balance = 0;
        d.paidOff = true;
        payoffOrder.push({ name: d.name, month });
      }
    }

    timeline.push({ month, balance: totalBalance() });
  }

  return { months: month, totalInterest, timeline, payoffOrder, budget, finished: month < MAX_MONTHS };
}

// ---------------------------------------------------------------------------
// Goals, bills, ratios
// ---------------------------------------------------------------------------

/** Whole months from today until a 'YYYY-MM-DD' deadline (minimum 0). */
export function monthsUntil(deadlineISO, from = new Date()) {
  const d = parseDate(deadlineISO);
  const months = (d.getFullYear() - from.getFullYear()) * 12 + (d.getMonth() - from.getMonth());
  return Math.max(0, months);
}

/** How much to save each month to reach a goal by its deadline. */
export function requiredMonthly(goal, from = new Date()) {
  const remaining = Math.max(0, goal.target - goal.saved);
  const months = monthsUntil(goal.deadline, from);
  return months > 0 ? remaining / months : remaining; // deadline this month: everything now
}

/**
 * Next date a monthly bill is due. dueDay 31 in a 30-day month falls on the last day.
 * Returns { date: 'YYYY-MM-DD', daysAway }.
 */
export function nextDueDate(dueDay, from = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const clampDay = (y, m) => Math.min(dueDay, new Date(y, m + 1, 0).getDate()); // day 0 of next month = last day of this one
  let due = new Date(today.getFullYear(), today.getMonth(), clampDay(today.getFullYear(), today.getMonth()));
  if (due < today) {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    due = new Date(y, m, clampDay(y, m));
  }
  const daysAway = Math.round((due - today) / 86_400_000); // ms per day
  return { date: toISODate(due), daysAway };
}

/** 50/30/20 rule targets for a monthly take-home income. */
export const fiftyThirtyTwenty = (income) => ({
  needs: income * 0.5,
  wants: income * 0.3,
  savings: income * 0.2,
});

/** Debt-to-income ratio with a plain-language rating. */
export function debtToIncome(monthlyDebt, grossMonthlyIncome) {
  const ratio = grossMonthlyIncome > 0 ? monthlyDebt / grossMonthlyIncome : 0;
  const rating = ratio <= 0.36 ? 'healthy' : ratio <= 0.43 ? 'caution' : 'high';
  return { ratio, rating };
}

/** Add whole months to a date and return 'Mon YYYY' (e.g. for "debt-free by"). */
export function monthsFromNowLabel(months, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() + months, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Summary metrics (used by the welcome summary)
// ---------------------------------------------------------------------------

/**
 * "Safe to spend" for the rest of this month:
 *   income received − spent so far − bills still due this month − planned goal savings
 * Bills "still due" are those whose due day is later this month (we assume earlier ones are paid).
 */
export function safeToSpend({ transactions, bills, goals }, today = new Date()) {
  const { income, expenses } = monthTotals(transactions, monthKey(today));
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const billsLeft = sum(
    bills.filter((b) => Math.min(Number(b.dueDay), lastDay) > today.getDate()),
    (b) => b.amount
  );
  const plannedSavings = sum(goals.filter((g) => g.saved < g.target), (g) => requiredMonthly(g, today));
  return { amount: income - expenses - billsLeft - plannedSavings, income, spent: expenses, billsLeft, plannedSavings };
}

/**
 * Emergency fund readiness: how many months your savings could cover essential
 * ("needs") spending, based on the average of the last 3 full months.
 * The 3–6 month range is the common rule of thumb.
 */
export function emergencyFundMonths(savings, transactions, isEssential, today = new Date()) {
  const keys = lastMonthKeys(4, today).slice(0, 3); // 3 full months before the current one
  const monthly = keys.map((key) =>
    sum(transactions.filter((t) => t.type === 'expense' && t.date.startsWith(key) && isEssential(t.category)), (t) => t.amount)
  );
  const avgEssential = sum(monthly) / keys.length;
  return { months: avgEssential > 0 ? Number(savings) / avgEssential : null, avgEssential };
}
