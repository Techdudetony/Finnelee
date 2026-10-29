import { describe, expect, it } from "vitest";
import {
  addMonths,
  budgetMonths,
  budgetRows,
  carryover,
  goalContributions,
  leftToAssign,
  limitFor,
  monthMode,
  readBudgeting,
  setLimit,
  setPlannedIncome,
  setRollover,
  spendingByMonth,
  suggestedIncome,
  syncBudgets,
} from "./budgeting";

const OCT = new Date(2026, 9, 15); // Oct 15, 2026
const NOV = new Date(2026, 10, 3);
const DEC = new Date(2026, 11, 20);
const JAN = new Date(2027, 0, 5);

const expense = (date, category, amount) => ({
  id: `${date}-${category}-${amount}`,
  date,
  description: "x",
  category,
  type: "expense",
  amount,
});
const income = (date, amount) => ({
  id: `${date}-in-${amount}`,
  date,
  description: "Pay",
  category: "Salary",
  type: "income",
  amount,
});
const CATEGORIES = [
  { name: "Groceries", type: "expense" },
  { name: "Dining", type: "expense" },
  { name: "Salary", type: "income" },
];

// Limits as the user would set them, month by month: [[date, category, value], ...]
function edit(start, steps) {
  return steps.reduce(
    (data, [today, category, month, value]) =>
      setLimit(data, category, month, value, today),
    start,
  );
}

describe("months", () => {
  it("adds months across a year change", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-11", 14)).toBe("2028-01");
  });

  it("labels past, current and next months, including in December", () => {
    expect(monthMode("2026-10", OCT)).toBe("current");
    expect(monthMode("2026-11", OCT)).toBe("next");
    expect(monthMode("2026-09", OCT)).toBe("past");
    expect(monthMode("2027-01", DEC)).toBe("next");
    expect(monthMode("2027-02", DEC)).toBe("past"); // beyond next month is not editable either
  });

  it("lists months from the first transaction through next month", () => {
    expect(budgetMonths([expense("2026-08-20", "Dining", 5)], OCT)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(budgetMonths([], DEC)).toEqual(["2026-12", "2027-01"]);
  });
});

describe("readBudgeting (older backups and bad data)", () => {
  it("fills in everything when settings or budgeting is missing", () => {
    const empty = { limits: {}, plannedIncome: {}, rollover: {} };
    expect(readBudgeting(undefined)).toEqual(empty);
    expect(readBudgeting({ startingSavings: 0, annualReturn: 5 })).toEqual(
      empty,
    );
    expect(readBudgeting({ budgeting: { limits: {} } })).toEqual(empty);
  });

  it("drops malformed entries and sorts the rest", () => {
    const read = readBudgeting({
      budgeting: {
        limits: {
          Groceries: [
            { from: "2026-11", limit: 500 },
            { from: null, limit: 400 },
            { from: "soon", limit: 1 },
          ],
          Dining: "oops",
        },
        plannedIncome: { "2026-10": 5000, nope: 1, "2026-11": "5000" },
        rollover: {
          Groceries: [{ from: "2026-09", to: null }, { from: "2026-01" }],
        },
      },
    });
    expect(read.limits).toEqual({
      Groceries: [
        { from: null, limit: 400 },
        { from: "2026-11", limit: 500 },
      ],
    });
    expect(read.plannedIncome).toEqual({ "2026-10": 5000 });
    expect(read.rollover).toEqual({
      Groceries: [{ from: "2026-09", to: null }],
    });
  });
});

describe("limit history", () => {
  const start = { budgets: { Groceries: 450, Dining: 200 }, settings: {} };

  it("uses budgets for every month until a limit is edited", () => {
    const b = readBudgeting(start.settings);
    expect(limitFor(start.budgets, b, "Groceries", "2025-01")).toBe(450);
    expect(limitFor(start.budgets, b, "Groceries", "2026-11")).toBe(450);
    expect(limitFor(start.budgets, b, "Health", "2026-10")).toBe(0);
  });

  it("a November change leaves October alone", () => {
    const data = edit(start, [[NOV, "Groceries", "2026-11", "500"]]);
    const b = readBudgeting(data.settings);
    expect(limitFor(data.budgets, b, "Groceries", "2026-10")).toBe(450);
    expect(limitFor(data.budgets, b, "Groceries", "2026-11")).toBe(500);
    expect(data.budgets.Groceries).toBe(500);
    expect(b.limits.Groceries).toEqual([
      { from: null, limit: 450 },
      { from: "2026-11", limit: 500 },
    ]);
  });

  it("typing replaces the month entry, and a value equal to the month before is dropped", () => {
    const data = edit(start, [
      [NOV, "Groceries", "2026-11", "5"],
      [NOV, "Groceries", "2026-11", "50"],
      [NOV, "Groceries", "2026-11", "450"],
    ]);
    expect(readBudgeting(data.settings).limits.Groceries).toEqual([
      { from: null, limit: 450 },
    ]);
  });

  it('keeps an empty input as "" in budgets but stores 0 in history', () => {
    const data = edit(start, [[OCT, "Dining", "2026-10", ""]]);
    expect(data.budgets.Dining).toBe("");
    expect(
      limitFor(data.budgets, readBudgeting(data.settings), "Dining", "2026-10"),
    ).toBe(0);
  });

  it("refuses past months", () => {
    const data = edit(start, [[NOV, "Groceries", "2026-10", "999"]]);
    expect(data).toEqual(start);
  });
});

describe("next-month planning", () => {
  const start = { budgets: { Groceries: 450 }, settings: {} };

  it("a plan for next month does not change this month", () => {
    const data = edit(start, [[OCT, "Groceries", "2026-11", "600"]]);
    const b = readBudgeting(data.settings);
    expect(data.budgets.Groceries).toBe(450); // this month's active limit
    expect(limitFor(data.budgets, b, "Groceries", "2026-10")).toBe(450);
    expect(limitFor(data.budgets, b, "Groceries", "2026-11")).toBe(600);
  });

  it("next month inherits this month until it has its own plan", () => {
    const data = edit(start, [[OCT, "Groceries", "2026-10", "480"]]);
    expect(
      limitFor(
        data.budgets,
        readBudgeting(data.settings),
        "Groceries",
        "2026-11",
      ),
    ).toBe(480);
  });

  it("editing this month keeps an existing next-month plan", () => {
    const data = edit(start, [
      [OCT, "Groceries", "2026-11", "600"],
      [OCT, "Groceries", "2026-10", "300"],
    ]);
    const b = readBudgeting(data.settings);
    expect(limitFor(data.budgets, b, "Groceries", "2026-10")).toBe(300);
    expect(limitFor(data.budgets, b, "Groceries", "2026-11")).toBe(600);
  });

  it("syncBudgets picks up the plan once the calendar reaches it, across a year change", () => {
    const data = edit(start, [[DEC, "Groceries", "2027-01", "700"]]);
    expect(syncBudgets(data.budgets, data.settings, DEC)).toBe(data.budgets); // nothing to do yet: same object
    expect(syncBudgets(data.budgets, data.settings, JAN)).toEqual({
      Groceries: 700,
    });
    // December's history is untouched after the move
    expect(
      limitFor(
        { Groceries: 700 },
        readBudgeting(data.settings),
        "Groceries",
        "2026-12",
      ),
    ).toBe(450);
  });

  it("planned income is per month and only for this month or next", () => {
    let settings = setPlannedIncome({}, "2026-10", "5200", OCT);
    settings = setPlannedIncome(settings, "2026-11", "5400", OCT);
    settings = setPlannedIncome(settings, "2026-09", "1", OCT); // past: ignored
    expect(readBudgeting(settings).plannedIncome).toEqual({
      "2026-10": 5200,
      "2026-11": 5400,
    });
    expect(
      readBudgeting(setPlannedIncome(settings, "2026-11", "", OCT))
        .plannedIncome,
    ).toEqual({
      "2026-10": 5200,
    });
  });
});

describe("rollover", () => {
  const budgets = { Groceries: 500 };
  const tx = [
    expense("2026-08-10", "Groceries", 100), // before rollover: never counts
    expense("2026-09-10", "Groceries", 450), // +50
    expense("2026-10-10", "Groceries", 650), // -150
    expense("2026-11-02", "Groceries", 120),
  ];
  const spending = spendingByMonth(tx);
  const on = (settings, today) =>
    setRollover(settings, "Groceries", true, today);
  const off = (settings, today) =>
    setRollover(settings, "Groceries", false, today);
  const carry = (settings, month) =>
    carryover(budgets, readBudgeting(settings), spending, "Groceries", month);

  const fromSep = on({}, new Date(2026, 8, 1));

  it("starts at $0 and ignores months before it was turned on", () => {
    expect(carry(fromSep, "2026-09")).toBe(0);
    expect(carry(fromSep, "2026-10")).toBe(50);
  });

  it("carries negative balances: $500 allocation with -$100 carried gives $400 available", () => {
    expect(carry(fromSep, "2026-11")).toBe(-100); // 50 + (500 - 650)
    const [row] = budgetRows(
      {
        budgets,
        settings: fromSep,
        transactions: tx,
        categories: [{ name: "Groceries", type: "expense" }],
      },
      "2026-11",
    );
    expect(row).toEqual({
      category: "Groceries",
      allocation: 500,
      carryover: -100,
      available: 400,
      spent: 120,
      remaining: 280,
      rollsOver: true,
    });
  });

  it("uses each month's own limit, so a later limit change does not rewrite old carryover", () => {
    const data = edit({ budgets, settings: fromSep }, [
      [NOV, "Groceries", "2026-11", "800"],
    ]);
    expect(
      carryover(
        data.budgets,
        readBudgeting(data.settings),
        spending,
        "Groceries",
        "2026-11",
      ),
    ).toBe(-100);
  });

  it("carries across a year change", () => {
    const s = on({}, DEC);
    const sp = spendingByMonth([expense("2026-12-05", "Groceries", 300)]);
    expect(
      carryover(budgets, readBudgeting(s), sp, "Groceries", "2027-01"),
    ).toBe(200);
  });

  it("turning off ends the period last month, so this month has no carryover", () => {
    const s = off(fromSep, NOV);
    expect(readBudgeting(s).rollover.Groceries).toEqual([
      { from: "2026-09", to: "2026-10" },
    ]);
    expect(carry(s, "2026-11")).toBe(0);
    expect(carry(s, "2026-10")).toBe(50); // history unchanged
  });

  it("turning back on in a later month starts fresh at $0", () => {
    const s = on(off(fromSep, new Date(2026, 9, 1)), NOV); // off in Oct, on in Nov
    expect(readBudgeting(s).rollover.Groceries).toEqual([
      { from: "2026-09", to: "2026-09" },
      { from: "2026-11", to: null },
    ]);
    expect(carry(s, "2026-11")).toBe(0);
  });

  it("turning back on in the same month undoes the turn-off", () => {
    const s = on(off(fromSep, NOV), NOV);
    expect(s.budgeting.rollover.Groceries).toEqual([
      { from: "2026-09", to: null },
    ]);
    expect(carry(s, "2026-11")).toBe(-100);
  });

  it("turning off in the month it was turned on is as if it never was", () => {
    const s = off(on({}, NOV), NOV);
    expect(carry(s, "2026-11")).toBe(0);
    expect(
      budgetRows(
        {
          budgets,
          settings: s,
          transactions: tx,
          categories: [{ name: "Groceries", type: "expense" }],
        },
        "2026-11",
      )[0].rollsOver,
    ).toBe(false);
    // and a later fresh start drops the empty period
    expect(readBudgeting(on(s, DEC)).rollover.Groceries).toEqual([
      { from: "2026-12", to: null },
    ]);
  });

  it("starts from an opening balance when one is set", () => {
    const s = {
      budgeting: {
        rollover: { Groceries: [{ from: "2026-11", to: null, opening: 75 }] },
      },
    };
    expect(carry(s, "2026-11")).toBe(75);
    expect(carry(s, "2026-12")).toBe(455); // 75 + 500 - 120
  });

  it("does nothing when the toggle already matches", () => {
    expect(on(fromSep, OCT)).toBe(fromSep);
    expect(off({}, OCT)).toEqual({});
  });
});

describe("planned income and Left to assign", () => {
  const tx = [
    income("2026-07-01", 4000),
    income("2026-08-01", 4500),
    income("2026-09-01", 4600),
    income("2026-10-01", 9999),
  ];

  it("suggests the average of the last 3 full months", () => {
    expect(suggestedIncome(tx, OCT)).toBe(4367); // (4000 + 4500 + 4600) / 3, this month left out
    expect(suggestedIncome([], OCT)).toBe(null);
  });

  it("subtracts allocations and monthly goal contributions, not carryover", () => {
    const settings = {
      budgeting: {
        plannedIncome: { "2026-10": 5000 },
        rollover: { Groceries: [{ from: "2026-01", to: null, opening: 900 }] },
      },
    };
    const goals = [
      { target: 1200, saved: 0, deadline: "2027-10-01" }, // 12 months away: 100 / month
      { target: 500, saved: 500, deadline: "2027-01-01" }, // done: counts as 0
    ];
    const result = leftToAssign(
      {
        budgets: { Groceries: 500, Dining: 200 },
        settings,
        categories: CATEGORIES,
        goals,
        suggestion: 4367,
      },
      "2026-10",
    );
    expect(result).toEqual({
      income: 5000,
      confirmed: true,
      allocated: 700,
      goalSavings: 100,
      assigned: 800,
      left: 4200,
    });
  });

  it("uses the suggestion until income is confirmed, and never overwrites a confirmed amount", () => {
    const base = {
      budgets: {},
      categories: CATEGORIES,
      goals: [],
      suggestion: 4367,
    };
    expect(leftToAssign({ ...base, settings: {} }, "2026-10")).toMatchObject({
      income: 4367,
      confirmed: false,
    });
    const confirmed = setPlannedIncome({}, "2026-10", "3000", OCT);
    expect(
      leftToAssign(
        { ...base, settings: confirmed, suggestion: 9000 },
        "2026-10",
      ),
    ).toMatchObject({ income: 3000, confirmed: true });
  });

  it("plans next month with next month's limits and goal amounts", () => {
    const data = edit({ budgets: { Groceries: 500 }, settings: {} }, [
      [OCT, "Groceries", "2026-11", "650"],
    ]);
    const goals = [{ target: 1100, saved: 0, deadline: "2027-10-01" }]; // 11 months from Nov: 100
    expect(
      leftToAssign(
        { ...data, categories: CATEGORIES, goals, suggestion: 4000 },
        "2026-11",
      ),
    ).toMatchObject({
      allocated: 650,
      goalSavings: 100,
      assigned: 750,
      left: 3250,
    });
    expect(goalContributions(goals, "2026-10")).toBe(91.67); // 12 months from Oct
  });
});
