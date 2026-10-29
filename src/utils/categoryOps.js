// Renaming or deleting a category has to update every record that uses its name.
// These are pure functions: they take the current data and return NEW arrays/objects
// (never editing the old ones), which is exactly what React state updates want.

import {
  addMonths,
  carryover,
  periodFor,
  readBudgeting,
  spendingByMonth,
} from "./budgeting";
import { monthKey } from "./format";

const swapName = (from, to) => (item) =>
  item.category === from ? { ...item, category: to } : item;

// Moves obj[from] to obj[to]; an existing obj[to] wins (names are unique, so this is a safety net).
function moveKey(obj, from, to) {
  if (!(from in obj)) return obj;
  const { [from]: value, ...rest } = obj;
  return to in rest ? rest : { ...rest, [to]: value };
}

// Removes obj[name] without editing obj.
const dropKey = (obj, name) => {
  const { [name]: _removed, ...rest } = obj; // _removed: intentionally unused
  return rest;
};

/**
 * Rename `from` -> `to` across transactions, bills, budget limits, limit history and rollover.
 * Transactions move with the name, so the category's carryover is unchanged.
 */
export function renameCategory(
  { transactions, bills, budgets, settings },
  from,
  to,
) {
  const budgeting = readBudgeting(settings);
  return {
    transactions: transactions.map(swapName(from, to)),
    bills: bills.map(swapName(from, to)),
    budgets: moveKey(budgets, from, to),
    settings: {
      ...settings,
      budgeting: {
        ...budgeting,
        limits: moveKey(budgeting.limits, from, to),
        rollover: moveKey(budgeting.rollover, from, to),
      },
    },
  };
}

/**
 * Delete `name`: its transactions and bills move to `fallback` so no money disappears
 * from your totals. Its limit, limit history and rollover are removed.
 *
 * If the fallback rolls over, the moved transactions would rewrite its past months and
 * change the balance it carries. To prevent that, the fallback's period is closed last
 * month and a new one starts this month with the balance it had BEFORE the move.
 * From this month on, the moved transactions count against the fallback.
 */
export function deleteCategory(
  { transactions, bills, budgets, settings },
  name,
  fallback,
  today = new Date(),
) {
  const budgeting = readBudgeting(settings);
  const month = monthKey(today);
  let rollover = dropKey(budgeting.rollover, name);

  if (fallbackRollsOver(settings, fallback, today)) {
    // Measured with the transactions as they are now, before any move.
    const opening = carryover(
      budgets,
      budgeting,
      spendingByMonth(transactions),
      fallback,
      month,
    );
    const periods = rollover[fallback];
    const closed = { ...periods.at(-1), to: addMonths(month, -1) }; // empty if it began this month
    rollover = {
      ...rollover,
      [fallback]: [
        ...periods.slice(0, -1),
        closed,
        { from: month, to: null, opening },
      ],
    };
  }

  return {
    transactions: transactions.map(swapName(name, fallback)),
    bills: bills.map(swapName(name, fallback)),
    budgets: dropKey(budgets, name),
    settings: {
      ...settings,
      budgeting: {
        ...budgeting,
        limits: dropKey(budgeting.limits, name),
        rollover,
      },
    },
  };
}

/** True when `category` rolls over this month (the delete warning uses it too). */
export const fallbackRollsOver = (settings, category, today = new Date()) =>
  Boolean(periodFor(readBudgeting(settings), category, monthKey(today)));

/** How many transactions and bills use a category (shown before deleting). */
export const usageCount = ({ transactions, bills }, name) =>
  transactions.filter((t) => t.category === name).length +
  bills.filter((b) => b.category === name).length;
