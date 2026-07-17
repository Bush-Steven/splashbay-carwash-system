# SplashBay — Carwash Operations System (Full Stack + SQLite)

A complete carwash management system with a real **Node/Express backend** backed by an **SQLite database**, and an interactive frontend. Every device that opens the app (front desk PC, tablet at the bay, phone) shares the same **live** data — one source of truth for staff, jobs, invoices, receipts, and revenue.

## Features
- **Dashboard** — today's revenue, cars in bay, cars washed today, staff on duty, 7-day revenue chart, service mix chart, live bay board, first-run onboarding
- **New Registration** — check a car in and auto-generate a printable invoice
- **Active Bay** — see all vehicles in progress, cancel a mistaken check-in, or check out with a payment method to generate a receipt
- **Staff** — add/remove attendants, track Today / This Week / This Month / All-Time revenue and sales per person, with a detailed drill-down view and chart
- **Invoices & Receipts** — full searchable history, reprintable any time, with delete for correcting mistakes
- **Revenue Reports** — all-time revenue, average ticket size, unpaid balance, 30-day trend, top staff by revenue
- **Settings** — business name/phone/currency (shown on every invoice & receipt), editable service catalog & prices, JSON backup export/import, CSV export for accounting, sample data loader, full reset
- **Receipt Printer** — configurable paper width (58mm / 80mm thermal, or A4), works with any printer already installed on the computer
- **Shared live data** — every open tab/device polls the server every few seconds, so a check-in on one terminal shows up on another automatically
- **Optional PIN lock** — protect the whole app with a shared access PIN

## Database
Data is stored in a real **SQLite database** (`data/splashbay.db`), managed with [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — no separate database server to install or run.

Schema (see `db.js`):
- `business` — single row: business name, tagline, phone, currency
- `print_settings` — single row: receipt paper width
- `staff` — id, name, role, phone, status
- `services` — id, name, price (your service catalog)
- `jobs` — id, invoice/receipt numbers, customer/vehicle details, a **snapshot** of the service name & price at the time of registration (so editing a price later never rewrites history), foreign keys to `staff` and `services` (`ON DELETE SET NULL`, so deleting a staff member or service keeps historical job records intact)

## Architecture
```
splashbay-app/
├── server.js         Express server: REST API + serves the frontend
├── db.js             SQLite schema, defaults, and the database connection
├── package.json
├── .env.example       copy to .env to configure PORT / ACCESS_PIN
├── data/
│   └── splashbay.db  the actual database file (auto-created on first run)
└── public/
    └── index.html     the entire frontend (HTML/CSS/JS, Chart.js bundled inline)
```

### API
| Method & Path | What it does |
|---|---|
| `GET /api/ping` | health check, tells the frontend if a PIN is required |
| `GET /api/bootstrap` | full snapshot: staff, services, jobs, business, print settings |
| `POST /api/staff` | add a staff member |
| `PATCH /api/staff/:id` | update staff status |
| `DELETE /api/staff/:id` | remove a staff member |
| `POST /api/services` | add a service |
| `PATCH /api/services/:id` | update a service's name/price |
| `DELETE /api/services/:id` | remove a service |
| `POST /api/jobs` | register (check in) a vehicle |
| `POST /api/jobs/:id/checkout` | complete + pay for a job |
| `DELETE /api/jobs/:id` | cancel/delete a job record |
| `PUT /api/business` | update business details |
| `PUT /api/print-settings` | update receipt paper width |
| `GET /api/export` / `POST /api/import` | full JSON backup / restore |
| `POST /api/reset` | wipe everything back to defaults |
| `POST /api/sample-data` | load example staff & jobs |

## Running locally
Requires [Node.js](https://nodejs.org) 16 or newer.

```bash
npm install
npm start
```

Then open **http://localhost:3000**. The database file is created automatically at `data/splashbay.db` on first run.

### Enabling the PIN lock (optional but recommended before deploying publicly)
```bash
cp .env.example .env
# edit .env and set ACCESS_PIN=yourpin
npm start
```
If `ACCESS_PIN` is left blank, the app opens with no login step at all.

## Deploying so your whole team can use it
Any standard Node hosting works.

**Render.com**
1. Push this project to GitHub (already done if you're reading this from the repo).
2. New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add an environment variable `ACCESS_PIN` if you want the lock screen.
5. Add a **persistent disk** mounted at the app's `data/` folder — otherwise `splashbay.db` may reset on redeploy on free tiers without a disk.

**Railway.app / Fly.io** — same idea: point it at this repo, `npm install` + `npm start`, attach a small persistent volume for the `data/` folder.

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
Even with a real database, back up regularly from **Settings**:
- **Export Backup (JSON)** — full system snapshot, re-importable any time (also handy for moving to a new server)
- **Export Records (CSV)** — for spreadsheets/accounting

You can also just copy the `data/splashbay.db` file directly — it's a complete, portable snapshot of everything.

## Tech
Express (Node.js), vanilla JS frontend, [Chart.js](https://www.chartjs.org/) (bundled inline, no CDN dependency), SQLite via `better-sqlite3`. No build step, no bundler, no separate database server to run.
