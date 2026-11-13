'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { createDatabase } = require('../server/db');
const { TARGET_SCHEMA_VERSION } = require('../server/migrations');

const V1_SCHEMA = `
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_number TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL UNIQUE,
    amount_pkr REAL NOT NULL CHECK (amount_pkr > 0),
    weight_kg REAL NOT NULL CHECK (weight_kg > 0),
    weight_label TEXT NOT NULL,
    note TEXT,
    sale_date TEXT NOT NULL,
    sale_time TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_sales_date ON sales (sale_date);
  CREATE INDEX idx_sales_created ON sales (created_ms DESC);
  CREATE TABLE daily_counters (sale_date TEXT PRIMARY KEY, last_seq INTEGER NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function createV1Database(dir) {
  const dbPath = path.join(dir, 'data', 'joona.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(V1_SCHEMA);
  const insert = db.prepare(
    `INSERT INTO sales
      (sale_number, request_id, amount_pkr, weight_kg, weight_label, note, sale_date, sale_time, created_at, created_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    'JB-20261112-0001',
    'v1-request-0001',
    2500,
    3,
    '3 KG',
    'original note',
    '2026-11-12',
    '10:00:00',
    '2026-11-12T10:00:00',
    Date.UTC(2026, 10, 12, 5, 0, 0)
  );
  insert.run(
    'JB-20261112-0002',
    'v1-request-0002',
    1500,
    3,
    '3 KG',
    null,
    '2026-11-12',
    '11:00:00',
    '2026-11-12T11:00:00',
    Date.UTC(2026, 10, 12, 6, 0, 0)
  );
  db.prepare('INSERT INTO daily_counters (sale_date, last_seq) VALUES (?, ?)').run(
    '2026-11-12',
    2
  );
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ratePerKg', '300');
  db.exec('PRAGMA user_version = 1');
  db.close();
  return dbPath;
}

test('migrates a version 1 database forward without changing the original sales', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joona-migrate-'));
  const dbPath = createV1Database(dir);
  const backupsDir = path.join(dir, 'backups');

  const before = new DatabaseSync(dbPath, { readOnly: true });
  const originalSales = before.prepare('SELECT * FROM sales ORDER BY id').all();
  before.close();

  const db = createDatabase(dbPath, {
    now: () => new Date(2026, 10, 13, 14, 30, 0),
    backupsDir,
  });

  assert.equal(db.raw().prepare('PRAGMA user_version').get().user_version, TARGET_SCHEMA_VERSION);

  const sales = db.raw().prepare('SELECT * FROM sales ORDER BY id').all();
  assert.deepEqual(sales, originalSales);

  const orders = db.listOrders({}).orders;
  assert.equal(orders.length, 2);
  const byNumber = new Map(orders.map((order) => [order.orderNumber, order]));
  assert.equal(byNumber.get('JB-20261112-0001').totalPaisa, 250000);
  assert.equal(byNumber.get('JB-20261112-0002').totalPaisa, 150000);
  for (const order of orders) {
    assert.equal(order.isLegacy, true);
    assert.equal(order.costIncomplete, true);
    assert.equal(order.cost, null);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].productType, 'LEGACY');
    assert.equal(order.items[0].weightMg, 3000000);
    assert.equal(order.items[0].lineCostPaisa, null);
  }
  assert.equal(byNumber.get('JB-20261112-0001').note, 'original note');

  const counter = db
    .raw()
    .prepare('SELECT * FROM daily_counters WHERE sale_date = ?')
    .get('2026-11-12');
  assert.equal(counter.last_seq, 2);

  // No prices or costs may be invented for Sadi/Beef during migration.
  const menu = db.getMenu();
  const sadi = menu.products.find((product) => product.code === 'SADI');
  const beef = menu.products.find((product) => product.code === 'BEEF');
  assert.equal(sadi.pricePerKg, null);
  assert.equal(sadi.costPerKg, null);
  assert.equal(beef.pricePerKg, null);
  assert.equal(beef.costPerKg, null);
  assert.equal(menu.products.find((product) => product.code === 'LEGACY').enabled, false);

  const summary = db.summaryForDate('2026-11-12');
  assert.equal(summary.orders, 2);
  assert.equal(summary.total, 4000);
  assert.equal(summary.kg, 6);
  assert.equal(summary.legacyKg, 6);
  assert.equal(summary.sadiKg, 0);
  assert.equal(summary.beefKg, 0);
  assert.equal(summary.profitComplete, false);

  const verify = db.verifyDatabase();
  assert.equal(verify.ok, true);
  assert.equal(verify.integrity, 'ok');
  assert.equal(verify.schemaVersion, TARGET_SCHEMA_VERSION);

  const safety = fs.readdirSync(backupsDir).filter((name) => /^pre-migration-v1-/.test(name));
  assert.equal(safety.length, 1);

  const next = db.createSale({
    amount: 300,
    weightKg: 1,
    requestId: 'post-migration-1',
  });
  assert.equal(next.sale.saleNumber, 'JB-20261113-0001');
  assert.equal(db.ordersCount(), 3);
  db.close();
});

test('reopening a migrated database is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joona-migrate-again-'));
  const dbPath = createV1Database(dir);

  const first = createDatabase(dbPath, { backupsDir: path.join(dir, 'backups') });
  assert.equal(first.ordersCount(), 2);
  first.close();

  const second = createDatabase(dbPath, { backupsDir: path.join(dir, 'backups') });
  assert.equal(second.ordersCount(), 2);
  assert.equal(second.listOrders({ legacy: 'only' }).count, 2);
  assert.equal(second.verifyDatabase().ok, true);

  const applied = second.raw().prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  // Version 1 already existed before the upgrade, so only migration 2 ran.
  assert.deepEqual(
    applied.map((row) => row.version),
    [2]
  );
  second.close();
});

test('rejects a database created by a newer application version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joona-migrate-newer-'));
  const dbPath = path.join(dir, 'data', 'newer.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new DatabaseSync(dbPath);
  raw.exec('CREATE TABLE sales (id INTEGER PRIMARY KEY, sale_date TEXT)');
  raw.exec('PRAGMA user_version = 99');
  raw.close();

  assert.throws(
    () => createDatabase(dbPath, { backupsDir: path.join(dir, 'backups') }),
    /newer version/i
  );
});
