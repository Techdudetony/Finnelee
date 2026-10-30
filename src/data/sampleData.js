import { toISODate, uid } from '../utils/format';
import { DEFAULT_CATEGORIES } from './categories';

// Each user gets their own copy of the starter categories.
const starterCategories = () => DEFAULT_CATEGORIES.map((c) => ({ ...c }));

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Math.random() gives different numbers each run; a seeded generator gives the SAME
 * sequence every time, so the demo data looks identical on every reload.
 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // float in [0, 1)
  };
}

// A manual net worth account, updated today (same shape as one added on the Net Worth page).
const sampleAccount = (name, type, kind, balance, today) => ({
  id: uid(),
  name,
  type,
  kind,
  balance,
  updated: toISODate(today),
  source: 'manual',
});

/** Builds 6 months of transactions ending today, plus starter budgets, debts, goals, bills and accounts. */
export function generateSampleData(today = new Date()) {
  const rand = mulberry32(42);
  const between = (min, max) => Math.round((min + rand() * (max - min)) * 100) / 100;
  const transactions = [];

  // Helper: only add a transaction if its date isn't in the future.
  const add = (date, description, category, type, amount) => {
    if (date <= today) {
      transactions.push({ id: uid(), date: toISODate(date), description, category, type, amount });
    }
  };

  for (let back = 5; back >= 0; back--) {
    const y = today.getFullYear();
    const m = today.getMonth() - back; // Date handles negative months (rolls into last year)
    const day = (d) => new Date(y, m, d);

    // Income: two paychecks + occasional side work
    add(day(1), 'Paycheck', 'Salary', 'income', 2100);
    add(day(15), 'Paycheck', 'Salary', 'income', 2100);
    if (rand() > 0.4) add(day(20), 'Freelance project', 'Freelance', 'income', between(200, 700));

    // Fixed costs
    add(day(1), 'Rent', 'Housing', 'expense', 1550);
    add(day(8), 'Electric & water', 'Utilities', 'expense', between(110, 180));
    add(day(12), 'Internet', 'Utilities', 'expense', 65);
    add(day(3), 'Streaming services', 'Entertainment', 'expense', 22.99);

    // Variable spending: [category, description, times per month, min, max]
    const variable = [
      ['Groceries', 'Grocery store', 4, 70, 150],
      ['Dining', 'Restaurant', 3 + (back % 3), 18, 65], // dining creeps up in recent months
      ['Transport', 'Gas', 3, 35, 60],
      ['Entertainment', 'Movies / events', 1, 15, 80],
      ['Shopping', 'Online shopping', 2, 20, 140],
      ['Health', 'Pharmacy', 1, 10, 60],
    ];
    for (const [category, description, count, min, max] of variable) {
      for (let i = 0; i < count; i++) {
        add(day(1 + Math.floor(rand() * 28)), description, category, 'expense', between(min, max));
      }
    }
  }

  // Newest first is how most people want to read a transaction list.
  transactions.sort((a, b) => b.date.localeCompare(a.date));

  return {
    transactions,
    budgets: {
      Housing: 1550,
      Groceries: 500,
      Dining: 200,
      Transport: 200,
      Utilities: 260,
      Entertainment: 100,
      Shopping: 200,
      Health: 80,
      Other: 100,
    },
    debts: [
      // Picked so the strategies differ: snowball hits the store card first, avalanche the credit card.
      { id: uid(), name: 'Store card', balance: 1100, apr: 8.9, minPayment: 35 },
      { id: uid(), name: 'Credit card', balance: 6200, apr: 24.9, minPayment: 150 },
      { id: uid(), name: 'Car loan', balance: 9800, apr: 6.5, minPayment: 260 },
    ],
    goals: [
      {
        id: uid(),
        name: 'Emergency fund',
        target: 10000,
        saved: 3800,
        deadline: `${today.getFullYear() + 1}-06-30`,
      },
      {
        id: uid(),
        name: 'Vacation',
        target: 2500,
        saved: 650,
        deadline: `${today.getFullYear() + 1}-03-31`,
      },
    ],
    bills: [
      { id: uid(), name: 'Rent', amount: 1550, dueDay: 1, category: 'Housing' },
      {
        id: uid(),
        name: 'Streaming services',
        amount: 22.99,
        dueDay: 3,
        category: 'Entertainment',
      },
      { id: uid(), name: 'Electric & water', amount: 150, dueDay: 8, category: 'Utilities' },
      { id: uid(), name: 'Internet', amount: 65, dueDay: 12, category: 'Utilities' },
      { id: uid(), name: 'Car insurance', amount: 128, dueDay: 22, category: 'Transport' },
    ],
    // Net worth accounts. The car's value is an asset; its loan is the "Car loan" debt above.
    accounts: [
      sampleAccount('Checking', 'asset', 'cash', 2400, today),
      sampleAccount('High-yield savings', 'asset', 'savings', 3800, today),
      sampleAccount('401(k)', 'asset', 'retirement', 21000, today),
      sampleAccount('Car (market value)', 'asset', 'vehicle', 16500, today),
    ],
    settings: { startingSavings: 3800, annualReturn: 5 },
    categories: starterCategories(),
  };
}

/** Empty data set for "Clear all data". */
export const emptyData = () => ({
  transactions: [],
  budgets: {},
  debts: [],
  goals: [],
  bills: [],
  accounts: [],
  settings: { startingSavings: 0, annualReturn: 5 },
  categories: starterCategories(),
});

/**
 * A backup file (or sample / empty data) -> every slice, with safe defaults for anything an
 * older backup doesn't have or has in the wrong shape. Settings.jsx loads the result at once,
 * so no slice (like old accounts or snapshots) survives from the data being replaced.
 */
export function fromBackup(data) {
  const blank = emptyData();
  const list = (v, fallback) => (Array.isArray(v) ? v : fallback);
  const object = (v, fallback) => (v && typeof v === 'object' && !Array.isArray(v) ? v : fallback);
  return {
    transactions: list(data?.transactions, blank.transactions),
    budgets: object(data?.budgets, blank.budgets),
    debts: list(data?.debts, blank.debts),
    goals: list(data?.goals, blank.goals),
    bills: list(data?.bills, blank.bills),
    accounts: list(data?.accounts, blank.accounts), // backups made before net worth have none
    settings: object(data?.settings, blank.settings),
    categories: list(data?.categories, blank.categories), // ...and before custom categories
  };
}
