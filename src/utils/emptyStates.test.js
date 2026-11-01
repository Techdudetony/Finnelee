import { describe, expect, it } from "vitest";
import {
  budgetPlanState,
  incomeSpendingState,
  netWorthHistoryState,
  projectionState,
  spendingForecastState,
} from "./emptyStates";

// Six months, oldest first; the last one is the current (unfinished) month.
const months = (pairs) =>
  pairs.map(([income, expenses]) => ({ income, expenses }));

describe("spendingForecastState", () => {
  it("is empty with no records at all", () => {
    const history = months([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(spendingForecastState(history)).toEqual({
      state: "empty",
      have: 0,
      need: 2,
    });
  });

  it("does not count the current month, which isn't finished", () => {
    const history = months([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 120],
    ]);
    expect(spendingForecastState(history)).toEqual({
      state: "insufficient",
      have: 0,
      need: 2,
    });
  });

  it("is insufficient with one full month of spending", () => {
    const history = months([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [3000, 900],
      [0, 0],
    ]);
    expect(spendingForecastState(history)).toMatchObject({
      state: "insufficient",
      have: 1,
    });
  });

  it("is insufficient with income but no spending", () => {
    const history = months([
      [0, 0],
      [0, 0],
      [0, 0],
      [3000, 0],
      [3000, 0],
      [0, 0],
    ]);
    expect(spendingForecastState(history)).toMatchObject({
      state: "insufficient",
      have: 0,
    });
  });

  it("is ready with two full months of spending, even if they aren't next to each other", () => {
    const history = months([
      [0, 400],
      [0, 0],
      [0, 0],
      [0, 650],
      [0, 0],
      [0, 0],
    ]);
    expect(spendingForecastState(history)).toEqual({
      state: "ready",
      have: 2,
      need: 2,
    });
  });
});

describe("projectionState", () => {
  it("is empty only when both savings and the deposit are 0", () => {
    expect(projectionState({ start: 0, monthly: 0 })).toBe("empty");
    expect(projectionState({ start: "", monthly: 0 })).toBe("empty");
    expect(projectionState({ start: 500, monthly: 0 })).toBe("ready");
    expect(projectionState({ start: 0, monthly: 50 })).toBe("ready");
  });
});

describe("incomeSpendingState", () => {
  it("is empty when every month is $0 both ways", () => {
    expect(
      incomeSpendingState(
        months([
          [0, 0],
          [0, 0],
        ]),
      ),
    ).toBe("empty");
    expect(
      incomeSpendingState(
        months([
          [0, 0],
          [1, 0],
        ]),
      ),
    ).toBe("ready");
    expect(
      incomeSpendingState(
        months([
          [0, 0.01],
          [0, 0],
        ]),
      ),
    ).toBe("ready");
  });
});

describe("netWorthHistoryState", () => {
  it("is hidden with no accounts and no history", () => {
    expect(netWorthHistoryState(0, 0).state).toBe("hidden");
  });
  it("is insufficient with accounts but fewer than 2 months", () => {
    expect(netWorthHistoryState(1, 2)).toEqual({
      state: "insufficient",
      have: 1,
      need: 2,
    });
    expect(netWorthHistoryState(0, 1)).toEqual({
      state: "insufficient",
      have: 0,
      need: 2,
    });
  });
  it("is ready with 2 or more months, even after accounts are removed", () => {
    expect(netWorthHistoryState(2, 1).state).toBe("ready");
    expect(netWorthHistoryState(5, 0).state).toBe("ready");
  });
});

describe("budgetPlanState", () => {
  it("is empty when there is no income and nothing assigned", () => {
    expect(budgetPlanState({ income: 0, assigned: 0, left: 0 })).toBe("empty");
  });
  it("is unassigned when there is income but nothing assigned", () => {
    expect(budgetPlanState({ income: 4000, assigned: 0, left: 4000 })).toBe(
      "unassigned",
    );
  });
  it("is ready once anything is assigned, including over-assigned", () => {
    expect(budgetPlanState({ income: 4000, assigned: 4000, left: 0 })).toBe(
      "ready",
    );
    expect(budgetPlanState({ income: 0, assigned: 100, left: -100 })).toBe(
      "ready",
    );
  });
});
