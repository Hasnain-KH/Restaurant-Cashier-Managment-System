'use strict';

/**
 * The shop's clock. The business runs in Karachi (PKT, UTC+5, no daylight saving),
 * so every stored business date/time and every report boundary must use this zone,
 * regardless of the laptop's Windows timezone setting.
 */
const APP_TIME_ZONE = 'Asia/Karachi';

const pad = (n) => String(n).padStart(2, '0');

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function partsInAppZone(date = new Date()) {
  const parts = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  // Some ICU builds render midnight as 24; normalise it.
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

/** Shop calendar date as YYYY-MM-DD in Asia/Karachi. */
function dayKey(date = new Date()) {
  const p = partsInAppZone(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Shop clock time as HH:MM:SS in Asia/Karachi. */
function timeKey(date = new Date()) {
  const p = partsInAppZone(date);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** Shop month as YYYY-MM in Asia/Karachi. */
function monthKey(date = new Date()) {
  return dayKey(date).slice(0, 7);
}

/** Local (shop-zone) ISO-like timestamp without a timezone suffix. */
function dateTimeKey(date = new Date()) {
  return `${dayKey(date)}T${timeKey(date)}`;
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1970 || y > 9999) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function isValidMonthKey(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function addDays(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** Compact timestamp used for filenames, in shop time. */
function fileStamp(date = new Date()) {
  const p = partsInAppZone(date);
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}${p.second}`;
}

module.exports = {
  APP_TIME_ZONE,
  dayKey,
  timeKey,
  monthKey,
  dateTimeKey,
  isValidDateKey,
  isValidMonthKey,
  addDays,
  daysInMonth,
  addMonths,
  fileStamp,
  partsInAppZone,
};
