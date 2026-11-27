import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Where the pinned column stands and how wide the notes read; kept on this device only. */
export const PINNED_COLUMN_MIN_WIDTH = 280;
export const PINNED_COLUMN_MAX_WIDTH = 640;
export const PINNED_COLUMN_DEFAULT_WIDTH = 360;

export const clampPinnedWidth = (width: number) =>
  Math.min(PINNED_COLUMN_MAX_WIDTH, Math.max(PINNED_COLUMN_MIN_WIDTH, Math.round(width)));

interface DailyNotesPrefs {
  /** The "Daily notes" experiment: when off, the entry, page and column are not mounted. */
  enabled: boolean;
  pinned: boolean;
  pinnedWidth: number;
  /** Span the whole main area instead of the readable column. */
  fullWidth: boolean;
  setEnabled: (enabled: boolean) => void;
  setPinned: (pinned: boolean) => void;
  setPinnedWidth: (width: number) => void;
  setFullWidth: (fullWidth: boolean) => void;
}

export const useDailyNotesPrefs = create<DailyNotesPrefs>()(
  persist(
    (set) => ({
      enabled: true,
      pinned: false,
      pinnedWidth: PINNED_COLUMN_DEFAULT_WIDTH,
      fullWidth: false,
      setEnabled: (enabled) => set({ enabled }),
      setPinned: (pinned) => set({ pinned }),
      setPinnedWidth: (width) => set({ pinnedWidth: clampPinnedWidth(width) }),
      setFullWidth: (fullWidth) => set({ fullWidth }),
    }),
    {
      name: "tianshu:daily-notes:v1",
      partialize: ({ enabled, pinned, pinnedWidth, fullWidth }) => ({
        enabled,
        pinned,
        pinnedWidth,
        fullWidth,
      }),
      merge: (stored, current) => {
        const value = (stored ?? {}) as Partial<
          Pick<DailyNotesPrefs, "enabled" | "pinned" | "pinnedWidth" | "fullWidth">
        >;
        return {
          ...current,
          enabled: value.enabled !== false,
          pinned: value.pinned === true,
          pinnedWidth:
            typeof value.pinnedWidth === "number"
              ? clampPinnedWidth(value.pinnedWidth)
              : PINNED_COLUMN_DEFAULT_WIDTH,
          fullWidth: value.fullWidth === true,
        };
      },
    },
  ),
);
