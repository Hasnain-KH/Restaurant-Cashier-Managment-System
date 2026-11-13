'use strict';

/**
 * Money is stored only as integer paisa (1 rupee = 100 paisa).
 * Weight is stored only as integer milligrams (1 kg = 1,000,000 mg).
 *
 * Rounding policy (documented in README):
 *   - Rupees entered by the owner/cashier are converted with round-half-up to paisa.
 *   - Portion price = round(pricePerKgPaisa * weightMg / 1,000,000) paisa.
 *   - Amount -> weight = round(amountPaisa * 1,000,000 / pricePerKgPaisa) mg.
 *   - Weight -> price = round(pricePerKgPaisa * weightMg / 1,000,000) paisa.
 * All intermediate arithmetic stays in integers, so no floating point drift can
 * accumulate across sales.
 */

const PAISA_PER_RUPEE = 100;
const MG_PER_KG = 1000000;
const MG_PER_GRAM = 1000;

// Hard limits keep corrupt or hostile input from overflowing SQLite integers.
const MAX_AMOUNT_PAISA = 100000 * PAISA_PER_RUPEE; // Rs 100,000
const MAX_WEIGHT_MG = 50 * MG_PER_KG; // 50 KG for a single item
const MAX_QTY = 999;
const MAX_ITEMS = 100;

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value.trim() !== '') {
    const cleaned = value.replace(/,/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function rupeesToPaisa(value) {
  const number = finiteNumber(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.round((number + Number.EPSILON) * PAISA_PER_RUPEE);
}

function paisaToRupees(paisa) {
  const number = Number(paisa);
  if (!Number.isFinite(number)) return 0;
  return number / PAISA_PER_RUPEE;
}

function kgToMg(kg) {
  const number = finiteNumber(kg);
  if (!Number.isFinite(number)) return NaN;
  return Math.round((number + Number.EPSILON) * MG_PER_KG);
}

function mgToKg(mg) {
  const number = Number(mg);
  if (!Number.isFinite(number)) return 0;
  return number / MG_PER_KG;
}

function priceForWeight(pricePerKgPaisa, weightMg) {
  return Math.round((Number(pricePerKgPaisa) * Number(weightMg)) / MG_PER_KG);
}

function weightForAmount(amountPaisa, pricePerKgPaisa) {
  const amount = Number(amountPaisa);
  const rate = Number(pricePerKgPaisa);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return NaN;
  return Math.round((amount * MG_PER_KG) / rate);
}

function roundKg(value, decimals = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** decimals;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function roundPaisa(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number);
}

/**
 * Human label used on receipts and reports. Standard restaurant portions keep
 * their familiar names; everything else is shown in grams or decimal KG.
 */
function weightLabelFromMg(mg) {
  const grams = Math.round(Number(mg) / MG_PER_GRAM);
  if (!Number.isFinite(grams) || grams <= 0) return '0 g';
  if (grams === 250) return '1 Pao';
  if (grams === 500) return 'Half KG';
  if (grams % 1000 === 0) return `${grams / 1000} KG`;
  if (grams < 1000) return `${grams} g`;
  return `${roundKg(grams / 1000, 3)} KG`;
}

function weightLabelFromKg(kg) {
  return weightLabelFromMg(kgToMg(kg));
}

module.exports = {
  PAISA_PER_RUPEE,
  MG_PER_KG,
  MG_PER_GRAM,
  MAX_AMOUNT_PAISA,
  MAX_WEIGHT_MG,
  MAX_QTY,
  MAX_ITEMS,
  finiteNumber,
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
};
