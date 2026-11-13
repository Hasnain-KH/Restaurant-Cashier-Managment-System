import { ReceiptIcon } from './Icons';

export default function EmptyState({ title, message, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      <span className="empty-icon">
        <ReceiptIcon size={compact ? 22 : 30} />
      </span>
      <div>
        <p className="empty-title">{title}</p>
        {message ? <p className="empty-text">{message}</p> : null}
      </div>
    </div>
  );
}

export function LoadingRows({ rows = 5 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton skeleton-md" />
          <span className="skeleton skeleton-sm" />
          <span className="skeleton skeleton-xs" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onRetry, label = 'Try again' }) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-small btn-ghost" onClick={onRetry}>
          {label}
        </button>
      ) : null}
    </div>
  );
}
