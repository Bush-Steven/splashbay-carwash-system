# SplashBay — Carwash Operations System (Full Stack)

A complete carwash management system with a real **Node/Express backend** and an interactive frontend. Every device that opens the app (front desk PC, tablet at the bay, phone) shares the same **live** data — one source of truth for staff, jobs, invoices, receipts, and revenue.

## Features
- **Dashboard** — today's revenue, cars in bay, cars washed today, staff on duty, 7-day revenue chart, service mix chart, live bay board, first-run onboarding
- **New Registration** — check a car in and auto-generate a printable invoice
- **Active Bay** — see all vehicles in progress, cancel a mistaken check-in, or check out with a payment method to generate a receipt
- **Staff** — add/remove attendants, track Today / This Week / This Month / All-Time revenue and sales per person, with a detailed drill-down view and chart
- **Invoices & Receipts** — full searchable history, reprintable any time, with delete for correcting mistakes
- **Revenue Reports** — all-time revenue, average ticket size, unpaid balance, 30-day trend, top staff by revenue
- **Settings** — business name/phone/currency (shown on every invoice & receipt), editable service catalog & prices, JSON backup export/import, CSV export for accounting, sample data loader, full reset
- **Shared live data** — every open tab/device polls the server every few seconds, so a check-in on one terminal shows up on another automatically
- **Optional PIN lock** — protect the whole app with a shared access PIN so it's not wide open to the internet

## Architecture
```
splashbay-app/
├── server.js         Express server: serves the frontend + a small JSON REST API
├── package.json
├── .env.example      copy to .env to configure PORT / ACCESS_PIN
├── data/
│   └── state.json    all business data lives here (auto-created on first run)
└── public/
    └── index.html    the entire frontend (HTML/CSS/JS, Chart.js from CDN)
```

The API is intentionally tiny:
- `GET /api/ping` — health check, tells the frontend if a PIN is required
- `GET /api/state` — returns the full business state (staff, jobs, services, business settings)
- `PUT /api/state` — saves the full business state

The frontend keeps all of its existing logic (rendering, revenue math, invoice/receipt generation) and just persists through this API instead of browser-only storage — so the data is centralized on the server rather than trapped on one device.

## Running locally
Requires [Node.js](https://nodejs.org) 16 or newer.

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

### Enabling the PIN lock (optional but recommended before deploying publicly)
```bash
cp .env.example .env
# edit .env and set ACCESS_PIN=yourpin
npm start
```
If `ACCESS_PIN` is left blank, the app opens with no login step at all — fine for a private/local network, not recommended for the open internet.

## Deploying so your whole team can use it
Any standard Node hosting works. A few easy, mostly-free options:

**Render.com**
1. Push this project to GitHub (already done if you're reading this from the repo).
2. New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add an environment variable `ACCESS_PIN` if you want the lock screen.
5. Add a **persistent disk** mounted at `/data` (Render's free tier disks reset on redeploy otherwise) — or just be aware that on free tiers without a disk, `data/state.json` may reset when the service restarts.

**Railway.app / Fly.io**
Same idea: point it at this repo, `npm install` + `npm start`, attach a small persistent volume for the `data/` folder.

**Your own VPS**
```bash
git clone <your repo url>
cd splashbay-carwash-system
npm install
cp .env.example .env   # set ACCESS_PIN
npm install -g pm2
pm2 start server.js --name splashbay
```

⚠️ Wherever you deploy, make sure the `data/` folder is on **persistent storage** (not a container's ephemeral filesystem) or your business data will vanish on every redeploy/restart.

## Backups
Even with a real backend, back up regularly from **Settings**:
- **Export Backup (JSON)** — full system snapshot, re-importable any time
- **Export Records (CSV)** — for spreadsheets/accounting

## Tech
Express (Node.js), vanilla JS frontend, [Chart.js](https://www.chartjs.org/) for charts, JSON-file storage (no database server to manage). No build step, no bundler.
