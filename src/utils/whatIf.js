// What-If simulator: a read-only sandbox. Pure functions only: every input is copied,
// nothing is written back, and the existing engines (simulateDebtPayoff, requiredMonthly,
// healthScore, savingsBalance) are called unchanged.
//
// One monthly ledger drives every result. "Today's path" is the same ledger with every
// lever at zero, so the two paths are identical at zero by construction.
//
// Each month, in this order:
//   cash = recorded surplus + income change + category cuts, adjusted for debt payments
//          (see debtRecorded below)
//   then FUNDED once, never past the cash: the extra debt payment (while debts are open),
//   then extra goal savings (while the chosen goals are unfinished). The rest is general
//   savings. What the plan REQUESTS beyond the cash is a shortfall: it is reported, and it
//   never moves a goal, a debt or a balance. Every date, balance and chart is funded money.
// A dollar sits in exactly one place: a debt, one goal, or general savings.
//
// Debt payments and the recorded surplus (levers.debtRecorded, asked on the page because
// Finnelee never matches transactions to debts by name):
//   "yes":     recorded spending already includes the minimums + saved Debt Planner extra,
//              so after the last payoff that money comes back as savings.
//   "no":      it doesn't, so those payments come out of the surplus while debts are open,
//              and nothing extra comes back after payoff (it was never in the surplus).
//   "unknown": the surplus is used as recorded and nothing comes back after payoff, so
//              freed payments can never be counted twice. This is the default.

import {
  lastMonthKeys,
  monthTotals,
  requiredMonthly,
  simulateDebtPayoff,
} from "./finance";
import { parseDate } from "./format";
import { countedMonths, healthScore } from "./health";
import { readAccounts, savingsBalance } from "./netWorth";

export const HORIZON = 120; // months simulated (10 years)
export const ORB_MONTH = 12; // the Health Orb estimate looks 12 months ahead (fixed in v1)
export const MAX_LEVER = 10_000; // $/month cap for the savings and debt sliders
export const MAX_CUTS = 3;

export const ZERO_LEVERS = Object.freeze({
  extraSavings: 0, // $/month toward goals
  goalTarget: "all", // "all" (nearest deadline first) or one goal's id
  cuts: [], // [{ category, amount }] $/month, at most MAX_CUTS
  extraDebt: 0, // $/month on top of the Debt Planner plan
  strategy: "avalanche", // used by BOTH paths
  incomeChange: 0, // take-home $/month (negative = a pay cut)
  incomeStart: 1, // ledger month it starts: 1 = next month ... 12
  growth: true, // Forecast's expected return on general savings (false = 0%)
  debtRecorded: "unknown", // "yes" | "no" | "unknown": see the top of this file
});

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The last 3 full months (the current month is incomplete), oldest first. Same as Forecast. */
const fullMonthKeys = (today) => lastMonthKeys(4, today).slice(0, 3);

/** Open debts the payoff engine would simulate. */
const openDebts = (debts) =>
  (Array.isArray(debts) ? debts : []).filter((d) => num(d.balance) > 0);

/** Goals still short of their target, nearest deadline first (no deadline last). */
export function openGoals(goals) {
  const due = (g) => {
    const d =
      typeof g.deadline === "string" && g.deadline
        ? parseDate(g.deadline)
        : null;
    return d && !Number.isNaN(d.getTime()) ? d.getTime() : Infinity;
  };
  return (Array.isArray(goals) ? goals : [])
    .filter((g) => num(g.target) > num(g.saved))
    .map((g) => ({ goal: g, due: due(g) }))
    .sort(
      (a, b) =>
        a.due - b.due || String(a.goal.name).localeCompare(String(b.goal.name)),
    )
    .map((x) => x.goal);
}

/**
 * The Debt Planner extra saved as the user's plan (settings.debtPlanner.extra), or null
 * when nothing is saved. Debt Planner's $200 starting value is only a suggestion and never
 * counts here. A saved $0 is a real plan of $0.
 */
export function savedDebtExtra(settings) {
  const v = settings?.debtPlanner?.extra;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Everything both paths share, read once from the real data:
 * recorded surplus (Forecast's default deposit), averages, starting savings, history state.
 */
export function readBaseline(data, today = new Date()) {
  const transactions = Array.isArray(data.transactions)
    ? data.transactions
    : [];
  const keys = fullMonthKeys(today);
  const months = keys.map((key) => monthTotals(transactions, key));
  const avg = (pick) => months.reduce((t, m) => t + pick(m), 0) / keys.length;

  // Average spending per expense category over the same 3 months: the cap for a cut.
  const categoryAverage = {};
  for (const t of transactions)
    if (t.type === "expense" && keys.some((k) => t.date?.startsWith(k)))
      categoryAverage[t.category] =
        (categoryAverage[t.category] ?? 0) + num(t.amount);
  for (const c of Object.keys(categoryAverage))
    categoryAverage[c] = round2(categoryAverage[c] / keys.length);

  const savings = savingsBalance(data.settings ?? {}, data.accounts ?? []);
  const debtExtra = savedDebtExtra(data.settings);
  return {
    surplus: Math.round(avg((m) => m.net)), // Forecast's suggested deposit, before its $0 floor
    avgIncome: round2(avg((m) => m.income)),
    categoryAverage,
    start: num(savings.amount),
    annualReturn: num(data.settings?.annualReturn),
    debtExtra: debtExtra ?? 0,
    debtExtraSaved: debtExtra !== null,
    hasDebts: openDebts(data.debts).length > 0,
    // Same rule as the savings pillar: fewer than 2 months with income AND spending.
    history:
      countedMonths(transactions, today).length >= 2 ? "ok" : "insufficient",
  };
}

/** Levers made safe: no negatives, cuts capped at recorded spending, take-home never below $0. */
export function clampLevers(levers, base, goals = []) {
  const l = { ...ZERO_LEVERS, ...levers };
  const seen = new Set();
  const cuts = (Array.isArray(l.cuts) ? l.cuts : [])
    .filter(
      (c) =>
        c &&
        base.categoryAverage[c.category] > 0 &&
        !seen.has(c.category) &&
        seen.add(c.category),
    )
    .slice(0, MAX_CUTS)
    .map((c) => ({
      category: c.category,
      amount: round2(clamp(num(c.amount), 0, base.categoryAverage[c.category])),
    }));
  const goalIds = new Set(openGoals(goals).map((g) => String(g.id)));
  return {
    extraSavings: round2(clamp(num(l.extraSavings), 0, MAX_LEVER)),
    goalTarget:
      l.goalTarget !== "all" && goalIds.has(String(l.goalTarget))
        ? l.goalTarget
        : "all",
    cuts,
    extraDebt: base.hasDebts
      ? round2(clamp(num(l.extraDebt), 0, MAX_LEVER))
      : 0,
    strategy: l.strategy === "snowball" ? "snowball" : "avalanche",
    incomeChange: round2(
      clamp(num(l.incomeChange), -base.avgIncome, MAX_LEVER),
    ),
    incomeStart: clamp(Math.round(num(l.incomeStart)) || 1, 1, ORB_MONTH),
    growth: l.growth !== false,
    debtRecorded: ["yes", "no"].includes(l.debtRecorded)
      ? l.debtRecorded
      : "unknown",
  };
}

/**
 * The monthly ledger for one path. Returns one row per month (month 0 = today), the debt
 * engine's result and each goal's outcome. `fullFunding: true` ignores the cash limit; it
 * is used only to show what an overcommitted plan would need, labeled as unfunded.
 */
export function runLedger(data, levers, base, { fullFunding = false } = {}) {
  const debts = openDebts(data.debts);
  const hasDebts = debts.length > 0;
  const plannedDebt = hasDebts
    ? debts.reduce((t, d) => t + num(d.minPayment), 0) + base.debtExtra
    : 0; // minimums + saved Debt Planner extra: today's debt plan
  const cuts = levers.cuts.reduce((t, c) => t + c.amount, 0);
  const incomeAt = (m) => (m >= levers.incomeStart ? levers.incomeChange : 0);
  // Cash in a month while debts are still open (see debtRecorded at the top).
  const openCash = (m) =>
    base.surplus +
    incomeAt(m) +
    cuts -
    (levers.debtRecorded === "no" ? plannedDebt : 0);

  // The engine takes one fixed extra, so the funded extra is what the LOWEST open-debt
  // month can pay (income changes once, at its start month). Never more than requested.
  const lowest = Math.min(openCash(1), openCash(levers.incomeStart));
  const debtExtra = fullFunding
    ? levers.extraDebt
    : Math.min(levers.extraDebt, Math.max(0, lowest));
  const debt = simulateDebtPayoff(
    debts,
    base.debtExtra + debtExtra,
    levers.strategy,
  );
  const debtFree = hasDebts && debt.finished ? debt.months : null; // last month with a payment
  // In the payoff month the engine pays only what is still owed. What it didn't need is
  // taken off the plan's extra first (never below $0), so that money stays available.
  // Total paid = starting balances + interest; every earlier month used the full budget.
  const unusedLast =
    debtFree === null
      ? 0
      : Math.max(
          0,
          debt.budget * debtFree -
            (debts.reduce((t, d) => t + num(d.balance), 0) +
              debt.totalInterest),
        );
  const extraIn = (m, extra) =>
    m === debtFree ? Math.max(0, extra - unusedLast) : extra;

  const chosen = openGoals(data.goals).filter(
    (g) =>
      levers.goalTarget === "all" || String(g.id) === String(levers.goalTarget),
  );
  const left = new Map(chosen.map((g) => [g.id, num(g.target) - num(g.saved)]));
  const reached = new Map(); // goal id -> ledger month it reached its target

  const r = levers.growth ? base.annualReturn / 100 / 12 : 0;
  let balance = base.start; // general savings (Forecast's starting savings)
  let goalMoney = 0; // funded money set aside for goals by this plan (0% growth)
  const rows = [
    {
      month: 0,
      balance,
      goalMoney,
      available: 0,
      requested: 0,
      toDebt: 0,
      toGoals: 0,
      toGeneral: 0,
      deficit: 0,
      shortfall: 0,
    },
  ];

  for (let month = 1; month <= HORIZON; month++) {
    const open = hasDebts && (debtFree === null || month <= debtFree);
    const freed =
      hasDebts && !open && levers.debtRecorded === "yes" ? plannedDebt : 0;
    const available = open
      ? openCash(month)
      : base.surplus + incomeAt(month) + cuts + freed;
    let cash = fullFunding ? Infinity : Math.max(0, available);

    // 1) Recorded goal contributions: none exist in Finnelee v1, so nothing here.
    // 2) The plan's extra debt payment, only while debts are open.
    const askDebt = open ? extraIn(month, levers.extraDebt) : 0;
    const toDebt = open ? extraIn(month, debtExtra) : 0; // capped at the lowest month's cash
    cash -= toDebt;
    // 3) Extra goal savings, nearest deadline first; each dollar goes to one goal.
    const stillNeeded = chosen.reduce(
      (t, g) => t + Math.max(0, left.get(g.id)),
      0,
    );
    const askGoals = Math.min(levers.extraSavings, stillNeeded);
    let budget = Math.min(askGoals, Math.max(0, cash));
    let toGoals = 0;
    for (const g of chosen) {
      if (budget <= 0.005) break;
      const need = left.get(g.id);
      if (need <= 0) continue;
      const pay = Math.min(need, budget);
      left.set(g.id, need - pay);
      budget -= pay;
      toGoals += pay;
      if (need - pay <= 0.005) reached.set(g.id, month);
    }
    // 4) The rest is general savings. The shortfall is what was requested but not
    //    funded, plus any monthly gap this plan's income change or cuts create. A
    //    negative recorded surplus alone isn't one (Forecast floors it at $0 too).
    const requested = askDebt + askGoals;
    const toGeneral = Math.max(0, available - toDebt - toGoals);
    const withoutLevers = available - incomeAt(month) - cuts;
    const deficit = Math.max(
      0,
      Math.max(0, -available) - Math.max(0, -withoutLevers),
    );
    const shortfall = Math.max(0, requested - toDebt - toGoals) + deficit;
    balance = balance * (1 + r) + toGeneral; // same formula as projectSavings
    goalMoney += toGoals;
    rows.push({
      month,
      balance,
      goalMoney,
      available,
      requested,
      toDebt,
      toGoals,
      toGeneral,
      deficit,
      shortfall,
    });
  }

  const goals = openGoals(data.goals).map((g) => ({
    id: g.id,
    name: g.name,
    deadline: g.deadline,
    remaining: round2(num(g.target) - num(g.saved)),
    required: round2(requiredMonthly(g)), // planning figure only, never a record of saving
    funded: left.has(g.id) && levers.extraSavings > 0,
    reachedMonth: reached.get(g.id) ?? null,
  }));
  return { rows, debt, debtFree, hasDebts, goals, debtExtra, plannedDebt };
}

/** "within" | "exceeds" | "insufficient", judged on months 1 to 12. */
export function affordability(base, ledger) {
  if (base.history === "insufficient") return "insufficient";
  const worst = Math.max(
    ...ledger.rows.slice(1, ORB_MONTH + 1).map((r) => r.shortfall),
  );
  return worst > 0.005 ? "exceeds" : "within";
}

/** The largest monthly shortfall in the first 12 months (0 when the plan fits). */
export const shortfall12 = (ledger) =>
  round2(
    Math.max(0, ...ledger.rows.slice(1, ORB_MONTH + 1).map((r) => r.shortfall)),
  );

/**
 * A hypothetical copy of the data as it could look at month 12 of a path, for healthScore.
 * Only these inputs change; a pillar that needs data today keeps needing it.
 *   - transactions in the last 3 full months (standing in for months 10 to 12): cut
 *     categories scaled down, and income records scaled by the income change from its
 *     start month (never below $0, never making a new month count)
 *   - savings: month-12 general savings + goal money, added to the largest cash/savings
 *     account (or the typed-in amount), keeping dates so "older" states stay
 *   - debts paid off by month 12: balance 0 on the debt and its linked liability, and
 *     their linked bills end
 */
export function orbInputs(
  data,
  levers,
  base,
  ledger,
  todayHealth,
  today = new Date(),
) {
  const keys = fullMonthKeys(today);
  const counted = countedMonths(data.transactions ?? [], today);
  const factor = Object.fromEntries(
    levers.cuts.map((c) => [
      c.category,
      1 - c.amount / base.categoryAverage[c.category],
    ]),
  );
  const transactions = (data.transactions ?? []).map((t) =>
    t.type === "expense" &&
    factor[t.category] !== undefined &&
    keys.some((k) => t.date?.startsWith(k))
      ? { ...t, amount: round2(num(t.amount) * factor[t.category]) }
      : { ...t },
  );
  // Income: the 3 recorded months stand in for months 10, 11 and 12 of the projection, so
  // a change starting in month 11 applies to the last 2 of them only. Each counted month's
  // income records are scaled to (income + change), never below $0. No record is added.
  const incomeFactor = {};
  counted.forEach((m) => {
    const projected = ORB_MONTH - (keys.length - 1) + keys.indexOf(m.key);
    if (levers.incomeChange !== 0 && projected >= levers.incomeStart)
      incomeFactor[m.key] =
        Math.max(0, m.income + levers.incomeChange) / m.income;
  });
  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    const f =
      t.type === "income" ? incomeFactor[t.date?.slice(0, 7)] : undefined;
    if (f !== undefined)
      transactions[i] = { ...t, amount: round2(num(t.amount) * f) };
  }

  const pillar = (id) => todayHealth.pillars.find((p) => p.id === id);
  let settings = { ...(data.settings ?? {}) };
  let accounts = (data.accounts ?? []).map((a) => ({ ...a }));

  // Savings at month 12, unless Emergency fund needs data today.
  if (pillar("emergency")?.state !== "needs-data") {
    const row = ledger.rows[ORB_MONTH];
    const delta = row.balance + row.goalMoney - base.start;
    if (savingsBalance(settings, accounts).source === "accounts") {
      const liquid = readAccounts(accounts).filter(
        (a) =>
          a.type === "asset" && (a.kind === "cash" || a.kind === "savings"),
      );
      const largest = liquid.reduce(
        (big, a) => (num(a.balance) > num(big?.balance) ? a : big),
        liquid[0],
      );
      accounts = accounts.map((a) =>
        a.id === largest?.id
          ? { ...a, balance: round2(num(a.balance) + delta) }
          : a,
      );
    } else
      settings.startingSavings = round2(num(settings.startingSavings) + delta);
  }

  // Debts paid off by month 12, unless Debt load needs data today.
  let debts = (data.debts ?? []).map((d) => ({ ...d }));
  let bills = (data.bills ?? []).map((b) => ({ ...b }));
  if (pillar("debt")?.state !== "needs-data" && ledger.hasDebts) {
    const paid = paidByMonth(debts, ledger.debt.payoffOrder, ORB_MONTH);
    if (paid.size) {
      const paidAccounts = new Set(
        accounts
          .filter((a) => a.type === "liability" && paid.has(String(a.debtId)))
          .map((a) => String(a.id)),
      );
      debts = debts.map((d) =>
        paid.has(String(d.id)) ? { ...d, balance: 0 } : d,
      );
      accounts = accounts.map((a) =>
        paidAccounts.has(String(a.id)) ? { ...a, balance: 0 } : a,
      );
      bills = bills.filter(
        (b) =>
          !(b.payFor?.type === "debt" && paid.has(String(b.payFor.id))) &&
          !(
            b.payFor?.type === "account" &&
            paidAccounts.has(String(b.payFor.id))
          ),
      );
      // Every debt paid off: "no debts left" in this hypothetical, so Debt load stays scored.
      if (debts.every((d) => num(d.balance) <= 0))
        settings = { ...settings, noDebtsConfirmed: true };
    }
  }
  return { ...data, transactions, settings, accounts, debts, bills };
}

/**
 * Debt ids paid off by `month`. The engine's payoffOrder carries names only, so a name
 * shared by two open debts is ambiguous: those debts stay open (the cautious choice).
 */
export function paidByMonth(debts, payoffOrder, month) {
  const open = openDebts(debts);
  const count = new Map();
  for (const d of open) count.set(d.name, (count.get(d.name) ?? 0) + 1);
  const paid = new Set();
  for (const p of payoffOrder)
    if (p.month <= month && count.get(p.name) === 1)
      paid.add(String(open.find((d) => d.name === p.name).id));
  return paid;
}

/**
 * The whole simulator: both paths, affordability and the Health Orb comparison.
 * `levers` are clamped first, so any input is safe.
 */
export function simulate(data, levers, today = new Date()) {
  const base = readBaseline(data, today);
  const plan = clampLevers(levers, base, data.goals);
  // Today's path keeps the shared choices (strategy, growth, debtRecorded) and zeroes
  // every lever.
  const zero = {
    ...clampLevers(ZERO_LEVERS, base, data.goals),
    strategy: plan.strategy,
    growth: plan.growth,
    debtRecorded: plan.debtRecorded, // an assumption about the records, not a lever
  };
  const todayHealth = healthScore(data, today);
  const run = (l) => {
    const ledger = runLedger(data, l, base);
    return {
      levers: l,
      ledger,
      orb: healthScore(
        orbInputs(data, l, base, ledger, todayHealth, today),
        today,
      ),
    };
  };
  const baseline = run(zero);
  const scenario = run(plan);
  const fits = affordability(base, scenario.ledger);
  return {
    base,
    levers: plan,
    today: todayHealth,
    baseline,
    scenario,
    affordability: fits,
    shortfall: shortfall12(scenario.ledger),
    // Only for an overcommitted plan: what it would take if the missing money were found.
    // Shown as an unfunded hypothetical, never as the plan's result.
    fullFunding: scenario.ledger.rows.some((row) => row.shortfall > 0.005)
      ? runLedger(data, plan, base, { fullFunding: true })
      : null,
  };
}
