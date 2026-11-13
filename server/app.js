'use strict';

const express = require('express');
const { APP_TIME_ZONE, dayKey, isValidDateKey, isValidMonthKey } = require('./time');

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function assertDate(value, fallback) {
  const date = value || fallback;
  if (!isValidDateKey(date)) throw badRequest('Please provide a valid date (YYYY-MM-DD).');
  return date;
}

function assertMonth(value, fallback) {
  const month = value || fallback;
  if (!isValidMonthKey(month)) throw badRequest('Please provide a valid month (YYYY-MM).');
  return month;
}

function positiveId(value, label = 'id') {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw badRequest(`Please provide a valid ${label}.`);
  }
  return number;
}

function allowedOrigin(origin) {
  if (!origin) return true;
  if (origin === 'null' || origin === 'file://') return true;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function createApp({ db, token, practice = false, version = '' }) {
  if (!db) throw new Error('createApp requires a database instance.');
  if (typeof token !== 'string' || token.length < 8) {
    throw new Error('createApp requires a strong per-launch API token.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // Only the local app window may talk to this server. No wildcard CORS.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !allowedOrigin(origin)) {
      return res.status(403).json({
        error: 'Requests are only accepted from the Joona Biryani app on this computer.',
      });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-joona-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    if (req.get('x-joona-token') !== token) {
      return res.status(401).json({ error: 'Unauthorized local request.' });
    }
    return next();
  });

  const route = (handler) => (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };

  app.get(
    '/api/health',
    route((req, res) => {
      res.json({
        ok: true,
        sales: db.salesCount(),
        orders: db.ordersCount(),
        practice,
        timezone: APP_TIME_ZONE,
        version,
      });
    })
  );

  app.get(
    '/api/meta',
    route((req, res) => {
      res.json({ practice, timezone: APP_TIME_ZONE, version, today: dayKey() });
    })
  );

  // ---------- Orders (the current cashier flow) ----------

  app.post(
    '/api/orders',
    route((req, res) => {
      const result = db.createOrder(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    })
  );

  app.get(
    '/api/orders',
    route((req, res) => {
      res.json(
        db.listOrders({
          date: req.query.date,
          from: req.query.from,
          to: req.query.to,
          q: req.query.q,
          legacy: req.query.legacy,
          limit: req.query.limit,
          offset: req.query.offset,
        })
      );
    })
  );

  app.get(
    '/api/orders/search',
    route((req, res) => {
      res.json({ orders: db.findOrderByNumber(req.query.q) });
    })
  );

  app.get(
    '/api/orders/:id',
    route((req, res) => {
      res.json(db.getOrder(positiveId(req.params.id, 'order id')));
    })
  );

  // ---------- Legacy sale endpoints (kept for compatibility) ----------

  app.post(
    '/api/sales',
    route((req, res) => {
      const result = db.createSale(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    })
  );

  app.get(
    '/api/sales',
    route((req, res) => {
      res.json(
        db.listSales({
          date: req.query.date,
          from: req.query.from,
          to: req.query.to,
          q: req.query.q,
          legacy: req.query.legacy,
          limit: req.query.limit,
          offset: req.query.offset,
        })
      );
    })
  );

  // ---------- Menu and owner pricing ----------

  app.get(
    '/api/menu',
    route((req, res) => {
      res.json(db.getMenu());
    })
  );

  app.get(
    '/api/menu/products/:id',
    route((req, res) => {
      res.json(db.getProduct(positiveId(req.params.id, 'product id')));
    })
  );

  app.post(
    '/api/menu/products',
    route((req, res) => {
      res.status(201).json(db.createProduct(req.body));
    })
  );

  app.put(
    '/api/menu/products/:id',
    route((req, res) => {
      res.json(db.updateProduct(positiveId(req.params.id, 'product id'), req.body));
    })
  );

  app.put(
    '/api/menu/portions/:id',
    route((req, res) => {
      res.json(db.updatePortion(positiveId(req.params.id, 'portion id'), req.body));
    })
  );

  app.post(
    '/api/menu/products/:id/portions',
    route((req, res) => {
      res
        .status(201)
        .json(db.createPortion(positiveId(req.params.id, 'product id'), req.body));
    })
  );

  app.delete(
    '/api/menu/portions/:id',
    route((req, res) => {
      res.json(db.deletePortion(positiveId(req.params.id, 'portion id')));
    })
  );

  // ---------- Expenses ----------

  app.get(
    '/api/expenses',
    route((req, res) => {
      res.json(
        db.listExpenses({
          date: req.query.date,
          from: req.query.from,
          to: req.query.to,
          limit: req.query.limit,
          offset: req.query.offset,
        })
      );
    })
  );

  app.post(
    '/api/expenses',
    route((req, res) => {
      res.status(201).json(db.addExpense(req.body));
    })
  );

  app.delete(
    '/api/expenses/:id',
    route((req, res) => {
      res.json(db.deleteExpense(positiveId(req.params.id, 'expense id')));
    })
  );

  // ---------- Reports ----------

  app.get(
    '/api/summary',
    route((req, res) => {
      res.json(db.summaryForDate(assertDate(req.query.date, dayKey())));
    })
  );

  app.get(
    '/api/dashboard',
    route((req, res) => {
      res.json(db.getDashboard());
    })
  );

  app.get(
    '/api/reports/daily',
    route((req, res) => {
      res.json(db.dailyReport(assertDate(req.query.date, dayKey())));
    })
  );

  app.get(
    '/api/reports/monthly',
    route((req, res) => {
      res.json(db.monthlyReport(assertMonth(req.query.month, dayKey().slice(0, 7))));
    })
  );

  // ---------- Settings, storage and verification ----------

  app.get(
    '/api/settings',
    route((req, res) => {
      res.json(db.getSettings());
    })
  );

  app.put(
    '/api/settings',
    route((req, res) => {
      res.json(db.updateSettings(req.body));
    })
  );

  app.get(
    '/api/storage',
    route((req, res) => {
      res.json({ ...db.storageInfo(), practice, timezone: APP_TIME_ZONE, version });
    })
  );

  app.get(
    '/api/verify',
    route((req, res) => {
      res.json(db.verifyDatabase());
    })
  );

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Unknown API route.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status =
      Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    if (status >= 500) console.error('[joona] API error:', error);
    res.status(status).json({
      error:
        status >= 500
          ? 'Something went wrong while saving. Please try again.'
          : error.message,
    });
  });

  return app;
}

module.exports = { createApp };
