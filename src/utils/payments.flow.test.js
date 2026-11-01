// Integration tests: the Bills Mark paid / Undo flow and the payment-detail forms, run
// against a small store that behaves like React state (updates queue until commit, and
// each updater runs twice, as React does in development) plus localStorage reloads.
import { describe, expect, it } from "vitest";
import {
  createClickGuard,
  dueDayProblem,
  paymentProblem,
  planBillPaid,
  planBillUndo,
  readScheduleForm,
  setBillLink,
  setDebtLink,
  setOptional,
} from "./payments";
import { buildObligations, paymentsOwed } from "./obligations";
import { debtPillar, paydays, readPaySchedule } from "./health";

const OCT_30 = new Date(2026, 9, 30);

/** React-like state: setX(fn) queues; commit() applies each fn twice and keeps one result. */
function createStore(initial) {
  const state = structuredClone(initial);
  const queue = [];
  const set = (key) => (fn) => queue.push([key, fn]);
  return {
    state,
    setBills: set("bills"),
    setTransactions: set("transactions"),
    commit() {
      for (const [key, fn] of queue.splice(0)) {
        fn(state[key]); // StrictMode's extra call: must not change anything
        state[key] = fn(state[key]);
      }
    },
    /** Saved to localStorage and read back, as on a page reload. */
    reload() {
      return JSON.parse(JSON.stringify(state));
    },
  };
}

/** The Bills page handlers, as written in Bills.jsx, reading from the last render. */
function billsPage(store) {
  const guard = createClickGuard();
  let ids = 0;
  let rendered = structuredClone(store.state); // what's on screen
  return {
    markPaid(id, month) {
      const plan = planBillPaid(
        rendered.bills,
        id,
        month,
        OCT_30,
        `tx${++ids}`,
      );
      if (!plan || !guard.start(id)) return;
      store.setBills(plan.bills);
      store.setTransactions(plan.transactions);
    },
    undo(id, month) {
      const plan = planBillUndo(
        rendered.bills,
        store.state.transactions,
        id,
        month,
      );
      if (!plan || !guard.start(id)) return null;
      store.setTransactions(plan.transactions);
      store.setBills(plan.bills);
      return plan;
    },
    /** React commits, re-renders, and the effect releases the guard. */
    render() {
      store.commit();
      rendered = structuredClone(store.state);
      guard.release();
    },
  };
}

const rent = {
  id: "rent",
  name: "Rent",
  amount: 1550,
  dueDay: 1,
  category: "Housing",
};
const other = {
  id: "t-old",
  date: "2026-10-02",
  description: "Groceries",
  category: "Food",
  type: "expense",
  amount: 80,
};

describe("Bills Mark paid and Undo", () => {
  it("rapid repeated Mark paid records one payment", () => {
    const store = createStore({ bills: [rent], transactions: [other] });
    const page = billsPage(store);
    page.markPaid("rent", "2026-10");
    page.markPaid("rent", "2026-10"); // second click before React commits
    page.markPaid("rent", "2026-10");
    page.render();
    page.markPaid("rent", "2026-10"); // after commit: Oct is already marked
    page.render();
    const payments = store.state.transactions.filter(
      (t) => t.description === "Rent",
    );
    expect(payments).toHaveLength(1);
    expect(Object.keys(store.state.bills[0].paidMonths)).toEqual(["2026-10"]);
    expect(store.state.bills[0].paidMonths["2026-10"].txId).toBe(
      payments[0].id,
    );
  });

  it("Undo after unrelated transactions are added removes only the generated one", () => {
    const store = createStore({ bills: [rent], transactions: [other] });
    const page = billsPage(store);
    page.markPaid("rent", "2026-10");
    page.render();
    // Added on another page (and an older one edited) after Mark paid.
    const added = {
      id: "t-new",
      date: "2026-10-30",
      description: "Rent",
      category: "Housing",
      type: "expense",
      amount: 1550,
    };
    store.state.transactions = [
      added,
      ...store.state.transactions.map((t) =>
        t.id === "t-old" ? { ...t, amount: 81 } : t,
      ),
    ];
    page.render();
    page.undo("rent", "2026-10");
    page.render();
    expect(store.state.transactions.map((t) => t.id)).toEqual([
      "t-new",
      "t-old",
    ]);
    expect(store.state.transactions[1].amount).toBe(81); // the edit is kept
    expect(store.state.bills[0].paidMonths).toEqual({});
  });

  it("Undo after the generated transaction is edited keeps it and says so", () => {
    const store = createStore({ bills: [rent], transactions: [other] });
    const page = billsPage(store);
    page.markPaid("rent", "2026-10");
    page.render();
    const id = store.state.bills[0].paidMonths["2026-10"].txId;
    store.state.transactions = store.state.transactions.map((t) =>
      t.id === id ? { ...t, amount: 1600 } : t,
    );
    page.render();
    const plan = page.undo("rent", "2026-10");
    page.render();
    expect(plan.kept).toBe(true);
    expect(store.state.transactions.find((t) => t.id === id).amount).toBe(1600);
    expect(store.state.bills[0].paidMonths).toEqual({});
  });

  it("double-clicked Undo removes the month and transaction once", () => {
    const store = createStore({ bills: [rent], transactions: [other] });
    const page = billsPage(store);
    page.markPaid("rent", "2026-10");
    page.render();
    page.undo("rent", "2026-10");
    expect(page.undo("rent", "2026-10")).toBeNull(); // ignored until saved
    page.render();
    expect(page.undo("rent", "2026-10")).toBeNull(); // nothing left to undo
    expect(store.state.transactions).toEqual([other]);
  });

  it("Mark paid survives a reload with the transaction link intact", () => {
    const store = createStore({ bills: [rent], transactions: [] });
    const page = billsPage(store);
    page.markPaid("rent", "2026-10");
    page.render();
    const saved = store.reload();
    expect(saved.bills[0].paidMonths["2026-10"].txId).toBe(
      saved.transactions[0].id,
    );
  });
});

describe("invalid optional fields are never saved", () => {
  // OptionalNumber: valid text (or a blank) is saved, anything else stays on screen only.
  const type = (record, field, text, problemOf) =>
    problemOf(text) ? record : setOptional(record, field, text);

  it("keeps the last valid value through a reload", () => {
    let debt = { id: "d", name: "Car loan", balance: 9000, minPayment: 260 };
    debt = type(debt, "dueDay", "5", dueDayProblem);
    for (const bad of ["0", "32", "2.5"])
      debt = type(debt, "dueDay", bad, dueDayProblem);
    let account = {
      id: "m",
      type: "liability",
      name: "Mortgage",
      balance: 1000,
    };
    account = type(account, "monthlyPayment", "0", paymentProblem);
    account = type(account, "monthlyPayment", "-3", paymentProblem);
    const saved = JSON.parse(JSON.stringify({ debt, account }));
    expect(saved.debt.dueDay).toBe(5);
    expect("monthlyPayment" in saved.account).toBe(false); // still unknown, not 0
  });

  it("a blank box removes the field instead of saving 0", () => {
    const debt = type({ id: "d", dueDay: 5 }, "dueDay", "", dueDayProblem);
    expect(JSON.parse(JSON.stringify(debt))).toEqual({ id: "d" });
  });
});

describe("bill -> liability -> debt linking", () => {
  const debts = [
    { id: "car", name: "Car loan", balance: 9000, apr: 6.5, minPayment: 350 },
  ];
  const accounts = [
    setDebtLink(
      {
        id: "bank",
        type: "liability",
        kind: "other",
        name: "Car loan (bank)",
        balance: 9000,
        monthlyPayment: 350,
      },
      "car",
    ),
  ];
  const bills = [
    setBillLink(
      {
        id: "pay",
        name: "Car payment",
        amount: 350,
        dueDay: 5,
        category: "Transport",
      },
      "account:bank",
    ),
  ];

  it("forms one obligation and counts $350 once in a payment window", () => {
    const ob = buildObligations({ debts, accounts, bills });
    expect(ob.groups).toHaveLength(1);
    expect(ob.groups[0].payment).toBe(350);
    expect(ob.bills).toEqual([]); // the bill isn't counted again on its own
    expect(paymentsOwed(ob, "2026-11-01", "2026-11-14").total).toBe(350);
  });

  it("Debt load reads $350 a month, not $700 or $1,050", () => {
    const income = ["2026-07", "2026-08", "2026-09"].flatMap((m) => [
      {
        id: `${m}i`,
        date: `${m}-01`,
        type: "income",
        amount: 3500,
        category: "Salary",
      },
      {
        id: `${m}e`,
        date: `${m}-02`,
        type: "expense",
        amount: 100,
        category: "Food",
      },
    ]);
    const pillar = debtPillar(
      { transactions: income, debts, accounts, bills, settings: {} },
      OCT_30,
    );
    expect(pillar.value).toBeCloseTo(0.1); // 350 / 3,500
  });
});

describe("pay schedules across short months, leap years and year boundaries", () => {
  const save = (form) =>
    readPaySchedule({ paySchedule: readScheduleForm(form).schedule });

  it("twice a month on the 15th and 31st: 31 lands on the month's last day", () => {
    const s = save({
      cadence: "twice-monthly",
      next: "2027-01-15",
      day1: "15",
      day2: "31",
      amount: "",
    });
    expect(paydays(s, "2027-01-01", "2027-03-31")).toEqual([
      "2027-01-15",
      "2027-01-31",
      "2027-02-15",
      "2027-02-28",
      "2027-03-15",
      "2027-03-31",
    ]);
    expect(paydays(s, "2028-02-01", "2028-02-29")).toEqual([
      "2028-02-15",
      "2028-02-29",
    ]); // leap year
  });

  it("monthly on the 31st crosses the year boundary and short months", () => {
    const s = save({ cadence: "monthly", next: "2026-12-31", amount: "2100" });
    expect(paydays(s, "2026-12-01", "2027-04-30")).toEqual([
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("every 2 weeks keeps its rhythm across New Year and Feb 29", () => {
    const s = save({ cadence: "biweekly", next: "2027-12-24", amount: "" });
    expect(paydays(s, "2027-12-20", "2028-01-25")).toEqual([
      "2027-12-24",
      "2028-01-07",
      "2028-01-21",
    ]);
    const leap = save({ cadence: "biweekly", next: "2028-02-15", amount: "" });
    expect(paydays(leap, "2028-02-15", "2028-03-15")).toEqual([
      "2028-02-15",
      "2028-02-29",
      "2028-03-14",
    ]);
  });

  it("accepts Feb 28 as the next payday for a day-30 schedule, but not Feb 27", () => {
    const form = {
      cadence: "twice-monthly",
      day1: "15",
      day2: "30",
      amount: "",
    };
    expect(
      readScheduleForm({ ...form, next: "2027-02-28" }).schedule,
    ).toBeTruthy();
    expect(
      readScheduleForm({ ...form, next: "2027-02-27" }).error,
    ).toBeTruthy();
    expect(
      readScheduleForm({ ...form, next: "2028-02-29" }).schedule,
    ).toBeTruthy(); // leap
  });
});
