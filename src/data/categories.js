// Category lists. Order matters: an expense category's index picks its chart color,
// so keep at most 8 colored categories; anything else is drawn gray as "Other".

export const EXPENSE_CATEGORIES = [
  'Housing',
  'Groceries',
  'Dining',
  'Transport',
  'Utilities',
  'Entertainment',
  'Shopping',
  'Health',
  'Other',
];

export const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Other Income'];

// For the 50/30/20 rule: "needs" are essentials, everything else counts as "wants".
export const NEEDS = new Set(['Housing', 'Groceries', 'Transport', 'Utilities', 'Health']);

/** Category name -> color from the palette (gray for "Other" or unknown categories). */
export function categoryColor(category, palette) {
  const i = EXPENSE_CATEGORIES.indexOf(category);
  return i >= 0 && i < palette.series.length ? palette.series[i] : palette.other;
}
