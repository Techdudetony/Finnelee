import { describe, expect, it } from "vitest";
import {
  BENCHMARKS,
  BENCHMARK_NOTE,
  DISCLOSURE,
  billsPillar,
  budgetsPillar,
  countedMonths,
  debtPillar,
  debtScore,
  emergencyPillar,
  healthScore,
  paydays,
  readPaySchedule,
  runwayEvents,
  savingsPillar,
  spendingEstimate,
} from "./health";
import { emptyData, fromBackup, generateSampleData } from "../data/sampleData";
import { DEFAULT_CATEGORIES } from "../data/categories";
import { safeToSpend, emergencyFundMonths } from "./finance";
import { netWorthTotals } from "./netWorth";
import { markPaid } from "./obligations";

const OCT30 = new Date(2026, 9, 30);
const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));

// One month of records: income and expenses on the 10th of `key` ("YYYY-MM").
const month = (key, income, expenses, category = "Housing") => [
  ...(income
    ? [
        {
          id: `${key}i`,
          date: `${key}-10`,
          type: "income",
          category: "Salary",
          amount: income,
        },
      ]
    : []),
  ...(expenses
    ? [
        {
          id: `${key}e`,
          date: `${key}-10`,
          type: "expense",
          category,
          amount: expenses,
        },
      ]
    : []),
];
const threeMonths = (income, expenses) => [
  ...month("2026-07", income, expenses),
  ...month("2026-08", income, expenses),
  ...month("2026-09", income, expenses),
];
const cash = (balance, updated = "2026-10-29") => ({
  id: "chk",
  name: "Checking",
  type: "asset",
  kind: "cash",
  balance,
  updated,
  source: "manual",
});
const savingsAcct = (balance, updated = "2026-10-29") => ({
  id: "sav",
  name: "Savings",
  type: "asset",
  kind: "savings",
  balance,
  updated,
  source: "manual",
});
const base = (extra = {}) => ({ ...emptyData(), categories, ...extra });

describe("normalization (one test per boundary)", () => {
  const rateScore = (income, expenses) =>
    savingsPillar(threeMonths(income, expenses), OCT30).score;
  it("savings rate: -10% -> 0, 0% -> 0, 10% -> 50, 20% -> 100, 35% -> 100", () => {
    expect(rateScore(1000, 1100)).toBe(0);
    expect(rateScore(1000, 1000)).toBe(0);
    expect(rateScore(1000, 900)).toBe(50);
    expect(rateScore(1000, 800)).toBe(100);
    expect(rateScore(1000, 650)).toBe(100);
  });

  it("emergency fund: 0 -> 0, 3 -> 50, 6 -> 100, 9 -> 100 months", () => {
    // $1,000 of essentials a month; savings typed in on Forecast.
    const score = (savings) =>
      emergencyPillar(
        base({
          transactions: threeMonths(3000, 1000),
          settings: { startingSavings: savings },
        }),
        OCT30,
      ).score;
    expect(score(0.01)).toBe(0);
    expect(score(3000)).toBe(50);
    expect(score(6000)).toBe(100);
    expect(score(9000)).toBe(100);
  });

  it("budgets: 6 of 8 on track -> 75", () => {
    const names = [
      "Housing",
      "Groceries",
      "Dining",
      "Transport",
      "Utilities",
      "Entertainment",
      "Shopping",
      "Health",
    ];
    const budgets = Object.fromEntries(names.map((n) => [n, 100]));
    const transactions = names.map((n, i) => ({
      id: n,
      date: "2026-09-12",
      type: "expense",
      category: n,
      amount: i < 6 ? 90 : 150,
    }));
    const p = budgetsPillar(base({ budgets, transactions }), OCT30);
    expect(p.score).toBe(75);
    expect(p.valueText).toBe("6 of 8 on track");
  });

  it("budgets: with rollover, available is used, not the raw limit", () => {
    const settings = {
      budgeting: { rollover: { Groceries: [{ from: "2026-08", to: null }] } },
    };
    const transactions = [
      {
        id: "a",
        date: "2026-08-05",
        type: "expense",
        category: "Groceries",
        amount: 50,
      }, // $50 carried into Sep
      {
        id: "b",
        date: "2026-09-05",
        type: "expense",
        category: "Groceries",
        amount: 140,
      },
    ];
    const p = budgetsPillar(
      base({ budgets: { Groceries: 100 }, settings, transactions }),
      OCT30,
    );
    expect(p.score).toBe(100); // $140 of $150 available, though over the $100 limit
  });

  it("bills covered: cash 0 -> 0, cash equal to bills -> 100, no bills in 14 days -> 100", () => {
    const bills = [
      { id: "r", name: "Rent", amount: 1500, dueDay: 1, category: "Housing" },
    ];
    expect(billsPillar(base({ bills, accounts: [cash(0)] }), OCT30).score).toBe(
      0,
    );
    expect(
      billsPillar(base({ bills, accounts: [cash(1500)] }), OCT30).score,
    ).toBe(100);
    const later = [
      { id: "g", name: "Gym", amount: 30, dueDay: 20, category: "Health" },
    ];
    expect(
      billsPillar(base({ bills: later, accounts: [cash(10)] }), OCT30),
    ).toMatchObject({
      score: 100,
      valueText: "No bills due in the next 14 days",
    });
  });

  it("debt load: d = 0.10 -> 100, 0.23 -> 70, 0.36 -> 40, 0.43 -> 20, 0.50 -> 0, 0.70 -> 0", () => {
    expect(debtScore(0)).toBe(100);
    expect(debtScore(0.1)).toBe(100);
    expect(debtScore(0.23)).toBe(70);
    expect(debtScore(0.36)).toBe(40);
    expect(debtScore(0.43)).toBe(20);
    expect(debtScore(0.5)).toBe(0);
    expect(debtScore(0.7)).toBe(0);
  });
});

describe("high-interest warning (no cap)", () => {
  const withDebt = (apr) =>
    debtPillar(
      base({
        transactions: threeMonths(4000, 2000),
        debts: [
          { id: "c", name: "Store card", balance: 1100, apr, minPayment: 200 },
        ],
      }),
      OCT30,
    );

  it("a debt at 24.9% APR with d = 0.05 still scores 100 and carries a warning", () => {
    const p = withDebt(24.9);
    expect(p.score).toBe(100);
    expect(p.warnings).toEqual([
      "Store card at 24.9% APR costs about $23 a month in interest.",
    ]);
  });

  it("no warning at 19.9%; a warning at exactly 20%", () => {
    expect(withDebt(19.9).warnings).toEqual([]);
    expect(withDebt(20).warnings).toHaveLength(1);
  });
});

describe("missing and incomplete data", () => {
  it("an empty store gives no score, confidence none, and five needs-data actions", () => {
    const h = healthScore(emptyData(), OCT30);
    expect(h.score).toBeNull();
    expect(h.confidence).toBe("none");
    expect(h.missing).toHaveLength(5);
    expect(h.headline).toBe("Let's get your score");
  });

  it("sample data gives a stable score with high confidence while accounts are recently updated", () => {
    const h = healthScore(generateSampleData(OCT30), OCT30);
    expect(h.confidence).toBe("high");
    expect(h.scored).toBe(5);
    expect({
      score: h.score,
      band: h.band,
      pillars: h.pillars.map((p) => [p.id, p.state, p.score, p.valueText]),
    }).toMatchSnapshot();
  });

  it("savings rate: 1 counted month -> needs data; a month with income but no expenses is skipped", () => {
    expect(savingsPillar(month("2026-09", 1000, 800), OCT30).state).toBe(
      "needs-data",
    );
    const tx = [
      ...month("2026-07", 1000, 0),
      ...month("2026-08", 1000, 800),
      ...month("2026-09", 1000, 800),
    ];
    expect(countedMonths(tx, OCT30).map((m) => m.key)).toEqual([
      "2026-08",
      "2026-09",
    ]);
    const p = savingsPillar(tx, OCT30);
    expect(p.detail).toContain("recorded");
    expect(p.detail).toContain("From 2 months of records");
    expect(p.valueText).toBe("20% of recorded income");
  });

  it("debt load: an empty list needs data; noDebtsConfirmed gives 100; a debt overrides the flag", () => {
    const tx = threeMonths(4000, 2000);
    expect(debtPillar(base({ transactions: tx }), OCT30).state).toBe(
      "needs-data",
    );
    expect(
      debtPillar(
        base({ transactions: tx, settings: { noDebtsConfirmed: true } }),
        OCT30,
      ),
    ).toMatchObject({ score: 100, valueText: "No debt payments" });
    const p = debtPillar(
      base({
        transactions: tx,
        settings: { noDebtsConfirmed: true },
        debts: [
          { id: "d", name: "Loan", balance: 9000, apr: 5, minPayment: 1000 },
        ],
      }),
      OCT30,
    );
    expect(p.score).toBe(debtScore(0.25));
    // A string flag from a hand-edited backup is not a confirmation.
    expect(
      debtPillar(
        base({ transactions: tx, settings: { noDebtsConfirmed: "yes" } }),
        OCT30,
      ).state,
    ).toBe("needs-data");
  });

  it("debt load: one debt with a 0 or missing minimum needs data naming it, even when the rest would score 100", () => {
    const debts = [
      { id: "a", name: "Car loan", balance: 9000, apr: 5, minPayment: 100 },
      { id: "b", name: "Card", balance: 500, apr: 18, minPayment: 0 },
      { id: "c", name: "Visa", balance: 500, apr: 18 },
    ];
    const p = debtPillar(
      base({ transactions: threeMonths(4000, 2000), debts }),
      OCT30,
    );
    expect(p.state).toBe("needs-data");
    expect(p.score).toBeNull();
    expect(p.action).toBe(
      "Add the monthly payment for Card, Visa to score Debt load",
    );
  });

  it("debt load: a mortgage without monthlyPayment needs data; with one it's included", () => {
    const mortgage = {
      id: "m",
      name: "Mortgage",
      type: "liability",
      kind: "mortgage",
      balance: 200000,
      updated: "2026-10-01",
    };
    const tx = threeMonths(5000, 3000);
    expect(
      debtPillar(base({ transactions: tx, accounts: [mortgage] }), OCT30)
        .action,
    ).toContain("Mortgage");
    const p = debtPillar(
      base({
        transactions: tx,
        accounts: [{ ...mortgage, monthlyPayment: 1150 }],
      }),
      OCT30,
    );
    expect(p.value).toBeCloseTo(0.23);
    expect(p.score).toBe(70);
  });

  it("debt load: a linked debt and liability are counted once; unlinked they're both counted", () => {
    const tx = threeMonths(5000, 3000);
    const debts = [
      { id: "car", name: "Car loan", balance: 9000, apr: 6, minPayment: 500 },
    ];
    const auto = {
      id: "auto",
      name: "Auto loan",
      type: "liability",
      kind: "other",
      balance: 9000,
      monthlyPayment: 500,
      updated: "2026-10-01",
    };
    const linked = debtPillar(
      base({ transactions: tx, debts, accounts: [{ ...auto, debtId: "car" }] }),
      OCT30,
    );
    const unlinked = debtPillar(
      base({ transactions: tx, debts, accounts: [auto] }),
      OCT30,
    );
    expect(linked.payments).toBe(500);
    expect(linked.note).toBeNull();
    expect(unlinked.payments).toBe(1000);
    expect(unlinked.note).toBe(
      "If any of these are the same loan, link them on Net Worth.",
    );
  });

  it("a cash account updated 8 days ago: Bills covered needs data and the spendable estimate is hidden", () => {
    const data = base({
      bills: [{ id: "r", name: "Rent", amount: 100, dueDay: 1 }],
      accounts: [cash(5000, "2026-10-22")],
    });
    expect(billsPillar(data, OCT30)).toMatchObject({
      state: "needs-data",
      action: "Update your checking balance",
    });
    expect(spendingEstimate(data, OCT30).spendable).toMatchObject({
      status: "needs-cash",
      amount: null,
    });
    // 7 days is still recent.
    expect(
      billsPillar({ ...data, accounts: [cash(5000, "2026-10-23")] }, OCT30)
        .state,
    ).toBe("scored");
  });

  it("a savings account 61 days stale: scored with an older balance, and confidence drops to medium", () => {
    const sample = generateSampleData(OCT30);
    const accounts = sample.accounts.map((a) =>
      a.kind === "savings" ? { ...a, updated: "2026-08-30" } : a,
    );
    const h = healthScore(
      {
        ...sample,
        accounts,
        settings: { ...sample.settings, savingsSource: "accounts" },
      },
      OCT30,
    );
    const p = h.pillars.find((x) => x.id === "emergency");
    expect(p.state).toBe("older");
    expect(p.note).toBe("Balance from Aug 30");
    expect(h.confidence).toBe("medium");
    expect(h.basis).toBe("Based on some older balances");
  });

  it("3 scored pillars: low confidence and a score rounded to 5; 2: no score", () => {
    // Savings, emergency fund and budgets only (no bills, no debts).
    const data = base({
      transactions: threeMonths(3000, 1000),
      budgets: { Housing: 2000 },
      settings: { startingSavings: 2000 },
    });
    const h = healthScore(data, OCT30);
    expect(h.scored).toBe(3);
    expect(h.confidence).toBe("low");
    expect(h.score % 5).toBe(0);
    expect(h.band).toBeNull();
    expect(h.headline).toBe(
      "Early estimate. Add your regular bills for a fuller picture.",
    );
    const two = healthScore({ ...data, budgets: {} }, OCT30);
    expect(two.score).toBeNull();
    expect(two.confidence).toBe("none");
  });

  it("4 scored pillars: medium confidence with a band", () => {
    const sample = generateSampleData(OCT30);
    const h = healthScore({ ...sample, bills: [] }, OCT30);
    expect(h.scored).toBe(4);
    expect(h.confidence).toBe("medium");
    expect(h.basis).toBe("Based on 4 of 5 areas");
    expect(h.band).not.toBeNull();
  });
});

describe("spending card and payments owed", () => {
  // Recently updated $3,000 checking, Rent on the 1st, a Car loan due the 5th.
  const card = (extra = {}) =>
    base({
      transactions: [
        ...threeMonths(4000, 2000),
        ...month("2026-10", 4000, 1000),
      ],
      accounts: [cash(3000)],
      bills: [
        {
          id: "rent",
          name: "Rent",
          amount: 1500,
          dueDay: 1,
          category: "Housing",
        },
      ],
      debts: [
        {
          id: "car",
          name: "Car loan",
          balance: 9000,
          apr: 6,
          minPayment: 350,
          dueDay: 5,
          paidMonths: { "2026-10": { markedOn: "2026-10-05" } },
        },
      ],
      ...extra,
    });

  it("cash − bills − debt payments in the window, each once", () => {
    const s = spendingEstimate(card(), OCT30);
    expect(s.spendable).toMatchObject({
      status: "complete",
      amount: 3000 - 1500 - 350,
    });
    expect(s.lines.map((l) => [l.label, l.amount])).toEqual([
      ["Recently updated cash", 3000],
      ["Rent", -1500],
      ["Car loan minimum payment", -350],
    ]);
    expect(s.caption).toBe(
      "Estimates from your records. Check your bank before large purchases.",
    );
  });

  it("the budget estimate is the existing safeToSpend, unchanged", () => {
    const data = card();
    expect(spendingEstimate(data, OCT30).budget.amount).toBe(
      Math.round(safeToSpend(data, OCT30).amount * 100) / 100,
    );
  });

  it("a debt without a due day and not marked paid counts its full minimum this month", () => {
    const debts = [
      { id: "card", name: "Store card", balance: 500, apr: 9, minPayment: 35 },
    ];
    const s = spendingEstimate(card({ debts }), OCT30);
    // Window Oct 30 - Nov 12 touches October and November.
    expect(
      s.lines.filter((l) => l.label === "Store card minimum payment"),
    ).toHaveLength(2);
    const paidOct = [markPaid(debts[0], "2026-10", OCT30)];
    expect(
      spendingEstimate(card({ debts: paidOct }), OCT30).lines.filter((l) =>
        l.label.startsWith("Store card"),
      ),
    ).toHaveLength(1);
  });

  it("a car loan in all three places, linked, is subtracted once", () => {
    const s = spendingEstimate(
      card({
        accounts: [
          cash(3000),
          {
            id: "auto",
            name: "Auto loan",
            type: "liability",
            kind: "other",
            balance: 9000,
            monthlyPayment: 350,
            debtId: "car",
            updated: "2026-10-01",
          },
        ],
        bills: [
          {
            id: "rent",
            name: "Rent",
            amount: 1500,
            dueDay: 1,
            category: "Housing",
          },
          {
            id: "carbill",
            name: "Car payment",
            amount: 350,
            dueDay: 5,
            category: "Transport",
            payFor: { type: "debt", id: "car" },
          },
        ],
      }),
      OCT30,
    );
    expect(s.spendable.amount).toBe(1150);
    expect(s.lines.filter((l) => l.amount === -350)).toHaveLength(1);
    expect(s.lines.find((l) => l.amount === -350).source).toBe(
      "Debt Planner, Net Worth: Auto loan, Bills: Car payment",
    );
  });

  it("a liability without a payment: Estimate incomplete, with an upper limit and never a plain amount", () => {
    const mortgage = {
      id: "m",
      name: "Mortgage",
      type: "liability",
      kind: "mortgage",
      balance: 200000,
      updated: "2026-10-01",
    };
    const s = spendingEstimate(
      card({ accounts: [cash(3000), mortgage] }),
      OCT30,
    );
    expect(s.spendable.status).toBe("incomplete");
    expect(s.spendable.amount).toBeNull();
    expect(s.spendable.upperLimit).toBe(1150);
    expect(s.spendable.limitText).toBe(
      "At most $1,150, before the Mortgage payment.",
    );
    expect(s.headline).toEqual({ label: "Estimate incomplete", amount: null });
  });

  it("with both figures, the headline is the lower one; a negative value is kept as is", () => {
    const s = spendingEstimate(card({ accounts: [cash(1000)] }), OCT30);
    expect(s.spendable.amount).toBe(-850);
    expect(s.spendable.shortfall).toBe("About $850 short in the next 14 days");
    expect(s.headline).toEqual({
      label: "Estimated spendable amount",
      amount: -850,
    });
    const rich = spendingEstimate(card({ accounts: [cash(90000)] }), OCT30);
    expect(rich.headline.label).toBe("Left in your budget this month");
  });

  it("with a pay schedule, the window ends the day before the next payday", () => {
    const settings = {
      paySchedule: {
        cadence: "twice-monthly",
        days: [1, 15],
        next: "2026-11-01",
        amount: 2000,
      },
    };
    const s = spendingEstimate(card({ settings }), OCT30);
    expect(s.window).toEqual({
      start: "2026-10-30",
      end: "2026-10-31",
      text: "before your next payday",
    });
    expect(s.spendable.amount).toBe(3000); // Rent (Nov 1) and the car loan (Nov 5) fall after payday
  });

  it("no user-facing string uses safe, verified, available, guaranteed or credit score", () => {
    const strings = [];
    const collect = (v) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    const datasets = [
      generateSampleData(OCT30),
      emptyData(),
      card(),
      card({ accounts: [cash(3000, "2026-01-01")] }),
    ];
    for (const d of datasets) {
      collect(healthScore(d, OCT30));
      collect(spendingEstimate(d, OCT30));
      collect(runwayEvents(d, OCT30));
    }
    expect(strings.length).toBeGreaterThan(50);
    // The disclosure names "credit score" and "guarantee" on purpose, to rule them out.
    for (const s of strings.filter((x) => x !== DISCLOSURE))
      expect(s).not.toMatch(
        /safe|verified|available|guarantee|you can afford|credit score/i,
      );
  });
});

describe("pay schedule and runway", () => {
  it("only a complete saved schedule gives paydays", () => {
    expect(readPaySchedule({})).toBeNull();
    expect(readPaySchedule({ paySchedule: { cadence: "monthly" } })).toBeNull();
    expect(
      readPaySchedule({
        paySchedule: {
          cadence: "twice-monthly",
          days: [1],
          next: "2026-11-01",
        },
      }),
    ).toBeNull();
    expect(
      readPaySchedule({
        paySchedule: { cadence: "daily", next: "2026-11-01" },
      }),
    ).toBeNull();
  });

  it("twice-monthly paydays land on the right dates across a month boundary", () => {
    const s = readPaySchedule({
      paySchedule: {
        cadence: "twice-monthly",
        days: [15, 31],
        next: "2026-10-31",
        amount: 2000,
      },
    });
    expect(paydays(s, "2026-10-30", "2026-11-30")).toEqual([
      "2026-10-31",
      "2026-11-15",
      "2026-11-30",
    ]);
  });

  it("weekly and biweekly paydays line up even when the saved next date has passed", () => {
    const bi = readPaySchedule({
      paySchedule: { cadence: "biweekly", next: "2026-10-02", amount: 1800 },
    });
    expect(paydays(bi, "2026-10-30", "2026-11-12")).toEqual(["2026-10-30"]); // Oct 2, 16, 30; Nov 13 is past the end
    const weekly = readPaySchedule({
      paySchedule: { cadence: "weekly", next: "2026-11-06", amount: 900 },
    });
    expect(paydays(weekly, "2026-10-30", "2026-11-12")).toEqual(["2026-11-06"]); // nothing before the first saved payday
  });

  it("monthly on the 31st falls on the last day of shorter months", () => {
    const s = readPaySchedule({
      paySchedule: { cadence: "monthly", next: "2027-01-31", amount: 4000 },
    });
    expect(paydays(s, "2027-01-01", "2027-04-30")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("without a schedule there are no paydays and the caption says why", () => {
    const r = runwayEvents(generateSampleData(OCT30), OCT30);
    expect(r.paydays).toEqual([]);
    expect(r.caption).toBe(
      "Paydays aren't shown. Add your pay schedule on the Bills page.",
    );
    expect(r.projection).toBeNull();
    expect(
      r.items.every((i) => i.date >= "2026-10-30" && i.date <= "2026-11-12"),
    ).toBe(true);
  });

  it("bills on the 31st in a 30-day month fall on the last day; same-day items stack", () => {
    const bills = [
      { id: "a", name: "A", amount: 10, dueDay: 31 },
      { id: "b", name: "B", amount: 15, dueDay: 30 },
    ];
    const r = runwayEvents(base({ bills }), new Date(2026, 10, 20));
    expect(r.days).toEqual([
      { date: "2026-11-30", items: expect.any(Array), total: 25 },
    ]);
  });

  it("a projection needs recently updated cash and a saved pay schedule", () => {
    const data = base({
      accounts: [cash(1000)],
      bills: [{ id: "r", name: "Rent", amount: 1500, dueDay: 1 }],
      settings: {
        paySchedule: {
          cadence: "twice-monthly",
          days: [1, 15],
          next: "2026-11-01",
          amount: 2000,
        },
      },
    });
    const r = runwayEvents(data, OCT30);
    expect(r.projectionLabel).toBe("Projection from your records");
    expect(r.projection.find((p) => p.date === "2026-11-01").balance).toBe(
      1500,
    );
    expect(r.projection.at(-1).balance).toBe(1500);
  });

  it("no bills in the window gives the empty state", () => {
    expect(runwayEvents(base(), OCT30).empty).toBe(
      "No bills due in the next 14 days",
    );
  });
});

describe("disclosure and benchmarks", () => {
  it("every result carries the disclosure and the benchmark list", () => {
    for (const d of [emptyData(), generateSampleData(OCT30)]) {
      const h = healthScore(d, OCT30);
      expect(h.disclosure).toBe(DISCLOSURE);
      expect(h.benchmarks).toBe(BENCHMARKS);
      expect(h.benchmarkNote).toBe(BENCHMARK_NOTE);
    }
    expect(DISCLOSURE).toContain("Not a credit score");
    expect(BENCHMARKS.map((b) => b.id)).toEqual([
      "savings",
      "emergency",
      "budgets",
      "bills",
      "debt",
    ]);
  });

  it("every pillar has visible text for name, value or action, and an explanation", () => {
    for (const d of [emptyData(), generateSampleData(OCT30)])
      for (const p of healthScore(d, OCT30).pillars) {
        expect(p.name).toBeTruthy();
        expect(p.detail).toBeTruthy();
        expect(p.state === "needs-data" ? p.action : p.valueText).toBeTruthy();
      }
  });
});

describe("compatibility with existing records", () => {
  const OLD_BACKUP = {
    transactions: [...threeMonths(3000, 1200)],
    budgets: { Housing: 1500 },
    debts: [{ id: "d", name: "Visa", balance: 500, apr: 20, minPayment: 25 }],
    goals: [],
    bills: [
      { id: "b", name: "Rent", amount: 1200, dueDay: 1, category: "Housing" },
    ],
    settings: { startingSavings: 1000, annualReturn: 5 },
  };

  it("an old backup without any new field loads unchanged and reads them as unknown", () => {
    const data = fromBackup(JSON.parse(JSON.stringify(OLD_BACKUP)));
    expect(data.debts).toEqual(OLD_BACKUP.debts); // nothing written back
    const h = healthScore(data, OCT30);
    expect(h.pillars.find((p) => p.id === "bills").action).toBe(
      "Add your checking account on Net Worth",
    );
    expect(h.pillars.find((p) => p.id === "debt").state).toBe("scored");
    expect(JSON.stringify(data)).toBe(
      JSON.stringify(fromBackup(JSON.parse(JSON.stringify(OLD_BACKUP)))),
    );
  });

  it("existing calculations give the same results with or without the new fields", () => {
    const sample = generateSampleData(OCT30);
    const extended = {
      ...sample,
      debts: sample.debts.map((d) => ({
        ...d,
        dueDay: 12,
        paidMonths: { "2026-10": { markedOn: "2026-10-12" } },
      })),
      bills: sample.bills.map((b) => ({
        ...b,
        paidMonths: {},
        payFor: { type: "debt", id: sample.debts[0].id },
      })),
      accounts: sample.accounts.map((a) => ({
        ...a,
        monthlyPayment: 10,
        debtId: "x",
      })),
      settings: {
        ...sample.settings,
        paySchedule: { cadence: "monthly", next: "2026-11-01", amount: 1 },
        noDebtsConfirmed: true,
      },
    };
    expect(safeToSpend(extended, OCT30)).toEqual(safeToSpend(sample, OCT30));
    expect(netWorthTotals(extended.accounts, extended.debts)).toEqual(
      netWorthTotals(sample.accounts, sample.debts),
    );
    const isNeed = () => true;
    expect(
      emergencyFundMonths(1000, extended.transactions, isNeed, OCT30),
    ).toEqual(emergencyFundMonths(1000, sample.transactions, isNeed, OCT30));
  });

  it("a new backup round-trips with the new fields intact", () => {
    const sample = generateSampleData(OCT30);
    const withFields = {
      ...sample,
      debts: [
        {
          ...sample.debts[0],
          dueDay: 31,
          paidMonths: { "2026-10": { markedOn: "2026-10-30" } },
        },
      ],
      bills: [
        {
          ...sample.bills[0],
          payFor: { type: "debt", id: sample.debts[0].id },
        },
      ],
      settings: {
        ...sample.settings,
        paySchedule: { cadence: "monthly", next: "2026-11-01", amount: 4200 },
        noDebtsConfirmed: false,
      },
    };
    const restored = fromBackup(JSON.parse(JSON.stringify(withFields)));
    expect(restored).toEqual(JSON.parse(JSON.stringify(withFields)));
    expect(healthScore(restored, OCT30)).toEqual(
      healthScore(withFields, OCT30),
    );
  });

  it("invalid optional values read as unknown instead of breaking the score", () => {
    const sample = generateSampleData(OCT30);
    const broken = {
      ...sample,
      debts: sample.debts.map((d, i) => ({
        ...d,
        dueDay: [0, 32, "abc"][i],
        paidMonths: ["2026-10"],
      })),
      settings: {
        ...sample.settings,
        paySchedule: "weekly",
        noDebtsConfirmed: 1,
      },
    };
    expect(() => healthScore(broken, OCT30)).not.toThrow();
    expect(spendingEstimate(broken, OCT30).window.text).toBe(
      "in the next 14 days",
    );
    // Undated and unpaid: each debt is owed for October and November.
    expect(
      spendingEstimate(broken, OCT30).lines.filter((l) =>
        l.label.endsWith("minimum payment"),
      ),
    ).toHaveLength(6);
  });
});
