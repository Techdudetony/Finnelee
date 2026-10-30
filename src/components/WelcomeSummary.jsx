import { useEffect, useMemo, useRef } from 'react';
import ProgressBar from './ProgressBar';
import { needsChecker } from '../data/categories';
import { formatCurrency, formatDate, formatPercent, greeting, greetingIcon, monthKey } from '../utils/format';
import Icon from './Icon';
import Status, { Notice } from './Status';
import {
  emergencyFundMonths,
  monthlySeries,
  monthTotals,
  nextDueDate,
  safeToSpend,
} from '../utils/finance';
import { buildInsights } from '../utils/insights';
import { savingsBalance } from '../utils/netWorth';

/**
 * Pop-up summary shown right after signing in (and from the Dashboard's "Summary" button).
 * Uses the native <dialog> element: showModal() gives us the dark backdrop, Esc-to-close
 * and keyboard focus trapping for free, with no modal library needed.
 */
export default function WelcomeSummary({ store, onClose, goTo }) {
  const dialogRef = useRef(null);
  const { user, transactions, budgets, bills, goals, settings, categories, accounts } = store;

  // Open the dialog once it's in the page. The `open` check matters in development:
  // StrictMode runs effects twice, and calling showModal() on an open dialog throws.
  // No cleanup needed: when React removes the element, the browser closes it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  const s = useMemo(() => {
    const today = new Date();
    const month = monthTotals(transactions, monthKey(today));
    const budgetTotal = Object.values(budgets).reduce((t, v) => t + Number(v || 0), 0);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dueSoon = bills
      .map((b) => ({ ...b, ...nextDueDate(Number(b.dueDay), today) }))
      .filter((b) => b.daysAway <= 7)
      .sort((a, b) => a.daysAway - b.daysAway);
    const saved = goals.reduce((t, g) => t + Number(g.saved), 0);
    const target = goals.reduce((t, g) => t + Number(g.target), 0);
    return {
      month,
      budgetTotal,
      daysLeft: lastDay - today.getDate(),
      safe: safeToSpend({ transactions, bills, goals }, today),
      // Typed-in savings by default; cash + savings accounts if chosen on the Forecast page.
      emergency: emergencyFundMonths(
        savingsBalance(settings, accounts).amount,
        transactions,
        needsChecker(categories),
        today,
      ),
      dueSoon,
      goals: { saved, target, count: goals.length },
      insight: buildInsights(transactions, budgets, monthlySeries(transactions, 6))[0],
    };
  }, [transactions, budgets, bills, goals, settings, categories, accounts]);

  // Go to a page AND close the popup.
  const open = (page) => {
    goTo(page);
    onClose();
  };

  return (
    // onClose fires on Esc as well as on our buttons, so parent state stays in sync.
    <dialog
      ref={dialogRef}
      className="summary-dialog"
      onClose={onClose}
      aria-labelledby="summary-title"
    >
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <h2 id="summary-title" style={{ fontSize: '1.3rem' }}>
          <Icon name={greetingIcon()} size={22} />
          {greeting()}, {user.name}
        </h2>
        <span className="spacer" />
        <button className="btn-icon" onClick={onClose} aria-label="Close summary">
          <Icon name="close" />
        </button>
      </div>
      <p className="sub">Here's where things stand today.</p>

      <div className="grid grid-stats" style={{ gap: 10 }}>
        <SummaryTile
          label="Safe to spend"
          value={formatCurrency(s.safe.amount)}
          hint={`After ${formatCurrency(s.safe.billsLeft, { whole: true })} of bills and ${formatCurrency(s.safe.plannedSavings, { whole: true })} for goals`}
          tone={s.safe.amount < 0 ? 'critical' : undefined}
        />
        <SummaryTile
          label="Spent this month"
          value={formatCurrency(s.month.expenses)}
          hint={
            s.budgetTotal
              ? `${formatPercent(s.month.expenses / s.budgetTotal)} of budget · ${s.daysLeft} days left`
              : `${s.daysLeft} days left in the month`
          }
        />
        <SummaryTile
          label="Emergency fund"
          value={s.emergency.months == null ? '—' : `${s.emergency.months.toFixed(1)} months`}
          hint={
            s.emergency.months == null
              ? 'Add expenses to calculate'
              : 'of essential costs covered (aim for 3–6)'
          }
          tone={s.emergency.months != null && s.emergency.months < 3 ? 'warning' : undefined}
        />
      </div>

      {s.budgetTotal > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="row small">
            <strong>Monthly budget</strong>
            <span className="spacer" />
            {formatCurrency(s.month.expenses)} of {formatCurrency(s.budgetTotal)}
          </div>
          <ProgressBar value={s.month.expenses} max={s.budgetTotal} />
        </div>
      )}

      {s.goals.count > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="row small">
            <strong>Savings goals ({s.goals.count})</strong>
            <span className="spacer" />
            {formatCurrency(s.goals.saved)} of {formatCurrency(s.goals.target)}
          </div>
          <ProgressBar value={s.goals.saved} max={s.goals.target} mode="target" />
        </div>
      )}

      <h3 className="small" style={{ margin: '18px 0 4px' }}>
        Bills due in the next 7 days
      </h3>
      {s.dueSoon.length === 0 ? (
        <Status tone="good" icon="celebrate" as="p" style={{ margin: 0 }}>
          Nothing due this week.
        </Status>
      ) : (
        <ul className="list">
          {s.dueSoon.map((b) => (
            <li key={b.id} className="small">
              <span>{b.name}</span>
              <span className="muted">{b.daysAway === 0 ? 'today' : formatDate(b.date)}</span>
              <span className="spacer" />
              <strong className="num">{formatCurrency(b.amount)}</strong>
            </li>
          ))}
        </ul>
      )}

      {s.insight && (
        <Notice icon={s.insight.icon} tone={s.insight.tone} style={{ marginTop: 16 }}>
          {s.insight.text}
        </Notice>
      )}

      <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => open('transactions')}>
          Add a transaction
        </button>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Go to dashboard
        </button>
      </div>
    </dialog>
  );
}

function SummaryTile({ label, value, hint, tone }) {
  return (
    <div className="summary-tile">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? `status-${tone}` : ''}`} style={{ fontSize: '1.3rem' }}>
        {value}
      </div>
      <div className="stat-hint">{hint}</div>
    </div>
  );
}
