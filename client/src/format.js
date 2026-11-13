/**
 * All business dates and times use the shop's clock (Asia/Karachi, PKT, UTC+5),
 * even if the laptop is set to another timezone. The server stores the same zone.
 */
export const APP_TIME_ZONE = 'Asia/Karachi';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (value) => String(value).padStart(2, '0');

const keyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function zoneParts(date = new Date()) {
  const parts = {};
  for (const part of keyFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

export function todayKey(date = new Date()) {
  const parts = zoneParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function monthKey(date = new Date()) {
  return todayKey(date).slice(0, 7);
}

export function addDaysKey(day, delta) {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + delta));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function parseDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  return { year, month, date };
}

export function dateLabel(day) {
  const parsed = parseDay(day);
  if (!parsed) return day || '';
  return `${pad(parsed.date)} ${MONTHS[parsed.month - 1]} ${parsed.year}`;
}

export function shortDateLabel(day) {
  const parsed = parseDay(day);
  if (!parsed) return day || '';
  return `${pad(parsed.date)} ${MONTHS[parsed.month - 1]}`;
}

export function weekdayLabel(day) {
  const parsed = parseDay(day);
  if (!parsed) return day || '';
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.date));
  return WEEKDAYS[date.getUTCDay()];
}

export function monthLabel(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return month || '';
  const [year, monthNumber] = month.split('-').map(Number);
  return `${MONTHS[monthNumber - 1]} ${year}`;
}

export function clockLabel(date = new Date()) {
  return date.toLocaleTimeString('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function headerDateLabel(date = new Date()) {
  return date.toLocaleDateString('en-GB', {
    timeZone: APP_TIME_ZONE,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function saleTimeLabel(time) {
  if (!time) return '';
  const [hourValue, minute] = time.split(':').map(Number);
  const suffix = hourValue >= 12 ? 'PM' : 'AM';
  const hour = hourValue % 12 === 0 ? 12 : hourValue % 12;
  return `${hour}:${pad(minute)} ${suffix}`;
}

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export function money(value) {
  const number = Number(value);
  return `Rs ${numberFormatter.format(Number.isFinite(number) ? number : 0)}`;
}

export function moneyPaisa(paisa) {
  return money(Number(paisa || 0) / 100);
}

export function moneyWhole(value) {
  const number = Number(value);
  const rounded = Number.isFinite(number) ? Math.round(number) : 0;
  return `Rs ${new Intl.NumberFormat('en-US').format(rounded)}`;
}

export function moneyWholePaisa(paisa) {
  return moneyWhole(Number(paisa || 0) / 100);
}

export function kg(value) {
  const number = Number(value);
  return `${decimalFormatter.format(Number.isFinite(number) ? number : 0)} kg`;
}

export function rupeesToPaisa(value) {
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : NaN;
}

export function paisaToRupees(paisa) {
  const number = Number(paisa);
  return Number.isFinite(number) ? number / 100 : 0;
}

export function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(number);
}

export function percentChange(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (before === 0) {
    if (now === 0) return { value: 0, direction: 'flat' };
    return { value: 100, direction: 'up' };
  }
  const change = ((now - before) / before) * 100;
  return {
    value: Math.abs(Math.round(change)),
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}

export function weightLabelFromMg(mg) {
  const grams = Math.round(Number(mg) / 1000);
  if (!Number.isFinite(grams) || grams <= 0) return '0 g';
  if (grams === 250) return '1 Pao';
  if (grams === 500) return 'Half KG';
  if (grams % 1000 === 0) return `${grams / 1000} KG`;
  if (grams < 1000) return `${grams} g`;
  return `${decimalFormatter.format(grams / 1000)} KG`;
}

export function describeWeight(weightKg) {
  return weightLabelFromMg((Number(weightKg) || 0) * 1000000);
}
