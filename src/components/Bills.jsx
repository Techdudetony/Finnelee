import { useState } from "react";
import Icon from "./Icon";
import EmptyState from "./EmptyState";
import PaidControl from "./PaidControl";
import PaySchedule from "./PaySchedule";
import StatCard from "./StatCard";
import Status, { Notice } from "./Status";
import RecurringSuggestions from "./RecurringSuggestions";
import { namesOf } from "../data/categories";
import { formatCurrency, formatDate, monthLabel, uid } from "../utils/format";
import { nextDueDate } from "../utils/finance";
import {
  buildObligations,
  markBillPaid,
  undoBillPaid,
} from "../utils/obligations";
import { billLinkOptions, linkValue, setBillLink } from "../utils/payments";

const emptyBill = (categories) => ({
  name: "",
  amount: "",
  dueDay: "1",
  category: namesOf(categories, "expense")[0] ?? "",
});

export default function Bills({ store }) {
  const {
    bills,
    setBills,
    transactions,
    setTransactions,
    categories,
    debts,
    accounts,
  } = store;
  const [form, setForm] = useState(() => emptyBill(categories));
  const [notice, setNotice] = useState(""); // said after an Undo that kept a transaction

  // Attach the computed next due date to each bill, soonest first. Derived, never stored.
  const withDates = bills
    .map((b) => ({ ...b, ...nextDueDate(Number(b.dueDay)) }))
    .sort((a, b) => a.daysAway - b.daysAway);

  const monthlyTotal = bills.reduce((s, b) => s + Number(b.amount), 0);
  const dueThisWeek = withDates.filter((b) => b.daysAway <= 7);

  // "This bill pays": what a bill can be linked to, and which links point nowhere now.
  const linkOptions = billLinkOptions(debts, accounts);
  const broken = new Set(
    buildObligations({ debts, accounts, bills })
      .brokenLinks.filter((l) => l.type === "bill")
      .map((l) => l.id),
  );

  const addBill = (e) => {
    e.preventDefault();
    const day = Math.min(31, Math.max(1, Number(form.dueDay)));
    if (!form.name.trim() || !(+form.amount > 0)) return;
    setBills((prev) => [
      ...prev,
      {
        ...form,
        id: uid(),
        name: form.name.trim(),
        amount: +form.amount,
        dueDay: day,
      },
    ]);
    setForm(emptyBill(categories));
  };

  const changeBill = (id, change) =>
    setBills((prev) => prev.map((b) => (b.id === id ? change(b) : b)));

  // "Mark paid" still records the bill as an expense transaction dated today, and now
  // also remembers the month it paid, so Undo can take both back.
  // Rows carry display-only fields (date, daysAway), so save from the stored bill.
  const stored = (id) => bills.find((x) => x.id === id);
  const markPaid = (id) => {
    const b = stored(id);
    const result = markBillPaid(b, transactions, new Date(), uid());
    if (!result.month) return;
    const [tx] = result.transactions; // the new transaction is first
    setTransactions((prev) => [tx, ...prev]);
    changeBill(b.id, () => result.bill);
    setNotice("");
  };

  // Undo removes that month, and the transaction too if it wasn't edited since.
  const undo = (id, month) => {
    const b = stored(id);
    const result = undoBillPaid(b, transactions, month);
    const kept = new Set(result.transactions.map((t) => t.id));
    setTransactions((prev) => prev.filter((t) => kept.has(t.id)));
    changeBill(b.id, () => result.bill);
    setNotice(
      result.keptTransaction
        ? `${b.name} is no longer marked paid for ${monthLabel(month, true)}. Its payment transaction was edited after it was recorded, so it's still on Transactions.`
        : "",
    );
  };

  return (
    <div className="stack">
      <div className="grid grid-stats">
        <StatCard
          label="Recurring per month"
          value={formatCurrency(monthlyTotal)}
        />
        <StatCard label="Per year" value={formatCurrency(monthlyTotal * 12)} />
        <StatCard
          label="Due in next 7 days"
          value={formatCurrency(
            dueThisWeek.reduce((s, b) => s + Number(b.amount), 0),
          )}
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
              {namesOf(categories, "expense").map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary">Add bill</button>
        </form>
      </section>

      <section className="card">
        <h2>Schedule</h2>
        {linkOptions.length > 0 && (
          <p className="sub">
            If a bill is the payment for a debt or loan, choose it under "This
            bill pays" so the payment is counted once.
          </p>
        )}
        {/* Announced once after an Undo that had to keep an edited transaction. */}
        <div role="status">
          {notice && (
            <Notice icon="info" style={{ marginBottom: 12 }}>
              {notice}
            </Notice>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Next due</th>
                <th />
                <th className="num">Amount</th>
                {linkOptions.length > 0 && <th>This bill pays</th>}
                <th>Payment</th>
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
                        {b.daysAway === 0
                          ? "Due today"
                          : `In ${b.daysAway} day${b.daysAway === 1 ? "" : "s"}`}
                      </Status>
                    ) : (
                      <span className="status muted">
                        In {b.daysAway} day{b.daysAway === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatCurrency(b.amount)}</td>
                  {linkOptions.length > 0 && (
                    <td>
                      <select
                        value={broken.has(b.id) ? "" : linkValue(b.payFor)}
                        onChange={(e) =>
                          changeBill(b.id, (x) =>
                            setBillLink(x, e.target.value),
                          )
                        }
                        aria-label={`${b.name}: this bill pays`}
                        aria-describedby={
                          broken.has(b.id) ? `link-${b.id}` : undefined
                        }
                      >
                        <option value="">Nothing linked</option>
                        {linkOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {broken.has(b.id) && (
                        <div
                          id={`link-${b.id}`}
                          className="small status-warning"
                        >
                          The linked debt or loan was deleted or paid off.
                          Choose again or{" "}
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() =>
                              changeBill(b.id, (x) => setBillLink(x, ""))
                            }
                          >
                            leave it unlinked
                          </button>
                          .
                        </div>
                      )}
                    </td>
                  )}
                  <td>
                    <PaidControl
                      record={b}
                      name={b.name}
                      onMark={() => markPaid(b.id)}
                      onUndo={(month) => undo(b.id, month)}
                    />
                  </td>
                  <td className="num">
                    <button
                      className="btn-icon"
                      onClick={() =>
                        setBills((p) => p.filter((x) => x.id !== b.id))
                      }
                      aria-label={`Delete ${b.name}`}
                    >
                      <Icon name="close" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bills.length === 0 && (
            <EmptyState icon="bills" title="No recurring bills yet">
              Add one above to see what's due and when.
            </EmptyState>
          )}
        </div>
      </section>

      <PaySchedule store={store} />
    </div>
  );
}
