import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import { CashierIcon, CheckIcon, ScaleIcon } from '../components/Icons';
import { describeWeight, money, saleTimeLabel, todayKey } from '../format';

const WEIGHT_OPTIONS = [
  { id: 'pao', label: 'Pao', caption: '250 g' },
  { id: 'half', label: 'Half KG', caption: '500 g' },
  { id: 'one', label: '1 KG', caption: '1000 g' },
  { id: 'custom', label: 'Custom', caption: 'Any weight' },
];

const WEIGHT_BY_MODE = { pao: 0.25, half: 0.5, one: 1 };

const digitsOnly = (value) => {
  const cleaned = String(value).replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 3)}` : whole;
};

function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Cashier({ onNavigate }) {
  const [amount, setAmount] = useState('');
  const [weightMode, setWeightMode] = useState('one');
  const [customWeight, setCustomWeight] = useState('');
  const [customUnit, setCustomUnit] = useState('kg');
  const [note, setNote] = useState('');
  const [rate, setRate] = useState(() => {
    try {
      return window.localStorage.getItem('joona.ratePerKg') || '';
    } catch {
      return '';
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [today, setToday] = useState(null);

  const amountRef = useRef(null);
  const requestIdRef = useRef(newRequestId());
  const cooldownTimer = useRef(null);

  const weightKg =
    weightMode === 'custom'
      ? (Number(customWeight) || 0) / (customUnit === 'g' ? 1000 : 1)
      : WEIGHT_BY_MODE[weightMode];

  const amountValue = Number(amount) || 0;
  const rateValue = Number(rate) || 0;
  const suggestedAmount = Math.round(rateValue * weightKg * 100) / 100;

  const loadToday = useCallback(async () => {
    try {
      const summary = await api.summary(todayKey());
      setToday(summary);
    } catch {
      setToday(null);
    }
  }, []);

  useEffect(() => {
    loadToday();
    amountRef.current?.focus();
  }, [loadToday]);

  useEffect(() => {
    let active = true;
    api
      .settings()
      .then((settings) => {
        if (!active) return;
        setRate((current) => {
          if (current) return current;
          return settings.ratePerKg ? String(settings.ratePerKg) : '';
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onFocus = () => loadToday();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadToday]);

  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    []
  );

  const handleRateChange = (value) => {
    const cleaned = digitsOnly(value);
    setRate(cleaned);
    try {
      window.localStorage.setItem('joona.ratePerKg', cleaned);
    } catch {
      /* storage may be unavailable */
    }
  };

  const applyRate = () => {
    if (suggestedAmount > 0) setAmount(String(suggestedAmount));
    amountRef.current?.focus();
  };

  const resetForm = () => {
    setAmount('');
    setNote('');
    setError('');
    requestIdRef.current = newRequestId();
    amountRef.current?.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || cooldown) return;

    setError('');

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Enter the amount received from the customer.');
      amountRef.current?.focus();
      return;
    }
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      setError('Enter a valid biryani weight.');
      return;
    }
    if (weightKg > 50) {
      setError('Weight cannot exceed 50 kg for a single sale.');
      return;
    }
    if (amountValue > 1000000) {
      setError('Sale amount looks too high. Please check the amount.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.createSale({
        amount: amountValue,
        weightKg,
        note,
        requestId: requestIdRef.current,
      });

      setSuccess({
        ...result.sale,
        duplicate: result.duplicate,
        savedAmount: amountValue,
      });
      setAmount('');
      setNote('');
      setWeightMode('one');
      setCustomWeight('');
      requestIdRef.current = newRequestId();
      loadToday();

      setCooldown(true);
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      cooldownTimer.current = setTimeout(() => {
        setCooldown(false);
        amountRef.current?.focus();
      }, 1400);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const dismissSuccess = () => {
    setSuccess(null);
    resetForm();
  };

  return (
    <div className="page">
      <PageHeader
        title="New Sale"
        subtitle="Take the payment, save the sale, then hand over the physical token as usual."
        actions={
          <div className="today-pill">
            <span className="today-pill-label">Today</span>
            <span className="today-pill-value">
              {today ? `${today.orders} orders · ${money(today.total)}` : '—'}
            </span>
          </div>
        }
      />

      {success ? (
        <div className={`success-banner ${success.duplicate ? 'success-banner-duplicate' : ''}`}>
          <span className="success-icon">
            <CheckIcon size={26} />
          </span>
          <div className="success-body">
            <strong>{success.duplicate ? 'Sale was already saved' : 'Sale saved successfully'}</strong>
            <span className="success-meta">
              <span className="mono">{success.saleNumber}</span>
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              {money(success.savedAmount ?? success.amount)}
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              {success.weightLabel}
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              {saleTimeLabel(success.time)}
            </span>
            <span className="success-hint">Give the customer the usual physical token.</span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={dismissSuccess}>
            New sale
          </button>
        </div>
      ) : null}

      <div className="cashier-grid">
        <section className="card sale-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Sale details</h2>
              <p className="card-subtitle">Amount and weight are all you need.</p>
            </div>
            <span className="card-chip">
              <CashierIcon size={16} /> Fast entry
            </span>
          </div>

          <form id="sale-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="amount">Sale amount</label>
              <div className="amount-input">
                <span className="amount-prefix">Rs</span>
                <input
                  id="amount"
                  ref={amountRef}
                  className="amount-field"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={(event) => setAmount(digitsOnly(event.target.value))}
                  aria-describedby="amount-hint"
                />
              </div>
              <p className="field-hint" id="amount-hint">
                Enter the money received by the cashier.
              </p>
            </div>

            <div className="field">
              <div className="field-label-row">
                <label>Biryani weight</label>
                <span className="field-value">{describeWeight(weightKg)}</span>
              </div>
              <div className="weight-options" role="group" aria-label="Biryani weight">
                {WEIGHT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`weight-option ${weightMode === option.id ? 'weight-option-active' : ''}`}
                    onClick={() => {
                      setWeightMode(option.id);
                      setError('');
                    }}
                    aria-pressed={weightMode === option.id}
                  >
                    <span className="weight-option-label">{option.label}</span>
                    <span className="weight-option-caption">{option.caption}</span>
                  </button>
                ))}
              </div>

              {weightMode === 'custom' ? (
                <div className="custom-weight">
                  <div className="custom-weight-input">
                    <ScaleIcon size={18} />
                    <input
                      className="input input-weight"
                      type="text"
                      inputMode="decimal"
                      placeholder={customUnit === 'g' ? 'e.g. 750' : 'e.g. 1.5'}
                      value={customWeight}
                      onChange={(event) => setCustomWeight(digitsOnly(event.target.value))}
                      aria-label="Custom weight"
                      autoFocus
                    />
                  </div>
                  <div className="unit-toggle" role="group" aria-label="Weight unit">
                    <button
                      type="button"
                      className={customUnit === 'kg' ? 'unit-active' : ''}
                      onClick={() => setCustomUnit('kg')}
                    >
                      KG
                    </button>
                    <button
                      type="button"
                      className={customUnit === 'g' ? 'unit-active' : ''}
                      onClick={() => setCustomUnit('g')}
                    >
                      grams
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="note">
                Note <span className="optional-tag">optional</span>
              </label>
              <input
                id="note"
                className="input input-note"
                type="text"
                maxLength={200}
                placeholder="e.g. family pack, extra raita"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <div className="price-helper">
              <div className="helper-heading">
                <div>
                  <span className="helper-title">Price helper</span>
                  <span className="helper-sub">Optional — calculate amount from rate per kg.</span>
                </div>
              </div>
              <div className="helper-row">
                <div className="helper-rate">
                  <span className="helper-prefix">Rs</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Rate per kg"
                    value={rate}
                    onChange={(event) => handleRateChange(event.target.value)}
                    aria-label="Price per kg"
                  />
                  <span className="helper-suffix">/ kg</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={applyRate}
                  disabled={suggestedAmount <= 0}
                >
                  Use {money(suggestedAmount)}
                </button>
              </div>
            </div>
          </form>
        </section>

        <aside className="ticket" aria-label="Sale summary">
          <div className="ticket-top">
            <span className="ticket-eyebrow">Sale summary</span>
            <span className="ticket-brand">JOONA BIRYANI</span>
          </div>

          <div className="ticket-row">
            <span>Weight</span>
            <strong>{describeWeight(weightKg)}</strong>
          </div>
          <div className="ticket-row">
            <span>Amount</span>
            <strong>{money(amountValue)}</strong>
          </div>
          <div className="ticket-row ticket-row-muted">
            <span>Sale number</span>
            <span className="mono">Generated on save</span>
          </div>

          <div className="ticket-divider" />

          <div className="ticket-total">
            <span>Total to record</span>
            <span className="ticket-total-value">{money(amountValue)}</span>
          </div>

          <button
            type="submit"
            form="sale-form"
            className="btn btn-gold btn-lg ticket-save"
            disabled={submitting || cooldown}
          >
            {submitting ? 'Saving…' : cooldown ? 'Saved ✓' : 'Save Sale'}
          </button>
          <p className="ticket-hint">Press Enter to save · duplicate clicks are blocked</p>

          <div className="ticket-footer">
            <p className="ticket-note">
              Physical tokens stay exactly as they are. The software only records the sale.
            </p>
            <button
              type="button"
              className="link-button"
              onClick={() => onNavigate('history')}
            >
              View today&apos;s sales →
            </button>
          </div>
        </aside>
      </div>

      {error ? (
        <div className="error-banner error-banner-inline" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
