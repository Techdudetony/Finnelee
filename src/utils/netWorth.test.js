import { describe, expect, it } from "vitest";
import {
  changeSinceLastSnapshot,
  historySeries,
  isStale,
  kindLabel,
  liquidSavings,
  netWorthTotals,
  newAccount,
  readAccounts,
  readHistory,
  recordSnapshot,
  savingsBalance,
  updateBalance,
} from "./netWorth";

const OCT = new Date(2026, 9, 29);
const DEC = new Date(2026, 11, 31);
const JAN = new Date(2027, 0, 1);

const acct = (name, type, kind, balance) => ({
  id: name,
  name,
  type,
  kind,
  balance,
  updated: "2026-10-01",
  source: "manual",
});
const ACCOUNTS = [
  acct("Checking", "asset", "cash", 2500),
  acct("Ally", "asset", "savings", 6200.5),
  acct("IRA", "asset", "retirement", 18400),
  acct("Car", "asset", "vehicle", 14000), // market value; its loan is in the Debt Planner
  acct("Home loan", "liability", "mortgage", 9000),
];
const DEBTS = [
  { id: "d1", name: "Car loan", balance: 11000, apr: 6.9, minPayment: 320 },
  { id: "d2", name: "Visa", balance: 1900.25, apr: 24.9, minPayment: 60 },
];

describe("accounts", () => {
  it("builds a manual account, or explains what is missing", () => {
    const { account } = newAccount(
      { name: "  Ally ", type: "asset", kind: "savings", balance: "6200.5" },
      "2026-10-29",
    );
    expect(account).toMatchObject({
      name: "Ally",
      type: "asset",
      kind: "savings",
      balance: 6200.5,
      updated: "2026-10-29",
      source: "manual",
    });
    expect(account.id).toBeTruthy();
    expect(
      newAccount({ name: "", type: "asset", kind: "cash", balance: "1" }).error,
    ).toMatch(/name/);
    expect(
      newAccount({ name: "X", type: "liability", kind: "credit", balance: "1" })
        .error,
    ).toMatch(/kind/); // cards belong in Debt Planner
    expect(
      newAccount({ name: "X", type: "asset", kind: "cash", balance: "" }).error,
    ).toMatch(/balance/);
    expect(
      newAccount({ name: "X", type: "asset", kind: "cash", balance: "-5" })
        .error,
    ).toMatch(/balance/);
  });

  it("stamps the update date when a balance changes", () => {
    const next = updateBalance(ACCOUNTS, "Ally", "7000", "2026-10-29");
    expect(next.find((a) => a.id === "Ally")).toMatchObject({
      balance: 7000,
      updated: "2026-10-29",
    });
    expect(next.find((a) => a.id === "IRA").updated).toBe("2026-10-01");
  });

  it("flags balances not updated for 60+ days", () => {
    expect(isStale({ updated: "2026-08-30" }, OCT)).toBe(true);
    expect(isStale({ updated: "2026-09-01" }, OCT)).toBe(false);
    expect(isStale({}, OCT)).toBe(true);
  });

  it("reads older backups and corrupt data as an empty list", () => {
    expect(readAccounts(undefined)).toEqual([]);
    expect(readAccounts("oops")).toEqual([]);
    expect(readAccounts([null, { type: "weird" }, ACCOUNTS[0]])).toEqual([
      ACCOUNTS[0],
    ]);
  });

  it("labels kinds", () => {
    expect(kindLabel("asset", "vehicle")).toBe("Vehicle");
    expect(kindLabel("liability", "nope")).toBe("Other");
  });
});

describe("netWorthTotals", () => {
  it("adds Debt Planner debts to liabilities automatically", () => {
    expect(netWorthTotals(ACCOUNTS, DEBTS)).toEqual({
      assets: 41100.5,
      accountLiabilities: 9000,
      debtLiabilities: 12900.25,
      liabilities: 21900.25,
      netWorth: 19200.25,
    });
  });

  it("follows Debt Planner balances live", () => {
    const paidDown = DEBTS.map((d) =>
      d.id === "d1" ? { ...d, balance: 10500 } : d,
    );
    expect(netWorthTotals(ACCOUNTS, paidDown).netWorth).toBe(19700.25);
  });

  it("can be negative", () => {
    const totals = netWorthTotals(
      [acct("Checking", "asset", "cash", 800)],
      [{ balance: 25000 }],
    );
    expect(totals.netWorth).toBe(-24200);
  });

  it("treats missing or blank balances as 0", () => {
    expect(
      netWorthTotals([{ ...ACCOUNTS[0], balance: "" }], undefined).netWorth,
    ).toBe(0);
    expect(netWorthTotals(undefined, []).netWorth).toBe(0);
  });
});

describe("monthly snapshots", () => {
  it("records the current month only", () => {
    const settings = { annualReturn: 5 };
    const out = recordSnapshot(settings, ACCOUNTS, DEBTS, OCT);
    expect(out.netWorthHistory).toEqual({
      "2026-10": { assets: 41100.5, liabilities: 21900.25 },
    });
    expect(out.annualReturn).toBe(5);
  });

  it("is idempotent: same totals give back the same object", () => {
    const once = recordSnapshot({}, ACCOUNTS, DEBTS, OCT);
    expect(recordSnapshot(once, ACCOUNTS, DEBTS, OCT)).toBe(once);
  });

  it("updates this month but never overwrites an earlier one", () => {
    const sep = {
      netWorthHistory: { "2026-09": { assets: 100, liabilities: 50 } },
    };
    const out = recordSnapshot(sep, ACCOUNTS, DEBTS, OCT);
    expect(out.netWorthHistory["2026-09"]).toEqual({
      assets: 100,
      liabilities: 50,
    });
    const later = recordSnapshot(
      out,
      updateBalance(ACCOUNTS, "Ally", "9000"),
      DEBTS,
      OCT,
    );
    expect(later.netWorthHistory["2026-09"]).toEqual({
      assets: 100,
      liabilities: 50,
    });
    expect(later.netWorthHistory["2026-10"].assets).toBe(43900);
  });

  it("starts a new month across a year change and keeps December", () => {
    const dec = recordSnapshot({}, ACCOUNTS, DEBTS, DEC);
    const jan = recordSnapshot(dec, ACCOUNTS, [], JAN);
    expect(Object.keys(jan.netWorthHistory)).toEqual(["2026-12", "2027-01"]);
    expect(jan.netWorthHistory["2026-12"].liabilities).toBe(21900.25);
    expect(jan.netWorthHistory["2027-01"].liabilities).toBe(9000);
    expect(changeSinceLastSnapshot(jan, 32100.5, JAN)).toEqual({
      amount: 12900.25,
      since: "Dec 2026",
    });
  });

  it("records nothing while there are no accounts", () => {
    const settings = {};
    expect(recordSnapshot(settings, [], DEBTS, OCT)).toBe(settings);
    expect(recordSnapshot(settings, undefined, DEBTS, OCT)).toBe(settings);
  });

  it("records a negative net worth", () => {
    const out = recordSnapshot(
      {},
      [acct("Checking", "asset", "cash", 800)],
      [{ balance: 25000 }],
      OCT,
    );
    expect(historySeries(out)).toEqual([
      {
        month: "2026-10",
        label: "Oct 2026",
        assets: 800,
        liabilities: 25000,
        netWorth: -24200,
      },
    ]);
  });

  it("ignores missing or broken history from older backups", () => {
    expect(readHistory(undefined)).toEqual({});
    expect(readHistory({ netWorthHistory: [] })).toEqual({});
    expect(
      readHistory({
        netWorthHistory: {
          "2026-09": { assets: 1 },
          x: { assets: 1, liabilities: 1 },
        },
      }),
    ).toEqual({});
  });

  it("has no change to show without an earlier snapshot", () => {
    const out = recordSnapshot({}, ACCOUNTS, DEBTS, OCT);
    expect(changeSinceLastSnapshot(out, 19200.25, OCT)).toBe(null);
  });
});

describe("savings source", () => {
  const manual = { startingSavings: 3800 };

  it("uses the typed amount by default, even when accounts exist", () => {
    expect(savingsBalance(manual, ACCOUNTS)).toEqual({
      amount: 3800,
      source: "manual",
      fellBack: false,
    });
    expect(savingsBalance({}, [])).toEqual({
      amount: 0,
      source: "manual",
      fellBack: false,
    });
  });

  it("uses cash + savings accounts only when chosen", () => {
    expect(liquidSavings(ACCOUNTS)).toEqual({ amount: 8700.5, count: 2 });
    expect(
      savingsBalance({ ...manual, savingsSource: "accounts" }, ACCOUNTS),
    ).toEqual({
      amount: 8700.5,
      source: "accounts",
      fellBack: false,
    });
  });

  it("falls back to the typed amount when the chosen accounts are gone", () => {
    const noLiquid = ACCOUNTS.filter(
      (a) => !["cash", "savings"].includes(a.kind),
    );
    expect(
      savingsBalance({ ...manual, savingsSource: "accounts" }, noLiquid),
    ).toEqual({
      amount: 3800,
      source: "manual",
      fellBack: true,
    });
  });
});
