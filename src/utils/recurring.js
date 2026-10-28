// Recurring expense detector: finds charges that repeat about once a month for a
// similar amount (subscriptions, phone, gym) so the Bills page can suggest them.
// Pure functions: it only returns suggestions; saving a bill is the user's choice.

import { normalizeMerchant } from './merchant';
import { parseDate, uid } from './format';

export { normalizeMerchant }; // re-exported so detector callers have one import

const MIN_CHARGES = 3;
const DAY_TOLERANCE = 4; // weekends and holidays move a charge by up to ~3 days
const AMOUNT_TOLERANCE = 0.1; // ±10% of the latest charge
const MAX_DAYS_SINCE_LAST = 45; // no charge for longer than this: probably cancelled
const MAX_CHARGES_PER_MONTH = 1.25; // more often than this is a shop you visit, not a bill
const DAY_MS = 86_400_000;

const daysBetween = (a, b) => Math.round(Math.abs(a - b) / DAY_MS);
const monthIndex = (date) => date.getFullYear() * 12 + date.getMonth(); // consecutive months differ by 1

/** The date a bill due on `day` falls in month m, moved to the last day in short months (31 -> Feb 28). */
const dueIn = (y, m, day) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));

/**
 * The due date (last, this or next month) closest to an actual charge. A bill due on
 * the 1st that was charged early on Oct 31 because Nov 1 was a Saturday belongs to
 * November, so we can't simply use the charge's calendar month.
 */
function nearestDue(date, day) {
  const y = date.getFullYear();
  const m = date.getMonth();
  return [m - 1, m, m + 1]
    .map((month) => dueIn(y, month, day)) // Date handles month -1 and 12 by changing the year
    .reduce((best, due) => (daysBetween(due, date) < daysBetween(best, date) ? due : best));
}

/** The day of the month the charges cluster around: the one most charges are close to. */
function anchorDay(dates) {
  let best = null;
  for (const day of new Set(dates.map((d) => d.getDate()))) {
    const offsets = dates.map((d) => daysBetween(d, nearestDue(d, day))).filter((o) => o <= DAY_TOLERANCE);
    const total = offsets.reduce((sum, o) => sum + o, 0);
    // More charges nearby wins; on a tie, the day they sit closest to (31 beats 28 for month-end bills).
    if (!best || offsets.length > best.count || (offsets.length === best.count && total < best.total))
      best = { day, count: offsets.length, total };
  }
  return best.day;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b); // copy: sort() would reorder the original
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 100) / 100;
}

/** 'netflix' and 'netflix premium' are the same merchant; 'net' and 'netflix' are not (whole words only). */
const sameMerchant = (a, b) => ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);

const titleCase = (key) => key.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Checks one merchant's charges for a monthly pattern. Returns { day, run } where run is
 * the unbroken streak of monthly charges ending with the newest one, or null.
 */
function monthlyPattern(charges, today) {
  const dated = charges
    .map((t) => ({ ...t, amount: Number(t.amount), when: parseDate(t.date) }))
    .sort((a, b) => b.when - a.when); // newest first
  const day = anchorDay(dated.map((c) => c.when));
  const billed = dated.map((c) => {
    const due = nearestDue(c.when, day);
    return { ...c, off: daysBetween(c.when, due), month: monthIndex(due) };
  });

  // Groceries every week also repeat, but far more than once a month.
  const months = new Set(billed.map((c) => c.month)).size;
  if (billed.length > months * MAX_CHARGES_PER_MONTH) return null;

  const latest = billed[0];
  if (latest.off > DAY_TOLERANCE || daysBetween(today, latest.when) > MAX_DAYS_SINCE_LAST) return null;

  // Walk back one billing month at a time while the amount stays close to the current price.
  // Comparing with the LATEST amount means an old price before a price increase ends the
  // streak, so the suggestion shows what you pay now.
  const run = [latest];
  for (const c of billed.slice(1)) {
    const prev = run[run.length - 1];
    if (c.off > DAY_TOLERANCE) continue; // a one-off purchase at the same merchant
    if (c.month === prev.month) return null; // two charges in one billing month: not a single bill
    if (c.month !== prev.month - 1) break; // a skipped month ends the streak
    if (Math.abs(c.amount - latest.amount) > latest.amount * AMOUNT_TOLERANCE) break;
    run.push(c);
  }
  return run.length >= MIN_CHARGES ? { day, run } : null;
}

/**
 * Suggests monthly bills from expense history. Skips merchants that already have a bill
 * and keys the user dismissed (settings.dismissedRecurring).
 * Each suggestion: { key, name, amount, dueDay, category, count, lastDate }, biggest first.
 */
export function detectRecurring(transactions, bills = [], { dismissed = [], today = new Date() } = {}) {
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // midnight, like parseDate
  const billKeys = bills.map((b) => normalizeMerchant(b.name)).filter(Boolean);
  const skip = new Set(dismissed);

  const groups = new Map(); // merchant key -> its expense transactions
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    const key = normalizeMerchant(t.description);
    if (!key || skip.has(key) || billKeys.some((b) => sameMerchant(key, b))) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const suggestions = [];
  for (const [key, charges] of groups) {
    const found = charges.length >= MIN_CHARGES && monthlyPattern(charges, now);
    if (!found) continue;
    const { day, run } = found;
    suggestions.push({
      key,
      name: titleCase(key),
      amount: median(run.map((c) => c.amount)),
      dueDay: day,
      category: run[0].category, // the most recent charge's category
      count: run.length,
      lastDate: run[0].date,
    });
  }
  return suggestions.sort((a, b) => b.amount - a.amount);
}

/** Turns a suggestion into a bill with the same shape as one added by hand. */
export const toBill = ({ name, amount, dueDay, category }) => ({ id: uid(), name, amount, dueDay, category });
