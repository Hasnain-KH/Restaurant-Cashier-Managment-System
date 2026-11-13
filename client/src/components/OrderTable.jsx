import { Fragment, useState } from 'react';
import { money, kg, saleTimeLabel, shortDateLabel } from '../format';

function OrderItems({ order }) {
  if (!order.items || !order.items.length) {
    return <span className="muted-cell">No line items</span>;
  }
  return (
    <ul className="order-items">
      {order.items.map((item) => (
        <li key={item.id}>
          <span className="order-item-qty">{item.quantity}×</span>
          <span className="order-item-name">
            {item.productName}
            {item.portionLabel ? <span className="order-item-portion"> · {item.portionLabel}</span> : null}
          </span>
          <span className="order-item-amount">{money(item.lineTotal)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function OrderTable({ orders = [], showDate = false, footer = null }) {
  const [openIds, setOpenIds] = useState(() => new Set());

  const toggle = (id) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="table-wrap">
      <table className="table order-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Items</th>
            <th className="align-right">Amount</th>
            <th>Biryani</th>
            {showDate ? <th>Date</th> : null}
            <th>Time</th>
            <th className="align-right">Details</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const open = openIds.has(order.id);
            return (
              <Fragment key={order.id}>
                <tr className={order.isLegacy ? 'order-row-legacy' : undefined}>
                  <td>
                    <span className="sale-number mono">{order.orderNumber}</span>
                    <span className="order-badges">
                      {order.isLegacy ? (
                        <span className="badge badge-legacy">Legacy / Unclassified</span>
                      ) : null}
                      {!order.profitComplete ? (
                        <span className="badge badge-warning">Cost missing</span>
                      ) : null}
                    </span>
                    {order.note ? <span className="sale-note">{order.note}</span> : null}
                  </td>
                  <td>
                    <span className="order-summary" title={order.itemSummary}>
                      {order.itemSummary || '—'}
                    </span>
                    <span className="order-item-count">
                      {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="align-right amount-cell">{money(order.total)}</td>
                  <td>
                    {order.kg ? (
                      <span className="weight-chip">{kg(order.kg)}</span>
                    ) : (
                      <span className="muted-cell">—</span>
                    )}
                  </td>
                  {showDate ? <td className="muted-cell">{shortDateLabel(order.date)}</td> : null}
                  <td className="muted-cell">{saleTimeLabel(order.time)}</td>
                  <td className="align-right">
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      onClick={() => toggle(order.id)}
                      aria-expanded={open}
                    >
                      {open ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
                {open ? (
                  <tr className="order-detail-row">
                    <td colSpan={showDate ? 7 : 6}>
                      <div className="order-detail">
                        <div>
                          <span className="order-detail-label">Line items</span>
                          <OrderItems order={order} />
                        </div>
                        <div className="order-detail-meta">
                          <span className="order-detail-label">Recorded</span>
                          <span>
                            {shortDateLabel(order.date)} · {saleTimeLabel(order.time)}
                          </span>
                          <span className="order-detail-label">Sales by type</span>
                          <span>
                            Sadi {kg(order.sadiKg)} · Beef {kg(order.beefKg)}
                            {order.legacyKg ? ` · Legacy ${kg(order.legacyKg)}` : ''}
                          </span>
                          {order.otherRevenue ? (
                            <span>Other items {money(order.otherRevenue)}</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
