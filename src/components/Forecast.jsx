import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip';
import StatCard from './StatCard';
import { useColorScheme } from '../hooks/useColorScheme';
import { useMotion } from '../hooks/useMotion';
import { getPalette } from '../utils/colors';
import { formatCurrency } from '../utils/format';
import { monthlySeries, predictNext, projectSavings } from '../utils/finance';
import { liquidSavings, savingsBalance } from '../utils/netWorth';
import Status from './Status';

export default function Forecast({ store }) {
  const { transactions, settings, setSettings, accounts } = store;
  const palette = getPalette(useColorScheme());
  const animate = useMotion() === 'full'; // charts draw in at Full motion only
  const history = useMemo(() => monthlySeries(transactions, 6), [transactions]);

  // Suggested contribution = average net of the last 3 FULL months (the current month is incomplete).
  const fullMonths = history.slice(-4, -1);
  const avgNet = fullMonths.length ? fullMonths.reduce((s, m) => s + m.net, 0) / fullMonths.length : 0;

  const [monthly, setMonthly] = useState(Math.max(0, Math.round(avgNet)));
  const [years, setYears] = useState(10);
  const rate = Number(settings.annualReturn) || 0;
  // Starting savings: the typed-in amount by default, or cash + savings accounts if the user chose that.
  const savings = savingsBalance(settings, accounts);
  const liquid = liquidSavings(accounts);
  const start = savings.amount;

  // Three scenarios: expected return ± 2 percentage points, merged into one row per month.
  const projection = useMemo(() => {
    const scenarios = {
      conservative: projectSavings({ start, monthly, annualRate: Math.max(0, rate - 2), years }),
      expected: projectSavings({ start, monthly, annualRate: rate, years }),
      optimistic: projectSavings({ start, monthly, annualRate: rate + 2, years }),
    };
    return scenarios.expected.map((p, i) => ({
      month: p.month,
      contributed: p.contributed,
      conservative: scenarios.conservative[i].balance,
      expected: p.balance,
      optimistic: scenarios.optimistic[i].balance,
    }));
  }, [start, monthly, rate, years]);

  const final = projection.at(-1);
  const growth = final.expected - final.contributed;

  // Spending prediction: fit a trend line to the full months, extend it one month.
  const pastExpenses = history.slice(0, -1).map((m) => m.expenses);
  const predicted = predictNext(pastExpenses);
  const spendData = [
    ...history.slice(0, -1).map((m) => ({ label: m.label, actual: m.expenses })),
    { label: `${history.at(-1).label} (forecast)`, forecast: predicted },
  ];
  // Repeat the last real value under "forecast" so the dashed line connects to the solid one.
  spendData[spendData.length - 2].forecast = spendData[spendData.length - 2].actual;
  const avgSpend = pastExpenses.reduce((s, v) => s + v, 0) / (pastExpenses.length || 1);

  const updateSetting = (field) => (e) => setSettings((s) => ({ ...s, [field]: Number(e.target.value) }));
  const setSource = (source) => setSettings((s) => ({ ...s, savingsSource: source }));

  return (
    <div className="stack">
      <section className="card">
        <h2>Savings projection</h2>
        <p className="sub">Compound growth with a fixed monthly deposit. Suggested deposit is your average monthly net over the last 3 months ({formatCurrency(avgNet)}).</p>
        <div className="form">
          <label className="field">Current savings
            {savings.source === 'accounts'
              ? <input type="number" value={start} disabled title="From your cash and savings accounts" />
              : <input type="number" min="0" value={settings.startingSavings} onChange={updateSetting('startingSavings')} />}
          </label>
          <label className="field">Monthly deposit
            <input type="number" min="0" value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} />
          </label>
          <label className="field">Expected annual return %
            <input type="number" min="0" max="20" step="0.5" value={settings.annualReturn} onChange={updateSetting('annualReturn')} />
          </label>
          <label className="field">Years
            <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
              {[1, 3, 5, 10, 20, 30].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        {/* An explicit choice: adding an account never switches the source on its own. */}
        <div className="row small" role="radiogroup" aria-label="Savings source" style={{ marginTop: 12 }}>
          <span className="muted">Current savings comes from:</span>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" name="savingsSource" checked={settings.savingsSource !== 'accounts'} onChange={() => setSource('manual')} />
            The amount I enter
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" name="savingsSource" checked={settings.savingsSource === 'accounts'} disabled={liquid.count === 0} onChange={() => setSource('accounts')} />
            My cash + savings accounts ({liquid.count ? formatCurrency(liquid.amount) : 'add one on the Net Worth page'})
          </label>
        </div>
        {savings.fellBack && (
          <Status tone="warning" as="p" style={{ marginBottom: 0 }}>
            You have no cash or savings accounts right now, so the amount you entered is used.
          </Status>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>The emergency fund in your welcome summary uses the same choice.</p>
      </section>

      <div className="grid grid-stats">
        <StatCard label={`Expected in ${years} yr`} value={formatCurrency(final.expected)} hint={`Range ${formatCurrency(final.conservative, { compact: true })} – ${formatCurrency(final.optimistic, { compact: true })}`} />
        <StatCard label="You deposit" value={formatCurrency(final.contributed)} />
        <StatCard label="Interest earned" value={formatCurrency(growth)} hint="Money your money made" />
      </div>

      <section className="card">
        <h2>Projected balance</h2>
        <p className="sub">Conservative = {Math.max(0, rate - 2)}%, expected = {rate}%, optimistic = {rate + 2}% per year</p>
        <div className="chart" style={{ height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={projection} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} stroke={palette.grid} />
              <XAxis dataKey="month" ticks={projection.filter((p) => p.month % 12 === 0).map((p) => p.month)} tickFormatter={(m) => `Yr ${m / 12}`} tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 12 }} />
              <YAxis tickFormatter={(v) => formatCurrency(v, { compact: true })} tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 12 }} width={60} />
              <Tooltip content={<ChartTooltip labelFormatter={(m) => `Year ${Math.floor(m / 12)}, month ${m % 12}`} />} />
              <Line isAnimationActive={animate} dataKey="optimistic" name="Optimistic" stroke={palette.series[2]} strokeWidth={2} dot={false} />
              <Line isAnimationActive={animate} dataKey="expected" name="Expected" stroke={palette.series[0]} strokeWidth={2.5} dot={false} />
              <Line isAnimationActive={animate} dataKey="conservative" name="Conservative" stroke={palette.series[1]} strokeWidth={2} dot={false} />
              {/* strokeDasharray="4 4" = 4px dash, 4px gap: a quiet reference line */}
              <Line isAnimationActive={animate} dataKey="contributed" name="Deposited" stroke={palette.other} strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="legend">
          <span><span className="dot" style={{ background: palette.series[2] }} />Optimistic</span>
          <span><span className="dot" style={{ background: palette.series[0] }} />Expected</span>
          <span><span className="dot" style={{ background: palette.series[1] }} />Conservative</span>
          <span><span className="dot" style={{ background: palette.other }} />Deposited (no growth)</span>
        </div>
      </section>

      <section className="card">
        <h2>Spending forecast</h2>
        <p className="sub">
          Based on your trend, you'll likely spend about <strong>{formatCurrency(predicted)}</strong> this month
          ({predicted >= avgSpend ? 'above' : 'below'} your {formatCurrency(avgSpend)} average).
        </p>
        <div className="chart" style={{ height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={spendData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} stroke={palette.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 12 }} />
              {/* Zoomed-in axis ('auto' bounds), so use whole dollars: compact labels would repeat ($2.7K, $2.7K). */}
              <YAxis tickFormatter={(v) => formatCurrency(v, { whole: true })} tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 12 }} width={64} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip />} />
              <Line isAnimationActive={animate} dataKey="actual" name="Actual" stroke={palette.series[1]} strokeWidth={2} dot={{ r: 4 }} />
              <Line isAnimationActive={animate} dataKey="forecast" name="Forecast" stroke={palette.series[1]} strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="small muted">The forecast is a straight-line trend (linear regression). It's a rough guide, not a guarantee.</p>
      </section>
    </div>
  );
}
