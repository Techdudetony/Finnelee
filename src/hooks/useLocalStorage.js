import { useEffect, useState } from 'react';

/**
 * Drop-in replacement for useState that also saves the value to localStorage.
 *
 *   const [items, setItems] = useLocalStorage('my-key', []);
 *
 * - localStorage only stores strings, so we JSON.stringify on save and JSON.parse on load.
 * - `initialValue` is used only when nothing is saved yet (first visit).
 */
export function useLocalStorage(key, initialValue) {
  // Passing a function to useState = "lazy initial state": it runs once, not on every render.
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return JSON.parse(saved);
    } catch {
      // Storage can be blocked (private mode) or hold corrupt JSON; fall back to the default.
    }
    return typeof initialValue === 'function' ? initialValue() : initialValue;
  });

  // Every time `value` changes, write it back. useEffect runs after React updates the screen.
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage blocked: the app still works, it just won't persist.
    }
  }, [key, value]);

  return [value, setValue];
}
