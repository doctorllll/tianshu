/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-session-mention.tsx.
 * Modified for Tianshu (Tailwind, thread status from the sidebar's signals).
 */
import { HandIcon } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { useUiText } from "~/i18n/useUiText";
import { cn } from "~/lib/utils";

import { useTodayEditor } from "../editor/today-editor-context";
import { THREAD_MENTION_KIND } from "../thread-mention";
import { useThreadMentionDisplay, type ThreadMentionStatus } from "./threadMentionState";

const RING = {
  cx: 6,
  cy: 6,
  r: 5,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
} as const;
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const STATUS_SHAPES: Record<Exclude<ThreadMentionStatus, "waiting">, ReactNode> = {
  idle: <circle {...RING} strokeDasharray="2.2 1.8" />,
  running: (
    <>
      <circle {...RING} />
      <path d="M6 2.5 A3.5 3.5 0 0 1 6 9.5 Z" fill="currentColor" />
    </>
  ),
  unread: <circle cx="6" cy="6" r="3.5" fill="currentColor" />,
  later: (
    <>
      <circle {...RING} />
      <path d="M6 3.5 V6 L7.75 7.1" {...STROKE} />
    </>
  ),
  done: (
    <>
      <circle {...RING} />
      <path d="M3.9 6.1 L5.4 7.5 L8.1 4.7" {...STROKE} />
    </>
  ),
};

/**
 * One family of 12px status marks: the same circle, stroke and weight for every state, told apart
 * by fill and a small mark. Static on purpose: motion inside running text is noise.
 */
function StatusGlyph(props: { status: ThreadMentionStatus }) {
  const { status } = props;
  const className = cn("block text-info", status === "done" && "text-muted-foreground/60");
  if (status === "waiting") {
    return <HandIcon className={cn(className, "size-3")} strokeWidth={1.75} aria-hidden />;
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={className}>
      {STATUS_SHAPES[status]}
    </svg>
  );
}

const MENTION_CLASS =
  "inline select-none pe-1 ps-px [box-decoration-break:clone] [-webkit-box-decoration-break:clone]";

/**
 * One thread mention: its status icon (a button opening the status menu) and its live title
 * (opens the thread). Static rows and the editor's decorators render this same component so
 * metrics match; its root carries `data-today-mention`, which caret geometry counts as one
 * character. Pointer presses never reach the row, so they never activate the editor.
 */
export function TodayMention(props: {
  mention: { kind: string; id: string };
  selected?: boolean;
}) {
  const uiText = useUiText();
  const { mention, selected = false } = props;
  if (mention.kind !== THREAD_MENTION_KIND || !mention.id) {
    return (
      <span
        className={cn(MENTION_CLASS, "italic text-muted-foreground/60", selected && "bg-info/25")}
        data-today-mention=""
        contentEditable={false}
      >
        {mention.kind ? uiText("Unsupported reference") : "?"}
      </span>
    );
  }
  return <ThreadMention mentionId={mention.id} selected={selected} />;
}

function ThreadMention(props: { mentionId: string; selected: boolean }) {
  const uiText = useUiText();
  const controller = useTodayEditor();
  const display = useThreadMentionDisplay(props.mentionId);
  const rootProps = {
    "data-today-mention": "",
    "data-today-thread": props.mentionId,
    contentEditable: false,
    onPointerDown: (event: ReactPointerEvent) => event.stopPropagation(),
  } as const;
  const pressedStatus = useRef(false);
  if (display.state !== "ok") {
    return (
      <span
        className={cn(MENTION_CLASS, "italic text-muted-foreground/60", props.selected && "bg-info/25")}
        {...rootProps}
      >
        {display.state === "missing" ? uiText("Thread deleted") : "…"}
      </span>
    );
  }
  const title = display.title || uiText("Untitled thread");
  const statusLabel = {
    waiting: uiText("Waiting for you"),
    running: uiText("Running"),
    later: uiText("Later"),
    done: uiText("Done"),
    unread: uiText("Unread"),
    idle: uiText("Idle"),
  }[display.status];
  return (
    <span
      className={cn(MENTION_CLASS, props.selected && "bg-info/25")}
      {...rootProps}
      data-today-status={display.status}
    >
      <button
        type="button"
        className="inline-block min-w-4.5 cursor-pointer rounded-[5px] border-0 bg-transparent py-0 ps-0 pe-[3px] ms-px me-[1px] align-baseline text-start font-[inherit] text-[length:inherit] leading-5 text-inherit outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-info"
        data-today-mention-status=""
        aria-haspopup="menu"
        aria-label={uiText("Status: {status}. Change status", { status: statusLabel })}
        tabIndex={-1}
        onPointerDown={(event) => {
          pressedStatus.current = true;
          // Keep the editor's focus and selection where they are.
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          controller?.onMentionMenu?.(props.mentionId, event.currentTarget);
        }}
      >
        <span className="inline-flex h-5 w-3 items-center justify-center align-top">
          <StatusGlyph status={display.status} />
        </span>
      </button>
      {/* A span: a button never wraps, leaving the status icon alone on the line above. */}
      <span
        role="button"
        className={cn(
          "inline cursor-pointer text-info underline decoration-transparent underline-offset-[3px] hover:decoration-current",
          display.status === "done" && "text-muted-foreground/60 line-through decoration-current",
        )}
        aria-label={uiText("Thread: {title}, {status}", { title, status: statusLabel })}
        tabIndex={-1}
        onClick={(event) => controller?.onOpenSession?.(props.mentionId, event)}
      >
        {title}
      </span>
    </span>
  );
}
