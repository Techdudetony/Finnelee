// A KPI tile: label, big number, optional hint underneath.
// Props are just function arguments; destructuring pulls out the ones we need.
export default function StatCard({ label, value, hint }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {/* `hint && ...` renders nothing when hint is empty: a common conditional-render pattern */}
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
