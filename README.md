# JOONA BIRYANI — Offline Cashier & Sales Management

A fast, cashier-first desktop app for **Joona Biryani**. It records multi-item restaurant
orders on the shop laptop, keeps every figure permanent in a local SQLite database, and works
**completely offline** — no internet, no cloud, no subscriptions, no external servers.

Physical tokens are untouched. The software only records money, menu items, biryani weight and
the owner's expenses.

---

## What it does

| Screen | Purpose |
| --- | --- |
| **Cashier** | One-click Sadi / Beef / Pao / Half KG / 1 KG tiles, custom amount, custom weight, other items, and a multi-item cart with `+`, `−`, remove and a large **Save Order** button. |
| **Owner Dashboard** | Today, yesterday and month sales; Sadi / Beef / Legacy KG; other-item revenue; expenses; estimated gross and net profit; backup health and recent orders. |
| **History** | Every order with order number, line items, amounts, biryani type, date and time. Search by order number or product name, filter by date, page through all records. |
| **Reports** | Daily and monthly reports with hourly/day charts, type breakdown, expenses, profit and a print layout that paginates long tables instead of clipping them. |
| **Owner Settings** | Menu & Pricing, Expenses, Backup & Restore, and About. Set product names, prices, costs, portions, enabled state and other-item prices. |

### Cashier workflow

1. Tap a portion tile for Sadi or Beef. Repeated taps increase the quantity of that line.
2. Use `+` / `−` / remove in the cart to adjust quantities, or add a custom amount or weight.
3. Add other items (drinks, raita, etc.) from the owner's menu or enter a one-off item manually.
4. The large **Save Order** button records everything as one order with one order number.
5. Errors are shown in plain language on screen; failed saves never clear the cart.

### Built-in safeguards

- **Duplicate protection** — every save carries a unique request id. A double-click, retry or
  repeated IPC call returns the original order instead of recording it twice.
- **Validation** — amounts and weights must be greater than zero, with hard upper limits
  (Rs 100,000 per item, 50 kg per item, 999 quantity, 100 lines per order).
- **Permanent storage** — every order survives app restarts and PC reboots.
- **Automatic verified backup after every sale** — the day's automatic backup is refreshed as
  soon as a new order is saved. Startup also refreshes a stale backup.
- **Safe restore** — the backup is fully validated first, the current data is saved as a safety
  copy, and the swap is done through a temporary file with counter repair.
- **Currency integrity** — money is stored as integer paisa and weight as integer milligrams, so
  repeated sales cannot accumulate floating-point drift.

---

## Install (shop laptop)

Two builds are produced in `release/`:

- `Joona-Biryani-Setup-2.0.0.exe` — **installer** (recommended). Creates Start Menu and desktop
  shortcuts, and installs for the current user without admin rights.
- `Joona-Biryani-Portable-2.0.0.exe` — runs without installing; useful for a USB stick.

1. Run the installer and follow the prompts.
2. Open **Joona Biryani** from the desktop shortcut.
3. Open **Settings → Menu & Pricing** first and enter the owner's real prices and costs.
4. Start recording orders from the **Cashier** screen.

No internet connection is needed at any point.

The installers are **unsigned**. Windows SmartScreen may show a warning; choose
**More info → Run anyway** only if the file came directly from Joona Biryani. The portable build
also keeps its data under the Windows AppData profile, not beside the `.exe` file.

---

## First-time owner setup

Version 2 starts with the menu structure but **no invented prices or costs**. Before the first
sale the owner must open **Settings → Menu & Pricing** and set at least:

- Sadi Biryani price per kg and cost per kg.
- Beef Biryani price per kg and cost per kg.
- Any other products (drinks, raita, etc.) with selling price and cost.
- Portion overrides only if a portion should not use the per-kg price.

Capital, rent, electricity, gas and other running costs belong in **Settings → Expenses**.
Profit is only shown as complete when every sold item has a recorded cost.

---

## How the figures are calculated

### Biryani portions

Portion price = `round(price per kg × portion weight)` in paisa. The default portions are
`Pao` (250 g), `Half KG` (500 g) and `1 KG` (1000 g). The owner can add, rename or disable
portions and can set a fixed price for a portion instead of using the per-kg price.

### Custom amount

Weight = `round(amount × 1,000,000 / price per kg)` milligrams. For example, Rs 300 at
Rs 1,200/kg gives 250 g.

### Custom weight

Price = `round(price per kg × weight in mg / 1,000,000)` paisa.

### Rounding policy

- Rupee entries convert to paisa with round-half-up.
- All money arithmetic uses integer paisa; all weight arithmetic uses integer milligrams.
- Biryani weight totals are `weight per unit × quantity`.
- No floating-point value is stored as the source of truth, so rounding cannot drift across sales.

### Profit

- **Revenue** = order totals (biryani + other items).
- **Estimated product cost** = sum of each line's unit cost × quantity, using the cost snapshot
  recorded when the order was saved.
- **Estimated gross profit** = revenue − estimated product cost.
- **Estimated net profit** = gross profit − recorded expenses.
- If any line has no cost, reports show **“Profit Calculation Incomplete”** and list the missing
  items instead of guessing. Legacy sales have no cost and therefore keep profit incomplete.

### Dates and time

All business dates, times and report boundaries use **Asia/Karachi (PKT, UTC+5)**, regardless of
the laptop's Windows timezone.

---

## Version 1 data and Legacy orders

The seven original sales from version 1 are preserved exactly and migrated into the new order
tables with their original order numbers, dates, times, amounts and weights. Because version 1
never recorded whether a sale was Sadi or Beef, those sales are permanently labelled
**Legacy / Unclassified**:

- They are never counted as Sadi or Beef.
- They appear in their own Legacy KG/revenue bucket.
- They cannot be repriced or edited.
- Their cost is unknown, so profit stays incomplete for periods that include them.

The migration is forward-only and versioned. Before any migration the app creates and verifies a
safety backup (`pre-migration-v*.sqlite`). The original `sales` table is kept permanently.

---

## Where the data lives

On Windows, everything is stored under the current user's AppData folder:

```
%APPDATA%\Joona Biryani\
├── data\
│   └── joona-biryani.sqlite        ← all orders, menu, expenses and settings
└── backups\
    ├── auto-YYYY-MM-DD.sqlite      ← refreshed after every sale (30 days kept)
    ├── pre-migration-*.sqlite      ← verified safety copy before an upgrade (5 kept)
    └── pre-restore-*.sqlite        ← safety copies made before a restore (5 kept)
```

Use **Settings → Open data folder** / **Open backups folder** to reach them directly.

### Backups

1. Go to **Settings → Backup & Restore**.
2. Click **Create backup** and choose a location — ideally a USB drive.
3. Check that the file is listed as verified.

A restore replaces the current data, but the software always writes a safety copy of the current
database first. Restore validates all of the following before touching live data: SQLite
integrity, foreign keys, required tables and indexes, schema version, order line totals and daily
counter consistency. Invalid files are rejected with a clear message.

### Correction procedure

Saved orders are permanent. Version 2 has no edit or void button.

- If an order was entered incorrectly, keep the original record and write a clear correction note
  in the owner's records. Do not edit the SQLite file by hand.
- Restore is only for replacing a damaged database with a verified backup; it is not a normal
  correction tool.
- Changing a menu price or cost changes future orders only. Historical orders keep the price and
  cost snapshot from the moment they were saved.

---

## Practice mode

Practice mode is for training and testing. It uses a completely separate Windows profile and a
separate database, and never opens the real shop data.

```powershell
npm start -- --practice
# or
$env:JOONA_PRACTICE = "1"
npm start
```

The window title and the in-app banner clearly show **Practice Mode**. Data is stored under
`%APPDATA%\Joona Biryani Practice\`, so production sales, menu prices and backups are untouched.

---

## Security and privacy

- Electron runs with `contextIsolation: true`, `nodeIntegration: false` and a sandboxed renderer.
- The preload bridge exposes only the small set of functions the UI needs.
- The local Express API binds to `127.0.0.1` only and requires a per-launch token
  (`x-joona-token`).
- CORS is restricted to the app's own origin; IPC calls validate the sending window.
- There is no external network access, telemetry, update check or cloud service.

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
npm test             # run all backend tests (Node's built-in runner)
npm run dist         # build the Windows installer and portable app into release/
```

### Project layout

```
electron/            Electron main process + preload bridge
  main.js            window, local API server, IPC, practice mode, backup/restore dialogs
  preload.js         safe window.joona bridge for the renderer
server/              Node/Express business logic
  db.js              data layer: orders, menu, pricing, expenses, reports, backups, restore
  migrations.js      forward-only versioned SQLite migrations (schema v1 → v2)
  money.js           integer paisa/milligram helpers and documented rounding
  app.js             HTTP routes and validation
  time.js            Asia/Karachi business date/time helpers
client/              React frontend (Vite)
  src/pages/         Cashier, Dashboard, History, Reports, Settings
  src/components/    design-system components, charts, tables, profit summary
  src/styles.css     complete design system + print styles
tests/               money, migration, database and API tests
scripts/             safety backup and dev-only demo data helpers
build/               app icons (icon.png, icon.ico)
```

### How it works

- The Electron main process starts an in-process Express API bound to `127.0.0.1` on a random
  port. All traffic stays on the machine.
- Every request must carry a per-launch token (`x-joona-token`) that the renderer gets through the
  preload bridge, so nothing else on the machine can read or write orders.
- SQLite is provided by Node's built-in `node:sqlite` module inside Electron, so there is no native
  module compilation step and no extra dependency at runtime.
- SQLite uses WAL with `synchronous = FULL`, foreign keys ON and a 5-second busy timeout.
- Orders are numbered per day as `JB-YYYYMMDD-0001`, incrementing for each order recorded that day.
  Version 1 numbers are preserved and daily counters are aligned during migration.

### Test data (development only)

To fill a throwaway database with demo orders:

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
| `JOONA_PRACTICE=1` | Use the separate Practice Mode profile and database. |
| `JOONA_SMOKE=1` | Launch, verify the UI and local API, print `SMOKE_RESULT` JSON and exit. |
| `JOONA_SMOKE_OUT=<file>` | Also write the smoke-test JSON result to a file. |

---

## Scope

Included in version 2: multi-item cashier orders, owner-controlled menu pricing and costs,
expenses, dashboard and daily/monthly reports with honest profit, verified backups/restore,
practice mode, versioned migrations and print support.

Not included (by design): online ordering, customer accounts, QR or digital tokens, WhatsApp
messages, payment gateways, stock/inventory tracking, staff attendance, multi-restaurant support
and AI features.

---

© 2026 Joona Biryani. Built for offline use on the shop's own laptop.
