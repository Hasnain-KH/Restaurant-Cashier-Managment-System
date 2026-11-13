import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import BarChart from '../components/BarChart';
import SaleTable from '../components/SaleTable';
import EmptyState, { ErrorBanner, LoadingRows } from '../components/Feedback';
import {
  ReceiptIcon,
  RefreshIcon,
  RupeeIcon,
  ScaleIcon,
  TrendUpIcon,
} from '../components/Icons';
import {
  clockLabel,
  kg,
  money,
  moneyWhole,
  monthLabel,
  percentChange,
  todayKey,
  weekdayLabel,
  shortDateLabel,
  dateLabel,
} from '../format';

export default function Dashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const dashboard = await api.dashboard();
      setData(dashboard);
      setError('');
      setUpdatedAt(new Date());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => load(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const todaySales = data?.today ?? { total: 0, orders: 0, kg: 0, average: 0 };
  const yesterdaySales = data?.yesterday ?? { total: 0, orders: 0, kg: 0, average: 0 };
  const month = data?.month ?? { total: 0, orders: 0, kg: 0, average: 0 };
  const weekly = data?.last7Days ?? [];
  const recent = data?.recent ?? [];
  const trend = percentChange(todaySales.total, yesterdaySales.total);
  const weekTotal = weekly.reduce((sum, day) => sum + day.total, 0);
  const bestDay = weekly.reduce(
    (best, day) => (day.total > best.total ? day : best),
    { date: '', total: 0 }
  );

  return (
    <div className="page">
      <PageHeader
        title="Owner Dashboard"
        subtitle={`Live figures from this laptop · ${dateLabel(todayKey())}`}
        actions={
          <div className="header-actions">
            {updatedAt ? (
              <span className="updated-at">Updated {clockLabel(updatedAt)}</span>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => load(false)}
              disabled={loading}
            >
              <RefreshIcon size={17} /> Refresh
            </button>
          </div>
        }
      />

      <ErrorBanner message={error} onRetry={() => load()} />

      <div className="stat-grid">
        <StatCard
          tone="primary"
          label="Today's Total Sales"
          value={money(todaySales.total)}
          hint="vs yesterday"
          trend={trend}
          icon={<RupeeIcon size={20} />}
        />
        <StatCard
          label="Today's Orders"
          value={todaySales.orders}
          hint="sales recorded today"
          icon={<ReceiptIcon size={20} />}
        />
        <StatCard
          label="Biryani Sold Today"
          value={kg(todaySales.kg)}
          hint="1 Pao = 250 g"
          icon={<ScaleIcon size={20} />}
        />
        <StatCard
          label="Average Order"
          value={moneyWhole(todaySales.average)}
          hint="today's average"
          icon={<TrendUpIcon size={20} />}
        />
      </div>

      <div className="dashboard-grid">
        <section className="card chart-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Last 7 days</h2>
              <p className="card-subtitle">Daily sales from your database.</p>
            </div>
            <div className="chart-summary">
              <span className="chart-summary-label">7-day total</span>
              <span className="chart-summary-value">{money(weekTotal)}</span>
            </div>
          </div>
          {loading && !data ? (
            <div className="chart-skeleton" />
          ) : (
            <BarChart
              data={weekly}
              valueFormatter={money}
              labelFormatter={(value) => `${weekdayLabel(value)} ${shortDateLabel(value)}`}
              tooltip={(item) =>
                `${weekdayLabel(item.date)} ${dateLabel(item.date)} — ${money(item.total)} · ${
                  item.orders
                } orders · ${kg(item.kg)}`
              }
            />
          )}
        </section>

        <section className="card month-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">This month</h2>
              <p className="card-subtitle">{monthLabel(month.month || todayKey().slice(0, 7))}</p>
            </div>
          </div>

          <div className="month-row month-row-highlight">
            <span>Total sales</span>
            <strong>{money(month.total)}</strong>
          </div>
          <div className="month-row">
            <span>Orders</span>
            <strong>{month.orders}</strong>
          </div>
          <div className="month-row">
            <span>Biryani sold</span>
            <strong>{kg(month.kg)}</strong>
          </div>
          <div className="month-row">
            <span>Average order</span>
            <strong>{moneyWhole(month.average)}</strong>
          </div>

          <div className="month-divider" />

          <div className="month-row">
            <span>Yesterday</span>
            <strong>{money(yesterdaySales.total)}</strong>
          </div>
          <p className="month-footnote">
            {yesterdaySales.orders} orders · {kg(yesterdaySales.kg)} sold yesterday
          </p>

          {bestDay.date ? (
            <div className="best-day">
              <span className="best-day-label">Best of last 7 days</span>
              <span className="best-day-value">
                {money(bestDay.total)} · {shortDateLabel(bestDay.date)}
              </span>
            </div>
          ) : null}
        </section>
      </div>

      <section className="card recent-card">
        <div className="card-heading">
          <div>
            <h2 className="card-title">Recent sales</h2>
            <p className="card-subtitle">The last 10 sales saved on this laptop.</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => onNavigate('history')}
          >
            View all sales
          </button>
        </div>

        {loading && !data ? (
          <LoadingRows rows={5} />
        ) : recent.length ? (
          <SaleTable sales={recent} showDate />
        ) : (
          <EmptyState
            title="No sales recorded yet"
            message="Open New Sale to record the first order of the day."
          />
        )}
      </section>
    </div>
  );
}
