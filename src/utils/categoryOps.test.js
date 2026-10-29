import { describe, expect, it } from "vitest";
import {
  deleteCategory,
  fallbackRollsOver,
  renameCategory,
  usageCount,
} from "./categoryOps";
import {
  budgetRows,
  carryover,
  readBudgeting,
  spendingByMonth,
} from "./budgeting";

const NOV = new Date(2026, 10, 10);
const expense = (date, category, amount) => ({
  id: `${date}-${category}`,
  date,
  description: "x",
  category,
  type: "expense",
  amount,
});

const DATA = {
  transactions: [
    expense("2026-09-05", "Dining", 80),
    expense("2026-10-05", "Dining", 120),
    expense("2026-11-05", "Dining", 40),
    expense("2026-09-06", "Other", 50),
    expense("2026-10-06", "Other", 150),
  ],
  bills: [
    { id: "b1", name: "Club", amount: 20, dueDay: 3, category: "Dining" },
  ],
  budgets: { Dining: 200, Other: 100 },
  settings: {
    annualReturn: 5,
    budgeting: {
      limits: {
        Dining: [
          { from: null, limit: 150 },
          { from: "2026-11", limit: 200 },
        ],
      },
      plannedIncome: { "2026-11": 5000 },
      rollover: {
        Dining: [{ from: "2026-09", to: null }],
        Other: [{ from: "2026-09", to: null }],
      },
    },
  },
};

describe("renameCategory", () => {
  it("moves the name in records, limits, history and rollover", () => {
    const out = renameCategory(DATA, "Dining", "Eating Out");
    expect(
      out.transactions.filter((t) => t.category === "Eating Out"),
    ).toHaveLength(3);
    expect(out.bills[0].category).toBe("Eating Out");
    expect(out.budgets).toEqual({ Other: 100, "Eating Out": 200 });
    const b = readBudgeting(out.settings);
    expect(b.limits).toEqual({
      "Eating Out": DATA.settings.budgeting.limits.Dining,
    });
    expect(Object.keys(b.rollover).sort()).toEqual(["Eating Out", "Other"]);
    expect(out.settings.annualReturn).toBe(5); // other settings kept
  });

  it("keeps the carryover exactly the same under the new name", () => {
    const before = carryover(
      DATA.budgets,
      readBudgeting(DATA.settings),
      spendingByMonth(DATA.transactions),
      "Dining",
      "2026-11",
    );
    const out = renameCategory(DATA, "Dining", "Eating Out");
    const after = carryover(
      out.budgets,
      readBudgeting(out.settings),
      spendingByMonth(out.transactions),
      "Eating Out",
      "2026-11",
    );
    expect(before).toBe(100); // (150 - 80) + (150 - 120)
    expect(after).toBe(before);
  });

  it("works with settings from an older backup (no budgeting)", () => {
    const out = renameCategory(
      { ...DATA, settings: { annualReturn: 5 } },
      "Dining",
      "Food",
    );
    expect(out.budgets.Food).toBe(200);
    expect(readBudgeting(out.settings)).toEqual({
      limits: {},
      plannedIncome: {},
      rollover: {},
    });
  });
});

describe("deleteCategory", () => {
  const remove = (data = DATA) => deleteCategory(data, "Dining", "Other", NOV);

  it("moves records to the fallback and removes the limit, history and rollover", () => {
    const out = remove();
    expect(out.transactions.every((t) => t.category === "Other")).toBe(true);
    expect(out.bills[0].category).toBe("Other");
    expect(out.budgets).toEqual({ Other: 100 });
    const b = readBudgeting(out.settings);
    expect(b.limits).toEqual({});
    expect(b.rollover.Dining).toBeUndefined();
    expect(b.plannedIncome).toEqual({ "2026-11": 5000 }); // untouched
  });

  it("keeps the fallback's rolled-over balance when transactions move into it", () => {
    const spendingBefore = spendingByMonth(DATA.transactions);
    const before = carryover(
      DATA.budgets,
      readBudgeting(DATA.settings),
      spendingBefore,
      "Other",
      "2026-11",
    );
    expect(before).toBe(0); // (100 - 50) + (100 - 150)

    const out = remove();
    const b = readBudgeting(out.settings);
    const after = carryover(
      out.budgets,
      b,
      spendingByMonth(out.transactions),
      "Other",
      "2026-11",
    );
    expect(after).toBe(before); // without the fix it would be -200 (Dining's past spending)
    expect(b.rollover.Other).toEqual([
      { from: "2026-09", to: "2026-10" },
      { from: "2026-11", to: null, opening: 0 },
    ]);
  });

  it("counts moved spending from this month on, and its allocations stay its own", () => {
    const out = remove();
    const [, other] = budgetRows(
      {
        ...out,
        categories: [
          { name: "Dining", type: "expense" },
          { name: "Other", type: "expense" },
        ],
      },
      "2026-11",
    );
    // Other's own $100 allocation is unchanged; Dining's $40 this month now counts against it.
    expect(other).toMatchObject({
      category: "Other",
      allocation: 100,
      carryover: 0,
      spent: 40,
      remaining: 60,
    });
  });

  it("carries a positive balance forward through the move", () => {
    const data = {
      ...DATA,
      transactions: DATA.transactions.filter(
        (t) => !(t.category === "Other" && t.date === "2026-10-06"),
      ),
    };
    const out = remove(data);
    expect(readBudgeting(out.settings).rollover.Other.at(-1)).toEqual({
      from: "2026-11",
      to: null,
      opening: 150,
    });
  });

  it("leaves the fallback alone when it does not roll over", () => {
    const settings = {
      budgeting: { rollover: { Dining: [{ from: "2026-09", to: null }] } },
    };
    const out = remove({ ...DATA, settings });
    expect(readBudgeting(out.settings).rollover).toEqual({});
  });

  it("works with settings from an older backup (no budgeting)", () => {
    const out = remove({ ...DATA, settings: undefined });
    expect(out.budgets).toEqual({ Other: 100 });
    expect(readBudgeting(out.settings)).toEqual({
      limits: {},
      plannedIncome: {},
      rollover: {},
    });
  });
});

describe("helpers", () => {
  it("fallbackRollsOver checks this month only", () => {
    expect(fallbackRollsOver(DATA.settings, "Other", NOV)).toBe(true);
    expect(fallbackRollsOver(DATA.settings, "Groceries", NOV)).toBe(false);
    expect(fallbackRollsOver(undefined, "Other", NOV)).toBe(false);
  });

  it("usageCount counts transactions and bills", () => {
    expect(usageCount(DATA, "Dining")).toBe(4);
  });
});
