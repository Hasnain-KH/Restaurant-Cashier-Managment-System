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

export function moneyWhole(value) {
  const number = Number(value);
  const rounded = Number.isFinite(number) ? Math.round(number) : 0;
  return `Rs ${new Intl.NumberFormat('en-US').format(rounded)}`;
}

export function kg(value) {
  const number = Number(value);
  return `${decimalFormatter.format(Number.isFinite(number) ? number : 0)} kg`;
}

export function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(number);
}

export function pad(value) {
  return String(value).padStart(2, '0');
}

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function addDaysKey(day, delta) {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(year, month - 1, date + delta);
  return todayKey(next);
}

export function dateLabel(day) {
  if (!day) return '';
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function shortDateLabel(day) {
  if (!day) return '';
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function weekdayLabel(day) {
  if (!day) return '';
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-GB', { weekday: 'short' });
}

export function monthLabel(month) {
  if (!month) return '';
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function clockLabel(date = new Date()) {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function headerDateLabel(date = new Date()) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function saleTimeLabel(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)} ${suffix}`;
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

export function describeWeight(weightKg) {
  const grams = Math.round((Number(weightKg) || 0) * 1000);
  if (grams === 250) return '1 Pao';
  if (grams === 500) return 'Half KG';
  if (grams > 0 && grams % 1000 === 0) return `${grams / 1000} KG`;
  if (grams > 0 && grams < 1000) return `${grams} g`;
  return kg(weightKg);
}
