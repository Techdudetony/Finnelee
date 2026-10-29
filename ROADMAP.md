# Finnelee Roadmap

How the suggested features map to what's built, and the order to build the rest.

**Status key:** ✅ Done · 🟡 Partly done · ⬜ Not started

## Core features

| Feature                     | Status | What exists / what's missing                                                                                                                          |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Financial Dashboard         | 🟡     | Income, spending, cash flow, savings rate and charts exist. Missing **net worth**, which needs accounts and assets to be tracked.                     |
| Smart Budget Builder        | 🟡     | Category limits and 50/30/20 exist. Missing **zero-based budgeting** and **rollover balances**.                                                       |
| Transaction Tracking        | ✅     | Manual entry, categories, search/filter, CSV export, and CSV import with duplicate checks.                                                            |
| Savings Goal Simulator      | 🟡     | Goals show the monthly amount needed. Missing a **predicted completion date** and **side-by-side contribution scenarios**.                            |
| Debt Payoff Planner         | ✅     | Snowball vs avalanche, interest saved, payoff order and timeline.                                                                                     |
| Bill & Subscription Tracker | 🟡     | Upcoming bills, monthly/yearly totals, and bill suggestions from recurring charges. Missing **renewal reminders** and **subscription cost analysis**. |
| AI Financial Insights       | 🟡     | Rule-based insights exist (category jumps, budget overruns, savings rate). LLM explanations need a backend (Phase 3).                                 |
| What-If Simulator           | ⬜     | Model a job change, purchase, emergency expense or income change against the forecast.                                                                |
| Bank Account Connections    | ⬜     | Needs a backend plus an aggregator such as Plaid (Phase 4).                                                                                           |
| Household Budgeting         | ⬜     | Needs real server accounts to share data between people (Phase 3).                                                                                    |
| Financial Health Score      | ⬜     | The inputs already exist: savings rate, DTI, emergency fund months and budget adherence.                                                              |
| Progress & Milestones       | ⬜     | Savings streaks, achievements, monthly reviews, goal celebrations.                                                                                    |

## Supporting features

| Feature                                | Status | Notes                                                                                                                |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Safe-to-spend amount                   | ✅     | Shown in the welcome summary: income − spent − bills still due − goal savings.                                       |
| Payday planner                         | ⬜     | Weekly, biweekly, irregular or multiple income schedules.                                                            |
| Recurring expense detector             | ✅     | Bills page suggests monthly charges (same merchant, ±10% amount, ±4 days). Add or dismiss each one.                  |
| Emergency fund readiness               | ✅     | Months of essential spending your savings cover, in the welcome summary.                                             |
| Monthly financial review               | 🟡     | The welcome summary covers "today". A month-end recap is still to do.                                                |
| Custom categories                      | ✅     | Categories page: add, rename, recolor, delete, need/want group. Stored per user.                                     |
| Notifications and reminders            | 🟡     | In-app "due soon" only. Email or push needs a backend.                                                               |
| Data export                            | ✅     | CSV (transactions) and JSON backup/restore (everything).                                                             |
| Accessible UI                          | 🟡     | Labels, keyboard focus, text status next to colors (with icons), native dialog. Missing a **table view for charts**. |
| User accounts, greeting, login summary | ✅     | Added in the `feature/user-accounts` branch.                                                                         |
| Custom icon set                        | ✅     | SVG icons replace emojis everywhere (`components/Icon.jsx`), plus a Finnelee logo and favicon.                       |

## Build order

**Phase 1: accounts (done).** Sign up/in, per-user data, greeting, welcome summary, safe-to-spend, emergency fund.

**Phase 2: no backend needed.** Each item is a self-contained branch:

1. ~~Custom categories~~ ✅ done
2. ~~CSV import + recurring expense detector~~ ✅ done
3. Zero-based budgets + rollover balances
4. Net worth (accounts and assets)
5. Goal simulator (completion dates, scenarios) and the What-If simulator
6. Financial health score, milestones and a monthly review

**Phase 3: add a backend (Supabase recommended).** Move auth and data to the server (see "Auth" below), then add household sharing, email reminders and the AI features.

**Phase 4: bank connections** through Plaid. This also needs a server.

## Auth: current limits and next step

Accounts are stored **in the browser** (`src/auth/authService.js`). Passwords are hashed with PBKDF2, but anyone with access to the computer can read localStorage. Accounts also don't sync between devices or browsers. That's fine for learning and personal use, not for real users.

The plan for Phase 3 is to replace the bodies of `signUp`, `signIn`, `signOut`, `getCurrentUser` and `updateProfile` with Supabase calls. They are already async and return plain objects, so nothing else in the app needs to change.

## Future: AI auto-categorization

**Goal:** suggest a category from a transaction description. Above 80% confidence it is applied automatically. Below that, the user picks from the top 3.

```
Transaction form ──► POST /api/categorize { description, amount, categories }
                         │  (server function; holds the API key)
                         ▼
                     Claude API  ──►  [{ category, confidence }, ...] top 3
                         │
          top confidence ≥ 0.80 ?
             yes ──► auto-fill category, show an "Auto" badge with undo
             no  ──► show 3 chips; the user's choice is saved as a correction
```

Design notes:

- **The API key must never be in the browser.** The call goes through a small server function (Supabase Edge Function, Vercel or Netlify function).
- Use **structured output** (a JSON schema) so the model always returns valid `{category, confidence}` objects from your category list.
- A small, fast model is enough for this. Send your category list and a few of the user's past corrections as examples.
- **Self-reported confidence is only roughly calibrated.** Check it first against a remembered merchant → category map ("STARBUCKS" → Dining) built from the user's corrections. Then measure how often auto-applied categories get changed, and tune the 0.8 threshold.
- Cache results per normalized description, so repeated merchants cost nothing.
