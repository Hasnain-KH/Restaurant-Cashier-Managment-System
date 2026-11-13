'use strict';

const { dayKey, timeKey, dateTimeKey } = require('./time');
const { kgToMg, weightLabelFromKg, rupeesToPaisa } = require('./money');

const TARGET_SCHEMA_VERSION = 2;

const REQUIRED_TABLES_V2 = [
  'schema_migrations',
  'sales',
  'daily_counters',
  'settings',
  'menu_products',
  'product_portions',
  'product_price_history',
  'orders',
  'order_items',
  'expenses',
];

const REQUIRED_INDEXES_V2 = [
  'idx_sales_date',
  'idx_sales_created',
  'idx_orders_date',
  'idx_orders_created',
  'idx_order_items_order',
  'idx_order_items_type',
  'idx_expenses_date',
  'idx_price_history_product',
];

const REQUIRED_TABLES_V1 = ['sales', 'daily_counters', 'settings'];

const BASELINE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sales (
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
  CREATE INDEX IF NOT EXISTS idx_sales_date ON sales (sale_date);
  CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_ms DESC);

  CREATE TABLE IF NOT EXISTS daily_counters (
    sale_date TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    applied_ms INTEGER NOT NULL
  );
`;

function tableExists(handle, name) {
  return Boolean(
    handle
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name)
  );
}

function detectSchemaVersion(handle) {
  const row = handle.prepare('PRAGMA user_version').get();
  const version = Number(row && row.user_version) || 0;
  if (version > 0) return version;
  // A database created by the first release may have user_version=1 already.
  if (tableExists(handle, 'sales')) return 1;
  return 0;
}

function parseOrderNumber(orderNumber) {
  const match = /^JB-(\d{4})(\d{2})(\d{2})-(\d+)$/.exec(String(orderNumber || ''));
  if (!match) return null;
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    seq: Number(match[4]),
  };
}

function alignDailyCounters(handle) {
  const rows = handle.prepare('SELECT order_number FROM orders').all();
  const maxByDate = new Map();
  for (const row of rows) {
    const parsed = parseOrderNumber(row.order_number);
    if (!parsed || !Number.isFinite(parsed.seq)) continue;
    const current = maxByDate.get(parsed.date) || 0;
    if (parsed.seq > current) maxByDate.set(parsed.date, parsed.seq);
  }
  const existing = new Map(
    handle
      .prepare('SELECT sale_date, last_seq FROM daily_counters')
      .all()
      .map((row) => [row.sale_date, row.last_seq])
  );
  const upsert = handle.prepare(
    `INSERT INTO daily_counters (sale_date, last_seq) VALUES (?, ?)
     ON CONFLICT(sale_date) DO UPDATE SET last_seq = excluded.last_seq`
  );
  for (const [date, maxSeq] of maxByDate) {
    // Never lower an existing counter: keeping a higher value only skips numbers,
    // whereas lowering it could reuse a sale number.
    const next = Math.max(maxSeq, Number(existing.get(date)) || 0);
    upsert.run(date, next);
  }
}

function createMigrationTable(handle) {
  handle.exec(SCHEMA_MIGRATIONS);
}

function migration1Baseline(handle) {
  handle.exec(BASELINE_SCHEMA);
}

function migration2OrdersAndPricing(handle, now) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS menu_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BIRYANI', 'OTHER')),
      biryani_kind TEXT CHECK (biryani_kind IS NULL OR biryani_kind IN ('SADI', 'BEEF', 'LEGACY')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      price_per_kg_paisa INTEGER CHECK (price_per_kg_paisa IS NULL OR price_per_kg_paisa >= 0),
      cost_per_kg_paisa INTEGER CHECK (cost_per_kg_paisa IS NULL OR cost_per_kg_paisa >= 0),
      unit_price_paisa INTEGER CHECK (unit_price_paisa IS NULL OR unit_price_paisa >= 0),
      unit_cost_paisa INTEGER CHECK (unit_cost_paisa IS NULL OR unit_cost_paisa >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      created_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_portions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES menu_products(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      weight_mg INTEGER NOT NULL CHECK (weight_mg > 0),
      price_paisa INTEGER CHECK (price_paisa IS NULL OR price_paisa >= 0),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (product_id, label)
    );

    CREATE TABLE IF NOT EXISTS product_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES menu_products(id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL,
      changed_ms INTEGER NOT NULL,
      price_per_kg_paisa INTEGER,
      cost_per_kg_paisa INTEGER,
      unit_price_paisa INTEGER,
      unit_cost_paisa INTEGER,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      legacy_sale_id INTEGER UNIQUE REFERENCES sales(id),
      order_date TEXT NOT NULL,
      order_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_ms INTEGER NOT NULL,
      total_paisa INTEGER NOT NULL CHECK (total_paisa >= 0),
      cost_paisa INTEGER CHECK (cost_paisa IS NULL OR cost_paisa >= 0),
      cost_incomplete INTEGER NOT NULL DEFAULT 1 CHECK (cost_incomplete IN (0, 1)),
      is_legacy INTEGER NOT NULL DEFAULT 0 CHECK (is_legacy IN (0, 1)),
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES menu_products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      product_type TEXT NOT NULL CHECK (product_type IN ('SADI', 'BEEF', 'LEGACY', 'OTHER')),
      portion_label TEXT,
      pricing_mode TEXT NOT NULL,
      weight_mg INTEGER NOT NULL DEFAULT 0 CHECK (weight_mg >= 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_paisa INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
      line_total_paisa INTEGER NOT NULL CHECK (line_total_paisa >= 0),
      unit_cost_paisa INTEGER CHECK (unit_cost_paisa IS NULL OR unit_cost_paisa >= 0),
      line_cost_paisa INTEGER CHECK (line_cost_paisa IS NULL OR line_cost_paisa >= 0),
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
      created_at TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales (sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_date ON orders (order_date);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_type ON order_items (product_type);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);
    CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history (product_id, changed_ms DESC);
  `);

  const stamp = dateTimeKey(now());
  const ms = now().getTime();
  const insertProduct = handle.prepare(
    `INSERT INTO menu_products
      (code, name, type, biryani_kind, enabled, price_per_kg_paisa, cost_per_kg_paisa,
       unit_price_paisa, unit_cost_paisa, sort_order, created_at, created_ms, updated_at, updated_ms)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`
  );
  const insertPortion = handle.prepare(
    `INSERT INTO product_portions (product_id, label, weight_mg, price_paisa, enabled, sort_order)
     VALUES (?, ?, ?, NULL, 1, ?)`
  );

  const defaults = [
    { code: 'SADI', name: 'Sadi Biryani', type: 'BIRYANI', kind: 'SADI', sort: 10 },
    { code: 'BEEF', name: 'Beef Biryani', type: 'BIRYANI', kind: 'BEEF', sort: 20 },
  ];
  for (const product of defaults) {
    const existing = handle.prepare('SELECT id FROM menu_products WHERE code = ?').get(product.code);
    if (existing) continue;
    insertProduct.run(
      product.code,
      product.name,
      product.type,
      product.kind,
      1,
      product.sort,
      stamp,
      ms,
      stamp,
      ms
    );
    const productId = handle.prepare('SELECT id FROM menu_products WHERE code = ?').get(product.code).id;
    const portions = [
      { label: 'Pao', mg: 250000, sort: 1 },
      { label: 'Half KG', mg: 500000, sort: 2 },
      { label: '1 KG', mg: 1000000, sort: 3 },
    ];
    for (const portion of portions) {
      insertPortion.run(productId, portion.label, portion.mg, portion.sort);
    }
  }

  // Legacy / unclassified product. It is disabled for new sales but keeps the
  // seven original sales visible and honest in reports.
  let legacyProduct = handle
    .prepare("SELECT id FROM menu_products WHERE code = 'LEGACY'")
    .get();
  if (!legacyProduct) {
    insertProduct.run(
      'LEGACY',
      'Legacy / unclassified biryani',
      'BIRYANI',
      'LEGACY',
      0,
      999,
      stamp,
      ms,
      stamp,
      ms
    );
    legacyProduct = handle.prepare("SELECT id FROM menu_products WHERE code = 'LEGACY'").get();
  }

  const legacySales = handle.prepare('SELECT * FROM sales ORDER BY id').all();
  const insertOrder = handle.prepare(
    `INSERT INTO orders
      (order_number, request_id, legacy_sale_id, order_date, order_time, created_at, created_ms,
       total_paisa, cost_paisa, cost_incomplete, is_legacy, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, ?)`
  );
  const insertItem = handle.prepare(
    `INSERT INTO order_items
      (order_id, product_id, product_name, product_type, portion_label, pricing_mode,
       weight_mg, quantity, unit_price_paisa, line_total_paisa, unit_cost_paisa, line_cost_paisa, note)
     VALUES (?, ?, ?, 'LEGACY', ?, 'LEGACY', ?, 1, ?, ?, NULL, NULL, ?)`
  );

  for (const sale of legacySales) {
    const already = handle
      .prepare('SELECT id FROM orders WHERE legacy_sale_id = ?')
      .get(sale.id);
    if (already) continue;
    const totalPaisa = rupeesToPaisa(sale.amount_pkr);
    const weightMg = kgToMg(sale.weight_kg);
    const info = insertOrder.run(
      sale.sale_number,
      sale.request_id,
      sale.id,
      sale.sale_date,
      sale.sale_time,
      sale.created_at,
      sale.created_ms,
      totalPaisa,
      sale.note || ''
    );
    insertItem.run(
      info.lastInsertRowid,
      legacyProduct.id,
      'Legacy / unclassified biryani',
      weightLabelFromKg(sale.weight_kg),
      weightMg,
      totalPaisa,
      totalPaisa,
      'Migrated from the original sales table. Product type was never recorded.'
    );
  }

  // Verify that every original sale is represented exactly once before commit.
  const sales = handle.prepare('SELECT * FROM sales').all();
  for (const sale of sales) {
    const order = handle
      .prepare('SELECT * FROM orders WHERE legacy_sale_id = ?')
      .get(sale.id);
    if (!order) throw new Error(`Migration could not preserve sale ${sale.sale_number}`);
    if (order.total_paisa !== rupeesToPaisa(sale.amount_pkr)) {
      throw new Error(`Migration amount mismatch for sale ${sale.sale_number}`);
    }
    const item = handle
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .get(order.id);
    if (!item || item.weight_mg !== kgToMg(sale.weight_kg)) {
      throw new Error(`Migration weight mismatch for sale ${sale.sale_number}`);
    }
  }

  alignDailyCounters(handle);
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline-sales-schema',
    up: (handle) => migration1Baseline(handle),
  },
  {
    version: 2,
    name: 'orders-menu-pricing-expenses',
    up: (handle, now) => migration2OrdersAndPricing(handle, now),
  },
];

function runMigrations(handle, options = {}) {
  const now = options.now || (() => new Date());
  createMigrationTable(handle);
  const startingVersion = detectSchemaVersion(handle);
  if (startingVersion > TARGET_SCHEMA_VERSION) {
    throw new Error(
      `This database was created by a newer version of Joona Biryani (schema ${startingVersion}). Please install the newer application instead of downgrading.`
    );
  }

  const applied = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= startingVersion) continue;
    const moment = now();
    handle.exec('BEGIN IMMEDIATE');
    try {
      migration.up(handle, now);
      handle.exec(`PRAGMA user_version = ${migration.version}`);
      handle
        .prepare(
          `INSERT INTO schema_migrations (version, name, applied_at, applied_ms)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(version) DO UPDATE SET name = excluded.name,
             applied_at = excluded.applied_at, applied_ms = excluded.applied_ms`
        )
        .run(migration.version, migration.name, dateTimeKey(moment), moment.getTime());
      handle.exec('COMMIT');
      applied.push({ version: migration.version, name: migration.name });
    } catch (error) {
      try {
        handle.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw new Error(`Database migration ${migration.version} failed: ${error.message}`);
    }
  }

  // Make sure the version marker is correct even when the database was already current.
  if (startingVersion !== TARGET_SCHEMA_VERSION) {
    handle.exec(`PRAGMA user_version = ${TARGET_SCHEMA_VERSION}`);
  }
  return { startingVersion, targetVersion: TARGET_SCHEMA_VERSION, applied };
}

function missingSchemaItems(handle) {
  const tables = new Set(
    handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
  );
  const indexes = new Set(
    handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name)
  );
  const missingTables = REQUIRED_TABLES_V2.filter((name) => !tables.has(name));
  const missingIndexes = REQUIRED_INDEXES_V2.filter((name) => !indexes.has(name));
  return { missingTables, missingIndexes };
}

function assertCurrentSchema(handle) {
  const missing = missingSchemaItems(handle);
  if (missing.missingTables.length || missing.missingIndexes.length) {
    throw new Error(
      `Database schema is incomplete. Missing tables: ${
        missing.missingTables.join(', ') || 'none'
      }. Missing indexes: ${missing.missingIndexes.join(', ') || 'none'}.`
    );
  }
  return missing;
}

module.exports = {
  TARGET_SCHEMA_VERSION,
  REQUIRED_TABLES_V1,
  REQUIRED_TABLES_V2,
  REQUIRED_INDEXES_V2,
  detectSchemaVersion,
  runMigrations,
  assertCurrentSchema,
  missingSchemaItems,
  alignDailyCounters,
  parseOrderNumber,
  tableExists,
};
