import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip';
import Icon from './Icon';
import StatCard from './StatCard';
import Status, { Notice } from './Status';
import { useColorScheme } from '../hooks/useColorScheme';
import { getPalette } from '../utils/colors';
import { formatCurrency, formatDate } from '../utils/format';
import {
  ASSET_KINDS,
  LIABILITY_KINDS,
  changeSinceLastSnapshot,
  historySeries,
  isStale,
  kindLabel,
  liquidSavings,
  netWorthTotals,
  needsDebtConfirmation,
  newAccount,
  parseBalance,
  readAccounts,
  updateBalance,
} from '../utils/netWorth';

const emptyForm = { name: '', type: 'asset', kind: 'cash', balance: '', notInDebtPlanner: false };
const signed = (n) => (n > 0 ? '+' : '') + formatCurrency(n);

/** Net worth page: manual accounts + Debt Planner debts, and a chart of monthly snapshots. */
export default function NetWorth({ store, goTo }) {
  const { debts, settings, setAccounts } = store;
  const accounts = readAccounts(store.accounts);
  const palette = getPalette(useColorScheme());
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const totals = netWorthTotals(accounts, debts);
  const series = useMemo(() => historySeries(settings), [settings]);
  const change = changeSinceLastSnapshot(settings, totals.netWorth);
  const liquid = liquidSavings(accounts);

  // Switching type resets the kind to that type's first option and clears the confirmation.
  const update = (field) => (e) =>
    setForm((f) =>
      field === 'type'
        ? {
            ...f,
            type: e.target.value,
            kind: (e.target.value === 'asset' ? ASSET_KINDS : LIABILITY_KINDS)[0].id,
            notInDebtPlanner: false,
          }
        : { ...f, [field]: field === 'notInDebtPlanner' ? e.target.checked : e.target.value },
    );
  const mustConfirm = needsDebtConfirmation(form.type, debts);

  const addAccount = (e) => {
    e.preventDefault();
    const result = newAccount(form, undefined, debts);
    if (result.error) return setError(result.error);
    setAccounts((prev) => [...readAccounts(prev), result.account]);
    setForm(emptyForm);
    setError('');
  };

  const setBalance = (id, value) => setAccounts((prev) => updateBalance(readAccounts(prev), id, value));
  const remove = (id) => setAccounts((prev) => readAccounts(prev).filter((a) => a.id !== id));

  const assets = accounts.filter((a) => a.type === 'asset');
  const liabilities = accounts.filter((a) => a.type === 'liability');
  const financed = form.type === 'asset' && (form.kind === 'property' || form.kind === 'vehicle');

  return (
    <div className="stack">
      <div className="grid grid-stats">
        <StatCard label="Assets" value={formatCurrency(totals.assets)} hint={`${assets.length} account(s)`} />
        <StatCard
          label="Liabilities"
          value={formatCurrency(totals.liabilities)}
          hint={`${formatCurrency(totals.debtLiabilities)} Debt Planner + ${formatCurrency(totals.accountLiabilities)} other`}
        />
        <StatCard
          label="Net worth"
          value={formatCurrency(totals.netWorth)}
          hint={
            accounts.length === 0
              ? 'Add your accounts below to see it'
              : change
                ? `${signed(change.amount)} since ${change.since}`
                : 'Change appears after your first full month'
          }
        />
      </div>

      {series.length >= 2 && (
        <section className="card">
          <h2>Net worth over time</h2>
          <p className="sub">
            Recorded snapshots: the latest totals Finnelee saw during each month, not month-end
            statements. Months where balances weren't updated may be out of date.
          </p>
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke={palette.grid} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: palette.axis, fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) => formatCurrency(v, { compact: true })}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: palette.axis, fontSize: 12 }}
                  width={60}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line dataKey="netWorth" name="Net worth" stroke={palette.series[0]} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Add an account</h2>
        <p className="sub">
          Balances are entered by hand and stay in this browser. Update them whenever you check
          your bank.
        </p>
        <form className="form" onSubmit={addAccount}>
          <label className="field">
            Name
            <input value={form.name} onChange={update('name')} placeholder="e.g. Ally savings" />
          </label>
          <label className="field">
            Type
            <select value={form.type} onChange={update('type')}>
              <option value="asset">Asset (what you own)</option>
              <option value="liability">Liability (what you owe)</option>
            </select>
          </label>
          <label className="field">
            Kind
            <select value={form.kind} onChange={update('kind')}>
              {(form.type === 'asset' ? ASSET_KINDS : LIABILITY_KINDS).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {financed ? 'Market value' : 'Balance'}
            <input type="number" min="0" step="any" value={form.balance} onChange={update('balance')} />
          </label>
          <button className="btn btn-primary" disabled={mustConfirm && !form.notInDebtPlanner}>
            Add account
          </button>
        </form>

        {/* Guidance that prevents double counting, shown where the mistake would happen. */}
        {form.type === 'liability' && (
          <Notice icon="debt" style={{ marginTop: 12 }}>
            <span>
              Loans and credit cards in the Debt Planner are already counted
              {debts.length > 0
                ? `: ${debts.map((d) => d.name).join(', ')} (${formatCurrency(totals.debtLiabilities)}).`
                : '.'}{' '}
              Only add a debt here if it isn't in the Debt Planner. <strong>If your mortgage is
              already in the Debt Planner, don't add it again.</strong>
            </span>
          </Notice>
        )}
        {/* A required tick (not name matching) is the safeguard: Add stays disabled until it's checked. */}
        {mustConfirm && (
          <label className="row small" style={{ gap: 8, marginTop: 10 }}>
            <input type="checkbox" checked={form.notInDebtPlanner} onChange={update('notInDebtPlanner')} />
            This debt is not in the Debt Planner, so it isn't counted yet.
          </label>
        )}
        {financed && (
          <Notice icon="idea" style={{ marginTop: 12 }}>
            Enter what it would sell for today, without subtracting the loan. The loan is tracked
            separately: in the Debt Planner, or here as a mortgage if it isn't there.
          </Notice>
        )}
        {error && (
          <Status tone="critical" as="p" role="alert" style={{ marginBottom: 0 }}>
            {error}
          </Status>
        )}
      </section>

      <AccountTable title="Assets" rows={assets} onBalance={setBalance} onDelete={remove} empty="No assets yet." />
      <AccountTable
        title="Other liabilities"
        rows={liabilities}
        onBalance={setBalance}
        onDelete={remove}
        empty="None. Debts in the Debt Planner are counted automatically (below)."
      />

      <section className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>From the Debt Planner</h2>
          <span className="spacer" />
          <button className="btn" onClick={() => goTo('debt')}>
            <Icon name="debt" />
            Edit debts
          </button>
        </div>
        <p className="sub">Counted automatically, and always using the current balances.</p>
        {debts.length === 0 ? (
          <p className="empty">No debts in the Debt Planner.</p>
        ) : (
          <ul className="list">
            {debts.map((d) => (
              <li key={d.id}>
                <span style={{ flex: 1 }}>{d.name}</span>
                <span className="num">{formatCurrency(d.balance)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {liquid.count > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Your cash and savings accounts total {formatCurrency(liquid.amount)}. To use them as your
          savings in the Forecast and emergency-fund numbers, choose it on the{' '}
          <button className="link-btn" onClick={() => goTo('forecast')}>
            Forecast page
          </button>
          .
        </p>
      )}
    </div>
  );
}

/** One table of accounts with inline balance editing. */
function AccountTable({ title, rows, onBalance, onDelete, empty }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th style={{ width: 150 }}>Balance</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="muted">{kindLabel(a.type, a.kind)}</td>
                  <td>
                    <BalanceInput account={a} onSave={onBalance} />
                  </td>
                  <td>
                    {isStale(a) ? (
                      <Status tone="warning" icon="clock">
                        {a.updated ? formatDate(a.updated) : 'Never'}: update it
                      </Status>
                    ) : (
                      <span className="muted small">{formatDate(a.updated)}</span>
                    )}
                  </td>
                  <td className="num">
                    <button className="btn-icon" onClick={() => onDelete(a.id)} aria-label={`Delete ${a.name}`}>
                      <Icon name="close" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Balance cell. What you type lives in local state (`draft`) and is saved only when it's a
 * valid amount, so clearing the box or typing "-" never reaches totals or the snapshot.
 * Leaving the field with an invalid value puts the saved balance back.
 */
function BalanceInput({ account, onSave }) {
  const [draft, setDraft] = useState(null); // null = show the saved balance
  const problem = draft === null ? null : parseBalance(draft).error;

  const change = (e) => {
    setDraft(e.target.value);
    if (!parseBalance(e.target.value).error) onSave(account.id, e.target.value);
  };

  return (
    <>
      <input
        type="number"
        min="0"
        step="any"
        value={draft ?? account.balance}
        onChange={change}
        onBlur={() => setDraft(null)}
        aria-label={`${account.name} balance`}
        aria-invalid={Boolean(problem)}
        style={{ width: '100%' }}
      />
      {problem && <div className="small status-critical">{problem} Not saved.</div>}
    </>
  );
}
