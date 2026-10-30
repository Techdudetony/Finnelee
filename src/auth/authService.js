// Local authentication: accounts live in this browser's localStorage.
//
// Learning note: this is NOT production security. Anyone with access to this browser
// can read localStorage. Real apps keep users on a server (e.g. Supabase, Firebase,
// Auth0) and the browser only holds a session token. Every function below is async
// and returns plain objects on purpose, so you can later swap the bodies for real
// API calls without changing any React code that uses them.

const USERS_KEY = 'finnelee.users';
const SESSION_KEY = 'finnelee.session';
const ATTEMPTS_KEY = 'finnelee.recoveryAttempts';
const PBKDF2_ITERATIONS = 100_000;

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------
// Never store a password itself. We store a HASH: a one-way scramble that can be
// re-computed to check a login but can't be turned back into the password.
// PBKDF2 is deliberately slow (100k rounds) so guessing passwords is expensive,
// and a random SALT per user means two equal passwords produce different hashes.

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  // Web Crypto API (built into browsers): import the password as raw key material...
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // ...then stretch it into 256 bits of hash.
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { hash: toHex(bits), salt: toHex(salt) };
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY)) ?? {};
  } catch {
    return {};
  }
}
const writeUsers = (users) => localStorage.setItem(USERS_KEY, JSON.stringify(users));

/** Strip secret fields before handing a user object to the UI (it only learns IF a key exists). */
const publicUser = ({ id, name, email, createdAt, recoveryHash, recoveryCreatedAt }) => ({
  id,
  name,
  email,
  createdAt,
  hasRecoveryKey: Boolean(recoveryHash),
  recoveryCreatedAt: recoveryHash ? recoveryCreatedAt : null,
});

/** Emails are case-insensitive, so normalize before using one as a lookup key. */
const normalizeEmail = (email) => email.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Recovery keys (the "Forgot password?" flow)
// ---------------------------------------------------------------------------
// With no server, there's nobody to send a reset email. Instead each account gets a
// recovery key: a long random secret, shown ONCE, that can set a new password.
// Like the password, only a salted PBKDF2 hash of it is ever stored.

// 32 symbols without look-alikes (no 0/O, 1/I). 256 is a multiple of 32, so `byte & 31`
// picks every symbol with exactly equal odds: no modulo bias.
const KEY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const KEY_LENGTH = 24; // 24 symbols × 5 bits = 120 bits of randomness
export const MAX_RECOVERY_ATTEMPTS = 5;
export const RECOVERY_LOCK_MS = 5 * 60 * 1000;

/** A new key like 'K7QM-4T9X-PZ2C-R8HD-W3NF-6JVB', from the browser's secure random source. */
export function generateRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
  const symbols = [...bytes].map((b) => KEY_ALPHABET[b & 31]).join('');
  return symbols.match(/.{4}/g).join('-');
}

/** What people type -> what gets hashed: case, spaces and dashes don't matter. */
export const normalizeRecoveryKey = (key) => String(key ?? '').toUpperCase().replace(/[\s-]/g, '');

/** A fresh key plus the fields to store for it (hash + salt, never the key itself). */
async function newRecoveryFields() {
  const recoveryKey = generateRecoveryKey();
  const { hash, salt } = await hashPassword(normalizeRecoveryKey(recoveryKey));
  return {
    recoveryKey,
    fields: { recoveryHash: hash, recoverySalt: salt, recoveryCreatedAt: new Date().toISOString() },
  };
}

// Failed attempts per email: { [email]: { count, lockedUntil } }.
// A usability safeguard against guessing from this screen, NOT strong security:
// anyone with access to this browser can clear localStorage.
function readAttempts() {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)) ?? {};
  } catch {
    return {};
  }
}
const writeAttempts = (attempts) => localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));

/** Scores a password 0-4 with a label, for the sign-up meter (a hint, not a rule). */
export function passwordStrength(password) {
  const checks = [
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = password.length < 8 ? 0 : Math.max(1, checks.filter(Boolean).length); // 8+ chars is at least Weak
  return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const checkNewPassword = (password) => {
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
};

/** Creates the account and its first recovery key. Returns { user, isFirstUser, recoveryKey }. */
export async function signUp({ name, email, password }) {
  const key = normalizeEmail(email);
  if (!name.trim()) throw new Error('Please enter your name.');
  if (!/^\S+@\S+\.\S+$/.test(key)) throw new Error('Please enter a valid email address.');
  checkNewPassword(password);

  const users = readUsers();
  if (users[key]) throw new Error('An account with this email already exists.');

  const { hash, salt } = await hashPassword(password);
  const { recoveryKey, fields } = await newRecoveryFields();
  const user = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: key,
    createdAt: new Date().toISOString(),
    passwordHash: hash,
    salt,
    ...fields,
  };
  writeUsers({ ...users, [key]: user });
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
  return { user: publicUser(user), isFirstUser: Object.keys(users).length === 0, recoveryKey };
}

// Two tabs can run these at once. Without care both would "succeed" and one would show a
// key that already doesn't work. Two layers stop that:
// 1. A Web Lock (navigator.locks, built into modern browsers) shared by every tab of this
//    site: one reset or key change runs at a time, start to finish. The next one waits,
//    then reads the account fresh, so an already-used key is simply wrong.
// 2. Compare-and-swap for browsers without Web Locks: re-read the account right before the
//    single write and give up if the key changed meanwhile (no `await` between the two).
const RECOVERY_LOCK = 'finnelee.recovery';
const KEY_CHANGED = 'Your recovery key was just changed in another tab. Reload and try again.';
const withRecoveryLock = (task) => {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(RECOVERY_LOCK, task) : task();
};

/**
 * Sets a new password with the recovery key, then replaces the key (a used key may have
 * been seen). Everything is computed first and saved in ONE write, so the account never
 * ends up half-changed. Returns { user, recoveryKey } with the NEW key to show once.
 */
export function resetPassword(details, now = Date.now()) {
  return withRecoveryLock(() => resetPasswordNow(details, now));
}

async function resetPasswordNow({ email, recoveryKey, newPassword }, now) {
  const key = normalizeEmail(email);
  const attempts = readAttempts();
  const record = attempts[key] ?? { count: 0, lockedUntil: 0 };
  if (record.lockedUntil > now) {
    const minutes = Math.ceil((record.lockedUntil - now) / 60_000);
    throw new Error(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  checkNewPassword(newPassword);

  const users = readUsers();
  const user = users[key];
  // Same message for no account, no key set, and a wrong key.
  const fail = () => {
    const count = record.lockedUntil && record.lockedUntil <= now ? 1 : record.count + 1; // lock expired: start over
    const locked = count >= MAX_RECOVERY_ATTEMPTS;
    writeAttempts({
      ...attempts,
      [key]: { count: locked ? 0 : count, lockedUntil: locked ? now + RECOVERY_LOCK_MS : 0 },
    });
    return new Error('Email or recovery key is incorrect.');
  };
  if (!user?.recoveryHash) throw fail();
  const { hash: keyHash } = await hashPassword(normalizeRecoveryKey(recoveryKey), user.recoverySalt);
  if (keyHash !== user.recoveryHash) throw fail();

  const { hash, salt } = await hashPassword(newPassword);
  const next = await newRecoveryFields();
  // Hashing took time, so another tab may have used this key meanwhile: check again.
  const current = readUsers();
  if (current[key]?.recoveryHash !== user.recoveryHash) throw new Error(KEY_CHANGED);
  const updated = { ...current[key], passwordHash: hash, salt, ...next.fields };
  writeUsers({ ...current, [key]: updated }); // the one write: new password + new key together
  const { [key]: _cleared, ...otherAttempts } = attempts; // _cleared: success resets the counter
  writeAttempts(otherAttempts);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: updated.id }));
  return { user: publicUser(updated), recoveryKey: next.recoveryKey };
}

/**
 * Creates or replaces the signed-in user's recovery key after checking their password.
 * The old key stops working in the same write. Returns { user, recoveryKey }.
 * seenCreatedAt: the user.recoveryCreatedAt this tab is showing. If another tab changed
 * the key since, this one stops instead of silently replacing a key just shown there.
 */
export function createRecoveryKey(userId, password, seenCreatedAt) {
  return withRecoveryLock(() => createRecoveryKeyNow(userId, password, seenCreatedAt));
}

async function createRecoveryKeyNow(userId, password, seenCreatedAt) {
  const users = readUsers();
  const entry = Object.entries(users).find(([, u]) => u.id === userId);
  if (!entry) throw new Error('User not found.');
  const [key, user] = entry;
  if (seenCreatedAt !== undefined && publicUser(user).recoveryCreatedAt !== seenCreatedAt)
    throw new Error(KEY_CHANGED);
  const { hash } = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) throw new Error('Password is incorrect.');
  const { recoveryKey, fields } = await newRecoveryFields();
  const current = readUsers(); // same re-check as resetPassword
  if (current[key]?.recoveryHash !== user.recoveryHash) throw new Error(KEY_CHANGED);
  const updated = { ...current[key], ...fields };
  writeUsers({ ...current, [key]: updated });
  return { user: publicUser(updated), recoveryKey };
}

export async function signIn({ email, password }) {
  const user = readUsers()[normalizeEmail(email)];
  // Same message for "no such user" and "wrong password" so attackers can't
  // discover which emails have accounts.
  const fail = new Error('Email or password is incorrect.');
  if (!user) throw fail;
  const { hash } = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) throw fail;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
  return publicUser(user);
}

export async function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

/** Returns the signed-in user (or null) so a page reload keeps you logged in. */
export async function getCurrentUser() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!session) return null;
    const user = Object.values(readUsers()).find((u) => u.id === session.userId);
    return user ? publicUser(user) : null;
  } catch {
    return null;
  }
}

/** Update profile fields (currently just the display name). */
export async function updateProfile(userId, { name }) {
  const users = readUsers();
  const entry = Object.entries(users).find(([, u]) => u.id === userId);
  if (!entry) throw new Error('User not found.');
  const [key, user] = entry;
  const updated = { ...user, name: name.trim() || user.name };
  writeUsers({ ...users, [key]: updated });
  return publicUser(updated);
}
