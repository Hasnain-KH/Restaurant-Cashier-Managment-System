import { useEffect, useState } from 'react';
import {
  BrandMark,
  CashierIcon,
  DashboardIcon,
  HistoryIcon,
  ReportsIcon,
  SettingsIcon,
} from './components/Icons';
import { clockLabel, headerDateLabel } from './format';
import Toaster from './components/Toaster';
import Cashier from './pages/Cashier';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

const NAV_ITEMS = [
  { id: 'cashier', label: 'New Sale', icon: CashierIcon, caption: 'Record a sale' },
  { id: 'dashboard', label: 'Owner Dashboard', icon: DashboardIcon, caption: 'Business overview' },
  { id: 'history', label: 'Sales History', icon: HistoryIcon, caption: 'Find any sale' },
  { id: 'reports', label: 'Reports', icon: ReportsIcon, caption: 'Daily & monthly' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, caption: 'Backup & restore' },
];

export default function App() {
  const [view, setView] = useState('cashier');
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < NAV_ITEMS.length) {
        event.preventDefault();
        setView(NAV_ITEMS[index].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const renderPage = () => {
    switch (view) {
      case 'dashboard':
        return <Dashboard onNavigate={setView} />;
      case 'history':
        return <History />;
      case 'reports':
        return <Reports />;
      case 'settings':
        return <Settings />;
      case 'cashier':
      default:
        return <Cashier onNavigate={setView} />;
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BrandMark size={46} />
          </span>
          <span className="brand-text">
            <span className="brand-name">JOONA BIRYANI</span>
            <span className="brand-tagline">Sales &amp; Token Desk</span>
          </span>
        </div>
        <div className="topbar-right">
          <span className="offline-pill">
            <span className="offline-dot" aria-hidden="true" />
            100% Offline
          </span>
          <div className="topbar-clock">
            <span className="topbar-time mono">{clockLabel(clock)}</span>
            <span className="topbar-date">{headerDateLabel(clock)}</span>
          </div>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <nav className="nav" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${view === item.id ? 'nav-item-active' : ''}`}
                  onClick={() => setView(item.id)}
                  aria-current={view === item.id ? 'page' : undefined}
                >
                  <span className="nav-icon">
                    <Icon size={21} />
                  </span>
                  <span className="nav-text">
                    <span className="nav-label">{item.label}</span>
                    <span className="nav-caption">{item.caption}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-note">
              <span className="sidebar-note-title">Local &amp; private</span>
              <span className="sidebar-note-text">
                Every sale is saved on this laptop. No internet needed.
              </span>
            </div>
            <span className="sidebar-version">Joona Biryani · v1.0</span>
          </div>
        </aside>

        <main className="main">{renderPage()}</main>
      </div>

      <Toaster />
    </div>
  );
}
