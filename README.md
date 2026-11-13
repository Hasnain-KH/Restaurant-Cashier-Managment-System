# JOONA BIRYANI — Offline Sales Management

A simple, fast sales-entry and reporting desktop app for **Joona Biryani**. It records every
sale on the shop laptop, keeps the figures permanent in a local SQLite database, and works
**completely offline** — no internet, no cloud, no subscriptions, no external servers.

Physical tokens are untouched. The software only records the money and the weight of each sale.

---

## What it does

| Screen | Purpose |
| --- | --- |
| **New Sale** | Type the amount, tap Pao / Half KG / 1 KG / Custom, press **Save Sale**. Date, time and sale number are added automatically. |
| **Owner Dashboard** | Today's sales, today's orders, biryani sold, average order, yesterday's sales, monthly total, last-7-days chart and recent sales. |
| **Sales History** | Every sale with number, amount, weight, date and time. Filter by today, yesterday, 7 days, this month, all sales or a custom date range. |
| **Reports** | Daily and monthly reports with hourly/daily charts, day-by-day breakdown and a print layout. |
| **Settings** | Backup, restore, open the data/backup folders, and set a default price per kg helper. |

### Built-in safeguards

- **One-click duplicate protection** — each save carries a unique request id, so a double click
  or a retried network call can never record the same sale twice.
- **Validation** — amount must be greater than 0 (up to Rs 1,000,000) and weight greater than 0
  (up to 50 kg per sale).
- **Permanent storage** — every sale survives app restarts and PC reboots.
- **Automatic daily backup** — one snapshot per day is kept, with the newest 30 retained.
- **Safe restore** — the backup is validated first, the current data is saved as a safety copy,
  and the swap is done through a temporary file.

---

## Install (shop laptop)

Two builds are produced in `release/`:

- `Joona-Biryani-Setup-1.0.0.exe` — **installer** (recommended). Creates Start Menu and desktop
  shortcuts, and can be installed for the current user without admin rights.
- `Joona-Biryani-Portable-1.0.0.exe` — runs without installing; useful for a USB stick.

1. Run the installer and follow the prompts.
2. Open **Joona Biryani** from the desktop shortcut.
3. Start recording sales from the **New Sale** screen.

No internet connection is needed at any point.

---

## Where the data lives

On Windows, everything is stored under the current user's AppData folder:

```
%APPDATA%\Joona Biryani\
├── data\
│   └── joona-biryani.sqlite        ← all sales
└── backups\
    ├── auto-YYYY-MM-DD.sqlite      ← one automatic backup per day (30 kept)
    └── pre-restore-*.sqlite        ← safety copies made before a restore (5 kept)
```

Use **Settings → Open data folder** / **Open backups folder** to reach them directly.

### Backups

1. Go to **Settings**.
2. Click **Create backup** and choose a location — ideally a USB drive.
3. To move the shop's data to another laptop (or recover from a mistake), click **Restore backup**,
   pick the `.sqlite` file and confirm.

A restore replaces the current data, but the software always writes a safety copy of the current
database first, so nothing is lost by accident.

---

## Development

### Requirements

- Node.js 20+ (the app itself ships its own runtime)
- Windows 10/11

### Commands

```bash
npm install          # install dependencies
npm run dev          # Vite dev server + Electron with hot reload
npm run build        # build the React frontend into client/dist
npm start            # build, then run the desktop app
npm test             # run the backend test suite (Node's built-in runner)
npm run dist         # build the Windows installer and portable app into release/
```

### Project layout

```
electron/            Electron main process + preload bridge
  main.js            window, local API server, IPC, backup/restore dialogs
  preload.js         safe window.joona bridge for the renderer
server/              Node/Express business logic
  db.js              SQLite schema, sales, reports, backups, restore
  app.js             HTTP routes and validation
  time.js            local date/time helpers
client/              React frontend (Vite)
  src/pages/         Cashier, Dashboard, History, Reports, Settings
  src/components/    design-system components, charts, tables
  src/styles.css     complete design system + print styles
tests/               database and API tests
scripts/seed-demo.js dev-only demo data generator
build/               app icons (icon.png, icon.ico)
```

### How it works

- The Electron main process starts an in-process Express API bound to `127.0.0.1` on a random
  port. All traffic stays on the machine.
- Every request must carry a per-launch token (`x-joona-token`) that the renderer gets through the
  preload bridge, so nothing else on the machine can read or write sales.
- SQLite is provided by Node's built-in `node:sqlite` module inside Electron, so there is no native
  module compilation step and no extra dependency at runtime.
- Sales are numbered per day as `JB-YYYYMMDD-0001`, incrementing for each sale recorded that day.
- Weight is stored in kilograms. The interface shows familiar labels: `1 Pao` (250 g),
  `Half KG` (500 g), `N KG`, or grams for other sub-kilogram amounts.

### Test data (development only)

To fill a throwaway database with 30 days of realistic demo sales:

```bash
node scripts/seed-demo.js "%TEMP%\joona-demo\data\joona-biryani.sqlite"
```

Then point the app at that profile while developing:

```powershell
$env:JOONA_USER_DATA_DIR = "$env:TEMP\joona-demo"
npm start
```

This script is a development helper only; it is not included in the installed application.

### Development environment variables

| Variable | Effect |
| --- | --- |
| `JOONA_DEV=1` | Load the UI from the Vite dev server (`http://127.0.0.1:5173`) instead of `client/dist`. |
| `JOONA_DEVTOOLS=1` | Open Chromium DevTools on launch (development builds only). |
| `JOONA_USER_DATA_DIR=<path>` | Use a separate profile folder (handy for testing without touching real data). |
| `JOONA_SMOKE=1` | Launch, verify the UI and local API, print `SMOKE_RESULT` JSON and exit. |
| `JOONA_SMOKE_OUT=<file>` | Also write the smoke-test JSON result to a file. |

---

## Scope

This is the first version, deliberately kept small: fast cashier entry, owner dashboard, sales
history, daily/weekly/monthly reports, SQLite storage and backup/restore.

Not included (by design): online ordering, customer accounts, QR or digital tokens, WhatsApp
messages, payment gateways, inventory, staff attendance, multi-restaurant support and AI features.

---

© 2026 Joona Biryani. Built for offline use on the shop's own laptop.
