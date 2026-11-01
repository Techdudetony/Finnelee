// Per-user storage keys. Each user's data lives under its own prefix:
//   finnelee.<userId>.transactions, finnelee.<userId>.budgets, ...
// so two people sharing a browser never see each other's numbers.

import { markNewAccount } from "../utils/onboarding";

export const DATA_SLICES = [
  "transactions",
  "budgets",
  "debts",
  "goals",
  "bills",
  "accounts", // net worth accounts
  "settings",
  "categories",
];

export const userKey = (userId, slice) => `finnelee.${userId}.${slice}`;

/** Write a full data set (e.g. sample data or an empty set) into a user's keys. */
export function seedUserData(userId, data) {
  for (const slice of DATA_SLICES) {
    if (data[slice] !== undefined)
      localStorage.setItem(userKey(userId, slice), JSON.stringify(data[slice]));
  }
}

/**
 * Before accounts existed, data was saved under "fb.*" keys. The first account
 * created on this browser adopts that data, so nothing you entered is lost.
 * Returns true if anything was copied.
 */
export function migrateLegacyData(userId) {
  let copied = false;
  for (const slice of DATA_SLICES) {
    const legacy = localStorage.getItem(`fb.${slice}`);
    if (legacy !== null) {
      localStorage.setItem(userKey(userId, slice), legacy);
      localStorage.removeItem(`fb.${slice}`);
      copied = true;
    }
  }
  return copied;
}

/**
 * After migrateLegacyData: old settings (if any) replaced the seeded ones, which held
 * the new-account mark for the guided tour (utils/tour.js). The account is still new,
 * so put the mark back on the migrated settings. Everything else is kept as migrated,
 * and settings that already have an onboarding record are left alone.
 */
export function keepNewAccountMark(userId) {
  const key = userKey(userId, "settings");
  let settings;
  try {
    settings = JSON.parse(localStorage.getItem(key));
  } catch {
    return; // unreadable: leave it exactly as migrated
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return;
  if (settings.onboarding) return;
  localStorage.setItem(key, JSON.stringify(markNewAccount(settings)));
}
