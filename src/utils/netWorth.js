// Net worth = assets − liabilities. Pure functions (no React), so every rule is unit-tested.
//
// accounts (own storage slice): [{ id, name, type: 'asset' | 'liability', kind, balance, updated, source }]
//   - Debt Planner debts ALWAYS count as liabilities (read live), so loans and cards are
//     never entered twice. Liability accounts are only for debts not in the planner.
//   - A financed asset is two rows: its market value here, its loan in the Debt Planner.
//   - source: 'manual' for now; kept so a future bank integration can tell its rows apart.
// settings.netWorthHistory: { '2026-10': { assets, liabilities } }
//   totals recorded during each month (the latest seen), NOT month-end statements.
// settings.savingsSource: 'manual' (default, also when missing) | 'accounts'

import { monthKey, monthLabel, todayISO, uid } from "./format";

export const ASSET_KINDS = [
  { id: "cash", label: "Checking / cash" },
  { id: "savings", label: "Savings" },
  { id: "investment", label: "Investments" },
  { id: "retirement", label: "Retirement" },
  { id: "property", label: "Home / property" },
  { id: "vehicle", label: "Vehicle" },
  { id: "other", label: "Other asset" },
];
// No loan or credit card kinds on purpose: those belong in the Debt Planner.
export const LIABILITY_KINDS = [
  { id: "mortgage", label: "Mortgage" },
  { id: "other", label: "Other debt" },
];
const KINDS = { asset: ASSET_KINDS, liability: LIABILITY_KINDS };
const LIQUID = new Set(["cash", "savings"]); // what "savings" means for Forecast + emergency fund
export const STALE_DAYS = 60;

const round2 = (n) => Math.round(n * 100) / 100;
const amount = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Account balances are never negative; anything odd left by an older version counts as 0.
const balanceOf = (a) => (amount(a.balance) > 0 ? amount(a.balance) : 0);
const sum = (arr, pick) =>
  round2(arr.reduce((total, item) => total + amount(pick(item)), 0));

export const kindLabel = (type, kind) =>
  KINDS[type]?.find((k) => k.id === kind)?.label ?? "Other";

/** The stored list, or [] for older backups and corrupt data. Unknown types are dropped. */
export const readAccounts = (accounts) =>
  Array.isArray(accounts) ? accounts.filter((a) => a && KINDS[a.type]) : [];

// ---------- Editing accounts ----------

/**
 * Checks typed balance text: { value } (rounded to cents) or { error }.
 * Balances are positive amounts for both types; '' / 'abc' / '-5' are rejected.
 */
export function parseBalance(text) {
  const raw = String(text ?? "").trim();
  const value = Number(raw);
  if (raw === "") return { error: "Enter a balance." };
  if (!Number.isFinite(value)) return { error: "Enter a number." };
  if (value < 0) return { error: "Use a positive amount." };
  return { value: round2(value) };
}

/**
 * A new liability needs an explicit "not in the Debt Planner" confirmation whenever the
 * planner has debts. Simple and name-independent: the user decides, but has to decide.
 */
export const needsDebtConfirmation = (type, debts = []) =>
  type === "liability" && debts.length > 0;

/**
 * Form values -> { account } or { error }.
 * form.notInDebtPlanner is the confirmation checkbox (see needsDebtConfirmation).
 */
export function newAccount(
  { name, type, kind, balance, notInDebtPlanner },
  today = todayISO(),
  debts = [],
) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { error: "Give the account a name." };
  if (!KINDS[type]?.some((k) => k.id === kind))
    return { error: "Choose a kind." };
  const parsed = parseBalance(balance);
  if (parsed.error) return { error: parsed.error };
  if (needsDebtConfirmation(type, debts) && !notInDebtPlanner)
    return {
      error: "Confirm this debt isn't already in the Debt Planner.",
    };
  return {
    account: {
      id: uid(),
      name: trimmed,
      type,
      kind,
      balance: parsed.value,
      updated: today,
      source: "manual",
    },
  };
}

/**
 * New balance for one account; also stamps `updated` so stale balances can be flagged.
 * Invalid text changes nothing: the SAME array comes back, so totals and the monthly
 * snapshot never see a half-typed or empty balance.
 */
export function updateBalance(accounts, id, value, today = todayISO()) {
  const parsed = parseBalance(value);
  if (parsed.error) return accounts;
  return accounts.map((a) =>
    a.id === id ? { ...a, balance: parsed.value, updated: today } : a,
  );
}

/** True when a balance hasn't been touched for STALE_DAYS or more. */
export function isStale(account, today = new Date()) {
  if (!account.updated) return true;
  const [y, m, d] = account.updated.split("-").map(Number);
  const days =
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()) -
      new Date(y, m - 1, d)) /
    86_400_000;
  return days >= STALE_DAYS;
}

// ---------- Totals ----------

/** { assets, accountLiabilities, debtLiabilities, liabilities, netWorth }. Net worth can be negative. */
export function netWorthTotals(accounts, debts = []) {
  const list = readAccounts(accounts);
  const assets = sum(
    list.filter((a) => a.type === "asset"),
    balanceOf,
  );
  const accountLiabilities = sum(
    list.filter((a) => a.type === "liability"),
    balanceOf,
  );
  const debtLiabilities = sum(debts, (d) => d.balance);
  const liabilities = round2(accountLiabilities + debtLiabilities);
  return {
    assets,
    accountLiabilities,
    debtLiabilities,
    liabilities,
    netWorth: round2(assets - liabilities),
  };
}

// ---------- Monthly snapshots ----------

const isMonth = (k) => /^\d{4}-\d{2}$/.test(k);

/** Valid snapshots only; missing or broken history reads as {}. */
export function readHistory(settings) {
  const raw = settings?.netWorthHistory;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([k, v]) =>
        isMonth(k) &&
        Number.isFinite(v?.assets) &&
        Number.isFinite(v?.liabilities),
    ),
  );
}

/**
 * Records this month's totals. Idempotent: returns the SAME settings object when nothing
 * changed, so the App effect that calls it can't loop. Never writes any other month, and
 * records nothing while there are no accounts (net worth would just be minus your debts).
 */
export function recordSnapshot(settings, accounts, debts, today = new Date()) {
  if (readAccounts(accounts).length === 0) return settings;
  const month = monthKey(today);
  const history = readHistory(settings);
  const { assets, liabilities } = netWorthTotals(accounts, debts);
  const saved = history[month];
  if (saved && saved.assets === assets && saved.liabilities === liabilities)
    return settings;
  return {
    ...settings,
    netWorthHistory: { ...history, [month]: { assets, liabilities } },
  };
}

/** Snapshots oldest first, for the chart: [{ month, label, assets, liabilities, netWorth }]. */
export const historySeries = (settings) =>
  Object.entries(readHistory(settings))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, s]) => ({
      month,
      label: monthLabel(month, true),
      assets: s.assets,
      liabilities: s.liabilities,
      netWorth: round2(s.assets - s.liabilities),
    }));

/** Change since the latest snapshot before this month: { amount, since } or null if there's none. */
export function changeSinceLastSnapshot(
  settings,
  netWorth,
  today = new Date(),
) {
  const month = monthKey(today);
  const earlier = historySeries(settings)
    .filter((s) => s.month < month)
    .at(-1);
  return earlier
    ? { amount: round2(netWorth - earlier.netWorth), since: earlier.label }
    : null;
}

// ---------- Savings source (Forecast + emergency fund) ----------

/** Total of cash and savings accounts, and whether any exist. */
export function liquidSavings(accounts) {
  const liquid = readAccounts(accounts).filter(
    (a) => a.type === "asset" && LIQUID.has(a.kind),
  );
  return { amount: sum(liquid, balanceOf), count: liquid.length };
}

/**
 * The savings figure Forecast and the emergency fund use. The typed-in startingSavings is the
 * default; accounts are used only when the user chose them AND a cash/savings account exists.
 * `fellBack` tells the UI to explain why the typed amount is being used instead.
 */
export function savingsBalance(settings, accounts) {
  const manual = amount(settings?.startingSavings);
  const wantsAccounts = settings?.savingsSource === "accounts";
  const liquid = liquidSavings(accounts);
  if (wantsAccounts && liquid.count > 0)
    return { amount: liquid.amount, source: "accounts", fellBack: false };
  return { amount: manual, source: "manual", fellBack: wantsAccounts };
}
