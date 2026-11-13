import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import EmptyState, { ErrorBanner } from '../components/Feedback';
import { CashierIcon, CheckIcon, RefreshIcon, ScaleIcon } from '../components/Icons';
import {
  kg,
  money,
  moneyPaisa,
  rupeesToPaisa,
  saleTimeLabel,
  todayKey,
  weightLabelFromMg,
} from '../format';

const MAX_QTY = 999;

const digitsOnly = (value, decimals = 2) => {
  const cleaned = String(value).replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, decimals)}` : whole;
};

function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function lineIdentity(line) {
  if (line.kind === 'BIRYANI_PORTION') return `portion-${line.productId}-${line.portionId}`;
  if (line.kind === 'OTHER_PRODUCT') return `other-${line.productId}`;
  return line.id;
}

function describeLine(line) {
  if (line.kind === 'BIRYANI_PORTION') return line.portionLabel || '';
  if (line.kind === 'BIRYANI_AMOUNT') return 'Custom amount';
  if (line.kind === 'BIRYANI_WEIGHT') return `Custom weight · ${weightLabelFromMg(line.weightMg)}`;
  if (line.kind === 'OTHER_PRODUCT') return 'Other item';
  return 'Manual item';
}

export default function Cashier({ onNavigate }) {
  const [menu, setMenu] = useState(null);
  const [menuError, setMenuError] = useState('');
  const [loadingMenu, setLoadingMenu] = useState(true);

  const [cart, setCart] = useState([]);
  const [orderNote, setOrderNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [today, setToday] = useState(null);

  const [biryaniProductId, setBiryaniProductId] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customWeight, setCustomWeight] = useState('');
  const [customWeightUnit, setCustomWeightUnit] = useState('kg');

  const [otherName, setOtherName] = useState('');
  const [otherPrice, setOtherPrice] = useState('');
  const [otherQty, setOtherQty] = useState('1');

  const requestIdRef = useRef(newRequestId());
  const cooldownTimer = useRef(null);
  const amountRef = useRef(null);

  const biryaniProducts = useMemo(
    () =>
      (menu?.products || []).filter(
        (product) => product.code !== 'LEGACY' && product.type === 'BIRYANI' && product.enabled
      ),
    [menu]
  );
  const otherProducts = useMemo(
    () =>
      (menu?.products || []).filter(
        (product) => product.code !== 'LEGACY' && product.type === 'OTHER' && product.enabled
      ),
    [menu]
  );

  const selectedBiryani = useMemo(
    () => biryaniProducts.find((product) => String(product.id) === String(biryaniProductId)) || null,
    [biryaniProducts, biryaniProductId]
  );

  const cartPaisa = useMemo(
    () =>
      cart.reduce(
        (sum, line) => sum + Math.round(Number(line.unitPricePaisa) || 0) * line.quantity,
        0
      ),
    [cart]
  );
  const cartQuantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartKgMg = cart.reduce(
    (sum, line) => sum + (line.weightMg || 0) * line.quantity,
    0
  );

  const loadMenu = useCallback(async () => {
    setLoadingMenu(true);
    try {
      const data = await api.menu();
      setMenu(data);
      setMenuError('');
      setBiryaniProductId((current) => {
        const available = (data.products || []).filter(
          (product) =>
            product.code !== 'LEGACY' && product.type === 'BIRYANI' && product.enabled
        );
        if (available.some((product) => String(product.id) === String(current))) return current;
        return available.length ? String(available[0].id) : '';
      });
    } catch (loadError) {
      setMenuError(loadError.message);
    } finally {
      setLoadingMenu(false);
    }
  }, []);

  const loadToday = useCallback(async () => {
    try {
      setToday(await api.summary(todayKey()));
    } catch {
      setToday(null);
    }
  }, []);

  useEffect(() => {
    loadMenu();
    loadToday();
  }, [loadMenu, loadToday]);

  useEffect(() => {
    const onFocus = () => {
      loadMenu();
      loadToday();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadMenu, loadToday]);

  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    []
  );

  const clearError = () => setError('');

  const addOrIncrement = (line) => {
    clearError();
    const identity = lineIdentity(line);
    setCart((current) => {
      const index = current.findIndex((entry) => entry.id === identity);
      if (index === -1) return [...current, { ...line, id: identity, quantity: 1 }];
      const next = [...current];
      const existing = next[index];
      next[index] = { ...existing, quantity: Math.min(existing.quantity + 1, MAX_QTY) };
      return next;
    });
  };

  const addPortion = (product, portion) => {
    if (!portion.enabled) {
      setError(`${product.name} ${portion.label} is disabled in Owner Settings.`);
      return;
    }
    if (portion.effectivePricePaisa === null || portion.effectivePricePaisa === undefined) {
      setError(
        `${product.name} ${portion.label} has no price. Set it in Owner Settings → Menu & Pricing.`
      );
      return;
    }
    addOrIncrement({
      kind: 'BIRYANI_PORTION',
      productId: product.id,
      portionId: portion.id,
      productName: product.name,
      portionLabel: portion.label,
      weightMg: portion.weightMg,
      unitPricePaisa: portion.effectivePricePaisa,
    });
  };

  const addOtherProduct = (product) => {
    if (product.unitPricePaisa === null || product.unitPricePaisa === undefined) {
      setError(`${product.name} has no price. Set it in Owner Settings → Menu & Pricing.`);
      return;
    }
    addOrIncrement({
      kind: 'OTHER_PRODUCT',
      productId: product.id,
      productName: product.name,
      portionLabel: '',
      weightMg: 0,
      unitPricePaisa: product.unitPricePaisa,
    });
  };

  const handleCustomAmount = () => {
    if (!selectedBiryani) {
      setError('Choose a biryani item first.');
      return;
    }
    if (selectedBiryani.pricePerKgPaisa === null) {
      setError(
        `${selectedBiryani.name} has no price per kg. Set it in Owner Settings → Menu & Pricing.`
      );
      return;
    }
    const paisa = rupeesToPaisa(customAmount);
    if (!Number.isFinite(paisa) || paisa <= 0) {
      setError('Enter the custom biryani amount received from the customer.');
      return;
    }
    clearError();
    setCart((current) => [
      ...current,
      {
        id: newLineId(),
        kind: 'BIRYANI_AMOUNT',
        productId: selectedBiryani.id,
        productName: selectedBiryani.name,
        portionLabel: 'Custom amount',
        weightMg: 0,
        amountPaisa: paisa,
        unitPricePaisa: paisa,
        quantity: 1,
      },
    ]);
    setCustomAmount('');
  };

  const handleCustomWeight = () => {
    if (!selectedBiryani) {
      setError('Choose a biryani item first.');
      return;
    }
    if (selectedBiryani.pricePerKgPaisa === null) {
      setError(
        `${selectedBiryani.name} has no price per kg. Set it in Owner Settings → Menu & Pricing.`
      );
      return;
    }
    const value = Number(customWeight);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a valid biryani weight.');
      return;
    }
    const weightMg = Math.round(value * (customWeightUnit === 'g' ? 1000 : 1000000));
    if (weightMg <= 0 || weightMg > 50000000) {
      setError('Weight must be greater than 0 and cannot exceed 50 kg.');
      return;
    }
    const unitPricePaisa = Math.round(
      (selectedBiryani.pricePerKgPaisa * weightMg) / 1000000
    );
    if (unitPricePaisa <= 0) {
      setError('That weight is too small to calculate a price.');
      return;
    }
    clearError();
    setCart((current) => [
      ...current,
      {
        id: newLineId(),
        kind: 'BIRYANI_WEIGHT',
        productId: selectedBiryani.id,
        productName: selectedBiryani.name,
        portionLabel: `Custom weight · ${weightLabelFromMg(weightMg)}`,
        weightMg,
        unitPricePaisa,
        quantity: 1,
      },
    ]);
    setCustomWeight('');
  };

  const handleManualOther = () => {
    const name = otherName.trim();
    if (!name) {
      setError('Enter a name for the other item.');
      return;
    }
    const paisa = rupeesToPaisa(otherPrice);
    if (!Number.isFinite(paisa) || paisa <= 0) {
      setError('Enter a selling price for the other item.');
      return;
    }
    const quantity = Math.min(Math.max(Number(otherQty) || 1, 1), MAX_QTY);
    clearError();
    setCart((current) => [
      ...current,
      {
        id: newLineId(),
        kind: 'OTHER_MANUAL',
        productId: null,
        productName: name,
        portionLabel: 'Manual item',
        weightMg: 0,
        unitPricePaisa: paisa,
        quantity,
      },
    ]);
    setOtherName('');
    setOtherPrice('');
    setOtherQty('1');
  };

  const changeQuantity = (id, delta) => {
    setCart((current) =>
      current
        .map((line) =>
          line.id === id
            ? {
                ...line,
                quantity: Math.min(Math.max(line.quantity + delta, 0), MAX_QTY),
              }
            : line
        )
        .filter((line) => line.quantity > 0)
    );
  };

  const removeLine = (id) => {
    setCart((current) => current.filter((line) => line.id !== id));
    clearError();
  };

  const clearCart = () => {
    if (cart.length && !window.confirm('Remove all items from this order?')) return;
    setCart([]);
    clearError();
  };

  const buildItems = () =>
    cart.map((line) => {
      if (line.kind === 'BIRYANI_PORTION') {
        return {
          kind: 'BIRYANI_PORTION',
          productId: line.productId,
          portionId: line.portionId,
          quantity: line.quantity,
        };
      }
      if (line.kind === 'BIRYANI_AMOUNT') {
        return { kind: 'BIRYANI_AMOUNT', productId: line.productId, amountPaisa: line.amountPaisa };
      }
      if (line.kind === 'BIRYANI_WEIGHT') {
        return { kind: 'BIRYANI_WEIGHT', productId: line.productId, weightMg: line.weightMg };
      }
      if (line.kind === 'OTHER_PRODUCT') {
        return { kind: 'OTHER', productId: line.productId, quantity: line.quantity };
      }
      return {
        kind: 'OTHER',
        name: line.productName,
        unitPricePaisa: line.unitPricePaisa,
        quantity: line.quantity,
      };
    });

  const saveOrder = async (event) => {
    event?.preventDefault();
    if (submitting || cooldown) return;
    setError('');
    setSuccess(null);

    if (!cart.length) {
      setError('Add at least one biryani or other item before saving.');
      return;
    }
    if (cartPaisa <= 0) {
      setError('The order total must be greater than 0.');
      return;
    }
    if (cart.length > 100) {
      setError('An order cannot contain more than 100 items.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.createOrder({
        requestId: requestIdRef.current,
        items: buildItems(),
        note: orderNote,
      });
      setSuccess({ order: result.order, duplicate: result.duplicate });
      setCart([]);
      setOrderNote('');
      setCustomAmount('');
      setCustomWeight('');
      requestIdRef.current = newRequestId();
      loadToday();
      setCooldown(true);
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      cooldownTimer.current = setTimeout(() => {
        setCooldown(false);
        amountRef.current?.focus();
      }, 1200);
    } catch (saveError) {
      setError(saveError.message || 'The order could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const dismissSuccess = () => {
    setSuccess(null);
    amountRef.current?.focus();
  };

  return (
    <div className="page cashier-page">
      <PageHeader
        title="New Sale"
        subtitle="Tap an item to add it. Tap again to increase the quantity, then save the order."
        actions={
          <div className="today-pill">
            <span className="today-pill-label">Today</span>
            <span className="today-pill-value">
              {today ? `${today.orders} orders · ${money(today.revenue)}` : '—'}
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
            <strong>{success.duplicate ? 'Order was already saved' : 'Order saved successfully'}</strong>
            <span className="success-meta">
              <span className="mono">{success.order.orderNumber}</span>
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              {money(success.order.total)}
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              {success.order.itemCount} item{success.order.itemCount === 1 ? '' : 's'}
              {success.order.kg ? (
                <>
                  <span className="dot-sep" aria-hidden="true">
                    ·
                  </span>
                  {kg(success.order.kg)}
                </>
              ) : null}
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              {saleTimeLabel(success.order.time)}
            </span>
            <span className="success-hint">Give the customer the usual physical token.</span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={dismissSuccess}>
            New order
          </button>
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {menuError ? <ErrorBanner message={menuError} onRetry={loadMenu} /> : null}

      <div className="cashier-grid cashier-grid-pos">
        <div className="cashier-main">
          <section className="card qa-card">
            <div className="card-heading">
              <div>
                <h2 className="card-title">Quick items</h2>
                <p className="card-subtitle">One tap adds a portion. Tap again to add another.</p>
              </div>
              <span className="card-chip">
                <CashierIcon size={16} /> Fast entry
              </span>
            </div>

            {loadingMenu && !menu ? (
              <div className="skeleton-list" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div className="skeleton-row" key={index}>
                    <span className="skeleton skeleton-md" />
                    <span className="skeleton skeleton-sm" />
                    <span className="skeleton skeleton-xs" />
                  </div>
                ))}
              </div>
            ) : biryaniProducts.length ? (
              <div className="biryani-groups">
                {biryaniProducts.map((product) => (
                  <div className="biryani-group" key={product.id}>
                    <div className="biryani-group-head">
                      <h3>{product.name}</h3>
                      <span className="biryani-kind">
                        {product.biryaniKind === 'SADI' ? 'Sadi' : 'Beef'}
                      </span>
                    </div>
                    <div className="qa-grid">
                      {product.portions
                        .filter((portion) => portion.enabled)
                        .map((portion) => {
                          const configured =
                            portion.effectivePricePaisa !== null &&
                            portion.effectivePricePaisa !== undefined;
                          return (
                            <button
                              key={portion.id}
                              type="button"
                              className={`qa-tile ${configured ? '' : 'qa-tile-unpriced'}`}
                              onClick={() => addPortion(product, portion)}
                              title={
                                configured
                                  ? `${product.name} ${portion.label} — ${moneyPaisa(
                                      portion.effectivePricePaisa
                                    )}`
                                  : 'Set this price in Owner Settings'
                              }
                            >
                              <span className="qa-name">{portion.label}</span>
                              <span className="qa-weight">{portion.weightLabel}</span>
                              <span className="qa-price">
                                {configured ? moneyPaisa(portion.effectivePricePaisa) : 'Set price'}
                              </span>
                            </button>
                          );
                        })}
                      {product.portions.filter((portion) => portion.enabled).length === 0 ? (
                        <p className="field-hint">No portions enabled for this item.</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No biryani items are configured"
                message="Open Settings → Menu & Pricing to set Sadi and Beef prices before taking sales."
              />
            )}

            {otherProducts.length ? (
              <>
                <div className="qa-divider" />
                <h3 className="qa-subtitle">Other items</h3>
                <div className="qa-grid qa-grid-other">
                  {otherProducts.map((product) => {
                    const configured =
                      product.unitPricePaisa !== null && product.unitPricePaisa !== undefined;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        className={`qa-tile qa-tile-other ${configured ? '' : 'qa-tile-unpriced'}`}
                        onClick={() => addOtherProduct(product)}
                      >
                        <span className="qa-name">{product.name}</span>
                        <span className="qa-weight">Other item</span>
                        <span className="qa-price">
                          {configured ? moneyPaisa(product.unitPricePaisa) : 'Set price'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>

          <div className="cashier-forms">
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2 className="card-title">Custom amount</h2>
                  <p className="card-subtitle">Customer gave a round amount instead of a portion.</p>
                </div>
                <span className="card-chip">
                  <CashierIcon size={16} /> Amount
                </span>
              </div>
              <div className="inline-field">
                <label htmlFor="biryani-product-amount">Biryani item</label>
                <select
                  id="biryani-product-amount"
                  className="input"
                  value={biryaniProductId}
                  onChange={(event) => setBiryaniProductId(event.target.value)}
                >
                  {biryaniProducts.length ? (
                    biryaniProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No biryani item</option>
                  )}
                </select>
              </div>
              <div className="inline-field-row">
                <div className="money-input">
                  <span>Rs</span>
                  <input
                    ref={amountRef}
                    className="input"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={customAmount}
                    onChange={(event) => setCustomAmount(digitsOnly(event.target.value))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleCustomAmount();
                      }
                    }}
                    aria-label="Custom biryani amount in rupees"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCustomAmount}
                  disabled={!biryaniProducts.length}
                >
                  Add amount
                </button>
              </div>
              <p className="field-hint">
                Weight is calculated from the price per kg saved by the owner.
              </p>
            </section>

            <section className="card">
              <div className="card-heading">
                <div>
                  <h2 className="card-title">Custom weight</h2>
                  <p className="card-subtitle">Use the scale reading when it is not a normal portion.</p>
                </div>
                <span className="card-chip">
                  <ScaleIcon size={16} /> Weight
                </span>
              </div>
              <div className="inline-field">
                <label htmlFor="biryani-product-weight">Biryani item</label>
                <select
                  id="biryani-product-weight"
                  className="input"
                  value={biryaniProductId}
                  onChange={(event) => setBiryaniProductId(event.target.value)}
                >
                  {biryaniProducts.length ? (
                    biryaniProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No biryani item</option>
                  )}
                </select>
              </div>
              <div className="inline-field-row">
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder={customWeightUnit === 'g' ? 'e.g. 750' : 'e.g. 1.5'}
                  value={customWeight}
                  onChange={(event) => setCustomWeight(digitsOnly(event.target.value, 3))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleCustomWeight();
                    }
                  }}
                  aria-label="Custom biryani weight"
                />
                <div className="unit-toggle" role="group" aria-label="Weight unit">
                  <button
                    type="button"
                    className={customWeightUnit === 'kg' ? 'unit-active' : ''}
                    onClick={() => setCustomWeightUnit('kg')}
                  >
                    KG
                  </button>
                  <button
                    type="button"
                    className={customWeightUnit === 'g' ? 'unit-active' : ''}
                    onClick={() => setCustomWeightUnit('g')}
                  >
                    grams
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCustomWeight}
                  disabled={!biryaniProducts.length}
                >
                  Add weight
                </button>
              </div>
              <p className="field-hint">
                Maximum 50 kg per item. Price is calculated from the owner&apos;s rate per kg.
              </p>
            </section>

            <section className="card">
              <div className="card-heading">
                <div>
                  <h2 className="card-title">Other item not on the menu</h2>
                  <p className="card-subtitle">
                    Record a one-off item. It is saved as an other item with no cost unless the owner
                    adds it to the menu.
                  </p>
                </div>
              </div>
              <div className="other-form">
                <input
                  className="input"
                  type="text"
                  maxLength={80}
                  placeholder="Item name e.g. raita"
                  value={otherName}
                  onChange={(event) => setOtherName(event.target.value)}
                  aria-label="Other item name"
                />
                <div className="money-input">
                  <span>Rs</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={otherPrice}
                    onChange={(event) => setOtherPrice(digitsOnly(event.target.value))}
                    aria-label="Other item selling price"
                  />
                </div>
                <input
                  className="input input-qty"
                  type="number"
                  min="1"
                  max={MAX_QTY}
                  value={otherQty}
                  onChange={(event) => setOtherQty(event.target.value)}
                  aria-label="Other item quantity"
                />
                <button type="button" className="btn btn-primary" onClick={handleManualOther}>
                  Add item
                </button>
              </div>
            </section>
          </div>
        </div>

        <aside className="ticket ticket-pos" aria-label="Current order">
          <div className="ticket-top">
            <span className="ticket-eyebrow">Current order</span>
            <span className="ticket-brand">JOONA BIRYANI</span>
          </div>

          {cart.length ? (
            <div className="cart-lines">
              {cart.map((line) => (
                <div className="cart-line" key={line.id}>
                  <div className="cart-line-main">
                    <div className="cart-line-name">
                      {line.productName}
                      <span className="cart-line-portion">{describeLine(line)}</span>
                    </div>
                    <div className="cart-line-price">
                      {line.kind === 'BIRYANI_AMOUNT'
                        ? moneyPaisa(line.unitPricePaisa)
                        : `${moneyPaisa(line.unitPricePaisa)} each`}
                    </div>
                  </div>
                  <div className="cart-line-controls">
                    {line.kind === 'BIRYANI_PORTION' || line.kind === 'OTHER_PRODUCT' ? (
                      <div className="qty-control" role="group" aria-label={`Quantity for ${line.productName}`}>
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.id, -1)}
                          aria-label={`Decrease ${line.productName}`}
                        >
                          −
                        </button>
                        <span aria-live="polite">{line.quantity}</span>
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.id, 1)}
                          aria-label={`Increase ${line.productName}`}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <span className="cart-qty-fixed">{line.quantity}</span>
                    )}
                    <span className="cart-line-total">
                      {moneyPaisa(line.unitPricePaisa * line.quantity)}
                    </span>
                    <button
                      type="button"
                      className="cart-remove"
                      onClick={() => removeLine(line.id)}
                      aria-label={`Remove ${line.productName} from order`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="cart-empty">
              <CashierIcon size={30} />
              <p>No items in this order yet.</p>
              <span>Tap a quick item to start.</span>
            </div>
          )}

          <div className="ticket-divider" />

          <div className="ticket-row">
            <span>
              {cartQuantity} item{cartQuantity === 1 ? '' : 's'}
            </span>
            <strong>{cartKgMg ? kg(cartKgMg / 1000000) : '—'}</strong>
          </div>

          <div className="ticket-total">
            <span>Order total</span>
            <span className="ticket-total-value">{moneyPaisa(cartPaisa)}</span>
          </div>

          <label className="ticket-note-field">
            <span>Order note (optional)</span>
            <input
              className="input"
              type="text"
              maxLength={200}
              placeholder="e.g. family pack, extra raita"
              value={orderNote}
              onChange={(event) => setOrderNote(event.target.value)}
            />
          </label>

          <form onSubmit={saveOrder}>
            <button
              type="submit"
              className="btn btn-gold btn-lg ticket-save"
              disabled={submitting || cooldown}
            >
              {submitting ? 'Saving…' : cooldown ? 'Saved ✓' : `Save Order · ${moneyPaisa(cartPaisa)}`}
            </button>
          </form>
          <p className="ticket-hint">Duplicate clicks are blocked. The order number is created on save.</p>

          <div className="ticket-footer">
            <div className="ticket-footer-actions">
              <button
                type="button"
                className="link-button"
                onClick={clearCart}
                disabled={!cart.length}
              >
                Clear order
              </button>
              <button type="button" className="link-button" onClick={() => onNavigate('history')}>
                View today&apos;s orders →
              </button>
            </div>
            <p className="ticket-note">
              Physical tokens stay exactly as they are. The software only records the sale.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
