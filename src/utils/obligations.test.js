import { describe, expect, it } from "vitest";
import {
  addDays,
  buildObligations,
  dueDateIn,
  groupPaidFor,
  markBillPaid,
  markPaid,
  markPaidLabel,
  paidStatus,
  paidTarget,
  paymentsOwed,
  readDueDay,
  readPaidMonths,
  readPayment,
  undoBillPaid,
  undoPaid,
} from "./obligations";

const OCT30 = new Date(2026, 9, 30);
const debt = (id, extra = {}) => ({
  id,
  name: id,
  balance: 5000,
  apr: 7,
  minPayment: 350,
  ...extra,
});
const liability = (id, extra = {}) => ({
  id,
  name: id,
  type: "liability",
  kind: "other",
  balance: 5000,
  updated: "2026-10-29",
  source: "manual",
  ...extra,
});
const bill = (id, dueDay, amount, extra = {}) => ({
  id,
  name: id,
  dueDay,
  amount,
  category: "Housing",
  ...extra,
});

describe("reading optional fields (older records have none)", () => {
  it("dueDay is a whole number 1-31, anything else is unknown", () => {
    expect(readDueDay(1)).toBe(1);
    expect(readDueDay(31)).toBe(31);
    expect(readDueDay("15")).toBe(15);
    for (const bad of [0, 32, 2.5, "abc", "", null, undefined, true, NaN])
      expect(readDueDay(bad)).toBeNull();
  });

  it("payments must be above 0", () => {
    expect(readPayment(350)).toBe(350);
    expect(readPayment("12.345")).toBe(12.35);
    for (const bad of [0, -5, "", "abc", null, undefined, Infinity])
      expect(readPayment(bad)).toBeNull();
  });

  it("paidMonths keeps only well-formed months; an array or junk reads as not paid", () => {
    expect(readPaidMonths({})).toEqual({});
    expect(readPaidMonths({ paidMonths: ["2026-10"] })).toEqual({});
    expect(readPaidMonths({ paidMonths: "2026-10" })).toEqual({});
    expect(
      readPaidMonths({
        paidMonths: {
          "2026-10": { markedOn: "2026-10-30" },
          Oct: {},
          "2026-11": true,
        },
      }),
    ).toEqual({ "2026-10": { markedOn: "2026-10-30" } });
  });
});

describe("due dates: days 29, 30 and 31 clamp to the month's last day", () => {
  it("matches the clamp nextDueDate uses", () => {
    expect(dueDateIn(31, "2027-04")).toBe("2027-04-30");
    expect(dueDateIn(31, "2027-02")).toBe("2027-02-28");
    expect(dueDateIn(31, "2028-02")).toBe("2028-02-29"); // leap year
    expect(dueDateIn(30, "2027-02")).toBe("2027-02-28");
    expect(dueDateIn(29, "2027-02")).toBe("2027-02-28");
    expect(dueDateIn(29, "2028-02")).toBe("2028-02-29");
    expect(dueDateIn(31, "2026-12")).toBe("2026-12-31");
  });

  it("a window from Jan 25 to Feb 7, 2027 with due day 31 holds Jan 31 only", () => {
    const o = buildObligations({ debts: [debt("Loan", { dueDay: 31 })] });
    const owed = paymentsOwed(o, "2027-01-25", "2027-02-07");
    expect(owed.items.map((i) => [i.date, i.month])).toEqual([
      ["2027-01-31", "2027-01"],
    ]);
  });

  it("a window from Feb 20 to Mar 5, 2027 with due day 30 holds Feb 28 (month 2027-02) only", () => {
    const o = buildObligations({ debts: [debt("Loan", { dueDay: 30 })] });
    const owed = paymentsOwed(o, "2027-02-20", "2027-03-05");
    expect(owed.items.map((i) => [i.date, i.month])).toEqual([
      ["2027-02-28", "2027-02"],
    ]);
  });

  it("addDays walks the local calendar across month and year ends", () => {
    expect(addDays("2026-10-30", 13)).toBe("2026-11-12");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});

describe("Mark paid is reversible and always names its month", () => {
  it("targets this month, then next month, then nothing", () => {
    const d = debt("Car loan");
    expect(paidTarget(d, OCT30)).toBe("2026-10");
    expect(markPaidLabel(d, OCT30)).toBe("Mark paid for Oct 2026");
    const oct = markPaid(d, "2026-10", OCT30);
    expect(paidTarget(oct, OCT30)).toBe("2026-11");
    expect(markPaidLabel(oct, OCT30)).toBe("Mark paid for Nov 2026");
    const both = markPaid(oct, "2026-11", OCT30);
    expect(paidTarget(both, OCT30)).toBeNull();
    expect(markPaidLabel(both, OCT30)).toBeNull();
  });

  it("status lines show the month and the day it was marked", () => {
    const d = markPaid(debt("Car loan"), "2026-10", OCT30);
    expect(paidStatus(d)).toEqual([
      { month: "2026-10", label: "Paid for Oct 2026", markedOn: "2026-10-30" },
    ]);
  });

  it("Undo removes only that month and never changes the original record", () => {
    const original = debt("Car loan");
    const both = markPaid(
      markPaid(original, "2026-10", OCT30),
      "2026-11",
      OCT30,
    );
    const undone = undoPaid(both, "2026-10");
    expect(Object.keys(undone.paidMonths)).toEqual(["2026-11"]);
    expect(original.paidMonths).toBeUndefined();
    expect(undoPaid(original, "2026-10").paidMonths).toEqual({});
  });

  it("a payment marked at 23:30 on Oct 31 is stored under 2026-10 (local month, not UTC)", () => {
    const late = new Date(2026, 9, 31, 23, 30);
    expect(paidTarget(debt("x"), late)).toBe("2026-10");
    expect(
      markPaid(debt("x"), paidTarget(debt("x"), late), late).paidMonths[
        "2026-10"
      ].markedOn,
    ).toBe("2026-10-31");
  });

  it("marking October never marks November", () => {
    const g = buildObligations({
      debts: [markPaid(debt("Loan"), "2026-10", OCT30)],
    }).groups[0];
    expect(groupPaidFor(g, "2026-10")).toBe(true);
    expect(groupPaidFor(g, "2026-11")).toBe(false);
  });

  it("bills: Mark paid still records the expense, and Undo takes back both", () => {
    const rent = bill("Rent", 1, 1550);
    const others = [
      {
        id: "t0",
        date: "2026-10-02",
        type: "expense",
        amount: 9,
        category: "Dining",
      },
    ];
    const paid = markBillPaid(rent, others, OCT30, "tx1");
    expect(paid.month).toBe("2026-10");
    expect(paid.transactions[0]).toEqual({
      id: "tx1",
      date: "2026-10-30",
      description: "Rent",
      category: "Housing",
      type: "expense",
      amount: 1550,
    });
    expect(paid.bill.paidMonths["2026-10"]).toEqual({
      markedOn: "2026-10-30",
      txId: "tx1",
    });
    const undone = undoBillPaid(paid.bill, paid.transactions, "2026-10");
    expect(undone.transactions).toEqual(others);
    expect(undone.bill.paidMonths).toEqual({});
  });

  it("bills: Undo after the transaction was deleted by hand leaves the rest alone", () => {
    const paid = markBillPaid(bill("Rent", 1, 1550), [], OCT30, "tx1");
    const undone = undoBillPaid(paid.bill, [{ id: "other" }], "2026-10");
    expect(undone.transactions).toEqual([{ id: "other" }]);
  });
});

describe("linking: one obligation, counted once", () => {
  it("a debt plus a liability with debtId is one group, using the larger payment once", () => {
    const o = buildObligations({
      debts: [debt("Car loan", { minPayment: 340 })],
      accounts: [
        liability("Auto loan (bank)", {
          debtId: "Car loan",
          monthlyPayment: 350,
        }),
      ],
    });
    expect(o.groups).toHaveLength(1);
    expect(o.groups[0].payment).toBe(350);
    expect(o.groups[0].sources).toEqual([
      "Debt Planner",
      "Net Worth: Auto loan (bank)",
    ]);
    expect(o.suggestLinking).toBe(false);
  });

  it("without a link both count, and linking is suggested", () => {
    const o = buildObligations({
      debts: [debt("Car loan")],
      accounts: [liability("Car loan", { monthlyPayment: 350 })], // same name, still separate
    });
    expect(o.groups).toHaveLength(2);
    expect(o.suggestLinking).toBe(true);
  });

  it("a bill linked to an account that's linked to a debt forms one group", () => {
    const o = buildObligations({
      debts: [debt("Car loan")],
      accounts: [
        liability("Auto", { debtId: "Car loan", monthlyPayment: 350 }),
      ],
      bills: [
        bill("Car payment", 5, 350, {
          payFor: { type: "account", id: "Auto" },
        }),
      ],
    });
    expect(o.groups).toHaveLength(1);
    expect(o.bills).toHaveLength(0);
    expect(o.groups[0].dueDay).toBe(5); // the bill's date wins
    expect(o.groups[0].sources).toEqual([
      "Debt Planner",
      "Net Worth: Auto",
      "Bills: Car payment",
    ]);
  });

  it("a deleted or closed link target falls back to separate records", () => {
    const o = buildObligations({
      debts: [debt("Old loan", { balance: 0 })],
      accounts: [liability("Auto", { debtId: "gone", monthlyPayment: 200 })],
      bills: [
        bill("Loan bill", 5, 100, { payFor: { type: "debt", id: "Old loan" } }),
      ],
    });
    expect(o.groups.map((g) => g.key)).toEqual(["account:Auto"]);
    expect(o.bills.map((b) => b.id)).toEqual(["Loan bill"]);
    expect(o.brokenLinks.map((b) => b.id)).toEqual(["Auto", "Loan bill"]);
  });

  it("a link of the wrong type is ignored", () => {
    const o = buildObligations({
      debts: [debt("Loan")],
      bills: [bill("B", 5, 100, { payFor: { type: "goal", id: "Loan" } })],
    });
    expect(o.bills).toHaveLength(1);
    expect(o.groups[0].bills).toHaveLength(0);
  });

  it("linked bills that total more than the minimum set the group's payment", () => {
    const o = buildObligations({
      debts: [debt("Mortgage", { minPayment: 1700 })],
      bills: [
        bill("Mortgage 1st", 1, 900, {
          payFor: { type: "debt", id: "Mortgage" },
        }),
        bill("Mortgage 15th", 15, 900, {
          payFor: { type: "debt", id: "Mortgage" },
        }),
      ],
    });
    expect(o.groups[0].payment).toBe(1800);
  });

  it("a payment is unknown when no record in the group gives one", () => {
    const o = buildObligations({
      debts: [
        debt("Card", { minPayment: "" }),
        debt("Loan", { minPayment: 0 }),
      ],
      accounts: [liability("Mortgage")],
    });
    expect(o.groups.map((g) => g.payment)).toEqual([null, null, null]);
  });
});

describe("paymentsOwed: each payment subtracted once", () => {
  const start = "2026-10-30";
  const end = addDays(start, 13); // Nov 12
  // October already marked paid, so only the window's own due dates are left.
  const OCT_PAID = { paidMonths: { "2026-10": { markedOn: "2026-10-05" } } };

  it("a car loan as a debt, a liability and a bill, all linked, is owed once", () => {
    const o = buildObligations({
      debts: [debt("Car loan", { minPayment: 350, ...OCT_PAID })],
      accounts: [
        liability("Auto", { debtId: "Car loan", monthlyPayment: 350 }),
      ],
      bills: [
        bill("Car payment", 5, 350, {
          payFor: { type: "debt", id: "Car loan" },
        }),
      ],
    });
    const owed = paymentsOwed(o, start, end);
    expect(owed.items).toHaveLength(1);
    expect(owed.items[0]).toMatchObject({
      date: "2026-11-05",
      amount: 350,
      month: "2026-11",
    });
    expect(owed.total).toBe(350);
  });

  it("a linked bill isn't counted again as a bill", () => {
    const o = buildObligations({
      debts: [debt("Car loan", { dueDay: 5, ...OCT_PAID })],
      bills: [
        bill("Car payment", 5, 350, {
          payFor: { type: "debt", id: "Car loan" },
        }),
        bill("Internet", 8, 65),
      ],
    });
    const owed = paymentsOwed(o, start, end);
    expect(owed.items.map((i) => i.name)).toEqual(["Car loan", "Internet"]);
    expect(owed.total).toBe(415);
  });

  it("a group is paid when its root is marked paid, or when all its linked bills are", () => {
    const linked = (paid1, paid2) =>
      buildObligations({
        debts: [debt("Mortgage", { minPayment: 1700, ...OCT_PAID })],
        bills: [
          bill("M1", 3, 900, {
            payFor: { type: "debt", id: "Mortgage" },
            ...(paid1 && { paidMonths: { "2026-11": {} } }),
          }),
          bill("M2", 10, 900, {
            payFor: { type: "debt", id: "Mortgage" },
            ...(paid2 && { paidMonths: { "2026-11": {} } }),
          }),
        ],
      });
    expect(paymentsOwed(linked(true, false), start, end).total).toBe(1800);
    expect(paymentsOwed(linked(true, true), start, end).total).toBe(0);
    const rootPaid = linked(false, false);
    rootPaid.groups[0].debt = markPaid(
      rootPaid.groups[0].debt,
      "2026-11",
      OCT30,
    );
    expect(paymentsOwed(rootPaid, start, end).total).toBe(0);
  });

  it("a debt without a due day counts its full minimum this month until marked paid, then again next month", () => {
    const owedFor = (d, s, e) =>
      paymentsOwed(buildObligations({ debts: [d] }), s, e);
    expect(
      owedFor(debt("Card"), "2026-10-20", "2026-10-28").items.map(
        (i) => i.month,
      ),
    ).toEqual(["2026-10"]);
    const paid = markPaid(debt("Card"), "2026-10", OCT30);
    expect(owedFor(paid, "2026-10-20", "2026-10-28").items).toEqual([]);
    expect(
      owedFor(paid, "2026-11-02", "2026-11-15").items.map((i) => i.month),
    ).toEqual(["2026-11"]);
  });

  it("without a due day, a window from Oct 25 to Nov 7 owes October and November until each is marked", () => {
    const owedFor = (d) =>
      paymentsOwed(
        buildObligations({ debts: [d] }),
        "2026-10-25",
        "2026-11-07",
      );
    expect(owedFor(debt("Card")).items.map((i) => i.month)).toEqual([
      "2026-10",
      "2026-11",
    ]);
    expect(
      owedFor(markPaid(debt("Card"), "2026-10", OCT30)).items.map(
        (i) => i.month,
      ),
    ).toEqual(["2026-11"]);
  });

  it("a dated debt past its due day and not marked paid counts as overdue this month", () => {
    const o = buildObligations({ debts: [debt("Card", { dueDay: 15 })] });
    const owed = paymentsOwed(o, start, end);
    expect(owed.items.map((i) => [i.month, i.reason])).toEqual([
      ["2026-10", "overdue"],
    ]);
    const paid = buildObligations({
      debts: [markPaid(debt("Card", { dueDay: 15 }), "2026-10", OCT30)],
    });
    expect(paymentsOwed(paid, start, end).items).toEqual([]);
  });

  it("a debt with a due day after the window is not counted", () => {
    const o = buildObligations({
      debts: [markPaid(debt("Card", { dueDay: 20 }), "2026-10", OCT30)],
    });
    expect(paymentsOwed(o, start, end).items).toEqual([]);
  });

  it("ordinary bills: earlier due dates are assumed paid (as in safeToSpend); a marked month is skipped", () => {
    const o = buildObligations({
      bills: [bill("Rent", 1, 1550), bill("Gym", 20, 30)],
    });
    expect(paymentsOwed(o, start, end).items.map((i) => i.date)).toEqual([
      "2026-11-01",
    ]);
    const paidEarly = buildObligations({
      bills: [
        bill("Rent", 1, 1550, {
          paidMonths: { "2026-11": { markedOn: "2026-10-30" } },
        }),
      ],
    });
    expect(paymentsOwed(paidEarly, start, end).items).toEqual([]);
  });

  it("a transaction named exactly like the debt does not mark it paid", () => {
    const o = buildObligations({
      debts: [debt("Store card", { minPayment: 35 })],
    });
    // paymentsOwed never sees transactions at all; this pins that contract.
    // Undated, so both months the window touches count: $35 for Oct and $35 for Nov.
    expect(paymentsOwed(o, start, end).total).toBe(70);
  });

  it("unknown amounts are listed, never added to the total", () => {
    const o = buildObligations({
      debts: [debt("Card", { minPayment: 50 })],
      accounts: [liability("Mortgage")],
    });
    const owed = paymentsOwed(o, start, end);
    expect(owed.total).toBe(100); // Card for Oct + Nov (undated)
    expect(owed.unknown).toEqual(["Mortgage"]);
  });
});
