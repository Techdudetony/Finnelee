// Categories are per-user data now (stored like transactions), so each person can
// add, rename, recolor or delete their own. This file holds the starter set and
// small helpers that every page uses to read them.
//
// Shape of one category:
//   { id, name, type: 'expense' | 'income', group: 'need' | 'want', colorIndex: 0-7 | null }
// - group only matters for expenses (it powers the 50/30/20 split and emergency fund math).
// - colorIndex picks one of the 8 chart colors; null = neutral gray.

export const DEFAULT_CATEGORIES = [
  { id: 'housing', name: 'Housing', type: 'expense', group: 'need', colorIndex: 0 },
  { id: 'groceries', name: 'Groceries', type: 'expense', group: 'need', colorIndex: 1 },
  { id: 'dining', name: 'Dining', type: 'expense', group: 'want', colorIndex: 2 },
  { id: 'transport', name: 'Transport', type: 'expense', group: 'need', colorIndex: 3 },
  { id: 'utilities', name: 'Utilities', type: 'expense', group: 'need', colorIndex: 4 },
  { id: 'entertainment', name: 'Entertainment', type: 'expense', group: 'want', colorIndex: 5 },
  { id: 'shopping', name: 'Shopping', type: 'expense', group: 'want', colorIndex: 6 },
  { id: 'health', name: 'Health', type: 'expense', group: 'need', colorIndex: 7 },
  { id: 'other', name: 'Other', type: 'expense', group: 'want', colorIndex: null },
  { id: 'salary', name: 'Salary', type: 'income', group: 'need', colorIndex: null },
  { id: 'freelance', name: 'Freelance', type: 'income', group: 'need', colorIndex: null },
  { id: 'other-income', name: 'Other Income', type: 'income', group: 'need', colorIndex: null },
];

/** Category names of one type, in the user's order: namesOf(categories, 'expense') -> ['Housing', ...] */
export const namesOf = (categories, type) =>
  categories.filter((c) => c.type === type).map((c) => c.name);

/** Look up a category object by its name (transactions store the name). */
export const findCategory = (categories, name) => categories.find((c) => c.name === name);

/** Chart color for a category name; gray for unknown names or colorIndex null. */
export function categoryColor(name, categories, palette) {
  const i = findCategory(categories, name)?.colorIndex;
  return i != null && palette.series[i] ? palette.series[i] : palette.other;
}

/**
 * Returns a function that answers "is this an essential (need) expense?".
 * A Set gives fast lookups when it's called once per transaction.
 */
export function needsChecker(categories) {
  const needs = new Set(
    categories.filter((c) => c.type === 'expense' && c.group === 'need').map((c) => c.name),
  );
  return (name) => needs.has(name);
}
