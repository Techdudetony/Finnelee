import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_LOCK_MS,
  createRecoveryKey,
  generateRecoveryKey,
  getCurrentUser,
  normalizeRecoveryKey,
  passwordStrength,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from './authService';

// Tests run in Node, which has Web Crypto but no localStorage: a tiny in-memory stand-in.
const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
    dump: () => Object.fromEntries(data),
  };
};
beforeEach(() => {
  globalThis.localStorage = memoryStorage();
});

const users = () => JSON.parse(localStorage.getItem('finnelee.users'));
const ANA = { name: 'Ana', email: 'Ana@Example.com', password: 'first-password' };

describe('recovery keys', () => {
  it('have 6 groups of 4 symbols from the 32-letter alphabet', () => {
    for (let i = 0; i < 50; i++)
      expect(generateRecoveryKey()).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){5}$/);
  });

  it('are unique and use every symbol about equally (no modulo bias)', () => {
    const keys = Array.from({ length: 2000 }, generateRecoveryKey);
    expect(new Set(keys).size).toBe(keys.length);
    const counts = {};
    for (const ch of keys.join('').replace(/-/g, '')) counts[ch] = (counts[ch] ?? 0) + 1;
    expect(Object.keys(counts)).toHaveLength(32);
    const expected = (2000 * 24) / 32; // 1500 each
    for (const n of Object.values(counts)) expect(Math.abs(n - expected)).toBeLessThan(expected * 0.15);
  });

  it('ignore case, spaces and dashes when typed', () => {
    expect(normalizeRecoveryKey(' k7qm-4t9x pz2c ')).toBe('K7QM4T9XPZ2C');
  });
});

describe('sign up', () => {
  it('returns a key once and stores only its salted hash', async () => {
    const { user, recoveryKey } = await signUp(ANA);
    expect(user).toMatchObject({ name: 'Ana', email: 'ana@example.com', hasRecoveryKey: true });
    expect(user.recoveryHash).toBeUndefined(); // secrets never reach the UI
    const stored = users()['ana@example.com'];
    expect(stored.recoveryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.recoverySalt).toMatch(/^[0-9a-f]{32}$/);
    const everything = JSON.stringify(localStorage.dump());
    expect(everything).not.toContain(recoveryKey);
    expect(everything).not.toContain(normalizeRecoveryKey(recoveryKey));
    expect(everything).not.toContain(ANA.password);
  });
});

describe('resetPassword', () => {
  it('sets the new password, rotates the key and signs in; data keys are untouched', async () => {
    const { user, recoveryKey } = await signUp(ANA);
    localStorage.setItem(`finnelee.${user.id}.transactions`, '[{"id":"t1"}]');
    await signOut();

    const result = await resetPassword({ email: 'ana@example.com', recoveryKey: recoveryKey.toLowerCase().replace(/-/g, ' '), newPassword: 'second-password' });
    expect(result.user.id).toBe(user.id);
    expect(result.recoveryKey).not.toBe(recoveryKey);
    expect((await getCurrentUser()).id).toBe(user.id);
    expect(localStorage.getItem(`finnelee.${user.id}.transactions`)).toBe('[{"id":"t1"}]');

    await expect(signIn({ email: ANA.email, password: ANA.password })).rejects.toThrow(/incorrect/);
    expect((await signIn({ email: ANA.email, password: 'second-password' })).id).toBe(user.id);
    // The used key no longer works; the new one does.
    await expect(resetPassword({ email: ANA.email, recoveryKey, newPassword: 'third-password' })).rejects.toThrow(/incorrect/);
    await expect(resetPassword({ email: ANA.email, recoveryKey: result.recoveryKey, newPassword: 'third-password' })).resolves.toBeTruthy();
  });

  it('gives the same message for a wrong key, an unknown email and an account with no key', async () => {
    await signUp(ANA);
    const old = { id: 'u2', name: 'Old', email: 'old@example.com', passwordHash: 'x', salt: '00' }; // pre-recovery account
    localStorage.setItem('finnelee.users', JSON.stringify({ ...users(), 'old@example.com': old }));
    const attempt = (email) => resetPassword({ email, recoveryKey: 'AAAA-AAAA', newPassword: 'whatever-123' });
    await expect(attempt('ana@example.com')).rejects.toThrow('Email or recovery key is incorrect.');
    await expect(attempt('nobody@example.com')).rejects.toThrow('Email or recovery key is incorrect.');
    await expect(attempt('old@example.com')).rejects.toThrow('Email or recovery key is incorrect.');
  });

  it('rejects a short new password without counting an attempt or changing anything', async () => {
    const { recoveryKey } = await signUp(ANA);
    const before = localStorage.getItem('finnelee.users');
    await expect(resetPassword({ email: ANA.email, recoveryKey, newPassword: 'short' })).rejects.toThrow(/8 characters/);
    expect(localStorage.getItem('finnelee.users')).toBe(before);
    expect(localStorage.getItem('finnelee.recoveryAttempts')).toBe(null);
  });

  it('pauses after 5 failed attempts, then allows trying again after 5 minutes', async () => {
    const { recoveryKey } = await signUp(ANA);
    const t0 = 1_000_000;
    const wrong = (now) => resetPassword({ email: ANA.email, recoveryKey: 'WRONG', newPassword: 'new-password' }, now);
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) await expect(wrong(t0 + i)).rejects.toThrow(/incorrect/);
    // Locked: even the right key is refused, without revealing whether it was right.
    await expect(resetPassword({ email: ANA.email, recoveryKey, newPassword: 'new-password' }, t0 + 10)).rejects.toThrow(/Try again in 5 minutes/);
    const after = t0 + 10 + RECOVERY_LOCK_MS;
    await expect(resetPassword({ email: ANA.email, recoveryKey, newPassword: 'new-password' }, after)).resolves.toBeTruthy();
    expect(localStorage.getItem('finnelee.recoveryAttempts')).toBe('{}'); // success clears the counter
  });
});

describe('createRecoveryKey (Settings)', () => {
  it('needs the current password and replaces the old key', async () => {
    const { user, recoveryKey: first } = await signUp(ANA);
    await expect(createRecoveryKey(user.id, 'wrong-password')).rejects.toThrow(/Password is incorrect/);
    const { recoveryKey: second, user: updated } = await createRecoveryKey(user.id, ANA.password);
    expect(updated.hasRecoveryKey).toBe(true);
    await signOut();
    await expect(resetPassword({ email: ANA.email, recoveryKey: first, newPassword: 'new-password' })).rejects.toThrow(/incorrect/);
    await expect(resetPassword({ email: ANA.email, recoveryKey: second, newPassword: 'new-password' })).resolves.toBeTruthy();
  });

  it('gives an older account (no key yet) its first key', async () => {
    const { user } = await signUp(ANA);
    const { recoveryHash, recoverySalt, recoveryCreatedAt, ...withoutKey } = users()['ana@example.com'];
    localStorage.setItem('finnelee.users', JSON.stringify({ 'ana@example.com': withoutKey }));
    expect((await getCurrentUser()).hasRecoveryKey).toBe(false);
    const { user: updated } = await createRecoveryKey(user.id, ANA.password);
    expect(updated.hasRecoveryKey).toBe(true);
  });
});

describe('passwordStrength', () => {
  it('scores length and variety', () => {
    expect(passwordStrength('short').label).toBe('Too short');
    expect(passwordStrength('abcdefgh').label).toBe('Weak');
    expect(passwordStrength('abcdefgh1').label).toBe('Weak');
    expect(passwordStrength('Abcdefgh1').label).toBe('Fair');
    expect(passwordStrength('Abcdefgh1!').label).toBe('Good');
    expect(passwordStrength('Abcdefghijk1!').label).toBe('Strong');
  });
});
