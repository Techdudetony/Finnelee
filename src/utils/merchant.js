// Merchant helpers shared by CSV import  (category + duplicate matching), the recurring expense detectir, and later the AI auto-categorizer (see ROADMAP.md).
// Pure functions: no React, so they-'re easy to test and reuse.
// Word banks glue onto descriptions that don't identify the merchant ("SQ *BLUE BOTTLE", "NETFLIX.COM", "ACME INC").
const NOISE = new Set(['com', 'www', 'inc', 'llc', 'ltd', 'corp', 'pos', 'sq', 'tst']);

/**
 * Reduces a bank description to a stable merchant key:
 * 'NETFLIX.COM 866-579-7172' -> 'netflix', 'Starbucks #1234' -> 'starbucks'.
 * Two descriptions with the same key are treated as the same merchant.
 */
export function normalizeMerchant(description) {
  return String(description ?? '')
    .toLowerCase()
    .replace(/[^a-z&]+/g, ' ') // digits (store #s, phone numbers, dates) and punctuation -> space
    .split(' ')
    .filter((word) => word && !NOISE.has(word))
    .join(' ');
}

/**
 * Remembers which category each merchant was last filed under, per type:
 * 'expense|starbucks' -> 'Dining'. App keeps transactions newest first, so the first one we see is the user's most recent choice and later ones are ignored.
 */
export function merchantCategoryMap(transactions) {
  const map = new Map();
  for (const t of transactions) {
    const merchant = normalizeMerchant(t.description);
    const key = `${t.type}|${merchant}`;
    if (merchant && !map.has(key)) map.set(key, t.category);
  }
  return map;
}
