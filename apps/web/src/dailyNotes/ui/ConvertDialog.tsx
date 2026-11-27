/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-convert-dialog.tsx.
 * Modified for Tianshu: a dialog of its own that starts a thread through the same turn start as
 * the composer, instead of embedding the new-conversation page.
 */
import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import { isReasoningSelect } from "@t3tools/client-runtime/model-traits";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { ProviderOptionDescriptor, ServerProvider } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { defaultSubSessionModel, rankSubSessionAgents } from "~/components/chat/subSessionPrompt";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { readLastUsedProjectKey } from "~/hooks/useHandleNewThread";
import { usePrimarySettings } from "~/hooks/useSettings";
import { useUiText } from "~/i18n/useUiText";
import { newMessageId, newThreadId } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { primaryServerProvidersAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { encodeThreadMentionId } from "../thread-mention";

function effortControl(
  provider: ServerProvider | undefined,
  model: string | null,
): Extract<ProviderOptionDescriptor, { type: "select" }> | undefined {
  const entry = provider?.models.find((candidate) => candidate.slug === model);
  return entry?.capabilities?.optionDescriptors?.find(isReasoningSelect);
}

function defaultEffort(
  control: Extract<ProviderOptionDescriptor, { type: "select" }> | undefined,
): string | null {
  if (control === undefined) return null;
  return (
    control.currentValue ??
    control.options.find((choice) => choice.isDefault)?.id ??
    control.options[0]?.id ??
    null
  );
}

/**
 * The placeholder title shown until the generated one lands: the first line of the prompt, as the
 * composer seeds it. It is sent as `titleSeed`, so the server then writes a proper title.
 */
function titleSeedOf(prompt: string): string {
  const line = prompt.split("\n").find((candidate) => candidate.trim()) ?? "";
  const plain = line.replace(/^\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?)/, "").trim();
  return deriveThreadTitleSeed({ text: plain, attachments: [] });
}

/**
 * Convert to task: choose where the node runs, edit its prompt, and start a thread with it.
 * The dialog starts the thread itself; `onAccepted` hears the new thread's mention id.
 */
export function TodayConvertDialog(props: {
  open: boolean;
  prompt: string;
  promptWithAncestors?: string | null;
  onAccepted: (mentionId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>{props.open ? <ConvertForm {...props} /> : null}</DialogPopup>
    </Dialog>
  );
}

function ConvertForm(props: {
  prompt: string;
  promptWithAncestors?: string | null;
  onAccepted: (mentionId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const uiText = useUiText();
  const environmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const runtimeMode = usePrimarySettings((settings) => settings.defaultRuntimeMode);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  const [openedAt] = useState(() => Date.now());
  const ranked = rankSubSessionAgents(providers, openedAt);
  const agents = ranked.map((entry) => entry.provider);
  const [instanceId, setInstanceId] = useState<string>(agents[0]?.instanceId ?? "");
  const agent = agents.find((candidate) => candidate.instanceId === instanceId);
  const [model, setModel] = useState<string | null>(defaultSubSessionModel(agents[0]));
  const control = effortControl(agent, model);
  const [effort, setEffort] = useState<string | null>(defaultEffort(control));
  const lastUsed = readLastUsedProjectKey();
  const initialProject =
    projects.find(
      (project) =>
        scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }) ===
        lastUsed,
    ) ?? projects[0];
  const [projectId, setProjectId] = useState<string>(initialProject?.id ?? "");
  const project = projects.find((candidate) => candidate.id === projectId) ?? initialProject;

  const withAncestors = props.promptWithAncestors ?? null;
  const [includeParents, setIncludeParents] = useState(true);
  const [edited, setEdited] = useState<string | null>(null);
  const generated = includeParents && withAncestors !== null ? withAncestors : props.prompt;
  // Until the prompt is edited, the checkbox switches between the two forms.
  const prompt = edited ?? generated;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready =
    environmentId !== null &&
    project !== undefined &&
    agent !== undefined &&
    prompt.trim().length > 0;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
    if (projectId === "" && initialProject) setProjectId(initialProject.id);
  }, [initialProject, projectId]);

  const pickModel = (provider: ServerProvider | undefined, slug: string | null) => {
    setModel(slug);
    const next = effortControl(provider, slug);
    setEffort((current) =>
      next?.options.some((choice) => choice.id === current) ? current : defaultEffort(next),
    );
  };

  const start = async () => {
    if (!ready || model === null || environmentId === null) return;
    setSending(true);
    setError(null);
    const threadId = newThreadId();
    const title = titleSeedOf(prompt);
    // oxlint-disable-next-line react/purity -- runs in an event handler (oxc#27309)
    const createdAt = new Date().toISOString();
    const options =
      control !== undefined && effort !== null ? [{ id: control.id, value: effort }] : undefined;
    const modelSelection = {
      instanceId: agent.instanceId,
      model,
      ...(options ? { options } : {}),
    };
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: prompt, attachments: [] },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title,
            modelSelection,
            runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      setError(thrownErrorMessage(squashAtomCommandFailure(result)));
      return;
    }
    props.onAccepted(encodeThreadMentionId({ environmentId, threadId }));
    props.onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{uiText("Convert to task")}</DialogTitle>
        <DialogDescription>
          {uiText("Starts a new thread with this prompt; the note then points at it.")}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label>{uiText("Project")}</Label>
            <Select
              value={project?.id ?? ""}
              onValueChange={(value) => {
                if (value !== null) setProjectId(value);
              }}
            >
              <SelectTrigger aria-label={uiText("Project")}>
                <SelectValue>{project?.title ?? ""}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {projects.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>{uiText("Agent")}</Label>
              <Select
                value={instanceId}
                onValueChange={(value) => {
                  if (value === null) return;
                  setInstanceId(value);
                  const next = agents.find((item) => item.instanceId === value);
                  pickModel(next, defaultSubSessionModel(next));
                }}
              >
                <SelectTrigger aria-label={uiText("Agent")}>
                  <SelectValue>{agent?.displayName ?? agent?.instanceId ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {agents.map((candidate) => (
                    <SelectItem key={candidate.instanceId} value={candidate.instanceId}>
                      {candidate.displayName ?? candidate.instanceId}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>{uiText("Model")}</Label>
              <Select
                value={model ?? ""}
                onValueChange={(value) => {
                  if (value !== null) pickModel(agent, value);
                }}
              >
                <SelectTrigger aria-label={uiText("Model")}>
                  <SelectValue>
                    {agent?.models.find((item) => item.slug === model)?.name ?? model ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {(agent?.models ?? []).map((item) => (
                    <SelectItem key={item.slug} value={item.slug}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
          {control !== undefined ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>{uiText("Thinking level")}</Label>
              <Select
                value={effort ?? ""}
                onValueChange={(value) => {
                  if (value !== null) setEffort(value);
                }}
              >
                <SelectTrigger aria-label={uiText("Thinking level")}>
                  <SelectValue>
                    {uiText(
                      control.options.find((choice) => choice.id === effort)?.label ?? effort ?? "",
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {control.options.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {uiText(choice.label)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="daily-notes-convert-prompt">{uiText("Prompt")}</Label>
            <Textarea
              id="daily-notes-convert-prompt"
              rows={8}
              value={prompt}
              onChange={(event) => setEdited(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                if (event.keyCode === 229) return;
                event.preventDefault();
                void start();
              }}
            />
            {withAncestors !== null ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={includeParents}
                  disabled={edited !== null}
                  onCheckedChange={(checked) => setIncludeParents(checked === true)}
                />
                {edited !== null ? uiText("Prompt edited") : uiText("Include parent nodes")}
              </label>
            ) : null}
          </div>
          {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={() => props.onOpenChange(false)}>
          {uiText("Cancel")}
        </Button>
        <Button disabled={!ready || sending} onClick={() => void start()}>
          {uiText("Start task")}
        </Button>
      </DialogFooter>
    </>
  );
}
