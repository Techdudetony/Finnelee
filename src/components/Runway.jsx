import { useMemo, useState } from "react";
import EmptyState from "./EmptyState";
import {
  formatCurrency,
  formatDate,
  parseDate,
  toISODate,
} from "../utils/format";
import { runwayEvents } from "../utils/health";
import { addDays } from "../utils/obligations";

const DAYS = 14;
const weekday = (iso) =>
  parseDate(iso).toLocaleDateString("en-US", { weekday: "short" });
const dayNumber = (iso) => Number(iso.slice(8));

/**
 * The next 14 days: bills (and dated debt payments) on their due dates, paydays only from
 * a saved pay schedule, and an optional dashed projection. From runwayEvents() in
 * health.js (unchanged). Every item is also listed as text under the strip.
 */
export default function Runway({ store, goTo }) {
  const { bills, debts, accounts, settings } = store;
  // One calendar day for both the events and the dates shown: after midnight the next
  // render recomputes both, so they never mix two days.
  const start = toISODate(new Date());
  const run = useMemo(
    () => runwayEvents({ bills, debts, accounts, settings }, parseDate(start)),
    [bills, debts, accounts, settings, start],
  );
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const byDate = new Map(run.days.map((d) => [d.date, d]));
  const payOn = new Map(run.paydays.map((p) => [p.date, p]));
  const [active, setActive] = useState(null); // day shown in the detail line

  // One line per day, also used as the day button's accessible name.
  const describe = (date) => {
    const day = byDate.get(date);
    const pay = payOn.get(date);
    const parts = [];
    if (pay)
      parts.push(
        pay.amount !== null
          ? `Payday, ${formatCurrency(pay.amount)}`
          : "Payday",
      );
    if (day)
      parts.push(
        ...day.items.map(
          (i) =>
            `${i.name}, ${i.amount === null ? "amount unknown" : formatCurrency(i.amount)}`,
        ),
        day.items.length > 1
          ? `${formatCurrency(day.total)} in bills that day`
          : "",
      );
    return `${formatDate(date)}: ${parts.filter(Boolean).join("; ") || "nothing due"}`;
  };

  // Projection: a step line from the recently updated cash balance (dashed).
  const proj = run.projection;
  let path = null;
  let lowest = null;
  let startCash = null;
  if (proj) {
    const values = proj.map((p) => p.balance);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const y = (v) => 6 + (1 - (v - min) / span) * 48;
    const x = (i) => (i / DAYS) * 100;
    path = proj
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(i)} ${y(p.balance)} L${x(i + 1)} ${y(p.balance)}`,
      )
      .join(" ");
    lowest = proj.reduce((a, b) => (b.balance < a.balance ? b : a));
    // The cash it starts from: today's balance before today's bills and pay.
    startCash =
      proj[0].balance +
      (byDate.get(start)?.total ?? 0) -
      (payOn.get(start)?.amount ?? 0);
  }

  return (
    <section className="card runway" aria-labelledby="runway-title">
      <div className="row">
        <h2 id="runway-title">Next 14 days</h2>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => goTo("bills")}>
          Bills
        </button>
      </div>

      <div className="runway-scroll">
        <div className="runway-strip">
          {path && (
            <svg
              className="runway-projection"
              viewBox="0 0 100 60"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d={path} />
            </svg>
          )}
          <ol className="runway-days">
            {dates.map((date) => {
              const day = byDate.get(date);
              const pay = payOn.get(date);
              return (
                <li key={date}>
                  <button
                    type="button"
                    className={`runway-day${active === date ? " is-active" : ""}`}
                    aria-label={describe(date)}
                    onClick={() => setActive(date)} // tap (hover and focus also show it)
                    onMouseEnter={() => setActive(date)}
                    onFocus={() => setActive(date)}
                  >
                    <span className="runway-weekday" aria-hidden="true">
                      {weekday(date)}
                    </span>
                    <span className="runway-date" aria-hidden="true">
                      {dayNumber(date)}
                    </span>
                    <span className="runway-marks" aria-hidden="true">
                      {pay && <span className="runway-pay" />}
                      {day?.items.map((i) => (
                        <span key={i.key + i.name} className="runway-bill" />
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* Hover, focus or tap a day: its items and amounts, in words. */}
      <p className="small runway-detail" aria-live="polite">
        {active ? describe(active) : "Choose a day to see what's due."}
      </p>

      {proj && (
        <p className="small muted runway-legend">
          <span className="runway-dash" aria-hidden="true" />{" "}
          {run.projectionLabel}: from {formatCurrency(startCash)} recently
          updated cash, lowest {formatCurrency(lowest.balance)} on{" "}
          {formatDate(lowest.date)}.
        </p>
      )}
      {run.projectionNote && (
        <p className="small muted">{run.projectionNote}.</p>
      )}
      {run.caption && <p className="small muted">{run.caption}</p>}

      {run.empty && run.paydays.length === 0 ? (
        <EmptyState icon="bills" title={run.empty} compact>
          <button
            type="button"
            className="link-btn"
            onClick={() => goTo("bills")}
          >
            Add or check bills
          </button>
        </EmptyState>
      ) : (
        <ul className="list runway-list">
          {dates.flatMap((date) => [
            ...(payOn.has(date)
              ? [
                  <li key={`${date}-pay`} className="small">
                    <span className="runway-pay" aria-hidden="true" />
                    <span>Payday · {formatDate(date)}</span>
                    <span className="spacer" />
                    <span className="num">
                      {payOn.get(date).amount !== null
                        ? `+${formatCurrency(payOn.get(date).amount)}`
                        : "Amount not saved"}
                    </span>
                  </li>,
                ]
              : []),
            ...(byDate.get(date)?.items ?? []).map((i) => (
              <li key={`${date}-${i.key}-${i.name}`} className="small">
                <span className="runway-bill" aria-hidden="true" />
                <span>
                  {i.name} · {formatDate(date)}
                </span>
                <span className="spacer" />
                <span className="num">
                  {i.amount === null ? "Unknown" : formatCurrency(i.amount)}
                </span>
              </li>
            )),
          ])}
        </ul>
      )}
    </section>
  );
}
