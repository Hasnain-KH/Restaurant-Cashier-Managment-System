export default function StatCard({ label, value, hint, icon, tone = 'default', trend }) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon ? <span className="stat-icon">{icon}</span> : null}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-bottom">
        {trend ? (
          <span className={`trend trend-${trend.direction}`}>
            <span aria-hidden="true">
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
            </span>
            {trend.value}%
          </span>
        ) : null}
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </div>
    </div>
  );
}
