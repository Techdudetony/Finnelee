import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip';
import Icon from './Icon';
import Status from './Status';
import { useColorScheme } from '../hooks/useColorScheme';
import { getPalette } from '../utils/colors';
import { formatCurrency, uid } from '../utils/format';
import { simulateDebtPayoff, monthsFromNowLabel } from '../utils/finance';

const emptyDebt = { name: '', balance: '', apr: '', minPayment: '' };

export default function DebtPlanner({ store }) {
  const { debts, setDebts } = store;
  const palette = getPalette(useColorScheme());
  const [extra, setExtra] = useState(200);
  const [form, setForm] = useState(emptyDebt);

  // Run both strategies whenever debts or the extra payment change.
  const snowball = useMemo(() => simulateDebtPayoff(debts, extra, 'snowball'), [debts, extra]);
  const avalanche = useMemo(() => simulateDebtPayoff(debts, extra, 'avalanche'), [debts, extra]);

  // Merge both timelines into one array of rows: { month, snowball, avalanche } for the chart.
  const chartData = useMemo(() => {
    const length = Math.max(snowball.timeline.length, avalanche.timeline.length);
    return Array.from({ length }, (_, m) => ({
      month: m,
      snowball: snowball.timeline[m]?.balance ?? 0,
      avalanche: avalanche.timeline[m]?.balance ?? 0,
    }));
  }, [snowball, avalanche]);

  const addDebt = (e) => {
    e.preventDefault();
    const d = { id: uid(), name: form.name.trim(), balance: +form.balance, apr: +form.apr, minPayment: +form.minPayment };
    if (!d.name || d.balance <= 0 || d.minPayment <= 0) return;
    setDebts((prev) => [...prev, d]);
    setForm(emptyDebt);
  };

  // Edit a single field of a single debt in place (immutably).
  const updateDebt = (id, field, value) =>
    setDebts((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value === '' ? '' : Number(value) } : d)));

  const saved = snowball.totalInterest - avalanche.totalInterest;
  // Warn when minimums don't even cover the monthly interest: the balance would grow forever.
  const stuck = debts.some((d) => Number(d.balance) * (Number(d.apr) / 100 / 12) >= Number(d.minPayment));

  return (
    <div className="stack">
      <section className="card">
        <h2>Your debts</h2>
        <p className="sub">Edit values directly in the table. APR is the yearly interest rate.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Balance</th><th>APR %</th><th>Min. payment</th><th /></tr>
            </thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  {['balance', 'apr', 'minPayment'].map((field) => (
                    <td key={field}>
                      <input type="number" min="0" step="any" value={d[field]} onChange={(e) => updateDebt(d.id, field, e.target.value)} aria-label={`${d.name} ${field}`} style={{ width: '100%' }} />
                    </td>
                  ))}
                  <td className="num">
                    <button className="btn-icon" onClick={() => setDebts((p) => p.filter((x) => x.id !== d.id))} aria-label={`Delete ${d.name}`}><Icon name="close" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="form" onSubmit={addDebt} style={{ marginTop: 14 }}>
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Debt name" />
          <input type="number" min="0" step="any" placeholder="Balance" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} aria-label="Balance" />
          <input type="number" min="0" step="any" placeholder="APR %" value={form.apr} onChange={(e) => setForm({ ...form, apr: e.target.value })} aria-label="APR" />
          <input type="number" min="0" step="any" placeholder="Min. payment" value={form.minPayment} onChange={(e) => setForm({ ...form, minPayment: e.target.value })} aria-label="Minimum payment" />
          <button className="btn btn-primary">Add debt</button>
        </form>
      </section>

      {debts.length > 0 && (
        <>
          <section className="card">
            <div className="row">
              <div>
                <h2>Extra payment per month</h2>
                <p className="sub" style={{ margin: 0 }}>On top of minimums. Total monthly budget: {formatCurrency(avalanche.budget)}</p>
              </div>
              <span className="spacer" />
              {/* A range slider and number box bound to the same state stay in sync automatically. */}
              <input type="range" min="0" max="2000" step="25" value={extra} onChange={(e) => setExtra(+e.target.value)} aria-label="Extra payment slider" />
              <input type="number" min="0" value={extra} onChange={(e) => setExtra(+e.target.value || 0)} style={{ width: 100 }} aria-label="Extra payment" />
            </div>
            {stuck && <Status tone="critical" as="p">A minimum payment doesn't cover its monthly interest. Without extra payments that debt never shrinks.</Status>}
          </section>

          <div className="grid grid-2">
            <StrategyCard icon="snowball" title="Snowball" subtitle="Smallest balance first. Quick wins keep you motivated." result={snowball} color={palette.series[0]} />
            <StrategyCard icon="avalanche" title="Avalanche" subtitle="Highest APR first. Pays the least interest." result={avalanche} color={palette.series[1]} />
          </div>

          <section className="card">
            <h2>Total balance over time</h2>
            <p className="sub">
              {Math.abs(saved) < 1
                ? 'Both strategies cost about the same here.'
                : `Avalanche saves ${formatCurrency(saved)} in interest${avalanche.months < snowball.months ? ` and finishes ${snowball.months - avalanche.months} month${snowball.months - avalanche.months === 1 ? '' : 's'} sooner` : ''}.`}
            </p>
            <div className="chart">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid vertical={false} stroke={palette.grid} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 12 }} tickFormatter={(m) => `${m}mo`} minTickGap={24} />
                  <YAxis tickFormatter={(v) => formatCurrency(v, { compact: true })} tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 12 }} width={56} />
                  <Tooltip content={<ChartTooltip labelFormatter={(m) => `Month ${m} · ${monthsFromNowLabel(m)}`} />} />
                  {/* dot={false} hides per-point circles; activeDot shows one only on hover. */}
                  <Line type="monotone" dataKey="snowball" name="Snowball" stroke={palette.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="avalanche" name="Avalanche" stroke={palette.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="legend">
              <span><span className="dot" style={{ background: palette.series[0] }} />Snowball</span>
              <span><span className="dot" style={{ background: palette.series[1] }} />Avalanche</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StrategyCard({ icon, title, subtitle, result, color }) {
  return (
    <section className="card" style={{ borderTop: `3px solid ${color}` }}>
      <h2>
        <Icon name={icon} />
        {title}
      </h2>
      <p className="sub">{subtitle}</p>
      {result.finished ? (
        <>
          <div className="grid grid-stats" style={{ gap: 8 }}>
            <div><div className="stat-label">Debt-free in</div><div className="stat-value">{result.months} mo</div><div className="stat-hint">{monthsFromNowLabel(result.months)}</div></div>
            <div><div className="stat-label">Total interest</div><div className="stat-value">{formatCurrency(result.totalInterest)}</div></div>
          </div>
          <h3 className="small muted" style={{ margin: '14px 0 4px' }}>Payoff order</h3>
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {result.payoffOrder.map((p) => (
              <li key={`${p.name}-${p.month}`}>{p.name}: month {p.month} ({monthsFromNowLabel(p.month)})</li>
            ))}
          </ol>
        </>
      ) : (
        <Status tone="critical" as="p">Not paid off within 50 years. Increase payments.</Status>
      )}
    </section>
  );
}
