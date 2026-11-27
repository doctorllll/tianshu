/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-mention-picker.tsx.
 * Modified for Tianshu (Tailwind, threads only: one local author has no people to mention).
 */
import { MessageSquareIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { useUiText } from "~/i18n/useUiText";
import { cn, normalizeSearchText } from "~/lib/utils";
import { useVisibleThreadShells } from "~/state/entities";

import { useTodayEditorState } from "../editor/today-editor-context";
import type { TodayEditorController } from "../editor/today-editor-controller";
import { encodeThreadMentionId, THREAD_MENTION_KIND } from "../thread-mention";

const PICKER_LIMIT = 8;

/** The controller keeps the picker outside React: `version` marks when to read it again. */
function readPicker(_version: number, controller: TodayEditorController | null) {
  return controller?.getPicker() ?? null;
}

function readEditorRoot(_version: number, controller: TodayEditorController | null) {
  return controller?.getEditorRoot() ?? null;
}

/** The `@` picker below the caret; the thread list is subscribed only while it is open. */
export function TodayLiveThreadPicker() {
  const { controller, version } = useTodayEditorState();
  if (!readPicker(version, controller)) return null;
  return <ThreadPicker />;
}

function ThreadPicker() {
  const uiText = useUiText();
  const { controller, version } = useTodayEditorState();
  const threads = useVisibleThreadShells();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [above, setAbove] = useState(false);
  const picker = readPicker(version, controller);
  const root = readEditorRoot(version, controller);
  const query = picker?.query ?? null;
  const needle = normalizeSearchText(query ?? "");
  const rows =
    query === null
      ? []
      : threads
          .filter((thread) => thread.archivedAt === null)
          .filter((thread) => !needle || normalizeSearchText(thread.title).includes(needle))
          .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .slice(0, PICKER_LIMIT)
          .map((thread) => ({
            title: thread.title.trim(),
            target: {
              kind: THREAD_MENTION_KIND,
              id: encodeThreadMentionId({
                environmentId: thread.environmentId,
                threadId: thread.id,
              }),
            },
          }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the visible rows to the controller's key handler
  useLayoutEffect(() => {
    controller?.setHooks({ pickerItems: rows.map((row) => row.target) });
  }, [controller, rows]);
  const anchorBottom = picker ? (root?.getBoundingClientRect().bottom ?? 0) : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- flips the picker above the caret when it would leave the window
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || anchorBottom === null) return;
    setAbove(
      anchorBottom + 4 + menu.offsetHeight > (root?.ownerDocument.defaultView?.innerHeight ?? 0),
    );
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the extra dependency marks when the external controller state changed
  }, [anchorBottom, root, rows.length]);
  if (!controller || !picker || !root) return null;
  // Under the `@`: the caret's line when the browser can measure it, else the node.
  const selection = root.ownerDocument.getSelection();
  const caret =
    selection?.rangeCount && root.contains(selection.anchorNode)
      ? selection.getRangeAt(0).getBoundingClientRect()
      : null;
  const rect = caret && caret.height > 0 ? caret : root.getBoundingClientRect();
  return (
    <div
      ref={menuRef}
      className="fixed z-50 flex w-80 max-w-[calc(100vw-16px)] flex-col gap-0.5 rounded-xl bg-popover p-1 shadow-lg ring-1 ring-border"
      style={
        above
          ? {
              left: rect.left,
              bottom: (root.ownerDocument.defaultView?.innerHeight ?? 0) - rect.top + 4,
            }
          : { left: rect.left, top: rect.bottom + 4 }
      }
      onMouseDown={(event) => event.preventDefault()}
    >
      <div role="listbox" aria-label={uiText("Mention")} className="flex flex-col gap-0.5">
        {rows.length === 0 ? (
          <span className="p-2 text-xs text-muted-foreground/60">
            {uiText("No matching threads")}
          </span>
        ) : (
          rows.map((row, index) => (
            <button
              type="button"
              key={row.target.id}
              role="option"
              aria-selected={index === picker.index}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1 text-start text-ui-body text-foreground",
                index === picker.index && "bg-accent",
              )}
              onClick={() => controller.acceptPicker(row.target)}
            >
              <span className="inline-flex w-4 shrink-0 justify-center text-muted-foreground">
                <MessageSquareIcon className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 truncate">{row.title || uiText("Untitled thread")}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
