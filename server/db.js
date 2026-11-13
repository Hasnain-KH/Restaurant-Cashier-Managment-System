'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const {
  dayKey,
  timeKey,
  dateTimeKey,
  isValidDateKey,
  isValidMonthKey,
  addDays,
  daysInMonth,
  monthKey,
  fileStamp,
} = require('./time');
const {
  MAX_AMOUNT_PAISA,
  MAX_WEIGHT_MG,
  MAX_QTY,
  MAX_ITEMS,
  MG_PER_KG,
  rupeesToPaisa,
  paisaToRupees,
  kgToMg,
  mgToKg,
  priceForWeight,
  weightForAmount,
  roundKg,
  roundPaisa,
  weightLabelFromMg,
  weightLabelFromKg,
} = require('./money');

const {
  TARGET_SCHEMA_VERSION,
  REQUIRED_INDEXES_V2,
  detectSchemaVersion,
  runMigrations,
  assertCurrentSchema,
  alignDailyCounters,
  parseOrderNumber,
  tableExists,
} = require('./migrations');

const AUTO_BACKUP_KEEP_DAYS = 30;
const PRE_RESTORE_KEEP = 5;
const PRE_MIGRATION_KEEP = 5;
const MAX_PRICE_PER_KG_PAISA = 100000 * 100; // Rs 100,000 per kg
const MAX_ITEM_PRICE_PAISA = MAX_AMOUNT_PAISA;
const MAX_EXPENSE_PAISA = MAX_AMOUNT_PAISA;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

function text(value, maxLength, label, { required = false } = {}) {
  const raw = value === undefined || value === null ? '' : String(value);
  const cleaned = raw.trim();
  if (required && !cleaned) throw new ValidationError(`${label} is required.`);
  if (cleaned.length > maxLength) {
    throw new ValidationError(`${label} cannot be longer than ${maxLength} characters.`);
  }
  return cleaned;
}

function integer(value, label) {
  const number = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new ValidationError(`${label} must be a whole number.`);
  }
  return number;
}

function positiveInteger(value, label, { max = Number.MAX_SAFE_INTEGER, min = 1 } = {}) {
  const number = integer(value, label);
  if (number < min) throw new ValidationError(`${label} must be at least ${min}.`);
  if (number > max) throw new ValidationError(`${label} cannot be more than ${max}.`);
  return number;
}

function optionalPaisa(value, label, { max = MAX_ITEM_PRICE_PAISA } = {}) {
  if (value === undefined || value === null || value === '') return null;
  let paisa;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a valid amount.`);
  }
  if (typeof value === 'object' && value !== null && 'paisa' in value) {
    paisa = Number(value.paisa);
  } else {
    // API exposes integer paisa fields; accept rupees as a fallback for old callers.
    paisa = Number(value);
  }
  if (!Number.isFinite(paisa)) throw new ValidationError(`${label} must be a valid amount.`);
  if (paisa < 0) throw new ValidationError(`${label} cannot be negative.`);
  if (paisa > max) {
    throw new ValidationError(
      `${label} cannot exceed Rs ${(max / 100).toLocaleString('en-PK')}.`
    );
  }
  return Math.round(paisa);
}

function paisaField(value, rupeesValue, label, options = {}) {
  if (value !== undefined && value !== null) return optionalPaisa(value, label, options);
  if (rupeesValue !== undefined && rupeesValue !== null && rupeesValue !== '') {
    const paisa = rupeesToPaisa(rupeesValue);
    if (!Number.isFinite(paisa)) throw new ValidationError(`${label} must be a valid amount.`);
    return optionalPaisa(paisa, label, options);
  }
  return null;
}

function requiredPaisa(paisaValue, rupeesValue, label, options = {}) {
  const value = paisaField(paisaValue, rupeesValue, label, options);
  if (value === null || value <= 0) {
    throw new ValidationError(`${label} greater than 0 is required.`);
  }
  return value;
}

function slugCode(name, existingCodes) {
  const base =
    String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'ITEM';
  let code = base;
  let counter = 2;
  while (existingCodes.has(code)) {
    code = `${base}-${counter}`;
    counter += 1;
  }
  return code;
}

function mapItem(row) {
  if (!row) return null;
  const unitCostPaisa = row.unit_cost_paisa === null ? null : Number(row.unit_cost_paisa);
  const lineCostPaisa = row.line_cost_paisa === null ? null : Number(row.line_cost_paisa);
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    productType: row.product_type,
    portionLabel: row.portion_label || '',
    pricingMode: row.pricing_mode,
    weightMg: Number(row.weight_mg) || 0,
    weightKg: roundKg(mgToKg(row.weight_mg || 0), 6),
    weightLabel: weightLabelFromMg(row.weight_mg || 0),
    quantity: Number(row.quantity) || 1,
    unitPricePaisa: Number(row.unit_price_paisa) || 0,
    unitPrice: paisaToRupees(row.unit_price_paisa || 0),
    lineTotalPaisa: Number(row.line_total_paisa) || 0,
    lineTotal: paisaToRupees(row.line_total_paisa || 0),
    unitCostPaisa,
    unitCost: unitCostPaisa === null ? null : paisaToRupees(unitCostPaisa),
    lineCostPaisa,
    lineCost: lineCostPaisa === null ? null : paisaToRupees(lineCostPaisa),
    costComplete: lineCostPaisa !== null,
    note: row.note || '',
    isBiryani: row.product_type !== 'OTHER',
  };
}

function mapOrder(row, items = []) {
  if (!row) return null;
  const mappedItems = items.map(mapItem);
  let kgMg = 0;
  let sadiMg = 0;
  let beefMg = 0;
  let legacyMg = 0;
  let otherRevenuePaisa = 0;
  for (const item of mappedItems) {
    const totalMg = item.weightMg * item.quantity;
    if (item.productType === 'SADI') {
      sadiMg += totalMg;
      kgMg += totalMg;
    } else if (item.productType === 'BEEF') {
      beefMg += totalMg;
      kgMg += totalMg;
    } else if (item.productType === 'LEGACY') {
      legacyMg += totalMg;
      kgMg += totalMg;
    } else {
      otherRevenuePaisa += item.lineTotalPaisa;
    }
  }
  const costPaisa = row.cost_paisa === null ? null : Number(row.cost_paisa);
  return {
    id: row.id,
    orderNumber: row.order_number,
    saleNumber: row.order_number,
    requestId: row.request_id,
    legacySaleId: row.legacy_sale_id,
    date: row.order_date,
    saleDate: row.order_date,
    time: row.order_time,
    saleTime: row.order_time,
    createdAt: row.created_at,
    createdMs: row.created_ms,
    totalPaisa: Number(row.total_paisa) || 0,
    total: paisaToRupees(row.total_paisa || 0),
    amount: paisaToRupees(row.total_paisa || 0),
    costPaisa,
    cost: costPaisa === null ? null : paisaToRupees(costPaisa),
    costIncomplete: Boolean(row.cost_incomplete),
    profitComplete: !row.cost_incomplete,
    isLegacy: Boolean(row.is_legacy),
    note: row.note || '',
    items: mappedItems,
    itemCount: mappedItems.length,
    kg: roundKg(mgToKg(kgMg), 3),
    kgMg,
    sadiKg: roundKg(mgToKg(sadiMg), 3),
    beefKg: roundKg(mgToKg(beefMg), 3),
    legacyKg: roundKg(mgToKg(legacyMg), 3),
    otherRevenuePaisa,
    otherRevenue: paisaToRupees(otherRevenuePaisa),
    weightLabel: weightLabelFromMg(kgMg),
    itemSummary: mappedItems
      .map((item) => `${item.quantity}× ${item.productName}${item.portionLabel ? ` (${item.portionLabel})` : ''}`)
      .join(', '),
  };
}

function mapSale(order) {
  return {
    id: order.id,
    saleNumber: order.orderNumber,
    amount: order.total,
    weightKg: Number(mgToKg(order.kgMg).toFixed(3)),
    weightLabel: order.weightLabel,
    date: order.date,
    time: order.time,
    createdAt: order.createdAt,
    note: order.note,
    orderId: order.id,
    itemCount: order.itemCount,
    isLegacy: order.isLegacy,
  };
}

function createDatabase(filePath, options = {}) {
  const now = options.now || (() => new Date());
  const backupsDir =
    options.backupsDir || path.join(path.dirname(filePath), '..', 'backups');
  const resolvedPath = path.resolve(filePath);

  let db = null;
  const backupState = {
    lastSuccess: null,
    lastError: null,
    lastAttempt: null,
  };

  function preMigrationSafetyBackup(version) {
    fs.mkdirSync(backupsDir, { recursive: true });
    const target = path.join(
      backupsDir,
      `pre-migration-v${version}-${fileStamp(now())}.sqlite`
    );
    const temp = `${target}.tmp-${process.pid}`;
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      const source = new DatabaseSync(resolvedPath);
      try {
        source.prepare('VACUUM INTO ?').run(temp);
      } finally {
        source.close();
      }
      verifySnapshotFile(temp, { allowLegacy: true });
      replaceFileAtomically(temp, target);
      pruneFiles(backupsDir, /^pre-migration-.*\.sqlite$/, PRE_MIGRATION_KEEP);
      return target;
    } catch (error) {
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch {
        /* ignore */
      }
      throw new Error(
        `A verified safety backup could not be created before upgrading the database, so the upgrade was stopped. ${error.message}`
      );
    }
  }

  function connect() {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const existed = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).size > 0;

    let startingVersion = 0;
    if (existed) {
      const probe = new DatabaseSync(resolvedPath, { readOnly: true });
      try {
        startingVersion = detectSchemaVersion(probe);
      } finally {
        probe.close();
      }
      if (startingVersion > 0 && startingVersion < TARGET_SCHEMA_VERSION) {
        const safety = preMigrationSafetyBackup(startingVersion);
        console.log(`[joona] pre-migration safety backup: ${safety}`);
      }
    }

    const handle = new DatabaseSync(resolvedPath);
    handle.exec('PRAGMA journal_mode = WAL;');
    // FULL is intentionally stronger than the previous NORMAL setting: a sale
    // that has been reported to the cashier is durable even if Windows loses power.
    handle.exec('PRAGMA synchronous = FULL;');
    handle.exec('PRAGMA foreign_keys = ON;');
    handle.exec('PRAGMA busy_timeout = 5000;');
    const migration = runMigrations(handle, { now });
    assertCurrentSchema(handle);
    if (migration.applied.length) {
      console.log(
        `[joona] migrated database schema ${migration.startingVersion} -> ${migration.targetVersion}`
      );
    }
    return handle;
  }

  function getHandle() {
    if (!db) db = connect();
    return db;
  }

  function transaction(fn, mode = 'BEGIN IMMEDIATE') {
    const handle = getHandle();
    handle.exec(mode);
    try {
      const result = fn(handle);
      handle.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        handle.exec('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw error;
    }
  }

  function ordersCount(handle = getHandle()) {
    return handle.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  }

  function itemsForOrders(handle, orderIds) {
    if (!orderIds.length) return new Map();
    const placeholders = orderIds.map(() => '?').join(', ');
    const rows = handle
      .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`)
      .all(...orderIds);
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.order_id)) grouped.set(row.order_id, []);
      grouped.get(row.order_id).push(row);
    }
    return grouped;
  }

  function hydrateOrders(handle, rows) {
    const items = itemsForOrders(
      handle,
      rows.map((row) => row.id)
    );
    return rows.map((row) => mapOrder(row, items.get(row.id) || []));
  }

  function getOrderRaw(handle, id) {
    const order = handle.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return null;
    const items = handle
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
      .all(id);
    return mapOrder(order, items);
  }

  function findOrderByRequestId(handle, requestId) {
    const row = handle.prepare('SELECT id FROM orders WHERE request_id = ?').get(requestId);
    return row ? getOrderRaw(handle, row.id) : null;
  }

  function parseRangeDate(value, label) {
    if (!isValidDateKey(value)) throw new ValidationError(`Please provide a valid ${label}.`);
    return value;
  }

  function listOrders(options = {}) {
    const clauses = [];
    const params = [];

    if (options.date) {
      clauses.push('o.order_date = ?');
      params.push(parseRangeDate(options.date, 'date'));
    } else {
      if (options.from) {
        clauses.push('o.order_date >= ?');
        params.push(parseRangeDate(options.from, 'start date'));
      }
      if (options.to) {
        clauses.push('o.order_date <= ?');
        params.push(parseRangeDate(options.to, 'end date'));
      }
    }

    if (options.q) {
      const term = String(options.q).trim().slice(0, 80);
      if (term) {
        const pattern = `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
        clauses.push(
          `(o.order_number LIKE ? ESCAPE '\\' OR EXISTS (
             SELECT 1 FROM order_items oi2
             WHERE oi2.order_id = o.id AND oi2.product_name LIKE ? ESCAPE '\\'
           ))`
        );
        params.push(pattern, pattern);
      }
    }

    if (options.legacy === 'only') clauses.push('o.is_legacy = 1');
    if (options.legacy === 'exclude' || options.includeLegacy === false) {
      clauses.push('o.is_legacy = 0');
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000);
    const offset = Math.max(Number(options.offset) || 0, 0);

    const handle = getHandle();
    const rows = handle
      .prepare(
        `SELECT o.* FROM orders o ${where}
         ORDER BY o.created_ms DESC, o.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    const totals = handle
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(o.total_paisa), 0) AS total,
                COALESCE(SUM(o.cost_paisa), 0) AS cost,
                COALESCE(SUM(o.cost_incomplete), 0) AS incomplete
         FROM orders o ${where}`
      )
      .get(...params);

    const kgRow = handle
      .prepare(
        `SELECT COALESCE(SUM(oi.weight_mg * oi.quantity), 0) AS mg
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         ${where} AND oi.product_type <> 'OTHER'`
      )
      .get(...params);

    return {
      orders: hydrateOrders(handle, rows),
      count: totals.count,
      totalPaisa: totals.total,
      totalAmount: paisaToRupees(totals.total),
      totalKg: roundKg(mgToKg(kgRow.mg), 3),
      costIncomplete: Number(totals.incomplete) > 0,
      limit,
      offset,
      hasMore: offset + rows.length < totals.count,
    };
  }

  function listSales(options = {}) {
    const result = listOrders({ ...options, includeLegacy: true });
    return {
      ...result,
      sales: result.orders.map(mapSale),
    };
  }

  function recentOrders(limit = 10) {
    const handle = getHandle();
    const rows = handle
      .prepare('SELECT * FROM orders ORDER BY created_ms DESC, id DESC LIMIT ?')
      .all(Math.min(Math.max(Number(limit) || 10, 1), 50));
    return hydrateOrders(handle, rows);
  }

  function recentSales(limit = 10) {
    return recentOrders(limit).map(mapSale);
  }

  function rangeAggregates(handle, from, to) {
    const orderAgg = handle
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(total_paisa), 0) AS revenue,
                COALESCE(SUM(cost_paisa), 0) AS cost,
                COALESCE(SUM(cost_incomplete), 0) AS incomplete
         FROM orders WHERE order_date >= ? AND order_date <= ?`
      )
      .get(from, to);

    const itemAgg = handle
      .prepare(
        `SELECT oi.product_type AS type,
                COALESCE(SUM(oi.weight_mg * oi.quantity), 0) AS mg,
                COALESCE(SUM(oi.line_total_paisa), 0) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.order_date >= ? AND o.order_date <= ?
         GROUP BY oi.product_type`
      )
      .all(from, to);

    const missing = handle
      .prepare(
        `SELECT DISTINCT oi.product_name
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.order_date >= ? AND o.order_date <= ? AND oi.line_cost_paisa IS NULL
         ORDER BY oi.product_name`
      )
      .all(from, to)
      .map((row) => row.product_name);

    const expense = handle
      .prepare(
        `SELECT COALESCE(SUM(amount_paisa), 0) AS total,
                COUNT(*) AS count
         FROM expenses WHERE expense_date >= ? AND expense_date <= ?`
      )
      .get(from, to);

    let sadiMg = 0;
    let beefMg = 0;
    let legacyMg = 0;
    let otherRevenue = 0;
    for (const row of itemAgg) {
      if (row.type === 'SADI') sadiMg += Number(row.mg);
      else if (row.type === 'BEEF') beefMg += Number(row.mg);
      else if (row.type === 'LEGACY') legacyMg += Number(row.mg);
      else otherRevenue += Number(row.revenue);
    }
    const kgMg = sadiMg + beefMg + legacyMg;
    const orders = Number(orderAgg.orders) || 0;
    const profitComplete = orders === 0 || Number(orderAgg.incomplete) === 0;
    const revenuePaisa = Number(orderAgg.revenue) || 0;
    const costPaisa = profitComplete ? Number(orderAgg.cost) || 0 : null;
    const expensesPaisa = Number(expense.total) || 0;
    const grossPaisa = profitComplete ? revenuePaisa - costPaisa : null;
    const netPaisa = profitComplete ? grossPaisa - expensesPaisa : null;

    return {
      orders,
      revenuePaisa,
      revenue: paisaToRupees(revenuePaisa),
      totalPaisa: revenuePaisa,
      total: paisaToRupees(revenuePaisa),
      costPaisa,
      estimatedProductCostPaisa: costPaisa,
      estimatedProductCost: costPaisa === null ? null : paisaToRupees(costPaisa),
      grossProfitPaisa: grossPaisa,
      estimatedGrossProfitPaisa: grossPaisa,
      estimatedGrossProfit: grossPaisa === null ? null : paisaToRupees(grossPaisa),
      expensesPaisa,
      recordedExpensesPaisa: expensesPaisa,
      recordedExpenses: paisaToRupees(expensesPaisa),
      netProfitPaisa: netPaisa,
      estimatedNetProfitPaisa: netPaisa,
      estimatedNetProfit: netPaisa === null ? null : paisaToRupees(netPaisa),
      profitComplete,
      missingCostItems: profitComplete ? [] : missing,
      expenseCount: Number(expense.count) || 0,
      kg: roundKg(mgToKg(kgMg), 3),
      kgMg,
      sadiKg: roundKg(mgToKg(sadiMg), 3),
      beefKg: roundKg(mgToKg(beefMg), 3),
      legacyKg: roundKg(mgToKg(legacyMg), 3),
      otherRevenuePaisa: otherRevenue,
      otherRevenue: paisaToRupees(otherRevenue),
      average: orders ? roundKg(revenuePaisa / 100 / orders, 2) : 0,
    };
  }

  function summaryForDate(date) {
    if (!isValidDateKey(date)) throw new ValidationError('Please choose a valid date.');
    const summary = rangeAggregates(getHandle(), date, date);
    return { date, ...summary };
  }

  function monthSummary(month) {
    if (!isValidMonthKey(month)) throw new ValidationError('Please choose a valid month.');
    const last = daysInMonth(month);
    return {
      month,
      ...rangeAggregates(getHandle(), `${month}-01`, `${month}-${String(last).padStart(2, '0')}`),
    };
  }

  function dayBreakdownRows(handle, from, to) {
    const orders = handle
      .prepare(
        `SELECT order_date AS date, COUNT(*) AS orders,
                COALESCE(SUM(total_paisa), 0) AS revenue,
                COALESCE(SUM(cost_paisa), 0) AS cost,
                COALESCE(SUM(cost_incomplete), 0) AS incomplete
         FROM orders WHERE order_date >= ? AND order_date <= ?
         GROUP BY order_date`
      )
      .all(from, to);
    const items = handle
      .prepare(
        `SELECT o.order_date AS date, oi.product_type AS type,
                COALESCE(SUM(oi.weight_mg * oi.quantity), 0) AS mg,
                COALESCE(SUM(oi.line_total_paisa), 0) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.order_date >= ? AND o.order_date <= ?
         GROUP BY o.order_date, oi.product_type`
      )
      .all(from, to);
    const expenses = handle
      .prepare(
        `SELECT expense_date AS date, COALESCE(SUM(amount_paisa), 0) AS total
         FROM expenses WHERE expense_date >= ? AND expense_date <= ?
         GROUP BY expense_date`
      )
      .all(from, to);

    const byDate = new Map();
    const blank = (date) => ({
      date,
      orders: 0,
      revenuePaisa: 0,
      costPaisa: 0,
      incomplete: 0,
      sadiMg: 0,
      beefMg: 0,
      legacyMg: 0,
      otherRevenuePaisa: 0,
      expensesPaisa: 0,
    });
    for (const row of orders) {
      const entry = blank(row.date);
      entry.orders = Number(row.orders) || 0;
      entry.revenuePaisa = Number(row.revenue) || 0;
      entry.costPaisa = Number(row.cost) || 0;
      entry.incomplete = Number(row.incomplete) || 0;
      byDate.set(row.date, entry);
    }
    for (const row of items) {
      if (!byDate.has(row.date)) byDate.set(row.date, blank(row.date));
      const entry = byDate.get(row.date);
      if (row.type === 'SADI') entry.sadiMg += Number(row.mg);
      else if (row.type === 'BEEF') entry.beefMg += Number(row.mg);
      else if (row.type === 'LEGACY') entry.legacyMg += Number(row.mg);
      else entry.otherRevenuePaisa += Number(row.revenue);
    }
    for (const row of expenses) {
      if (!byDate.has(row.date)) byDate.set(row.date, blank(row.date));
      byDate.get(row.date).expensesPaisa = Number(row.total) || 0;
    }
    return byDate;
  }

  function lastNDays(today, days) {
    const start = addDays(today, -(days - 1));
    const byDate = dayBreakdownRows(getHandle(), start, today);
    const result = [];
    for (let i = 0; i < days; i += 1) {
      const date = addDays(start, i);
      const row = byDate.get(date);
      if (!row) {
        result.push({
          date,
          orders: 0,
          total: 0,
          revenue: 0,
          kg: 0,
          sadiKg: 0,
          beefKg: 0,
          legacyKg: 0,
          otherRevenue: 0,
          profitComplete: true,
        });
        continue;
      }
      const kgMg = row.sadiMg + row.beefMg + row.legacyMg;
      const profitComplete = row.orders === 0 || row.incomplete === 0;
      result.push({
        date,
        orders: row.orders,
        total: paisaToRupees(row.revenuePaisa),
        revenue: paisaToRupees(row.revenuePaisa),
        kg: roundKg(mgToKg(kgMg), 3),
        sadiKg: roundKg(mgToKg(row.sadiMg), 3),
        beefKg: roundKg(mgToKg(row.beefMg), 3),
        legacyKg: roundKg(mgToKg(row.legacyMg), 3),
        otherRevenue: paisaToRupees(row.otherRevenuePaisa),
        profitComplete,
      });
    }
    return result;
  }

  function getDashboard() {
    const today = dayKey(now());
    const yesterday = addDays(today, -1);
    const thisMonth = today.slice(0, 7);
    const monthToDate = rangeAggregates(getHandle(), `${thisMonth}-01`, today);
    let backup = null;
    try {
      backup = storageInfo();
    } catch {
      backup = null;
    }
    return {
      date: today,
      today: summaryForDate(today),
      yesterday: summaryForDate(yesterday),
      month: { month: thisMonth, ...monthToDate },
      last7Days: lastNDays(today, 7),
      recent: recentSales(10),
      recentOrders: recentOrders(10),
      backup,
      timezone: 'Asia/Karachi',
    };
  }

  function dailyReport(date) {
    if (!isValidDateKey(date)) throw new ValidationError('Please choose a valid date.');
    const handle = getHandle();
    const summary = summaryForDate(date);
    const hourly = handle
      .prepare(
        `SELECT substr(order_time, 1, 2) AS hour, COUNT(*) AS orders,
                COALESCE(SUM(total_paisa), 0) AS total
         FROM orders WHERE order_date = ?
         GROUP BY hour`
      )
      .all(date);
    const byHour = new Map(hourly.map((row) => [Number(row.hour), row]));
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const row = byHour.get(hour);
      return {
        hour,
        orders: row ? row.orders : 0,
        total: row ? paisaToRupees(row.total) : 0,
      };
    });
    const rows = handle
      .prepare('SELECT * FROM orders WHERE order_date = ? ORDER BY created_ms DESC, id DESC')
      .all(date);
    const orders = hydrateOrders(handle, rows);
    return {
      date,
      ...summary,
      hours,
      orderList: orders,
      sales: orders.map(mapSale),
      salesComplete: true,
      expenses: handle
        .prepare('SELECT * FROM expenses WHERE expense_date = ? ORDER BY id')
        .all(date)
        .map((row) => ({
          id: row.id,
          date: row.expense_date,
          description: row.description,
          amountPaisa: Number(row.amount_paisa),
          amount: paisaToRupees(row.amount_paisa),
          createdAt: row.created_at,
        })),
    };
  }

  function monthlyReport(month) {
    if (!isValidMonthKey(month)) throw new ValidationError('Please choose a valid month.');
    const [year, monthNumber] = month.split('-').map(Number);
    const today = dayKey(now());
    const totalDays = daysInMonth(month);
    const currentMonth = today.slice(0, 7);
    let shownDays = totalDays;
    if (month === currentMonth) shownDays = Number(today.slice(8, 10));
    else if (month > currentMonth) shownDays = 0;

    const last = `${month}-${String(totalDays).padStart(2, '0')}`;
    const byDate = dayBreakdownRows(getHandle(), `${month}-01`, last);
    const days = [];
    let missingSet = new Set();
    const missing = getHandle()
      .prepare(
        `SELECT DISTINCT oi.product_name
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.order_date >= ? AND o.order_date <= ? AND oi.line_cost_paisa IS NULL`
      )
      .all(`${month}-01`, last);
    for (const row of missing) missingSet.add(row.product_name);

    let revenuePaisa = 0;
    let otherRevenuePaisa = 0;
    let expensesPaisa = 0;
    let costPaisaTotal = 0;
    let incompleteOrders = 0;

    for (let day = 1; day <= shownDays; day += 1) {
      const key = `${month}-${String(day).padStart(2, '0')}`;
      const row = byDate.get(key) || {
        date: key,
        orders: 0,
        revenuePaisa: 0,
        costPaisa: 0,
        incomplete: 0,
        sadiMg: 0,
        beefMg: 0,
        legacyMg: 0,
        otherRevenuePaisa: 0,
        expensesPaisa: 0,
      };
      const kgMg = row.sadiMg + row.beefMg + row.legacyMg;
      const dayProfitComplete = row.orders === 0 || row.incomplete === 0;
      const dayCostPaisa = dayProfitComplete ? Number(row.costPaisa) || 0 : null;
      const dayGrossPaisa =
        dayProfitComplete ? Number(row.revenuePaisa) - dayCostPaisa : null;
      const dayNetPaisa =
        dayProfitComplete ? dayGrossPaisa - Number(row.expensesPaisa) : null;

      revenuePaisa += Number(row.revenuePaisa) || 0;
      otherRevenuePaisa += Number(row.otherRevenuePaisa) || 0;
      expensesPaisa += Number(row.expensesPaisa) || 0;
      costPaisaTotal += dayCostPaisa || 0;
      incompleteOrders += Number(row.incomplete) || 0;

      days.push({
        date: key,
        orders: row.orders,
        revenue: paisaToRupees(row.revenuePaisa),
        total: paisaToRupees(row.revenuePaisa),
        revenuePaisa: Number(row.revenuePaisa) || 0,
        kg: roundKg(mgToKg(kgMg), 3),
        sadiKg: roundKg(mgToKg(row.sadiMg), 3),
        beefKg: roundKg(mgToKg(row.beefMg), 3),
        legacyKg: roundKg(mgToKg(row.legacyMg), 3),
        otherRevenue: paisaToRupees(row.otherRevenuePaisa),
        otherRevenuePaisa: Number(row.otherRevenuePaisa) || 0,
        expenses: paisaToRupees(row.expensesPaisa),
        expensesPaisa: Number(row.expensesPaisa) || 0,
        estimatedProductCost:
          dayCostPaisa === null ? null : paisaToRupees(dayCostPaisa),
        estimatedGrossProfit:
          dayGrossPaisa === null ? null : paisaToRupees(dayGrossPaisa),
        estimatedNetProfit:
          dayNetPaisa === null ? null : paisaToRupees(dayNetPaisa),
        profitComplete: dayProfitComplete,
      });
    }

    const orders = days.reduce((sum, day) => sum + day.orders, 0);
    const kg = roundKg(days.reduce((sum, day) => sum + day.kg, 0), 3);
    const sadiKg = roundKg(days.reduce((sum, day) => sum + day.sadiKg, 0), 3);
    const beefKg = roundKg(days.reduce((sum, day) => sum + day.beefKg, 0), 3);
    const legacyKg = roundKg(days.reduce((sum, day) => sum + day.legacyKg, 0), 3);
    const profitComplete = orders === 0 || incompleteOrders === 0;
    const productCostPaisa = profitComplete ? costPaisaTotal : null;
    const grossPaisa = profitComplete ? revenuePaisa - productCostPaisa : null;
    const netPaisa = profitComplete ? grossPaisa - expensesPaisa : null;
    const bestDay = days.reduce(
      (best, day) => (day.revenue > best.revenue ? day : best),
      { date: '', revenue: 0, orders: 0, kg: 0 }
    );

    return {
      month,
      year,
      monthNumber,
      daysShown: shownDays,
      total: paisaToRupees(revenuePaisa),
      revenue: paisaToRupees(revenuePaisa),
      revenuePaisa,
      orders,
      kg,
      sadiKg,
      beefKg,
      legacyKg,
      otherRevenue: paisaToRupees(otherRevenuePaisa),
      otherRevenuePaisa,
      estimatedProductCost: productCostPaisa === null ? null : paisaToRupees(productCostPaisa),
      estimatedProductCostPaisa: productCostPaisa,
      estimatedGrossProfit: grossPaisa === null ? null : paisaToRupees(grossPaisa),
      estimatedGrossProfitPaisa: grossPaisa,
      recordedExpenses: paisaToRupees(expensesPaisa),
      expensesPaisa,
      estimatedNetProfit: netPaisa === null ? null : paisaToRupees(netPaisa),
      estimatedNetProfitPaisa: netPaisa,
      profitComplete,
      missingCostItems: profitComplete ? [] : Array.from(missingSet).sort(),
      averageOrder: orders ? roundKg(revenuePaisa / 100 / orders, 2) : 0,
      averagePerDay: shownDays ? roundKg(revenuePaisa / 100 / shownDays, 2) : 0,
      averageDailySales: shownDays ? roundKg(revenuePaisa / 100 / shownDays, 2) : 0,
      bestDay,
      days,
    };
  }

  function serializeProduct(handle, row) {
    if (!row) return null;
    const portions = handle
      .prepare('SELECT * FROM product_portions WHERE product_id = ? ORDER BY sort_order, id')
      .all(row.id)
      .map((portion) => {
        const effective =
          portion.price_paisa !== null
            ? Number(portion.price_paisa)
            : row.price_per_kg_paisa !== null
            ? priceForWeight(row.price_per_kg_paisa, portion.weight_mg)
            : null;
        return {
          id: portion.id,
          label: portion.label,
          weightMg: Number(portion.weight_mg),
          weightKg: roundKg(mgToKg(portion.weight_mg), 3),
          weightLabel: weightLabelFromMg(portion.weight_mg),
          pricePaisa: portion.price_paisa === null ? null : Number(portion.price_paisa),
          price: portion.price_paisa === null ? null : paisaToRupees(portion.price_paisa),
          priceOverride: portion.price_paisa !== null,
          effectivePricePaisa: effective,
          effectivePrice: effective === null ? null : paisaToRupees(effective),
          priceConfigured: effective !== null,
          enabled: Boolean(portion.enabled),
        };
      });
    const pricePerKgPaisa =
      row.price_per_kg_paisa === null ? null : Number(row.price_per_kg_paisa);
    const costPerKgPaisa =
      row.cost_per_kg_paisa === null ? null : Number(row.cost_per_kg_paisa);
    const unitPricePaisa = row.unit_price_paisa === null ? null : Number(row.unit_price_paisa);
    const unitCostPaisa = row.unit_cost_paisa === null ? null : Number(row.unit_cost_paisa);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      biryaniKind: row.biryani_kind,
      enabled: Boolean(row.enabled),
      pricePerKgPaisa,
      pricePerKg: pricePerKgPaisa === null ? null : paisaToRupees(pricePerKgPaisa),
      costPerKgPaisa,
      costPerKg: costPerKgPaisa === null ? null : paisaToRupees(costPerKgPaisa),
      unitPricePaisa,
      unitPrice: unitPricePaisa === null ? null : paisaToRupees(unitPricePaisa),
      unitCostPaisa,
      unitCost: unitCostPaisa === null ? null : paisaToRupees(unitCostPaisa),
      pricingConfigured:
        row.type === 'BIRYANI'
          ? pricePerKgPaisa !== null || portions.some((portion) => portion.priceConfigured)
          : unitPricePaisa !== null,
      costConfigured:
        row.type === 'BIRYANI' ? costPerKgPaisa !== null : unitCostPaisa !== null,
      sortOrder: row.sort_order,
      portions,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function getMenu() {
    const handle = getHandle();
    const rows = handle
      .prepare('SELECT * FROM menu_products ORDER BY sort_order, id')
      .all();
    return {
      products: rows.map((row) => serializeProduct(handle, row)),
      portionDefaults: [
        { label: 'Pao', weightMg: 250000, weightLabel: '1 Pao' },
        { label: 'Half KG', weightMg: 500000, weightLabel: 'Half KG' },
        { label: '1 KG', weightMg: 1000000, weightLabel: '1 KG' },
      ],
    };
  }

  function getProduct(id) {
    const row = getHandle().prepare('SELECT * FROM menu_products WHERE id = ?').get(id);
    if (!row) throw new ValidationError('Product not found.');
    return serializeProduct(getHandle(), row);
  }

  function recordPriceHistory(handle, productId, row, note) {
    handle
      .prepare(
        `INSERT INTO product_price_history
          (product_id, changed_at, changed_ms, price_per_kg_paisa, cost_per_kg_paisa,
           unit_price_paisa, unit_cost_paisa, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        productId,
        dateTimeKey(now()),
        now().getTime(),
        row.price_per_kg_paisa,
        row.cost_per_kg_paisa,
        row.unit_price_paisa,
        row.unit_cost_paisa,
        note
      );
  }

  function createProduct(input = {}) {
    const name = text(input.name, 80, 'Product name', { required: true });
    const type = String(input.type || 'BIRYANI').toUpperCase();
    if (type !== 'BIRYANI' && type !== 'OTHER') {
      throw new ValidationError('Product type must be BIRYANI or OTHER.');
    }
    const biryaniKind = type === 'BIRYANI' ? String(input.biryaniKind || '').toUpperCase() : null;
    if (type === 'BIRYANI' && biryaniKind !== 'SADI' && biryaniKind !== 'BEEF') {
      throw new ValidationError('Choose Sadi or Beef for a biryani product.');
    }
    const price = paisaField(
      input.pricePerKgPaisa,
      input.pricePerKg,
      'Price per kg',
      { max: MAX_PRICE_PER_KG_PAISA }
    );
    const cost = paisaField(
      input.costPerKgPaisa,
      input.costPerKg,
      'Cost per kg',
      { max: MAX_PRICE_PER_KG_PAISA }
    );
    const unitPrice = paisaField(
      input.unitPricePaisa,
      input.unitPrice,
      'Selling price',
      { max: MAX_ITEM_PRICE_PAISA }
    );
    const unitCost = paisaField(
      input.unitCostPaisa,
      input.unitCost,
      'Item cost',
      { max: MAX_ITEM_PRICE_PAISA }
    );

    return transaction((handle) => {
      const codes = new Set(handle.prepare('SELECT code FROM menu_products').all().map((row) => row.code));
      const code = slugCode(name, codes);
      const maxSort =
        handle.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM menu_products').get().value + 10;
      const stamp = dateTimeKey(now());
      const ms = now().getTime();
      const info = handle
        .prepare(
          `INSERT INTO menu_products
            (code, name, type, biryani_kind, enabled, price_per_kg_paisa, cost_per_kg_paisa,
             unit_price_paisa, unit_cost_paisa, sort_order, created_at, created_ms, updated_at, updated_ms)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          code,
          name,
          type,
          biryaniKind,
          type === 'BIRYANI' ? price : null,
          type === 'BIRYANI' ? cost : null,
          type === 'OTHER' ? unitPrice : null,
          type === 'OTHER' ? unitCost : null,
          maxSort,
          stamp,
          ms,
          stamp,
          ms
        );
      const id = Number(info.lastInsertRowid);
      if (type === 'BIRYANI') {
        const insertPortion = handle.prepare(
          `INSERT INTO product_portions (product_id, label, weight_mg, price_paisa, enabled, sort_order)
           VALUES (?, ?, ?, NULL, 1, ?)`
        );
        insertPortion.run(id, 'Pao', 250000, 1);
        insertPortion.run(id, 'Half KG', 500000, 2);
        insertPortion.run(id, '1 KG', 1000000, 3);
      }
      const row = handle.prepare('SELECT * FROM menu_products WHERE id = ?').get(id);
      recordPriceHistory(handle, id, row, 'Product created');
      return serializeProduct(handle, row);
    });
  }

  function updateProduct(id, patch = {}) {
    const productId = positiveInteger(id, 'Product id');
    const clean = {};
    if (patch.name !== undefined) clean.name = text(patch.name, 80, 'Product name', { required: true });
    if (patch.enabled !== undefined) clean.enabled = patch.enabled ? 1 : 0;
    if (patch.pricePerKgPaisa !== undefined || patch.pricePerKg !== undefined) {
      clean.price_per_kg_paisa = paisaField(
        patch.pricePerKgPaisa,
        patch.pricePerKg,
        'Price per kg',
        { max: MAX_PRICE_PER_KG_PAISA }
      );
    }
    if (patch.costPerKgPaisa !== undefined || patch.costPerKg !== undefined) {
      clean.cost_per_kg_paisa = paisaField(
        patch.costPerKgPaisa,
        patch.costPerKg,
        'Cost per kg',
        { max: MAX_PRICE_PER_KG_PAISA }
      );
    }
    if (patch.unitPricePaisa !== undefined || patch.unitPrice !== undefined) {
      clean.unit_price_paisa = paisaField(
        patch.unitPricePaisa,
        patch.unitPrice,
        'Selling price',
        { max: MAX_ITEM_PRICE_PAISA }
      );
    }
    if (patch.unitCostPaisa !== undefined || patch.unitCost !== undefined) {
      clean.unit_cost_paisa = paisaField(
        patch.unitCostPaisa,
        patch.unitCost,
        'Item cost',
        { max: MAX_ITEM_PRICE_PAISA }
      );
    }

    return transaction((handle) => {
      const existing = handle.prepare('SELECT * FROM menu_products WHERE id = ?').get(productId);
      if (!existing) throw new ValidationError('Product not found.');
      if (existing.code === 'LEGACY') {
        throw new ValidationError('Legacy/unclassified sales cannot be repriced.');
      }
      const fields = Object.keys(clean);
      if (fields.length) {
        const assignments = fields.map((field) => `${field} = ?`).join(', ');
        handle
          .prepare(
            `UPDATE menu_products SET ${assignments}, updated_at = ?, updated_ms = ? WHERE id = ?`
          )
          .run(
            ...fields.map((field) => clean[field]),
            dateTimeKey(now()),
            now().getTime(),
            productId
          );
      }
      const row = handle.prepare('SELECT * FROM menu_products WHERE id = ?').get(productId);
      const pricingChanged = fields.some((field) =>
        ['price_per_kg_paisa', 'cost_per_kg_paisa', 'unit_price_paisa', 'unit_cost_paisa'].includes(field)
      );
      if (pricingChanged) recordPriceHistory(handle, productId, row, 'Owner updated pricing');
      return serializeProduct(handle, row);
    });
  }

  function updatePortion(id, patch = {}) {
    const portionId = positiveInteger(id, 'Portion id');
    try {
      return transaction((handle) => {
        const portion = handle.prepare('SELECT * FROM product_portions WHERE id = ?').get(portionId);
        if (!portion) throw new ValidationError('Portion not found.');
        const product = handle
          .prepare('SELECT * FROM menu_products WHERE id = ?')
          .get(portion.product_id);
        if (!product) throw new ValidationError('Product not found.');
        if (product.code === 'LEGACY') {
          throw new ValidationError('Legacy/unclassified sales cannot be repriced.');
        }

        const clean = {};
        if (patch.label !== undefined) {
          clean.label = text(patch.label, 40, 'Portion name', { required: true });
        }
        if (
          patch.weightMg !== undefined ||
          patch.weightG !== undefined ||
          patch.weightKg !== undefined
        ) {
          clean.weight_mg = portionWeightMg(patch);
        }
        if (patch.pricePaisa !== undefined || patch.price !== undefined) {
          clean.price_paisa = paisaField(patch.pricePaisa, patch.price, 'Portion price', {
            max: MAX_ITEM_PRICE_PAISA,
          });
        }
        if (patch.enabled !== undefined) clean.enabled = patch.enabled ? 1 : 0;

        const fields = Object.keys(clean);
        if (fields.length) {
          const assignments = fields.map((field) => `${field} = ?`).join(', ');
          handle
            .prepare(`UPDATE product_portions SET ${assignments} WHERE id = ?`)
            .run(...fields.map((field) => clean[field]), portionId);
        }
        if (clean.price_paisa !== undefined) {
          recordPriceHistory(
            handle,
            product.id,
            product,
            `Portion ${clean.label || portion.label} price updated`
          );
        }
        const updated = handle
          .prepare('SELECT * FROM menu_products WHERE id = ?')
          .get(product.id);
        return serializeProduct(handle, updated);
      });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(error.message)) {
        throw new ValidationError('A portion with this name already exists on this product.');
      }
      throw error;
    }
  }

  function portionWeightMg(input = {}) {
    let weightMg;
    if (input.weightMg !== undefined && input.weightMg !== null && input.weightMg !== '') {
      weightMg = integer(input.weightMg, 'Portion weight');
    } else if (input.weightG !== undefined && input.weightG !== null && input.weightG !== '') {
      const grams = Number(input.weightG);
      if (!Number.isFinite(grams)) throw new ValidationError('Enter a valid portion weight.');
      weightMg = Math.round(grams * MG_PER_KG / 1000);
    } else if (input.weightKg !== undefined && input.weightKg !== null && input.weightKg !== '') {
      const kg = Number(input.weightKg);
      if (!Number.isFinite(kg)) throw new ValidationError('Enter a valid portion weight.');
      weightMg = kgToMg(kg);
    } else {
      throw new ValidationError('Enter a portion weight.');
    }
    if (!Number.isFinite(weightMg) || weightMg <= 0) {
      throw new ValidationError('Portion weight must be greater than 0.');
    }
    if (weightMg > MAX_WEIGHT_MG) {
      throw new ValidationError(`Portion weight cannot exceed ${mgToKg(MAX_WEIGHT_MG)} kg.`);
    }
    return weightMg;
  }

  function createPortion(productId, input = {}) {
    const id = positiveInteger(productId, 'Product id');
    try {
      return transaction((handle) => {
        const product = handle.prepare('SELECT * FROM menu_products WHERE id = ?').get(id);
        if (!product) throw new ValidationError('Product not found.');
        if (product.type !== 'BIRYANI') {
          throw new ValidationError('Portions are only available for biryani products.');
        }
        if (product.code === 'LEGACY') {
          throw new ValidationError('Legacy/unclassified sales cannot be changed.');
        }
        const label = text(input.label, 40, 'Portion name', { required: true });
        const weightMg = portionWeightMg(input);
        const pricePaisa = paisaField(input.pricePaisa, input.price, 'Portion price', {
          max: MAX_ITEM_PRICE_PAISA,
        });
        const maxSort =
          handle
            .prepare(
              'SELECT COALESCE(MAX(sort_order), 0) AS value FROM product_portions WHERE product_id = ?'
            )
            .get(id).value + 1;
        handle
          .prepare(
            `INSERT INTO product_portions (product_id, label, weight_mg, price_paisa, enabled, sort_order)
             VALUES (?, ?, ?, ?, 1, ?)`
          )
          .run(id, label, weightMg, pricePaisa, maxSort);
        recordPriceHistory(handle, id, product, `Portion ${label} added`);
        return serializeProduct(handle, product);
      });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(error.message)) {
        throw new ValidationError('A portion with this name already exists on this product.');
      }
      throw error;
    }
  }

  function deletePortion(id) {
    const portionId = positiveInteger(id, 'Portion id');
    return transaction((handle) => {
      const portion = handle
        .prepare('SELECT * FROM product_portions WHERE id = ?')
        .get(portionId);
      if (!portion) throw new ValidationError('Portion not found.');
      const product = handle
        .prepare('SELECT * FROM menu_products WHERE id = ?')
        .get(portion.product_id);
      if (!product) throw new ValidationError('Product not found.');
      if (product.code === 'LEGACY') {
        throw new ValidationError('Legacy/unclassified sales cannot be changed.');
      }
      handle.prepare('DELETE FROM product_portions WHERE id = ?').run(portionId);
      return serializeProduct(handle, product);
    });
  }

  function listExpenses(options = {}) {
    const clauses = [];
    const params = [];
    if (options.date) {
      clauses.push('expense_date = ?');
      params.push(parseRangeDate(options.date, 'expense date'));
    } else {
      if (options.from) {
        clauses.push('expense_date >= ?');
        params.push(parseRangeDate(options.from, 'start date'));
      }
      if (options.to) {
        clauses.push('expense_date <= ?');
        params.push(parseRangeDate(options.to, 'end date'));
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const handle = getHandle();
    const rows = handle
      .prepare(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = handle
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount_paisa), 0) AS total FROM expenses ${where}`)
      .get(...params);
    return {
      expenses: rows.map((row) => ({
        id: row.id,
        date: row.expense_date,
        description: row.description,
        amountPaisa: Number(row.amount_paisa),
        amount: paisaToRupees(row.amount_paisa),
        createdAt: row.created_at,
      })),
      count: total.count,
      totalPaisa: total.total,
      totalAmount: paisaToRupees(total.total),
      limit,
      offset,
      hasMore: offset + rows.length < total.count,
    };
  }

  function addExpense(input = {}) {
    const date = input.date ? parseRangeDate(input.date, 'expense date') : dayKey(now());
    const description = text(input.description, 200, 'Expense description', { required: true });
    const amountPaisa = requiredPaisa(input.amountPaisa, input.amount, 'Expense amount', {
      max: MAX_EXPENSE_PAISA,
    });
    return transaction((handle) => {
      const stamp = dateTimeKey(now());
      const ms = now().getTime();
      const info = handle
        .prepare(
          `INSERT INTO expenses (expense_date, description, amount_paisa, created_at, created_ms)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(date, description, amountPaisa, stamp, ms);
      const row = handle.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
      return {
        id: row.id,
        date: row.expense_date,
        description: row.description,
        amountPaisa: Number(row.amount_paisa),
        amount: paisaToRupees(row.amount_paisa),
        createdAt: row.created_at,
      };
    });
  }

  function deleteExpense(id) {
    const expenseId = positiveInteger(id, 'Expense id');
    return transaction((handle) => {
      const row = handle.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId);
      if (!row) throw new ValidationError('Expense not found.');
      handle.prepare('DELETE FROM expenses WHERE id = ?').run(expenseId);
      return { deleted: true, id: expenseId };
    });
  }

  function productForSale(handle, productId) {
    const product = handle
      .prepare('SELECT * FROM menu_products WHERE id = ?')
      .get(positiveInteger(productId, 'Product id'));
    if (!product) throw new ValidationError('The selected menu item was not found.');
    if (!product.enabled) throw new ValidationError(`${product.name} is disabled in Owner Settings.`);
    return product;
  }

  function portionForProduct(handle, product, portionId) {
    const portion = handle
      .prepare('SELECT * FROM product_portions WHERE id = ? AND product_id = ?')
      .get(positiveInteger(portionId, 'Portion id'), product.id);
    if (!portion) throw new ValidationError('The selected portion was not found.');
    if (!portion.enabled) throw new ValidationError(`${product.name} ${portion.label} is disabled.`);
    return portion;
  }

  function buildBiryaniLine(handle, raw) {
    const product = productForSale(handle, raw.productId);
    if (product.type !== 'BIRYANI') {
      throw new ValidationError(`${product.name} is not a biryani item.`);
    }
    if (product.biryani_kind === 'LEGACY') {
      throw new ValidationError('Legacy/unclassified biryani cannot be sold as a new item.');
    }
    const pricePerKg = product.price_per_kg_paisa;
    const costPerKg = product.cost_per_kg_paisa;
    const quantity = raw.quantity === undefined ? 1 : positiveInteger(raw.quantity, 'Quantity', { max: MAX_QTY });
    let weightMg;
    let unitPricePaisa;
    let pricingMode;
    let portionLabel = null;

    if (raw.kind === 'BIRYANI_PORTION' || raw.portionId) {
      const portion = portionForProduct(handle, product, raw.portionId);
      weightMg = Number(portion.weight_mg);
      unitPricePaisa =
        portion.price_paisa !== null
          ? Number(portion.price_paisa)
          : pricePerKg !== null
          ? priceForWeight(pricePerKg, weightMg)
          : null;
      if (unitPricePaisa === null) {
        throw new ValidationError(
          `${product.name} ${portion.label} has no price. Set it in Owner Settings → Menu & Pricing.`
        );
      }
      pricingMode = 'PORTION';
      portionLabel = portion.label;
    } else if (raw.kind === 'BIRYANI_AMOUNT') {
      const amountPaisa = requiredPaisa(
        raw.amountPaisa,
        raw.amount,
        'Custom biryani amount',
        { max: MAX_AMOUNT_PAISA }
      );
      if (pricePerKg === null || pricePerKg <= 0) {
        throw new ValidationError(
          `${product.name} has no price per kg. Set it in Owner Settings → Menu & Pricing.`
        );
      }
      weightMg = weightForAmount(amountPaisa, pricePerKg);
      if (!Number.isFinite(weightMg) || weightMg <= 0) {
        throw new ValidationError('The custom amount is too small to calculate a weight.');
      }
      unitPricePaisa = amountPaisa;
      pricingMode = 'AMOUNT';
      portionLabel = 'Custom amount';
    } else if (raw.kind === 'BIRYANI_WEIGHT') {
      if (raw.weightMg !== undefined && raw.weightMg !== null) {
        weightMg = integer(raw.weightMg, 'Weight');
      } else {
        const kg = Number(raw.weightKg);
        if (!Number.isFinite(kg)) throw new ValidationError('Enter a valid biryani weight.');
        weightMg = kgToMg(kg);
      }
      if (!Number.isFinite(weightMg) || weightMg <= 0) {
        throw new ValidationError('Enter a biryani weight greater than 0.');
      }
      if (weightMg > MAX_WEIGHT_MG) {
        throw new ValidationError(`Weight cannot exceed ${mgToKg(MAX_WEIGHT_MG)} kg for one item.`);
      }
      if (pricePerKg === null || pricePerKg <= 0) {
        throw new ValidationError(
          `${product.name} has no price per kg. Set it in Owner Settings → Menu & Pricing.`
        );
      }
      unitPricePaisa = priceForWeight(pricePerKg, weightMg);
      if (unitPricePaisa <= 0) {
        throw new ValidationError('The weight is too small to calculate a price.');
      }
      pricingMode = 'WEIGHT';
      portionLabel = 'Custom weight';
    } else {
      throw new ValidationError('Unknown biryani entry type.');
    }

    if (
      raw.quantity !== undefined &&
      pricingMode !== 'PORTION' &&
      Number(raw.quantity) !== 1
    ) {
      throw new ValidationError('Custom amount and custom weight lines are added one at a time.');
    }
    if (weightMg * quantity > MAX_WEIGHT_MG) {
      throw new ValidationError(`Weight cannot exceed ${mgToKg(MAX_WEIGHT_MG)} kg for one item.`);
    }
    const lineTotalPaisa = unitPricePaisa * quantity;
    const unitCostPaisa =
      costPerKg === null ? null : priceForWeight(costPerKg, weightMg);
    return {
      productId: product.id,
      productName: product.name,
      productType: product.biryani_kind,
      portionLabel,
      pricingMode,
      weightMg,
      quantity,
      unitPricePaisa,
      lineTotalPaisa,
      unitCostPaisa,
      lineCostPaisa: unitCostPaisa === null ? null : unitCostPaisa * quantity,
      note: text(raw.note, 200, 'Item note'),
    };
  }

  function buildOtherLine(handle, raw) {
    const quantity = positiveInteger(raw.quantity === undefined ? 1 : raw.quantity, 'Quantity', {
      max: MAX_QTY,
    });
    if (raw.productId) {
      const product = productForSale(handle, raw.productId);
      if (product.type !== 'OTHER') {
        throw new ValidationError(`${product.name} is not an other-item product.`);
      }
      if (product.unit_price_paisa === null) {
        throw new ValidationError(
          `${product.name} has no price. Set it in Owner Settings → Menu & Pricing.`
        );
      }
      const unitPricePaisa = Number(product.unit_price_paisa);
      const unitCostPaisa =
        product.unit_cost_paisa === null ? null : Number(product.unit_cost_paisa);
      return {
        productId: product.id,
        productName: product.name,
        productType: 'OTHER',
        portionLabel: null,
        pricingMode: 'FIXED',
        weightMg: 0,
        quantity,
        unitPricePaisa,
        lineTotalPaisa: unitPricePaisa * quantity,
        unitCostPaisa,
        lineCostPaisa: unitCostPaisa === null ? null : unitCostPaisa * quantity,
        note: text(raw.note, 200, 'Item note'),
      };
    }
    const name = text(raw.name, 80, 'Item name', { required: true });
    const unitPricePaisa = requiredPaisa(
      raw.unitPricePaisa,
      raw.unitPrice,
      'Item selling price',
      { max: MAX_ITEM_PRICE_PAISA }
    );
    const unitCostPaisa = paisaField(raw.unitCostPaisa, raw.unitCost, 'Item cost', {
      max: MAX_ITEM_PRICE_PAISA,
    });
    return {
      productId: null,
      productName: name,
      productType: 'OTHER',
      portionLabel: null,
      pricingMode: 'MANUAL',
      weightMg: 0,
      quantity,
      unitPricePaisa,
      lineTotalPaisa: unitPricePaisa * quantity,
      unitCostPaisa,
      lineCostPaisa: unitCostPaisa === null ? null : unitCostPaisa * quantity,
      note: text(raw.note, 200, 'Item note'),
    };
  }

  function nextOrderNumber(handle, date) {
    const counter = handle
      .prepare('SELECT last_seq FROM daily_counters WHERE sale_date = ?')
      .get(date);
    let seq;
    if (counter) {
      seq = Number(counter.last_seq) + 1;
      handle.prepare('UPDATE daily_counters SET last_seq = ? WHERE sale_date = ?').run(seq, date);
    } else {
      let maxSeq = 0;
      for (const row of handle
        .prepare('SELECT order_number FROM orders WHERE order_date = ?')
        .all(date)) {
        const parsed = parseOrderNumber(row.order_number);
        if (parsed && parsed.seq > maxSeq) maxSeq = parsed.seq;
      }
      seq = maxSeq + 1;
      handle
        .prepare('INSERT INTO daily_counters (sale_date, last_seq) VALUES (?, ?)')
        .run(date, seq);
    }
    return `JB-${date.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
  }

  function insertOrderLines(handle, orderId, lines) {
    const insert = handle.prepare(
      `INSERT INTO order_items
        (order_id, product_id, product_name, product_type, portion_label, pricing_mode,
         weight_mg, quantity, unit_price_paisa, line_total_paisa, unit_cost_paisa, line_cost_paisa, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const line of lines) {
      insert.run(
        orderId,
        line.productId || null,
        line.productName,
        line.productType,
        line.portionLabel || null,
        line.pricingMode,
        line.weightMg,
        line.quantity,
        line.unitPricePaisa,
        line.lineTotalPaisa,
        line.unitCostPaisa,
        line.lineCostPaisa,
        line.note || ''
      );
    }
  }

  function createOrder(input = {}) {
    const requestId = text(input.requestId, 120, 'Sale request id', { required: true });
    if (requestId.length < 8) {
      throw new ValidationError('Missing sale request id. Please try again.');
    }
    const note = text(input.note, 200, 'Order note');
    const rawItems = Array.isArray(input.items) ? input.items : [];

    let outcome;
    try {
      outcome = transaction((handle) => {
        const existing = findOrderByRequestId(handle, requestId);
        if (existing) return { order: existing, duplicate: true };
        if (!rawItems.length) throw new ValidationError('Add at least one item to the order.');
        if (rawItems.length > MAX_ITEMS) {
          throw new ValidationError(`An order cannot contain more than ${MAX_ITEMS} items.`);
        }

        const lines = rawItems.map((raw) => {
          if (!raw || typeof raw !== 'object') throw new ValidationError('Invalid order item.');
          const kind = String(raw.kind || (raw.productType === 'OTHER' ? 'OTHER' : '')).toUpperCase();
          if (
            kind === 'BIRYANI_PORTION' ||
            kind === 'BIRYANI_AMOUNT' ||
            kind === 'BIRYANI_WEIGHT' ||
            kind === 'PORTION' ||
            kind === 'AMOUNT' ||
            kind === 'WEIGHT'
          ) {
            const normalised = { ...raw };
            if (kind === 'PORTION') normalised.kind = 'BIRYANI_PORTION';
            else if (kind === 'AMOUNT') normalised.kind = 'BIRYANI_AMOUNT';
            else if (kind === 'WEIGHT') normalised.kind = 'BIRYANI_WEIGHT';
            return buildBiryaniLine(handle, normalised);
          }
          if (kind === 'OTHER' || kind === 'OTHER_PRODUCT' || kind === 'OTHER_MANUAL') {
            return buildOtherLine(handle, raw);
          }
          throw new ValidationError('Unknown order item type.');
        });

        for (const line of lines) {
          if (line.lineTotalPaisa < 0) throw new ValidationError('Item totals cannot be negative.');
        }
        const totalPaisa = lines.reduce((sum, line) => sum + line.lineTotalPaisa, 0);
        if (totalPaisa <= 0) throw new ValidationError('The order total must be greater than 0.');
        if (totalPaisa > MAX_AMOUNT_PAISA) {
          throw new ValidationError(
            `Order total cannot exceed Rs ${(MAX_AMOUNT_PAISA / 100).toLocaleString('en-PK')}.`
          );
        }
        const costIncomplete = lines.some((line) => line.lineCostPaisa === null);
        const costPaisa = costIncomplete
          ? null
          : lines.reduce((sum, line) => sum + line.lineCostPaisa, 0);

        const moment = now();
        const date = dayKey(moment);
        const time = timeKey(moment);
        const orderNumber = nextOrderNumber(handle, date);
        const info = handle
          .prepare(
            `INSERT INTO orders
              (order_number, request_id, legacy_sale_id, order_date, order_time, created_at, created_ms,
               total_paisa, cost_paisa, cost_incomplete, is_legacy, note)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
          )
          .run(
            orderNumber,
            requestId,
            date,
            time,
            dateTimeKey(moment),
            moment.getTime(),
            totalPaisa,
            costPaisa,
            costIncomplete ? 1 : 0,
            note
          );
        const orderId = Number(info.lastInsertRowid);
        insertOrderLines(handle, orderId, lines);
        return { order: getOrderRaw(handle, orderId), duplicate: false };
      });
    } catch (error) {
      if (
        /UNIQUE constraint failed: orders\.order_number|UNIQUE constraint failed: orders\.request_id/i.test(
          error.message
        )
      ) {
        // A simultaneous retry can lose the race; return the order that won.
        const existing = findOrderByRequestId(getHandle(), requestId);
        if (existing) return { order: existing, duplicate: true };
      }
      throw error;
    }

    if (!outcome.duplicate) refreshAutoBackupSafely();
    return outcome;
  }

  function createSale(input = {}) {
    const requestId = text(input.requestId, 120, 'Sale request id', { required: true });
    if (requestId.length < 8) {
      throw new ValidationError('Missing sale request id. Please try again.');
    }
    let amountPaisa;
    if (input.amountPaisa !== undefined) {
      amountPaisa = requiredPaisa(input.amountPaisa, undefined, 'Sale amount', {
        max: MAX_AMOUNT_PAISA,
      });
    } else {
      const amount = Number(input.amount);
      if (!Number.isFinite(amount)) throw new ValidationError('Enter a sale amount greater than 0.');
      amountPaisa = requiredPaisa(rupeesToPaisa(amount), undefined, 'Sale amount', {
        max: MAX_AMOUNT_PAISA,
      });
    }
    let weightMg;
    if (input.weightMg !== undefined) {
      weightMg = integer(input.weightMg, 'Weight');
    } else {
      const kg = Number(input.weightKg);
      if (!Number.isFinite(kg)) throw new ValidationError('Enter a biryani weight greater than 0.');
      weightMg = kgToMg(kg);
    }
    if (!Number.isFinite(weightMg) || weightMg <= 0) {
      throw new ValidationError('Enter a biryani weight greater than 0.');
    }
    if (weightMg > MAX_WEIGHT_MG) {
      throw new ValidationError(`Weight cannot exceed ${mgToKg(MAX_WEIGHT_MG)} kg for a single sale.`);
    }
    const note = text(input.note, 200, 'Sale note');

    const outcome = transaction((handle) => {
      const existing = findOrderByRequestId(handle, requestId);
      if (existing) return { order: existing, duplicate: true };
      const legacyProduct = handle
        .prepare("SELECT * FROM menu_products WHERE code = 'LEGACY'")
        .get();
      if (!legacyProduct) throw new ValidationError('Legacy product row is missing.');
      const moment = now();
      const date = dayKey(moment);
      const time = timeKey(moment);
      const orderNumber = nextOrderNumber(handle, date);
      const info = handle
        .prepare(
          `INSERT INTO orders
            (order_number, request_id, legacy_sale_id, order_date, order_time, created_at, created_ms,
             total_paisa, cost_paisa, cost_incomplete, is_legacy, note)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, 1, 1, ?)`
        )
        .run(
          orderNumber,
          requestId,
          date,
          time,
          dateTimeKey(moment),
          moment.getTime(),
          amountPaisa,
          note
        );
      insertOrderLines(handle, Number(info.lastInsertRowid), [
        {
          productId: legacyProduct.id,
          productName: 'Legacy / unclassified biryani',
          productType: 'LEGACY',
          portionLabel: weightLabelFromMg(weightMg),
          pricingMode: 'LEGACY',
          weightMg,
          quantity: 1,
          unitPricePaisa: amountPaisa,
          lineTotalPaisa: amountPaisa,
          unitCostPaisa: null,
          lineCostPaisa: null,
          note,
        },
      ]);
      return { order: getOrderRaw(handle, Number(info.lastInsertRowid)), duplicate: false };
    });
    if (!outcome.duplicate) refreshAutoBackupSafely();
    return { sale: mapSale(outcome.order), duplicate: outcome.duplicate, order: outcome.order };
  }

  function getOrder(id) {
    const order = getOrderRaw(getHandle(), positiveInteger(id, 'Order id'));
    if (!order) throw new ValidationError('Order not found.');
    return order;
  }

  function findOrderByNumber(orderNumber) {
    const term = String(orderNumber || '').trim().slice(0, 80);
    if (!term) throw new ValidationError('Enter an order number to search.');
    const pattern = `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const rows = getHandle()
      .prepare(
        `SELECT o.* FROM orders o
         WHERE o.order_number LIKE ? ESCAPE '\\'
            OR EXISTS (
              SELECT 1 FROM order_items oi
              WHERE oi.order_id = o.id AND oi.product_name LIKE ? ESCAPE '\\'
            )
         ORDER BY o.created_ms DESC LIMIT 50`
      )
      .all(pattern, pattern);
    return hydrateOrders(getHandle(), rows);
  }

  function getSettings() {
    const rows = getHandle().prepare('SELECT key, value FROM settings').all();
    const settings = { ratePerKg: 0 };
    for (const row of rows) {
      if (row.key === 'ratePerKg') {
        const parsed = Number(row.value);
        if (Number.isFinite(parsed) && parsed >= 0) settings.ratePerKg = parsed;
      }
    }
    return settings;
  }

  function updateSettings(patch = {}) {
    const handle = getHandle();
    if (patch.ratePerKg !== undefined) {
      const rate = Number(patch.ratePerKg);
      if (!Number.isFinite(rate) || rate < 0) {
        throw new ValidationError('Price per kg must be a number of 0 or more.');
      }
      if (rate > 100000) {
        throw new ValidationError('Price per kg looks too high. Maximum is Rs 100,000.');
      }
      handle
        .prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run('ratePerKg', String(roundKg(rate, 2)));
    }
    return getSettings();
  }

  // ---------- Backups ----------

  function replaceFileAtomically(tempPath, targetPath) {
    const previous = `${targetPath}.previous-${process.pid}-${Date.now()}`;
    let movedPrevious = false;
    try {
      if (fs.existsSync(targetPath)) {
        fs.renameSync(targetPath, previous);
        movedPrevious = true;
      }
      fs.renameSync(tempPath, targetPath);
      if (movedPrevious && fs.existsSync(previous)) fs.unlinkSync(previous);
    } catch (error) {
      try {
        if (movedPrevious && fs.existsSync(previous)) {
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          fs.renameSync(previous, targetPath);
        }
      } catch {
        /* best effort: original file was not modified unless rename completed */
      }
      throw error;
    }
  }

  function verifySnapshotFile(filePath, { allowLegacy = false } = {}) {
    const info = validateBackupFile(filePath, { allowLegacy });
    if (!info.valid) throw new ValidationError(info.error || 'The backup did not pass verification.');
    return info;
  }

  function backupTo(targetPath) {
    const target = path.resolve(targetPath);
    if (target === resolvedPath) {
      throw new ValidationError('A backup cannot overwrite the live database.');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      getHandle().prepare('VACUUM INTO ?').run(temp);
      verifySnapshotFile(temp, { allowLegacy: true });
      replaceFileAtomically(temp, target);
      const stat = fs.statSync(target);
      const result = {
        path: target,
        size: stat.size,
        orders: ordersCount(),
        sales: ordersCount(),
        verifiedAt: dateTimeKey(now()),
        verified: true,
      };
      backupState.lastSuccess = { ...result, at: now().getTime() };
      backupState.lastError = null;
      return result;
    } catch (error) {
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  function validateBackupFile(filePath, options = {}) {
    const source = path.resolve(filePath);
    if (!fs.existsSync(source)) {
      return { valid: false, error: 'The selected backup file was not found.', path: source };
    }
    let test = null;
    try {
      test = new DatabaseSync(source, { readOnly: true });
      const integrity = test.prepare('PRAGMA integrity_check').get();
      const integrityValue = integrity ? Object.values(integrity)[0] : null;
      if (integrityValue !== 'ok') {
        return { valid: false, error: 'This file is not a healthy SQLite database.', path: source };
      }
      const fk = test.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) {
        return {
          valid: false,
          error: 'The backup has broken internal references (foreign key check failed).',
          path: source,
        };
      }

      const versionRow = test.prepare('PRAGMA user_version').get();
      const version = Number(versionRow && versionRow.user_version) || 0;
      if (version > TARGET_SCHEMA_VERSION) {
        return {
          valid: false,
          error: `This backup was created by a newer application version (schema ${version}).`,
          path: source,
        };
      }

      const tables = new Set(
        test
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name)
      );
      const indexes = new Set(
        test
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
          .all()
          .map((row) => row.name)
      );

      const isV2 = tables.has('orders') || tables.has('order_items') || version >= 2;
      if (isV2) {
        const required = [
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
        const missing = required.filter((name) => !tables.has(name));
        const missingIndexes = REQUIRED_INDEXES_V2.filter((name) => !indexes.has(name));
        if (missing.length) {
          return {
            valid: false,
            error: `This backup is incomplete. Missing required table(s): ${missing.join(', ')}.`,
            path: source,
            missingTables: missing,
          };
        }
        if (missingIndexes.length) {
          return {
            valid: false,
            error: `This backup is incomplete. Missing required index(es): ${missingIndexes.join(', ')}.`,
            path: source,
            missingIndexes,
          };
        }

        const totals = test
          .prepare(
            `SELECT COUNT(*) AS orders,
                    COALESCE(MIN(order_date), '') AS firstDate,
                    COALESCE(MAX(order_date), '') AS lastDate,
                    COALESCE(SUM(total_paisa), 0) AS revenue,
                    COALESCE(SUM(CASE WHEN is_legacy = 1 THEN 1 ELSE 0 END), 0) AS legacy
             FROM orders`
          )
          .get();
        const salesStats = test
          .prepare(
            `SELECT COUNT(*) AS sales,
                    COALESCE(SUM(amount_pkr), 0) AS amount,
                    COALESCE(SUM(weight_kg), 0) AS kg
             FROM sales`
          )
          .get();
        const mismatched = test
          .prepare(
            `SELECT o.id, o.order_number, o.total_paisa,
                    COALESCE(SUM(oi.line_total_paisa), 0) AS item_total
             FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
             GROUP BY o.id HAVING o.total_paisa <> item_total LIMIT 5`
          )
          .all();
        if (mismatched.length) {
          return {
            valid: false,
            error: `This backup has orders whose line items do not add up (e.g. ${mismatched[0].order_number}).`,
            path: source,
            mismatched,
          };
        }
        const items = test
          .prepare(
            `SELECT COUNT(*) AS items,
                    COALESCE(SUM(weight_mg * quantity), 0) AS mg
             FROM order_items`
          )
          .get();
        const counters = test.prepare('SELECT * FROM daily_counters').all();
        const counterMap = new Map(counters.map((row) => [row.sale_date, Number(row.last_seq)]));
        const countersRepairNeeded = test
          .prepare('SELECT order_number, order_date FROM orders')
          .all()
          .some((row) => {
            const parsed = parseOrderNumber(row.order_number);
            if (!parsed) return false;
            const current = counterMap.get(parsed.date) || 0;
            return current < parsed.seq;
          });

        return {
          valid: true,
          path: source,
          schemaVersion: version || 2,
          isLegacySchema: false,
          tables: Array.from(tables).sort(),
          orders: Number(totals.orders) || 0,
          sales: Number(totals.orders) || 0,
          legacyOrders: Number(totals.legacy) || 0,
          migratedSales: Number(salesStats.sales) || 0,
          items: Number(items.items) || 0,
          itemWeightKg: roundKg(mgToKg(items.mg), 3),
          revenue: paisaToRupees(totals.revenue),
          firstDate: totals.firstDate,
          lastDate: totals.lastDate,
          countersRepairNeeded,
          warnings: [],
          size: fs.statSync(source).size,
        };
      }

      const requiredV1 = ['sales', 'daily_counters', 'settings'];
      const missing = requiredV1.filter((name) => !tables.has(name));
      if (missing.length) {
        return {
          valid: false,
          error: `This is not a complete Joona Biryani backup. Missing required table(s): ${missing.join(', ')}.`,
          path: source,
          missingTables: missing,
        };
      }
      const missingV1Indexes = ['idx_sales_date', 'idx_sales_created'].filter(
        (name) => !indexes.has(name)
      );
      if (missingV1Indexes.length) {
        return {
          valid: false,
          error: `This backup is incomplete. Missing required index(es): ${missingV1Indexes.join(', ')}.`,
          path: source,
          missingIndexes: missingV1Indexes,
        };
      }
      const stats = test
        .prepare(
          `SELECT COUNT(*) AS sales,
                  COALESCE(MIN(sale_date), '') AS firstDate,
                  COALESCE(MAX(sale_date), '') AS lastDate,
                  COALESCE(SUM(amount_pkr), 0) AS amount,
                  COALESCE(SUM(weight_kg), 0) AS kg
           FROM sales`
        )
        .get();
      const counterRows = test.prepare('SELECT * FROM daily_counters').all();
      const counterMap = new Map(counterRows.map((row) => [row.sale_date, Number(row.last_seq)]));
      const countersRepairNeeded = test
        .prepare('SELECT sale_number, sale_date FROM sales')
        .all()
        .some((row) => {
          const parsed = parseOrderNumber(row.sale_number);
          if (!parsed) return false;
          const current = counterMap.get(parsed.date) || 0;
          return current < parsed.seq;
        });
      return {
        valid: true,
        path: source,
        schemaVersion: 1,
        isLegacySchema: true,
        tables: Array.from(tables).sort(),
        orders: 0,
        sales: Number(stats.sales) || 0,
        legacyOrders: Number(stats.sales) || 0,
        items: Number(stats.sales) || 0,
        itemWeightKg: roundKg(Number(stats.kg), 3),
        revenue: Number(stats.amount),
        firstDate: stats.firstDate,
        lastDate: stats.lastDate,
        countersRepairNeeded,
        warnings: ['This is a version 1 backup. It will be upgraded safely after restore.'],
        size: fs.statSync(source).size,
      };
    } catch (error) {
      return {
        valid: false,
        error: 'This file cannot be read as a Joona Biryani backup.',
        path: source,
        details: error.message,
      };
    } finally {
      if (test) {
        try {
          test.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  function restoreFrom(filePath) {
    const validation = validateBackupFile(filePath);
    if (!validation.valid) {
      throw new ValidationError(validation.error || 'The selected backup is not valid.');
    }

    fs.mkdirSync(backupsDir, { recursive: true });
    const safetyPath = path.join(backupsDir, `pre-restore-${fileStamp(now())}.sqlite`);
    const safety = backupTo(safetyPath);
    const tempPath = `${resolvedPath}.restoring-${process.pid}-${Date.now()}`;
    const previousPath = `${resolvedPath}.previous-${process.pid}-${Date.now()}`;
    const source = path.resolve(filePath);

    try {
      fs.copyFileSync(source, tempPath);
      const tempValidation = validateBackupFile(tempPath);
      if (!tempValidation.valid) {
        throw new ValidationError(tempValidation.error || 'The copied backup failed verification.');
      }

      const oldCount = ordersCount();
      if (db) {
        db.close();
        db = null;
      }
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(resolvedPath + suffix)) fs.unlinkSync(resolvedPath + suffix);
      }
      if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
      if (fs.existsSync(resolvedPath)) fs.renameSync(resolvedPath, previousPath);
      try {
        fs.renameSync(tempPath, resolvedPath);
        db = connect();
        alignDailyCounters(db);
        assertCurrentSchema(db);
        verifyOrderTotals(db);
        const restoredCount = ordersCount();
        const expected = validation.isLegacySchema ? validation.sales : validation.orders;
        if (expected !== restoredCount) {
          throw new Error(
            `Restored order count ${restoredCount} did not match the verified backup count ${expected}.`
          );
        }
        if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
        pruneFiles(backupsDir, /^pre-restore-.*\.sqlite$/, PRE_RESTORE_KEEP);
        return {
          orders: restoredCount,
          sales: restoredCount,
          previousOrders: oldCount,
          safetyBackup: safety.path,
          restoredSchemaVersion: TARGET_SCHEMA_VERSION,
          upgradedFromLegacy: Boolean(validation.isLegacySchema),
        };
      } catch (error) {
        try {
          if (db) {
            db.close();
            db = null;
          }
          for (const suffix of ['', '-wal', '-shm']) {
            if (fs.existsSync(resolvedPath + suffix)) fs.unlinkSync(resolvedPath + suffix);
          }
          if (fs.existsSync(previousPath)) fs.renameSync(previousPath, resolvedPath);
          db = connect();
        } catch {
          /* best effort */
        }
        throw error;
      }
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
      if (error instanceof ValidationError) throw error;
      throw new Error(
        `Restore failed. Your previous data was kept. ${error.message}`
      );
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
  }

  function pruneFiles(directory, pattern, keep) {
    try {
      const files = fs
        .readdirSync(directory)
        .filter((name) => pattern.test(name))
        .map((name) => {
          const full = path.join(directory, name);
          return { full, mtime: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      // Never remove the last known-good file even if retention is smaller.
      for (const file of files.slice(Math.max(keep, 1))) {
        try {
          fs.unlinkSync(file.full);
        } catch {
          /* pruning is best effort */
        }
      }
    } catch {
      /* pruning is best effort */
    }
  }

  function autoBackup(options = {}) {
    fs.mkdirSync(backupsDir, { recursive: true });
    const today = dayKey(now());
    const target = path.join(backupsDir, `auto-${today}.sqlite`);
    backupState.lastAttempt = now().getTime();
    try {
      if (fs.existsSync(target) && !options.force) {
        const existing = validateBackupFile(target, { allowLegacy: true });
        const currentOrders = ordersCount();
        if (
          existing.valid &&
          (existing.orders === currentOrders || (existing.isLegacySchema && existing.sales === currentOrders))
        ) {
          backupState.lastSuccess = {
            path: target,
            at: fs.statSync(target).mtimeMs,
            orders: currentOrders,
          };
          backupState.lastError = null;
          return { skipped: true, path: target, orders: currentOrders };
        }
      }
      const result = backupTo(target);
      pruneFiles(backupsDir, /^auto-.*\.sqlite$/, AUTO_BACKUP_KEEP_DAYS);
      return { skipped: false, ...result };
    } catch (error) {
      backupState.lastError = error.message;
      throw error;
    }
  }

  function refreshAutoBackupSafely() {
    try {
      autoBackup({ force: true });
    } catch (error) {
      backupState.lastError = error.message;
      console.warn('[joona] automatic backup refresh failed:', error.message);
    }
  }

  function storageInfo() {
    const files = [resolvedPath, `${resolvedPath}-wal`, `${resolvedPath}-shm`];
    let size = 0;
    for (const file of files) {
      try {
        size += fs.statSync(file).size;
      } catch {
        /* not present */
      }
    }

    let lastBackup = null;
    let autoBackupToday = null;
    const today = dayKey(now());
    try {
      const entries = fs
        .readdirSync(backupsDir)
        .filter((name) => name.endsWith('.sqlite'))
        .map((name) => {
          const full = path.join(backupsDir, name);
          const stat = fs.statSync(full);
          return { name, path: full, mtime: stat.mtimeMs, size: stat.size };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (entries.length) lastBackup = entries[0];
      autoBackupToday =
        entries.find((entry) => entry.name === `auto-${today}.sqlite`) || null;
    } catch {
      /* no backups yet */
    }

    const nowMs = now().getTime();
    const ageHours = lastBackup ? (nowMs - lastBackup.mtime) / 3600000 : null;
    const overdue = !lastBackup || (ageHours !== null && ageHours > 48);
    const warnings = [];
    if (backupState.lastError) {
      warnings.push(`The latest automatic backup failed: ${backupState.lastError}`);
    }
    if (overdue) {
      warnings.push(
        'No recent verified backup was found. Create a backup to a USB drive and check the backups folder.'
      );
    }
    if (lastBackup && !autoBackupToday && ageHours !== null && ageHours > 24) {
      warnings.push('Today’s automatic backup has not been refreshed yet.');
    }

    return {
      dbPath: resolvedPath,
      backupsDir,
      size,
      sales: ordersCount(),
      orders: ordersCount(),
      lastBackup,
      lastBackupAt: lastBackup ? lastBackup.mtime : null,
      lastBackupError: backupState.lastError,
      autoBackupToday,
      backupOverdue: overdue,
      backupAgeHours: ageHours === null ? null : roundKg(ageHours, 1),
      backupWarnings: warnings,
      schemaVersion: TARGET_SCHEMA_VERSION,
    };
  }

  function verifyOrderTotals(handle = getHandle()) {
    const mismatched = handle
      .prepare(
        `SELECT o.id, o.order_number, o.total_paisa,
                COALESCE(SUM(oi.line_total_paisa), 0) AS item_total
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
         GROUP BY o.id HAVING o.total_paisa <> item_total LIMIT 20`
      )
      .all();
    if (mismatched.length) {
      throw new Error(
        `Order totals do not match their line items (e.g. ${mismatched[0].order_number}).`
      );
    }
    return true;
  }

  function verifyDatabase() {
    const handle = getHandle();
    const integrity = handle.prepare('PRAGMA integrity_check').get();
    const integrityValue = integrity ? Object.values(integrity)[0] : null;
    const fk = handle.prepare('PRAGMA foreign_key_check').all();
    assertCurrentSchema(handle);
    verifyOrderTotals(handle);
    const counters = handle.prepare('SELECT * FROM daily_counters').all();
    const counterMap = new Map(counters.map((row) => [row.sale_date, Number(row.last_seq)]));
    const inconsistencies = handle
      .prepare('SELECT order_number FROM orders')
      .all()
      .filter((row) => {
        const parsed = parseOrderNumber(row.order_number);
        if (!parsed) return true;
        return (counterMap.get(parsed.date) || 0) < parsed.seq;
      });
    return {
      integrity: integrityValue,
      foreignKeyViolations: fk.length,
      schemaVersion: TARGET_SCHEMA_VERSION,
      orders: ordersCount(),
      counterInconsistencies: inconsistencies.length,
      totalsConsistent: true,
      ok:
        integrityValue === 'ok' &&
        fk.length === 0 &&
        inconsistencies.length === 0,
    };
  }

  function close() {
    if (db) {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        /* ignore */
      }
      try {
        db.close();
      } catch {
        /* ignore */
      }
      db = null;
    }
  }

  // Open once at start-up so a broken database is reported immediately.
  getHandle();

  return {
    filePath: resolvedPath,
    backupsDir,
    createOrder,
    getOrder,
    listOrders,
    findOrderByNumber,
    recentOrders,
    createSale,
    listSales,
    recentSales,
    summaryForDate,
    monthSummary,
    getDashboard,
    dailyReport,
    monthlyReport,
    getMenu,
    getProduct,
    createProduct,
    updateProduct,
    updatePortion,
    createPortion,
    deletePortion,
    listExpenses,
    addExpense,
    deleteExpense,
    getSettings,
    updateSettings,
    ordersCount,
    salesCount: ordersCount,
    storageInfo,
    backupTo,
    validateBackupFile,
    restoreFrom,
    autoBackup,
    verifyDatabase,
    close,
    raw: () => getHandle(),
  };
}

module.exports = {
  createDatabase,
  weightLabel: weightLabelFromKg,
  weightLabelFromMg,
  formatWeight: (kg) => `${roundKg(kg, 3)} kg`,
  ValidationError,
};
