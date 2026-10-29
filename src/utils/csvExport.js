import { todayISO } from './format';

// Quote every value and double inner quotes: the CSV escaping rule.
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;

/** Transactions -> CSV text. The header matches what the importer recognizes. */
export const transactionsToCSV = (rows) =>
  [
    ['date', 'description', 'category', 'type', 'amount'].join(','),
    ...rows.map((t) => [t.date, t.description, t.category, t.type, t.amount].map(esc).join(',')),
  ].join('\n');

/** Downloads transactions as a .csv file, built in the browser. */
export function downloadCSV(rows, filename = `transactions-${todayISO()}.csv`) {
  const blob = new Blob([transactionsToCSV(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
