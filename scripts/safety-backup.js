'use strict';
// Create a timestamped, verified safety backup of the production database.
// This script never modifies production data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const appData = process.env.APPDATA;
const dbPath = path.join(appData, 'Joona Biryani', 'data', 'joona-biryani.sqlite');
const backupsDir = path.join(appData, 'Joona Biryani', 'backups');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const target = path.join(backupsDir, `pre-upgrade-safety-${stamp}.sqlite`);

if (!fs.existsSync(dbPath)) {
  console.error('Production database not found at', dbPath);
  process.exit(1);
}
fs.mkdirSync(backupsDir, { recursive: true });

const db = new DatabaseSync(dbPath);
const before = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(amount_pkr),0) total, COALESCE(SUM(weight_kg),0) kg FROM sales').get();
const rows = db.prepare('SELECT id, sale_number, amount_pkr, weight_kg, sale_date, sale_time FROM sales ORDER BY id').all();
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const verify = new DatabaseSync(target, { readOnly: true });
const integrity = verify.prepare('PRAGMA integrity_check').get();
const after = verify.prepare('SELECT COUNT(*) c, COALESCE(SUM(amount_pkr),0) total, COALESCE(SUM(weight_kg),0) kg FROM sales').get();
const afterRows = verify.prepare('SELECT id, sale_number, amount_pkr, weight_kg, sale_date, sale_time FROM sales ORDER BY id').all();
verify.close();

const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
const identical = JSON.stringify(rows) === JSON.stringify(afterRows);

const report = {
  source: dbPath,
  target,
  sourceBytes: fs.statSync(dbPath).size,
  backupBytes: fs.statSync(target).size,
  sha256: hash,
  integrity: Object.values(integrity)[0],
  before,
  after,
  rowValuesIdentical: identical,
  rows,
};
fs.writeFileSync(path.join(path.dirname(target), 'pre-upgrade-safety-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (Object.values(integrity)[0] !== 'ok' || !identical || before.c !== after.c || before.total !== after.total || before.kg !== after.kg) {
  console.error('SAFETY BACKUP VERIFICATION FAILED');
  process.exit(1);
}
