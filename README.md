# SplashBay — Carwash Operations System

A complete, self-contained carwash management system: staff management, vehicle check-in/out, invoice & receipt generation, and revenue reporting. Runs entirely in the browser — no server, database, or install required.

## Features
- **Dashboard** — today's revenue, cars in bay, cars washed today, staff on duty, 7-day revenue chart, service mix chart, live bay board, first-run onboarding
- **New Registration** — check a car in and auto-generate a printable invoice
- **Active Bay** — see all vehicles in progress, cancel a mistaken check-in, or check out with a payment method to generate a receipt
- **Staff** — add/remove attendants, track Today / This Week / This Month / All-Time revenue and sales per person, with a detailed drill-down view and chart
- **Invoices & Receipts** — full searchable history, reprintable any time, with delete for correcting mistakes
- **Revenue Reports** — all-time revenue, average ticket size, unpaid balance, 30-day trend, top staff by revenue
- **Settings** — edit your business name/phone/currency (shown on every invoice & receipt), manage your service catalog and prices, export/import full JSON backups, export records to CSV for accounting, load sample data, or reset everything

## Getting Started
1. Open `index.html` in any modern browser (double-click it, or visit the GitHub Pages link below).
2. On first run the system is empty. Go to **Staff** to add your attendants, and **Settings** to set your business name and confirm your service prices.
3. Start registering vehicles from **New Registration**.

Optionally, click **"Load Sample Data"** in Settings to explore the app with example staff and jobs first.

## Data & Backups
Data is saved automatically in your browser (per device/browser). **Back up regularly**:
- Settings → **Export Backup (JSON)** — full system backup, importable back in any time
- Settings → **Export Records (CSV)** — for spreadsheets/accounting

⚠️ Because data is stored per-browser, using the system from a different computer or browser will show separate data. For multi-device/multi-till use, this app would need a small backend — ask if you'd like that built.

## Deploying with GitHub Pages
Settings → Pages → Source: `main` branch → Save. Your live link will be:
`https://bush-steven.github.io/splashbay-carwash-system/`

## Tech
Single HTML file, vanilla JS, [Chart.js](https://www.chartjs.org/) for charts. No build step.
