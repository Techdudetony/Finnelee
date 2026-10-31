import { describe, expect, it } from "vitest";
import {
  billLinkOptions,
  debtOptions,
  dueDayProblem,
  linkValue,
  paymentProblem,
  readScheduleForm,
  recentPaidStatus,
  scheduleForm,
  setBillLink,
  setDebtLink,
  setOptional,
  upcomingPaydays,
} from "./payments";
import { buildObligations, markPaid, undoPaid } from "./obligations";

const OCT_30 = new Date(2026, 9, 30); // local date, as the app uses

describe("recentPaidStatus", () => {
  const debt = {
    id: "d1",
    paidMonths: {
      "2026-07": { markedOn: "2026-07-02" }, // too old to list
      "2026-09": { markedOn: "2026-09-03" },
      "2026-11": { markedOn: "2026-10-30" }, // paid early
      "2026-10": { markedOn: "2026-10-01" },
      bad: { markedOn: "2026-10-01" }, // not a month key: ignored
    },
  };

  it("lists last, this and next month, oldest first, with the month named", () => {
    const lines = recentPaidStatus(debt, OCT_30);
    expect(lines.map((l) => l.month)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(lines[1].text).toBe("Paid for Oct 2026 (marked Oct 1)");
    expect(lines[1].monthText).toBe("Oct 2026");
  });

  it("reads missing or broken paidMonths as nothing paid", () => {
    expect(recentPaidStatus({}, OCT_30)).toEqual([]);
    expect(recentPaidStatus({ paidMonths: [] }, OCT_30)).toEqual([]);
  });

  it("follows Mark paid and Undo from obligations.js", () => {
    const marked = markPaid({ id: "d" }, "2026-10", OCT_30);
    expect(recentPaidStatus(marked, OCT_30)).toHaveLength(1);
    expect(recentPaidStatus(undoPaid(marked, "2026-10"), OCT_30)).toEqual([]);
  });
});

describe("optional number fields", () => {
  it("saves a number, and a blank box removes the field (never 0)", () => {
    const a = { id: "a", name: "Mortgage" };
    const withPay = setOptional(a, "monthlyPayment", "1450.5");
    expect(withPay.monthlyPayment).toBe(1450.5);
    expect(setOptional(withPay, "monthlyPayment", "")).toEqual(a);
    expect(a).toEqual({ id: "a", name: "Mortgage" }); // original untouched
  });

  it("explains invalid due days and payments, but not blanks", () => {
    expect(dueDayProblem("")).toBeNull();
    expect(dueDayProblem(undefined)).toBeNull();
    expect(dueDayProblem(31)).toBeNull();
    expect(dueDayProblem(0)).toMatch(/1 to 31/);
    expect(dueDayProblem(32)).toMatch(/1 to 31/);
    expect(dueDayProblem(2.5)).toMatch(/1 to 31/);
    expect(paymentProblem("")).toBeNull();
    expect(paymentProblem(350)).toBeNull();
    expect(paymentProblem(0)).toMatch(/above 0/);
  });
});

describe("links", () => {
  const debts = [
    { id: "car", name: "Car loan", balance: 9000 },
    { id: "old", name: "Paid off card", balance: 0 },
  ];
  const accounts = [
    {
      id: "m",
      type: "liability",
      kind: "mortgage",
      name: "Mortgage",
      balance: 200000,
    },
    { id: "s", type: "asset", kind: "cash", name: "Savings", balance: 500 },
  ];

  it("offers only open debts and liabilities, labeled by page", () => {
    expect(debtOptions(debts)).toEqual([{ value: "car", label: "Car loan" }]);
    expect(billLinkOptions(debts, accounts)).toEqual([
      { value: "debt:car", label: "Car loan (Debt Planner)" },
      { value: "account:m", label: "Mortgage (Net Worth)" },
    ]);
  });

  it("round-trips a bill link and unlinks with a blank choice", () => {
    const bill = { id: "b", name: "Car payment", amount: 350 };
    const linked = setBillLink(bill, "debt:car");
    expect(linked.payFor).toEqual({ type: "debt", id: "car" });
    expect(linkValue(linked.payFor)).toBe("debt:car");
    expect(setBillLink(linked, "")).toEqual(bill);
    expect(linkValue(undefined)).toBe("");
    expect(linkValue({ type: "nope", id: "x" })).toBe("");
  });

  it("links a liability to a debt so the loan forms one group", () => {
    const linked = setDebtLink(accounts[0], "car");
    const { groups } = buildObligations({
      debts,
      accounts: [linked],
      bills: [
        setBillLink({ id: "b", name: "Car payment", amount: 350 }, "account:m"),
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].sources).toEqual([
      "Debt Planner",
      "Net Worth: Mortgage",
      "Bills: Car payment",
    ]);
    expect(setDebtLink(linked, "")).toEqual(accounts[0]);
  });
});

describe("pay schedule form", () => {
  const form = (over) => ({
    amount: "",
    cadence: "biweekly",
    next: "2026-11-06",
    day1: "",
    day2: "",
    ...over,
  });

  it("saves only what was typed, and the amount is optional", () => {
    expect(readScheduleForm(form())).toEqual({
      schedule: { cadence: "biweekly", next: "2026-11-06" },
    });
    expect(readScheduleForm(form({ amount: "2100" })).schedule.amount).toBe(
      2100,
    );
  });

  it("explains what's missing instead of guessing", () => {
    expect(readScheduleForm(form({ next: "" })).error).toMatch(/next payday/);
    expect(readScheduleForm(form({ amount: "-5" })).error).toMatch(/above 0/);
    expect(
      readScheduleForm(form({ cadence: "twice-monthly", day1: "15" })).error,
    ).toMatch(/two different paydays/);
    expect(
      readScheduleForm(
        form({ cadence: "twice-monthly", day1: "15", day2: "15" }),
      ).error,
    ).toMatch(/two different paydays/);
  });

  it("sorts twice-a-month days and loads back into the form", () => {
    const { schedule } = readScheduleForm(
      form({ cadence: "twice-monthly", day1: "30", day2: "15" }),
    );
    expect(schedule.days).toEqual([15, 30]);
    expect(scheduleForm({ paySchedule: schedule })).toEqual({
      amount: "",
      cadence: "twice-monthly",
      next: "2026-11-06",
      day1: 15,
      day2: 30,
    });
    expect(scheduleForm({}).next).toBe(""); // no schedule: blank form
  });

  it("lists the next paydays from a saved schedule only", () => {
    expect(upcomingPaydays({}, OCT_30)).toEqual([]);
    const settings = {
      paySchedule: {
        cadence: "twice-monthly",
        next: "2026-10-30",
        days: [15, 30],
      },
    };
    expect(upcomingPaydays(settings, OCT_30)).toEqual([
      "2026-10-30",
      "2026-11-15",
      "2026-11-30",
    ]);
  });
});
