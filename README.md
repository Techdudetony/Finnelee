# Finnelee: Personal Finance Web App

**Finnelee** is a browser-based budgeting app that turns your transactions into charts, stats, forecasts and payoff plans. Everything runs on your machine: each person signs in to their own account, and their data is saved in the browser's `localStorage` under that account. There is no server to set up.

---

## 1. Features

| Page                | What it does                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accounts**        | Sign up / sign in with email and password. Each account has its own transactions, budgets, debts, goals and bills.                                                                                                                                  |
| **Welcome summary** | Pops up after signing in (or from "View summary"): safe-to-spend, spending vs budget, emergency fund coverage, goal progress, bills due this week and the top insight.                                                                              |
| **Dashboard**       | A personal greeting ("Good evening, Antonio"), then this month's income, spending, net and savings rate; 6-month income vs. spending chart; spending-by-category donut; auto-generated insights ("Dining is up 32% vs last month"); upcoming bills. |
| **Transactions**    | Add, search, filter and delete income/expenses. Export to CSV.                                                                                                                                                                                      |
| **Budget**          | Monthly limit per category with progress bars, a **50/30/20 calculator** (needs / wants / savings) compared against your real spending, and a **debt-to-income (DTI) calculator**.                                                                  |
| **Debt Planner**    | Enter your debts and an extra monthly payment; compares **Snowball** (smallest balance first) vs **Avalanche** (highest interest first): months to debt-free, total interest, payoff order, and a balance-over-time chart.                          |
| **Forecast**        | Projects savings growth with compound interest under conservative / expected / optimistic returns, and predicts next month's spending from your trend (linear regression).                                                                          |
| **Goals**           | Savings goals (emergency fund, vacation...) with progress and the monthly amount needed to hit each deadline.                                                                                                                                       |
| **Bills**           | Recurring bills with next due date, days until due, and monthly total.                                                                                                                                                                              |
| **Categories**      | Add, rename, recolor or delete your own income and expense categories, and mark each expense as a need or a want. Renaming updates every transaction, bill and budget that uses it; deleting moves them to "Other".                                 |
| **Settings**        | Edit your display name, sign out, backup/restore all data as a JSON file (`finnelee-backup-<date>.json`), reload sample data, or clear everything.                                                                                                  |

The app ships with 6 months of realistic sample data so every chart has something to show on first run.

## 2. Tech stack

| Tool                                 | Why                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| **React 18**                         | Component-based UI; state changes re-render the screen automatically.                |
| **Vite**                             | Fast dev server and build tool; `npm run dev` starts in about a second.              |
| **Recharts**                         | Declarative React chart components (bar, line, area, pie).                           |
| **localStorage**                     | Built-in browser storage. Zero setup; data survives page reloads.                    |
| **Web Crypto (PBKDF2)**              | Built-in browser API used to hash passwords, so they are never stored as plain text. |
| **Plain CSS** with custom properties | Light/dark theme through CSS variables; no CSS framework to learn.                   |

No router and no state library: tabs are a single `useState`, which keeps the code easy to follow. Both are natural upgrades later (see section 7).

## 3. Architecture

```
   main.jsx ─► <AuthProvider>  (who is signed in? see src/auth/)
                      │
                      ▼
            App.jsx: loading screen │ AuthScreen │ FinanceApp key={user.id}
                      │
            ┌──────────────────────────────────────────────┐
            │            FinanceApp (in App.jsx)           │
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

0. **Accounts.** `AuthProvider` (React Context) knows who is signed in. `FinanceApp` is rendered with `key={user.id}`, so switching users remounts it and it reads that user's `finnelee.<userId>.*` storage keys.
1. **Single source of truth.** `FinanceApp` in `App.jsx` holds every piece of data. Pages read it from `store` and update it with the matching setter (`setTransactions`, ...).
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
    ├── main.jsx                # entry point: renders <App/> inside <AuthProvider>
    ├── App.jsx                 # auth gate, layout, tab navigation, all app state
    ├── auth/
    │   ├── authService.js      # sign up / in / out, password hashing (swap for a real backend later)
    │   ├── AuthContext.jsx     # React Context + useAuth() hook
    │   └── userStorage.js      # per-user storage keys + migration of pre-account data
    ├── styles.css              # design tokens (colors, spacing), light/dark theme
    ├── hooks/
    │   ├── useLocalStorage.js  # useState that persists to localStorage
    │   └── useColorScheme.js   # detects light/dark mode for chart colors
    ├── utils/
    │   ├── format.js           # currency, percent, date helpers
    │   ├── colors.js           # chart palette (light + dark)
    │   ├── finance.js          # all financial math
    │   ├── insights.js         # plain-language insights (dashboard + summary)
    │   └── categoryOps.js      # rename/delete a category across all records (pure functions)
    ├── data/
    │   ├── categories.js       # starter categories + helpers (names, colors, needs)
    │   └── sampleData.js       # generates 6 months of demo data
    └── components/
        ├── AuthScreen.jsx      # sign in / create account form
        ├── WelcomeSummary.jsx  # post-login summary popup (native <dialog>)
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
        ├── Categories.jsx      # category manager page
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
category    = { id, name, type: 'expense' | 'income', group: 'need' | 'want', colorIndex }  // colorIndex 0-7 or null (gray)
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
- **Safe to spend** = this month's income − spent so far − bills still due this month − monthly goal savings
- **Emergency fund months** = current savings ÷ average monthly essential ("needs") spending over the last 3 full months

## 7. Getting started

```bash
npm install
npm run dev        # open the printed URL (usually http://localhost:5173)
npm run build      # production build into dist/
```

## 8. Accounts: how they work and their limits

- Users are stored under `finnelee.users`, with passwords hashed using PBKDF2 and a random salt per user.
- Each user's data lives under `finnelee.<userId>.<slice>`.
- The **first** account created in a browser adopts any data saved before accounts existed (the old `fb.*` keys), so nothing is lost.
- ⚠️ This is browser-only auth: fine for learning and personal use, but accounts don't sync across devices and anyone with access to the computer can read localStorage. The plan to move to a real backend is in [ROADMAP.md](ROADMAP.md).

## 9. Roadmap

See [ROADMAP.md](ROADMAP.md) for feature status, build order and the AI auto-categorization design. Smaller ideas:

- React Router for real URLs per page
- TypeScript and unit tests (Vitest) for `finance.js`
