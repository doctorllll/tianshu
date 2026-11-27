import type { AnyRouter } from "@tanstack/react-router";

import type { TodaySearch } from "../model/dates";
import { useDailyNotesPrefs } from "../state/dailyNotesPrefs";

const COMPACT_QUERY = "(max-width: 767px)";

/** The pinned column cannot appear in a compact window; the notes then open as a page. */
const isDailyNotesColumnAvailable = () =>
  typeof window === "undefined" || !window.matchMedia(COMPACT_QUERY).matches;

/**
 * Opens the daily notes: while pinned, the column moves to `target` and the main area keeps its
 * content; otherwise the notes open as the page.
 */
export function openDailyNotes(router: Pick<AnyRouter, "navigate">, target: TodaySearch = {}) {
  const prefs = useDailyNotesPrefs.getState();
  if (!prefs.enabled) return;
  if (prefs.pinned && isDailyNotesColumnAvailable()) {
    prefs.setPinnedTarget(target);
    return;
  }
  void router.navigate({ to: "/daily-notes", search: target });
}
