import type { TodayDate } from "../model/dates";

/** One saved day as the server lists it; the server never reads page content. */
export type DailyNoteDateEntry = {
  date: TodayDate;
  revision: number;
  /** The page held no text when last saved. */
  empty: boolean;
  /** First line of text, for lists and the calendar. */
  preview: string;
  updatedAt: string;
};

export type DailyNoteSaveResult =
  | { status: "saved"; revision: number }
  /** Someone saved the day since `baseRevision`: merge `snapshot` and save again. */
  | { status: "conflict"; revision: number; snapshot: Uint8Array };

/**
 * Where pages persist. A page is one Loro snapshot per calendar day; the server stores the bytes
 * and a revision counter, so a second window or client merges instead of overwriting.
 */
export type DailyNotesRepoPort = {
  list(): Promise<readonly DailyNoteDateEntry[]>;
  load(date: TodayDate): Promise<{ revision: number; snapshot: Uint8Array | null }>;
  save(input: {
    date: TodayDate;
    snapshot: Uint8Array;
    baseRevision: number;
    empty: boolean;
    preview: string;
  }): Promise<DailyNoteSaveResult>;
};
