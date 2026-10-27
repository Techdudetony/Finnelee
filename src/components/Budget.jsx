import { useMemo, useState } from 'react';
import ProgressBar from './ProgressBar';
import StatCard from './StatCard';
import { namesOf, needsChecker } from '../data/categories';
import { formatCurrency, formatPercent, monthKey, monthLabel } from '../utils/format';
import { debtToIncome, fiftyThirtyTwenty, monthTotals, spendingByCategory } from '../utils/finance';

export default function Budget({ store }) {
  const { transactions, budgets, setBudgets, debts, categories } = store;
  const key = monthKey(new Date());

  const spent = useMemo(
    () =>
      Object.fromEntries(spendingByCategory(transactions, key).map((c) => [c.category, c.amount])),
    [transactions, key],
  );
  const { income } = monthTotals(transactions, key);
  const totalBudget = Object.values(budgets).reduce((s, v) => s + Number(v || 0), 0);
  const totalSpent = Object.values(spent).reduce((s, v) => s + v, 0);

  // Inputs keep their own local state; empty string allowed while typing.
  const setLimit = (category, value) =>
    setBudgets((b) => ({ ...b, [category]: value === '' ? '' : Math.max(0, Number(value)) }));

  return (
    <div className="stack">
      <div className="grid grid-stats">
        <StatCard label="Monthly budget" value={formatCurrency(totalBudget)} />
        <StatCard
          label={`Spent in ${monthLabel(key)}`}
          value={formatCurrency(totalSpent)}
          hint={totalBudget ? `${formatPercent(totalSpent / totalBudget)} of budget` : ''}
        />
        <StatCard label="Left to spend" value={formatCurrency(totalBudget - totalSpent)} />
      </div>

      <section className="card">
        <h2>Category budgets</h2>
        <p className="sub">
          Set a monthly limit for each category. Bars compare it with {monthLabel(key, true)}{' '}
          spending.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ width: 130 }}>Limit</th>
                <th className="num">Spent</th>
                <th style={{ width: '40%' }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {namesOf(categories, 'expense').map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="10"
                      value={budgets[c] ?? ''}
                      onChange={(e) => setLimit(c, e.target.value)}
                      aria-label={`${c} limit`}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td className="num">{formatCurrency(spent[c] || 0)}</td>
                  <td>
                    {Number(budgets[c]) > 0 ? (
                      <ProgressBar value={spent[c] || 0} max={Number(budgets[c])} />
                    ) : (
                      <span className="small muted">No limit set</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-2">
        <FiftyThirtyTwenty defaultIncome={income} spent={spent} categories={categories} />
        <DtiCalculator
          defaultDebt={
            debts.reduce((s, d) => s + Number(d.minPayment), 0) + Number(budgets.Housing || 0)
          }
        />
      </div>
    </div>
  );
}

/**
 * 50/30/20 rule: 50% of take-home pay on needs, 30% on wants, 20% to savings/extra debt payments.
 * Shows the target next to what you actually spent this month.
 */
function FiftyThirtyTwenty({ defaultIncome, spent, categories }) {
  const [income, setIncome] = useState(Math.round(defaultIncome) || 4000);
  const target = fiftyThirtyTwenty(Number(income) || 0);

  // Which categories count as needs comes from the user's own category settings.
  const isNeed = needsChecker(categories);
  const listOf = (group) =>
    categories
      .filter((c) => c.type === 'expense' && c.group === group)
      .map((c) => c.name)
      .join(', ') || 'none yet';

  let needs = 0;
  let wants = 0;
  for (const [cat, amt] of Object.entries(spent)) {
    if (isNeed(cat)) needs += amt;
    else wants += amt;
  }
  const savings = Math.max(0, income - needs - wants);

  const rows = [
    {
      label: 'Needs (50%)',
      hint: listOf('need'),
      actual: needs,
      target: target.needs,
      mode: 'limit',
    },
    {
      label: 'Wants (30%)',
      hint: listOf('want'),
      actual: wants,
      target: target.wants,
      mode: 'limit',
    },
    {
      label: 'Savings & debt (20%)',
      hint: 'What is left over',
      actual: savings,
      target: target.savings,
      mode: 'target',
    },
  ];

  return (
    <section className="card">
      <h2>50/30/20 calculator</h2>
      <p className="sub">A simple rule of thumb for splitting take-home pay.</p>
      <label className="field" style={{ marginBottom: 14 }}>
        Monthly take-home income
        <input type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} />
      </label>
      <div className="stack" style={{ gap: 14 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div className="row small">
              <strong>{r.label}</strong>
              <span className="spacer" />
              <span className="num">
                {formatCurrency(r.actual)} of {formatCurrency(r.target)}
              </span>
            </div>
            <div className="small muted" style={{ margin: '2px 0 6px' }}>
              {r.hint}
            </div>
            <ProgressBar value={r.actual} max={r.target} mode={r.mode} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Debt-to-income: lenders use this to judge how stretched you are. Uses GROSS (pre-tax) income. */
function DtiCalculator({ defaultDebt }) {
  const [gross, setGross] = useState(6500);
  const [debt, setDebt] = useState(Math.round(defaultDebt));
  const { ratio, rating } = debtToIncome(Number(debt), Number(gross));

  const ratingInfo = {
    healthy: { cls: 'good', text: '✓ Healthy (36% or less)' },
    caution: { cls: 'warning', text: '● Caution (36–43%)' },
    high: { cls: 'critical', text: '⚠ High (over 43%)' },
  }[rating];

  return (
    <section className="card">
      <h2>Debt-to-income calculator</h2>
      <p className="sub">Monthly debt payments (incl. rent/mortgage) ÷ gross monthly income.</p>
      <div className="form">
        <label className="field">
          Gross monthly income
          <input type="number" min="0" value={gross} onChange={(e) => setGross(e.target.value)} />
        </label>
        <label className="field">
          Monthly debt payments
          <input type="number" min="0" value={debt} onChange={(e) => setDebt(e.target.value)} />
        </label>
      </div>
      <div className="stat-value" style={{ marginTop: 18 }}>
        {formatPercent(ratio, 1)}
      </div>
      <div className={`status status-${ratingInfo.cls}`}>{ratingInfo.text}</div>
      <p className="small muted">
        To reach 36% you would need monthly debt payments of {formatCurrency(gross * 0.36)} or less,
        or a gross income of {formatCurrency(debt / 0.36)}.
      </p>
    </section>
  );
}
