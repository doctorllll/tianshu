import {
  type EnvironmentId,
  ProviderInstanceId,
  type RespondSubSessionProposalInput,
  type ServerProvider,
  type SubSessionProposal,
  type ThreadId,
} from "@t3tools/contracts";
import { GitBranchPlusIcon } from "lucide-react";
import { useState } from "react";

import { useUiText } from "~/i18n/useUiText";
import { useEnvironmentQuery } from "~/state/query";
import { subSessionProposals } from "~/state/subSessionProposals";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Dialog, DialogPopup } from "../ui/dialog";
import { SubSessionForm } from "./SubSessionButton";

const NONE: ReadonlyArray<SubSessionProposal> = [];

/** Sub-sessions this thread's agent asked for, waiting for the user to start, change or decline. */
export function SubSessionProposalCards({
  environmentId,
  threadId,
  providers,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const uiText = useUiText();
  const query = useEnvironmentQuery(subSessionProposals.list({ environmentId, input: {} }));
  const respond = useAtomCommand(subSessionProposals.respond);
  const [editing, setEditing] = useState<SubSessionProposal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = (query.data ?? NONE).filter((proposal) => proposal.parentThreadId === threadId);
  if (waiting.length === 0 && editing === null) return null;

  const agentName = (instanceId: string) => {
    const provider = providers.find((candidate) => candidate.instanceId === instanceId);
    return provider?.displayName ?? instanceId;
  };
  const modelName = (proposal: SubSessionProposal) =>
    providers
      .find((candidate) => candidate.instanceId === proposal.target.providerInstanceId)
      ?.models.find((model) => model.slug === proposal.target.model)?.name ??
    proposal.target.model ??
    "";
  const answer = async (
    proposal: SubSessionProposal,
    input: Omit<RespondSubSessionProposalInput, "proposalId">,
  ) => {
    setBusy(proposal.id);
    await respond({ environmentId, input: { proposalId: proposal.id, ...input } });
    setBusy(null);
  };

  return (
    <>
      {waiting.map((proposal) => (
        <div
          key={proposal.id}
          data-sub-session-proposal={proposal.id}
          className="mb-2 flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xs"
        >
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchPlusIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">
              {uiText("{agent} wants to start a sub-session", {
                agent: agentName(proposal.proposedBy),
              })}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground text-xs">
              {agentName(proposal.target.providerInstanceId)}
              {modelName(proposal) ? ` · ${modelName(proposal)}` : ""}
            </span>
          </div>
          {proposal.title ? <div className="font-medium">{proposal.title}</div> : null}
          <div className="line-clamp-3 whitespace-pre-wrap text-muted-foreground text-xs">
            {proposal.task}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === proposal.id}
              onClick={() => void answer(proposal, { decision: "decline" })}
            >
              {uiText("Don't start")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === proposal.id}
              onClick={() => setEditing(proposal)}
            >
              {uiText("Change before starting")}
            </Button>
            <Button
              size="sm"
              disabled={busy === proposal.id}
              onClick={() => void answer(proposal, { decision: "dispatch" })}
            >
              {uiText("Start sub-session")}
            </Button>
          </div>
        </div>
      ))}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogPopup>
          {editing ? (
            <SubSessionForm
              providers={providers}
              initial={{
                instanceId: editing.target.providerInstanceId,
                model: editing.target.model,
                options: editing.target.options,
                title: editing.title ?? "",
                task: editing.task,
              }}
              description={uiText(
                "The agent asked for this sub-session. Change anything before it starts.",
              )}
              submitLabel={uiText("Start sub-session")}
              onCancel={() => setEditing(null)}
              onSubmit={(request) => {
                const proposal = editing;
                setEditing(null);
                void answer(proposal, {
                  decision: "dispatch",
                  target: {
                    providerInstanceId: ProviderInstanceId.make(request.instanceId),
                    model: request.model,
                    options: request.options ?? [],
                  },
                  title: request.title.trim() || null,
                  task: request.task.trim(),
                });
              }}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}
