// Financial Health: a 0-100 educational planning indicator from five pillars, plus the
// spending card's estimates and the 14-day bills runway. Spec: "Financial Health Orb:
// Specification", revision 3. Pure and read-only: it never changes stored data, and every
// existing calculation it uses (safeToSpend, budgetRows, savingsBalance, ...) is unchanged.
//
// Rules that keep it honest:
// - A pillar without enough data is "needs-data" and left out of the average, never guessed.
// - Balances are manual, so cash is "recently updated", never verified or available.
// - Transactions are "recorded", never assumed complete.
// - Each obligation counts once (see obligations.js); an unknown payment makes the
//   spendable estimate "incomplete" instead of quietly too high.

import {
  monthKey,
  monthLabel,
  parseDate,
  toISODate,
  formatCurrency,
} from "./format";
import {
  lastMonthKeys,
  monthTotals,
  requiredMonthly,
  safeToSpend,
  emergencyFundMonths,
} from "./finance";
import { addMonths, budgetRows } from "./budgeting";
import { readAccounts, savingsBalance, STALE_DAYS } from "./netWorth";
import { needsChecker } from "../data/categories";
import {
  addDays,
  buildObligations,
  dueDateIn,
  paymentsOwed,
  readPayment,
} from "./obligations";

export const CASH_FRESH_DAYS = 7; // stricter than Net Worth's 60: bills depend on today's cash
export const RUNWAY_DAYS = 14;
export const HIGH_APR = 20;
export const MIN_SCORED = 3; // fewer scored pillars than this: no overall score

export const DISCLOSURE =
  "Educational planning indicator based on what you've entered. Not a credit score, financial advice, or a guarantee.";
export const BENCHMARK_NOTE =
  "Benchmarks are common rules of thumb (save 20% of income, keep 3 to 6 months of essentials, keep debt payments under about 36% of income). Your situation may call for different targets.";
export const SPENDING_CAPTION =
  "Estimates from your records. Check your bank before large purchases.";

/** Shown in "How this is scored": one entry per pillar, in display order. */
export const BENCHMARKS = [
  {
    id: "savings",
    name: "Savings rate",
    benchmark: "20% of income",
    formula:
      "(recorded income − recorded expenses) ÷ recorded income, over the last 3 full months that have both",
  },
  {
    id: "emergency",
    name: "Emergency fund",
    benchmark: "6 months of essential costs",
    formula: "savings ÷ average monthly essential spending",
  },
  {
    id: "budgets",
    name: "Budgets on track",
    benchmark: "Every budgeted category within its limit",
    formula:
      "categories within their limit last full month ÷ categories with a limit",
  },
  {
    id: "bills",
    name: "Bills covered",
    benchmark: "Recently updated cash at least equal to bills due in 14 days",
    formula: "recently updated cash ÷ bills due in the next 14 days",
  },
  {
    id: "debt",
    name: "Debt load",
    benchmark: "Under 10% is light; 36% is a common ceiling",
    formula: "monthly required payments ÷ average recorded monthly income",
  },
];

const round2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pct = (ratio) => `${Math.round(ratio * 100)}%`;
const money = (n) => formatCurrency(n, { whole: true });
const shortDate = (iso) =>
  parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

/** Whole days from an ISO date to today; Infinity for a missing date (treated as old). */
function daysSince(iso, today) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso))
    return Infinity;
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round((start - parseDate(iso)) / 86_400_000);
}

/** Cash accounts and whether every one of them was updated within CASH_FRESH_DAYS. */
export function recentCash(accounts, today = new Date()) {
  const cash = readAccounts(accounts).filter(
    (a) => a.type === "asset" && a.kind === "cash",
  );
  const total = round2(
    cash.reduce(
      (t, a) => t + (Number(a.balance) > 0 ? Number(a.balance) : 0),
      0,
    ),
  );
  const fresh =
    cash.length > 0 &&
    cash.every((a) => daysSince(a.updated, today) <= CASH_FRESH_DAYS);
  const asOf =
    cash
      .map((a) => a.updated)
      .filter(Boolean)
      .sort()[0] ?? null; // oldest
  return { accounts: cash, total, fresh, asOf };
}

/**
 * The last 3 full months that have at least one income AND one expense transaction.
 * Months without both are skipped, never read as zero.
 */
export function countedMonths(transactions, today = new Date()) {
  return lastMonthKeys(4, today)
    .slice(0, 3)
    .filter((key) => {
      const inMonth = transactions.filter((t) => t.date?.startsWith(key));
      return (
        inMonth.some((t) => t.type === "income") &&
        inMonth.some((t) => t.type === "expense")
      );
    })
    .map((key) => ({ key, ...monthTotals(transactions, key) }));
}

// ---------- Pillars ----------
// Each returns { id, name, state, score, value, valueText, detail, action, note, warnings }.
// state: "scored" | "older" (scored, but an input is old) | "needs-data"

const pillar = (id, name, fields) => ({
  id,
  name,
  state: "scored",
  score: null,
  value: null,
  valueText: "",
  detail: "",
  action: null,
  note: null,
  warnings: [],
  ...fields,
});
const needsData = (id, name, action, extra = {}) =>
  pillar(id, name, { state: "needs-data", action, detail: action, ...extra });

export function savingsPillar(transactions, today = new Date()) {
  const months = countedMonths(transactions, today);
  const income = months.reduce((t, m) => t + m.income, 0);
  const expenses = months.reduce((t, m) => t + m.expenses, 0);
  if (months.length < 2 || income <= 0)
    return needsData(
      "savings",
      "Savings rate",
      "Add 2 months of income and spending",
    );
  const rate = (income - expenses) / income;
  const caveat =
    "Based on transactions you've recorded. Missing spending would make this look higher than it is.";
  return pillar("savings", "Savings rate", {
    score: Math.round(100 * clamp01(rate / 0.2)),
    value: rate,
    valueText: `${pct(rate)} of recorded income`,
    detail:
      months.length < 3
        ? `${caveat} From ${months.length} months of records.`
        : caveat,
    monthly: {
      income: income / months.length,
      expenses: expenses / months.length,
    },
  });
}

export function emergencyPillar(
  { transactions, settings, accounts, categories },
  today = new Date(),
) {
  const savings = savingsBalance(settings, accounts);
  const { months, avgEssential } = emergencyFundMonths(
    savings.amount,
    transactions,
    needsChecker(categories),
    today,
  );
  const hasSavings = savings.source === "accounts" || savings.amount > 0;
  if (!(avgEssential > 0))
    return needsData(
      "emergency",
      "Emergency fund",
      "Record a few months of essential spending",
    );
  if (!hasSavings)
    return needsData(
      "emergency",
      "Emergency fund",
      "Add your savings or a savings account",
    );

  // With accounts as the source, an account untouched for 60+ days makes the pillar "older".
  const liquid = readAccounts(accounts).filter(
    (a) => a.type === "asset" && (a.kind === "cash" || a.kind === "savings"),
  );
  const old =
    savings.source === "accounts"
      ? liquid.filter((a) => daysSince(a.updated, today) >= STALE_DAYS)
      : [];
  const oldest = old
    .map((a) => a.updated)
    .filter(Boolean)
    .sort()[0];
  return pillar("emergency", "Emergency fund", {
    state: old.length ? "older" : "scored",
    score: Math.round(100 * clamp01(months / 6)),
    value: months,
    valueText: `${months.toFixed(1)} of 6 months`,
    detail:
      "Savings compared with your average essential spending over the last 3 full months.",
    note: old.length
      ? oldest
        ? `Balance from ${shortDate(oldest)}`
        : "Balance not dated"
      : null,
    gap: round2(Math.max(0, 6 * avgEssential - savings.amount)),
  });
}

/** Uses the last FULL month: early-month bills make a mid-month check look worse than it is. */
export function budgetsPillar(data, today = new Date()) {
  const month = addMonths(monthKey(today), -1);
  const rows = budgetRows(data, month).filter((r) => r.allocation > 0);
  if (rows.length === 0)
    return needsData(
      "budgets",
      "Budgets on track",
      "Set budgets for last month's categories",
    );
  const onTrack = rows.filter((r) => r.spent <= r.available).length;
  return pillar("budgets", "Budgets on track", {
    score: Math.round((100 * onTrack) / rows.length),
    value: onTrack / rows.length,
    valueText: `${onTrack} of ${rows.length} on track`,
    detail: `Spending within each budget in ${monthLabel(month, true)}, including any carryover.`,
    over: rows.length - onTrack,
  });
}

export function billsPillar({ bills, debts, accounts }, today = new Date()) {
  const cash = recentCash(accounts, today);
  const list = Array.isArray(bills) ? bills : [];
  if (list.length === 0)
    return needsData("bills", "Bills covered", "Add your regular bills");
  if (cash.accounts.length === 0)
    return needsData(
      "bills",
      "Bills covered",
      "Add your checking account on Net Worth",
    );
  if (!cash.fresh)
    return needsData("bills", "Bills covered", "Update your checking balance");

  // Every bill once, linked or not: obligations.js groups them, so a bill is never doubled.
  const start = toISODate(today);
  const end = addDays(start, RUNWAY_DAYS - 1);
  const { groups, bills: plain } = buildObligations({
    debts,
    accounts,
    bills: list,
  });
  const owed = paymentsOwed(
    { groups: [], bills: [...plain, ...groups.flatMap((g) => g.bills)] },
    start,
    end,
  );
  const asOf = `Recently updated cash (${money(cash.total)} as of ${shortDate(cash.asOf)})`;
  if (owed.total <= 0)
    return pillar("bills", "Bills covered", {
      score: 100,
      value: null,
      valueText: "No bills due in the next 14 days",
      detail: asOf,
    });
  const ratio = cash.total / owed.total;
  return pillar("bills", "Bills covered", {
    score: Math.round(100 * clamp01(ratio)),
    value: ratio,
    valueText: `covered ${ratio.toFixed(1)}×`,
    detail: `${asOf} against ${money(owed.total)} of bills due in the next 14 days.`,
    due: owed.total,
    cash: cash.total,
  });
}

/** Debt share d (0-1+) -> score, on the scale in the spec (gentler than lenders' 36%). */
export function debtScore(d) {
  if (d <= 0.1) return 100;
  if (d <= 0.36) return Math.round(100 - ((d - 0.1) / 0.26) * 60);
  if (d <= 0.5) return Math.round(40 - ((d - 0.36) / 0.14) * 40);
  return 0;
}
const debtBand = (d) =>
  d === 0
    ? "No debt payments"
    : d <= 0.1
      ? "Light"
      : d <= 0.36
        ? "Manageable"
        : d <= 0.5
          ? "Heavy"
          : "Very heavy";

export function debtPillar(
  { transactions, debts, accounts, bills, settings },
  today = new Date(),
) {
  const { groups, suggestLinking } = buildObligations({
    debts,
    accounts,
    bills,
  });
  const note = suggestLinking
    ? "If any of these are the same loan, link them on Net Worth."
    : null;
  // The APR warning sits beside the score; it never caps or changes it.
  const warnings = (Array.isArray(debts) ? debts : [])
    .filter((d) => Number(d.balance) > 0 && Number(d.apr) >= HIGH_APR)
    .map((d) => {
      const interest = Math.round(
        (Number(d.balance) * Number(d.apr)) / 100 / 12,
      );
      return `${d.name} at ${Number(d.apr)}% APR costs about ${money(interest)} a month in interest.`;
    });

  if (groups.length === 0) {
    if (settings?.noDebtsConfirmed === true)
      return pillar("debt", "Debt load", {
        score: 100,
        value: 0,
        valueText: "No debt payments",
        detail: "You confirmed you don't have any debts.",
      });
    return needsData(
      "debt",
      "Debt load",
      "Add your debts, or confirm you don't have any",
    );
  }

  const unknown = groups.filter((g) => g.payment === null).map((g) => g.name);
  if (unknown.length)
    return needsData(
      "debt",
      "Debt load",
      `Add the monthly payment for ${unknown.join(", ")} to score Debt load`,
      { warnings, note, missing: unknown },
    );

  const months = countedMonths(transactions, today);
  const income =
    months.reduce((t, m) => t + m.income, 0) / (months.length || 1);
  if (!(income > 0))
    return needsData(
      "debt",
      "Debt load",
      "Add income transactions to score Debt load",
      { warnings, note },
    );

  const payments = round2(groups.reduce((t, g) => t + g.payment, 0));
  const d = payments / income;
  return pillar("debt", "Debt load", {
    score: debtScore(d),
    value: d,
    valueText: `${pct(d)} of recorded income`,
    detail: `${debtBand(d)}: ${money(payments)} a month in required payments. Finnelee records take-home pay, so this reads higher than a lender's figure.`,
    warnings,
    note,
    payments,
  });
}

// ---------- Overall score ----------

const BANDS = [
  {
    min: 80,
    band: "Strong",
    line: (w) => `You're in good shape. ${w} is the next win.`,
  },
  { min: 60, band: "Steady", line: (w) => `Solid footing. Focus on ${w}.` },
  {
    min: 40,
    band: "Building",
    line: (w) => `You're building. ${w} will move your score most.`,
  },
  { min: 0, band: "Needs attention", line: (w) => `Let's start with ${w}.` },
];

/** One concrete next step for the weakest pillar, from the user's own numbers. */
function nextStep(p) {
  if (p.id === "savings" && p.monthly) {
    const more =
      0.2 * p.monthly.income - (p.monthly.income - p.monthly.expenses);
    return more > 0
      ? `Saving about ${money(more)} more a month would reach 20% of recorded income.`
      : null;
  }
  if (p.id === "emergency" && p.gap > 0)
    return `About ${money(p.gap)} more would cover 6 months of essentials.`;
  if (p.id === "budgets" && p.over > 0)
    return `${p.over} ${p.over === 1 ? "category" : "categories"} went over budget last month.`;
  if (p.id === "bills" && p.due > p.cash)
    return `Bills due in the next 14 days total ${money(p.due)}.`;
  if (p.id === "debt" && p.warnings.length) return p.warnings[0];
  return null;
}

/**
 * The whole Orb: { score, band, confidence, pillars, scored, headline, nextStep, label,
 * missing, warnings, disclosure, benchmarks }. score is null below MIN_SCORED pillars.
 * confidence: "high" | "medium" | "low" | "none".
 */
export function healthScore(data, today = new Date()) {
  const pillars = [
    savingsPillar(data.transactions ?? [], today),
    emergencyPillar(data, today),
    budgetsPillar(data, today),
    billsPillar(data, today),
    debtPillar(data, today),
  ];
  const scored = pillars.filter((p) => p.state !== "needs-data");
  const missing = pillars
    .filter((p) => p.state === "needs-data")
    .map((p) => p.action);
  const anyOlder = scored.some((p) => p.state === "older");
  const n = scored.length;
  const confidence =
    n === 5
      ? anyOlder
        ? "medium"
        : "high"
      : n === 4
        ? "medium"
        : n === 3
          ? "low"
          : "none";

  const base = {
    pillars,
    scored: n,
    confidence,
    missing,
    warnings: pillars.flatMap((p) => p.warnings),
    disclosure: DISCLOSURE,
    benchmarks: BENCHMARKS,
    benchmarkNote: BENCHMARK_NOTE,
  };
  if (n < MIN_SCORED)
    return {
      ...base,
      score: null,
      band: null,
      headline: "Let's get your score",
      nextStep: null,
      label: `Financial health not scored yet, based on ${n} of 5 areas`,
    };

  const average = scored.reduce((t, p) => t + p.score, 0) / n;
  const score =
    confidence === "low" ? Math.round(average / 5) * 5 : Math.round(average);
  const weakest = scored.reduce((low, p) => (p.score < low.score ? p : low));
  if (confidence === "low")
    return {
      ...base,
      score,
      band: null,
      headline: `Early estimate. ${missing[0]} for a fuller picture.`,
      nextStep: null,
      label: `Financial health about ${score} of 100, early estimate based on ${n} of 5 areas`,
    };

  const { band, line } = BANDS.find((b) => score >= b.min);
  const basis =
    n === 4
      ? "Based on 4 of 5 areas"
      : anyOlder
        ? "Based on some older balances"
        : null;
  return {
    ...base,
    score,
    band,
    headline: line(weakest.name),
    basis,
    nextStep: nextStep(weakest),
    weakest: weakest.id,
    label: `Financial health ${score} of 100, ${band.toLowerCase()}, based on ${n} of 5 areas`,
  };
}

// ---------- Pay schedule ----------

const CADENCES = new Set(["weekly", "biweekly", "twice-monthly", "monthly"]);

/** settings.paySchedule if complete, else null (no paydays are ever guessed). */
export function readPaySchedule(settings) {
  const s = settings?.paySchedule;
  if (!s || typeof s !== "object" || !CADENCES.has(s.cadence)) return null;
  if (typeof s.next !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.next))
    return null;
  const amount = readPayment(s.amount);
  if (s.cadence === "twice-monthly") {
    const days = Array.isArray(s.days)
      ? s.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 31)
      : [];
    if (days.length !== 2) return null;
    return {
      cadence: s.cadence,
      next: s.next,
      amount,
      days: [...days].sort((a, b) => a - b),
    };
  }
  return { cadence: s.cadence, next: s.next, amount };
}

/** Paydays from `start` to `end` (inclusive ISO dates), from a saved schedule only. */
export function paydays(schedule, start, end) {
  if (!schedule) return [];
  const out = [];
  if (schedule.cadence === "weekly" || schedule.cadence === "biweekly") {
    const step = schedule.cadence === "weekly" ? 7 : 14;
    let d = schedule.next;
    while (d < start) d = addDays(d, step); // a "next" saved weeks ago still lines up
    for (; d <= end; d = addDays(d, step)) out.push(d);
    return out;
  }
  const days =
    schedule.cadence === "monthly"
      ? [Number(schedule.next.slice(8))]
      : schedule.days;
  for (let k = start.slice(0, 7); k <= end.slice(0, 7); k = addMonths(k, 1))
    for (const day of days) {
      const d = dueDateIn(day, k); // 29-31 clamp the same way bills do
      if (d >= start && d <= end && d >= schedule.next) out.push(d); // nothing before the first saved payday
    }
  return [...new Set(out)].sort();
}

/** The first payday after today, or null without a schedule. */
const nextPayday = (schedule, today) =>
  paydays(schedule, addDays(today, 1), addDays(today, 62))[0] ?? null;

// ---------- Spending card ----------

/**
 * Two estimates for "This month's spending room", neither called safe:
 * - budget: the existing safeToSpend(), unchanged ("Left in your budget this month")
 * - spendable: recently updated cash − bills − debt payments owed − planned goal savings,
 *   over the window to the day before the next payday (or 14 days)
 * spendable.status: "complete" | "incomplete" (an unknown payment is due: amount is null
 * and upperLimit holds the partial figure) | "needs-cash" (cash not updated recently).
 */
export function spendingEstimate(data, today = new Date()) {
  const {
    transactions = [],
    bills = [],
    goals = [],
    debts = [],
    accounts = [],
    settings,
  } = data;
  const budget = safeToSpend({ transactions, bills, goals }, today);
  const start = toISODate(today);
  const schedule = readPaySchedule(settings);
  const payday = nextPayday(schedule, start);
  const end = payday ? addDays(payday, -1) : addDays(start, RUNWAY_DAYS - 1);
  const windowText = payday ? "before your next payday" : "in the next 14 days";

  const cash = recentCash(accounts, today);
  const result = {
    title: "This month's spending room",
    caption: SPENDING_CAPTION,
    budget: {
      label: "Left in your budget this month",
      amount: round2(budget.amount),
      shown: transactions.some((t) => t.date?.startsWith(monthKey(today))),
    },
    window: { start, end, text: windowText },
  };
  if (!cash.fresh)
    return {
      ...result,
      spendable: {
        status: "needs-cash",
        amount: null,
        upperLimit: null,
        label: "Estimated spendable amount",
        action: "Update your checking balance to estimate what you can spend",
      },
      headline: result.budget.shown
        ? { label: result.budget.label, amount: result.budget.amount }
        : null,
    };

  const obligations = buildObligations({ debts, accounts, bills });
  const owed = paymentsOwed(obligations, start, end);
  const planned = round2(
    goals
      .filter((g) => Number(g.saved) < Number(g.target))
      .reduce((t, g) => t + requiredMonthly(g, today), 0),
  );
  const figure = round2(cash.total - owed.total - planned);
  const lines = [
    {
      label: "Recently updated cash",
      amount: cash.total,
      source: "Net Worth",
      date: cash.asOf,
    },
    ...owed.items.map((i) => ({
      label:
        i.reason === "overdue"
          ? `${i.name}: ${monthLabel(i.month)} payment not marked paid`
          : i.kind === "debt"
            ? `${i.name} minimum payment`
            : i.name,
      amount: i.amount === null ? null : -i.amount,
      source: i.sources.join(", "),
      date: i.date,
    })),
    ...(planned > 0
      ? [
          {
            label: "Goal savings still planned this month",
            amount: -planned,
            source: "Goals",
            date: null,
          },
        ]
      : []),
  ];

  if (owed.unknown.length) {
    const names = owed.unknown.join(", ");
    return {
      ...result,
      lines,
      spendable: {
        status: "incomplete",
        amount: null,
        upperLimit: figure,
        label: "Estimate incomplete",
        missing: owed.unknown,
        action: `${names} payment unknown. Add it to finish this estimate.`,
        limitText: `At most ${money(figure)}, before the ${names} payment.`,
      },
      headline: { label: "Estimate incomplete", amount: null },
    };
  }

  const spendable = {
    status: "complete",
    amount: figure,
    upperLimit: null,
    label: "Estimated spendable amount",
    shortfall:
      figure < 0 ? `About ${money(-figure)} short ${windowText}` : null,
  };
  // The bigger number on the card is the LOWER of the two, under its own name.
  const useBudget = result.budget.shown && result.budget.amount < figure;
  return {
    ...result,
    lines,
    spendable,
    headline: useBudget
      ? { label: result.budget.label, amount: result.budget.amount }
      : { label: spendable.label, amount: figure },
  };
}

// ---------- 14-day runway ----------

/**
 * Bills (and dated debt minimums) at their due dates from today to today + 13, stacked by
 * day. Paydays appear only from a saved pay schedule; otherwise the caption says why.
 * Returns { days: [{ date, items, total }], items, paydays, caption, projection }.
 */
export function runwayEvents(data, today = new Date()) {
  const start = toISODate(today);
  const end = addDays(start, RUNWAY_DAYS - 1);
  const obligations = buildObligations(data);
  const owed = paymentsOwed(obligations, start, end);
  const items = owed.items
    .filter((i) => i.date && i.date >= start) // undated / overdue amounts have no day to sit on
    .map((i) => ({
      name: i.kind === "debt" ? `${i.name} minimum payment` : i.name,
      date: i.date,
      amount: i.amount,
      key: i.key,
    }));
  const schedule = readPaySchedule(data.settings);
  const pays = paydays(schedule, start, end).map((date) => ({
    date,
    amount: schedule.amount,
  }));

  const byDay = new Map();
  for (const i of items) {
    const day = byDay.get(i.date) ?? { date: i.date, items: [], total: 0 };
    day.items.push(i);
    day.total = round2(day.total + (i.amount ?? 0));
    byDay.set(i.date, day);
  }

  // A projected balance needs both a recent starting point and known paydays.
  const cash = recentCash(data.accounts, today);
  let projection = null;
  if (cash.fresh && schedule && schedule.amount !== null) {
    let balance = cash.total;
    projection = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      balance -= byDay.get(d)?.total ?? 0;
      balance += pays
        .filter((p) => p.date === d)
        .reduce((t, p) => t + p.amount, 0);
      projection.push({ date: d, balance: round2(balance) });
    }
  }

  return {
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    items,
    paydays: pays,
    caption: schedule
      ? null
      : "Paydays aren't shown. Add your pay schedule on the Bills page.",
    empty: items.length === 0 ? "No bills due in the next 14 days" : null,
    projection,
    projectionLabel: projection ? "Projection from your records" : null,
  };
}
