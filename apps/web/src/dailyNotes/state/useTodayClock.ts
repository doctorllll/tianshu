import { useEffect, useState } from "react";

import { localTodayDate, msUntilNextLocalMidnight, type TodayDate } from "../model/dates";

/** Fallback poll in case a sleeping timer missed midnight. */
const TODAY_CLOCK_FALLBACK_MS = 60_000;

/** The local date, rolling over at midnight and rechecked when the window shows or focuses again. */
export function useTodayClock(): TodayDate {
  const [today, setToday] = useState(() => localTodayDate(new Date()));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const now = new Date();
      setToday(localTodayDate(now));
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, msUntilNextLocalMidnight(now) + 50);
    };
    check();
    const interval = setInterval(check, TODAY_CLOCK_FALLBACK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  return today;
}
