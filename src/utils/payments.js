// Helpers for the forms that edit payment details: Mark paid status lines, links between
// records, optional number fields and the pay schedule. Pure, so every rule is tested.
// The rules themselves (what counts as paid, linked or due) live in obligations.js and
// health.js; this file only turns form input into those fields and back.

import { addMonths } from "./budgeting";
import { monthKey, monthLabel, parseDate, toISODate } from "./format";
import {
  dueDateIn,
  readDueDay,
  readPaidMonths,
  readPayment,
} from "./obligations";
import { paydays, readPaySchedule } from "./health";
import { readAccounts } from "./netWorth";

const shortDate = (iso) =>
  parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

/**
 * Paid months worth showing, oldest first: last month, this month and next month.
 * Older marks stay stored (and in backups) but aren't listed, so rows stay short.
 * Each: { month, monthText: "Oct 2026", text: "Paid for Oct 2026 (marked Oct 30)" }.
 */
export function recentPaidStatus(record, today = new Date()) {
  const from = addMonths(monthKey(today), -1);
  const to = addMonths(monthKey(today), 1);
  return Object.entries(readPaidMonths(record))
    .filter(([month]) => month >= from && month <= to)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => {
      const monthText = monthLabel(month, true);
      const marked =
        typeof v.markedOn === "string"
          ? ` (marked ${shortDate(v.markedOn)})`
          : "";
      return { month, monthText, text: `Paid for ${monthText}${marked}` };
    });
}

// ---------- Optional number fields (due day, monthly payment) ----------

/**
 * A copy of the record with `field` set from a form value. A blank box removes the field
 * (back to "unknown"), so an empty input is never saved as 0.
 */
export function setOptional(record, field, value) {
  const { [field]: _old, ...rest } = record; // _old: replaced on purpose
  if (value === "" || value == null) return rest;
  return { ...rest, [field]: Number(value) };
}

/** The message under a due day box, or null when it's blank or valid. */
export const dueDayProblem = (value) =>
  value === "" || value == null || readDueDay(value)
    ? null
    : "Use a whole day from 1 to 31.";

/** The message under a payment box, or null when it's blank or valid. */
export const paymentProblem = (value) =>
  value === "" || value == null || readPayment(value)
    ? null
    : "Use an amount above 0, or leave it blank.";

// ---------- Links between records (ids only, never names) ----------

const isOpen = (r) => r && r.id != null && Number(r.balance) > 0;

/** Debts a liability can be "the same as": open Debt Planner debts. */
export const debtOptions = (debts) =>
  (Array.isArray(debts) ? debts : [])
    .filter(isOpen)
    .map((d) => ({ value: String(d.id), label: d.name }));

/** What a bill can pay: open debts and open Net Worth liabilities, labeled by page. */
export function billLinkOptions(debts, accounts) {
  return [
    ...debtOptions(debts).map((o) => ({
      value: `debt:${o.value}`,
      label: `${o.label} (Debt Planner)`,
    })),
    ...readAccounts(accounts)
      .filter((a) => a.type === "liability" && isOpen(a))
      .map((a) => ({
        value: `account:${a.id}`,
        label: `${a.name} (Net Worth)`,
      })),
  ];
}

/** bill.payFor -> the select's value ("" when not linked). */
export const linkValue = (payFor) =>
  payFor && (payFor.type === "debt" || payFor.type === "account")
    ? `${payFor.type}:${payFor.id}`
    : "";

/** A copy of the bill linked to the select's value, or unlinked for "". */
export function setBillLink(bill, value) {
  const { payFor: _old, ...rest } = bill; // _old: replaced on purpose
  const at = value.indexOf(":");
  if (at < 1) return rest;
  return {
    ...rest,
    payFor: { type: value.slice(0, at), id: value.slice(at + 1) },
  };
}

/** A copy of the liability linked to a debt id, or unlinked for "". */
export function setDebtLink(account, debtId) {
  const { debtId: _old, ...rest } = account; // _old: replaced on purpose
  return debtId ? { ...rest, debtId } : rest;
}

// ---------- Pay schedule ----------

export const CADENCE_OPTIONS = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "twice-monthly", label: "Twice a month" },
  { value: "monthly", label: "Once a month" },
];

/** settings.paySchedule -> form fields (blank form when there's none). */
export function scheduleForm(settings) {
  const s = readPaySchedule(settings);
  return {
    amount: s?.amount ?? "",
    cadence: s?.cadence ?? "biweekly",
    next: s?.next ?? "",
    day1: s?.days?.[0] ?? "",
    day2: s?.days?.[1] ?? "",
  };
}

/**
 * Form fields -> { schedule } ready for settings.paySchedule, or { error } in words.
 * Only what the user typed is saved; paydays are never guessed.
 */
export function readScheduleForm(form) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.next ?? ""))
    return { error: "Choose your next payday." };
  if (paymentProblem(form.amount))
    return { error: "Enter your take-home pay above 0, or leave it blank." };
  const schedule = { cadence: form.cadence, next: form.next };
  if (form.amount !== "" && form.amount != null)
    schedule.amount = Number(form.amount);
  if (form.cadence === "twice-monthly") {
    const days = [readDueDay(form.day1), readDueDay(form.day2)];
    if (!days[0] || !days[1] || days[0] === days[1])
      return { error: "Enter two different paydays from 1 to 31." };
    schedule.days = days.sort((a, b) => a - b);
    // The next payday must be one of those two days (29-31 clamp in short months),
    // or the first entered payday would silently be skipped.
    const month = form.next.slice(0, 7);
    if (!schedule.days.some((d) => dueDateIn(d, month) === form.next))
      return {
        error: "Your next payday should fall on one of the two paydays.",
      };
  }
  return readPaySchedule({ paySchedule: schedule })
    ? { schedule }
    : { error: "Check the pay schedule fields." };
}

/** The next `count` paydays from today, as ISO dates. */
export function upcomingPaydays(settings, today, count = 3) {
  const s = readPaySchedule(settings);
  if (!s) return [];
  const end = `${addMonths(monthKey(today), 3)}-28`; // far enough for 3 paydays
  return paydays(s, toISODate(today), end).slice(0, count);
}
