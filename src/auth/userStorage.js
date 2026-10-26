// Per-user storage keys. Each user's data lives under its own prefix:
//   finnelee.<userId>.transactions, finnelee.<userId>.budgets, ...
// so two people sharing a browser never see each other's numbers.

export const DATA_SLICES = ['transactions', 'budgets', 'debts', 'goals', 'bills', 'settings'];

export const userKey = (userId, slice) => `finnelee.${userId}.${slice}`;

/** Write a full data set (e.g. sample data or an empty set) into a user's keys. */
export function seedUserData(userId, data) {
  for (const slice of DATA_SLICES) {
    if (data[slice] !== undefined) localStorage.setItem(userKey(userId, slice), JSON.stringify(data[slice]));
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
