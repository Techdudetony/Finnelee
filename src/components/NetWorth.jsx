import { useId, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip';
import Icon from './Icon';
import EmptyState from './EmptyState';
import OptionalNumber from './OptionalNumber';
import PaidControl from './PaidControl';
import StatCard from './StatCard';
import CountUp from './CountUp';
import { useNewItems } from '../hooks/useNewItems';
import Status, { Notice } from './Status';
import { useColorScheme } from '../hooks/useColorScheme';
import { useMotion } from '../hooks/useMotion';
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
import { markPaid, undoPaid } from '../utils/obligations';
import { debtOptions, dueDayProblem, paymentProblem, setDebtLink, setOptional } from '../utils/payments';

const emptyForm = { name: '', type: 'asset', kind: 'cash', balance: '', notInDebtPlanner: false };
const signed = (n) => (n > 0 ? '+' : '') + formatCurrency(n);

/** Net worth page: manual accounts + Debt Planner debts, and a chart of monthly snapshots. */
export default function NetWorth({ store, goTo }) {
  const { debts, settings, setAccounts } = store;
  const accounts = readAccounts(store.accounts);
  const palette = getPalette(useColorScheme());
  const animate = useMotion() === 'full'; // charts draw in at Full motion only
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
  // Payment details on a liability: change(account) returns the edited copy.
  const changeAccount = (id, change) =>
    setAccounts((prev) => readAccounts(prev).map((a) => (a.id === id ? change(a) : a)));

  const assets = accounts.filter((a) => a.type === 'asset');
  const liabilities = accounts.filter((a) => a.type === 'liability');
  const financed = form.type === 'asset' && (form.kind === 'property' || form.kind === 'vehicle');

  return (
    <div className="stack">
      <div className="grid grid-stats">
        <StatCard label="Assets" value={<CountUp value={totals.assets} format={formatCurrency} />} hint={`${assets.length} account(s)`} />
        <StatCard
          label="Liabilities"
          value={<CountUp value={totals.liabilities} format={formatCurrency} />}
          hint={`${formatCurrency(totals.debtLiabilities)} Debt Planner + ${formatCurrency(totals.accountLiabilities)} other`}
        />
        <StatCard
          label="Net worth"
          value={<CountUp value={totals.netWorth} format={formatCurrency} />}
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
                <Line isAnimationActive={animate} dataKey="netWorth" name="Net worth" stroke={palette.series[0]} strokeWidth={2.5} dot={{ r: 3 }} />
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

      <AccountTable
        title="Assets"
        rows={assets}
        onBalance={setBalance}
        onDelete={remove}
        empty={{ title: 'No assets yet', text: 'Add a checking, savings or investment account above.' }}
      />
      <AccountTable
        title="Other liabilities"
        rows={liabilities}
        onBalance={setBalance}
        onDelete={remove}
        empty={{ title: 'No other liabilities', text: 'Debts in the Debt Planner are counted automatically (below).' }}
        details={(a) => (
          <LiabilityDetails account={a} debts={debts} onChange={(change) => changeAccount(a.id, change)} />
        )}
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
          <EmptyState icon="debt" title="No debts in the Debt Planner" compact />
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
function AccountTable({ title, rows, onBalance, onDelete, empty, details }) {
  const isNew = useNewItems(rows); // only accounts added after the page opened fade in
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <EmptyState icon="networth" title={empty.title} compact>
          {empty.text}
        </EmptyState>
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
              {rows.map((a) => [
                <tr key={a.id} className={isNew(a.id) ? 'row-new' : undefined}>
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
                </tr>,
                // Optional second row (liabilities): payment, due day, link, Mark paid.
                details && (
                  <tr key={`${a.id}-details`} className="row-details">
                    <td colSpan={5}>{details(a)}</td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * A liability's payment details, all optional: monthly payment (for Debt load), due day,
 * "Same as Debt Planner debt" (so one loan is counted once) and Mark paid. A linked
 * liability is marked paid on its debt instead, so the month is recorded in one place.
 * Number boxes save only valid values (see OptionalNumber).
 */
function LiabilityDetails({ account: a, debts, onChange }) {
  const id = useId();
  const options = debtOptions(debts);
  const linked = options.find((o) => o.value === String(a.debtId));
  const broken = a.debtId != null && a.debtId !== '' && !linked;
  return (
    <div className="obligation-fields">
      <div className="field-box">
        <label className="field" htmlFor={`${id}-pay`}>
          Monthly payment
        </label>
        <OptionalNumber
          id={`${id}-pay`}
          value={a.monthlyPayment}
          problemOf={paymentProblem}
          onSave={(text) => onChange((x) => setOptional(x, 'monthlyPayment', text))}
          min="0"
          step="any"
          placeholder="Optional"
        />
      </div>
      <div className="field-box">
        <label className="field" htmlFor={`${id}-day`}>
          Due day
        </label>
        <OptionalNumber
          id={`${id}-day`}
          value={a.dueDay}
          problemOf={dueDayProblem}
          onSave={(text) => onChange((x) => setOptional(x, 'dueDay', text))}
          min="1"
          max="31"
          step="1"
          placeholder="Optional"
        />
      </div>
      {(options.length > 0 || broken) && (
        <div className="field-box">
          <label className="field">
            Same as Debt Planner debt
            <select
              value={linked ? linked.value : ''}
              onChange={(e) => onChange((x) => setDebtLink(x, e.target.value))}
              aria-describedby={broken ? `${id}-link` : undefined}
            >
              <option value="">Not linked</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {broken && (
            <span id={`${id}-link`} className="small status-warning">
              The linked debt was deleted or paid off. Choose again or{' '}
              <button type="button" className="link-btn" onClick={() => onChange((x) => setDebtLink(x, ''))}>
                leave unlinked
              </button>
              .
            </span>
          )}
        </div>
      )}
      <div className="field-box">
        <span className="field-label">Payment</span>
        {linked ? (
          <span className="small muted">Mark it paid on the Debt Planner, under {linked.label}.</span>
        ) : (
          <PaidControl
            record={a}
            name={a.name}
            onMark={(month) => onChange((x) => markPaid(x, month))}
            onUndo={(month) => onChange((x) => undoPaid(x, month))}
          />
        )}
      </div>
    </div>
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
