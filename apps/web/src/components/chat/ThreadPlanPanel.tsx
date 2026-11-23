import type { EnvironmentId, ThreadId, ThreadPlan } from "@t3tools/contracts";
import { ClipboardListIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useUiText } from "~/i18n/useUiText";
import { useEnvironmentQuery } from "~/state/query";
import { formatDateTimeTimestamp } from "~/timestampFormat";
import { threadPlans } from "~/state/threadPlans";
import { useAtomCommand } from "~/state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface Draft {
  readonly text: string;
  /** The version the edit started from, sent so a change made meanwhile is not overwritten. */
  readonly base: number | null;
}

/**
 * The thread's plan: what its agent keeps current while it works, which the user and other agents
 * follow. Shown live, from wherever that agent keeps it, and editable where it can be written.
 */
export function ThreadPlanPanel({
  environmentId,
  threadId,
  cwd,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | undefined;
}) {
  const uiText = useUiText();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const query = useEnvironmentQuery(threadPlans.plan({ environmentId, input: { threadId } }));
  const write = useAtomCommand(threadPlans.write);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const plan = query.data ?? null;

  const sourceLabel = (source: ThreadPlan["source"]) => {
    switch (source) {
      case "tianshu":
        return uiText("Tianshu plan");
      case "fastctx":
        return uiText("fastctx plan");
      case "dsh":
        return uiText("DSH living plan");
      case "antigravity":
        return uiText("Antigravity tasks");
    }
  };
  const author = (who: string) =>
    who === "agent"
      ? uiText("the agent")
      : who === "user"
        ? uiText("you")
        : who === "handoff"
          ? uiText("the previous agent")
          : who;

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    const result = await write({
      environmentId,
      input: { threadId, markdown: draft.text, expectedVersion: draft.base },
    });
    setSaving(false);
    if (result._tag !== "Success") return;
    if (result.value.result === "conflict") {
      setConflict(true);
      setDraft({ text: draft.text, base: result.value.plan.version });
      return;
    }
    setConflict(false);
    setDraft(null);
  };

  const body = () => {
    if (draft !== null) {
      return (
        <Textarea
          aria-label={uiText("Living plan")}
          className="min-h-80"
          value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        />
      );
    }
    if (plan === null) {
      return (
        <p className="text-muted-foreground text-xs">
          {query.error
            ? uiText("Could not read the plan: {error}", { error: String(query.error) })
            : uiText("Loading the plan…")}
        </p>
      );
    }
    if (plan.error !== null) {
      return (
        <p className="text-destructive text-xs">
          {uiText("Could not read the plan: {error}", { error: plan.error })}
        </p>
      );
    }
    if (plan.markdown.trim() === "") {
      return (
        <p className="text-muted-foreground text-xs">
          {plan.editable
            ? uiText(
                "No plan yet. On multi-step work the agent keeps one here; you can start it too.",
              )
            : uiText("No plan yet.")}
        </p>
      );
    }
    return <ChatMarkdown text={plan.markdown} cwd={cwd} />;
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-thread-plan-panel>
      <div className="flex min-w-0 items-center gap-2 border-border border-b px-3 py-2 text-xs">
        <ClipboardListIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">
          {plan ? sourceLabel(plan.source) : uiText("Living plan")}
        </span>
        {plan && (plan.source === "tianshu" || plan.source === "dsh") && plan.version !== null ? (
          <span className="shrink-0 text-muted-foreground">
            {uiText("Version {version}", { version: plan.version })}
          </span>
        ) : null}
        {plan?.updatedAt ? (
          <span className="min-w-0 truncate text-muted-foreground">
            {uiText("Updated {time} by {who}", {
              time: formatDateTimeTimestamp(plan.updatedAt, timestampFormat),
              who: author(plan.updatedBy ?? ""),
            })}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 gap-1">
          {draft !== null ? (
            <>
              <Button
                size="compact"
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setConflict(false);
                }}
              >
                {uiText("Cancel")}
              </Button>
              <Button size="compact" disabled={saving} onClick={() => void save()}>
                {uiText("Save")}
              </Button>
            </>
          ) : plan?.editable ? (
            <Button
              size="compact"
              variant="outline"
              onClick={() => setDraft({ text: plan.markdown, base: plan.version })}
            >
              {uiText("Edit")}
            </Button>
          ) : null}
        </div>
      </div>
      {conflict ? (
        <p className="border-border border-b px-3 py-2 text-warning text-xs">
          {uiText(
            "The plan changed while you were editing. Your text is kept; check the latest version and save again.",
          )}
        </p>
      ) : null}
      {plan?.source === "antigravity" && draft === null ? (
        <p className="px-3 pt-2 text-muted-foreground text-xs">
          {uiText("Read-only: Antigravity keeps these in its own task files.")}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{body()}</div>
    </div>
  );
}
