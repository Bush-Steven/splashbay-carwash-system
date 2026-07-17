const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const ACCESS_PIN = process.env.ACCESS_PIN || '';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_SERVICES = [
  { id: 1, name: 'Express Exterior Wash', price: 400 },
  { id: 2, name: 'Full Wash (Ext + Int)', price: 700 },
  { id: 3, name: 'Premium Detail + Wax', price: 1500 },
  { id: 4, name: 'Engine Bay Clean', price: 600 },
  { id: 5, name: 'Interior Deep Clean', price: 900 },
  { id: 6, name: 'SUV / Van Full Wash', price: 900 },
];
const DEFAULT_BUSINESS = { name: 'SplashBay', tagline: 'Wash Bay Control', phone: '', currency: 'KSh' };

function freshState() {
  return {
    staff: [],
    jobs: [],
    services: DEFAULT_SERVICES.map(s => ({ ...s })),
    business: { ...DEFAULT_BUSINESS },
    seq: 1000,
  };
}

function readState() {
  if (!fs.existsSync(DATA_FILE)) {
    const fresh = freshState();
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Could not parse state.json, starting fresh:', e.message);
    return freshState();
  }
}

// Serialize writes so two rapid saves can't corrupt the file
let writeQueue = Promise.resolve();
function writeState(state) {
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        const tmp = DATA_FILE + '.tmp';
        fs.writeFile(tmp, JSON.stringify(state, null, 2), err => {
          if (err) return reject(err);
          fs.rename(tmp, DATA_FILE, err2 => (err2 ? reject(err2) : resolve()));
        });
      })
  );
  return writeQueue;
}

app.use(express.json({ limit: '5mb' }));

// Health check + tells the frontend whether it needs to show the PIN lock screen
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, pinRequired: !!ACCESS_PIN });
});

function checkPin(req, res, next) {
  if (!ACCESS_PIN) return next();
  const supplied = req.header('x-access-pin');
  if (supplied && supplied === ACCESS_PIN) return next();
  return res.status(401).json({ error: 'Invalid or missing access PIN' });
}

app.get('/api/state', checkPin, (req, res) => {
  res.json(readState());
});

app.put('/api/state', checkPin, async (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.staff) || !Array.isArray(incoming.jobs)) {
    return res.status(400).json({ error: 'Invalid state payload' });
  }
  try {
    await writeState(incoming);
    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to save state:', e);
    res.status(500).json({ error: 'Failed to save state' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback for any other route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SplashBay server running at http://localhost:${PORT}`);
  if (ACCESS_PIN) console.log('Access PIN protection is ENABLED.');
  else console.log('Access PIN protection is DISABLED (set ACCESS_PIN in .env to enable).');
});
