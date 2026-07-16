# SplashBay — Carwash Operations System

A single-file carwash management dashboard: staff management, vehicle check-in/out, invoice & receipt generation, and revenue reporting.

## Features
- **Dashboard** — today's revenue, cars in bay, cars washed today, staff on duty, 7-day revenue chart, service mix chart, live bay board
- **New Registration** — check a car in and auto-generate a printable invoice
- **Active Bay** — see all vehicles in progress, check out with a payment method to generate a receipt
- **Staff** — add/remove attendants, track their Today / This Week / This Month / All-Time revenue and sales, view detailed per-staff sales history and chart
- **Invoices & Receipts** — full searchable history, reprintable at any time
- **Revenue Reports** — all-time revenue, average ticket size, unpaid balance, 30-day trend, top staff by revenue

## Usage
Open `index.html` in any modern browser. No build step or server required.

Data is stored using the in-browser Artifacts storage API when run inside Claude, and persists between sessions for that user.
