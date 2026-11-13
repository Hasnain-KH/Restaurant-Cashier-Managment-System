import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import BarChart from '../components/BarChart';
import OrderTable from '../components/OrderTable';
import ProfitSummary from '../components/ProfitSummary';
import EmptyState, { ErrorBanner, LoadingRows } from '../components/Feedback';
import {
  AlertIcon,
  ReceiptIcon,
  RefreshIcon,
  RupeeIcon,
  ScaleIcon,
  TrendUpIcon,
} from '../components/Icons';
import {
  clockLabel,
  dateLabel,
  kg,
  money,
  moneyWhole,
  monthLabel,
  percentChange,
  shortDateLabel,
  todayKey,
  weekdayLabel,
} from '../format';

function profitText(report) {
  if (!report || report.profitComplete === false) return 'Incomplete';
  return money(report.estimatedNetProfit);
}

function expenseText(report) {
  if (!report) return money(0);
  return money(report.recordedExpenses ?? 0);
}

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

  const today = data?.today ?? {
    revenue: 0,
    orders: 0,
    kg: 0,
    sadiKg: 0,
    beefKg: 0,
    legacyKg: 0,
    otherRevenue: 0,
    recordedExpenses: 0,
    estimatedNetProfit: 0,
    profitComplete: true,
    average: 0,
  };
  const yesterday = data?.yesterday ?? { revenue: 0 };
  const month = data?.month ?? {
    revenue: 0,
    orders: 0,
    kg: 0,
    sadiKg: 0,
    beefKg: 0,
    legacyKg: 0,
    otherRevenue: 0,
    recordedExpenses: 0,
    estimatedNetProfit: 0,
    profitComplete: true,
  };
  const weekly = data?.last7Days ?? [];
  const recent = data?.recentOrders ?? [];
  const trend = percentChange(today.revenue, yesterday.revenue);
  const weekTotal = weekly.reduce((sum, day) => sum + day.total, 0);
  const warnings = data?.backup?.backupWarnings ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Owner Dashboard"
        subtitle={`Live figures from this laptop · ${dateLabel(todayKey())} · Asia/Karachi`}
        actions={
          <div className="header-actions">
            {updatedAt ? <span className="updated-at">Updated {clockLabel(updatedAt)}</span> : null}
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

      {warnings.length ? (
        <div className="callout callout-warning" role="status">
          <strong>Backup attention</strong>
          <ul className="callout-list">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard
          tone="primary"
          label="Today's Sales"
          value={money(today.revenue)}
          hint="vs yesterday"
          trend={trend}
          icon={<RupeeIcon size={20} />}
        />
        <StatCard
          label="Today's Orders"
          value={today.orders}
          hint="orders recorded today"
          icon={<ReceiptIcon size={20} />}
        />
        <StatCard
          label="Biryani Sold Today"
          value={kg(today.kg)}
          hint={`Sadi ${kg(today.sadiKg)} · Beef ${kg(today.beefKg)}${
            today.legacyKg ? ` · Legacy ${kg(today.legacyKg)}` : ''
          }`}
          icon={<ScaleIcon size={20} />}
        />
        <StatCard
          label="Estimated Net Profit"
          value={profitText(today)}
          hint={
            today.profitComplete === false
              ? 'Profit calculation incomplete'
              : `after ${money(today.recordedExpenses ?? 0)} expenses`
          }
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
            <strong>{money(month.revenue)}</strong>
          </div>
          <div className="month-row">
            <span>Orders</span>
            <strong>{month.orders}</strong>
          </div>
          <div className="month-row">
            <span>Sadi / Beef biryani</span>
            <strong>
              {kg(month.sadiKg)} / {kg(month.beefKg)}
            </strong>
          </div>
          {month.legacyKg ? (
            <div className="month-row">
              <span>Legacy biryani</span>
              <strong>{kg(month.legacyKg)}</strong>
            </div>
          ) : null}
          <div className="month-row">
            <span>Other items revenue</span>
            <strong>{money(month.otherRevenue)}</strong>
          </div>
          <div className="month-row">
            <span>Recorded expenses</span>
            <strong>{expenseText(month)}</strong>
          </div>

          <div className="month-divider" />

          <div className="month-row">
            <span>Estimated gross profit</span>
            <strong>
              {month.profitComplete === false ? 'Incomplete' : money(month.estimatedGrossProfit)}
            </strong>
          </div>
          <div className="month-row month-row-highlight">
            <span>Estimated net profit</span>
            <strong>{profitText(month)}</strong>
          </div>

          <p className="month-footnote">
            Yesterday: {money(yesterday.revenue)} · {yesterday.orders} orders · {kg(yesterday.kg)}
          </p>
        </section>
      </div>

      <div className="dashboard-grid">
        <ProfitSummary report={today} title="Today's profit" compact />
        <section className="card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Today at a glance</h2>
              <p className="card-subtitle">Biryani weights and other revenue.</p>
            </div>
            <span className="card-chip">
              <AlertIcon size={15} /> Honest figures
            </span>
          </div>
          <div className="mini-grid">
            <div className="mini-stat">
              <span>Sadi biryani</span>
              <strong>{kg(today.sadiKg)}</strong>
            </div>
            <div className="mini-stat">
              <span>Beef biryani</span>
              <strong>{kg(today.beefKg)}</strong>
            </div>
            <div className="mini-stat">
              <span>Legacy biryani</span>
              <strong>{today.legacyKg ? kg(today.legacyKg) : 'None'}</strong>
            </div>
            <div className="mini-stat">
              <span>Other items</span>
              <strong>{money(today.otherRevenue)}</strong>
            </div>
            <div className="mini-stat">
              <span>Recorded expenses</span>
              <strong>{money(today.recordedExpenses ?? 0)}</strong>
            </div>
            <div className="mini-stat">
              <span>Average order</span>
              <strong>{moneyWhole(today.average)}</strong>
            </div>
          </div>
          {today.profitComplete === false ? (
            <div className="profit-warning profit-warning-inline">
              <strong>Profit Calculation Incomplete</strong>
              <p>One or more today&apos;s items have no cost recorded in Owner Settings.</p>
            </div>
          ) : null}
        </section>
      </div>

      <section className="card recent-card">
        <div className="card-heading">
          <div>
            <h2 className="card-title">Recent orders</h2>
            <p className="card-subtitle">The last 10 orders saved on this laptop.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => onNavigate('history')}>
            View all orders
          </button>
        </div>

        {loading && !data ? (
          <LoadingRows rows={5} />
        ) : recent.length ? (
          <OrderTable orders={recent} showDate />
        ) : (
          <EmptyState
            title="No orders recorded yet"
            message="Open New Sale to record the first order of the day."
          />
        )}
      </section>
    </div>
  );
}
