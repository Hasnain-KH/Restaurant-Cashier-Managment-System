'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase, ValidationError } = require('../server/db');

function setup(startDate = new Date(2026, 10, 13, 14, 30, 0)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joona-orders-'));
  const dbPath = path.join(dir, 'data', 'joona.sqlite');
  const state = { now: startDate };
  const db = createDatabase(dbPath, {
    now: () => state.now,
    backupsDir: path.join(dir, 'backups'),
  });
  return { db, dir, state, dbPath };
}

function productByCode(db, code) {
  return db.getMenu().products.find((product) => product.code === code);
}

test('records a multi-item order with portions, custom amount, custom weight and other items', () => {
  const { db } = setup();
  const sadi = productByCode(db, 'SADI');
  const beef = productByCode(db, 'BEEF');
  db.updateProduct(sadi.id, { pricePerKg: 1200, costPerKg: 800 });
  db.updateProduct(beef.id, { pricePerKg: 1500, costPerKg: 1000 });

  const sadiPao = db.getProduct(sadi.id).portions.find((portion) => portion.label === 'Pao');
  const beefHalf = db.getProduct(beef.id).portions.find((portion) => portion.label === 'Half KG');

  const result = db.createOrder({
    requestId: 'order-multi-0001',
    note: 'table 4',
    items: [
      { kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: sadiPao.id, quantity: 2 },
      { kind: 'BIRYANI_PORTION', productId: beef.id, portionId: beefHalf.id },
      { kind: 'BIRYANI_AMOUNT', productId: sadi.id, amount: 300 },
      { kind: 'BIRYANI_WEIGHT', productId: beef.id, weightKg: 1 },
      { kind: 'OTHER', name: 'Chai', unitPrice: 50, quantity: 3 },
    ],
  });

  assert.equal(result.duplicate, false);
  const order = result.order;
  assert.equal(order.orderNumber, 'JB-20261113-0001');
  assert.equal(order.total, 3300);
  assert.equal(order.totalPaisa, 330000);
  assert.equal(order.items.length, 5);
  assert.equal(order.sadiKg, 0.75);
  assert.equal(order.beefKg, 1.5);
  assert.equal(order.kg, 2.25);
  assert.equal(order.otherRevenue, 150);
  assert.equal(order.costIncomplete, true);
  assert.equal(order.cost, null);
  assert.equal(order.note, 'table 4');

  const [paoLine, halfLine, amountLine, weightLine, chaiLine] = order.items;
  assert.equal(paoLine.quantity, 2);
  assert.equal(paoLine.unitPricePaisa, 30000);
  assert.equal(paoLine.lineTotalPaisa, 60000);
  assert.equal(paoLine.lineCostPaisa, 40000);
  assert.equal(halfLine.lineTotalPaisa, 75000);
  assert.equal(amountLine.weightMg, 250000);
  assert.equal(amountLine.lineTotalPaisa, 30000);
  assert.equal(weightLine.weightMg, 1000000);
  assert.equal(weightLine.lineTotalPaisa, 150000);
  assert.equal(chaiLine.productType, 'OTHER');
  assert.equal(chaiLine.quantity, 3);
  assert.equal(chaiLine.lineTotalPaisa, 15000);
  assert.equal(chaiLine.lineCostPaisa, null);

  assert.equal(db.ordersCount(), 1);
  db.close();
});

test('historical price and cost snapshots never change when the owner edits pricing', () => {
  const { db } = setup();
  const sadi = productByCode(db, 'SADI');
  db.updateProduct(sadi.id, { pricePerKg: 1200, costPerKg: 800 });
  const pao = db.getProduct(sadi.id).portions.find((portion) => portion.label === 'Pao');

  const first = db.createOrder({
    requestId: 'snapshot-000001',
    items: [{ kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: pao.id }],
  });
  assert.equal(first.order.items[0].unitPricePaisa, 30000);
  assert.equal(first.order.items[0].unitCostPaisa, 20000);

  db.updateProduct(sadi.id, { pricePerKg: 1400, costPerKg: 900 });

  const reloaded = db.getOrder(first.order.id);
  assert.equal(reloaded.items[0].unitPricePaisa, 30000);
  assert.equal(reloaded.items[0].unitCostPaisa, 20000);
  assert.equal(reloaded.totalPaisa, 30000);

  const second = db.createOrder({
    requestId: 'snapshot-000002',
    items: [{ kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: pao.id }],
  });
  assert.equal(second.order.items[0].unitPricePaisa, 35000);
  assert.equal(second.order.items[0].unitCostPaisa, 22500);

  const history = db
    .raw()
    .prepare('SELECT * FROM product_price_history WHERE product_id = ? ORDER BY id')
    .all(sadi.id);
  assert.ok(history.length >= 2);
  assert.ok(history.some((row) => row.price_per_kg_paisa === 140000));
  db.close();
});

test('computes gross and net profit only when every item cost is known', () => {
  const { db } = setup();
  const sadi = productByCode(db, 'SADI');
  db.updateProduct(sadi.id, { pricePerKg: 1200, costPerKg: 800 });
  const oneKg = db.getProduct(sadi.id).portions.find((portion) => portion.label === '1 KG');

  db.createOrder({
    requestId: 'profit-0000001',
    items: [{ kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: oneKg.id }],
  });
  db.addExpense({ description: 'Gas cylinder', amount: 100 });

  const summary = db.summaryForDate('2026-11-13');
  assert.equal(summary.total, 1200);
  assert.equal(summary.estimatedProductCost, 800);
  assert.equal(summary.estimatedGrossProfit, 400);
  assert.equal(summary.recordedExpenses, 100);
  assert.equal(summary.estimatedNetProfit, 300);
  assert.equal(summary.profitComplete, true);

  db.createOrder({
    requestId: 'profit-0000002',
    items: [{ kind: 'OTHER_MANUAL', name: 'Salad', unitPrice: 50 }],
  });

  const incomplete = db.summaryForDate('2026-11-13');
  assert.equal(incomplete.total, 1250);
  assert.equal(incomplete.profitComplete, false);
  assert.equal(incomplete.estimatedProductCost, null);
  assert.equal(incomplete.estimatedGrossProfit, null);
  assert.equal(incomplete.estimatedNetProfit, null);
  assert.deepEqual(incomplete.missingCostItems.sort(), ['Salad']);

  const dashboard = db.getDashboard();
  assert.equal(dashboard.today.profitComplete, false);
  assert.equal(dashboard.today.estimatedNetProfit, null);
  db.close();
});

test('treats migrated and compatibility sales as legacy, never as Sadi or Beef', () => {
  const { db } = setup();
  const sale = db.createSale({ amount: 300, weightKg: 1, requestId: 'legacy-compat-1' });
  assert.equal(sale.duplicate, false);

  const summary = db.summaryForDate('2026-11-13');
  assert.equal(summary.orders, 1);
  assert.equal(summary.legacyKg, 1);
  assert.equal(summary.sadiKg, 0);
  assert.equal(summary.beefKg, 0);
  assert.equal(summary.profitComplete, false);

  const orders = db.listOrders({}).orders;
  assert.equal(orders[0].isLegacy, true);
  assert.equal(orders[0].items[0].productType, 'LEGACY');
  assert.equal(orders[0].items[0].portionLabel, '1 KG');
  db.close();
});

test('blocks duplicate order submissions, empty orders and legacy products', () => {
  const { db } = setup();
  const sadi = productByCode(db, 'SADI');
  db.updateProduct(sadi.id, { pricePerKg: 1200, costPerKg: 800 });
  const pao = db.getProduct(sadi.id).portions.find((portion) => portion.label === 'Pao');

  const payload = {
    requestId: 'duplicate-order-1',
    items: [{ kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: pao.id }],
  };
  const first = db.createOrder(payload);
  const retry = db.createOrder({
    ...payload,
    items: [{ kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: pao.id, quantity: 5 }],
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.order.id, first.order.id);
  assert.equal(retry.order.totalPaisa, 30000);
  assert.equal(db.ordersCount(), 1);

  assert.throws(() => db.createOrder({ requestId: 'empty-order-01', items: [] }), /at least one item/i);
  assert.throws(
    () => db.createOrder({ requestId: 'unknown-item-1', items: [{ kind: 'MYSTERY' }] }),
    /unknown order item/i
  );

  const legacy = productByCode(db, 'LEGACY');
  assert.throws(
    () =>
      db.createOrder({
        requestId: 'legacy-order-1',
        items: [{ kind: 'BIRYANI_PORTION', productId: legacy.id, portionId: 1 }],
      }),
    /disabled/i
  );
  assert.throws(
    () => db.createOrder({ requestId: 'short', items: [{ kind: 'OTHER_MANUAL', name: 'x', unitPrice: 1 }] }),
    /request id/i
  );
  assert.ok(new ValidationError('x') instanceof Error);
  db.close();
});

test('uses an explicit portion price override and validates stock limits', () => {
  const { db } = setup();
  const sadi = productByCode(db, 'SADI');
  db.updateProduct(sadi.id, { pricePerKg: 1200, costPerKg: 800 });
  const pao = db.getProduct(sadi.id).portions.find((portion) => portion.label === 'Pao');
  db.updatePortion(pao.id, { price: 350 });

  const order = db.createOrder({
    requestId: 'override-000001',
    items: [{ kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: pao.id }],
  });
  assert.equal(order.order.items[0].unitPricePaisa, 35000);
  assert.equal(order.order.totalPaisa, 35000);

  assert.throws(
    () =>
      db.createOrder({
        requestId: 'too-many-qty-1',
        items: [{ kind: 'BIRYANI_PORTION', productId: sadi.id, portionId: pao.id, quantity: 1000 }],
      }),
    /cannot be more than 999|cannot exceed 999|too large/i
  );
  assert.throws(
    () =>
      db.createOrder({
        requestId: 'too-heavy-0001',
        items: [{ kind: 'BIRYANI_WEIGHT', productId: sadi.id, weightKg: 80 }],
      }),
    /cannot exceed 50 kg/i
  );
  db.close();
});

test('searches orders by number and product name, and paginates without a hard 500-row cap', () => {
  const { db, state } = setup();
  const sadi = productByCode(db, 'SADI');
  db.updateProduct(sadi.id, { pricePerKg: 1200, costPerKg: 800 });
  const pao = db.getProduct(sadi.id).portions.find((portion) => portion.label === 'Pao');

  for (let index = 1; index <= 12; index += 1) {
    db.createOrder({
      requestId: `search-order-${String(index).padStart(4, '0')}`,
      items: [
        {
          kind: 'BIRYANI_PORTION',
          productId: sadi.id,
          portionId: pao.id,
          note: index === 7 ? 'extra raita' : '',
        },
      ],
    });
    state.now = new Date(state.now.getTime() + 1000);
  }

  const byNumber = db.listOrders({ q: 'JB-20261113-0007' });
  assert.equal(byNumber.count, 1);
  assert.equal(byNumber.orders[0].orderNumber, 'JB-20261113-0007');

  const byProduct = db.listOrders({ q: 'Sadi' });
  assert.equal(byProduct.count, 12);

  const firstPage = db.listOrders({ limit: 5 });
  assert.equal(firstPage.orders.length, 5);
  assert.equal(firstPage.count, 12);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.orders[0].orderNumber, 'JB-20261113-0012');

  const lastPage = db.listOrders({ limit: 5, offset: 10 });
  assert.equal(lastPage.orders.length, 2);
  assert.equal(lastPage.hasMore, false);
  db.close();
});

test('expenses can be recorded, listed and deleted', () => {
  const { db } = setup();
  const rent = db.addExpense({ date: '2026-11-13', description: 'Rent', amount: 5000 });
  const gas = db.addExpense({ description: 'Gas', amount: 250 });

  const listed = db.listExpenses({ date: '2026-11-13' });
  assert.equal(listed.count, 2);
  assert.equal(listed.totalAmount, 5250);

  assert.equal(db.deleteExpense(gas.id).deleted, true);
  const after = db.listExpenses({ from: '2026-11-01', to: '2026-11-30' });
  assert.equal(after.count, 1);
  assert.equal(after.expenses[0].id, rent.id);
  assert.throws(() => db.addExpense({ description: '', amount: 10 }), /description/i);
  assert.throws(() => db.addExpense({ description: 'Bad', amount: 0 }), /greater than 0/i);
  db.close();
});
