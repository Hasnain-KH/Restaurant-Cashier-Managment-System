import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import OrderTable from '../components/OrderTable';
import EmptyState, { ErrorBanner, LoadingRows } from '../components/Feedback';
import { RefreshIcon } from '../components/Icons';
import { addDaysKey, dateLabel, kg, money, todayKey } from '../format';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All orders' },
  { id: 'custom', label: 'Custom range' },
];

const PAGE_SIZE = 200;

export default function History() {
  const [preset, setPreset] = useState('today');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    const today = todayKey();
    switch (preset) {
      case 'today':
        return { date: today };
      case 'yesterday':
        return { date: addDaysKey(today, -1) };
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

  const rangeInvalid = preset === 'custom' && customFrom && customTo && customFrom > customTo;

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
        const response = await api.listOrders({
          ...range,
          q: appliedSearch || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setResult((current) =>
          append && current
            ? {
                ...response,
                orders: [...current.orders, ...response.orders],
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
    [range, rangeInvalid, appliedSearch]
  );

  useEffect(() => {
    load(0, false);
  }, [load]);

  useEffect(() => {
    const onFocus = () => load(0, false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const orders = result?.orders ?? [];
  const describeRange = () => {
    if (preset === 'all') return 'All saved orders, newest first.';
    if (preset === 'today') return dateLabel(todayKey());
    if (preset === 'yesterday') return dateLabel(addDaysKey(todayKey(), -1));
    if (preset === '7days')
      return `${dateLabel(addDaysKey(todayKey(), -6))} to ${dateLabel(todayKey())}`;
    if (preset === 'month') return `Since ${dateLabel(`${todayKey().slice(0, 7)}-01`)}`;
    if (customFrom && customTo) return `${dateLabel(customFrom)} to ${dateLabel(customTo)}`;
    if (customFrom) return `From ${dateLabel(customFrom)}`;
    if (customTo) return `Until ${dateLabel(customTo)}`;
    return 'Choose a date range.';
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setAppliedSearch(search.trim());
  };

  return (
    <div className="page">
      <PageHeader
        title="Order History"
        subtitle="Every saved order is permanent and can be searched by order number or item."
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

        <form className="search-row" onSubmit={submitSearch}>
          <input
            className="input"
            type="search"
            placeholder="Search order number or item e.g. JB-20261113 or Beef"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search orders"
          />
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          {appliedSearch ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSearch('');
                setAppliedSearch('');
              }}
            >
              Clear
            </button>
          ) : null}
        </form>
      </section>

      <ErrorBanner message={error} onRetry={() => load(0, false)} />

      <section className="card table-card">
        <div className="table-heading">
          <div>
            <h2 className="card-title">Orders</h2>
            <p className="card-subtitle">
              {result
                ? `${result.count} order${result.count === 1 ? '' : 's'} · ${money(
                    result.totalAmount
                  )} · ${kg(result.totalKg)}${appliedSearch ? ` · matching “${appliedSearch}”` : ''}`
                : 'Loading orders…'}
            </p>
          </div>
          <span className="sort-note">Newest first</span>
        </div>

        {loading ? (
          <LoadingRows rows={8} />
        ) : orders.length ? (
          <>
            <OrderTable
              orders={orders}
              showDate
              footer={
                <tr>
                  <td>Filtered total ({result?.count ?? 0} orders)</td>
                  <td />
                  <td className="align-right amount-cell">{money(result?.totalAmount ?? 0)}</td>
                  <td>{kg(result?.totalKg ?? 0)}</td>
                  <td colSpan={3} />
                </tr>
              }
            />
            {result?.hasMore ? (
              <div className="load-more">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => load(orders.length, true)}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : `Load more (${result.count - orders.length} left)`}
                </button>
              </div>
            ) : (
              <p className="table-footnote">
                Showing all {orders.length} order{orders.length === 1 ? '' : 's'} in this view.
              </p>
            )}
          </>
        ) : (
          <EmptyState
            title="No orders in this view"
            message="Try another date, clear the search, or record a new sale."
          />
        )}
      </section>
    </div>
  );
}
