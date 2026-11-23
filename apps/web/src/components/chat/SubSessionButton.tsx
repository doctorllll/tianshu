import type { ServerProvider } from "@t3tools/contracts";
import { GitBranchPlusIcon } from "lucide-react";
import { useState } from "react";

import { useUiText } from "~/i18n/useUiText";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  defaultSubSessionModel,
  rankSubSessionAgents,
  type SubSessionAgentRank,
  subSessionPrompt,
} from "./subSessionPrompt";
import "./composerV9.css";

/** Opens a form for a sub-session and puts the request for this thread's agent in the composer. */
export function SubSessionButton({
  providers,
  disabled = false,
  onInsert,
}: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly disabled?: boolean;
  readonly onInsert: (text: string) => void;
}) {
  const uiText = useUiText();
  const [open, setOpen] = useState(false);
  const label = uiText("New sub-session");
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-v9-sf-btn="sub-session"
              disabled={disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setOpen(true)}
              aria-label={label}
            />
          }
        >
          <GitBranchPlusIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          {open ? (
            <SubSessionForm
              providers={providers}
              onCancel={() => setOpen(false)}
              onSubmit={(text) => {
                setOpen(false);
                onInsert(text);
              }}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function SubSessionForm({
  providers,
  onCancel,
  onSubmit,
}: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly onCancel: () => void;
  readonly onSubmit: (text: string) => void;
}) {
  const uiText = useUiText();
  const [openedAt] = useState(() => Date.now());
  const ranked = rankSubSessionAgents(providers, openedAt);
  const agents = ranked.map((entry) => entry.provider);
  const [instanceId, setInstanceId] = useState<string>(agents[0]?.instanceId ?? "");
  const agent = agents.find((candidate) => candidate.instanceId === instanceId);
  const rank = ranked.find((entry) => entry.provider.instanceId === instanceId);
  const [model, setModel] = useState<string | null>(defaultSubSessionModel(agents[0]));
  const [title, setTitle] = useState("");
  const [task, setTask] = useState("");
  const ready = agent !== undefined && task.trim().length > 0;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{uiText("New sub-session")}</DialogTitle>
        <DialogDescription>
          {uiText(
            "This thread's agent starts it with delegate_task; when it finishes, its reply wakes this thread.",
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>{uiText("Agent")}</Label>
              <Select
                value={instanceId}
                onValueChange={(value) => {
                  if (value === null) return;
                  setInstanceId(value);
                  setModel(
                    defaultSubSessionModel(agents.find((item) => item.instanceId === value)),
                  );
                }}
              >
                <SelectTrigger aria-label={uiText("Agent")}>
                  <SelectValue>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{agent?.displayName ?? agent?.instanceId}</span>
                      {rank?.recommended ? <RecommendedBadge /> : null}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {ranked.map((entry) => (
                    <SelectItem key={entry.provider.instanceId} value={entry.provider.instanceId}>
                      <AgentChoice entry={entry} now={openedAt} />
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
                  if (value !== null) setModel(value);
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
          {rank ? (
            <div className="-mt-2 text-muted-foreground text-xs">
              {rank.recommended
                ? uiText("Recommended: the most quota left that would otherwise go unused soonest.")
                : uiText("Agents are ordered by quota left and how soon it resets.")}
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sub-session-title">{uiText("Title (optional)")}</Label>
            <Input
              id="sub-session-title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sub-session-task">{uiText("Task")}</Label>
            <Textarea
              id="sub-session-task"
              rows={6}
              value={task}
              placeholder={uiText("What the sub-session should do. It sees only this text.")}
              onChange={(event) => setTask(event.currentTarget.value)}
            />
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {uiText("Cancel")}
        </Button>
        <Button
          disabled={!ready}
          onClick={() => {
            if (!agent) return;
            onSubmit(subSessionPrompt({ instanceId: agent.instanceId, model, title, task }));
          }}
        >
          {uiText("Put in composer")}
        </Button>
      </DialogFooter>
    </>
  );
}

function RecommendedBadge() {
  const uiText = useUiText();
  return (
    <span className="shrink-0 rounded-full bg-success/15 px-1.5 py-px text-2xs text-success">
      {uiText("Recommended")}
    </span>
  );
}

function resetPhrase(
  resetsAt: string | null,
  now: number,
  uiText: ReturnType<typeof useUiText>,
): string | null {
  const at = resetsAt ? Date.parse(resetsAt) : Number.NaN;
  if (!Number.isFinite(at) || at <= now) return null;
  const hours = Math.round((at - now) / 3_600_000);
  return hours >= 24
    ? uiText("resets in {days} d", { days: Math.round(hours / 24) })
    : uiText("resets in {hours} h", { hours: Math.max(1, hours) });
}

function AgentChoice({
  entry,
  now,
}: {
  readonly entry: SubSessionAgentRank;
  readonly now: number;
}) {
  const uiText = useUiText();
  const reset = resetPhrase(entry.resetsAt, now, uiText);
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      <span className="truncate">{entry.provider.displayName ?? entry.provider.instanceId}</span>
      {entry.recommended ? <RecommendedBadge /> : null}
      <span className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums">
        {entry.remaining === null
          ? uiText("No quota reading")
          : reset
            ? uiText("{remaining}% left · {reset}", {
                remaining: Math.round(entry.remaining),
                reset,
              })
            : uiText("{remaining}% left", { remaining: Math.round(entry.remaining) })}
      </span>
    </span>
  );
}
