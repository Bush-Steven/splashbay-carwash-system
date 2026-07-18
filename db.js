const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'splashbay.db');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS business (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'OshaRide',
  tagline TEXT DEFAULT 'Wash Bay Control',
  phone TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'KSh',
  logo TEXT
);

CREATE TABLE IF NOT EXISTS print_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paper_width TEXT NOT NULL DEFAULT '80mm'
);

CREATE TABLE IF NOT EXISTS auth_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_pin TEXT,
  staff_pin TEXT
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Washer',
  phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT,
  receipt_no TEXT,
  customer TEXT NOT NULL,
  phone TEXT DEFAULT '',
  plate TEXT NOT NULL,
  model TEXT DEFAULT '',
  service_id INTEGER,
  service_name TEXT NOT NULL,
  service_price REAL NOT NULL,
  services_json TEXT,
  staff_id INTEGER,
  time_in INTEGER NOT NULL,
  time_out INTEGER,
  status TEXT NOT NULL DEFAULT 'in-bay',
  paid INTEGER NOT NULL DEFAULT 0,
  method TEXT,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_staff ON jobs(staff_id);
CREATE INDEX IF NOT EXISTS idx_jobs_time_out ON jobs(time_out);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  description TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
`);

/* ---- migrations for databases created before a column existed ---- */
const businessColumns = db.prepare(`PRAGMA table_info(business)`).all().map(c => c.name);
if (!businessColumns.includes('logo')) {
  db.exec(`ALTER TABLE business ADD COLUMN logo TEXT`);
}
// One-time rename: if an existing install still has the old default name
// (meaning the owner never customized it), update it to the new default.
const existingBiz = db.prepare('SELECT name FROM business WHERE id = 1').get();
if (existingBiz && existingBiz.name === 'SplashBay') {
  db.prepare(`UPDATE business SET name = 'OshaRide' WHERE id = 1`).run();
}
const jobsColumns = db.prepare(`PRAGMA table_info(jobs)`).all().map(c => c.name);
if (!jobsColumns.includes('services_json')) {
  db.exec(`ALTER TABLE jobs ADD COLUMN services_json TEXT`);
}

/* ---- seed sensible defaults on a brand-new database ---- */
const DEFAULT_SERVICES = [
  { name: 'Express Exterior Wash', price: 400 },
  { name: 'Full Wash (Ext + Int)', price: 700 },
  { name: 'Premium Detail + Wax', price: 1500 },
  { name: 'Engine Bay Clean', price: 600 },
  { name: 'Interior Deep Clean', price: 900 },
  { name: 'SUV / Van Full Wash', price: 900 },
];

if (!db.prepare('SELECT id FROM business WHERE id = 1').get()) {
  db.prepare(
    `INSERT INTO business (id, name, tagline, phone, currency) VALUES (1, 'OshaRide', 'Wash Bay Control', '', 'KSh')`
  ).run();
}
if (!db.prepare('SELECT id FROM print_settings WHERE id = 1').get()) {
  db.prepare(`INSERT INTO print_settings (id, paper_width) VALUES (1, '80mm')`).run();
}
if (!db.prepare('SELECT id FROM auth_settings WHERE id = 1').get()) {
  db.prepare(`INSERT INTO auth_settings (id, admin_pin, staff_pin) VALUES (1, NULL, NULL)`).run();
}
if (db.prepare('SELECT COUNT(*) c FROM services').get().c === 0) {
  const insert = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)');
  DEFAULT_SERVICES.forEach(s => insert.run(s.name, s.price));
}

module.exports = db;
