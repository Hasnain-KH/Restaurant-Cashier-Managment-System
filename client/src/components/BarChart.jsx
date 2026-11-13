import { money, shortDateLabel, weekdayLabel } from '../format';

export default function BarChart({
  data = [],
  valueKey = 'total',
  labelKey = 'date',
  labelFormatter = shortDateLabel,
  valueFormatter = money,
  tooltip,
  showValues = false,
  labelStep,
  emptyMessage = 'No sales recorded for this period yet.',
}) {
  const values = data.map((item) => Number(item[valueKey]) || 0);
  const max = Math.max(...values, 0);
  const hasData = max > 0;
  const step = labelStep || (data.length > 16 ? Math.ceil(data.length / 8) : 1);

  const defaultTooltip = (item) =>
    `${labelFormatter(item[labelKey], item)} — ${valueFormatter(item[valueKey])}`;

  return (
    <div className={`chart ${hasData ? '' : 'chart-empty'}`}>
      <div className="chart-grid" aria-hidden="true" />
      <div className="bars">
        {data.map((item, index) => {
          const value = Number(item[valueKey]) || 0;
          const height = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 1) : 1;
          const title = tooltip ? tooltip(item) : defaultTooltip(item);
          return (
            <div className="bar-col" key={item[labelKey] || index}>
              <div
                className={`bar ${value > 0 ? 'bar-filled' : 'bar-zero'}`}
                style={{ height: `${height}%` }}
                title={title}
                aria-label={title}
                role="img"
              >
                {showValues && value > 0 ? (
                  <span className="bar-value">{valueFormatter(value, true)}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="chart-labels">
        {data.map((item, index) => {
          const show = index % step === 0 || index === data.length - 1;
          const label = labelFormatter(item[labelKey], item);
          return (
            <span className="chart-label" key={`label-${item[labelKey] || index}`}>
              {show ? label : ''}
            </span>
          );
        })}
      </div>
      {!hasData ? <div className="chart-empty-note">{emptyMessage}</div> : null}
      {data.length > 16 ? (
        <div className="chart-legend">
          {data.length} days · hover a bar for exact amount
        </div>
      ) : null}
    </div>
  );
}

export function WeeklyLabels(item) {
  return `${weekdayLabel(item.date)} ${shortDateLabel(item.date)}`;
}
