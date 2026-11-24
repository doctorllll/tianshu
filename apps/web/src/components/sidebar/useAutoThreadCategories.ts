import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import type { ModelSelection } from "@t3tools/contracts";
import { useSidebarSuggestionModels } from "~/hooks/useSidebarSuggestionModels";
import { useStableCallback } from "~/hooks/useStableCallback";
import { readUiLocale } from "~/i18n";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  addCategoryProposals,
  categoryScheme,
  categorySuggestionRequest,
  setAutoThreadCategories,
  threadsToAutoFile,
  useThreadCategoryAutoAssignments,
  type AutoFileCandidate,
  type ThreadCategory,
} from "~/threadCategories";

/** Waits for the unsorted list to settle, so a burst of new threads is one call. */
const SETTLE_MS = 4_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
// One call at a time for the whole window; after a failure the next waits.
let running = false;
let retryAt = 0;

/**
 * Files threads no keyword matched: their titles, folders and agents go to the suggestion
 * model 30 at a time, and its answers apply at once. Threads it cannot place stay unsorted
 * until the categories or their titles change; titles they share may come back as a
 * suggested new category.
 */
export function useAutoThreadCategories({
  enabled,
  candidates,
  categories,
  modelSelection,
}: {
  readonly enabled: boolean;
  readonly candidates: readonly AutoFileCandidate[];
  readonly categories: readonly ThreadCategory[];
  readonly modelSelection: ModelSelection | null;
}) {
  const auto = useThreadCategoryAutoAssignments();
  const run = useAtomCommand(serverEnvironment.suggestSidebarCategories, { reportFailure: false });
  const { environmentId, models } = useSidebarSuggestionModels();
  const canSuggest = useAtomValue(
    serverEnvironment.suggestSidebarCategories.permissionAtom(environmentId),
  );
  const pending =
    enabled && canSuggest && models.length > 0 && categories.length > 0
      ? threadsToAutoFile(candidates, auto, categories).slice(0, 30)
      : [];
  const signature =
    pending.length > 0
      ? `${categoryScheme(categories)}|${pending.map((candidate) => `${candidate.key}:${candidate.title}`).join("|")}`
      : "";
  const fileBatch = useStableCallback(() => {
    if (running || Date.now() < retryAt || environmentId === null || pending.length === 0) return;
    running = true;
    const request = categorySuggestionRequest({
      candidates: pending,
      categories,
      modelSelection,
      language: readUiLocale() === "zh-CN" ? "zh" : "en",
      proposeNew: pending.length >= 2,
    });
    const scheme = categoryScheme(categories);
    void run({ environmentId, input: request.input })
      .then((result) => {
        if (result._tag !== "Success") {
          retryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
          return;
        }
        const filed = new Map(
          result.value.suggestions.map((row) => [
            row.titleIndex,
            request.categories[row.categoryIndex]?.id,
          ]),
        );
        setAutoThreadCategories(
          Object.fromEntries(
            request.candidates.map((candidate, index) => [
              candidate.key,
              { category: filed.get(index) ?? null, scheme, title: candidate.title },
            ]),
          ),
        );
        addCategoryProposals(
          (result.value.proposals ?? []).map((proposal) => ({
            label: proposal.label,
            description: proposal.description,
            keywords: proposal.keywords,
            threadKeys: proposal.titleIndexes.flatMap((index) => {
              const candidate = request.candidates[index];
              return candidate ? [candidate.key] : [];
            }),
          })),
          categories,
        );
      })
      .finally(() => {
        running = false;
      });
  });
  // The signature names the waiting threads and the categories, so a change restarts the wait.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Starts one model call once the unsorted threads settle.
  useEffect(() => {
    if (!signature) return;
    const timer = window.setTimeout(fileBatch, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [signature, fileBatch]);
}
