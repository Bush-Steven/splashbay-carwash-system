const express = require('express');
const path = require('path');
const db = require('./db');

// Safety net: log unexpected errors instead of letting one bad request take the
// whole server down for every device connected to it.
process.on('uncaughtException', err => console.error('Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

const app = express();
const PORT = process.env.PORT || 3000;
// Legacy env-var fallback: if no Admin PIN has been set in the app yet (Settings > Access & Roles),
// but ACCESS_PIN is set in the environment, honor it as the admin PIN until one is configured in-app.
const LEGACY_ADMIN_PIN = process.env.ACCESS_PIN || '';

app.use(express.json({ limit: '5mb' }));

/* ============ AUTH ============
   PINs live in the database (auth_settings table) so the business owner can manage
   them from Settings > Access & Roles without redeploying. Two roles:
   - "admin": full access — staff management, revenue reports, settings, backups
   - "staff": operational only — dashboard, registration, active bay, invoices/receipts
   If no PINs are configured at all, the app is open with full (admin) access — the same
   zero-config behavior as before. */
function getAuthSettings() {
  const row = db.prepare('SELECT * FROM auth_settings WHERE id = 1').get();
  const adminPin = (row && row.admin_pin) || LEGACY_ADMIN_PIN || '';
  const staffPin = (row && row.staff_pin) || '';
  return { adminPin, staffPin };
}

app.get('/api/ping', (req, res) => {
  const { adminPin, staffPin } = getAuthSettings();
  res.json({ ok: true, pinRequired: !!(adminPin || staffPin), staffLoginEnabled: !!staffPin });
});

function roleForPin(pin) {
  const { adminPin, staffPin } = getAuthSettings();
  if (adminPin && pin === adminPin) return 'admin';
  if (staffPin && pin === staffPin) return 'staff';
  return null;
}

function checkPin(req, res, next) {
  const { adminPin, staffPin } = getAuthSettings();
  if (!adminPin && !staffPin) {
    req.role = 'admin';
    return next();
  }
  const supplied = req.header('x-access-pin');
  const role = roleForPin(supplied);
  if (!role) return res.status(401).json({ error: 'Invalid or missing access PIN' });
  req.role = role;
  next();
}
function requireAdmin(req, res, next) {
  if (req.role !== 'admin') return res.status(403).json({ error: 'This action requires Admin access' });
  next();
}
app.use('/api', checkPin);

/* ============ ROW <-> API SHAPE HELPERS ============ */
function jobRowToApi(row) {
  let services;
  if (row.services_json) {
    try { services = JSON.parse(row.services_json); } catch (e) { services = null; }
  }
  if (!services || !services.length) {
    // backward compatibility for jobs recorded before multi-service support
    services = [{ id: row.service_id, name: row.service_name, price: row.service_price }];
  }
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    receiptNo: row.receipt_no,
    customer: row.customer,
    phone: row.phone,
    plate: row.plate,
    model: row.model,
    service: { id: row.service_id, name: row.service_name, price: row.service_price },
    services,
    staffId: row.staff_id,
    timeIn: row.time_in,
    timeOut: row.time_out,
    status: row.status,
    paid: !!row.paid,
    method: row.method,
  };
}
function staffRowToApi(row) {
  return { id: row.id, name: row.name, role: row.role, phone: row.phone, status: row.status };
}
function serviceRowToApi(row) {
  return { id: row.id, name: row.name, price: row.price };
}
function expenseRowToApi(row) {
  return { id: row.id, date: row.date, category: row.category, description: row.description, amount: row.amount };
}

/* ============ BOOTSTRAP (full snapshot, used on load + live polling) ============ */
function getFullState() {
  const staff = db.prepare('SELECT * FROM staff ORDER BY id').all().map(staffRowToApi);
  const services = db.prepare('SELECT * FROM services ORDER BY id').all().map(serviceRowToApi);
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY time_in').all().map(jobRowToApi);
  const expenses = db.prepare('SELECT * FROM expenses ORDER BY date').all().map(expenseRowToApi);
  const business = db.prepare('SELECT * FROM business WHERE id = 1').get();
  const printSettings = db.prepare('SELECT * FROM print_settings WHERE id = 1').get();
  return {
    staff,
    services,
    jobs,
    expenses,
    business: { name: business.name, tagline: business.tagline, phone: business.phone, currency: business.currency, logo: business.logo || null },
    printSettings: { paperWidth: printSettings.paper_width },
  };
}
app.get('/api/bootstrap', (req, res) => {
  res.json({ ...getFullState(), role: req.role });
});

/* ============ STAFF (staff & admin) ============ */
app.post('/api/staff', (req, res) => {
  const { name, role, phone } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const info = db
    .prepare('INSERT INTO staff (name, role, phone, status) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), role || 'Washer', phone || '', 'active');
  const row = db.prepare('SELECT * FROM staff WHERE id = ?').get(info.lastInsertRowid);
  res.json(staffRowToApi(row));
});
app.patch('/api/staff/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Staff not found' });
  const { status } = req.body || {};
  if (status) db.prepare('UPDATE staff SET status = ? WHERE id = ?').run(status, id);
  const row = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  res.json(staffRowToApi(row));
});
app.delete('/api/staff/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM staff WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============ SERVICES (admin only — pricing changes) ============ */
app.post('/api/services', requireAdmin, (req, res) => {
  const { name, price } = req.body || {};
  const p = Number(price);
  if (!name || !String(name).trim() || isNaN(p) || p < 0) {
    return res.status(400).json({ error: 'Valid name and price are required' });
  }
  const info = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)').run(String(name).trim(), p);
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(info.lastInsertRowid);
  res.json(serviceRowToApi(row));
});
app.patch('/api/services/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });
  const { name, price } = req.body || {};
  if (name && String(name).trim()) db.prepare('UPDATE services SET name = ? WHERE id = ?').run(String(name).trim(), id);
  if (price !== undefined) {
    const p = Number(price);
    if (!isNaN(p) && p >= 0) db.prepare('UPDATE services SET price = ? WHERE id = ?').run(p, id);
  }
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  res.json(serviceRowToApi(row));
});
app.delete('/api/services/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============ JOBS (registration / checkout / cancel) ============ */
app.post('/api/jobs', (req, res) => {
  const { customer, phone, plate, model, staffId } = req.body || {};
  // Accept either a new multi-service `serviceIds` array or the legacy single `serviceId`.
  let serviceIds = req.body && req.body.serviceIds;
  if ((!serviceIds || !serviceIds.length) && req.body && req.body.serviceId) {
    serviceIds = [req.body.serviceId];
  }
  if (!customer || !plate || !serviceIds || !serviceIds.length || !staffId) {
    return res.status(400).json({ error: 'customer, plate, at least one service, and staffId are required' });
  }
  const staffRow = db.prepare('SELECT id FROM staff WHERE id = ?').get(Number(staffId));
  if (!staffRow) return res.status(400).json({ error: 'Unknown staff member — they may have been removed. Please pick another.' });

  const placeholders = serviceIds.map(() => '?').join(',');
  const services = db.prepare(`SELECT * FROM services WHERE id IN (${placeholders})`).all(...serviceIds.map(Number));
  if (!services.length) return res.status(400).json({ error: 'Unknown service(s)' });

  const itemized = services.map(s => ({ id: s.id, name: s.name, price: s.price }));
  const totalPrice = itemized.reduce((sum, s) => sum + s.price, 0);
  const combinedName = itemized.map(s => s.name).join(' + ');
  const timeIn = Date.now();

  try {
    const insertJob = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO jobs (customer, phone, plate, model, service_id, service_name, service_price, services_json, staff_id, time_in, status, paid)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in-bay', 0)`
        )
        .run(
          String(customer).trim(),
          phone || '',
          String(plate).trim().toUpperCase(),
          model || '',
          itemized[0].id,
          combinedName,
          totalPrice,
          JSON.stringify(itemized),
          Number(staffId),
          timeIn
        );
      const id = info.lastInsertRowid;
      const invoiceNo = 'ORD-' + (1000 + id);
      db.prepare('UPDATE jobs SET invoice_no = ? WHERE id = ?').run(invoiceNo, id);
      return id;
    });

    const id = insertJob();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    res.json(jobRowToApi(row));
  } catch (e) {
    console.error('Failed to register job:', e);
    res.status(500).json({ error: 'Could not register the vehicle. Please try again.' });
  }
});

app.post('/api/jobs/:id/checkout', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  const { method } = req.body || {};
  const timeOut = Date.now();
  const receiptNo = 'ORD-' + (1000 + id);
  db.prepare(
    `UPDATE jobs SET time_out = ?, status = 'completed', paid = 1, method = ?, receipt_no = ? WHERE id = ?`
  ).run(timeOut, method || 'Cash', receiptNo, id);
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  res.json(jobRowToApi(row));
});

app.delete('/api/jobs/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  // Staff can cancel a mistaken in-bay check-in, but once a job is completed
  // (meaning an invoice/receipt has been issued), only Admin can delete that record.
  if (existing.status === 'completed' && req.role !== 'admin') {
    return res.status(403).json({ error: 'Only Admin can delete a completed invoice/receipt record.' });
  }
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============ EXPENSES (staff & admin) ============ */
app.post('/api/expenses', (req, res) => {
  const { date, category, description, amount } = req.body || {};
  const amt = Number(amount);
  if (isNaN(amt) || amt < 0) return res.status(400).json({ error: 'A valid amount is required' });
  const ts = date ? Number(date) : Date.now();
  const info = db
    .prepare('INSERT INTO expenses (date, category, description, amount, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ts, (category || 'Other').trim(), (description || '').trim(), amt, Date.now());
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
  res.json(expenseRowToApi(row));
});
app.patch('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });
  const { date, category, description, amount } = req.body || {};
  if (date !== undefined) db.prepare('UPDATE expenses SET date = ? WHERE id = ?').run(Number(date), id);
  if (category !== undefined) db.prepare('UPDATE expenses SET category = ? WHERE id = ?').run(String(category).trim() || 'Other', id);
  if (description !== undefined) db.prepare('UPDATE expenses SET description = ? WHERE id = ?').run(String(description).trim(), id);
  if (amount !== undefined) {
    const amt = Number(amount);
    if (!isNaN(amt) && amt >= 0) db.prepare('UPDATE expenses SET amount = ? WHERE id = ?').run(amt, id);
  }
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  res.json(expenseRowToApi(row));
});
app.delete('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============ BUSINESS & PRINT SETTINGS ============ */
app.put('/api/business', requireAdmin, (req, res) => {
  const { name, tagline, phone, currency } = req.body || {};
  db.prepare('UPDATE business SET name = ?, tagline = ?, phone = ?, currency = ? WHERE id = 1').run(
    (name || 'OshaRide').trim(),
    tagline || '',
    phone || '',
    (currency || 'KSh').trim()
  );
  const row = db.prepare('SELECT * FROM business WHERE id = 1').get();
  res.json({ name: row.name, tagline: row.tagline, phone: row.phone, currency: row.currency, logo: row.logo || null });
});
app.put('/api/business/logo', requireAdmin, (req, res) => {
  const { logo } = req.body || {};
  if (!logo || typeof logo !== 'string' || !logo.startsWith('data:image/')) {
    return res.status(400).json({ error: 'A valid image data URL is required' });
  }
  if (logo.length > 3_000_000) {
    return res.status(400).json({ error: 'Logo image is too large' });
  }
  db.prepare('UPDATE business SET logo = ? WHERE id = 1').run(logo);
  const row = db.prepare('SELECT * FROM business WHERE id = 1').get();
  res.json({ name: row.name, tagline: row.tagline, phone: row.phone, currency: row.currency, logo: row.logo || null });
});
app.delete('/api/business/logo', requireAdmin, (req, res) => {
  db.prepare('UPDATE business SET logo = NULL WHERE id = 1').run();
  const row = db.prepare('SELECT * FROM business WHERE id = 1').get();
  res.json({ name: row.name, tagline: row.tagline, phone: row.phone, currency: row.currency, logo: null });
});

app.put('/api/print-settings', requireAdmin, (req, res) => {
  const { paperWidth } = req.body || {};
  db.prepare('UPDATE print_settings SET paper_width = ? WHERE id = 1').run(paperWidth || '80mm');
  const row = db.prepare('SELECT * FROM print_settings WHERE id = 1').get();
  res.json({ paperWidth: row.paper_width });
});

/* ============ BACKUP / RESTORE ============ */
app.get('/api/export', requireAdmin, (req, res) => {
  res.json(getFullState());
});

app.post('/api/import', requireAdmin, (req, res) => {
  const payload = req.body;
  if (!payload || !Array.isArray(payload.staff) || !Array.isArray(payload.jobs)) {
    return res.status(400).json({ error: 'Invalid backup payload' });
  }

  const importTxn = db.transaction(payload => {
    db.exec('DELETE FROM jobs; DELETE FROM staff; DELETE FROM services; DELETE FROM expenses;');

    const staffIdMap = {};
    const insertStaff = db.prepare('INSERT INTO staff (name, role, phone, status) VALUES (?, ?, ?, ?)');
    (payload.staff || []).forEach(s => {
      const info = insertStaff.run(s.name || '', s.role || 'Washer', s.phone || '', s.status || 'active');
      staffIdMap[s.id] = info.lastInsertRowid;
    });

    const insertService = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)');
    (payload.services || []).forEach(s => {
      insertService.run(s.name || '', Number(s.price) || 0);
    });

    const insertExpense = db.prepare('INSERT INTO expenses (date, category, description, amount, created_at) VALUES (?, ?, ?, ?, ?)');
    (payload.expenses || []).forEach(x => {
      insertExpense.run(x.date || Date.now(), x.category || 'Other', x.description || '', Number(x.amount) || 0, Date.now());
    });

    const insertJob = db.prepare(
      `INSERT INTO jobs (invoice_no, receipt_no, customer, phone, plate, model, service_id, service_name, service_price, services_json, staff_id, time_in, time_out, status, paid, method)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    (payload.jobs || []).forEach(j => {
      const mappedStaffId = j.staffId != null && staffIdMap[j.staffId] != null ? staffIdMap[j.staffId] : null;
      const itemized = (j.services && j.services.length) ? j.services : (j.service ? [j.service] : []);
      const totalPrice = itemized.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
      const combinedName = itemized.map(s => s.name).join(' + ') || (j.service && j.service.name) || '';
      insertJob.run(
        j.invoiceNo || null,
        j.receiptNo || null,
        j.customer || '',
        j.phone || '',
        j.plate || '',
        j.model || '',
        combinedName,
        totalPrice || (j.service && j.service.price) || 0,
        JSON.stringify(itemized),
        mappedStaffId,
        j.timeIn || Date.now(),
        j.timeOut || null,
        j.status || 'completed',
        j.paid ? 1 : 0,
        j.method || null
      );
    });

    const biz = payload.business || {};
    db.prepare('UPDATE business SET name = ?, tagline = ?, phone = ?, currency = ?, logo = ? WHERE id = 1').run(
      biz.name || 'OshaRide',
      biz.tagline || '',
      biz.phone || '',
      biz.currency || 'KSh',
      biz.logo || null
    );
    const ps = payload.printSettings || {};
    db.prepare('UPDATE print_settings SET paper_width = ? WHERE id = 1').run(ps.paperWidth || '80mm');
  });

  try {
    importTxn(payload);
    res.json(getFullState());
  } catch (e) {
    console.error('Import failed:', e);
    res.status(500).json({ error: 'Import failed' });
  }
});

app.post('/api/reset', requireAdmin, (req, res) => {
  db.exec('DELETE FROM jobs; DELETE FROM staff; DELETE FROM services; DELETE FROM expenses;');
  db.prepare(`UPDATE business SET name='OshaRide', tagline='Wash Bay Control', phone='', currency='KSh', logo=NULL WHERE id=1`).run();
  db.prepare(`UPDATE print_settings SET paper_width='80mm' WHERE id=1`).run();
  const DEFAULT_SERVICES = [
    { name: 'Express Exterior Wash', price: 400 },
    { name: 'Full Wash (Ext + Int)', price: 700 },
    { name: 'Premium Detail + Wax', price: 1500 },
    { name: 'Engine Bay Clean', price: 600 },
    { name: 'Interior Deep Clean', price: 900 },
    { name: 'SUV / Van Full Wash', price: 900 },
  ];
  const insert = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)');
  DEFAULT_SERVICES.forEach(s => insert.run(s.name, s.price));
  res.json(getFullState());
});

app.post('/api/sample-data', requireAdmin, (req, res) => {
  const now = Date.now();
  const insertStaff = db.prepare('INSERT INTO staff (name, role, phone, status) VALUES (?, ?, ?, ?)');
  const s1 = insertStaff.run('Brian Otieno', 'Washer', '0722 111 222', 'active').lastInsertRowid;
  const s2 = insertStaff.run('Faith Mwangi', 'Detailer', '0733 222 333', 'active').lastInsertRowid;
  insertStaff.run('Kevin Njoroge', 'Supervisor', '0711 444 555', 'off');

  const services = db.prepare('SELECT * FROM services ORDER BY id').all();
  const svcA = services[1] || services[0];
  const svcB = services[2] || services[0];

  const insertJob = db.prepare(
    `INSERT INTO jobs (invoice_no, receipt_no, customer, phone, plate, model, service_id, service_name, service_price, services_json, staff_id, time_in, time_out, status, paid, method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 1, ?)`
  );
  if (svcA) {
    const id1 = insertJob.run(
      null, null, 'Alice Chebet', '0700111222', 'KDA 245B', 'Toyota Axio, Silver',
      svcA.id, svcA.name, svcA.price, JSON.stringify([{id:svcA.id,name:svcA.name,price:svcA.price}]), s1, now - 86400000, now - 86400000 + 3600000, 'Cash'
    ).lastInsertRowid;
    db.prepare('UPDATE jobs SET invoice_no=?, receipt_no=? WHERE id=?').run('ORD-' + (1000+id1), 'ORD-' + (1000+id1), id1);
  }
  if (svcB) {
    const id2 = insertJob.run(
      null, null, 'Moses Kiptoo', '0700333444', 'KCB 998J', 'Subaru Forester, Blue',
      svcB.id, svcB.name, svcB.price, JSON.stringify([{id:svcB.id,name:svcB.name,price:svcB.price}]), s2, now - 3600000 * 5, now - 3600000 * 4, 'M-Pesa'
    ).lastInsertRowid;
    db.prepare('UPDATE jobs SET invoice_no=?, receipt_no=? WHERE id=?').run('ORD-' + (1000+id2), 'ORD-' + (1000+id2), id2);
  }
  res.json(getFullState());
});

/* ============ ACCESS & ROLES (admin only) ============ */
app.get('/api/auth-settings', requireAdmin, (req, res) => {
  const { adminPin, staffPin } = getAuthSettings();
  res.json({ adminPinSet: !!adminPin, staffPinSet: !!staffPin });
});
app.put('/api/auth-settings', requireAdmin, (req, res) => {
  const { adminPin, staffPin, clearAdminPin, clearStaffPin } = req.body || {};
  const current = getAuthSettings();

  let newAdminPin = current.adminPin;
  if (clearAdminPin) newAdminPin = '';
  else if (typeof adminPin === 'string' && adminPin.trim()) newAdminPin = adminPin.trim();

  let newStaffPin = current.staffPin;
  if (clearStaffPin) newStaffPin = '';
  else if (typeof staffPin === 'string' && staffPin.trim()) newStaffPin = staffPin.trim();

  // Guard against locking the admin out: a staff PIN can't exist without an admin PIN.
  if (newStaffPin && !newAdminPin) {
    return res.status(400).json({ error: 'Set an Admin PIN before enabling a Staff PIN, so you can\'t be locked out.' });
  }
  if (newAdminPin && newStaffPin && newAdminPin === newStaffPin) {
    return res.status(400).json({ error: 'Admin PIN and Staff PIN must be different.' });
  }

  db.prepare('UPDATE auth_settings SET admin_pin = ?, staff_pin = ? WHERE id = 1').run(
    newAdminPin || null,
    newStaffPin || null
  );
  res.json({ adminPinSet: !!newAdminPin, staffPinSet: !!newStaffPin });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`OshaRide server running at http://localhost:${PORT}`);
  console.log(`Database: ${path.join(__dirname, 'data', 'splashbay.db')}`);
  const { adminPin, staffPin } = getAuthSettings();
  if (adminPin || staffPin) console.log('PIN login is ENABLED (configure via Settings > Access & Roles).');
  else console.log('PIN login is DISABLED — open access. Set PINs in Settings > Access & Roles to enable.');
});
