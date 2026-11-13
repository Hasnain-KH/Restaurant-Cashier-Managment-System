import { useCallback, useEffect, useState } from 'react';
import { api, isDesktopApp } from '../api';
import PageHeader from '../components/PageHeader';
import { toast } from '../toast';
import {
  BackupIcon,
  DatabaseIcon,
  FolderIcon,
  RestoreIcon,
} from '../components/Icons';
import { dateLabel } from '../format';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Settings() {
  const [storage, setStorage] = useState(null);
  const [rate, setRate] = useState('');
  const [savedRate, setSavedRate] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      let info = null;
      if (isDesktopApp && window.joona?.info) {
        info = await window.joona.info();
      } else {
        info = await api.storage();
      }
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
    api
      .settings()
      .then((settings) => {
        const value = settings.ratePerKg ? String(settings.ratePerKg) : '';
        setRate(value);
        setSavedRate(value);
      })
      .catch(() => {});
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
        toast(`Backup saved: ${fileName} (${result.sales} sales)`);
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
        toast(`Backup restored — ${result.sales} sales loaded.`);
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

  const openFolder = async (kind) => {
    if (!isDesktopApp) return;
    const action = kind === 'backups' ? window.joona.openBackupsFolder : window.joona.openDataFolder;
    const result = await action();
    if (result && result.ok === false) toast('Could not open the folder.', 'error');
  };

  const saveRate = async () => {
    setBusy('rate');
    try {
      const numeric = Number(rate) || 0;
      const settings = await api.updateSettings({ ratePerKg: numeric });
      const value = settings.ratePerKg ? String(settings.ratePerKg) : '';
      setRate(value);
      setSavedRate(value);
      try {
        window.localStorage.setItem('joona.ratePerKg', value);
      } catch {
        /* ignore */
      }
      toast('Default price per kg saved.');
    } catch (saveError) {
      toast(saveError.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const db = storage || {};
  const lastBackup = db.lastBackup;

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Backups, storage and simple defaults for the sales desk."
      />

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className="settings-grid">
        <section className="card settings-card">
          <div className="card-heading">
            <div>
              <h2 className="card-title">Backup &amp; Restore</h2>
              <p className="card-subtitle">
                Keep a copy of all sales on a USB drive. A daily copy is also kept automatically.
              </p>
            </div>
            <span className="card-chip">
              <DatabaseIcon size={16} /> SQLite
            </span>
          </div>

          <div className="info-list">
            <div className="info-row">
              <span className="info-label">Total sales stored</span>
              <span className="info-value">{loading ? '…' : db.sales ?? 0}</span>
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
            <div className="info-row info-row-column">
              <span className="info-label">Database location</span>
              <code className="path-code">{db.dbPath || '—'}</code>
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
          </div>

          <div className="folder-links">
            <button type="button" className="link-button" onClick={() => openFolder('data')}>
              <FolderIcon size={15} /> Open data folder
            </button>
            <button type="button" className="link-button" onClick={() => openFolder('backups')}>
              <FolderIcon size={15} /> Open backups folder
            </button>
          </div>

          {!isDesktopApp ? (
            <p className="field-hint">
              Backup and restore are enabled when the app is running as the Joona Biryani desktop
              application.
            </p>
          ) : null}

          <div className="callout">
            <strong>Restore replaces current data.</strong> Before restoring, the software
            automatically saves a safety copy of the current database.
          </div>
        </section>

        <div className="settings-column">
          <section className="card settings-card">
            <div className="card-heading">
              <div>
                <h2 className="card-title">Default price per kg</h2>
                <p className="card-subtitle">
                  Used to pre-fill the optional price helper on the New Sale screen.
                </p>
              </div>
            </div>

            <div className="field inline-field">
              <label htmlFor="default-rate">Price per kg (Rs)</label>
              <div className="inline-field-row">
                <input
                  id="default-rate"
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 1200"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveRate}
                  disabled={busy === 'rate' || String(rate) === String(savedRate)}
                >
                  Save
                </button>
              </div>
              <p className="field-hint">
                Leave empty or 0 if you prefer to type the amount directly every time.
              </p>
            </div>
          </section>

          <section className="card settings-card about-card">
            <div className="card-heading">
              <div>
                <h2 className="card-title">About Joona Biryani</h2>
                <p className="card-subtitle">Offline sales management · First version</p>
              </div>
            </div>
            <ul className="about-list">
              <li>Works fully offline — no internet, no cloud, no subscriptions.</li>
              <li>Every sale is saved permanently in a local SQLite database.</li>
              <li>Physical tokens remain the only token system in the restaurant.</li>
              <li>Dashboard and reports always use real saved sales.</li>
            </ul>
            <div className="info-row">
              <span className="info-label">Application version</span>
              <span className="info-value">{window.joona?.bootstrap?.appVersion || '1.0.0'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Today</span>
              <span className="info-value">{dateLabel(new Date().toISOString().slice(0, 10))}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
