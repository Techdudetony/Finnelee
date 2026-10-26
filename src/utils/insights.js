import { formatCurrency, formatPercent } from './format';
import { spendingByCategory } from './finance';

/**
 * Turns raw numbers into short, readable observations. Plain function, so it's easy to extend.
 * Shared by the Dashboard and the welcome summary, so it lives in utils/.
 */
export function buildInsights(transactions, budgets, series) {
  const out = [];
  const [cur, prev] = [series.at(-1), series.at(-2)];
  const curCats = spendingByCategory(transactions, cur.key);
  const prevCats = Object.fromEntries(spendingByCategory(transactions, prev.key).map((c) => [c.category, c.amount]));

  // Biggest category increase vs last month
  const jumps = curCats
    .filter((c) => prevCats[c.category] > 0)
    .map((c) => ({ ...c, pct: c.amount / prevCats[c.category] - 1 }))
    .sort((a, b) => b.pct - a.pct);
  if (jumps[0]?.pct > 0.1) {
    out.push(`📈 ${jumps[0].category} is up ${formatPercent(jumps[0].pct)} compared with ${prev.label}.`);
  }

  // Budgets already exceeded
  const over = curCats.filter((c) => budgets[c.category] && c.amount > budgets[c.category]);
  for (const c of over) {
    out.push(`⚠️ ${c.category} is ${formatCurrency(c.amount - budgets[c.category])} over its ${formatCurrency(budgets[c.category])} budget.`);
  }

  // Average savings rate over the period
  const withIncome = series.filter((m) => m.income > 0);
  if (withIncome.length) {
    const avg = withIncome.reduce((s, m) => s + m.savingsRate, 0) / withIncome.length;
    out.push(
      avg >= 0.2
        ? `✅ You've saved ${formatPercent(avg)} of income on average. Great work!`
        : `💡 Your average savings rate is ${formatPercent(avg)}. Trimming your top category could push it toward 20%.`
    );
  }

  if (curCats[0]) out.push(`🏷️ Your largest expense this month is ${curCats[0].category} (${formatCurrency(curCats[0].amount)}).`);
  return out.length ? out : ['Add some transactions to see insights here.'];
}
