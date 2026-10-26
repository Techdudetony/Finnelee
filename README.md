# Finnelee: Personal Finance Web App

**Finnelee** is a browser-based budgeting app that turns your transactions into charts, stats, forecasts and payoff plans. Everything runs on your machine; data is saved in the browser's `localStorage`, so there is no server or account to set up.

---

## 1. Features

| Page | What it does |
|---|---|
| **Dashboard** | This month's income, spending, net and savings rate; 6-month income vs. spending chart; spending-by-category donut; auto-generated insights ("Dining is up 32% vs last month"); upcoming bills. |
| **Transactions** | Add, search, filter and delete income/expenses. Export to CSV. |
| **Budget** | Monthly limit per category with progress bars, a **50/30/20 calculator** (needs / wants / savings) compared against your real spending, and a **debt-to-income (DTI) calculator**. |
| **Debt Planner** | Enter your debts and an extra monthly payment; compares **Snowball** (smallest balance first) vs **Avalanche** (highest interest first): months to debt-free, total interest, payoff order, and a balance-over-time chart. |
| **Forecast** | Projects savings growth with compound interest under conservative / expected / optimistic returns, and predicts next month's spending from your trend (linear regression). |
| **Goals** | Savings goals (emergency fund, vacation...) with progress and the monthly amount needed to hit each deadline. |
| **Bills** | Recurring bills with next due date, days until due, and monthly total. |
| **Settings** | Backup/restore all data as a JSON file (`finnelee-backup-<date>.json`), reload sample data, or clear everything. |

The app ships with 6 months of realistic sample data so every chart has something to show on first run.

## 2. Tech stack

| Tool | Why |
|---|---|
| **React 18** | Component-based UI; state changes re-render the screen automatically. |
| **Vite** | Fast dev server and build tool; `npm run dev` starts in about a second. |
| **Recharts** | Declarative React chart components (bar, line, area, pie). |
| **localStorage** | Built-in browser storage. Zero setup; data survives page reloads. |
| **Plain CSS** with custom properties | Light/dark theme through CSS variables; no CSS framework to learn. |

No router and no state library: tabs are a single `useState`, which keeps the code easy to follow. Both are natural upgrades later (see section 7).

## 3. Architecture

```
            ┌──────────────────────────────────────────────┐
            │                  App.jsx                     │
            │  owns ALL data via useLocalStorage hooks     │
            │  (transactions, budgets, debts, goals, ...)  │
            └───────────────┬──────────────────────────────┘
                            │  passes one `store` prop down
     ┌──────────┬───────────┼───────────┬──────────┬──────────┐
 Dashboard  Transactions  Budget   DebtPlanner  Forecast   Goals / Bills / Settings
     │                                   │          │
     └──────── call pure functions in utils/finance.js ────────┘
                (math only: no React, easy to test and reuse)
```

Key ideas:

1. **Single source of truth.** `App.jsx` holds every piece of data. Pages read it from `store` and update it with the matching setter (`setTransactions`, ...).
2. **Persistence is automatic.** `useLocalStorage` works like `useState` but also writes every change to `localStorage`.
3. **UI and math are separate.** Components render; `utils/finance.js` calculates. You can change a formula without touching the UI.
4. **Derived data is computed, not stored.** Totals, charts and forecasts are recalculated from raw transactions with `useMemo`, so they never go stale.

## 4. File structure

```
finance-app/                    # project folder (the npm package is named "finnelee")
├── index.html                  # HTML shell; React mounts into <div id="root">
├── package.json                # dependencies + npm scripts
├── vite.config.js              # Vite + React plugin
└── src/
    ├── main.jsx                # entry point: renders <App/>
    ├── App.jsx                 # layout, tab navigation, all app state
    ├── styles.css              # design tokens (colors, spacing), light/dark theme
    ├── hooks/
    │   ├── useLocalStorage.js  # useState that persists to localStorage
    │   └── useColorScheme.js   # detects light/dark mode for chart colors
    ├── utils/
    │   ├── format.js           # currency, percent, date helpers
    │   ├── colors.js           # chart palette (light + dark)
    │   └── finance.js          # all financial math
    ├── data/
    │   ├── categories.js       # category lists + needs/wants grouping
    │   └── sampleData.js       # generates 6 months of demo data
    └── components/
        ├── StatCard.jsx        # KPI tile
        ├── ProgressBar.jsx     # bar with ok/warning/over states
        ├── ChartTooltip.jsx    # shared hover tooltip for charts
        ├── Dashboard.jsx
        ├── Transactions.jsx
        ├── Budget.jsx
        ├── DebtPlanner.jsx
        ├── Forecast.jsx
        ├── Goals.jsx
        ├── Bills.jsx
        └── Settings.jsx
```

## 5. Data model

All amounts are positive numbers; `type` decides whether money comes in or goes out.

```js
transaction = { id, date: '2026-10-05', description, category, type: 'income' | 'expense', amount }
budgets     = { Groceries: 500, Dining: 200, ... }          // monthly limit per category
debt        = { id, name, balance, apr, minPayment }        // apr is a yearly % (e.g. 22.9)
goal        = { id, name, target, saved, deadline }         // deadline 'YYYY-MM-DD'
bill        = { id, name, amount, dueDay, category }        // dueDay 1-31 of each month
settings    = { startingSavings, annualReturn }
```

## 6. Key formulas

- **Savings rate** = (income − expenses) ÷ income
- **Compound growth (monthly)**: `balance = balance × (1 + annualRate/12) + contribution`, repeated each month
- **Debt month**: add interest `balance × APR/12`, pay every minimum, then send all leftover money to the target debt. When a debt is paid off its minimum "rolls over" to the next one.
- **Snowball** targets the smallest balance (quick wins); **Avalanche** targets the highest APR (least interest).
- **Required monthly for a goal** = (target − saved) ÷ months until deadline
- **DTI** = monthly debt payments ÷ gross monthly income (≤ 36% is generally considered healthy)
- **Spending prediction**: least-squares line through the last 6 months, extended one month ahead

## 7. Getting started

```bash
npm install
npm run dev        # open the printed URL (usually http://localhost:5173)
npm run build      # production build into dist/
```

## 8. Ideas for later

- React Router for real URLs per page; Context or Zustand instead of prop passing
- A backend (Supabase, Firebase, or Node + Postgres) with login for multi-device sync
- Bank import via CSV upload or Plaid
- Rename the storage keys from `fb.*` to `finnelee.*` (add a one-time migration that copies old keys so saved data isn't lost)
- TypeScript and unit tests (Vitest) for `finance.js`
