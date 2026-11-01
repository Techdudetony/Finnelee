import { describe, expect, it, vi } from "vitest";
import {
  budgetCompleted,
  createSettleWatcher,
  goalReached,
  toCents,
} from "./celebrate";

describe("toCents", () => {
  it("rounds to whole cents and treats bad input as 0", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents("12.345")).toBe(1235);
    expect(toCents("")).toBe(0);
    expect(toCents("abc")).toBe(0);
    expect(toCents(-4.5)).toBe(-450);
  });
});

describe("goalReached", () => {
  const goal = (saved, target) => ({ saved, target });

  it("is true when added money crosses the target", () => {
    expect(goalReached(goal(4100, 5000), goal(5000, 5000))).toBe(true);
    expect(goalReached(goal(4100, 5000), goal(5200, 5000))).toBe(true);
  });

  it("is false when still short, already reached, or money was taken out", () => {
    expect(goalReached(goal(4100, 5000), goal(4999.99, 5000))).toBe(false);
    expect(goalReached(goal(5000, 5000), goal(5100, 5000))).toBe(false);
    expect(goalReached(goal(4100, 5000), goal(4000, 5000))).toBe(false);
  });

  it("is false when only the target was lowered", () => {
    expect(goalReached(goal(4100, 5000), goal(4100, 4000))).toBe(false);
  });

  it("compares in cents, so float sums still reach the target", () => {
    expect(goalReached(goal(0.2, 0.3), goal(0.1 + 0.2, 0.3))).toBe(true);
  });

  it("never celebrates a goal with no target", () => {
    expect(goalReached(goal(0, 0), goal(10, 0))).toBe(false);
  });
});

describe("budgetCompleted", () => {
  const plan = (left, extra = {}) => ({
    confirmed: true,
    income: 4000,
    left,
    ...extra,
  });

  it("is true when left to assign moves to exactly $0.00", () => {
    expect(budgetCompleted(plan(250), plan(0))).toBe(true);
    expect(budgetCompleted(plan(-30), plan(0))).toBe(true); // was over-assigned
    expect(budgetCompleted(plan(0.3), plan(0.1 + 0.2 - 0.3))).toBe(true); // float noise
  });

  it("is true when income is confirmed with $0.00 already left", () => {
    const before = plan(0, { confirmed: false, income: 0 });
    expect(budgetCompleted(before, plan(0))).toBe(true);
  });

  it("is false when it was already complete, or isn't $0.00 now", () => {
    expect(budgetCompleted(plan(0), plan(0))).toBe(false);
    expect(budgetCompleted(plan(250), plan(0.01))).toBe(false);
    expect(budgetCompleted(plan(250), plan(-0.01))).toBe(false);
  });

  it("needs confirmed planned income above $0", () => {
    expect(budgetCompleted(plan(250), plan(0, { confirmed: false }))).toBe(
      false,
    );
    expect(budgetCompleted(plan(250), plan(0, { income: 0 }))).toBe(false);
  });
});

describe("createSettleWatcher", () => {
  it("reports once per pause, from the value before typing began", () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const w = createSettleWatcher(settled, { delay: 700 });
    // Typing "100" one key at a time: 10 passes through $0.00 on the way.
    w.change(90, 89);
    w.change(89, 0);
    w.change(0, -900);
    vi.advanceTimersByTime(699);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(90, -900);
    // The next burst starts from where the last one ended.
    w.change(-900, 0);
    vi.advanceTimersByTime(700);
    expect(settled).toHaveBeenLastCalledWith(-900, 0);
    vi.useRealTimers();
  });

  it("drops a pending check when cancelled", () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const w = createSettleWatcher(settled);
    w.change(10, 0);
    w.cancel();
    vi.advanceTimersByTime(5000);
    expect(settled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
