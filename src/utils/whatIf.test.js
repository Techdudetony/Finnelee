import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../data/categories";
import { projectSavings, simulateDebtPayoff } from "./finance";
import { debtScore, healthScore } from "./health";
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
    expect(r.fullFunding).toBeNull();
  });

  it("stays identical at zero under every debt-payment assumption and strategy", () => {
    for (const debtRecorded of ["yes", "no", "unknown"])
      for (const strategy of ["avalanche", "snowball"]) {
        const r = simulate(
          data(),
          { ...ZERO_LEVERS, debtRecorded, strategy },
          TODAY,
        );
        expect(r.scenario.ledger).toEqual(r.baseline.ledger);
        expect(r.scenario.orb).toEqual(r.baseline.orb);
      }
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
    for (const r of ledgerFor(data(), levers).rows.slice(1)) {
      expect(r.toDebt + r.toGoals + r.toGeneral).toBeCloseTo(
        Math.max(0, r.available),
        6,
      );
      expect(r.shortfall).toBe(0);
    }
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

  it("rolls freed payments into savings only when they are in recorded spending", () => {
    const d = data({ goals: [] });
    const r = simulate(d, { extraDebt: 500, debtRecorded: "yes" }, TODAY);
    const base = r.baseline.ledger;
    const plan = r.scenario.ledger;
    expect(plan.debtFree).toBeLessThan(base.debtFree); // early payoff
    // Before payoff the plan pays $500 more; after, the minimums ($250) come back.
    expect(plan.rows[1].toGeneral).toBe(2800 - 500);
    expect(plan.rows[plan.debtFree + 1].toDebt).toBe(0);
    expect(plan.rows[plan.debtFree + 1].toGeneral).toBe(2800 + 250);
    expect(base.rows[base.debtFree].toGeneral).toBe(2800);
    expect(base.rows[base.debtFree + 1].toGeneral).toBe(2800 + 250);
  });

  it("never adds freed payments when it can't tell they were recorded (default)", () => {
    const plan = simulate(data({ goals: [] }), { extraDebt: 500 }, TODAY)
      .scenario.ledger;
    expect(plan.rows[1].toGeneral).toBe(2800 - 500);
    expect(plan.rows[plan.debtFree + 1].toGeneral).toBe(2800); // nothing counted twice
    expect(plan.rows.at(-1).toGeneral).toBe(2800);
  });

  it("takes unrecorded debt payments out of the surplus until payoff", () => {
    // Recorded history has no debt payments: the real surplus is $2,800 - $250.
    const r = simulate(
      data({ goals: [] }),
      { extraDebt: 300, debtRecorded: "no" },
      TODAY,
    );
    const base = r.baseline.ledger;
    const plan = r.scenario.ledger;
    expect(base.rows[1].available).toBe(2800 - 250);
    expect(base.rows[1].toGeneral).toBe(2550);
    expect(plan.rows[1].toGeneral).toBe(2550 - 300);
    // After payoff the payments stop, and the surplus is the recorded one again.
    expect(plan.rows[plan.debtFree + 1].available).toBe(2800);
    expect(plan.rows[plan.debtFree + 1].toGeneral).toBe(2800);
  });

  it("funds extra debt before extra savings when both compete", () => {
    const rows = ledgerFor(data(), {
      extraDebt: 2000,
      extraSavings: 1500,
    }).rows;
    expect(rows[1].toDebt).toBe(2000);
    expect(rows[1].toGoals).toBe(800);
    expect(rows[1].toGeneral).toBe(0);
    expect(rows[1].shortfall).toBe(700);
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
  it("funds only what the cash covers and reports the rest", () => {
    const r = simulate(data(), { extraSavings: 5000 }, TODAY);
    expect(r.affordability).toBe("exceeds");
    expect(r.shortfall).toBe(2200);
    const row = r.scenario.ledger.rows[1];
    expect(row.requested).toBe(5000);
    expect(row.toGoals).toBe(2800); // funded
    expect(row.toGeneral).toBe(0);
    // The full-funding view exists only as a labeled hypothetical.
    expect(r.fullFunding.rows[1].toGoals).toBe(5000);
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

// $5,000 income and $4,900 spending: a $100 monthly surplus.
const lean = (key) => [
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
    amount: 4500,
  },
  {
    id: `${key}-g`,
    date: `${key}-10`,
    type: "expense",
    category: "Groceries",
    amount: 400,
  },
];
const leanData = (over = {}) =>
  data({
    transactions: [...lean("2026-08"), ...lean("2026-09"), ...lean("2026-10")],
    goals: [
      {
        id: "g1",
        name: "Trip",
        target: 6000,
        saved: 0,
        deadline: "2027-06-01",
      },
    ],
    ...over,
  });

describe("unfunded plans ($100 surplus)", () => {
  it("funds $100 of a $500 goal contribution and dates the goal from funded money", () => {
    const r = simulate(leanData({ debts: [] }), { extraSavings: 500 }, TODAY);
    const row = r.scenario.ledger.rows[1];
    expect(r.base.surplus).toBe(100);
    expect(row.requested).toBe(500);
    expect(row.toGoals).toBe(100);
    expect(row.shortfall).toBe(400);
    expect(r.shortfall).toBe(400);
    expect(r.affordability).toBe("exceeds");
    expect(r.scenario.ledger.goals[0].reachedMonth).toBe(60); // $6,000 at $100
    expect(r.fullFunding.goals[0].reachedMonth).toBe(12); // only if $400 more is found
    // The funded balance never grows from money that doesn't exist.
    expect(r.scenario.ledger.rows[12].goalMoney).toBe(1200);
    // Total funded savings can't beat today's path: no money is created.
    const total = (l) => l.rows[12].balance + l.rows[12].goalMoney;
    expect(total(r.scenario.ledger)).toBeLessThanOrEqual(
      total(r.baseline.ledger),
    );
    expect(r.scenario.ledger.rows[12].toGeneral).toBe(0);
  });

  it("splits $100 between a competing debt payment and a goal, debt first", () => {
    const r = simulate(leanData(), { extraSavings: 500, extraDebt: 80 }, TODAY);
    const row = r.scenario.ledger.rows[1];
    expect(row.requested).toBe(580);
    expect(row.toDebt).toBe(80);
    expect(row.toGoals).toBe(20);
    expect(row.toGeneral).toBe(0);
    expect(row.shortfall).toBe(480);
    expect(r.scenario.ledger.debtExtra).toBe(80);
  });

  it("caps an extra debt payment at the cash available", () => {
    const r = simulate(leanData({ goals: [] }), { extraDebt: 300 }, TODAY);
    expect(r.scenario.ledger.debtExtra).toBe(100);
    expect(r.scenario.ledger.debt).toEqual(
      simulateDebtPayoff(DEBTS, 100, "avalanche"),
    );
    expect(r.scenario.ledger.rows[1].shortfall).toBe(200);
    expect(r.fullFunding.debt).toEqual(
      simulateDebtPayoff(DEBTS, 300, "avalanche"),
    );
  });

  it("keeps a plan that fits identical to its full-funding view (none is made)", () => {
    const r = simulate(leanData(), { extraSavings: 60, extraDebt: 40 }, TODAY);
    expect(r.affordability).toBe("within");
    expect(r.fullFunding).toBeNull();
  });
});

describe("income changes in the Orb estimate", () => {
  const rate = (h) => h.pillars.find((p) => p.id === "savings").value;
  const income = (h) =>
    h.pillars.find((p) => p.id === "savings").monthly.income;

  it("raises income without adding any record", () => {
    const r = simulate(data(), { incomeChange: 1000 }, TODAY);
    expect(income(r.scenario.orb)).toBeCloseTo(6000, 6);
    expect(rate(r.scenario.orb)).toBeCloseTo(3800 / 6000, 6);
  });

  it("lowers income by scaling records, never below $0", () => {
    const r = simulate(data(), { incomeChange: -1000 }, TODAY);
    expect(income(r.scenario.orb)).toBeCloseTo(4000, 6);
    expect(rate(r.scenario.orb)).toBeCloseTo(1800 / 4000, 6);
    const zero = simulate(data(), { incomeChange: -5000 }, TODAY);
    // $0 income: the savings rate needs data, exactly as healthScore rules it.
    expect(
      zero.scenario.orb.pillars.find((p) => p.id === "savings").state,
    ).toBe("needs-data");
  });

  it("applies a change starting in month 11 to the last 2 of the 3 months only", () => {
    const r = simulate(data(), { incomeChange: 300, incomeStart: 11 }, TODAY);
    expect(income(r.scenario.orb)).toBeCloseTo(5000 + (300 * 2) / 3, 6);
    const late = simulate(
      data(),
      { incomeChange: 300, incomeStart: 12 },
      TODAY,
    );
    expect(income(late.scenario.orb)).toBeCloseTo(5000 + 300 / 3, 6);
    const now = simulate(data(), { incomeChange: 300, incomeStart: 1 }, TODAY);
    expect(income(now.scenario.orb)).toBeCloseTo(5300, 6);
  });
});

describe("Debt Planner suggestion vs saved plan", () => {
  it("treats an unsaved $200 suggestion as no plan, and a saved $0 as a plan", () => {
    expect(readBaseline(data(), TODAY).debtExtraSaved).toBe(false);
    expect(readBaseline(data(), TODAY).debtExtra).toBe(0);
    const zero = readBaseline(
      data({ settings: { annualReturn: 5, debtPlanner: { extra: 0 } } }),
      TODAY,
    );
    expect(zero.debtExtraSaved).toBe(true);
    expect(zero.debtExtra).toBe(0);
  });
});

describe("review round 1: edge cases", () => {
  it("flags a pay cut that leaves a monthly gap, even with no other lever", () => {
    // $2,000 income, $1,000 spending; a $1,500 pay cut leaves -$500 a month.
    const small = (key) => [
      {
        id: `${key}-i`,
        date: `${key}-01`,
        type: "income",
        category: "Salary",
        amount: 2000,
      },
      {
        id: `${key}-h`,
        date: `${key}-03`,
        type: "expense",
        category: "Housing",
        amount: 1000,
      },
    ];
    const d = data({
      debts: [],
      goals: [],
      transactions: [
        ...small("2026-08"),
        ...small("2026-09"),
        ...small("2026-10"),
      ],
    });
    const r = simulate(d, { incomeChange: -1500 }, TODAY);
    const row = r.scenario.ledger.rows[1];
    expect(row.available).toBe(-500);
    expect(row.deficit).toBe(500);
    expect(r.shortfall).toBe(500);
    expect(r.affordability).toBe("exceeds");
    // Today's path never has a gap of its own making.
    expect(r.baseline.ledger.rows.every((x) => x.deficit === 0)).toBe(true);
  });

  it("charges only what the last debt needs in its payoff month", () => {
    const d = data({
      goals: [],
      debts: [{ id: "d1", name: "Card", balance: 100, apr: 0, minPayment: 50 }],
    });
    const plan = simulate(d, { extraDebt: 1000 }, TODAY).scenario.ledger;
    expect(plan.debtFree).toBe(1);
    expect(plan.rows[1].toDebt).toBe(50); // $100 owed - $50 minimum
    expect(plan.rows[1].requested).toBe(50);
    expect(plan.rows[1].toGeneral).toBe(2800 - 50);
    expect(plan.rows[1].shortfall).toBe(0);
  });
});

describe("Debt load at month 12 (review round 2)", () => {
  // Debt load = required monthly payments ÷ recorded income; balances only decide open/closed.
  const debtPillar = (h) => h.pillars.find((p) => p.id === "debt");
  const LOAN = {
    id: "loan",
    name: "Loan",
    balance: 90000,
    apr: 5,
    minPayment: 1500,
  };
  const CARD = {
    id: "card",
    name: "Card",
    balance: 6000,
    apr: 24,
    minPayment: 300,
  };

  it("doesn't change with a partly repaid balance, so open debts keep today's balance", () => {
    const at = (balance) =>
      debtPillar(healthScore(data({ debts: [{ ...LOAN, balance }] }), TODAY));
    const full = at(90000);
    const tenth = at(9000);
    expect(tenth.score).toBe(full.score);
    expect(tenth.payments).toBe(full.payments);
    expect(full.score).toBe(debtScore(1500 / 5000));
  });

  it("scores a partially repaid loan the same in both paths and today", () => {
    const r = simulate(data({ debts: [LOAN] }), { extraDebt: 500 }, TODAY);
    // The plan pays it down faster, but it is still open at month 12.
    expect(r.scenario.ledger.debt.payoffOrder).toEqual([
      { name: "Loan", month: r.scenario.ledger.debtFree },
    ]);
    expect(r.scenario.ledger.debtFree).toBeGreaterThan(ORB_MONTH);
    expect(r.scenario.ledger.debt.timeline[ORB_MONTH].balance).toBeLessThan(
      r.baseline.ledger.debt.timeline[ORB_MONTH].balance,
    );
    const score = debtPillar(r.today).score;
    expect(debtPillar(r.baseline.orb).score).toBe(score);
    expect(debtPillar(r.scenario.orb).score).toBe(score);
  });

  it("drops a fully paid-off loan's payment from Debt load", () => {
    const small = {
      id: "small",
      name: "Small loan",
      balance: 2000,
      apr: 10,
      minPayment: 200,
    };
    const r = simulate(data({ debts: [small, LOAN] }), ZERO_LEVERS, TODAY);
    expect(r.baseline.ledger.debt.payoffOrder[0].name).toBe("Small loan");
    expect(r.baseline.ledger.debt.payoffOrder[0].month).toBeLessThanOrEqual(
      ORB_MONTH,
    );
    expect(debtPillar(r.today).payments).toBe(1700);
    expect(debtPillar(r.baseline.orb).payments).toBe(1500); // the open loan only
    expect(debtPillar(r.baseline.orb).score).toBe(debtScore(1500 / 5000));
  });

  it("handles several debts with different APRs, by strategy", () => {
    const d = data({ debts: [LOAN, CARD] });
    // Avalanche aims the $700 extra at the 24% card, which is paid off by month 12.
    const plan = simulate(d, { extraDebt: 700 }, TODAY);
    const base = plan.baseline;
    expect(
      base.ledger.debt.payoffOrder.find((p) => p.name === "Card").month,
    ).toBeGreaterThan(ORB_MONTH);
    expect(
      plan.scenario.ledger.debt.payoffOrder.find((p) => p.name === "Card")
        .month,
    ).toBeLessThanOrEqual(ORB_MONTH);
    expect(debtPillar(base.orb).score).toBe(debtScore(1800 / 5000));
    expect(debtPillar(plan.scenario.orb).score).toBe(debtScore(1500 / 5000));
    expect(debtPillar(plan.scenario.orb).payments).toBe(1500);
    // The 24% warning goes with the card; the open loan's balance never moves the score.
    expect(debtPillar(base.orb).warnings).toHaveLength(1);
    expect(debtPillar(plan.scenario.orb).warnings).toHaveLength(0);
    // Snowball aims at the smaller balance, which is the card here too.
    const snow = simulate(d, { extraDebt: 700, strategy: "snowball" }, TODAY);
    expect(debtPillar(snow.scenario.orb).score).toBe(debtScore(1500 / 5000));
  });

  it("keeps Debt load needing data when a payment is unknown, even after a payoff", () => {
    const d = data({
      debts: [{ ...LOAN, balance: 4000 }],
      accounts: [
        {
          id: "a1",
          type: "liability",
          kind: "loan",
          name: "Other loan",
          balance: 2000,
          updated: "2026-11-01",
        },
      ],
    });
    const r = simulate(d, { extraDebt: 500 }, TODAY);
    expect(debtPillar(r.today).state).toBe("needs-data");
    expect(debtPillar(r.baseline.orb).state).toBe("needs-data");
    expect(debtPillar(r.scenario.orb).state).toBe("needs-data");
  });
});
