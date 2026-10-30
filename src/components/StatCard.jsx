import Icon from './Icon';

// A KPI tile: label, big number, optional hint underneath.
// With `onOpen` the whole tile is a button that opens a page: onOpen(tile) gets the tile
// element, so at Full motion it can grow into that page's title. Spans (not divs) because
// a button may only hold inline content; CSS stacks them.
export default function StatCard({ label, value, hint, onOpen, opens }) {
  const body = (
    <>
      <span className="stat-label">
        {label}
        {onOpen && <Icon name="forward" size={16} className="stat-open" />}
      </span>
      <span className="stat-value">{value}</span>
      {/* `hint && ...` renders nothing when hint is empty: a common conditional-render pattern */}
      {hint && <span className="stat-hint">{hint}</span>}
      {opens && <span className="sr-only">. Opens {opens}</span>}
    </>
  );
  if (!onOpen) return <div className="card">{body}</div>;
  return (
    <button type="button" className="card stat-link" onClick={(e) => onOpen(e.currentTarget)}>
      {body}
    </button>
  );
}
