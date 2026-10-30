import Status from './Status';

/**
 * Progress toward a limit or target.
 *  mode="limit"  (budgets): filling up is BAD  -> warning at 85%, critical above 100%
 *  mode="target" (goals):   filling up is GOOD -> good once complete
 * The status is always shown as text too, so it never relies on color alone.
 * `label` names the bar for screen readers ("Groceries budget"), which read it with the
 * percentage and status, e.g. "Groceries budget, 92%, near limit".
 */
export default function ProgressBar({ value, max, mode = 'limit', color, label }) {
  const ratio = max > 0 ? value / max : 0;
  const width = `${Math.min(100, ratio * 100)}%`;

  let status;
  if (mode === 'limit') {
    status =
      ratio > 1 ? { cls: 'critical', text: 'Over' }
      : ratio >= 0.85 ? { cls: 'warning', text: 'Near limit' }
      : { cls: 'good', text: 'On track' };
  } else {
    status = ratio >= 1 ? { cls: 'good', text: 'Reached' } : null;
  }

  return (
    <div className="row" style={{ gap: 10 }}>
      <div
        className="progress"
        style={{ flex: 1 }}
        role="progressbar" // accessibility: screen readers announce this as a progress bar
        aria-label={label}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${Math.round(ratio * 100)}%${status ? `, ${status.text.toLowerCase()}` : ''}`}
      >
        <span style={{ width, background: color ?? `var(--${status?.cls === 'good' || !status ? 'accent' : status.cls})` }} />
      </div>
      {status && <Status tone={status.cls}>{status.text}</Status>}
    </div>
  );
}
