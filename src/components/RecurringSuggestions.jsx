import { useMemo } from 'react';
import { detectRecurring, toBill } from '../utils/recurring';
import { formatCurrency, formatDate } from '../utils/format';

// 1 -> '1st', 12 -> '12th', 22 -> '22nd'
const ordinal = (n) => {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
};

/** Monthly charges found in transactions that aren't bills yet. Hidden when there are none. */
export default function RecurringSuggestions({ store }) {
  const { transactions, bills, setBills, settings, setSettings } = store;

  // Depend on the stored array itself: `?? []` outside useMemo would be a new array every render.
  const suggestions = useMemo(
    () => detectRecurring(transactions, bills, { dismissed: settings.dismissedRecurring ?? [] }),
    [transactions, bills, settings.dismissedRecurring],
  );

  // Once it's a bill, the detector skips it, so the suggestion disappears on its own.
  const addAsBill = (s) => setBills((prev) => [...prev, toBill(s)]);

  const dismiss = (key) =>
    setSettings((prev) => ({
      ...prev,
      dismissedRecurring: [...(prev.dismissedRecurring ?? []), key],
    }));

  if (!suggestions.length) return null;

  return (
    <section className="card">
      <h2>Looks like a bill</h2>
      <p className="sub">These charges repeat every month. Add them to track due dates.</p>
      <ul className="list">
        {suggestions.map((s) => (
          <li key={s.key} style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>
                {s.name} <span className="pill">{s.category}</span>
              </div>
              <div className="small muted">
                About {formatCurrency(s.amount)} around the {ordinal(s.dueDay)} · {s.count} months
                in a row · last {formatDate(s.lastDate)}
              </div>
            </div>
            <button
              className="btn"
              onClick={() => addAsBill(s)}
              aria-label={`Add ${s.name} as a bill`}
            >
              Add as bill
            </button>
            <button
              className="btn-icon"
              onClick={() => dismiss(s.key)}
              aria-label={`Dismiss ${s.name}`}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
