// Obligations: one real-world required payment, which can show up as a Debt Planner debt,
// a Net Worth liability and a bill at the same time. Pure functions, so every rule is
// unit-tested. Used by health.js for Debt load, the spendable estimate and the runway.
//
// Optional fields (older records and backups have none of them, and nothing here writes
// them back; missing or invalid always reads as "unknown", never as a value):
//   dueDay on debts, liabilities, bills   1-31; 29-31 fall on the last day of short months
//   account.monthlyPayment                a liability's required monthly payment
//   account.debtId                        "this liability is the same as that debt"
//   bill.payFor = { type, id }            "this bill pays that debt / liability"
//   paidMonths = { "2026-10": { markedOn: "2026-10-30", txId? } }   explicit "Mark paid"
// Records are linked ONLY by these ids. Names are never compared.

import { monthKey, toISODate, parseDate, monthLabel } from "./format";
import { addMonths } from "./budgeting";
import { readAccounts } from "./netWorth";

const round2 = (n) => Math.round(n * 100) / 100;
const isMonth = (k) => typeof k === "string" && /^\d{4}-\d{2}$/.test(k);
const asObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

// ---------- Reading the optional fields ----------

/** 1-31 as a whole number, or null ("" / 0 / 32 / 2.5 / "abc" / undefined). */
export function readDueDay(value) {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

/** A money amount above 0, or null. Debt rows can hold "" while being edited. */
export function readPayment(value) {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

/** Only well-formed months survive; an array, null or a bad key reads as "not paid". */
export function readPaidMonths(record) {
  return Object.fromEntries(
    Object.entries(asObject(record?.paidMonths)).filter(
      ([k, v]) => isMonth(k) && v && typeof v === "object",
    ),
  );
}

export const isPaidFor = (record, month) =>
  Boolean(readPaidMonths(record)[month]);

/** The due date in `month` ("YYYY-MM"): the due day, or the month's last day if earlier. */
export function dueDateIn(dueDay, month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
  return toISODate(new Date(y, m - 1, Math.min(dueDay, last)));
}

// ---------- Mark paid (reversible, always for a named month) ----------

/**
 * The month "Mark paid" applies to: this month, or next month once this one is marked
 * (a payment made early). null when both are already marked.
 */
export function paidTarget(record, today = new Date()) {
  const month = monthKey(today);
  const next = addMonths(month, 1);
  if (!isPaidFor(record, month)) return month;
  return isPaidFor(record, next) ? null : next;
}

/** Button text that always names its month: "Mark paid for Oct 2026" (null: nothing to mark). */
export function markPaidLabel(record, today = new Date()) {
  const month = paidTarget(record, today);
  return month ? `Mark paid for ${monthLabel(month, true)}` : null;
}

/** Marked months, oldest first, for the status lines: [{ month, label, markedOn }]. */
export function paidStatus(record) {
  return Object.entries(readPaidMonths(record))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      label: `Paid for ${monthLabel(month, true)}`,
      markedOn: v.markedOn ?? null,
    }));
}

/** A copy of the record with `month` marked paid. The original is never changed. */
export function markPaid(record, month, today = new Date(), extra = {}) {
  return {
    ...record,
    paidMonths: {
      ...readPaidMonths(record),
      [month]: { markedOn: toISODate(today), ...extra },
    },
  };
}

/** Undo: a copy without that one month. Other months stay marked. */
export function undoPaid(record, month) {
  const { [month]: _removed, ...rest } = readPaidMonths(record); // _removed: dropped on purpose
  return { ...record, paidMonths: rest };
}

/**
 * Bills page "Mark paid": still records the expense transaction dated today (as before),
 * and now also the month it paid plus the transaction's id, so Undo can take both back.
 */
export function markBillPaid(bill, transactions, today = new Date(), id) {
  const month = paidTarget(bill, today);
  if (!month) return { bill, transactions, month: null };
  const tx = {
    id,
    date: toISODate(today),
    description: bill.name,
    category: bill.category,
    type: "expense",
    amount: Number(bill.amount),
  };
  return {
    bill: markPaid(bill, month, today, { txId: id }),
    transactions: [tx, ...transactions],
    month,
  };
}

/** Undo for a bill: drops the month and the transaction Mark paid created, if it's still there. */
export function undoBillPaid(bill, transactions, month) {
  const txId = readPaidMonths(bill)[month]?.txId;
  return {
    bill: undoPaid(bill, month),
    transactions: txId
      ? transactions.filter((t) => t.id !== txId)
      : transactions,
  };
}

// ---------- Grouping linked records ----------

const isOpenDebt = (d) => d && d.id != null && Number(d.balance) > 0;
const isOpenLiability = (a) =>
  a.type === "liability" && a.id != null && Number(a.balance) > 0;

/**
 * Links -> obligation groups. Follows ids only: bill -> account -> debt (debts have no
 * link field, so links can't loop). A closed (balance 0) or deleted target is ignored and
 * the record counts on its own; `brokenLinks` lets the edit forms say so.
 *
 * Returns {
 *   groups: [{ key, name, root, debt, accounts, bills, payment, dueDay, sources }],
 *   bills:  bills not linked to any group (counted as ordinary bills),
 *   brokenLinks: [{ type, id, name }],
 *   suggestLinking: debts and liabilities both exist and none are linked
 * }
 * payment = the largest known amount in the group (debt minimum, liability monthlyPayment,
 * total of linked bills), counted once; null when none is known.
 */
export function buildObligations({ debts = [], accounts = [], bills = [] }) {
  const openDebts = (Array.isArray(debts) ? debts : []).filter(isOpenDebt);
  const liabilities = readAccounts(accounts).filter(isOpenLiability);
  const debtById = new Map(openDebts.map((d) => [String(d.id), d]));
  const groups = new Map();
  const brokenLinks = [];

  const groupFor = (key, name, root) => {
    if (!groups.has(key))
      groups.set(key, { key, name, root, debt: null, accounts: [], bills: [] });
    return groups.get(key);
  };
  for (const d of openDebts)
    groupFor(`debt:${d.id}`, d.name, { type: "debt", id: d.id }).debt = d;

  const accountKey = new Map(); // account id -> its group's key
  for (const a of liabilities) {
    const linked = a.debtId != null ? debtById.get(String(a.debtId)) : null;
    if (a.debtId != null && !linked)
      brokenLinks.push({ type: "account", id: a.id, name: a.name });
    const key = linked ? `debt:${linked.id}` : `account:${a.id}`;
    groupFor(key, a.name, { type: "account", id: a.id }).accounts.push(a);
    accountKey.set(String(a.id), key);
  }

  const plainBills = [];
  for (const b of Array.isArray(bills) ? bills : []) {
    const link = b?.payFor;
    let key = null;
    if (link?.type === "debt" && debtById.has(String(link.id)))
      key = `debt:${link.id}`;
    else if (link?.type === "account") key = accountKey.get(String(link.id));
    if (key) groups.get(key).bills.push(b);
    else {
      if (link) brokenLinks.push({ type: "bill", id: b.id, name: b.name });
      plainBills.push(b);
    }
  }

  const list = [...groups.values()].map((g) => {
    const billTotal = round2(
      g.bills.reduce((t, b) => t + (readPayment(b.amount) ?? 0), 0),
    );
    const known = [
      readPayment(g.debt?.minPayment),
      ...g.accounts.map((a) => readPayment(a.monthlyPayment)),
      billTotal > 0 ? billTotal : null,
    ].filter((n) => n !== null);
    const firstBillDay = g.bills.map((b) => readDueDay(b.dueDay)).find(Boolean);
    const ownDay = [g.debt, ...g.accounts]
      .map((r) => readDueDay(r?.dueDay))
      .find(Boolean);
    return {
      ...g,
      payment: known.length ? Math.max(...known) : null,
      dueDay: g.bills.length ? (firstBillDay ?? null) : (ownDay ?? null),
      sources: [
        ...(g.debt ? ["Debt Planner"] : []),
        ...g.accounts.map((a) => `Net Worth: ${a.name}`),
        ...g.bills.map((b) => `Bills: ${b.name}`),
      ],
    };
  });

  return {
    groups: list,
    bills: plainBills,
    brokenLinks,
    suggestLinking:
      openDebts.length > 0 &&
      liabilities.length > 0 &&
      !liabilities.some((a) => debtById.has(String(a.debtId))),
  };
}

/** The record holding a group's "Mark paid": its debt, or its first liability. */
const rootRecord = (g) => g.debt ?? g.accounts[0];

/** Paid when the root is marked paid for that month, or every linked bill is. */
export const groupPaidFor = (g, month) =>
  isPaidFor(rootRecord(g), month) ||
  (g.bills.length > 0 && g.bills.every((b) => isPaidFor(b, month)));

// ---------- Payments owed in a window ----------

/** Every "YYYY-MM" from the month of `start` to the month of `end` (ISO dates). */
function monthsBetween(start, end) {
  const months = [];
  for (let k = start.slice(0, 7); k <= end.slice(0, 7); k = addMonths(k, 1))
    months.push(k);
  return months;
}

/**
 * Payments owed from `start` to `end` (inclusive "YYYY-MM-DD"), each obligation once:
 * - a dated group: each month whose due date is in the window, plus this month when its
 *   due date already passed and it isn't marked paid ("overdue")
 * - an undated group: every calendar month the window touches (the conservative estimate)
 * - an ordinary bill: each due date in the window (earlier ones are assumed paid, as in
 *   safeToSpend), unless that month is marked paid
 * A month marked paid never counts. Unknown amounts go to `unknown`, never into `total`.
 *
 * Returns { items: [{ key, name, kind, month, date, amount, reason, sources }], total, unknown }
 */
export function paymentsOwed({ groups, bills }, start, end) {
  const months = monthsBetween(start, end);
  const items = [];

  for (const g of groups) {
    const base = { key: g.key, name: g.name, kind: "debt", sources: g.sources };
    for (const month of months) {
      if (groupPaidFor(g, month)) continue;
      if (g.dueDay === null) {
        items.push({
          ...base,
          month,
          date: null,
          amount: g.payment,
          reason: "undated",
        });
        continue;
      }
      const date = dueDateIn(g.dueDay, month);
      if (date >= start && date <= end)
        items.push({ ...base, month, date, amount: g.payment, reason: "due" });
      else if (date < start && month === start.slice(0, 7))
        items.push({
          ...base,
          month,
          date,
          amount: g.payment,
          reason: "overdue",
        });
    }
  }

  for (const b of bills) {
    const day = readDueDay(b.dueDay);
    if (day === null) continue;
    for (const month of months) {
      const date = dueDateIn(day, month);
      if (date < start || date > end || isPaidFor(b, month)) continue;
      items.push({
        key: `bill:${b.id}`,
        name: b.name,
        kind: "bill",
        month,
        date,
        amount: readPayment(b.amount),
        reason: "due",
        sources: [`Bills: ${b.name}`],
      });
    }
  }

  items.sort((a, b) => (a.date ?? a.month).localeCompare(b.date ?? b.month));
  const known = items.filter((i) => i.amount !== null);
  const unknownNames = [
    ...new Set(items.filter((i) => i.amount === null).map((i) => i.name)),
  ];
  return {
    items,
    total: round2(known.reduce((t, i) => t + i.amount, 0)),
    unknown: unknownNames,
  };
}

/** Today + n days as "YYYY-MM-DD" (local calendar, so DST never shifts a day). */
export const addDays = (iso, n) => {
  const d = parseDate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
