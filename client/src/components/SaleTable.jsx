import { money, saleTimeLabel, shortDateLabel } from '../format';

export default function SaleTable({ sales = [], showDate = false, footer = null }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Sale No.</th>
            <th className="align-right">Amount</th>
            <th>Weight</th>
            {showDate ? <th>Date</th> : null}
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => (
            <tr key={sale.id}>
              <td>
                <span className="sale-number mono">{sale.saleNumber}</span>
                {sale.note ? <span className="sale-note">{sale.note}</span> : null}
              </td>
              <td className="align-right amount-cell">{money(sale.amount)}</td>
              <td>
                <span className="weight-chip">{sale.weightLabel}</span>
              </td>
              {showDate ? <td className="muted-cell">{shortDateLabel(sale.date)}</td> : null}
              <td className="muted-cell">{saleTimeLabel(sale.time)}</td>
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
