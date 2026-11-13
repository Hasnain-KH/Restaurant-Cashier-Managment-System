import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import BarChart from '../components/BarChart';
import OrderTable from '../components/OrderTable';
import ProfitSummary from '../components/ProfitSummary';
import EmptyState, { ErrorBanner, LoadingRows } from '../components/Feedback';
import { PrintIcon } from '../components/Icons';
import {
  clockLabel,
  dateLabel,
  kg,
  money,
  moneyWhole,
  monthKey,
  monthLabel,
  shortDateLabel,
  todayKey,
  weekdayLabel,
} from '../format';

function hourLabel(hour) {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function hourShort(hour) {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

function netProfit(report) {
  if (!report) return '—';
  return report.profitComplete === false ? 'Incomplete' : money(report.estimatedNetProfit);
}

function TypeBreakdown({ report }) {
  return (
    <div className="mini-grid">
      <div className="mini-stat">
        <span>Sadi biryani</span>
        <strong>{kg(report.sadiKg)}</strong>
      </div>
      <div className="mini-stat">
        <span>Beef biryani</span>
        <strong>{kg(report.beefKg)}</strong>
      </div>
      <div className="mini-stat">
        <span>Legacy biryani</span>
        <strong>{report.legacyKg ? kg(report.legacyKg) : 'None'}</strong>
      </div>
      <div className="mini-stat">
        <span>Other items revenue</span>
        <strong>{money(report.otherRevenue)}</strong>
      </div>
      <div className="mini-stat">
        <span>Recorded expenses</span>
        <strong>{money(report.recordedExpenses ?? report.expenses ?? 0)}</strong>
      </div>
      <div className="mini-stat">
        <span>Estimated net profit</span>
        <strong>{netProfit(report)}</strong>
      </div>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('daily');
  const [date, setDate] = useState(todayKey());
  const [month, setMonth] = useState(monthKey());
  const [daily, setDaily] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDaily = useCallback(async () => {
    setLoading(true);
    try {
      setDaily(await api.dailyReport(date));
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadMonthly = useCallback(async () => {
    setLoading(true);
    try {
      setMonthly(await api.monthlyReport(month));
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    if (tab === 'daily') loadDaily();
  }, [tab, loadDaily]);

  useEffect(() => {
    if (tab === 'monthly') loadMonthly();
  }, [tab, loadMonthly]);

  const busiestHour = daily
    ? daily.hours.reduce(
        (best, hour) => (hour.total > best.total ? hour : best),
        { hour: 0, total: 0, orders: 0 }
      )
    : null;

  const reportTitle =
    tab === 'daily'
      ? `Daily Sales Report · ${dateLabel(date)}`
      : `Monthly Sales Report · ${monthLabel(month)}`;

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle="Daily and monthly reports with biryani types, expenses and honest profit."
        actions={
          <div className="header-actions">
            <div className="segmented" role="tablist" aria-label="Report type">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'daily'}
                className={tab === 'daily' ? 'segment-active' : ''}
                onClick={() => setTab('daily')}
              >
                Daily
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'monthly'}
                className={tab === 'monthly' ? 'segment-active' : ''}
                onClick={() => setTab('monthly')}
              >
                Monthly
              </button>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              <PrintIcon size={17} /> Print
            </button>
          </div>
        }
      />

      <ErrorBanner message={error} onRetry={() => (tab === 'daily' ? loadDaily() : loadMonthly())} />

      <div className="report-sheet">
        <div className="print-header">
          <div>
            <span className="print-brand">JOONA BIRYANI</span>
            <span className="print-sub">Offline sales management</span>
          </div>
          <div className="print-meta">
            <strong>{reportTitle}</strong>
            <span>
              Printed {clockLabel(new Date())} · {dateLabel(todayKey())} · Asia/Karachi
            </span>
          </div>
        </div>

        {tab === 'daily' ? (
          <>
            <div className="report-toolbar no-print">
              <label className="date-field">
                <span>Report date</span>
                <input
                  type="date"
                  className="input input-date"
                  value={date}
                  max={todayKey()}
                  onChange={(event) => setDate(event.target.value || todayKey())}
                />
              </label>
              <span className="report-range-note">
                {date === todayKey() ? 'Today · live figures' : 'Saved records for this date'}
              </span>
            </div>

            {loading && !daily ? (
              <LoadingRows rows={4} />
            ) : daily ? (
              <>
                <div className="stat-grid stat-grid-report">
                  <StatCard
                    tone="primary"
                    label="Total Sales"
                    value={money(daily.revenue)}
                    hint={`${daily.orders} orders`}
                  />
                  <StatCard label="Orders" value={daily.orders} hint="orders on this date" />
                  <StatCard label="Biryani Sold" value={kg(daily.kg)} hint="all biryani types" />
                  <StatCard
                    label="Estimated Net Profit"
                    value={netProfit(daily)}
                    hint={
                      daily.profitComplete === false
                        ? 'Profit calculation incomplete'
                        : `after ${money(daily.recordedExpenses ?? 0)} expenses`
                    }
                  />
                </div>

                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2 className="card-title">Sales by type</h2>
                      <p className="card-subtitle">
                        Legacy biryani is never counted as Sadi or Beef.
                      </p>
                    </div>
                  </div>
                  <TypeBreakdown report={daily} />
                  <p className="table-footnote">
                    Average order {moneyWhole(daily.average)}
                    {busiestHour && busiestHour.orders
                      ? ` · busiest hour ${hourLabel(busiestHour.hour)}`
                      : ''}
                  </p>
                </section>

                <ProfitSummary report={daily} title={`Profit for ${dateLabel(daily.date)}`} />

                <section className="card chart-card">
                  <div className="card-heading">
                    <div>
                      <h2 className="card-title">Sales by hour</h2>
                      <p className="card-subtitle">When customers paid on this date.</p>
                    </div>
                  </div>
                  <BarChart
                    data={daily.hours}
                    labelKey="hour"
                    valueKey="total"
                    valueFormatter={money}
                    labelFormatter={hourShort}
                    labelStep={3}
                    tooltip={(item) =>
                      `${hourLabel(item.hour)} — ${money(item.total)} · ${item.orders} orders`
                    }
                    emptyMessage="No sales were recorded on this date."
                  />
                </section>

                <section className="card table-card">
                  <div className="card-heading">
                    <div>
                      <h2 className="card-title">Orders for {dateLabel(daily.date)}</h2>
                      <p className="card-subtitle">Newest first.</p>
                    </div>
                  </div>
                  {daily.orderList.length ? (
                    <OrderTable orders={daily.orderList} />
                  ) : (
                    <EmptyState
                      title="No orders on this date"
                      message="Choose another date or record a new order."
                    />
                  )}
                </section>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="report-toolbar no-print">
              <label className="date-field">
                <span>Report month</span>
                <input
                  type="month"
                  className="input input-date"
                  value={month}
                  max={monthKey()}
                  onChange={(event) => setMonth(event.target.value || monthKey())}
                />
              </label>
              <span className="report-range-note">
                {month === monthKey() ? 'Current month · to date' : 'Full saved month'}
              </span>
            </div>

            {loading && !monthly ? (
              <LoadingRows rows={4} />
            ) : monthly ? (
              <>
                <div className="stat-grid stat-grid-report">
                  <StatCard
                    tone="primary"
                    label="Monthly Total"
                    value={money(monthly.revenue)}
                    hint={`${monthly.orders} orders`}
                  />
                  <StatCard label="Biryani Sold" value={kg(monthly.kg)} hint="in this month" />
                  <StatCard
                    label="Average per Day"
                    value={moneyWhole(monthly.averagePerDay)}
                    hint={`over ${monthly.daysShown} day${monthly.daysShown === 1 ? '' : 's'}`}
                  />
                  <StatCard
                    label="Estimated Net Profit"
                    value={netProfit(monthly)}
                    hint={
                      monthly.profitComplete === false
                        ? 'Profit calculation incomplete'
                        : `after ${money(monthly.recordedExpenses ?? 0)} expenses`
                    }
                  />
                </div>

                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2 className="card-title">Sales by type</h2>
                      <p className="card-subtitle">
                        Month total with each biryani type kept separate.
                      </p>
                    </div>
                  </div>
                  <TypeBreakdown report={monthly} />
                  <p className="table-footnote">
                    Best day {monthly.bestDay.date ? dateLabel(monthly.bestDay.date) : '—'} ·{' '}
                    {money(monthly.bestDay.total)} · average order {moneyWhole(monthly.averageOrder)}
                  </p>
                </section>

                <ProfitSummary
                  report={monthly}
                  title={`Profit for ${monthLabel(monthly.month)}`}
                />

                <section className="card chart-card">
                  <div className="card-heading">
                    <div>
                      <h2 className="card-title">Daily sales · {monthLabel(monthly.month)}</h2>
                      <p className="card-subtitle">Hover any bar for the exact total.</p>
                    </div>
                  </div>
                  <BarChart
                    data={monthly.days}
                    valueFormatter={money}
                    labelFormatter={(value) => String(Number(value.slice(8, 10)))}
                    labelStep={monthly.days.length > 20 ? 2 : 1}
                    tooltip={(item) =>
                      `${dateLabel(item.date)} — ${money(item.total)} · ${item.orders} orders · ${kg(
                        item.kg
                      )}`
                    }
                    emptyMessage="No sales recorded in this month."
                  />
                </section>

                <section className="card table-card">
                  <div className="card-heading">
                    <div>
                      <h2 className="card-title">Day-by-day breakdown</h2>
                      <p className="card-subtitle">
                        {monthly.days.length} days shown for {monthLabel(monthly.month)}.
                      </p>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="table report-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="align-right">Orders</th>
                          <th className="align-right">Sadi</th>
                          <th className="align-right">Beef</th>
                          <th className="align-right">Legacy</th>
                          <th className="align-right">Other</th>
                          <th className="align-right">Expenses</th>
                          <th className="align-right">Net profit</th>
                          <th className="align-right">Sales</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthly.days.map((day) => (
                          <tr key={day.date} className={day.orders ? '' : 'row-quiet'}>
                            <td>
                              <span className="day-cell">
                                <span className="day-number mono">{day.date.slice(8, 10)}</span>
                                <span className="day-meta">
                                  {weekdayLabel(day.date)}, {shortDateLabel(day.date)}
                                </span>
                              </span>
                            </td>
                            <td className="align-right">{day.orders || '—'}</td>
                            <td className="align-right">{day.sadiKg ? kg(day.sadiKg) : '—'}</td>
                            <td className="align-right">{day.beefKg ? kg(day.beefKg) : '—'}</td>
                            <td className="align-right">{day.legacyKg ? kg(day.legacyKg) : '—'}</td>
                            <td className="align-right">
                              {day.otherRevenue ? money(day.otherRevenue) : '—'}
                            </td>
                            <td className="align-right">
                              {day.expenses ? money(day.expenses) : '—'}
                            </td>
                            <td className="align-right">
                              {day.profitComplete === false
                                ? 'Incomplete'
                                : day.orders
                                ? money(day.estimatedNetProfit)
                                : '—'}
                            </td>
                            <td className="align-right amount-cell">
                              {day.total ? money(day.total) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Month total</td>
                          <td className="align-right">{monthly.orders}</td>
                          <td className="align-right">{kg(monthly.sadiKg)}</td>
                          <td className="align-right">{kg(monthly.beefKg)}</td>
                          <td className="align-right">{kg(monthly.legacyKg)}</td>
                          <td className="align-right">{money(monthly.otherRevenue)}</td>
                          <td className="align-right">{money(monthly.recordedExpenses)}</td>
                          <td className="align-right">{netProfit(monthly)}</td>
                          <td className="align-right amount-cell">{money(monthly.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
