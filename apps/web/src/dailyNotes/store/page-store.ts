/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/lib/today/today-page-store.ts.
 * Modified for Tianshu: the page persists as one snapshot per day through a revisioned save instead of
 * joining a sync room.
 */
import type { LoroDoc } from "../loro";

import type { TodayDate } from "../model/dates";
import {
  createTodayPageUndo,
  openTodayOutline,
  type TodayOutline,
  type TodayPageSnapshot,
  type TodayPageUndo,
} from "../model/outline";
import type { DailyNoteDateEntry, DailyNotesRepoPort } from "./repo-port";

/** How long typing must pause before the page is saved. */
export const DAILY_NOTE_SAVE_DEBOUNCE_MS = 600;
/** A conflict is merged and retried at once; this many in a row means something else is wrong. */
const MAX_CONFLICT_ROUNDS = 5;
const PREVIEW_LENGTH = 120;

/**
 * One open day: its outline model, undo, and persistence. Viewing a day creates nothing on
 * disk; a page is first saved when it holds text. After that every change is saved, and a save
 * that finds the day changed elsewhere merges that version in (Loro) and saves again.
 */
export type TodayPageStore = {
  /** Same as `date`; the key the page cache and the editor controller use. */
  readonly docId: string;
  readonly date: TodayDate;
  readonly outline: TodayOutline;
  readonly undo: TodayPageUndo;
  getSnapshot(): TodayPageSnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves once every change so far is saved (or the page is empty and never saved). */
  flush(): Promise<void>;
  /** Pull the saved version in when another window saved it; a no-op while this page has unsaved changes. */
  syncFromServer(): Promise<void>;
  /** Stops timers and starts a final save; `flush()` still resolves once it lands. */
  dispose(): void;
};

export function previewOfSnapshot(snapshot: TodayPageSnapshot): string {
  for (const node of snapshot.visible) {
    const text = node.text.replaceAll("￼", "").replaceAll(/\s+/g, " ").trim();
    if (text) return text.slice(0, PREVIEW_LENGTH);
  }
  return "";
}

export function createTodayPageStore(options: {
  date: TodayDate;
  doc: LoroDoc;
  /** Revision the page was loaded at; 0 when the day has never been saved. */
  revision: number;
  repo: Pick<DailyNotesRepoPort, "save" | "load">;
  setTimer: (callback: () => void, ms: number) => () => void;
  retryDelayMs: (attempt: number) => number;
  debounceMs?: number;
  onSaved?: (entry: Pick<DailyNoteDateEntry, "date" | "revision" | "empty" | "preview">) => void;
  onBackgroundError?: (error: unknown) => void;
}): TodayPageStore {
  const { doc, date } = options;
  const outline = openTodayOutline(doc);
  const undo = createTodayPageUndo(doc, { setTimer: options.setTimer });
  const listeners = new Set<() => void>();
  let snapshot = outline.getSnapshot();
  let disposed = false;
  let revision = options.revision;
  let everSaved = options.revision > 0;
  let dirty = false;
  let saving: Promise<void> | undefined;
  let failures = 0;
  let cancelTimer: (() => void) | undefined;

  const clearTimer = () => {
    cancelTimer?.();
    cancelTimer = undefined;
  };
  const schedule = (ms: number) => {
    if (disposed) return;
    clearTimer();
    cancelTimer = options.setTimer(() => {
      cancelTimer = undefined;
      void persist();
    }, ms);
  };

  /** Save until nothing is left unsaved; one round trip at a time. */
  async function persistRounds(): Promise<void> {
    let conflicts = 0;
    while (dirty) {
      const empty = outline.getSnapshot().isEmpty;
      // Viewing or clicking an empty day writes nothing.
      if (empty && !everSaved) {
        dirty = false;
        return;
      }
      dirty = false;
      const bytes = doc.export({ mode: "snapshot" });
      const result = await options.repo
        .save({
          date,
          snapshot: bytes,
          baseRevision: revision,
          empty,
          preview: previewOfSnapshot(outline.getSnapshot()),
        })
        .catch((error: unknown) => {
          dirty = true;
          throw error;
        });
      if (result.status === "conflict") {
        doc.import(result.snapshot);
        revision = result.revision;
        dirty = true;
        conflicts += 1;
        if (conflicts >= MAX_CONFLICT_ROUNDS) throw new Error("Daily note save kept conflicting");
        continue;
      }
      revision = result.revision;
      everSaved = true;
      failures = 0;
      options.onSaved?.({
        date,
        revision,
        empty,
        preview: previewOfSnapshot(outline.getSnapshot()),
      });
    }
  }

  function persist(): Promise<void> {
    if (saving) return saving;
    saving = persistRounds()
      .catch((error: unknown) => {
        options.onBackgroundError?.(error);
        if (!disposed) {
          const delay = options.retryDelayMs(failures);
          failures += 1;
          schedule(delay);
        }
      })
      .finally(() => {
        saving = undefined;
        if (dirty && !cancelTimer && !disposed)
          schedule(options.debounceMs ?? DAILY_NOTE_SAVE_DEBOUNCE_MS);
      });
    return saving;
  }

  const refresh = () => {
    snapshot = outline.getSnapshot();
    for (const listener of listeners) listener();
  };
  const unsubscribeDoc = doc.subscribe(refresh);
  // A fold this viewer kept while another window changed it can be rewritten to the document's
  // value without a document change.
  const unsubscribeView = outline.onViewChange(refresh);
  const unsubscribeLocal = doc.subscribeLocalUpdates(() => {
    dirty = true;
    // A failing backend waits out its backoff instead of being hit on every keystroke.
    if (failures > 0 && cancelTimer) return;
    schedule(options.debounceMs ?? DAILY_NOTE_SAVE_DEBOUNCE_MS);
  });

  return {
    docId: date,
    date,
    outline,
    undo,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: async () => {
      clearTimer();
      await persist();
      if ((dirty || saving) && failures === 0) await persist();
    },
    syncFromServer: async () => {
      if (disposed || dirty || saving) return;
      const loaded = await options.repo.load(date);
      if (disposed || dirty || saving || loaded.revision === revision) return;
      if (loaded.snapshot) doc.import(loaded.snapshot);
      revision = loaded.revision;
      everSaved = loaded.revision > 0;
    },
    dispose: () => {
      clearTimer();
      disposed = true;
      unsubscribeDoc();
      unsubscribeView();
      unsubscribeLocal();
      listeners.clear();
      // The model stays alive until the final save has read it.
      const closeModel = () => {
        outline.dispose();
        undo.dispose();
      };
      if (dirty || saving) void persist().finally(closeModel);
      else closeModel();
    },
  };
}
