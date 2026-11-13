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

test('creates a multi-item order through the API after owner pricing is saved', async () => {
  const { call, close } = await startApi();

  const menu = await call('/api/menu');
  assert.equal(menu.status, 200);
  const sadi = menu.body.products.find((product) => product.code === 'SADI');
  const pao = sadi.portions.find((portion) => portion.label === 'Pao');
  assert.equal(sadi.pricePerKg, null);

  const priced = await call(`/api/menu/products/${sadi.id}`, {
    method: 'PUT',
    body: JSON.stringify({ pricePerKg: 1200, costPerKg: 800 }),
  });
  assert.equal(priced.status, 200);
  assert.equal(priced.body.pricePerKg, 1200);
  assert.equal(priced.body.costPerKg, 800);

  const created = await call('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      requestId: 'api-order-000001',
      items: [
        { kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: pao.id, quantity: 2 },
        { kind: 'OTHER_MANUAL', name: 'Raita', unitPrice: 40, quantity: 1 },
      ],
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.order.orderNumber, 'JB-20261113-0001');
  assert.equal(created.body.order.total, 640);
  assert.equal(created.body.order.items.length, 2);
  assert.equal(created.body.order.costIncomplete, true);

  const duplicate = await call('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      requestId: 'api-order-000001',
      items: [{ kind: 'OTHER_MANUAL', name: 'Different', unitPrice: 999 }],
    }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.order.total, 640);

  const list = await call('/api/orders?date=2026-11-13');
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 1);
  assert.equal(list.body.totalAmount, 640);
  assert.equal(list.body.orders[0].items[0].portionLabel, 'Pao');

  const search = await call('/api/orders/search?q=Raita');
  assert.equal(search.body.orders.length, 1);
  assert.equal(search.body.orders[0].orderNumber, 'JB-20261113-0001');

  const single = await call(`/api/orders/${created.body.order.id}`);
  assert.equal(single.status, 200);
  assert.equal(single.body.total, 640);

  await close();
});

test('records expenses and reflects them in profit reports', async () => {
  const { call, close } = await startApi();

  const menu = await call('/api/menu');
  const beef = menu.body.products.find((product) => product.code === 'BEEF');
  const oneKg = beef.portions.find((portion) => portion.label === '1 KG');
  await call(`/api/menu/products/${beef.id}`, {
    method: 'PUT',
    body: JSON.stringify({ pricePerKg: 1500, costPerKg: 1000 }),
  });
  await call('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      requestId: 'api-profit-00001',
      items: [{ kind: 'BIRYANI_PORTION', productId: beef.id, portionId: oneKg.id }],
    }),
  });

  const expense = await call('/api/expenses', {
    method: 'POST',
    body: JSON.stringify({ description: 'Electricity', amount: 200 }),
  });
  assert.equal(expense.status, 201);
  assert.equal(expense.body.amount, 200);

  const summary = await call('/api/summary?date=2026-11-13');
  assert.equal(summary.body.total, 1500);
  assert.equal(summary.body.estimatedProductCost, 1000);
  assert.equal(summary.body.estimatedGrossProfit, 500);
  assert.equal(summary.body.estimatedNetProfit, 300);
  assert.equal(summary.body.profitComplete, true);

  const daily = await call('/api/reports/daily?date=2026-11-13');
  assert.equal(daily.body.expenses.length, 1);
  assert.equal(daily.body.estimatedNetProfit, 300);
  assert.equal(daily.body.orderList.length, 1);

  const listed = await call('/api/expenses?date=2026-11-13');
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.totalAmount, 200);

  const deleted = await call(`/api/expenses/${expense.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.body.deleted, true);

  const missing = await call('/api/expenses/9999', { method: 'DELETE' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /not found/i);

  await close();
});

test('creates owner menu products and rejects invalid pricing', async () => {
  const { call, close } = await startApi();

  const other = await call('/api/menu/products', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Soft Drink',
      type: 'OTHER',
      unitPrice: 100,
      unitCost: 60,
    }),
  });
  assert.equal(other.status, 201);
  assert.equal(other.body.type, 'OTHER');
  assert.equal(other.body.unitPrice, 100);
  assert.equal(other.body.enabled, true);

  const created = await call('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      requestId: 'api-other-00001',
      items: [{ kind: 'OTHER', productId: other.body.id, quantity: 3 }],
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.order.total, 300);
  assert.equal(created.body.order.costIncomplete, false);
  assert.equal(created.body.order.items[0].lineCostPaisa, 18000);

  const invalid = await call(`/api/menu/products/${other.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({ unitPrice: -1 }),
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /negative/i);

  const missing = await call('/api/menu/products/9999');
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /not found/i);

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
