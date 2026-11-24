import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import { useUiText } from "~/i18n/useUiText";
import { useSidebarCategories } from "~/hooks/useSidebarCategories";
import { useSidebarSuggestionModels } from "~/hooks/useSidebarSuggestionModels";
import { updateClientSettings } from "~/hooks/useSettings";
import { readUiLocale } from "~/i18n";
import { randomUUID } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  categorySuggestionRequest,
  setAutoThreadCategories,
  setThreadCategories,
  settleCategoryProposal,
  useCategoryProposals,
  withAddedCategory,
  type AutoFileCandidate,
  type PendingCategoryProposal,
  type ThreadCategory,
} from "~/threadCategories";
import type { ModelSelection } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";

type Row = AutoFileCandidate & {
  readonly categoryId: string;
  readonly reason: string;
  readonly checked: boolean;
};
type ProposalRow = PendingCategoryProposal & { readonly checked: boolean };

/**
 * Unsorted threads and the categories the model suggests for threads none fit. "Help me
 * categorize" asks again for every unsorted thread and moves only what the user checks.
 */
export function ThreadCategorySuggestions({
  candidates,
  categories,
  modelSelection,
}: {
  readonly candidates: readonly AutoFileCandidate[];
  readonly categories: readonly ThreadCategory[];
  readonly modelSelection: ModelSelection | null;
}) {
  const text = useUiText();
  const { settings } = useSidebarCategories();
  const storedProposals = useCategoryProposals();
  // A suggestion stays up while two or more of its threads are still unsorted.
  const unsortedKeys = new Set(candidates.map((candidate) => candidate.key));
  const waitingProposals = storedProposals.flatMap((proposal) => {
    const threadKeys = proposal.threadKeys.filter((key) => unsortedKeys.has(key));
    return threadKeys.length >= 2 ? [{ ...proposal, threadKeys }] : [];
  });
  const run = useAtomCommand(serverEnvironment.suggestSidebarCategories, { reportFailure: false });
  const { environmentId, models } = useSidebarSuggestionModels();
  const canSuggest = useAtomValue(
    serverEnvironment.suggestSidebarCategories.permissionAtom(environmentId),
  );
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [proposals, setProposals] = useState<readonly ProposalRow[]>([]);
  const [allowed, setAllowed] = useState<readonly ThreadCategory[]>([]);
  const [model, setModel] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [takingLonger, setTakingLonger] = useState(false);
  const generation = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- One delayed explanation for an in-flight model call.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setTakingLonger(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  const selected = rows.filter(
    (row) => row.checked && allowed.some((category) => category.id === row.categoryId),
  );
  const chosenProposals = proposals.filter((proposal) => proposal.checked);
  const moving = selected.length + chosenProposals.reduce((sum, p) => sum + p.threadKeys.length, 0);
  const close = () => {
    ++generation.current;
    setOpen(false);
    setWaiting(false);
    setTakingLonger(false);
  };
  const request = async () => {
    if (!environmentId || !canSuggest) return;
    const version = ++generation.current;
    setOpen(true);
    setWaiting(true);
    setTakingLonger(false);
    setFailure(null);
    setRows([]);
    setProposals([]);
    const sent = categorySuggestionRequest({
      candidates,
      categories,
      modelSelection,
      language: readUiLocale() === "zh-CN" ? "zh" : "en",
      proposeNew: true,
    });
    const result = await run({ environmentId, input: sent.input });
    if (version !== generation.current) return;
    setWaiting(false);
    if (result._tag !== "Success") {
      setFailure(
        "Could not get suggestions. Check the suggestion model in Settings and try again.",
      );
      return;
    }
    setModel(result.value.model);
    setAllowed(sent.categories);
    setRows(
      result.value.suggestions.flatMap((row) => {
        const item = sent.candidates[row.titleIndex];
        const category = sent.categories[row.categoryIndex];
        return item && category
          ? [{ ...item, categoryId: category.id, reason: row.reason, checked: true }]
          : [];
      }),
    );
    setProposals(
      (result.value.proposals ?? []).map((proposal) => ({
        label: proposal.label,
        description: proposal.description,
        keywords: proposal.keywords,
        threadKeys: proposal.titleIndexes.flatMap((index) => {
          const item = sent.candidates[index];
          return item ? [item.key] : [];
        }),
        checked: false,
      })),
    );
  };
  /** Adds the categories and returns their ids, by label. */
  const createCategories = (chosen: readonly PendingCategoryProposal[]) => {
    let next = settings;
    const ids = new Map<string, string>();
    for (const proposal of chosen) {
      const id = randomUUID();
      next = withAddedCategory(next, {
        id,
        label: proposal.label,
        description: proposal.description,
        keywords: proposal.keywords,
      });
      ids.set(proposal.label, id);
      settleCategoryProposal(proposal.label, false);
    }
    if (next !== settings) void updateClientSettings({ sidebarCategories: next });
    return ids;
  };
  const acceptWaiting = (proposal: PendingCategoryProposal) => {
    const id = createCategories([proposal]).get(proposal.label);
    if (!id) return;
    // Filed as the model's choice: a thread the user moves by hand stays where they put it.
    setAutoThreadCategories(
      Object.fromEntries(
        proposal.threadKeys.map((key) => [key, { category: id, scheme: "", title: "" }]),
      ),
    );
  };
  const confirm = () => {
    const ids = createCategories(chosenProposals);
    const moves: Record<string, string> = Object.fromEntries(
      selected.map((row) => [row.key, row.categoryId]),
    );
    for (const proposal of chosenProposals) {
      const id = ids.get(proposal.label);
      if (id) for (const key of proposal.threadKeys) moves[key] = id;
    }
    if (setThreadCategories(moves)) close();
    else setFailure("Could not save the category. Check available local storage.");
  };
  if (!open && (models.length === 0 || !canSuggest || categories.length === 0)) return null;
  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <>
      {waitingProposals.map((proposal) => (
        <aside
          key={proposal.label}
          className="mb-2 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs"
        >
          <p className="font-semibold">
            {text("Suggested new category: {label}", { label: proposal.label })}
          </p>
          <p className="text-muted-foreground">
            {proposal.description ? `${proposal.description} · ` : ""}
            {text("{count} threads fit it", { count: proposal.threadKeys.length })}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => settleCategoryProposal(proposal.label, true)}
            >
              {text("No thanks")}
            </Button>
            <Button size="xs" onClick={() => acceptWaiting(proposal)}>
              {text("Create category")}
            </Button>
          </div>
        </aside>
      ))}
      {candidates.length > 0 ? (
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {text("{count} threads are still unsorted", { count: candidates.length })}
          </span>
          <Button variant="ghost" size="xs" onClick={() => void request()}>
            {text("Help me categorize")}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogPopup className="w-[min(calc(100vw-32px),560px)] max-w-none overflow-x-hidden">
          <div className="min-w-0 space-y-4 p-6">
            <DialogTitle>{text("Suggested categories")}</DialogTitle>
            <DialogDescription>
              {text(
                "Titles, folder names and agents are shared. Checked threads move when you confirm.",
              )}
            </DialogDescription>
            {waiting ? (
              <p role="status" className="text-sm text-muted-foreground">
                {text(
                  takingLonger
                    ? "Still waiting for the model to classify these titles…"
                    : "Preparing title suggestions…",
                )}
              </p>
            ) : null}
            {failure ? (
              <p role="alert" className="text-sm text-destructive">
                {text(failure)}
              </p>
            ) : null}
            {!waiting && !failure && rows.length === 0 && proposals.length === 0 ? (
              <p role="status" className="text-sm">
                {text("No matching categories were suggested.")}
              </p>
            ) : null}
            {rows.length ? (
              <div className="max-h-[40vh] divide-y overflow-y-auto rounded-xl border">
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,144px)]"
                  >
                    <Checkbox
                      checked={row.checked}
                      aria-label={text("Include {title}", { title: row.title })}
                      onCheckedChange={(checked) => update(row.key, { checked })}
                    />
                    <div className="min-w-0 text-ui-body">
                      <p className="break-words">{row.title}</p>
                      <p className="break-words text-xs text-muted-foreground">{row.reason}</p>
                    </div>
                    <select
                      aria-label={text("Category for {title}", { title: row.title })}
                      className="col-start-2 min-w-0 rounded-md border bg-background p-1 text-xs outline-primary sm:col-start-auto"
                      value={row.categoryId}
                      onChange={(event) => update(row.key, { categoryId: event.target.value })}
                    >
                      {allowed.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
            {proposals.length ? (
              <section className="space-y-2" aria-label={text("Suggested new categories")}>
                <p className="text-xs font-medium text-muted-foreground">
                  {text("Suggested new categories")}
                </p>
                {proposals.map((proposal) => (
                  <div
                    key={proposal.label}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-xl border p-3"
                  >
                    <Checkbox
                      checked={proposal.checked}
                      aria-label={text("Create {label}", { label: proposal.label })}
                      onCheckedChange={(checked) =>
                        setProposals((current) =>
                          current.map((entry) =>
                            entry.label === proposal.label ? { ...entry, checked } : entry,
                          ),
                        )
                      }
                    />
                    <div className="min-w-0 text-ui-body">
                      <p className="break-words">
                        {text("Create {label} and move {count} threads", {
                          label: proposal.label,
                          count: proposal.threadKeys.length,
                        })}
                      </p>
                      {proposal.description ? (
                        <p className="break-words text-xs text-muted-foreground">
                          {proposal.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </section>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {model && !waiting ? (
                <span className="mr-auto text-xs text-muted-foreground">{model}</span>
              ) : null}
              <Button variant="outline" onClick={close}>
                {text("Cancel")}
              </Button>
              {failure && rows.length === 0 ? (
                <Button onClick={() => void request()}>{text("Retry")}</Button>
              ) : (
                <Button disabled={waiting || moving === 0} onClick={confirm}>
                  {text("Move {count} threads", { count: moving })}
                </Button>
              )}
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}
