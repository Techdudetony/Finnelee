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
    const { user: newUser, isFirstUser } = await auth.signUp({ name, email, password });
    seedUserData(newUser.id, withSampleData ? generateSampleData() : emptyData());
    // The first account on this browser also adopts any data saved before accounts
    // existed. It's copied after seeding, so the old data wins wherever it exists.
    if (isFirstUser) migrateLegacyData(newUser.id);
    setUser(newUser);
    setFreshLogin(true);
  }, []);

  const signIn = useCallback(async (credentials) => {
    setUser(await auth.signIn(credentials));
    setFreshLogin(true);
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setUser(null);
    setFreshLogin(false);
  }, []);

  const updateProfile = useCallback(async (fields) => {
    setUser(await auth.updateProfile(user.id, fields));
  }, [user]);

  // useMemo: only build a new context object when something in it changes.
  const value = useMemo(
    () => ({ user, loading, freshLogin, clearFreshLogin: () => setFreshLogin(false), signUp, signIn, signOut, updateProfile }),
    [user, loading, freshLogin, signUp, signIn, signOut, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Custom hook: `const { user, signOut } = useAuth();` from any component. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
