// What-If page: try a plan and compare it with today's path. A sandbox: it reads the
// store and never calls a setter, and the levers live in this page's state only, so they
// reset when you leave. All the math is in utils/whatIf.js.
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartTooltip from "./ChartTooltip";
import EmptyState from "./EmptyState";
import Icon from "./Icon";
import Status, { Notice } from "./Status";
import { useColorScheme } from "../hooks/useColorScheme";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useMotion } from "../hooks/useMotion";
import { getPalette } from "../utils/colors";
import { monthsFromNowLabel, monthsUntil } from "../utils/finance";
import { formatCurrency } from "../utils/format";
import {
  MAX_CUTS,
  MAX_LEVER,
  ORB_MONTH,
  ZERO_LEVERS,
  openGoals,
  simulate,
} from "../utils/whatIf";

const FOOTER =
  "Estimates assume your recorded income and spending continue. Not financial advice.";
const money = (n) => formatCurrency(n, { whole: true });
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Ledger month m is m months from now, as on Forecast and Debt Planner.
const monthName = (m) => monthsFromNowLabel(m);

export default function WhatIf({ store, openTask }) {
  const {
    transactions,
    budgets,
    bills,
    debts,
    accounts,
    settings,
    categories,
    goals,
  } = store;
  const [levers, setLevers] = useState(ZERO_LEVERS);
  const [years, setYears] = useState(5);
  const isPhone = useMediaQuery("(max-width: 760px)");
  // Results follow the slider without making it stutter on a slow phone.
  const deferred = useDeferredValue(levers);
  const result = useMemo(
    () =>
      simulate(
        {
          transactions,
          budgets,
          bills,
          debts,
          accounts,
          settings,
          categories,
          goals,
        },
        deferred,
      ),
    [
      transactions,
      budgets,
      bills,
      debts,
      accounts,
      settings,
      categories,
      goals,
      deferred,
    ],
  );
  const { base, levers: plan } = result;
  const set = (field) => (value) =>
    setLevers((l) => ({ ...l, [field]: value }));
  // Any month where the plan asks for more than the cash covers: every card says
  // it shows only the funded part.
  const unfunded = result.fullFunding !== null;
  const highlights = summarize(result);

  // Screen readers hear the result once the levers stop moving, not on every step.
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = setTimeout(
      () =>
        setAnnounced(highlights.join(". ") || "No change from today's path."),
      700,
    );
    return () => clearTimeout(id);
  }, [highlights.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack whatif">
      <Notice icon="info">
        Sandbox: nothing here changes your records. Levers reset when you leave
        this page.
      </Notice>
      <div className="whatif-layout">
        <Levers
          levers={levers}
          base={base}
          goals={goals}
          set={set}
          reset={() => setLevers(ZERO_LEVERS)}
        />
        <div className="stack whatif-results" id="whatif-results" tabIndex={-1}>
          <CashFlow result={result} />
          <OrbCompare result={result} unfunded={unfunded} />
          <GoalResults
            result={result}
            unfunded={unfunded}
            openTask={openTask}
          />
          <DebtResults
            result={result}
            unfunded={unfunded}
            openTask={openTask}
          />
          <SavingsResults
            result={result}
            unfunded={unfunded}
            years={years}
            setYears={setYears}
          />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
      {isPhone && highlights.length > 0 && (
        <button
          type="button"
          className="whatif-bar"
          onClick={() =>
            document
              .getElementById("whatif-results")
              ?.focus({ preventScroll: false })
          }
        >
          <span>{highlights.slice(0, 2).join(" · ")}</span>
          <Icon name="down" size={16} />
          <span className="sr-only">. Show results</span>
        </button>
      )}
    </div>
  );
}

/** The two to four biggest changes, in words, for the phone bar and screen readers. */
function summarize({ baseline, scenario }) {
  const out = [];
  const b = baseline.ledger;
  const s = scenario.ledger;
  if (b.debtFree && s.debtFree && b.debtFree > s.debtFree)
    out.push(`Debt-free about ${b.debtFree - s.debtFree} mo sooner`);
  const orbDiff =
    scenario.orb.score != null && baseline.orb.score != null
      ? scenario.orb.score - baseline.orb.score
      : 0;
  if (orbDiff)
    out.push(`Health about ${orbDiff > 0 ? "+" : ""}${orbDiff} in 12 mo`);
  const goals = s.goals.filter((g) => g.reachedMonth !== null).length;
  if (goals) out.push(`${plural(goals, "goal")} reached`);
  const total = (l) => l.rows[ORB_MONTH].balance + l.rows[ORB_MONTH].goalMoney;
  const diff = Math.round(total(s) - total(b));
  if (diff)
    out.push(`${diff > 0 ? "+" : "−"}${money(Math.abs(diff))} saved in 12 mo`);
  return out;
}

// ---------- Levers ----------

/** A slider and a number box bound to the same value (both work by keyboard and touch). */
function Lever({
  id,
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = MAX_LEVER,
  step = 25,
  focus,
}) {
  const read = (e) => (e.target.value === "" ? 0 : Number(e.target.value));
  return (
    <div className="whatif-lever">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="small muted" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <div className="whatif-lever-inputs">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => onChange(read(e))}
          aria-label={`${label} slider`}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step="any"
          value={value}
          onChange={(e) => onChange(read(e))}
          data-focus-target={focus}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </div>
    </div>
  );
}

function Levers({ levers, base, goals, set, reset }) {
  const open = openGoals(goals);
  const cutOptions = Object.keys(base.categoryAverage).sort();
  const updateCut = (i, change) =>
    set("cuts")(levers.cuts.map((c, j) => (j === i ? { ...c, ...change } : c)));
  const unusedCategory = cutOptions.find(
    (c) => !levers.cuts.some((x) => x.category === c),
  );
  const next12 = Array.from({ length: ORB_MONTH }, (_, i) => i + 1);

  return (
    <section className="card whatif-levers" aria-labelledby="levers-title">
      <div className="row">
        <h2 id="levers-title">Your what-if plan</h2>
        <span className="spacer" />
        <button type="button" className="btn" onClick={reset}>
          Reset
        </button>
      </div>
      <p className="sub">
        Monthly amounts, in take-home dollars. Everything starts at zero.
      </p>

      <fieldset className="whatif-group">
        <legend>Save more for goals</legend>
        {open.length === 0 ? (
          <p className="small muted">
            Add an unfinished goal on the Goals page to try this.
          </p>
        ) : (
          <>
            <Lever
              id="whatif-savings"
              focus="whatif-savings"
              label="Extra goal savings per month"
              value={levers.extraSavings}
              onChange={set("extraSavings")}
            />
            <label className="field">
              Goes to
              <select
                value={levers.goalTarget}
                onChange={(e) => set("goalTarget")(e.target.value)}
              >
                <option value="all">All goals, nearest deadline first</option>
                {open.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </fieldset>

      <fieldset className="whatif-group">
        <legend>Spend less in a category</legend>
        {cutOptions.length === 0 && (
          <p className="small muted">
            Record spending in the last 3 full months to try a cut.
          </p>
        )}
        {levers.cuts.map((c, i) => (
          <div key={i} className="whatif-cut">
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Category
                <select
                  value={c.category}
                  onChange={(e) => updateCut(i, { category: e.target.value })}
                >
                  {cutOptions.map((name) => (
                    <option
                      key={name}
                      value={name}
                      disabled={
                        name !== c.category &&
                        levers.cuts.some((x) => x.category === name)
                      }
                    >
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-icon"
                onClick={() =>
                  set("cuts")(levers.cuts.filter((_, j) => j !== i))
                }
                aria-label={`Remove the ${c.category} cut`}
              >
                <Icon name="close" />
              </button>
            </div>
            <Lever
              id={`whatif-cut-${i}`}
              label={`Cut ${c.category} by`}
              hint={`You spent about ${money(base.categoryAverage[c.category])} a month there recently, so that's the most you can cut.`}
              value={c.amount}
              max={Math.ceil(base.categoryAverage[c.category] ?? 0)}
              step={5}
              onChange={(amount) => updateCut(i, { amount })}
            />
          </div>
        ))}
        {levers.cuts.length < MAX_CUTS && unusedCategory && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              set("cuts")([
                ...levers.cuts,
                { category: unusedCategory, amount: 0 },
              ])
            }
          >
            Add a cut
          </button>
        )}
      </fieldset>

      <fieldset className="whatif-group">
        <legend>Pay extra on debt</legend>
        {!base.hasDebts ? (
          <p className="small muted">No open debts on Debt Planner.</p>
        ) : (
          <>
            <Lever
              id="whatif-debt"
              focus="whatif-debt"
              label="Extra debt payment per month"
              hint={
                base.debtExtraSaved
                  ? `Added on top of the ${money(base.debtExtra)} extra saved as your plan on Debt Planner.`
                  : "Debt Planner's $200 is only a suggestion until you save it there, so today's path uses minimums only."
              }
              value={levers.extraDebt}
              onChange={set("extraDebt")}
            />
            <div
              className="row small"
              role="radiogroup"
              aria-label="Payoff strategy for both paths"
            >
              {["avalanche", "snowball"].map((s) => (
                <label key={s} className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="whatif-strategy"
                    checked={levers.strategy === s}
                    onChange={() => set("strategy")(s)}
                  />
                  {s === "avalanche"
                    ? "Avalanche (highest APR first)"
                    : "Snowball (smallest balance first)"}
                </label>
              ))}
            </div>
            {/* Finnelee never matches transactions to debts by name, so it asks. */}
            <div
              className="whatif-recorded"
              role="radiogroup"
              aria-labelledby="whatif-recorded-q"
              aria-describedby="whatif-recorded-hint"
            >
              <span id="whatif-recorded-q" className="small">
                Are your debt payments in your recorded transactions?
              </span>
              <div className="row small">
                {[
                  ["yes", "Yes"],
                  ["no", "No"],
                  ["unknown", "Not sure"],
                ].map(([value, label]) => (
                  <label key={value} className="row" style={{ gap: 6 }}>
                    <input
                      type="radio"
                      name="whatif-recorded"
                      checked={levers.debtRecorded === value}
                      onChange={() => set("debtRecorded")(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="small muted" id="whatif-recorded-hint">
                {
                  {
                    yes: "Payments are already in your surplus, so after the last payoff they come back as savings.",
                    no: "Payments come out of your surplus until each debt is paid off. Nothing extra comes back after.",
                    unknown:
                      "Your surplus is used as recorded, and freed payments are never added, so nothing is counted twice.",
                  }[levers.debtRecorded]
                }
              </p>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="whatif-group">
        <legend>Change your income</legend>
        <Lever
          id="whatif-income"
          focus="whatif-income"
          label="Take-home change per month"
          hint="Use a negative amount for a pay cut. Take-home never goes below $0."
          value={levers.incomeChange}
          min={-Math.ceil(base.avgIncome)}
          max={5000}
          step={50}
          onChange={set("incomeChange")}
        />
        <label className="field">
          Starting
          <select
            value={levers.incomeStart}
            onChange={(e) => set("incomeStart")(Number(e.target.value))}
          >
            {next12.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className="row small whatif-growth">
        <input
          type="checkbox"
          checked={levers.growth}
          onChange={(e) => set("growth")(e.target.checked)}
        />
        Grow general savings at Forecast's expected return ({base.annualReturn}%
        a year). Goal money never earns a return here.
      </label>
    </section>
  );
}

// ---------- Results ----------

function Card({ title, unfunded, children }) {
  return (
    <section className="card">
      <div className="row">
        <h2>{title}</h2>
        {unfunded && <span className="whatif-tag">Unfunded plan</span>}
      </div>
      {unfunded && (
        <p className="small whatif-funded-note">
          Shows only what your estimated cash flow can fund.
        </p>
      )}
      {children}
      <p className="small muted whatif-foot">{FOOTER}</p>
    </section>
  );
}

/** Where the money comes from, what the plan asks for, and what the cash can fund. */
function CashFlow({ result }) {
  const { base, levers, affordability, shortfall, scenario } = result;
  const first = scenario.ledger.rows[1];
  const frees =
    levers.cuts.reduce((t, c) => t + c.amount, 0) +
    Math.max(0, levers.incomeChange);
  const debtNote = {
    yes: "You said your recorded spending includes your debt payments.",
    no: `You said your debt payments aren't recorded, so ${money(scenario.ledger.plannedDebt)} a month comes out of the surplus while debts are open.`,
    unknown:
      "Freed debt payments aren't added after payoff, since Finnelee can't tell whether your records include them.",
  }[levers.debtRecorded];
  const state = {
    within: (
      <Status tone="good">
        This plan fits within your estimated monthly cash flow.
      </Status>
    ),
    exceeds: (
      <Status tone="warning">
        This plan asks for about {money(shortfall)} a month more than your
        estimated cash flow can fund. Only the funded part is projected below.
      </Status>
    ),
    insufficient: (
      <Status tone="warning" icon="info">
        Not enough recorded history to tell if this fits. Results are based on
        limited history.
      </Status>
    ),
  }[affordability];
  return (
    <section className="card" aria-labelledby="cash-title">
      <h2 id="cash-title">Monthly cash flow</h2>
      <p className="sub">
        Your recorded surplus is about {money(base.surplus)} a month (the last 3
        full months, as on Forecast). This plan frees {money(frees)}
        {levers.incomeChange < 0
          ? ` and takes ${money(-levers.incomeChange)} less income`
          : ""}
        .
      </p>
      <dl className="whatif-flow">
        <div>
          <dt>Requested for goals and debt</dt>
          <dd>{money(first.requested)}</dd>
        </div>
        <div>
          <dt>Funded from cash flow</dt>
          <dd>{money(first.toDebt + first.toGoals)}</dd>
        </div>
        <div>
          <dt>Not funded</dt>
          <dd>{money(first.shortfall)}</dd>
        </div>
      </dl>
      {first.deficit > 0 && (
        <p className="small">
          The income change leaves a gap of about {money(first.deficit)} a month
          before anything is assigned. It counts as not funded.
        </p>
      )}
      <p style={{ margin: 0 }}>{state}</p>
      <p className="small muted whatif-foot">
        Figures for {monthName(1)}. {base.hasDebts ? `${debtNote} ` : ""}Extra
        debt is funded first, then goals. Each dollar goes to one place: a debt,
        a goal, or general savings.
      </p>
    </section>
  );
}

/** A small static ring with the score: decorative, the number is the text beside it. */
function Ring({ score }) {
  return (
    <span
      className="whatif-ring"
      style={{ "--score": score ?? 0 }}
      aria-hidden="true"
    >
      <span>{score ?? "–"}</span>
    </span>
  );
}

function OrbCompare({ result, unfunded }) {
  const { today, baseline, scenario } = result;
  const line = (h) =>
    h.score == null
      ? "not scored yet"
      : `about ${h.score}${h.band ? ` (${h.band})` : ""}`;
  return (
    <Card title="Financial Health in 12 months" unfunded={unfunded}>
      <p className="sub">
        Educational planning indicator, estimated for {monthName(ORB_MONTH)}.
        Today's actual score: {line(today)}.
      </p>
      <div className="whatif-rings">
        <div>
          <Ring score={baseline.orb.score} />
          <span className="small">Today's path: {line(baseline.orb)}</span>
        </div>
        <div>
          <Ring score={scenario.orb.score} />
          <span className="small">With this plan: {line(scenario.orb)}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Area</th>
              <th>Today's path</th>
              <th>With this plan</th>
            </tr>
          </thead>
          <tbody>
            {baseline.orb.pillars.map((p, i) => {
              const q = scenario.orb.pillars[i];
              const cell = (x) =>
                x.state === "needs-data" ? "Needs data" : x.score;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num">{cell(p)}</td>
                  <td className="num">{cell(q)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">{today.disclosure}</p>
    </Card>
  );
}

function GoalResults({ result, unfunded, openTask }) {
  const base = result.baseline.ledger.goals;
  const plan = result.scenario.ledger.goals;
  const full = result.fullFunding?.goals ?? [];
  if (plan.length === 0)
    return (
      <Card title="Goals" unfunded={false}>
        <EmptyState
          icon="goals"
          title="No unfinished goals"
          action={
            <button
              type="button"
              className="btn"
              onClick={() => openTask("goals", ["add-goal"], "Add a goal")}
            >
              Add a goal
            </button>
          }
        >
          Add a goal to see when extra savings could reach it.
        </EmptyState>
      </Card>
    );
  const planText = (g) => {
    if (g.reachedMonth === null)
      return g.funded
        ? "Not reached within 10 years at this amount"
        : "No extra from this plan";
    const left = monthsUntil(g.deadline) - g.reachedMonth;
    const vs =
      left > 0
        ? `, about ${plural(left, "month")} before the deadline`
        : left < 0
          ? `, about ${plural(-left, "month")} after the deadline`
          : ", around the deadline";
    return `Could be reached ${monthName(g.reachedMonth)}${vs}`;
  };
  return (
    <Card title="Goals" unfunded={unfunded}>
      <p className="sub">
        Finnelee doesn't record a regular goal contribution, so today's path
        doesn't guess a finish date.
      </p>
      <ul className="whatif-list">
        {plan.map((g, i) => (
          <li key={g.id}>
            <strong>{g.name}</strong>{" "}
            <span className="muted small">({money(g.remaining)} to go)</span>
            <span className="small">
              Today's path: not projected (no recurring contribution recorded).
            </span>
            <span className="small">With this plan: {planText(g)}.</span>
            {full[i] && full[i].reachedMonth !== g.reachedMonth && (
              <span className="small muted">
                Only if the missing money were found (unfunded hypothetical):{" "}
                {full[i].reachedMonth === null
                  ? "not within 10 years"
                  : monthName(full[i].reachedMonth)}
                .
              </span>
            )}
            <span className="small muted">
              Planning figure: about {money(base[i].required)} a month would
              finish it by the deadline.
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DebtResults({ result, unfunded, openTask }) {
  const b = result.baseline.ledger;
  const s = result.scenario.ledger;
  if (!b.hasDebts)
    return (
      <Card title="Debt payoff" unfunded={false}>
        <EmptyState
          icon="debt"
          title="No debts to simulate"
          action={
            <button
              type="button"
              className="btn"
              onClick={() => openTask("debt", ["add-debt"], "Add a debt")}
            >
              Add a debt
            </button>
          }
        >
          Debts you add on Debt Planner appear here.
        </EmptyState>
      </Card>
    );
  const when = (l) =>
    l.debtFree
      ? `debt-free ${monthName(l.debtFree)}`
      : "not paid off within 50 years";
  const saved = b.debt.totalInterest - s.debt.totalInterest;
  const order = (l) =>
    Object.fromEntries(l.debt.payoffOrder.map((p) => [p.name, p.month]));
  const bo = order(b);
  const so = order(s);
  return (
    <Card title="Debt payoff" unfunded={unfunded}>
      <p className="sub">
        Today's path: {when(b)}, about {money(b.debt.totalInterest)} interest.
        With this plan: {when(s)}, about {money(s.debt.totalInterest)}
        {saved > 0.5 ? ` (about ${money(saved)} less)` : ""}. Both use{" "}
        {result.levers.strategy === "snowball" ? "Snowball" : "Avalanche"}.
      </p>
      {s.debtExtra < result.levers.extraDebt && (
        <p className="small">
          Only {money(s.debtExtra)} of the {money(result.levers.extraDebt)}{" "}
          extra fits your cash flow every month, so payoff uses that. With the
          full amount (unfunded hypothetical): {when(result.fullFunding ?? s)}.
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Debt</th>
              <th>Today's path</th>
              <th>With this plan</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(bo).map((name) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{monthName(bo[name])}</td>
                <td>{so[name] ? monthName(so[name]) : "Later"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SavingsResults({ result, unfunded, years, setYears }) {
  const palette = getPalette(useColorScheme());
  const animate = useMotion() === "full";
  const { baseline, scenario, levers } = result;
  const months = years * 12;
  const total = (r) => r.balance + r.goalMoney;
  const data = baseline.ledger.rows.slice(0, months + 1).map((r, i) => ({
    month: r.month,
    today: total(r),
    plan: total(scenario.ledger.rows[i]),
  }));
  const end = scenario.ledger.rows[months];
  const endBase = baseline.ledger.rows[months];
  const debtFree = baseline.ledger.debtFree;
  return (
    <Card title="Savings forecast" unfunded={unfunded}>
      <div className="row">
        <p className="sub" style={{ margin: 0, flex: 1 }}>
          In {plural(years, "year")}: today's path about {money(total(endBase))}
          , with this plan about {money(total(end))} ({money(end.goalMoney)} of
          it set aside for goals).
        </p>
        <label className="field">
          Years
          <select
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
          >
            {[1, 3, 5, 10].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="chart" style={{ height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} stroke={palette.grid} />
            <XAxis
              dataKey="month"
              ticks={data.filter((p) => p.month % 12 === 0).map((p) => p.month)}
              tickFormatter={(m) => `Yr ${m / 12}`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: palette.axis, fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(v) => formatCurrency(v, { compact: true })}
              tickLine={false}
              axisLine={false}
              tick={{ fill: palette.axis, fontSize: 12 }}
              width={60}
            />
            <Tooltip
              content={<ChartTooltip labelFormatter={(m) => monthName(m)} />}
            />
            <Line
              isAnimationActive={animate}
              dataKey="today"
              name="Today's path"
              stroke={palette.other}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
            <Line
              isAnimationActive={animate}
              dataKey="plan"
              name="With this plan"
              stroke={palette.series[0]}
              strokeWidth={2.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <span>
          <span className="dot" style={{ background: palette.other }} />
          Today's path
        </span>
        <span>
          <span className="dot" style={{ background: palette.series[0] }} />
          With this plan
        </span>
      </div>
      <p className="small muted">
        {unfunded ? "Only funded money is charted. " : ""}
        {!levers.growth
          ? "Growth is off, so these lines won't match Forecast's Expected line."
          : levers.debtRecorded === "no" && baseline.ledger.hasDebts
            ? "Today's path is below Forecast's Expected line while debts are open, because unrecorded debt payments come out of the surplus."
            : levers.debtRecorded === "yes" && debtFree && debtFree < months
              ? `Today's path matches Forecast's Expected line until ${monthName(debtFree)}. After that, freed debt payments roll into savings, which Forecast doesn't model.`
              : "With no levers, today's path follows Forecast's Expected line."}{" "}
        A goal's existing saved amount isn't added, since it may already be in
        your savings.
      </p>
    </Card>
  );
}
