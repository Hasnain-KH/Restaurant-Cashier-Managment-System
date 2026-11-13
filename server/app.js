'use strict';

const express = require('express');
const cors = require('cors');
const { dayKey, isValidDateKey, isValidMonthKey } = require('./time');

function assertDate(value, fallback) {
  const date = value || fallback;
  if (!isValidDateKey(date)) {
    const error = new Error('Please provide a valid date (YYYY-MM-DD).');
    error.status = 400;
    throw error;
  }
  return date;
}

function assertMonth(value, fallback) {
  const month = value || fallback;
  if (!isValidMonthKey(month)) {
    const error = new Error('Please provide a valid month (YYYY-MM).');
    error.status = 400;
    throw error;
  }
  return month;
}

function createApp({ db, token }) {
  if (!db) throw new Error('createApp requires a database instance.');

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (token && req.get('x-joona-token') !== token) {
      return res.status(401).json({ error: 'Unauthorized local request.' });
    }
    return next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, sales: db.salesCount() });
  });

  app.post('/api/sales', (req, res, next) => {
    try {
      const result = db.createSale(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sales', (req, res, next) => {
    try {
      const { date, from, to, limit, offset } = req.query;
      res.json(db.listSales({ date, from, to, limit, offset }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/summary', (req, res, next) => {
    try {
      const date = assertDate(req.query.date, dayKey());
      res.json(db.summaryForDate(date));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/dashboard', (req, res, next) => {
    try {
      res.json(db.getDashboard());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reports/daily', (req, res, next) => {
    try {
      const date = assertDate(req.query.date, dayKey());
      res.json(db.dailyReport(date));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reports/monthly', (req, res, next) => {
    try {
      const month = assertMonth(req.query.month, dayKey().slice(0, 7));
      res.json(db.monthlyReport(month));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/settings', (req, res) => {
    res.json(db.getSettings());
  });

  app.put('/api/settings', (req, res, next) => {
    try {
      res.json(db.updateSettings(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/storage', (req, res) => {
    res.json(db.storageInfo());
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Unknown API route.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status && error.status >= 400 ? error.status : 500;
    if (status >= 500) {
      console.error('[joona] API error:', error);
    }
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong while saving. Please try again.' : error.message,
    });
  });

  return app;
}

module.exports = { createApp };
