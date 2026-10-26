import { formatCurrency } from '../utils/format';

/**
 * Custom Recharts tooltip. Recharts calls this with { active, payload, label } while
 * the user hovers. `payload` holds one entry per series at the hovered point.
 * Text stays in normal ink; a small colored square identifies the series.
 */
export default function ChartTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="t-title">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      {payload
        .filter((p) => p.value != null)
        .map((p) => (
          <div className="t-row" key={p.dataKey ?? p.name}>
            <span>
              <span className="dot" style={{ background: p.color ?? p.payload?.fill }} />
              {p.name}
            </span>
            <strong className="num">{formatCurrency(p.value)}</strong>
          </div>
        ))}
    </div>
  );
}
