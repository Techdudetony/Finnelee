import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../data/categories";
import { projectSavings, simulateDebtPayoff } from "./finance";
import {
  HORIZON,
  ORB_MONTH,
  ZERO_LEVERS,
  clampLevers,
  paidByMonth,
  readBaseline,
  runLedger,
  simulate,
} from "./whatIf";

const TODAY = new Date(2026, 10, 2); // 2 Nov 2026: Aug, Sep, Oct are the full months

// Three full months: $5,000 income, $2,200 spending => $2,800 recorded surplus.
const month = (key) => [
  {
    id: `${key}-i`,
    date: `${key}-01`,
    type: "income",
    category: "Salary",
    amount: 5000,
  },
  {
    id: `${key}-h`,
    date: `${key}-03`,
    type: "expense",
    category: "Housing",
    amount: 1500,
  },
  {
    id: `${key}-g`,
    date: `${key}-10`,
    type: "expense",
    category: "Groceries",
    amount: 400,
  },
  {
    id: `${key}-d`,
    date: `${key}-20`,
    type: "expense",
    category: "Dining",
    amount: 300,
  },
];
const DEBTS = [
  { id: "d1", name: "Card", balance: 1000, apr: 20, minPayment: 100 },
  { id: "d2", name: "Loan", balance: 5000, apr: 5, minPayment: 150 },
];
const GOALS = [
  { id: "g2", name: "Car", target: 10000, saved: 0, deadline: "2028-01-01" },
  { id: "g1", name: "Trip", target: 2000, saved: 500, deadline: "2027-06-01" },
];
const data = (over = {}) => ({
  transactions: [...month("2026-08"), ...month("2026-09"), ...month("2026-10")],
  budgets: {},
  bills: [],
  debts: DEBTS,
  goals: GOALS,
  accounts: [],
  settings: { annualReturn: 5, startingSavings: 3000 },
  categories: DEFAULT_CATEGORIES,
  ...over,
});

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};
const ledgerFor = (d, levers) => {
  const base = readBaseline(d, TODAY);
  return runLedger(d, clampLevers(levers, base, d.goals), base);
};

describe("baseline", () => {
  it("reads Forecast's surplus, category averages and the savings start", () => {
    const base = readBaseline(data(), TODAY);
    expect(base.surplus).toBe(2800);
    expect(base.avgIncome).toBe(5000);
    expect(base.categoryAverage).toEqual({
      Housing: 1500,
      Groceries: 400,
      Dining: 300,
    });
    expect(base.start).toBe(3000);
    expect(base.history).toBe("ok");
    expect(base.debtExtraSaved).toBe(false);
  });

  it("is identical to the plan when every lever is zero, Orb included", () => {
    const r = simulate(data(), ZERO_LEVERS, TODAY);
    expect(r.scenario.ledger).toEqual(r.baseline.ledger);
    expect(r.scenario.orb).toEqual(r.baseline.orb);
    expect(r.affordability).toBe("within");
  });

  it("matches Forecast's Expected line with no debts or goals", () => {
    const d = data({ debts: [], goals: [] });
    const rows = ledgerFor(d, ZERO_LEVERS).rows;
    const forecast = projectSavings({
      start: 3000,
      monthly: 2800,
      annualRate: 5,
      years: 10,
    });
    expect(rows).toHaveLength(HORIZON + 1);
    rows.forEach((r, i) =>
      expect(r.balance).toBeCloseTo(forecast[i].balance, 6),
    );
  });

  it("floors a negative surplus at $0 like Forecast, without calling it a shortfall", () => {
    const d = data({
      debts: [],
      goals: [],
      transactions: month("2026-10").map((t) =>
        t.type === "income" ? { ...t, amount: 1000 } : t,
      ),
    });
    const rows = ledgerFor(d, ZERO_LEVERS).rows;
    expect(rows[1].toGeneral).toBe(0);
    expect(rows[1].shortfall).toBe(0);
  });
});

describe("one ledger, no double counting", () => {
  it("allocates every available dollar exactly once, every month", () => {
    const levers = {
      extraSavings: 900,
      extraDebt: 300,
      incomeChange: 200,
      cuts: [{ category: "Dining", amount: 100 }],
    };
    for (const r of ledgerFor(data(), levers).rows.slice(1))
      expect(r.toDebt + r.toGoals + r.toGeneral - r.shortfall).toBeCloseTo(
        r.available,
        6,
      );
  });

  it("combines several levers in the documented order", () => {
    const r = ledgerFor(data(), {
      incomeChange: 300,
      cuts: [{ category: "Dining", amount: 100 }],
      extraDebt: 200,
      extraSavings: 150,
    }).rows[1];
    expect(r.available).toBe(2800 + 300 + 100);
    expect(r.toDebt).toBe(200);
    expect(r.toGoals).toBe(150);
    expect(r.toGeneral).toBe(3200 - 350);
  });

  it("never counts goal money as general savings, and spills to general once goals are done", () => {
    const d = data({
      debts: [],
      goals: [
        {
          id: "g1",
          name: "Trip",
          target: 1000,
          saved: 0,
          deadline: "2027-06-01",
        },
      ],
    });
    const rows = ledgerFor(d, { extraSavings: 600 }).rows;
    expect(rows[1].toGoals).toBe(600);
    expect(rows[2].toGoals).toBe(400); // only what was left
    expect(rows[2].toGeneral).toBe(2800 - 400);
    expect(rows[3].toGoals).toBe(0);
    expect(rows.at(-1).goalMoney).toBe(1000);
  });

  it("fills goals nearest deadline first, each dollar once", () => {
    const l = ledgerFor(data({ debts: [] }), { extraSavings: 1000 });
    expect(l.rows[1].toGoals).toBe(1000);
    const trip = l.goals.find((g) => g.id === "g1");
    const car = l.goals.find((g) => g.id === "g2");
    expect(trip.reachedMonth).toBe(2); // $1,500 left: 1,000 + 500
    expect(car.reachedMonth).toBe(12); // $500 in month 2, then $1,000 a month
    expect(l.rows.at(-1).goalMoney).toBe(1500 + 10000);
  });

  it("sends the extra to one chosen goal only", () => {
    const l = ledgerFor(data({ debts: [] }), {
      extraSavings: 1000,
      goalTarget: "g2",
    });
    expect(l.goals.find((g) => g.id === "g1").reachedMonth).toBeNull();
    expect(l.goals.find((g) => g.id === "g2").reachedMonth).toBe(10);
  });
});

describe("goals", () => {
  it("never invents a contribution for Today's path", () => {
    const r = simulate(data(), { extraSavings: 500 }, TODAY);
    for (const g of r.baseline.ledger.goals) {
      expect(g.reachedMonth).toBeNull();
      expect(g.funded).toBe(false);
    }
    expect(r.baseline.ledger.rows.every((row) => row.toGoals === 0)).toBe(true);
    // requiredMonthly is still offered as a planning figure.
    expect(
      r.baseline.ledger.goals.find((g) => g.id === "g1").required,
    ).toBeGreaterThan(0);
  });
});

describe("debts", () => {
  it("keeps the saved Debt Planner extra in both paths and adds the lever on top", () => {
    const d = data({
      settings: {
        annualReturn: 5,
        startingSavings: 3000,
        debtPlanner: { extra: 100 },
      },
    });
    const r = simulate(d, { extraDebt: 200, strategy: "snowball" }, TODAY);
    expect(r.base.debtExtra).toBe(100);
    expect(r.baseline.ledger.debt).toEqual(
      simulateDebtPayoff(DEBTS, 100, "snowball"),
    );
    expect(r.scenario.ledger.debt).toEqual(
      simulateDebtPayoff(DEBTS, 300, "snowball"),
    );
  });

  it("rolls freed payments into savings after payoff, in both paths", () => {
    const r = simulate(data({ goals: [] }), { extraDebt: 500 }, TODAY);
    const base = r.baseline.ledger;
    const plan = r.scenario.ledger;
    expect(plan.debtFree).toBeLessThan(base.debtFree);
    // Before payoff the plan pays $500 more; after, the minimums ($250) come back as savings.
    expect(plan.rows[1].toGeneral).toBe(2800 - 500);
    expect(plan.rows[plan.debtFree + 1].toDebt).toBe(0);
    expect(plan.rows[plan.debtFree + 1].toGeneral).toBe(2800 + 250);
    expect(base.rows[base.debtFree].toGeneral).toBe(2800);
    expect(base.rows[base.debtFree + 1].toGeneral).toBe(2800 + 250);
  });

  it("uses names cautiously when matching paid-off debts", () => {
    const twins = [
      { id: "a", name: "Card", balance: 10, apr: 0, minPayment: 10 },
      { id: "b", name: "Card", balance: 10, apr: 0, minPayment: 10 },
      { id: "c", name: "Loan", balance: 10, apr: 0, minPayment: 10 },
    ];
    const order = [
      { name: "Card", month: 1 },
      { name: "Card", month: 1 },
      { name: "Loan", month: 1 },
    ];
    expect([...paidByMonth(twins, order, 12)]).toEqual(["c"]);
  });
});

describe("income timing", () => {
  it("starts an income change in its chosen month", () => {
    const rows = ledgerFor(data({ debts: [], goals: [] }), {
      incomeChange: 400,
      incomeStart: 4,
    }).rows;
    expect(rows[3].available).toBe(2800);
    expect(rows[4].available).toBe(3200);
  });
});

describe("affordability", () => {
  it("labels an overcommitted plan and still projects it", () => {
    const r = simulate(data(), { extraSavings: 5000 }, TODAY);
    expect(r.affordability).toBe("exceeds");
    expect(r.shortfall).toBe(2200);
    expect(r.scenario.ledger.rows[1].toGeneral).toBe(0);
    expect(r.scenario.ledger.rows[1].toGoals).toBe(5000);
  });

  it("says history is insufficient with fewer than 2 counted months", () => {
    const r = simulate(
      data({ transactions: month("2026-10") }),
      { extraSavings: 100 },
      TODAY,
    );
    expect(r.affordability).toBe("insufficient");
  });
});

describe("clamps", () => {
  it("caps cuts at recorded spending and keeps take-home at $0 or more", () => {
    const base = readBaseline(data(), TODAY);
    const l = clampLevers(
      {
        extraSavings: -50,
        extraDebt: 99999,
        incomeChange: -9000,
        incomeStart: 40,
        cuts: [
          { category: "Dining", amount: 900 },
          { category: "Dining", amount: 5 },
          { category: "Nope", amount: 5 },
        ],
      },
      base,
      GOALS,
    );
    expect(l.extraSavings).toBe(0);
    expect(l.extraDebt).toBe(10000);
    expect(l.incomeChange).toBe(-5000);
    expect(l.incomeStart).toBe(ORB_MONTH);
    expect(l.cuts).toEqual([{ category: "Dining", amount: 300 }]);
  });

  it("ignores an extra debt payment when there are no debts", () => {
    const base = readBaseline(data({ debts: [] }), TODAY);
    expect(clampLevers({ extraDebt: 300 }, base, GOALS).extraDebt).toBe(0);
  });
});

describe("Health Orb estimates", () => {
  it("keeps today's needs-data pillars as needs-data in both projections", () => {
    // No debts and nothing confirmed: Debt load needs data. No savings: Emergency fund too.
    const d = data({ debts: [], settings: { annualReturn: 5 } });
    const r = simulate(d, { extraSavings: 2000, incomeChange: 1000 }, TODAY);
    for (const id of ["debt", "emergency"]) {
      expect(r.today.pillars.find((p) => p.id === id).state).toBe("needs-data");
      expect(r.baseline.orb.pillars.find((p) => p.id === id).state).toBe(
        "needs-data",
      );
      expect(r.scenario.orb.pillars.find((p) => p.id === id).state).toBe(
        "needs-data",
      );
    }
  });

  it("moves the savings rate with a raise and a cut", () => {
    const r = simulate(
      data(),
      { incomeChange: 500, cuts: [{ category: "Dining", amount: 300 }] },
      TODAY,
    );
    const rate = (h) => h.pillars.find((p) => p.id === "savings").value;
    expect(rate(r.baseline.orb)).toBeCloseTo(2800 / 5000, 6);
    expect(rate(r.scenario.orb)).toBeCloseTo(3600 / 5500, 6);
  });

  it("keeps Debt load scored when every debt is paid off by month 12", () => {
    const d = data({
      debts: [
        { id: "d1", name: "Card", balance: 300, apr: 0, minPayment: 100 },
      ],
    });
    const r = simulate(d, ZERO_LEVERS, TODAY);
    const debt = r.baseline.orb.pillars.find((p) => p.id === "debt");
    expect(debt.state).toBe("scored");
    expect(debt.score).toBe(100);
  });

  it("ends a paid-off debt's linked liability and bills in the copy only", () => {
    const d = data({
      debts: [
        { id: "d1", name: "Card", balance: 300, apr: 0, minPayment: 100 },
      ],
      accounts: [
        {
          id: "a1",
          type: "liability",
          kind: "credit",
          name: "Card",
          balance: 300,
          debtId: "d1",
          updated: "2026-11-01",
        },
      ],
      bills: [
        {
          id: "b1",
          name: "Card bill",
          amount: 100,
          dueDay: 5,
          payFor: { type: "debt", id: "d1" },
        },
      ],
    });
    deepFreeze(d);
    const r = simulate(d, ZERO_LEVERS, TODAY);
    expect(r.baseline.ledger.debtFree).toBe(3);
    expect(d.accounts[0].balance).toBe(300); // the real record is untouched
    expect(d.bills).toHaveLength(1);
  });
});

describe("never changes real data", () => {
  it("works on frozen inputs and leaves them byte-for-byte the same", () => {
    const d = data({
      settings: {
        annualReturn: 5,
        savingsSource: "accounts",
        debtPlanner: { extra: 50 },
      },
      accounts: [
        {
          id: "s1",
          type: "asset",
          kind: "savings",
          name: "Savings",
          balance: 8000,
          updated: "2026-11-01",
        },
      ],
    });
    const before = JSON.stringify(d);
    deepFreeze(d);
    expect(() =>
      simulate(
        d,
        {
          extraSavings: 300,
          extraDebt: 100,
          incomeChange: -200,
          cuts: [{ category: "Groceries", amount: 50 }],
        },
        TODAY,
      ),
    ).not.toThrow();
    expect(JSON.stringify(d)).toBe(before);
  });
});
