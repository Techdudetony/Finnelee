import { useMemo, useState } from 'react';
import CsvImport from './CsvImport';
import Icon from './Icon';
import { namesOf } from '../data/categories';
import { formatCurrency, formatDate, monthLabel, todayISO, uid } from '../utils/format';

// The blank form. Keeping it as a function means each reset gets a fresh object and today's date.
// The default category is the user's first expense category (their list can change).
const emptyForm = (categories) => ({
  date: todayISO(),
  description: '',
  type: 'expense',
  category: namesOf(categories, 'expense')[0] ?? '',
  amount: '',
});

export default function Transactions({ store }) {
  const { transactions, setTransactions, categories: allCategories } = store;
  const [form, setForm] = useState(() => emptyForm(allCategories));
  const [filters, setFilters] = useState({
    search: '',
    month: 'all',
    type: 'all',
    category: 'all',
  });

  // One change handler for every input: uses the input's `name` attribute as the key.
  // [name]: value is a "computed property name" so we don't need one handler per field.
  const updateForm = (e) => {
    const { name, value } = e.target;
    setForm((f) => {
      const next = { ...f, [name]: value }; // never mutate state; copy then change
      // Switching type resets the category to a valid one for that type.
      if (name === 'type') next.category = namesOf(allCategories, value)[0] ?? '';
      return next;
    });
  };
  const updateFilter = (e) => setFilters((f) => ({ ...f, [e.target.name]: e.target.value }));

  const addTransaction = (e) => {
    e.preventDefault(); // stop the browser's default full-page form submit
    const amount = parseFloat(form.amount);
    if (!form.description.trim() || !(amount > 0)) return;
    const tx = { ...form, id: uid(), description: form.description.trim(), amount };
    // Functional update (prev => ...) is safest when new state depends on old state.
    setTransactions((prev) => [tx, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setForm(emptyForm(allCategories));
  };

  const remove = (id) => setTransactions((prev) => prev.filter((t) => t.id !== id));

  // Distinct months present in the data, newest first, for the month filter.
  const months = useMemo(
    () => [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [transactions],
  );

  const visible = useMemo(() => {
    const q = filters.search.toLowerCase();
    return transactions.filter(
      (t) =>
        (filters.month === 'all' || t.date.startsWith(filters.month)) &&
        (filters.type === 'all' || t.type === filters.type) &&
        (filters.category === 'all' || t.category === filters.category) &&
        (!q || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)),
    );
  }, [transactions, filters]);

  const totals = visible.reduce(
    (acc, t) => ({ ...acc, [t.type]: acc[t.type] + Number(t.amount) }),
    { income: 0, expense: 0 },
  );

  const categories = namesOf(allCategories, form.type);

  return (
    <div className="stack">
      <section className="card">
        <h2>Add transaction</h2>
        <p className="sub">Amounts are always positive; the type decides money in or out.</p>
        <form className="form" onSubmit={addTransaction}>
          <label className="field">
            Date
            <input type="date" name="date" value={form.date} onChange={updateForm} required />
          </label>
          <label className="field">
            Description
            <input
              name="description"
              value={form.description}
              onChange={updateForm}
              placeholder="e.g. Coffee"
              required
            />
          </label>
          <label className="field">
            Type
            <select name="type" value={form.type} onChange={updateForm}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label className="field">
            Category
            <select name="category" value={form.category} onChange={updateForm}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Amount
            <input
              type="number"
              name="amount"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={updateForm}
              placeholder="0.00"
              required
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
      </section>

      <CsvImport store={store} />

      <section className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2>History</h2>
          <span className="spacer" />
          <span className="small muted">
            {visible.length} items · In{' '}
            <strong className="amount-income">{formatCurrency(totals.income)}</strong> · Out{' '}
            <strong>{formatCurrency(totals.expense)}</strong>
          </span>
          <button className="btn" onClick={() => exportCSV(visible)} disabled={!visible.length}>
            Export CSV
          </button>
        </div>

        <div className="form" style={{ marginBottom: 12 }}>
          <input
            name="search"
            value={filters.search}
            onChange={updateFilter}
            placeholder="Search…"
            aria-label="Search"
          />
          <select name="month" value={filters.month} onChange={updateFilter} aria-label="Month">
            <option value="all">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, true)}
              </option>
            ))}
          </select>
          <select name="type" value={filters.type} onChange={updateFilter} aria-label="Type">
            <option value="all">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <select
            name="category"
            value={filters.category}
            onChange={updateFilter}
            aria-label="Category"
          >
            <option value="all">All categories</option>
            {allCategories.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{formatDate(t.date)}</td>
                  <td>{t.description}</td>
                  <td>
                    <span className="pill">{t.category}</span>
                  </td>
                  <td className={`num ${t.type === 'income' ? 'amount-income' : ''}`}>
                    {t.type === 'income' ? '+' : '−'}
                    {formatCurrency(t.amount)}
                  </td>
                  <td className="num">
                    <button
                      className="btn-icon"
                      onClick={() => remove(t.id)}
                      aria-label={`Delete ${t.description}`}
                    >
                      <Icon name="close" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="empty">No transactions match.</p>}
        </div>
      </section>
    </div>
  );
}

/** Builds a CSV string and triggers a browser download, no server needed. */
function exportCSV(rows) {
  // Wrap every value in quotes and double any inner quotes: the CSV escaping rule.
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ['date', 'description', 'category', 'type', 'amount'].join(','),
    ...rows.map((t) => [t.date, t.description, t.category, t.type, t.amount].map(esc).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob); // temporary URL pointing at the in-memory file
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url); // free the memory
}
