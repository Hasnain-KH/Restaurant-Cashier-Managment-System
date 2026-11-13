import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import SaleTable from '../components/SaleTable';
import EmptyState, { ErrorBanner, LoadingRows } from '../components/Feedback';
import { RefreshIcon } from '../components/Icons';
import { addDaysKey, dateLabel, kg, money, todayKey } from '../format';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All sales' },
  { id: 'custom', label: 'Custom range' },
];

const PAGE_SIZE = 200;

export default function History() {
  const [preset, setPreset] = useState('today');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    const today = todayKey();
    switch (preset) {
      case 'today':
        return { date: today };
      case 'yesterday': {
        const yesterday = addDaysKey(today, -1);
        return { date: yesterday };
      }
      case '7days':
        return { from: addDaysKey(today, -6), to: today };
      case 'month':
        return { from: `${today.slice(0, 7)}-01`, to: today };
      case 'all':
        return {};
      case 'custom':
      default:
        return {
          from: customFrom || undefined,
          to: customTo || undefined,
        };
    }
  }, [preset, customFrom, customTo]);

  const rangeInvalid =
    preset === 'custom' && customFrom && customTo && customFrom > customTo;

  const load = useCallback(
    async (offset = 0, append = false) => {
      if (rangeInvalid) {
        setError('The start date must be on or before the end date.');
        setResult(null);
        setLoading(false);
        return;
      }

      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
        const response = await api.listSales({
          ...range,
          limit: PAGE_SIZE,
          offset,
        });
        setResult((current) =>
          append && current
            ? {
                ...response,
                sales: [...current.sales, ...response.sales],
                offset,
              }
            : response
        );
        setError('');
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [range, rangeInvalid]
  );

  useEffect(() => {
    load(0, false);
  }, [load]);

  useEffect(() => {
    const onFocus = () => load(0, false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const sales = result?.sales ?? [];
  const describeRange = () => {
    if (preset === 'all') return 'All saved sales, newest first.';
    if (preset === 'today') return dateLabel(todayKey());
    if (preset === 'yesterday') return dateLabel(addDaysKey(todayKey(), -1));
    if (preset === '7days') return `${dateLabel(addDaysKey(todayKey(), -6))} to ${dateLabel(todayKey())}`;
    if (preset === 'month') return `Since ${dateLabel(`${todayKey().slice(0, 7)}-01`)}`;
    if (customFrom && customTo) return `${dateLabel(customFrom)} to ${dateLabel(customTo)}`;
    if (customFrom) return `From ${dateLabel(customFrom)}`;
    if (customTo) return `Until ${dateLabel(customTo)}`;
    return 'Choose a date range.';
  };

  return (
    <div className="page">
      <PageHeader
        title="Sales History"
        subtitle="Every sale is permanent and can be filtered by date."
        actions={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => load(0, false)}
            disabled={loading}
          >
            <RefreshIcon size={17} /> Refresh
          </button>
        }
      />

      <section className="card filter-card">
        <div className="filter-row">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-chip ${preset === item.id ? 'filter-chip-active' : ''}`}
              onClick={() => setPreset(item.id)}
              aria-pressed={preset === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="filter-dates">
          <label className="date-field">
            <span>From</span>
            <input
              type="date"
              className="input input-date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => {
                setCustomFrom(event.target.value);
                setPreset('custom');
              }}
            />
          </label>
          <label className="date-field">
            <span>To</span>
            <input
              type="date"
              className="input input-date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => {
                setCustomTo(event.target.value);
                setPreset('custom');
              }}
            />
          </label>
          <span className="filter-summary">{describeRange()}</span>
        </div>
      </section>

      <ErrorBanner message={error} onRetry={() => load(0, false)} />

      <section className="card table-card">
        <div className="table-heading">
          <div>
            <h2 className="card-title">Sales</h2>
            <p className="card-subtitle">
              {result
                ? `${result.count} sale${result.count === 1 ? '' : 's'} · ${money(
                    result.totalAmount
                  )} · ${kg(result.totalKg)}`
                : 'Loading sales…'}
            </p>
          </div>
          <span className="sort-note">Newest first</span>
        </div>

        {loading ? (
          <LoadingRows rows={8} />
        ) : sales.length ? (
          <>
            <SaleTable
              sales={sales}
              showDate
              footer={
                <tr>
                  <td>Filtered total ({result?.count ?? 0} sales)</td>
                  <td className="align-right amount-cell">{money(result?.totalAmount ?? 0)}</td>
                  <td>{kg(result?.totalKg ?? 0)}</td>
                  <td colSpan={2} />
                </tr>
              }
            />
            {result?.hasMore ? (
              <div className="load-more">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => load(sales.length, true)}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : `Load more (${result.count - sales.length} left)`}
                </button>
              </div>
            ) : (
              <p className="table-footnote">
                Showing all {sales.length} sale{sales.length === 1 ? '' : 's'} in this view.
              </p>
            )}
          </>
        ) : (
          <EmptyState
            title="No sales in this period"
            message="Try another date or record a new sale from the New Sale screen."
          />
        )}
      </section>
    </div>
  );
}
