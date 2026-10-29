import { useMemo, useState } from 'react';
import ProgressBar from './ProgressBar';
import StatCard from './StatCard';
import Status, { Notice } from './Status';
import { needsChecker } from '../data/categories';
import { formatCurrency, formatPercent, monthKey, monthLabel } from '../utils/format';
import { debtToIncome, fiftyThirtyTwenty, monthTotals, spendingByCategory } from '../utils/finance';
import {
  budgetMonths,
  budgetRows,
  leftToAssign,
  monthMode,
  setLimit,
  setPlannedIncome,
  setRollover,
  suggestedIncome,
} from '../utils/budgeting';

// +$40.00 / -$100.00: carryover shows its sign so the direction is never color-only.
const signed = (n) => (n > 0 ? '+' : '') + formatCurrency(n);
const tone = (n) => (n > 0 ? 'amount-income' : n < 0 ? 'status-critical' : 'muted');

export default function Budget({ store }) {
  const { transactions, budgets, setBudgets, settings, setSettings, debts, categories, goals } =
    store;
  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const mode = monthMode(month); // 'past' is read-only; 'current' and 'next' can be planned
  const editable = mode !== 'past';

  const months = useMemo(() => budgetMonths(transactions), [transactions]);
  const index = months.indexOf(month);
  const rows = useMemo(
    () => budgetRows({ budgets, settings, transactions, categories }, month),
    [budgets, settings, transactions, categories, month],
  );
  const suggestion = useMemo(() => suggestedIncome(transactions), [transactions]);
  const plan = leftToAssign({ budgets, settings, categories, goals, suggestion }, month);

  // Both slices change together: budgets (this month's active limits) and the history in settings.
  const changeLimit = (category, value) => {
    const next = setLimit({ budgets, settings }, category, month, value);
    setBudgets(next.budgets);
    setSettings(next.settings);
  };
  const changeIncome = (value) => setSettings(setPlannedIncome(settings, month, value));
  const toggleRollover = (category, on) => setSettings(setRollover(settings, category, on));

  // This month's spending per category, for the 50/30/20 card (unchanged from before).
  const spent = useMemo(
    () =>
      Object.fromEntries(
        spendingByCategory(transactions, current).map((c) => [c.category, c.amount]),
      ),
    [transactions, current],
  );
  const { income } = monthTotals(transactions, current);

  const totals = rows.reduce(
    (t, r) => ({
      allocation: t.allocation + r.allocation,
      spent: t.spent + r.spent,
      remaining: t.remaining + r.remaining,
    }),
    { allocation: 0, spent: 0, remaining: 0 },
  );
  // Savings counts once, through goals. A savings-like category with a limit too would count it twice.
  const savingsCategories = rows
    .filter((r) => r.allocation > 0 && /sav|invest/i.test(r.category))
    .map((r) => r.category);

  const leftStatus =
    plan.left === 0
      ? { tone: 'good', text: 'Every dollar assigned' }
      : plan.left > 0
        ? { tone: 'warning', text: `${formatCurrency(plan.left)} to assign` }
        : { tone: 'critical', text: `Over-assigned by ${formatCurrency(-plan.left)}` };

  return (
    <div className="stack">
      <div className="row">
        <button
          className="btn"
          onClick={() => setMonth(months[index - 1])}
          disabled={index <= 0}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h2 style={{ margin: 0, minWidth: 110, textAlign: 'center' }}>{monthLabel(month, true)}</h2>
        <button
          className="btn"
          onClick={() => setMonth(months[index + 1])}
          disabled={index >= months.length - 1}
          aria-label="Next month"
        >
          ›
        </button>
        <span className="small muted">
          {mode === 'past'
            ? 'Past month (read-only)'
            : mode === 'next'
              ? 'Planning next month'
              : 'This month'}
        </span>
      </div>

      {editable ? (
        <div className="grid grid-stats">
          <StatCard
            label="Planned income"
            value={formatCurrency(plan.income)}
            hint={plan.confirmed ? 'Confirmed' : 'Suggested, not confirmed'}
          />
          <StatCard
            label="Assigned"
            value={formatCurrency(plan.assigned)}
            hint={`${formatCurrency(plan.allocated)} categories + ${formatCurrency(plan.goalSavings)} goals`}
          />
          <div className="card">
            <div className="stat-label">Left to assign</div>
            <div className="stat-value">{formatCurrency(plan.left)}</div>
            <Status tone={leftStatus.tone} as="div">
              {leftStatus.text}
            </Status>
          </div>
        </div>
      ) : (
        <div className="grid grid-stats">
          <StatCard label="Allocated" value={formatCurrency(totals.allocation)} />
          <StatCard label="Spent" value={formatCurrency(totals.spent)} />
          <StatCard label="Remaining (incl. carryover)" value={formatCurrency(totals.remaining)} />
        </div>
      )}

      {editable && (
        <section className="card">
          <h2>Planned income</h2>
          <p className="sub">
            Zero-based budgeting gives every dollar of {monthLabel(month, true)} income a job:
            categories plus goal contributions should add up to it. Carryover isn't counted; it was
            assigned in an earlier month.
          </p>
          <div className="row">
            <label className="field">
              Income for {monthLabel(month, true)}
              <input
                type="number"
                min="0"
                step="50"
                value={plan.confirmed ? plan.income : ''}
                placeholder={suggestion ? String(suggestion) : 'Amount'}
                onChange={(e) => changeIncome(e.target.value)}
              />
            </label>
            {!plan.confirmed && suggestion !== null && (
              <button className="btn" onClick={() => changeIncome(String(suggestion))}>
                Use suggestion ({formatCurrency(suggestion, { whole: true })})
              </button>
            )}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {plan.confirmed
              ? 'Confirmed. Clear the box to go back to the suggestion.'
              : 'Suggested from your average income over the last 3 full months. Type an amount or use the suggestion to confirm it.'}{' '}
            Goal contributions ({formatCurrency(plan.goalSavings)} this month, from the Goals page)
            are included in Assigned.
          </p>
          {savingsCategories.length > 0 && plan.goalSavings > 0 && (
            <Notice tone="warning" style={{ marginTop: 12 }}>
              {savingsCategories.join(', ')} also has a limit. If it's money for your goals, it's
              being counted twice: keep either the goal or the category limit.
            </Notice>
          )}
        </section>
      )}

      <section className="card">
        <h2>Category budgets</h2>
        <p className="sub">
          Available = allocation + carryover. Remaining = available − spent. With rollover on,
          what's left (or overspent) carries into next month.
          {mode === 'next' && ' Carryover into next month is based on spending so far.'}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ width: 120 }}>Allocation</th>
                <th className="num">Carryover</th>
                <th className="num">Available</th>
                <th className="num">Spent</th>
                <th className="num">Remaining</th>
                <th style={{ width: '22%' }}>Progress</th>
                <th>Roll over</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category}>
                  <td>{r.category}</td>
                  <td>
                    {editable ? (
                      <input
                        type="number"
                        min="0"
                        step="10"
                        // This month shows `budgets` as typed ('' allowed); next month shows its plan.
                        value={
                          mode === 'current' ? (budgets[r.category] ?? '') : r.allocation || ''
                        }
                        onChange={(e) => changeLimit(r.category, e.target.value)}
                        aria-label={`${r.category} allocation for ${monthLabel(month, true)}`}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      formatCurrency(r.allocation)
                    )}
                  </td>
                  <td className={`num ${r.rollsOver ? tone(r.carryover) : 'muted'}`}>
                    {r.rollsOver ? signed(r.carryover) : '—'}
                  </td>
                  <td className="num">{formatCurrency(r.available)}</td>
                  <td className="num">{formatCurrency(r.spent)}</td>
                  <td className={`num ${r.remaining < 0 ? 'status-critical' : ''}`}>
                    {formatCurrency(r.remaining)}
                  </td>
                  <td>
                    {r.available > 0 ? (
                      <ProgressBar value={r.spent} max={r.available} />
                    ) : r.allocation === 0 && !r.rollsOver ? (
                      <span className="small muted">No limit set</span>
                    ) : (
                      <Status tone="critical">Nothing available</Status>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.rollsOver}
                      disabled={mode !== 'current'} // rollover changes take effect this month
                      onChange={(e) => toggleRollover(r.category, e.target.checked)}
                      aria-label={`Roll over ${r.category}`}
                      title={
                        mode === 'current'
                          ? undefined
                          : 'Turn rollover on or off in the current month'
                      }
                    />
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
    healthy: { cls: 'good', text: 'Healthy (36% or less)' },
    caution: { cls: 'warning', text: 'Caution (36–43%)' },
    high: { cls: 'critical', text: 'High (over 43%)' },
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
      <Status tone={ratingInfo.cls} as="div">
        {ratingInfo.text}
      </Status>
      <p className="small muted">
        To reach 36% you would need monthly debt payments of {formatCurrency(gross * 0.36)} or less,
        or a gross income of {formatCurrency(debt / 0.36)}.
      </p>
    </section>
  );
}
