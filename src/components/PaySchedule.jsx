import { useId, useState } from "react";
import Icon from "./Icon";
import Status from "./Status";
import { formatDate } from "../utils/format";
import {
  CADENCE_OPTIONS,
  readScheduleForm,
  scheduleForm,
  upcomingPaydays,
} from "../utils/payments";

/**
 * "Pay schedule" card on the Bills page. Saved to settings.paySchedule and used only to
 * place paydays (the runway and spending estimate). Finnelee never guesses a payday:
 * without a saved schedule, none are shown.
 */
export default function PaySchedule({ store }) {
  const { settings, setSettings } = store;
  const id = useId();
  const [form, setForm] = useState(() => scheduleForm(settings));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false); // "Saved" note until the next edit
  const upcoming = upcomingPaydays(settings, new Date());
  const field = (name) => (e) => {
    setForm((f) => ({ ...f, [name]: e.target.value }));
    setSaved(false);
  };

  const save = (e) => {
    e.preventDefault();
    const result = readScheduleForm(form);
    if (result.error) return setError(result.error);
    setSettings((prev) => ({ ...prev, paySchedule: result.schedule }));
    setError("");
    setSaved(true);
  };

  const remove = () => {
    setSettings((prev) => {
      const { paySchedule: _old, ...rest } = prev; // _old: removed on purpose
      return rest;
    });
    setForm(scheduleForm({}));
    setError("");
    setSaved(false);
  };

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <Icon name="calendar" />
        Pay schedule
      </h2>
      <p className="sub">
        Optional. Finnelee uses it to count bills up to your next payday instead
        of the next 14 days. Paydays are only ever taken from here.
      </p>
      <form className="form" onSubmit={save} noValidate>
        <label className="field">
          How often
          <select value={form.cadence} onChange={field("cadence")}>
            {CADENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Next payday
          <input type="date" value={form.next} onChange={field("next")} />
        </label>
        {form.cadence === "twice-monthly" && (
          <>
            <label className="field">
              First payday of the month
              <input
                type="number"
                min="1"
                max="31"
                step="1"
                value={form.day1}
                onChange={field("day1")}
                placeholder="e.g. 1"
              />
            </label>
            <label className="field">
              Second payday of the month
              <input
                type="number"
                min="1"
                max="31"
                step="1"
                value={form.day2}
                onChange={field("day2")}
                placeholder="e.g. 15"
              />
            </label>
          </>
        )}
        <label className="field">
          Take-home pay (optional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={field("amount")}
          />
        </label>
        <button className="btn btn-primary">Save schedule</button>
      </form>

      <div role="status" className="pay-result">
        {error ? (
          <Status tone="critical" as="p">
            {error}
          </Status>
        ) : saved ? (
          <Status tone="good" as="p">
            Pay schedule saved.
          </Status>
        ) : null}
      </div>

      {upcoming.length > 0 ? (
        <div className="row pay-upcoming">
          <span className="small">
            Next paydays: {upcoming.map(formatDate).join(", ")}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={remove}>
            Remove schedule
          </button>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          No pay schedule saved, so no paydays are shown.
        </p>
      )}
    </section>
  );
}
