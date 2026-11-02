import { useEffect, useState } from "react";
import { monthKey } from "../utils/format";

// setTimeout can't wait longer than about 24.8 days (2^31 - 1 ms); longer waits fire at once.
const MAX_WAIT = 2 ** 31 - 1;

/** Milliseconds from `now` until the 1st of next month at 00:00 local time (at least 1). */
export function msUntilNextMonth(now) {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(1, next - now);
}

/**
 * This month as 'YYYY-MM', updated when the calendar month changes while the app is
 * open. One timer aimed at the next month boundary (no polling), re-aimed if it wakes
 * early; plus a check when the tab becomes visible again, since a sleeping computer or
 * a background tab can delay timers.
 */
export function useCurrentMonth() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  useEffect(() => {
    let timer = 0;
    const check = () => {
      setMonth(monthKey(new Date())); // same string = no rerender
      clearTimeout(timer);
      timer = setTimeout(check, Math.min(msUntilNextMonth(new Date()), MAX_WAIT));
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return month;
}
