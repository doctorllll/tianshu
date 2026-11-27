/**
 * Daily notes: one outline page per calendar day. The server stores each page as an opaque
 * snapshot (the client's CRDT document, base64) with a revision, and never reads its content.
 * A save made against an old revision is refused with the current snapshot, so another window's
 * changes are merged by the client instead of overwritten.
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt } from "./baseSchemas.ts";

/** A local calendar day, `YYYY-MM-DD`. */
export const DailyNoteDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export type DailyNoteDate = typeof DailyNoteDate.Type;

/** Large enough for a day of tens of thousands of lines; a runaway client is refused. */
const DAILY_NOTE_MAX_SNAPSHOT_CHARS = 48 * 1024 * 1024;
const DailyNoteSnapshot = Schema.String.check(Schema.isMaxLength(DAILY_NOTE_MAX_SNAPSHOT_CHARS));

export const DailyNoteEntry = Schema.Struct({
  date: DailyNoteDate,
  revision: NonNegativeInt,
  /** The page held no text when it was last saved. */
  empty: Schema.Boolean,
  /** First line of text, for lists and the calendar. */
  preview: Schema.String,
  updatedAt: Schema.String,
});
export type DailyNoteEntry = typeof DailyNoteEntry.Type;

export const ListDailyNotesInput = Schema.Struct({});
export type ListDailyNotesInput = typeof ListDailyNotesInput.Type;

export const ListDailyNotesResult = Schema.Struct({
  days: Schema.Array(DailyNoteEntry),
});
export type ListDailyNotesResult = typeof ListDailyNotesResult.Type;

export const GetDailyNoteInput = Schema.Struct({ date: DailyNoteDate });
export type GetDailyNoteInput = typeof GetDailyNoteInput.Type;

export const GetDailyNoteResult = Schema.Struct({
  date: DailyNoteDate,
  /** 0 until the day is first saved. */
  revision: NonNegativeInt,
  /** Base64 of the page document; null until the day is first saved. */
  snapshot: Schema.NullOr(DailyNoteSnapshot),
});
export type GetDailyNoteResult = typeof GetDailyNoteResult.Type;

export const SaveDailyNoteInput = Schema.Struct({
  date: DailyNoteDate,
  /** The revision the page was loaded or last saved at. */
  baseRevision: NonNegativeInt,
  snapshot: DailyNoteSnapshot,
  empty: Schema.Boolean,
  preview: Schema.String.check(Schema.isMaxLength(400)),
});
export type SaveDailyNoteInput = typeof SaveDailyNoteInput.Type;

export const SaveDailyNoteResult = Schema.Struct({
  result: Schema.Literals(["saved", "conflict"]),
  revision: NonNegativeInt,
  /** The current snapshot, only when the save conflicted. */
  snapshot: Schema.NullOr(DailyNoteSnapshot),
});
export type SaveDailyNoteResult = typeof SaveDailyNoteResult.Type;

export class DailyNoteError extends Schema.TaggedError<DailyNoteError>()("DailyNoteError", {
  message: Schema.String,
}) {}
