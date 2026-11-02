import { describe, expect, it } from "vitest";
import { msUntilNextMonth } from "./useCurrentMonth";

describe("msUntilNextMonth", () => {
  it("counts to midnight on the 1st of next month", () => {
    expect(msUntilNextMonth(new Date(2026, 10, 30, 23, 59, 50))).toBe(10_000);
    expect(msUntilNextMonth(new Date(2026, 10, 2, 0, 0, 0))).toBe(
      new Date(2026, 11, 1) - new Date(2026, 10, 2),
    );
  });

  it("crosses the year", () => {
    expect(msUntilNextMonth(new Date(2026, 11, 31, 23, 0, 0))).toBe(3_600_000);
  });

  it("is never 0, so a timer never spins", () => {
    expect(msUntilNextMonth(new Date(2027, 0, 1))).toBeGreaterThan(0);
  });
});
