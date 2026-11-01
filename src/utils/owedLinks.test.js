import { describe, expect, it } from "vitest";
import { buildObligations, paymentsOwed } from "./obligations";
import { owedPage, undatedPayments, unknownPayments } from "./owedLinks";

const owed = (data, start = "2026-11-02", end = "2026-11-15") =>
  paymentsOwed(
    buildObligations({ debts: [], accounts: [], bills: [], ...data }),
    start,
    end,
  ).items;

describe("owedPage", () => {
  it("goes by the record key, never the name", () => {
    expect(owedPage({ key: "debt:1", name: "Bills" })).toBe("debt");
    expect(owedPage({ key: "account:1", name: "Debt Planner" })).toBe(
      "networth",
    );
    expect(owedPage({ key: "bill:1", name: "Car loan" })).toBe("bills");
    // A linked bill's amount and due day are entered on Bills.
    expect(owedPage({ key: "debt:1", name: "Car loan", bill: "Car" })).toBe(
      "bills",
    );
  });
});

describe("unknownPayments", () => {
  it("keeps a debt and a liability with the same name apart", () => {
    const items = owed({
      debts: [{ id: "d1", name: "Car loan", balance: 9000, minPayment: "" }],
      accounts: [
        { id: "a1", name: "Car loan", type: "liability", balance: 5000 },
      ],
    });
    expect(unknownPayments(items)).toEqual([
      { id: "debt:d1|", name: "Car loan", page: "debt" },
      { id: "account:a1|", name: "Car loan", page: "networth" },
    ]);
  });

  it("lists a record owed in two months once", () => {
    const items = owed(
      { debts: [{ id: "d1", name: "Loan", balance: 900 }] },
      "2026-11-25",
      "2026-12-08",
    );
    expect(unknownPayments(items)).toHaveLength(1);
  });
});

describe("undatedPayments", () => {
  it("finds a known debt minimum with no due day", () => {
    const items = owed({
      debts: [
        { id: "d1", name: "Car loan", balance: 9000, minPayment: 400 },
        {
          id: "d2",
          name: "Card",
          balance: 900,
          minPayment: 35,
          dueDay: 10,
        },
      ],
    });
    expect(undatedPayments(items)).toEqual([
      {
        id: "debt:d1|",
        name: "Car loan",
        page: "debt",
        amount: 400,
        months: 1,
      },
    ]);
  });

  it("sums it over each month the window touches", () => {
    const items = owed(
      { debts: [{ id: "d1", name: "Loan", balance: 900, minPayment: 50 }] },
      "2026-11-25",
      "2026-12-08",
    );
    expect(undatedPayments(items)).toMatchObject([{ amount: 100, months: 2 }]);
  });

  it("leaves out unknown amounts and plain bills", () => {
    const items = owed({
      debts: [{ id: "d1", name: "Loan", balance: 900 }],
      bills: [{ id: "b1", name: "Gym", amount: 30 }],
    });
    expect(undatedPayments(items)).toEqual([]);
  });
});
