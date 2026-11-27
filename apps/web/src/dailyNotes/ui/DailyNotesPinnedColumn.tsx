import { useState } from "react";

import { useIsMobile } from "~/hooks/useMediaQuery";
import { useResizeDrag } from "~/hooks/useResizeDrag";

import {
  clampPinnedWidth,
  PINNED_COLUMN_MAX_WIDTH,
  PINNED_COLUMN_MIN_WIDTH,
  useDailyNotesPrefs,
} from "../state/dailyNotesPrefs";
import { TodayView } from "./DailyNotesView";
import { useOpenThreadMention } from "./DailyNotesPage";

/**
 * The daily notes pinned as a column between the sidebar and the main area. The width is kept on
 * this device; a window too narrow for it shows the notes as a page instead.
 */
export function DailyNotesPinnedColumn() {
  const enabled = useDailyNotesPrefs((prefs) => prefs.enabled);
  const pinned = useDailyNotesPrefs((prefs) => prefs.pinned);
  const width = useDailyNotesPrefs((prefs) => prefs.pinnedWidth);
  const target = useDailyNotesPrefs((prefs) => prefs.pinnedTarget);
  const setPinned = useDailyNotesPrefs((prefs) => prefs.setPinned);
  const setWidth = useDailyNotesPrefs((prefs) => prefs.setPinnedWidth);
  const setTarget = useDailyNotesPrefs((prefs) => prefs.setPinnedTarget);
  const compact = useIsMobile();
  const openThread = useOpenThreadMention();
  const [dragging, setDragging] = useState(false);
  const resize = useResizeDrag<HTMLDivElement>(() => ({
    width,
    edge: "right",
    bounds: { min: PINNED_COLUMN_MIN_WIDTH, max: PINNED_COLUMN_MAX_WIDTH },
    resize(next) {
      setDragging(true);
      setWidth(next);
      return clampPinnedWidth(next);
    },
    finish() {
      setDragging(false);
    },
    cleanup() {
      setDragging(false);
    },
  }));
  if (!enabled || !pinned || compact) return null;
  return (
    <aside
      className="relative my-2 me-2 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl bg-background shadow-sm/5 ring-1 ring-border/60"
      style={{ width }}
      aria-label="Daily notes"
      data-testid="daily-notes-pinned-column"
    >
      <TodayView
        target={target}
        onNavigate={setTarget}
        surface="pinned"
        onTogglePin={() => setPinned(false)}
        onOpenThread={openThread}
      />
      <div
        ref={resize.ref}
        role="separator"
        aria-orientation="vertical"
        className={`absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-border/60 ${dragging ? "bg-border" : ""}`}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
        onPointerCancel={resize.onPointerCancel}
        onLostPointerCapture={resize.onLostPointerCapture}
      />
    </aside>
  );
}
