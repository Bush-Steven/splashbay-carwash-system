const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_PIN = process.env.ACCESS_PIN || '';

app.use(express.json({ limit: '5mb' }));

/* ============ AUTH ============ */
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, pinRequired: !!ACCESS_PIN });
});
function checkPin(req, res, next) {
  if (!ACCESS_PIN) return next();
  const supplied = req.header('x-access-pin');
  if (supplied && supplied === ACCESS_PIN) return next();
  return res.status(401).json({ error: 'Invalid or missing access PIN' });
}
app.use('/api', checkPin);

/* ============ ROW <-> API SHAPE HELPERS ============ */
function jobRowToApi(row) {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    receiptNo: row.receipt_no,
    customer: row.customer,
    phone: row.phone,
    plate: row.plate,
    model: row.model,
    service: { id: row.service_id, name: row.service_name, price: row.service_price },
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

/* ============ BOOTSTRAP (full snapshot, used on load + live polling) ============ */
function getFullState() {
  const staff = db.prepare('SELECT * FROM staff ORDER BY id').all().map(staffRowToApi);
  const services = db.prepare('SELECT * FROM services ORDER BY id').all().map(serviceRowToApi);
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY time_in').all().map(jobRowToApi);
  const business = db.prepare('SELECT * FROM business WHERE id = 1').get();
  const printSettings = db.prepare('SELECT * FROM print_settings WHERE id = 1').get();
  return {
    staff,
    services,
    jobs,
    business: { name: business.name, tagline: business.tagline, phone: business.phone, currency: business.currency },
    printSettings: { paperWidth: printSettings.paper_width },
  };
}
app.get('/api/bootstrap', (req, res) => {
  res.json(getFullState());
});

/* ============ STAFF ============ */
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

/* ============ SERVICES ============ */
app.post('/api/services', (req, res) => {
  const { name, price } = req.body || {};
  const p = Number(price);
  if (!name || !String(name).trim() || isNaN(p) || p < 0) {
    return res.status(400).json({ error: 'Valid name and price are required' });
  }
  const info = db.prepare('INSERT INTO services (name, price) VALUES (?, ?)').run(String(name).trim(), p);
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(info.lastInsertRowid);
  res.json(serviceRowToApi(row));
});
app.patch('/api/services/:id', (req, res) => {
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
app.delete('/api/services/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============ JOBS (registration / checkout / cancel) ============ */
app.post('/api/jobs', (req, res) => {
  const { customer, phone, plate, model, serviceId, staffId } = req.body || {};
  if (!customer || !plate || !serviceId || !staffId) {
    return res.status(400).json({ error: 'customer, plate, serviceId and staffId are required' });
  }
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(serviceId));
  if (!service) return res.status(400).json({ error: 'Unknown service' });
  const timeIn = Date.now();

  const insertJob = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO jobs (customer, phone, plate, model, service_id, service_name, service_price, staff_id, time_in, status, paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in-bay', 0)`
      )
      .run(
        String(customer).trim(),
        phone || '',
        String(plate).trim().toUpperCase(),
        model || '',
        service.id,
        service.name,
        service.price,
        Number(staffId),
        timeIn
      );
    const id = info.lastInsertRowid;
    const invoiceNo = 'INV-' + (1000 + id);
    db.prepare('UPDATE jobs SET invoice_no = ? WHERE id = ?').run(invoiceNo, id);
    return id;
  });

  const id = insertJob();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  res.json(jobRowToApi(row));
});

app.post('/api/jobs/:id/checkout', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  const { method } = req.body || {};
  const timeOut = Date.now();
  const receiptNo = 'RCT-' + (1000 + id);
  db.prepare(
    `UPDATE jobs SET time_out = ?, status = 'completed', paid = 1, method = ?, receipt_no = ? WHERE id = ?`
  ).run(timeOut, method || 'Cash', receiptNo, id);
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  res.json(jobRowToApi(row));
});

app.delete('/api/jobs/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============ BUSINESS & PRINT SETTINGS ============ */
app.put('/api/business', (req, res) => {
  const { name, tagline, phone, currency } = req.body || {};
  db.prepare('UPDATE business SET name = ?, tagline = ?, phone = ?, currency = ? WHERE id = 1').run(
    (name || 'SplashBay').trim(),
    tagline || '',
    phone || '',
    (currency || 'KSh').trim()
  );
  const row = db.prepare('SELECT * FROM business WHERE id = 1').get();
  res.json({ name: row.name, tagline: row.tagline, phone: row.phone, currency: row.currency });
});
app.put('/api/print-settings', (req, res) => {
  const { paperWidth } = req.body || {};
  db.prepare('UPDATE print_settings SET paper_width = ? WHERE id = 1').run(paperWidth || '80mm');
  const row = db.prepare('SELECT * FROM print_settings WHERE id = 1').get();
  res.json({ paperWidth: row.paper_width });
});

/* ============ BACKUP / RESTORE ============ */
app.get('/api/export', (req, res) => {
  res.json(getFullState());
});

app.post('/api/import', (req, res) => {
  const payload = req.body;
  if (!payload || !Array.isArray(payload.staff) || !Array.isArray(payload.jobs)) {
    return res.status(400).json({ error: 'Invalid backup payload' });
  }

  const importTxn = db.transaction(payload => {
    db.exec('DELETE FROM jobs; DELETE FROM staff; DELETE FROM services;');

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

    const insertJob = db.prepare(
      `INSERT INTO jobs (invoice_no, receipt_no, customer, phone, plate, model, service_id, service_name, service_price, staff_id, time_in, time_out, status, paid, method)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    (payload.jobs || []).forEach(j => {
      const mappedStaffId = j.staffId != null && staffIdMap[j.staffId] != null ? staffIdMap[j.staffId] : null;
      insertJob.run(
        j.invoiceNo || null,
        j.receiptNo || null,
        j.customer || '',
        j.phone || '',
        j.plate || '',
        j.model || '',
        (j.service && j.service.name) || '',
        (j.service && j.service.price) || 0,
        mappedStaffId,
        j.timeIn || Date.now(),
        j.timeOut || null,
        j.status || 'completed',
        j.paid ? 1 : 0,
        j.method || null
      );
    });

    const biz = payload.business || {};
    db.prepare('UPDATE business SET name = ?, tagline = ?, phone = ?, currency = ? WHERE id = 1').run(
      biz.name || 'SplashBay',
      biz.tagline || '',
      biz.phone || '',
      biz.currency || 'KSh'
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

app.post('/api/reset', (req, res) => {
  db.exec('DELETE FROM jobs; DELETE FROM staff; DELETE FROM services;');
  db.prepare(`UPDATE business SET name='SplashBay', tagline='Wash Bay Control', phone='', currency='KSh' WHERE id=1`).run();
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

app.post('/api/sample-data', (req, res) => {
  const now = Date.now();
  const insertStaff = db.prepare('INSERT INTO staff (name, role, phone, status) VALUES (?, ?, ?, ?)');
  const s1 = insertStaff.run('Brian Otieno', 'Washer', '0722 111 222', 'active').lastInsertRowid;
  const s2 = insertStaff.run('Faith Mwangi', 'Detailer', '0733 222 333', 'active').lastInsertRowid;
  insertStaff.run('Kevin Njoroge', 'Supervisor', '0711 444 555', 'off');

  const services = db.prepare('SELECT * FROM services ORDER BY id').all();
  const svcA = services[1] || services[0];
  const svcB = services[2] || services[0];

  const insertJob = db.prepare(
    `INSERT INTO jobs (invoice_no, receipt_no, customer, phone, plate, model, service_id, service_name, service_price, staff_id, time_in, time_out, status, paid, method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 1, ?)`
  );
  if (svcA) {
    const id1 = insertJob.run(
      null, null, 'Alice Chebet', '0700111222', 'KDA 245B', 'Toyota Axio, Silver',
      svcA.id, svcA.name, svcA.price, s1, now - 86400000, now - 86400000 + 3600000, 'Cash'
    ).lastInsertRowid;
    db.prepare('UPDATE jobs SET invoice_no=?, receipt_no=? WHERE id=?').run('INV-' + (1000+id1), 'RCT-' + (1000+id1), id1);
  }
  if (svcB) {
    const id2 = insertJob.run(
      null, null, 'Moses Kiptoo', '0700333444', 'KCB 998J', 'Subaru Forester, Blue',
      svcB.id, svcB.name, svcB.price, s2, now - 3600000 * 5, now - 3600000 * 4, 'M-Pesa'
    ).lastInsertRowid;
    db.prepare('UPDATE jobs SET invoice_no=?, receipt_no=? WHERE id=?').run('INV-' + (1000+id2), 'RCT-' + (1000+id2), id2);
  }
  res.json(getFullState());
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SplashBay server running at http://localhost:${PORT}`);
  console.log(`Database: ${path.join(__dirname, 'data', 'splashbay.db')}`);
  if (ACCESS_PIN) console.log('Access PIN protection is ENABLED.');
  else console.log('Access PIN protection is DISABLED (set ACCESS_PIN in .env to enable).');
});
