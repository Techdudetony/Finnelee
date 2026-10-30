import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as auth from './authService';
import { migrateLegacyData, seedUserData } from './userStorage';
import { emptyData, generateSampleData } from '../data/sampleData';

// React Context lets any component read the current user without passing it
// down through every level as a prop ("prop drilling").
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until we've checked for a saved session
  const [freshLogin, setFreshLogin] = useState(false); // true right after sign in: shows the welcome summary
  // A new recovery key waiting to be shown ONCE: { key, reason: 'signup' | 'reset' | 'created' }.
  // Kept only in memory; it's gone after the save-key dialog closes or the page reloads.
  const [newRecoveryKey, setNewRecoveryKey] = useState(null);

  // On first load, restore the session so a page refresh doesn't log you out.
  useEffect(() => {
    auth.getCurrentUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  // useCallback keeps the same function identity between renders, so children
  // that receive these functions don't re-render unnecessarily.
  const signUp = useCallback(async ({ name, email, password, withSampleData }) => {
    const { user: newUser, isFirstUser, recoveryKey } = await auth.signUp({ name, email, password });
    seedUserData(newUser.id, withSampleData ? generateSampleData() : emptyData());
    // The first account on this browser also adopts any data saved before accounts
    // existed. It's copied after seeding, so the old data wins wherever it exists.
    if (isFirstUser) migrateLegacyData(newUser.id);
    setNewRecoveryKey({ key: recoveryKey, reason: 'signup' }); // set before the user, so it shows first
    setUser(newUser);
    setFreshLogin(true);
  }, []);

  // Forgot password: new password + new key in one step, then signed in.
  const resetPassword = useCallback(async (form) => {
    const { user: updated, recoveryKey } = await auth.resetPassword(form);
    setNewRecoveryKey({ key: recoveryKey, reason: 'reset' });
    setUser(updated);
    setFreshLogin(true);
  }, []);

  // Settings: create or replace the key (needs the current password).
  const createRecoveryKey = useCallback(async (password) => {
    const { user: updated, recoveryKey } = await auth.createRecoveryKey(user.id, password, user.recoveryCreatedAt);
    setNewRecoveryKey({ key: recoveryKey, reason: 'created' });
    setUser(updated);
  }, [user]);

  const signIn = useCallback(async (credentials) => {
    setUser(await auth.signIn(credentials));
    setFreshLogin(true);
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setUser(null);
    setFreshLogin(false);
    setNewRecoveryKey(null);
  }, []);

  const updateProfile = useCallback(async (fields) => {
    setUser(await auth.updateProfile(user.id, fields));
  }, [user]);

  // useMemo: only build a new context object when something in it changes.
  const value = useMemo(
    () => ({
      user,
      loading,
      freshLogin,
      clearFreshLogin: () => setFreshLogin(false),
      newRecoveryKey,
      clearNewRecoveryKey: () => setNewRecoveryKey(null),
      signUp,
      signIn,
      signOut,
      updateProfile,
      resetPassword,
      createRecoveryKey,
    }),
    [user, loading, freshLogin, newRecoveryKey, signUp, signIn, signOut, updateProfile, resetPassword, createRecoveryKey]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Custom hook: `const { user, signOut } = useAuth();` from any component. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
