// Renaming or deleting a category has to update every record that uses its name.
// These are pure functions: they take the current data and return NEW arrays/objects
// (never editing the old ones), which is exactly what React state updates want.

const swapName = (from, to) => (item) =>
  item.category === from ? { ...item, category: to } : item;

/** Rename `from` -> `to` across transactions, bills and budget limits. */
export function renameCategory({ transactions, bills, budgets }, from, to) {
  // Object destructuring with a computed key pulls `from` out and keeps the rest.
  const { [from]: limit, ...otherBudgets } = budgets;
  return {
    transactions: transactions.map(swapName(from, to)),
    bills: bills.map(swapName(from, to)),
    budgets: limit === undefined ? budgets : { ...otherBudgets, [to]: limit },
  };
}

/**
 * Delete `name`: its transactions and bills move to `fallback` so no money
 * disappears from your totals; its budget limit is removed.
 */
export function deleteCategory({ transactions, bills, budgets }, name, fallback) {
  const { [name]: _removed, ...otherBudgets } = budgets; // _removed: intentionally unused
  return {
    transactions: transactions.map(swapName(name, fallback)),
    bills: bills.map(swapName(name, fallback)),
    budgets: otherBudgets,
  };
}

/** How many transactions and bills use a category (shown before deleting). */
export const usageCount = ({ transactions, bills }, name) =>
  transactions.filter((t) => t.category === name).length +
  bills.filter((b) => b.category === name).length;
