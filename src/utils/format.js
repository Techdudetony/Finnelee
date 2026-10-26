// Small formatting helpers shared by every page.
// Intl.NumberFormat / Intl.DateTimeFormat are built into browsers and handle locales for us.

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const currencyCompactFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact', // 12500 -> $12.5K (handy for chart axes)
  maximumFractionDigits: 1,
});

const currencyWholeFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// compact: $12.5K (chart axes) · whole: $2,745 (no cents) · default: $2,745.24
export const formatCurrency = (n, { compact = false, whole = false } = {}) =>
  (compact ? currencyCompactFmt : whole ? currencyWholeFmt : currencyFmt).format(Number(n) || 0);

export const formatPercent = (ratio, digits = 0) =>
  `${((Number(ratio) || 0) * 100).toFixed(digits)}%`;

/**
 * Parse 'YYYY-MM-DD' as a LOCAL date.
 * Gotcha: new Date('2026-10-05') is treated as UTC midnight, which shows up as Oct 4
 * in US time zones. Building the date from parts avoids that off-by-one bug.
 */
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date object -> 'YYYY-MM-DD' in local time. */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const todayISO = () => toISODate(new Date());

/** '2026-10-05' or a Date -> '2026-10' (used to group transactions by month). */
export const monthKey = (dateOrIso) =>
  (typeof dateOrIso === 'string' ? dateOrIso : toISODate(dateOrIso)).slice(0, 7);

/** '2026-10' -> 'Oct' (short) or 'Oct 2026' (long). */
export function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    ...(long && { year: 'numeric' }),
  });
}

export const formatDate = (iso) =>
  parseDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Unique-enough id for list items. crypto.randomUUID exists in all modern browsers. */
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
