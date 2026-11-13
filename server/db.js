'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const {
  dayKey,
  timeKey,
  addDays,
  daysInMonth,
  isValidDateKey,
  isValidMonthKey,
} = require('./time');

const MAX_AMOUNT = 1000000; // PKR per single sale
const MAX_WEIGHT_KG = 50;
const AUTO_BACKUP_KEEP_DAYS = 30;
const PRE_RESTORE_KEEP = 5;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function weightLabel(kg) {
  const grams = Math.round(kg * 1000);
  if (grams === 250) return '1 Pao';
  if (grams === 500) return 'Half KG';
  if (grams % 1000 === 0) return `${grams / 1000} KG`;
  if (grams < 1000) return `${grams} g`;
  return `${round(grams / 1000, 2)} KG`;
}

function formatWeight(kg) {
  return `${round(kg, 3)} kg`;
}

function mapSale(row) {
  if (!row) return null;
  return {
    id: row.id,
    saleNumber: row.sale_number,
    amount: row.amount_pkr,
    weightKg: row.weight_kg,
    weightLabel: row.weight_label,
    date: row.sale_date,
    time: row.sale_time,
    createdAt: row.created_at,
    note: row.note || '',
  };
}

const SCHEMA = `
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

  PRAGMA user_version = 1;
`;

function createDatabase(filePath, options = {}) {
  const now = options.now || (() => new Date());
  const backupsDir =
    options.backupsDir || path.join(path.dirname(filePath), '..', 'backups');
  const resolvedPath = path.resolve(filePath);

  let db = null;

  function connect() {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const handle = new DatabaseSync(resolvedPath);
    handle.exec('PRAGMA journal_mode = WAL;');
    handle.exec('PRAGMA synchronous = NORMAL;');
    handle.exec('PRAGMA busy_timeout = 4000;');
    handle.exec(SCHEMA);
    return handle;
  }

  function getHandle() {
    if (!db) db = connect();
    return db;
  }

  function transaction(fn) {
    const handle = getHandle();
    handle.exec('BEGIN IMMEDIATE');
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

  function salesCount() {
    return getHandle().prepare('SELECT COUNT(*) AS c FROM sales').get().c;
  }

  function summaryForDate(date) {
    const row = getHandle()
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(amount_pkr), 0) AS total,
                COALESCE(SUM(weight_kg), 0) AS kg
         FROM sales WHERE sale_date = ?`
      )
      .get(date);

    return {
      date,
      orders: row.orders,
      total: round(row.total, 2),
      kg: round(row.kg, 3),
      average: row.orders ? round(row.total / row.orders, 2) : 0,
    };
  }

  function monthSummary(month) {
    const row = getHandle()
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(amount_pkr), 0) AS total,
                COALESCE(SUM(weight_kg), 0) AS kg
         FROM sales WHERE substr(sale_date, 1, 7) = ?`
      )
      .get(month);

    return {
      month,
      orders: row.orders,
      total: round(row.total, 2),
      kg: round(row.kg, 3),
      average: row.orders ? round(row.total / row.orders, 2) : 0,
    };
  }

  function createSale(input = {}) {
    const requestId = String(input.requestId || '').trim();
    if (requestId.length < 8 || requestId.length > 120) {
      throw new ValidationError('Missing sale request id. Please try again.');
    }

    const amount = round(toNumber(input.amount), 2);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError('Enter a sale amount greater than 0.');
    }
    if (amount > MAX_AMOUNT) {
      throw new ValidationError(`Sale amount cannot exceed Rs ${MAX_AMOUNT.toLocaleString('en-PK')}.`);
    }

    const weightKg = round(toNumber(input.weightKg), 3);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      throw new ValidationError('Enter a biryani weight greater than 0.');
    }
    if (weightKg > MAX_WEIGHT_KG) {
      throw new ValidationError(`Weight cannot exceed ${MAX_WEIGHT_KG} kg for a single sale.`);
    }

    let note = '';
    if (input.note !== undefined && input.note !== null) {
      note = String(input.note).trim().slice(0, 200);
    }

    const handle = getHandle();

    const existing = handle
      .prepare('SELECT * FROM sales WHERE request_id = ?')
      .get(requestId);
    if (existing) {
      return { sale: mapSale(existing), duplicate: true };
    }

    const moment = now();
    const date = dayKey(moment);
    const time = timeKey(moment);
    const createdAt = `${date}T${time}`;
    const createdMs = moment.getTime();

    const sale = transaction((tx) => {
      const counter = tx
        .prepare('SELECT last_seq FROM daily_counters WHERE sale_date = ?')
        .get(date);
      let seq;
      if (counter) {
        seq = counter.last_seq + 1;
        tx.prepare('UPDATE daily_counters SET last_seq = ? WHERE sale_date = ?').run(seq, date);
      } else {
        seq = 1;
        tx.prepare('INSERT INTO daily_counters (sale_date, last_seq) VALUES (?, 1)').run(date);
      }

      const saleNumber = `JB-${date.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
      tx.prepare(
        `INSERT INTO sales
          (sale_number, request_id, amount_pkr, weight_kg, weight_label, note,
           sale_date, sale_time, created_at, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        saleNumber,
        requestId,
        amount,
        weightKg,
        weightLabel(weightKg),
        note,
        date,
        time,
        createdAt,
        createdMs
      );

      return mapSale(tx.prepare('SELECT * FROM sales WHERE request_id = ?').get(requestId));
    });

    return { sale, duplicate: false };
  }

  function listSales(options = {}) {
    const clauses = [];
    const params = [];

    if (options.date) {
      if (!isValidDateKey(options.date)) throw new ValidationError('Invalid date filter.');
      clauses.push('sale_date = ?');
      params.push(options.date);
    } else {
      if (options.from) {
        if (!isValidDateKey(options.from)) throw new ValidationError('Invalid start date.');
        clauses.push('sale_date >= ?');
        params.push(options.from);
      }
      if (options.to) {
        if (!isValidDateKey(options.to)) throw new ValidationError('Invalid end date.');
        clauses.push('sale_date <= ?');
        params.push(options.to);
      }
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 500);
    const offset = Math.max(Number(options.offset) || 0, 0);

    const rows = getHandle()
      .prepare(`SELECT * FROM sales ${where} ORDER BY created_ms DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    const totals = getHandle()
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(amount_pkr), 0) AS total,
                COALESCE(SUM(weight_kg), 0) AS kg
         FROM sales ${where}`
      )
      .get(...params);

    return {
      sales: rows.map(mapSale),
      count: totals.count,
      totalAmount: round(totals.total, 2),
      totalKg: round(totals.kg, 3),
      limit,
      offset,
      hasMore: offset + rows.length < totals.count,
    };
  }

  function recentSales(limit = 10) {
    return getHandle()
      .prepare('SELECT * FROM sales ORDER BY created_ms DESC, id DESC LIMIT ?')
      .all(Math.min(Math.max(Number(limit) || 10, 1), 50))
      .map(mapSale);
  }

  function lastNDays(today, days) {
    const start = addDays(today, -(days - 1));
    const rows = getHandle()
      .prepare(
        `SELECT sale_date AS date,
                COUNT(*) AS orders,
                COALESCE(SUM(amount_pkr), 0) AS total,
                COALESCE(SUM(weight_kg), 0) AS kg
         FROM sales
         WHERE sale_date >= ? AND sale_date <= ?
         GROUP BY sale_date`
      )
      .all(start, today);

    const byDate = new Map(rows.map((row) => [row.date, row]));
    const result = [];
    for (let i = 0; i < days; i += 1) {
      const date = addDays(start, i);
      const row = byDate.get(date);
      result.push({
        date,
        orders: row ? row.orders : 0,
        total: row ? round(row.total, 2) : 0,
        kg: row ? round(row.kg, 3) : 0,
      });
    }
    return result;
  }

  function getDashboard() {
    const today = dayKey(now());
    const yesterday = addDays(today, -1);
    const month = today.slice(0, 7);

    return {
      today: summaryForDate(today),
      yesterday: summaryForDate(yesterday),
      month: monthSummary(month),
      last7Days: lastNDays(today, 7),
      recent: recentSales(10),
    };
  }

  function dailyReport(date) {
    if (!isValidDateKey(date)) throw new ValidationError('Please choose a valid date.');

    const hourly = getHandle()
      .prepare(
        `SELECT substr(sale_time, 1, 2) AS hour,
                COUNT(*) AS orders,
                COALESCE(SUM(amount_pkr), 0) AS total
         FROM sales WHERE sale_date = ?
         GROUP BY hour`
      )
      .all(date);

    const byHour = new Map(hourly.map((row) => [Number(row.hour), row]));
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const row = byHour.get(hour);
      return {
        hour,
        orders: row ? row.orders : 0,
        total: row ? round(row.total, 2) : 0,
      };
    });

    const { sales } = listSales({ date, limit: 500 });

    return {
      ...summaryForDate(date),
      hours,
      sales,
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

    const rows = getHandle()
      .prepare(
        `SELECT sale_date AS date,
                COUNT(*) AS orders,
                COALESCE(SUM(amount_pkr), 0) AS total,
                COALESCE(SUM(weight_kg), 0) AS kg
         FROM sales
         WHERE sale_date >= ? AND sale_date <= ?
         GROUP BY sale_date
         ORDER BY sale_date`
      )
      .all(`${month}-01`, `${month}-${String(totalDays).padStart(2, '0')}`);

    const byDate = new Map(rows.map((row) => [row.date, row]));
    const days = [];
    for (let day = 1; day <= shownDays; day += 1) {
      const key = `${month}-${String(day).padStart(2, '0')}`;
      const row = byDate.get(key);
      days.push({
        date: key,
        orders: row ? row.orders : 0,
        total: row ? round(row.total, 2) : 0,
        kg: row ? round(row.kg, 3) : 0,
      });
    }

    const total = days.reduce((sum, day) => sum + day.total, 0);
    const orders = days.reduce((sum, day) => sum + day.orders, 0);
    const kg = days.reduce((sum, day) => sum + day.kg, 0);
    const bestDay = days.reduce(
      (best, day) => (day.total > best.total ? day : best),
      { date: '', total: 0, orders: 0, kg: 0 }
    );

    return {
      month,
      year,
      monthNumber,
      daysShown: shownDays,
      total: round(total, 2),
      orders,
      kg: round(kg, 3),
      averageOrder: orders ? round(total / orders, 2) : 0,
      averagePerDay: shownDays ? round(total / shownDays, 2) : 0,
      bestDay,
      days,
    };
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
        .run('ratePerKg', String(round(rate, 2)));
    }
    return getSettings();
  }

  function backupTo(targetPath) {
    const target = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    // VACUUM INTO writes a clean, consistent snapshot even while WAL is active.
    getHandle().prepare('VACUUM INTO ?').run(target);
    const stat = fs.statSync(target);
    return { path: target, size: stat.size, sales: salesCount() };
  }

  function validateBackupFile(filePath) {
    const source = path.resolve(filePath);
    if (!fs.existsSync(source)) throw new ValidationError('The selected backup file was not found.');

    let test;
    try {
      test = new DatabaseSync(source, { readOnly: true });
      const integrity = test.prepare('PRAGMA integrity_check').get();
      const integrityValue = integrity ? Object.values(integrity)[0] : null;
      if (integrityValue !== 'ok') {
        throw new ValidationError('This file is not a healthy SQLite database.');
      }
      const table = test
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sales'")
        .get();
      if (!table) {
        throw new ValidationError('This file is not a Joona Biryani backup (sales table missing).');
      }
      const stats = test
        .prepare(
          `SELECT COUNT(*) AS sales,
                  COALESCE(MIN(sale_date), '') AS firstDate,
                  COALESCE(MAX(sale_date), '') AS lastDate
           FROM sales`
        )
        .get();
      return {
        path: source,
        sales: stats.sales,
        firstDate: stats.firstDate,
        lastDate: stats.lastDate,
        size: fs.statSync(source).size,
      };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError('This file cannot be read as a Joona Biryani backup.');
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

  function timestampForFile(date = now()) {
    return `${dayKey(date)}-${String(date.getHours()).padStart(2, '0')}${String(
      date.getMinutes()
    ).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
  }

  function restoreFrom(filePath) {
    const validation = validateBackupFile(filePath);

    fs.mkdirSync(backupsDir, { recursive: true });
    const safetyPath = path.join(backupsDir, `pre-restore-${timestampForFile()}.sqlite`);
    const safety = backupTo(safetyPath);

    const tempPath = `${resolvedPath}.restoring`;
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    fs.copyFileSync(path.resolve(filePath), tempPath);
    validateBackupFile(tempPath);

    try {
      if (db) {
        db.close();
        db = null;
      }
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(resolvedPath + suffix)) fs.unlinkSync(resolvedPath + suffix);
      }
      fs.renameSync(tempPath, resolvedPath);
      db = connect();

      pruneFiles(backupsDir, /^pre-restore-.*\.sqlite$/, PRE_RESTORE_KEEP);

      return {
        sales: salesCount(),
        safetyBackup: safety.path,
      };
    } catch (error) {
      // Try to put the previous database back so the app is never left empty.
      try {
        if (db) {
          db.close();
          db = null;
        }
        for (const suffix of ['', '-wal', '-shm']) {
          if (fs.existsSync(resolvedPath + suffix)) fs.unlinkSync(resolvedPath + suffix);
        }
        fs.copyFileSync(safetyPath, resolvedPath);
        db = connect();
      } catch {
        /* best effort */
      }
      throw new Error('Restore failed. Your previous data was kept. Please try another backup file.');
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
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

      for (const file of files.slice(keep)) fs.unlinkSync(file.full);
    } catch {
      /* pruning is best effort */
    }
  }

  function autoBackup() {
    fs.mkdirSync(backupsDir, { recursive: true });
    const target = path.join(backupsDir, `auto-${dayKey(now())}.sqlite`);
    if (fs.existsSync(target)) {
      return { skipped: true, path: target };
    }
    const result = backupTo(target);
    pruneFiles(backupsDir, /^auto-.*\.sqlite$/, AUTO_BACKUP_KEEP_DAYS);
    return { skipped: false, ...result };
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
    } catch {
      /* no backups yet */
    }

    return {
      dbPath: resolvedPath,
      backupsDir,
      size,
      sales: salesCount(),
      lastBackup,
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
    createSale,
    listSales,
    recentSales,
    summaryForDate,
    monthSummary,
    getDashboard,
    dailyReport,
    monthlyReport,
    getSettings,
    updateSettings,
    salesCount,
    storageInfo,
    backupTo,
    validateBackupFile,
    restoreFrom,
    autoBackup,
    close,
    raw: () => getHandle(),
  };
}

module.exports = { createDatabase, weightLabel, formatWeight, ValidationError };
