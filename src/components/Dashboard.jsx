import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import StatCard from './StatCard';
import CountUp from './CountUp';
import Icon from './Icon';
import EmptyState from './EmptyState';
import { Notice } from './Status';
import ChartTooltip from './ChartTooltip';
import { useColorScheme } from '../hooks/useColorScheme';
import { getPalette } from '../utils/colors';
import { categoryColor } from '../data/categories';
import {
  formatCurrency,
  formatPercent,
  formatDate,
  greeting,
  greetingIcon,
  monthKey,
  monthLabel,
} from '../utils/format';
import { monthlySeries, spendingByCategory, nextDueDate } from '../utils/finance';
import { buildInsights } from '../utils/insights';
import { netWorthTotals, readAccounts } from '../utils/netWorth';

export default function Dashboard({ store, goTo, openSummary }) {
  const { user, transactions, budgets, bills, categories, accounts, debts, settings, setSettings } = store;
  // Accounts made before recovery keys existed get a one-time, dismissible nudge.
  const showKeyReminder = !user.hasRecoveryKey && !settings.recoveryReminderDismissed;
  const palette = getPalette(useColorScheme());
  const thisMonth = monthKey(new Date());

  // useMemo caches a calculation and only re-runs it when its dependencies change.
  // Without it, these loops would run on every render (e.g. every hover).
  const series = useMemo(() => monthlySeries(transactions, 6), [transactions]);
  const byCategory = useMemo(
    () => spendingByCategory(transactions, thisMonth),
    [transactions, thisMonth],
  );
  const insights = useMemo(
    () => buildInsights(transactions, budgets, series),
    [transactions, budgets, series],
  );

  const current = series[series.length - 1];
  const previous = series[series.length - 2];
  const upcoming = bills
    .map((b) => ({ ...b, ...nextDueDate(b.dueDay) }))
    .sort((a, b) => a.daysAway - b.daysAway)
    .slice(0, 4);

  // "+12% vs last month" helper; returns '' when there's nothing to compare against.
  const change = (now, before) =>
    before > 0
      ? <>
          <Icon name={now >= before ? 'up' : 'down'} size={14} label={now >= before ? 'Up' : 'Down'} />{' '}
          {formatPercent(Math.abs(now / before - 1))} vs {previous.label}
        </>
      : '';

  return (
    <div className="stack">
      <header className="row">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            <Icon name={greetingIcon()} size={26} />
            {greeting()}, {user.name}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={openSummary}>
          <Icon name="summary" />
          View summary
        </button>
      </header>

      {showKeyReminder && (
        <Notice icon="warning" tone="warning">
          <span>
            Create a recovery key so a forgotten password doesn't lock you out of your data.{' '}
            <button className="link-btn" onClick={() => goTo('settings')}>
              Go to Settings
            </button>{' '}
            ·{' '}
            <button
              className="link-btn"
              onClick={() => setSettings((s) => ({ ...s, recoveryReminderDismissed: true }))}
            >
              Dismiss
            </button>
          </span>
        </Notice>
      )}

      <div className="grid grid-stats">
        <StatCard
          label={`Income · ${current.label}`}
          value={<CountUp value={current.income} format={formatCurrency} />}
          hint={change(current.income, previous?.income)}
        />
        <StatCard
          label={`Spending · ${current.label}`}
          value={<CountUp value={current.expenses} format={formatCurrency} />}
          hint={change(current.expenses, previous?.expenses)}
        />
        <StatCard
          label="Net saved"
          value={<CountUp value={current.net} format={formatCurrency} />}
          hint={current.net >= 0 ? 'Money left over this month' : 'Spending exceeds income'}
        />
        <StatCard
          label="Savings rate"
          value={<CountUp value={current.savingsRate} format={formatPercent} />}
          hint="Aim for 20% or more"
        />
        <StatCard
          label="Net worth"
          value={
            readAccounts(accounts).length ? (
              <CountUp value={netWorthTotals(accounts, debts).netWorth} format={formatCurrency} />
            ) : (
              '—'
            )
          }
          hint={
            <button className="link-btn" onClick={() => goTo('networth')}>
              {readAccounts(accounts).length ? 'See details' : 'Add your accounts'}
            </button>
          }
        />
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2>Income vs. spending</h2>
          <p className="sub">Last 6 months</p>
          <div className="chart">
            {/* ResponsiveContainer makes the chart fill its parent's width/height. */}
            <ResponsiveContainer>
              <BarChart data={series} barGap={2} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke={palette.grid} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: palette.axis, fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={(v) => formatCurrency(v, { compact: true })}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: palette.axis, fontSize: 12 }}
                  width={56}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: palette.grid, opacity: 0.4 }} />
                {/* radius=[top-left, top-right, bottom-right, bottom-left]: rounded tops only */}
                <Bar
                  dataKey="income"
                  name="Income"
                  fill={palette.series[0]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="expenses"
                  name="Spending"
                  fill={palette.series[1]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="legend">
            <span>
              <span className="dot" style={{ background: palette.series[0] }} />
              Income
            </span>
            <span>
              <span className="dot" style={{ background: palette.series[1] }} />
              Spending
            </span>
          </div>
        </section>

        <section className="card">
          <h2>Where your money went</h2>
          <p className="sub">
            {monthLabel(thisMonth, true)} · {formatCurrency(current.expenses)} total
          </p>
          {byCategory.length === 0 ? (
            <EmptyState icon="categories" title="No spending this month yet">
              Expenses you add show up here, grouped by category.
            </EmptyState>
          ) : (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 200, height: 200 }}>
                <ResponsiveContainer>
                  <PieChart>
                    {/* innerRadius turns the pie into a donut; paddingAngle adds a gap between slices. */}
                    <Pie
                      data={byCategory}
                      dataKey="amount"
                      nameKey="category"
                      innerRadius={58}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {byCategory.map((c) => (
                        <Cell
                          key={c.category}
                          fill={categoryColor(c.category, categories, palette)}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip labelFormatter={(_, p) => p[0]?.name} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* The list doubles as the legend and gives exact numbers (no guessing slice sizes). */}
              <ul className="list" style={{ flex: 1, minWidth: 180 }}>
                {byCategory.map((c) => (
                  <li key={c.category} className="small">
                    <span
                      className="dot"
                      style={{ background: categoryColor(c.category, categories, palette) }}
                    />
                    <span>{c.category}</span>
                    <span className="spacer" />
                    <span className="num">{formatCurrency(c.amount)}</span>
                    <span className="muted num" style={{ width: 40 }}>
                      {formatPercent(c.amount / current.expenses)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2>Insights</h2>
          <p className="sub">Generated from your data</p>
          <div className="stack" style={{ gap: 8 }}>
            {insights.map((item, i) => (
              <Notice key={i} icon={item.icon} tone={item.tone}>
                {item.text}
              </Notice>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="row">
            <h2>Upcoming bills</h2>
            <span className="spacer" />
            <button className="btn" onClick={() => goTo('bills')}>
              Manage
            </button>
          </div>
          <ul className="list">
            {upcoming.length === 0 && (
              <EmptyState as="li" icon="bills" title="No recurring bills yet" compact>
                Add rent, subscriptions and other repeats on the Bills page.
              </EmptyState>
            )}
            {upcoming.map((b) => (
              <li key={b.id}>
                <div>
                  <div>{b.name}</div>
                  <div className="small muted">{formatDate(b.date)}</div>
                </div>
                <span className="spacer" />
                <span className="pill">{b.daysAway === 0 ? 'Today' : `in ${b.daysAway}d`}</span>
                <strong className="num">{formatCurrency(b.amount)}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
