'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PAISA_PER_RUPEE,
  MG_PER_KG,
  MAX_AMOUNT_PAISA,
  MAX_WEIGHT_MG,
  MAX_QTY,
  MAX_ITEMS,
  rupeesToPaisa,
  paisaToRupees,
  kgToMg,
  mgToKg,
  priceForWeight,
  weightForAmount,
  roundKg,
  weightLabelFromMg,
  weightLabelFromKg,
} = require('../server/money');

test('money and weight constants use integer base units', () => {
  assert.equal(PAISA_PER_RUPEE, 100);
  assert.equal(MG_PER_KG, 1000000);
  assert.equal(MAX_AMOUNT_PAISA, 10000000);
  assert.equal(MAX_WEIGHT_MG, 50000000);
  assert.equal(MAX_QTY, 999);
  assert.equal(MAX_ITEMS, 100);
});

test('converts rupees to integer paisa without floating point drift', () => {
  assert.equal(rupeesToPaisa(300), 30000);
  assert.equal(rupeesToPaisa(0.1), 10);
  assert.equal(rupeesToPaisa(19.99), 1999);
  assert.equal(rupeesToPaisa(1234.56), 123456);
  assert.equal(rupeesToPaisa('1,234.56'), 123456);
  assert.equal(rupeesToPaisa(0.005), 1); // round half up
  assert.equal(rupeesToPaisa(0.004), 0);
  assert.ok(Number.isNaN(rupeesToPaisa('not money')));
  assert.equal(paisaToRupees(30000), 300);
  assert.equal(paisaToRupees('1999'), 19.99);
});

test('converts kilograms to integer milligrams', () => {
  assert.equal(kgToMg(1), 1000000);
  assert.equal(kgToMg(0.25), 250000);
  assert.equal(kgToMg(0.0005), 500);
  assert.equal(mgToKg(250000), 0.25);
  assert.equal(mgToKg('1000000'), 1);
});

test('calculates portion prices and custom weights with integer rounding', () => {
  // Rs 1200 per kg.
  assert.equal(priceForWeight(120000, 250000), 30000);
  assert.equal(priceForWeight(120000, 500000), 60000);
  assert.equal(priceForWeight(120000, 1000000), 120000);

  // Rs 300 buys exactly 250 g at Rs 1200/kg.
  assert.equal(weightForAmount(30000, 120000), 250000);
  // Rs 500 at Rs 1200/kg is 416.666... g, rounded to the nearest milligram.
  assert.equal(weightForAmount(50000, 120000), 416667);
  assert.ok(Number.isNaN(weightForAmount(100, 0)));
});

test('rounding a custom amount back to a price never invents rupees', () => {
  const pricePerKg = 123457; // Rs 1234.57 per kg
  for (let amount = 1; amount <= 5000; amount += 37) {
    const mg = weightForAmount(amount, pricePerKg);
    const charged = priceForWeight(pricePerKg, mg);
    assert.ok(
      Math.abs(charged - amount) <= 1,
      `amount ${amount} became ${charged} paisa`
    );
  }
});

test('formats weight labels for portions and custom weights', () => {
  assert.equal(weightLabelFromKg(0.25), '1 Pao');
  assert.equal(weightLabelFromKg(0.5), 'Half KG');
  assert.equal(weightLabelFromKg(1), '1 KG');
  assert.equal(weightLabelFromKg(2), '2 KG');
  assert.equal(weightLabelFromKg(0.75), '750 g');
  assert.equal(weightLabelFromMg(250000), '1 Pao');
  assert.equal(weightLabelFromMg(416667), '417 g');
  assert.equal(weightLabelFromMg(1350000), '1.35 KG');
  assert.equal(weightLabelFromMg(0), '0 g');
});

test('roundKg keeps display values stable', () => {
  assert.equal(roundKg(1.23456, 3), 1.235);
  assert.equal(roundKg(0.30000000000000004, 3), 0.3);
  assert.equal(roundKg('bad'), 0);
});
