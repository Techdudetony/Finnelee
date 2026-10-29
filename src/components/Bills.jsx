import { useState } from 'react';
import Icon from './Icon';
import StatCard from './StatCard';
import Status from './Status';
import RecurringSuggestions from './RecurringSuggestions';
import { namesOf } from '../data/categories';
import { formatCurrency, formatDate, todayISO, uid } from '../utils/format';
import { nextDueDate } from '../utils/finance';

const emptyBill = (categories) => ({
  name: '',
  amount: '',
  dueDay: '1',
  category: namesOf(categories, 'expense')[0] ?? '',
});

export default function Bills({ store }) {
  const { bills, setBills, setTransactions, categories } = store;
  const [form, setForm] = useState(() => emptyBill(categories));

  // Attach the computed next due date to each bill, soonest first. Derived, never stored.
  const withDates = bills
    .map((b) => ({ ...b, ...nextDueDate(Number(b.dueDay)) }))
    .sort((a, b) => a.daysAway - b.daysAway);

  const monthlyTotal = bills.reduce((s, b) => s + Number(b.amount), 0);
  const dueThisWeek = withDates.filter((b) => b.daysAway <= 7);

  const addBill = (e) => {
    e.preventDefault();
    const day = Math.min(31, Math.max(1, Number(form.dueDay)));
    if (!form.name.trim() || !(+form.amount > 0)) return;
    setBills((prev) => [
      ...prev,
      { ...form, id: uid(), name: form.name.trim(), amount: +form.amount, dueDay: day },
    ]);
    setForm(emptyBill(categories));
  };

  // "Mark paid" records the bill as a real expense transaction dated today.
  const markPaid = (b) =>
    setTransactions((prev) => [
      {
        id: uid(),
        date: todayISO(),
        description: b.name,
        category: b.category,
        type: 'expense',
        amount: Number(b.amount),
      },
      ...prev,
    ]);

  return (
    <div className="stack">
      <div className="grid grid-stats">
        <StatCard label="Recurring per month" value={formatCurrency(monthlyTotal)} />
        <StatCard label="Per year" value={formatCurrency(monthlyTotal * 12)} />
        <StatCard
          label="Due in next 7 days"
          value={formatCurrency(dueThisWeek.reduce((s, b) => s + Number(b.amount), 0))}
          hint={`${dueThisWeek.length} bill(s)`}
        />
      </div>

      <RecurringSuggestions store={store} />

      <section className="card">
        <h2>Add recurring bill</h2>
        <form className="form" onSubmit={addBill} style={{ marginTop: 10 }}>
          <label className="field">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Phone"
            />
          </label>
          <label className="field">
            Amount
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label className="field">
            Due day (1–31)
            <input
              type="number"
              min="1"
              max="31"
              value={form.dueDay}
              onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
            />
          </label>
          <label className="field">
            Category
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {namesOf(categories, 'expense').map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary">Add bill</button>
        </form>
      </section>

      <section className="card">
        <h2>Schedule</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Next due</th>
                <th />
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {withDates.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.name} <span className="pill">{b.category}</span>
                  </td>
                  <td className="muted">{formatDate(b.date)}</td>
                  <td>
                    {b.daysAway <= 3 ? (
                      <Status tone="warning" icon="clock">
                        {b.daysAway === 0 ? 'Due today' : `In ${b.daysAway} days`}
                      </Status>
                    ) : (
                      <span className="status muted">In {b.daysAway} days</span>
                    )}
                  </td>
                  <td className="num">{formatCurrency(b.amount)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn" onClick={() => markPaid(b)}>
                      Mark paid
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => setBills((p) => p.filter((x) => x.id !== b.id))}
                      aria-label={`Delete ${b.name}`}
                    >
                      <Icon name="close" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bills.length === 0 && <p className="empty">No recurring bills yet.</p>}
        </div>
      </section>
    </div>
  );
}
