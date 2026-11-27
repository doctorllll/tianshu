import { usePrimaryEnvironmentId } from "~/state/environments";

import { getDailyNotesCache } from "../store/cache-registry";
import type { TodayPageStoreCache } from "../store/page-cache";

/** The open-page cache of the primary environment's notes; null until that environment is known. */
export function useDailyNotesCache(): TodayPageStoreCache | null {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : getDailyNotesCache(environmentId);
}
