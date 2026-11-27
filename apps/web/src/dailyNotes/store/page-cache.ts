/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/providers/today-page-store-cache.ts.
 * Modified for Tianshu: one local author and a revisioned snapshot repo instead of synced rooms.
 */
import { LoroDoc } from "loro-crdt";

import type { TodayDate } from "../model/dates";
import { configureTodayTextStyles } from "../model/outline";
import { createTodayPageStore, type TodayPageStore } from "./page-store";
import { createManagedStoreCache } from "./ref-tracker";
import type { DailyNoteDateEntry, DailyNotesRepoPort } from "./repo-port";

/**
 * Cache of open pages plus the index of saved days. Released pages stay warm for
 * `releaseDelayMs`, but at most `idleCap` idle pages are kept: scrolling through many days must
 * not keep every document open. A page someone still holds (viewport, focus, selection, drag
 * source) is never evicted.
 */
export type TodayPageStoreCache = {
  acquire(docId: string): Promise<TodayPageStore>;
  releaseRef(docId: string): void;
  peek(docId: string): TodayPageStore | undefined;
  /** Saved days, newest first; the listener runs at once and on every change. */
  observeDates(listener: (entries: readonly DailyNoteDateEntry[]) => void): () => void;
  /** Re-read the index and pull in days another window saved. */
  refresh(): Promise<void>;
  /** Saves every open page's pending changes. */
  flushAll(): Promise<void>;
  releaseIdle(): Promise<void>;
  disposeAll(): Promise<void>;
};

export function createTodayPageStoreCache(options: {
  repo: DailyNotesRepoPort;
  releaseDelayMs: number;
  idleCap: number;
  setTimer: (callback: () => void, ms: number) => () => void;
  retryDelayMs: (attempt: number) => number;
  debounceMs?: number;
  onBackgroundError?: (date: TodayDate, error: unknown) => void;
}): TodayPageStoreCache {
  const { repo } = options;
  const entries = new Map<TodayDate, DailyNoteDateEntry>();
  const dateListeners = new Set<(entries: readonly DailyNoteDateEntry[]) => void>();
  let indexLoaded: Promise<void> | undefined;
  // Final saves of released pages, awaited before the same day is opened again.
  const closing = new Map<string, Promise<void>>();
  const open = new Map<string, TodayPageStore>();

  const sorted = () => [...entries.values()].toSorted((a, b) => (a.date < b.date ? 1 : -1));
  const emit = () => {
    const list = sorted();
    for (const listener of dateListeners) listener(list);
  };

  const loadIndex = () => {
    indexLoaded ??= repo
      .list()
      .then((list) => {
        for (const entry of list) {
          const known = entries.get(entry.date);
          if (!known || known.revision <= entry.revision) entries.set(entry.date, entry);
        }
        emit();
      })
      .catch((error: unknown) => {
        // The index is a hint: pages still open and save without it.
        indexLoaded = undefined;
        options.onBackgroundError?.("" as TodayDate, error);
      });
    return indexLoaded;
  };

  const stores = createManagedStoreCache<string, TodayPageStore>({
    releaseDelayMs: options.releaseDelayMs,
    unload: async (docId) => {
      await closing.get(docId);
    },
    create: async (docId) => {
      const date = docId as TodayDate;
      await closing.get(docId);
      const loaded = await repo.load(date);
      const doc = new LoroDoc();
      configureTodayTextStyles(doc);
      if (loaded.snapshot) doc.import(loaded.snapshot);
      const store = createTodayPageStore({
        date,
        doc,
        revision: loaded.revision,
        repo,
        setTimer: options.setTimer,
        retryDelayMs: options.retryDelayMs,
        ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
        onSaved: (entry) => {
          const known = entries.get(date);
          entries.set(date, { ...known, ...entry, updatedAt: new Date().toISOString() });
          emit();
        },
        onBackgroundError: (error) => options.onBackgroundError?.(date, error),
      });
      open.set(docId, store);
      const dispose = store.dispose.bind(store);
      store.dispose = () => {
        open.delete(docId);
        closing.set(
          docId,
          store.flush().finally(() => closing.delete(docId)),
        );
        dispose();
      };
      return store;
    },
  });

  const held = new Map<string, number>();
  const idle: string[] = [];
  const forgetIdle = (docId: string) => {
    const index = idle.indexOf(docId);
    if (index >= 0) idle.splice(index, 1);
  };

  return {
    acquire: async (docId) => {
      forgetIdle(docId);
      void loadIndex();
      const store = await stores.acquire(docId);
      held.set(docId, (held.get(docId) ?? 0) + 1);
      return store;
    },
    releaseRef: (docId) => {
      stores.releaseRef(docId);
      const count = (held.get(docId) ?? 0) - 1;
      if (count > 0) {
        held.set(docId, count);
        return;
      }
      held.delete(docId);
      forgetIdle(docId);
      idle.push(docId);
      // Pages the delayed release already closed no longer take a slot.
      for (let index = idle.length - 1; index >= 0; index -= 1) {
        if (!stores.peek(idle[index]!)) idle.splice(index, 1);
      }
      while (idle.length > options.idleCap) {
        const oldest = idle.shift();
        if (oldest) void stores.releaseIfIdle(oldest);
      }
    },
    peek: (docId) => stores.peek(docId),
    observeDates: (listener) => {
      dateListeners.add(listener);
      listener(sorted());
      void loadIndex();
      return () => {
        dateListeners.delete(listener);
      };
    },
    refresh: async () => {
      indexLoaded = undefined;
      await loadIndex();
      await Promise.all([...open.values()].map((store) => store.syncFromServer()));
    },
    flushAll: async () => {
      await Promise.all([...open.values()].map((store) => store.flush()));
      await Promise.all(closing.values());
    },
    releaseIdle: async () => {
      idle.length = 0;
      await stores.releaseIdle();
    },
    disposeAll: async () => {
      idle.length = 0;
      held.clear();
      dateListeners.clear();
      await stores.disposeAll();
      await Promise.all(closing.values());
    },
  };
}
