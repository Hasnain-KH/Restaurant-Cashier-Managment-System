import { useCallback, useEffect, useState } from 'react';
import { api, appInfo, isDesktopApp } from '../api';
import PageHeader from '../components/PageHeader';
import EmptyState, { ErrorBanner } from '../components/Feedback';
import { toast } from '../toast';
import {
  BackupIcon,
  DatabaseIcon,
  FolderIcon,
  RestoreIcon,
} from '../components/Icons';
import {
  APP_TIME_ZONE,
  dateLabel,
  money,
  rupeesToPaisa,
  todayKey,
} from '../format';

const TABS = [
  { id: 'pricing', label: 'Menu & Pricing' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'backup', label: 'Backup & Restore' },
  { id: 'about', label: 'About' },
];

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function blankToPaisa(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const paisa = rupeesToPaisa(value);
  if (!Number.isFinite(paisa)) throw new Error('Enter a valid amount in rupees.');
  return paisa;
}

function moneyValue(paisa) {
  if (paisa === null || paisa === undefined) return '';
  return String(paisa / 100);
}

function PortionRow({ portion, onChanged }) {
  const [label, setLabel] = useState(portion.label);
  const [weightG, setWeightG] = useState(String(Math.round(portion.weightMg / 1000)));
  const [price, setPrice] = useState(moneyValue(portion.pricePaisa));
  const [enabled, setEnabled] = useState(portion.enabled);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updatePortion(portion.id, {
        label,
        weightG: Number(weightG),
        pricePaisa: blankToPaisa(price),
        enabled,
      });
      onChanged(updated);
      toast(`${updated.name} ${label} saved.`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the portion “${portion.label}”?`)) return;
    setBusy(true);
    try {
      const updated = await api.deletePortion(portion.id);
      onChanged(updated);
      toast('Portion removed.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portion-row">
      <input
        className="input"
        value={label}
        maxLength={40}
        onChange={(event) => setLabel(event.target.value)}
        aria-label="Portion name"
      />
      <div className="portion-weights">
        <input
          className="input"
          type="number"
          min="1"
          max="50000"
          value={weightG}
          onChange={(event) => setWeightG(event.target.value)}
          aria-label={`${portion.label} weight in grams`}
        />
        <span>g</span>
      </div>
      <div className="money-input">
        <span>Rs</span>
        <input
          className="input"
          type="text"
          inputMode="decimal"
          placeholder="Use per kg"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          aria-label={`${portion.label} price override`}
        />
      </div>
      <label className="check-field">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enabled
      </label>
      <div className="portion-actions">
        <button type="button" className="btn btn-small btn-primary" onClick={save} disabled={busy}>
          Save
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={remove} disabled={busy}>
          Remove
        </button>
      </div>
      {!portion.priceConfigured ? (
        <p className="portion-note">
          No price yet. Set a per-kg price or a portion price before selling this portion.
        </p>
      ) : null}
    </div>
  );
}

function ProductCard({ product, onChanged }) {
  const [name, setName] = useState(product.name);
  const [enabled, setEnabled] = useState(product.enabled);
  const [pricePerKg, setPricePerKg] = useState(moneyValue(product.pricePerKgPaisa));
  const [costPerKg, setCostPerKg] = useState(moneyValue(product.costPerKgPaisa));
  const [unitPrice, setUnitPrice] = useState(moneyValue(product.unitPricePaisa));
  const [unitCost, setUnitCost] = useState(moneyValue(product.unitCostPaisa));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newPortion, setNewPortion] = useState({ label: '', weightG: '', price: '' });

  const legacy = product.code === 'LEGACY';

  const saveProduct = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = { name, enabled };
      if (product.type === 'BIRYANI') {
        payload.pricePerKgPaisa = blankToPaisa(pricePerKg);
        payload.costPerKgPaisa = blankToPaisa(costPerKg);
      } else {
        payload.unitPricePaisa = blankToPaisa(unitPrice);
        payload.unitCostPaisa = blankToPaisa(unitCost);
      }
      const updated = await api.updateProduct(product.id, payload);
      onChanged(updated);
      toast(`${updated.name} saved.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  const addPortion = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await api.createPortion(product.id, {
        label: newPortion.label,
        weightG: Number(newPortion.weightG),
        pricePaisa: blankToPaisa(newPortion.price),
      });
      onChanged(updated);
      setNewPortion({ label: '', weightG: '', price: '' });
      toast('Portion added.');
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card menu-product-card">
      <div className="card-heading">
        <div>
          <h2 className="card-title">{product.name}</h2>
          <p className="card-subtitle">
            {legacy
              ? 'Imported v1 sales stay Legacy / Unclassified and cannot be repriced.'
              : product.type === 'BIRYANI'
              ? `Biryani · ${product.biryaniKind === 'SADI' ? 'Sadi' : 'Beef'}`
              : 'Other item'}
          </p>
        </div>
        <span className={`card-chip ${enabled ? '' : 'card-chip-warning'}`}>
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="product-fields">
        <label className="field-inline">
          <span>Item name</span>
          <input
            className="input"
            value={name}
            maxLength={80}
            disabled={legacy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={enabled}
            disabled={legacy}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Show on cashier screen
        </label>
      </div>

      {product.type === 'BIRYANI' ? (
        <div className="product-fields">
          <label className="field-inline">
            <span>Price per kg (Rs)</span>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Not set"
              value={pricePerKg}
              disabled={legacy}
              onChange={(event) => setPricePerKg(event.target.value)}
            />
          </label>
          <label className="field-inline">
            <span>Cost per kg (Rs)</span>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Not set"
              value={costPerKg}
              disabled={legacy}
              onChange={(event) => setCostPerKg(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="product-fields">
          <label className="field-inline">
            <span>Selling price (Rs)</span>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Not set"
              value={unitPrice}
              disabled={legacy}
              onChange={(event) => setUnitPrice(event.target.value)}
            />
          </label>
          <label className="field-inline">
            <span>Cost price (Rs)</span>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Not set"
              value={unitCost}
              disabled={legacy}
              onChange={(event) => setUnitCost(event.target.value)}
            />
          </label>
        </div>
      )}

      {!legacy ? (
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={saveProduct} disabled={busy}>
            {busy ? 'Saving…' : 'Save product'}
          </button>
          {!product.pricingConfigured ? (
            <span className="field-hint">
              This item cannot be sold until a selling price is set.
            </span>
          ) : null}
        </div>
      ) : null}

      {product.type === 'BIRYANI' && !legacy ? (
        <div className="portion-list">
          <div className="portion-heading">
            <h3>Portions</h3>
            <p>
              Each portion uses the per-kg price unless a price override is entered. Weight is in
              grams.
            </p>
          </div>
          {product.portions.map((portion) => (
            <PortionRow key={portion.id} portion={portion} onChanged={onChanged} />
          ))}
          <div className="portion-row portion-row-new">
            <input
              className="input"
              placeholder="Portion name e.g. Half KG"
              maxLength={40}
              value={newPortion.label}
              onChange={(event) =>
                setNewPortion((current) => ({ ...current, label: event.target.value }))
              }
              aria-label="New portion name"
            />
            <div className="portion-weights">
              <input
                className="input"
                type="number"
                min="1"
                max="50000"
                placeholder="500"
                value={newPortion.weightG}
                onChange={(event) =>
                  setNewPortion((current) => ({ ...current, weightG: event.target.value }))
                }
                aria-label="New portion weight in grams"
              />
              <span>g</span>
            </div>
            <div className="money-input">
              <span>Rs</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="Use per kg"
                value={newPortion.price}
                onChange={(event) =>
                  setNewPortion((current) => ({ ...current, price: event.target.value }))
                }
                aria-label="New portion price override"
              />
            </div>
            <div className="portion-actions">
              <button
                type="button"
                className="btn btn-small btn-gold"
                onClick={addPortion}
                disabled={busy}
              >
                Add portion
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function NewProductCard({ onCreated }) {
  const [type, setType] = useState('BIRYANI');
  const [kind, setKind] = useState('SADI');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = { name, type };
      if (type === 'BIRYANI') {
        payload.biryaniKind = kind;
        payload.pricePerKgPaisa = blankToPaisa(price);
        payload.costPerKgPaisa = blankToPaisa(cost);
      } else {
        payload.unitPricePaisa = blankToPaisa(price);
        payload.unitCostPaisa = blankToPaisa(cost);
      }
      const product = await api.createProduct(payload);
      onCreated(product);
      setName('');
      setPrice('');
      setCost('');
      toast(`${product.name} added. Set its price before selling.`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card menu-product-card">
      <div className="card-heading">
        <div>
          <h2 className="card-title">Add a menu item</h2>
          <p className="card-subtitle">
            New biryani items get Pao, Half KG and 1 KG portions automatically.
          </p>
        </div>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="product-fields">
        <label className="field-inline">
          <span>Type</span>
          <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="BIRYANI">Biryani</option>
            <option value="OTHER">Other item</option>
          </select>
        </label>
        {type === 'BIRYANI' ? (
          <label className="field-inline">
            <span>Biryani kind</span>
            <select className="input" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="SADI">Sadi</option>
              <option value="BEEF">Beef</option>
            </select>
          </label>
        ) : null}
        <label className="field-inline">
          <span>Name</span>
          <input
            className="input"
            placeholder="e.g. Chicken Biryani"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field-inline">
          <span>{type === 'BIRYANI' ? 'Price per kg (Rs)' : 'Selling price (Rs)'}</span>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            placeholder="Not set"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <label className="field-inline">
          <span>{type === 'BIRYANI' ? 'Cost per kg (Rs)' : 'Cost price (Rs)'}</span>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            placeholder="Not set"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </label>
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-gold" onClick={create} disabled={busy}>
          {busy ? 'Adding…' : 'Add menu item'}
        </button>
      </div>
    </section>
  );
}

function PricingTab() {
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMenu(await api.menu());
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replaceProduct = (updated) => {
    setMenu((current) => {
      if (!current) return current;
      return {
        ...current,
        products: current.products
          .map((product) => (product.id === updated.id ? updated : product))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
      };
    });
  };

  const addProduct = () => load();

  const products = menu?.products ?? [];
  const active = products.filter((product) => product.code !== 'LEGACY');
  const legacy = products.filter((product) => product.code === 'LEGACY');

  return (
    <div className="settings-stack">
      <div className="callout">
        <strong>Owner-only pricing.</strong> Cashiers cannot change prices. Every saved order keeps
        the price and cost snapshot used at that moment, so old profit figures never change.
      </div>
      <ErrorBanner message={error} onRetry={load} />
      {loading && !menu ? (
        <p className="field-hint">Loading menu…</p>
      ) : (
        <>
          {active.map((product) => (
            <ProductCard
              key={`${product.id}-${product.updatedAt}`}
              product={product}
              onChanged={replaceProduct}
            />
          ))}
          {legacy.map((product) => (
            <ProductCard key={product.id} product={product} onChanged={replaceProduct} />
          ))}
          {!products.length ? (
            <EmptyState
              title="No menu items yet"
              message="Add Sadi and Beef biryani items, then choose their prices."
            />
          ) : null}
          <NewProductCard onCreated={addProduct} />
        </>
      )}
    </div>
  );
}

function ExpensesTab() {
  const [date, setDate] = useState(todayKey());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await api.expenses({ date }));
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.addExpense({ date, description, amountPaisa: blankToPaisa(amount) });
      setDescription('');
      setAmount('');
      await load();
      toast('Expense saved.');
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (expense) => {
    if (!window.confirm(`Delete expense “${expense.description}” (${money(expense.amount)})?`)) {
      return;
    }
    try {
      await api.deleteExpense(expense.id);
      await load();
      toast('Expense deleted.');
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  const expenses = result?.expenses ?? [];

  return (
    <div className="settings-stack">
      <div className="callout">
        <strong>Recorded expenses reduce net profit.</strong> Enter them on the date the money was
        spent. Expenses do not change order records.
      </div>
      <ErrorBanner message={error} onRetry={load} />
      <section className="card">
        <div className="card-heading">
          <div>
            <h2 className="card-title">Add an expense</h2>
            <p className="card-subtitle">Examples: gas, vegetables, staff tea, repairs.</p>
          </div>
        </div>
        <form className="expense-form" onSubmit={add}>
          <label className="field-inline">
            <span>Date</span>
            <input
              className="input input-date"
              type="date"
              value={date}
              max={todayKey()}
              onChange={(event) => setDate(event.target.value || todayKey())}
            />
          </label>
          <label className="field-inline expense-description">
            <span>Description</span>
            <input
              className="input"
              maxLength={200}
              placeholder="e.g. gas cylinder"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="field-inline">
            <span>Amount (Rs)</span>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add expense'}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="card-heading">
          <div>
            <h2 className="card-title">Expenses on {dateLabel(date)}</h2>
            <p className="card-subtitle">
              {result
                ? `${result.count} expense${result.count === 1 ? '' : 's'} · ${money(
                    result.totalAmount
                  )}`
                : 'Loading…'}
            </p>
          </div>
        </div>
        {loading ? (
          <p className="field-hint">Loading expenses…</p>
        ) : expenses.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="align-right">Amount</th>
                  <th>Recorded</th>
                  <th className="align-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{expense.description}</td>
                    <td className="align-right amount-cell">{money(expense.amount)}</td>
                    <td className="muted-cell">{expense.createdAt}</td>
                    <td className="align-right">
                      <button
                        type="button"
                        className="btn btn-small btn-ghost"
                        onClick={() => remove(expense)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total for this date</td>
                  <td className="align-right amount-cell">{money(result.totalAmount)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No expenses for this date"
            message="Add an expense above or choose another date."
          />
        )}
      </section>
    </div>
  );
}

function BackupTab() {
  const [storage, setStorage] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [verification, setVerification] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      const info =
        isDesktopApp && window.joona?.info ? await window.joona.info() : await api.storage();
      setStorage(info);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const handleBackup = async () => {
    if (!isDesktopApp || !window.joona?.backup) {
      toast('Backups are available in the desktop application.', 'error');
      return;
    }
    setBusy('backup');
    try {
      const result = await window.joona.backup();
      if (result?.saved) {
        const fileName = result.path.split(/[\\/]/).pop();
        toast(`Backup saved: ${fileName} (${result.orders} orders)`);
        loadInfo();
      } else if (result?.canceled) {
        toast('Backup canceled.', 'info');
      }
    } catch (backupError) {
      toast(backupError.message || 'Backup failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleRestore = async () => {
    if (!isDesktopApp || !window.joona?.restore) {
      toast('Restore is available in the desktop application.', 'error');
      return;
    }
    setBusy('restore');
    try {
      const result = await window.joona.restore();
      if (result?.restored) {
        toast(`Backup restored — ${result.orders} orders loaded.`);
        setTimeout(() => window.location.reload(), 900);
      } else if (result?.error) {
        toast(result.error, 'error');
      } else if (result?.canceled) {
        toast('Restore canceled.', 'info');
      }
    } catch (restoreError) {
      toast(restoreError.message || 'Restore failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleVerify = async () => {
    setBusy('verify');
    setVerification(null);
    try {
      const result =
        isDesktopApp && window.joona?.verify ? await window.joona.verify() : await api.verify();
      setVerification(result);
      if (result.ok) toast('Database verification passed.');
      else toast('Database verification found a problem.', 'error');
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setBusy('');
    }
  };

  const openFolder = async (kind) => {
    if (!isDesktopApp) return;
    const action = kind === 'backups' ? window.joona.openBackupsFolder : window.joona.openDataFolder;
    const result = await action();
    if (result && result.ok === false) toast('Could not open the folder.', 'error');
  };

  const db = storage || {};
  const lastBackup = db.lastBackup;
  const warnings = db.backupWarnings || [];

  return (
    <div className="settings-grid">
      <section className="card settings-card">
        <div className="card-heading">
          <div>
            <h2 className="card-title">Backup &amp; Restore</h2>
            <p className="card-subtitle">
              A verified copy is refreshed automatically after every saved sale. A daily copy is
              also kept.
            </p>
          </div>
          <span className="card-chip">
            <DatabaseIcon size={16} /> SQLite v{db.schemaVersion || 2}
          </span>
        </div>

        <ErrorBanner message={error} onRetry={loadInfo} />

        {warnings.length ? (
          <div className="callout callout-warning">
            <strong>Backup attention</strong>
            <ul className="callout-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="info-list">
          <div className="info-row">
            <span className="info-label">Orders stored</span>
            <span className="info-value">{loading ? '…' : db.orders ?? 0}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Database size</span>
            <span className="info-value">{loading ? '…' : formatBytes(db.size)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Last backup</span>
            <span className="info-value">
              {loading
                ? '…'
                : lastBackup
                ? `${formatDateTime(lastBackup.mtime)} · ${formatBytes(lastBackup.size)}`
                : 'No backup yet'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Today&apos;s automatic backup</span>
            <span className="info-value">
              {db.autoBackupToday ? formatDateTime(db.autoBackupToday.mtime) : 'Not created yet'}
            </span>
          </div>
          <div className="info-row info-row-column">
            <span className="info-label">Database location</span>
            <code className="path-code">{db.dbPath || '—'}</code>
          </div>
          <div className="info-row info-row-column">
            <span className="info-label">Backups folder</span>
            <code className="path-code">{db.backupsDir || '—'}</code>
          </div>
        </div>

        <div className="button-row">
          <button
            type="button"
            className="btn btn-gold"
            onClick={handleBackup}
            disabled={busy === 'backup' || !isDesktopApp}
          >
            <BackupIcon size={18} /> {busy === 'backup' ? 'Creating backup…' : 'Create backup'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleRestore}
            disabled={busy === 'restore' || !isDesktopApp}
          >
            <RestoreIcon size={18} /> {busy === 'restore' ? 'Restoring…' : 'Restore backup'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleVerify}
            disabled={busy === 'verify'}
          >
            {busy === 'verify' ? 'Checking…' : 'Verify database'}
          </button>
        </div>

        {verification ? (
          <div className={`verify-result ${verification.ok ? 'verify-ok' : 'verify-bad'}`}>
            <strong>{verification.ok ? 'Verification passed' : 'Verification failed'}</strong>
            <span>
              Integrity {verification.integrity} · foreign key problems{' '}
              {verification.foreignKeyViolations} · counter problems{' '}
              {verification.counterInconsistencies} · {verification.orders} orders · schema v
              {verification.schemaVersion}
            </span>
          </div>
        ) : null}

        <div className="folder-links">
          <button type="button" className="link-button" onClick={() => openFolder('data')}>
            <FolderIcon size={15} /> Open data folder
          </button>
          <button type="button" className="link-button" onClick={() => openFolder('backups')}>
            <FolderIcon size={15} /> Open backups folder
          </button>
        </div>

        <div className="callout">
          <strong>Restore replaces current data.</strong> The app validates the backup file, saves a
          safety copy of your current database, repairs daily order counters, and keeps your old data
          if anything fails.
        </div>
      </section>

      <div className="settings-column">
        <section className="card settings-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Data safety</h2>
              <p className="card-subtitle">What happens automatically.</p>
            </div>
          </div>
          <ul className="about-list">
            <li>SQLite write-ahead logging with synchronous FULL durability.</li>
            <li>Foreign keys stay switched on for every connection.</li>
            <li>A verified backup is refreshed after every successful sale.</li>
            <li>Startup refreshes a stale daily backup when the app opens.</li>
            <li>Restore rejects unhealthy files, missing tables, missing indexes and bad totals.</li>
          </ul>
          {!isDesktopApp ? (
            <p className="field-hint">
              Backup and restore are enabled when the app is running as the Joona Biryani desktop
              application.
            </p>
          ) : null}
        </section>

        <section className="card settings-card about-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Installation notes</h2>
              <p className="card-subtitle">Joona Biryani v{appInfo.version}</p>
            </div>
          </div>
          <ul className="about-list">
            <li>The installer is unsigned. Windows may show a SmartScreen warning; choose “More info → Run anyway” only if you received the file directly from Joona Biryani.</li>
            <li>The portable build keeps its data under your Windows AppData profile, not beside the .exe file.</li>
            <li>Practice mode uses a separate Windows profile and a separate database. It never opens the real shop data.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="settings-grid">
      <section className="card settings-card">
        <div className="card-heading">
          <div>
            <h2 className="card-title">About Joona Biryani</h2>
            <p className="card-subtitle">
              Offline restaurant cashier · version {appInfo.version}
              {appInfo.practice ? ' · Practice Mode' : ''}
            </p>
          </div>
        </div>
        <ul className="about-list">
          <li>Works fully offline — no internet, no cloud, no subscriptions.</li>
          <li>Multi-item orders with Sadi and Beef biryani portions, custom amount, custom weight and other items.</li>
          <li>Money is stored in integer paisa; weights are stored in integer milligrams. Rupee entries round half-up to the nearest paisa.</li>
          <li>Old price and cost snapshots are never rewritten when an owner changes today&apos;s prices.</li>
          <li>All seven version 1 sales are preserved as Legacy / Unclassified biryani. They are never counted as Sadi or Beef.</li>
          <li>Business dates use Asia/Karachi (PKT, UTC+5) regardless of the laptop timezone.</li>
        </ul>
        <div className="info-row">
          <span className="info-label">Application version</span>
          <span className="info-value">{appInfo.version}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Mode</span>
          <span className="info-value">{appInfo.practice ? 'Practice (separate data)' : 'Live shop data'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Timezone</span>
          <span className="info-value">{APP_TIME_ZONE}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Today</span>
          <span className="info-value">{dateLabel(todayKey())}</span>
        </div>
      </section>

      <div className="settings-column">
        <section className="card settings-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Correction procedure</h2>
              <p className="card-subtitle">How mistakes are handled in v2.0.0.</p>
            </div>
          </div>
          <ul className="about-list">
            <li>Saved orders are permanent. There is no edit or void button in this version.</li>
            <li>If an order was entered incorrectly, keep the original record and write a clear correction note in the owner&apos;s records. Do not edit the SQLite file by hand.</li>
            <li>Restore is only for replacing a damaged database with a verified backup; it is not a normal correction tool.</li>
            <li>Changing a menu price changes future orders only. Old orders keep their original price and cost snapshot.</li>
          </ul>
        </section>

        <section className="card settings-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Safety and privacy</h2>
              <p className="card-subtitle">Local-only by design.</p>
            </div>
          </div>
          <ul className="about-list">
            <li>The local data service listens only on 127.0.0.1 and requires a fresh per-launch token.</li>
            <li>The desktop window uses context isolation, sandboxing and a restricted preload bridge; Node.js is not exposed to the page.</li>
            <li>No feature sends sales, prices or backups to the internet.</li>
            <li>Practice mode is clearly labelled and uses a separate profile and database.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('pricing');

  return (
    <div className="page">
      <PageHeader
        title="Owner Settings"
        subtitle="Menu prices, costs, expenses, backups and app information."
      />

      <div className="segmented settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'segment-active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'pricing' ? <PricingTab /> : null}
      {tab === 'expenses' ? <ExpensesTab /> : null}
      {tab === 'backup' ? <BackupTab /> : null}
      {tab === 'about' ? <AboutTab /> : null}
    </div>
  );
}
