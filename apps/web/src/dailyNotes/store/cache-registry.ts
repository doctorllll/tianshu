import type { EnvironmentId } from "@t3tools/contracts";

import { createTodayPageStoreCache, type TodayPageStoreCache } from "./page-cache";
import { createRpcDailyNotesRepo } from "./rpc-repo";

const RELEASE_DELAY_MS = 30_000;
const IDLE_CAP = 8;

const caches = new Map<EnvironmentId, TodayPageStoreCache>();
let listening = false;

const setTimer = (callback: () => void, ms: number) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

const retryDelayMs = (attempt: number) => Math.min(5 * 60_000, 1000 * 2 ** Math.min(attempt, 9));

/** Saves pending edits when the window hides or closes, and pulls other windows' saves back in. */
function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  const flush = () => {
    for (const cache of caches.values()) void cache.flushAll();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    else for (const cache of caches.values()) void cache.refresh().catch(() => {});
  });
  globalThis.addEventListener("pagehide", flush);
}

/** The one cache of open daily-note pages for an environment's server. */
export function getDailyNotesCache(environmentId: EnvironmentId): TodayPageStoreCache {
  let cache = caches.get(environmentId);
  if (!cache) {
    cache = createTodayPageStoreCache({
      repo: createRpcDailyNotesRepo(environmentId),
      releaseDelayMs: RELEASE_DELAY_MS,
      idleCap: IDLE_CAP,
      setTimer,
      retryDelayMs,
      onBackgroundError: (date, error) => {
        console.warn("Daily notes background error", { date, error });
      },
    });
    caches.set(environmentId, cache);
    listen();
  }
  return cache;
}
