'use strict';

/**
 * Development helper: fills a database with realistic demo sales so the
 * dashboard and reports can be checked with data. Not part of the app.
 *
 * Usage: node scripts/seed-demo.js <database-file>
 */

const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../server/db');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/seed-demo.js <database-file>');
  process.exit(1);
}

const dbPath = path.resolve(target);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
}

let clock = new Date();
const db = createDatabase(dbPath, {
  now: () => clock,
  backupsDir: path.join(path.dirname(dbPath), '..', 'backups'),
});

let seed = 20261113;
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

const weights = [0.25, 0.5, 1, 1, 1, 1.5, 2, 0.75];
const notes = ['', '', '', '', 'Family pack', 'Extra raita', 'Takeaway'];

let created = 0;
for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
  const day = new Date();
  day.setDate(day.getDate() - dayOffset);

  // Fridays and weekends are busier, as in a real biryani shop.
  const weekday = day.getDay();
  const baseOrders = weekday === 5 ? 12 : weekday === 0 || weekday === 6 ? 9 : 6;
  const orders = baseOrders + Math.floor(random() * 6);

  for (let i = 0; i < orders; i += 1) {
    const hour = 12 + Math.floor(random() * 10);
    const minute = Math.floor(random() * 60);
    clock = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0);

    const weight = weights[Math.floor(random() * weights.length)];
    const rate = 1150 + Math.floor(random() * 300);
    const amount = Math.max(150, Math.round((weight * rate) / 50) * 50);

    db.createSale({
      amount,
      weightKg: weight,
      note: notes[Math.floor(random() * notes.length)],
      requestId: `demo-${day.getFullYear()}${day.getMonth() + 1}${day.getDate()}-${i}-${Math.floor(
        random() * 100000
      )}`,
    });
    created += 1;
  }
}

console.log(`Seeded ${created} demo sales into ${dbPath}`);
console.log(JSON.stringify(db.getDashboard().today));
db.close();
