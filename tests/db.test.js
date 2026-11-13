'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase, weightLabel } = require('../server/db');

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `joona-${name}-`));
}

function setup(startDate = new Date(2026, 10, 13, 13, 45, 12)) {
  const dir = tempDir('db');
  const dbPath = path.join(dir, 'data', 'joona.sqlite');
  const backupsDir = path.join(dir, 'backups');
  const state = { now: startDate };
  const db = createDatabase(dbPath, { now: () => state.now, backupsDir });
  return { db, dbPath, backupsDir, dir, state };
}

test('records a sale with sale number, amount, weight and local date/time', () => {
  const { db, state } = setup();

  const result = db.createSale({ amount: 1500, weightKg: 1, requestId: 'req-00000001' });

  assert.equal(result.duplicate, false);
  assert.equal(result.sale.saleNumber, 'JB-20261113-0001');
  assert.equal(result.sale.amount, 1500);
  assert.equal(result.sale.weightKg, 1);
  assert.equal(result.sale.weightLabel, '1 KG');
  assert.equal(result.sale.date, '2026-11-13');
  assert.equal(result.sale.time, '13:45:12');

  const second = db.createSale({ amount: 900, weightKg: 0.5, requestId: 'req-00000002' });
  assert.equal(second.sale.saleNumber, 'JB-20261113-0002');
  assert.equal(second.sale.weightLabel, 'Half KG');

  const third = db.createSale({ amount: 250, weightKg: 0.25, requestId: 'req-00000003' });
  assert.equal(third.sale.weightLabel, '1 Pao');

  const fourth = db.createSale({ amount: 700, weightKg: 0.75, requestId: 'req-00000004' });
  assert.equal(fourth.sale.weightLabel, '750 g');

  // A new day starts the counter again.
  state.now = new Date(2026, 10, 14, 9, 5, 0);
  const nextDay = db.createSale({ amount: 400, weightKg: 1.5, requestId: 'req-00000005' });
  assert.equal(nextDay.sale.saleNumber, 'JB-20261114-0001');

  db.close();
});

test('blocks duplicate submissions with the same request id', () => {
  const { db } = setup();

  const first = db.createSale({ amount: 1200, weightKg: 1, requestId: 'dup-request-01' });
  const repeat = db.createSale({ amount: 1200, weightKg: 1, requestId: 'dup-request-01' });

  assert.equal(first.duplicate, false);
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.sale.saleNumber, first.sale.saleNumber);
  assert.equal(db.salesCount(), 1);

  db.close();
});

test('validates amount, weight and request id', () => {
  const { db } = setup();

  assert.throws(
    () => db.createSale({ amount: 0, weightKg: 1, requestId: 'req-invalid-01' }),
    /amount greater than 0/i
  );
  assert.throws(
    () => db.createSale({ amount: -50, weightKg: 1, requestId: 'req-invalid-02' }),
    /amount cannot be negative/i
  );
  assert.throws(
    () => db.createSale({ amount: 500, weightKg: 0, requestId: 'req-invalid-03' }),
    /weight greater than 0/i
  );
  assert.throws(
    () => db.createSale({ amount: 500, weightKg: 80, requestId: 'req-invalid-04' }),
    /cannot exceed 50 kg/i
  );
  assert.throws(
    () => db.createSale({ amount: 5000000, weightKg: 1, requestId: 'req-invalid-05' }),
    /cannot exceed/i
  );
  assert.throws(() => db.createSale({ amount: 500, weightKg: 1 }), /request id/i);

  assert.equal(db.salesCount(), 0);
  db.close();
});

test('computes dashboard, daily and monthly figures from saved sales', () => {
  const { db, state } = setup();

  // Yesterday
  state.now = new Date(2026, 10, 12, 12, 0, 0);
  db.createSale({ amount: 1000, weightKg: 1, requestId: 'dash-00000001' });
  db.createSale({ amount: 500, weightKg: 0.5, requestId: 'dash-00000002' });

  // Today
  state.now = new Date(2026, 10, 13, 14, 30, 0);
  db.createSale({ amount: 2000, weightKg: 2, requestId: 'dash-00000003' });
  state.now = new Date(2026, 10, 13, 15, 20, 0);
  db.createSale({ amount: 1000, weightKg: 1, requestId: 'dash-00000004' });

  // Earlier in the month
  state.now = new Date(2026, 10, 3, 18, 0, 0);
  db.createSale({ amount: 2500, weightKg: 3, requestId: 'dash-00000005' });

  state.now = new Date(2026, 10, 13, 15, 30, 0);
  const dashboard = db.getDashboard();

  assert.equal(dashboard.today.orders, 2);
  assert.equal(dashboard.today.total, 3000);
  assert.equal(dashboard.today.kg, 3);
  assert.equal(dashboard.today.average, 1500);

  assert.equal(dashboard.yesterday.orders, 2);
  assert.equal(dashboard.yesterday.total, 1500);

  assert.equal(dashboard.month.orders, 5);
  assert.equal(dashboard.month.total, 7000);
  assert.equal(dashboard.month.kg, 7.5);

  assert.equal(dashboard.last7Days.length, 7);
  const lastDay = dashboard.last7Days[6];
  assert.equal(lastDay.date, '2026-11-13');
  assert.equal(lastDay.total, 3000);

  assert.equal(dashboard.recent.length, 5);
  assert.equal(dashboard.recent[0].saleNumber, 'JB-20261113-0002');

  const daily = db.dailyReport('2026-11-13');
  assert.equal(daily.total, 3000);
  assert.equal(daily.hours.length, 24);
  assert.equal(daily.hours[14].orders, 1);
  assert.equal(daily.hours[15].orders, 1);
  assert.equal(daily.hours[9].orders, 0);

  const monthly = db.monthlyReport('2026-11');
  assert.equal(monthly.daysShown, 13);
  assert.equal(monthly.days.length, 13);
  assert.equal(monthly.total, 7000);
  assert.equal(monthly.orders, 5);
  assert.equal(monthly.bestDay.date, '2026-11-13');
  assert.equal(monthly.bestDay.total, 3000);

  db.close();
});

test('filters sales by date range and reports totals', () => {
  const { db, state } = setup();

  state.now = new Date(2026, 10, 10, 11, 0, 0);
  db.createSale({ amount: 100, weightKg: 1, requestId: 'filter-0000001' });
  state.now = new Date(2026, 10, 11, 11, 0, 0);
  db.createSale({ amount: 200, weightKg: 0.5, requestId: 'filter-0000002' });
  state.now = new Date(2026, 10, 12, 11, 0, 0);
  db.createSale({ amount: 300, weightKg: 0.25, requestId: 'filter-0000003' });

  const oneDay = db.listSales({ date: '2026-11-11' });
  assert.equal(oneDay.count, 1);
  assert.equal(oneDay.totalAmount, 200);

  const range = db.listSales({ from: '2026-11-10', to: '2026-11-11' });
  assert.equal(range.count, 2);
  assert.equal(range.totalAmount, 300);
  assert.equal(range.totalKg, 1.5);

  const all = db.listSales({});
  assert.equal(all.count, 3);
  assert.equal(all.hasMore, false);

  assert.throws(() => db.listSales({ date: '11-11-2026' }), /valid date/i);

  db.close();
});

test('keeps every sale after the application restarts', () => {
  const { db, dbPath } = setup();
  db.createSale({ amount: 1750, weightKg: 1.5, requestId: 'persist-000001' });
  db.createSale({ amount: 250, weightKg: 0.25, requestId: 'persist-000002' });
  db.close();

  const reopened = createDatabase(dbPath);
  assert.equal(reopened.salesCount(), 2);
  const sales = reopened.listSales({}).sales;
  assert.equal(sales[0].amount, 250);
  assert.equal(sales[1].amount, 1750);
  reopened.close();
});

test('creates a backup, restores it, and rejects invalid files', () => {
  const { db, dir } = setup();
  db.createSale({ amount: 1000, weightKg: 1, requestId: 'backup-000001' });
  db.createSale({ amount: 2000, weightKg: 2, requestId: 'backup-000002' });

  const backupPath = path.join(dir, 'exports', 'my-backup.sqlite');
  const backup = db.backupTo(backupPath);
  assert.equal(backup.sales, 2);
  assert.ok(fs.existsSync(backupPath));

  const validation = db.validateBackupFile(backupPath);
  assert.equal(validation.sales, 2);
  assert.equal(validation.firstDate, '2026-11-13');

  // Add more sales, then restore the older backup.
  db.createSale({ amount: 500, weightKg: 0.5, requestId: 'backup-000003' });
  assert.equal(db.salesCount(), 3);

  const restored = db.restoreFrom(backupPath);
  assert.equal(restored.sales, 2);
  assert.ok(fs.existsSync(restored.safetyBackup));
  assert.equal(db.salesCount(), 2);

  const invalidPath = path.join(dir, 'not-a-database.sqlite');
  fs.writeFileSync(invalidPath, 'this is not a sqlite database');
  const invalid = db.validateBackupFile(invalidPath);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /cannot be read|not a healthy/i);

  const missing = db.validateBackupFile(path.join(dir, 'missing.sqlite'));
  assert.equal(missing.valid, false);
  assert.match(missing.error, /not found/i);

  db.close();
});

test('stores and updates settings', () => {
  const { db } = setup();
  assert.equal(db.getSettings().ratePerKg, 0);

  db.updateSettings({ ratePerKg: 1250 });
  assert.equal(db.getSettings().ratePerKg, 1250);

  db.updateSettings({ ratePerKg: 0 });
  assert.equal(db.getSettings().ratePerKg, 0);

  assert.throws(() => db.updateSettings({ ratePerKg: -5 }), /0 or more/i);
  db.close();
});

test('refreshes the automatic daily backup after every new sale', () => {
  const { db, state } = setup();

  // A sale refreshes today's backup automatically.
  db.createSale({ amount: 800, weightKg: 1, requestId: 'auto-00000001' });
  const first = db.autoBackup();
  assert.equal(first.skipped, true);
  assert.ok(fs.existsSync(first.path));
  assert.equal(first.orders, 1);

  // A second sale immediately refreshes the same file so it never lags behind.
  db.createSale({ amount: 400, weightKg: 0.5, requestId: 'auto-00000002' });
  const second = db.autoBackup();
  assert.equal(second.skipped, true);
  assert.equal(second.orders, 2);

  const forced = db.autoBackup({ force: true });
  assert.equal(forced.skipped, false);
  assert.equal(forced.orders, 2);

  // The next day starts a fresh file.
  state.now = new Date(2026, 10, 14, 10, 0, 0);
  db.createSale({ amount: 300, weightKg: 1, requestId: 'auto-00000003' });
  const third = db.autoBackup();
  assert.equal(third.skipped, true);
  assert.match(third.path, /auto-2026-11-14\.sqlite$/);
  assert.equal(third.orders, 3);

  db.close();
});

test('formats weight labels for common restaurant weights', () => {
  assert.equal(weightLabel(0.25), '1 Pao');
  assert.equal(weightLabel(0.5), 'Half KG');
  assert.equal(weightLabel(1), '1 KG');
  assert.equal(weightLabel(2), '2 KG');
  assert.equal(weightLabel(0.75), '750 g');
  assert.equal(weightLabel(1.35), '1.35 KG');
});
