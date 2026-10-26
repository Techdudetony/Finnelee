import { useEffect, useState } from 'react';

/**
 * Returns 'light' or 'dark' based on the operating system setting, and updates live
 * if the user switches. CSS handles most theming, but chart libraries like Recharts
 * need real color values in JavaScript, so components use this to pick a palette.
 */
export function useColorScheme() {
  const query = '(prefers-color-scheme: dark)';
  const [scheme, setScheme] = useState(() =>
    window.matchMedia?.(query).matches ? 'dark' : 'light'
  );

  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = (e) => setScheme(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    // Returning a function from useEffect = cleanup. React calls it on unmount
    // so we don't leak listeners.
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return scheme;
}
