// Local authentication: accounts live in this browser's localStorage.
//
// Learning note: this is NOT production security. Anyone with access to this browser
// can read localStorage. Real apps keep users on a server (e.g. Supabase, Firebase,
// Auth0) and the browser only holds a session token. Every function below is async
// and returns plain objects on purpose, so you can later swap the bodies for real
// API calls without changing any React code that uses them.

const USERS_KEY = 'finnelee.users';
const SESSION_KEY = 'finnelee.session';
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

/** Strip secret fields before handing a user object to the UI. */
const publicUser = ({ id, name, email, createdAt }) => ({ id, name, email, createdAt });

/** Emails are case-insensitive, so normalize before using one as a lookup key. */
const normalizeEmail = (email) => email.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function signUp({ name, email, password }) {
  const key = normalizeEmail(email);
  if (!name.trim()) throw new Error('Please enter your name.');
  if (!/^\S+@\S+\.\S+$/.test(key)) throw new Error('Please enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  const users = readUsers();
  if (users[key]) throw new Error('An account with this email already exists.');

  const { hash, salt } = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: key,
    createdAt: new Date().toISOString(),
    passwordHash: hash,
    salt,
  };
  writeUsers({ ...users, [key]: user });
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
  return { user: publicUser(user), isFirstUser: Object.keys(users).length === 0 };
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
