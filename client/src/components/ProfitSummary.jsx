import { money } from '../format';
import { AlertIcon } from './Icons';

function amount(value, { negate = false } = {}) {
  if (value === null || value === undefined) return '—';
  const number = Number(value) || 0;
  return money(negate ? -Math.abs(number) : number);
}

export default function ProfitSummary({ report, title = 'Profit summary', compact = false }) {
  if (!report) return null;
  const complete = report.profitComplete !== false;
  const missing = report.missingCostItems || [];

  return (
    <section className={`card profit-card ${compact ? 'profit-card-compact' : ''}`}>
      <div className="card-heading">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="card-subtitle">
            Estimated figures from the prices and costs saved with each sale.
          </p>
        </div>
        <span className={`card-chip ${complete ? '' : 'card-chip-warning'}`}>
          {complete ? 'Complete' : 'Incomplete'}
        </span>
      </div>

      {!complete ? (
        <div className="profit-warning" role="status">
          <span className="profit-warning-icon">
            <AlertIcon size={20} />
          </span>
          <div>
            <strong>Profit Calculation Incomplete</strong>
            <p>
              Some items in this period have no recorded cost, so gross and net profit cannot be
              calculated honestly.
            </p>
            {missing.length ? (
              <p className="profit-missing">
                Missing cost: {missing.join(', ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="profit-rows">
        <div className="profit-row">
          <span>Sales revenue</span>
          <strong>{amount(report.revenue ?? report.total)}</strong>
        </div>
        <div className="profit-row">
          <span>Other item revenue (included above)</span>
          <span>{amount(report.otherRevenue)}</span>
        </div>
        <div className="profit-row">
          <span>Estimated product cost</span>
          <strong>{complete ? amount(report.estimatedProductCost) : 'Unavailable'}</strong>
        </div>
        <div className="profit-row profit-row-gross">
          <span>Estimated gross profit</span>
          <strong>{complete ? amount(report.estimatedGrossProfit) : 'Unavailable'}</strong>
        </div>
        <div className="profit-row">
          <span>Recorded expenses</span>
          <strong>{amount(report.recordedExpenses ?? report.expenses, { negate: true })}</strong>
        </div>
        <div className="profit-row profit-row-net">
          <span>Estimated net profit</span>
          <strong>{complete ? amount(report.estimatedNetProfit) : 'Unavailable'}</strong>
        </div>
      </div>

      <p className="profit-footnote">
        Costs are snapshots taken from Owner Settings at the moment each sale was saved. Changing a
        price today never changes old orders.
      </p>
    </section>
  );
}
