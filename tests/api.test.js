'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createDatabase } = require('../server/db');
const { createApp } = require('../server/app');

const TOKEN = 'test-local-token';

async function startApi() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joona-api-'));
  const db = createDatabase(path.join(dir, 'data', 'joona.sqlite'), {
    now: () => new Date(2026, 10, 13, 14, 30, 0),
    backupsDir: path.join(dir, 'backups'),
  });
  const app = createApp({ db, token: TOKEN });
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-joona-token': TOKEN,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };

  const close = async () => {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };

  return { call, close, db, base };
}

test('requires the local app token', async () => {
  const { close, base } = await startApi();
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 401);
  await close();
});

test('creates a sale and returns it in history, dashboard and reports', async () => {
  const { call, close } = await startApi();

  const created = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ amount: 1500, weightKg: 1, requestId: 'api-request-0001' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sale.saleNumber, 'JB-20261113-0001');
  assert.equal(created.body.sale.amount, 1500);

  const duplicate = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ amount: 1500, weightKg: 1, requestId: 'api-request-0001' }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  const list = await call('/api/sales?date=2026-11-13');
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 1);
  assert.equal(list.body.totalAmount, 1500);

  const summary = await call('/api/summary?date=2026-11-13');
  assert.equal(summary.body.orders, 1);
  assert.equal(summary.body.total, 1500);

  const dashboard = await call('/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.today.total, 1500);
  assert.equal(dashboard.body.last7Days.length, 7);

  const daily = await call('/api/reports/daily?date=2026-11-13');
  assert.equal(daily.body.orders, 1);
  assert.equal(daily.body.sales.length, 1);

  const monthly = await call('/api/reports/monthly?month=2026-11');
  assert.equal(monthly.status, 200);
  assert.equal(monthly.body.total, 1500);
  assert.ok(monthly.body.days.length >= 13);

  await close();
});

test('returns clear validation errors', async () => {
  const { call, close } = await startApi();

  const invalid = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ amount: 0, weightKg: 1, requestId: 'api-request-bad1' }),
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /amount greater than 0/i);

  const invalidDate = await call('/api/sales?from=not-a-date');
  assert.equal(invalidDate.status, 400);
  assert.match(invalidDate.body.error, /date/i);

  const invalidMonth = await call('/api/reports/monthly?month=2026-13');
  assert.equal(invalidMonth.status, 400);

  const unknown = await call('/api/nope');
  assert.equal(unknown.status, 404);

  await close();
});

test('saves and reads the default price per kg', async () => {
  const { call, close } = await startApi();

  const initial = await call('/api/settings');
  assert.equal(initial.body.ratePerKg, 0);

  const saved = await call('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ ratePerKg: 1350 }),
  });
  assert.equal(saved.body.ratePerKg, 1350);

  const read = await call('/api/settings');
  assert.equal(read.body.ratePerKg, 1350);

  await close();
});
