# SplashBay — Carwash Operations System (Full Stack + SQLite)

A complete carwash management system with a real **Node/Express backend** backed by an **SQLite database**, and an interactive frontend. Every device that opens the app (front desk PC, tablet at the bay, phone) shares the same **live** data — one source of truth for staff, jobs, invoices, receipts, and revenue.

## Features
- **Dashboard** — today's revenue, cars in bay, cars washed today, staff on duty, 7-day revenue chart, service mix chart, live bay board, first-run onboarding
- **New Registration** — check a car in and auto-generate a printable invoice
- **Active Bay** — see all vehicles in progress, cancel a mistaken check-in, or check out with a payment method to generate a receipt
- **Staff** — add/remove attendants, track Today / This Week / This Month / All-Time revenue and sales per person, with a detailed drill-down view and chart
- **Invoices & Receipts** — full searchable history, reprintable any time, with delete for correcting mistakes
- **Revenue Reports** — all-time revenue, total expenses, net profit, average ticket size, unpaid balance, 30-day trend, top staff by revenue
- **Expenses** — log business costs by category (supplies, utilities, wages, rent, etc.), with Today/Week/Month/All-Time totals, a category breakdown chart, and full history (admin only)
- **Settings** — business name/phone/currency (shown on every invoice & receipt), editable service catalog & prices, JSON backup export/import, CSV export for accounting, sample data loader, full reset
- **Receipt Printer** — configurable paper width (58mm / 80mm thermal, or A4), works with any printer already installed on the computer
- **Shared live data** — every open tab/device polls the server every few seconds, so a check-in on one terminal shows up on another automatically
- **Two login roles — Staff & Admin** — separate PINs with different access. Staff can operate the Dashboard, New Registration, Active Bay, and Invoices & Receipts. Admin gets all of that plus Staff management, Revenue Reports, and Settings. Managed entirely from Settings → Access & Roles, no redeploy needed.

## Database
Data is stored in a real **SQLite database** (`data/splashbay.db`), managed with [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — no separate database server to install or run.

Schema (see `db.js`):
- `business` — single row: business name, tagline, phone, currency
- `print_settings` — single row: receipt paper width
- `staff` — id, name, role, phone, status
- `services` — id, name, price (your service catalog)
- `jobs` — id, invoice/receipt numbers, customer/vehicle details, a **snapshot** of the service name & price at the time of registration (so editing a price later never rewrites history), foreign keys to `staff` and `services` (`ON DELETE SET NULL`, so deleting a staff member or service keeps historical job records intact)
- `expenses` — id, date, category, description, amount

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
| `POST /api/expenses` / `PATCH /api/expenses/:id` / `DELETE /api/expenses/:id` | (admin only) log, edit, or remove a business expense |
| `PUT /api/business` | update business details |
| `PUT /api/print-settings` | update receipt paper width |
| `GET /api/auth-settings` / `PUT /api/auth-settings` | (admin only) view/set the Staff & Admin PINs |
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

### Setting up Staff & Admin logins (recommended before deploying publicly)
Open the app, go to **Settings → Access & Roles**, and set an Admin PIN (and optionally a Staff PIN). That's it — no environment variables or redeploy needed. Rules:
- Leave both blank → the app is fully open, no login screen (good for local/dev use).
- Set only an **Admin PIN** → everyone who knows it gets full access (like the old single-PIN mode).
- Set both → people choose **Staff** or **Admin** on the login screen. Staff PIN unlocks Dashboard, New Registration, Active Bay, and Invoices & Receipts. Admin PIN unlocks everything, including Staff management, Revenue Reports, and Settings.
- You can't set a Staff PIN without an Admin PIN first — that's a safety guard so you can never lock yourself out of Settings.

For convenience, the legacy `ACCESS_PIN` environment variable (from earlier versions) still works as a fallback Admin PIN until you set one in Settings.

## Deploying so your whole team can use it
Any standard Node hosting works.

**Render.com**
1. Push this project to GitHub (already done if you're reading this from the repo).
2. New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. PINs are set from inside the app (Settings → Access & Roles) once it's running — no environment variable needed.
5. Add a **persistent disk** mounted at the app's `data/` folder — otherwise `splashbay.db` may reset on redeploy on free tiers without a disk.

**Railway.app / Fly.io** — same idea: point it at this repo, `npm install` + `npm start`, attach a small persistent volume for the `data/` folder.

**Your own VPS**
```bash
git clone <your repo url>
cd splashbay-carwash-system
npm install
npm install -g pm2
pm2 start server.js --name splashbay
```
Then set your PINs from Settings → Access & Roles once it's up.

⚠️ Wherever you deploy, make sure the `data/` folder is on **persistent storage** (not a container's ephemeral filesystem) or your business data will vanish on every redeploy/restart.

## Backups
Even with a real database, back up regularly from **Settings**:
- **Export Backup (JSON)** — full system snapshot, re-importable any time (also handy for moving to a new server)
- **Export Records (CSV)** — for spreadsheets/accounting

You can also just copy the `data/splashbay.db` file directly — it's a complete, portable snapshot of everything.

## Tech
Express (Node.js), vanilla JS frontend, [Chart.js](https://www.chartjs.org/) (bundled inline, no CDN dependency), SQLite via `better-sqlite3`. No build step, no bundler, no separate database server to run.
