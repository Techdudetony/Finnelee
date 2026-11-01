import { useMemo } from "react";
import Icon from "./Icon";
import Status from "./Status";
import { formatCurrency, formatDate } from "../utils/format";
import { spendingEstimate } from "../utils/health";

/**
 * "This month's spending room": the budget estimate and the estimated spendable amount,
 * from spendingEstimate() in health.js (unchanged). Neither is called "safe": both come
 * from records typed by hand. Every amount behind the figure is listed in the details.
 */
export default function SpendingCard({ store, goTo }) {
  const { transactions, bills, goals, debts, accounts, settings } = store;
  const est = useMemo(
    () =>
      spendingEstimate({
        transactions,
        bills,
        goals,
        debts,
        accounts,
        settings,
      }),
    [transactions, bills, goals, debts, accounts, settings],
  );
  const { spendable, budget, headline, window: win } = est;

  // The line under the headline: whichever figure isn't the headline.
  const second =
    headline?.label === budget.label
      ? spendable.status === "complete" || spendable.status === "conflict"
        ? { label: spendable.label, amount: spendable.amount }
        : null
      : budget.shown
        ? { label: budget.label, amount: budget.amount }
        : null;

  // "Mortgage payment unknown": open the page where that payment is entered.
  const missingPage = (name) =>
    debts.some((d) => d.name === name) ? "debt" : "networth";

  return (
    <section className="card spend-card" aria-labelledby="spend-title">
      <h2 id="spend-title">{est.title}</h2>

      {headline ? (
        <div className="spend-headline">
          <span className="stat-label">{headline.label}</span>
          {headline.amount !== null && (
            <span
              className={`spend-amount num${headline.amount < 0 ? " status-critical" : ""}`}
            >
              {formatCurrency(headline.amount)}
            </span>
          )}
        </div>
      ) : (
        <p className="muted">
          Add this month's transactions or update your checking balance to see
          an estimate.
        </p>
      )}

      {spendable.shortfall && (
        <Status tone="critical" as="p">
          {spendable.shortfall}
        </Status>
      )}
      {spendable.status === "incomplete" && (
        <div className="stack spend-incomplete">
          {spendable.missing.map((name) => (
            <button
              key={name}
              type="button"
              className="link-btn"
              onClick={() => goTo(missingPage(name))}
            >
              {name} payment unknown. Add it to finish this estimate.
            </button>
          ))}
          <span className="small">{spendable.limitText}</span>
        </div>
      )}
      {spendable.status === "needs-cash" && (
        <button
          type="button"
          className="link-btn spend-action"
          onClick={() => goTo("networth")}
        >
          {spendable.action}
        </button>
      )}
      {spendable.note && (
        <Status tone="warning" as="p">
          {spendable.note}
        </Status>
      )}
      {second && (
        <p className="small spend-second">
          {second.label}:{" "}
          <strong className="num">{formatCurrency(second.amount)}</strong>
        </p>
      )}

      {est.lines?.length > 0 && (
        <details className="spend-details">
          <summary>How this is worked out</summary>
          <p className="small muted">
            Counting payments {win.text}: {formatDate(win.start)} to{" "}
            {formatDate(win.end)}.
          </p>
          <ul className="list spend-lines">
            {est.lines.map((l, i) => (
              <li key={i} className="small">
                <span>
                  {l.label}
                  <span className="muted">
                    {" "}
                    · {l.source}
                    {l.date ? ` · ${formatDate(l.date)}` : ""}
                  </span>
                </span>
                <span className="spacer" />
                <span className="num">
                  {l.amount === null
                    ? "Unknown"
                    : (l.amount > 0 ? "+" : "") + formatCurrency(l.amount)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="small muted spend-caption">
        <Icon name="info" size={14} /> {est.caption}
      </p>
    </section>
  );
}
