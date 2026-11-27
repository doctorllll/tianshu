/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-view.tsx.
 * Modified for Tianshu (Tailwind).
 */
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRef, type ReactNode } from "react";

import { useUiText } from "~/i18n/useUiText";
import { cn } from "~/lib/utils";
import { THREAD_PLACEMENT_DRAG_TYPE } from "~/sidebarThreadPlacement";

import { useTodayEditorState } from "../editor/today-editor-context";
import type { TodayEditorController } from "../editor/today-editor-controller";
import { encodeThreadMentionId } from "../thread-mention";
import { TodayMoreAtEndContext } from "./OutlineRow";

/** A sidebar thread row is being dragged. */
const isThreadDrag = (data: DataTransfer | null) =>
  !!data && [...data.types].includes(THREAD_PLACEMENT_DRAG_TYPE);

/** Default max width of the notes' text column, in px. */
export const TODAY_READABLE_WIDTH = 720;

export type OutlinePlacement = "page" | "pinned" | "pinnedAtWindowEdge";

/** The scroll surface: focus, keys and clipboard for block selection. */
export function TodayOutlineSurface(props: {
  controller: TodayEditorController | null;
  /** Span the whole width instead of the readable column (the pinned column is narrow anyway). */
  fullWidth?: boolean;
  /** Where the surface sits: its gutters follow. */
  placement?: OutlinePlacement;
  children: ReactNode;
}) {
  const { controller, placement = "page" } = props;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      className={cn(
        "group/surface min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both pb-8 focus-visible:shadow-none focus-visible:outline-none",
        placement === "page" && "pe-6 ps-10.25",
        placement === "pinned" && "pe-4 ps-10.25",
        placement === "pinnedAtWindowEdge" && "pe-4 ps-9.75",
      )}
      ref={(element) => {
        surfaceRef.current = element;
        controller?.attachSurface(element);
      }}
      onDragOverCapture={(event) => {
        if (!controller || !isThreadDrag(event.dataTransfer)) return;
        // Captured so the node editor never inserts the dragged title as text.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        controller.hoverExternal(event.clientX, event.clientY);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          controller?.leaveExternal();
        }
      }}
      onDropCapture={(event) => {
        if (!controller || !isThreadDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const ref = parseScopedThreadKey(event.dataTransfer.getData(THREAD_PLACEMENT_DRAG_TYPE));
        if (!ref) return controller.leaveExternal();
        controller.dropExternal(
          encodeThreadMentionId({ environmentId: ref.environmentId, threadId: ref.threadId }),
          event.clientX,
          event.clientY,
        );
      }}
      tabIndex={-1}
      role="tree"
      data-today-scroller=""
      aria-multiselectable
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) controller?.onBlockKey(event.nativeEvent);
      }}
      onCopy={(event) => controller?.onBlockClipboard(event.nativeEvent, false)}
      onCut={(event) => controller?.onBlockClipboard(event.nativeEvent, true)}
      onPaste={(event) => {
        if (event.target === event.currentTarget) controller?.onBlockPaste(event.nativeEvent);
      }}
    >
      <TodayMoreAtEndContext.Provider value={placement === "pinnedAtWindowEdge"}>
        <div
          className="mx-auto"
          style={props.fullWidth ? undefined : { maxWidth: TODAY_READABLE_WIDTH }}
        >
          {props.children}
        </div>
      </TodayMoreAtEndContext.Provider>
      <TodayDragLayer />
    </div>
  );
}

/** The controller keeps drag state outside React: `version` marks when to read it again. */
function readDragState(_version: number, controller: TodayEditorController | null) {
  return {
    indicator: controller?.getDropIndicator() ?? null,
    ghost: controller?.getDragGhost() ?? null,
  };
}

/** The drop line, the "can't move here" note, and the dragged card. */
function TodayDragLayer() {
  const uiText = useUiText();
  const { controller, version } = useTodayEditorState();
  const { indicator, ghost } = readDragState(version, controller);
  return (
    <>
      {indicator?.kind === "line" ? (
        <div
          className="pointer-events-none fixed z-40 h-0.5 rounded-full bg-info"
          style={{ top: indicator.top - 1, left: indicator.left, width: indicator.width }}
        >
          <span className="absolute -left-1 -top-[3px] size-2 rounded-full border-2 border-solid border-info bg-background" />
        </div>
      ) : null}
      {indicator?.kind === "blocked" ? (
        <div
          className="pointer-events-none fixed z-[41] rounded-lg bg-popover px-2 py-1 text-xs text-muted-foreground shadow-md"
          style={{ top: indicator.y + 16, left: indicator.x + 12 }}
        >
          {uiText("Can't move to another date")}
        </div>
      ) : null}
      {ghost ? (
        <div
          className={cn(
            "pointer-events-none fixed z-[42] max-w-70 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-popover px-2 py-1 text-sm text-foreground shadow-lg",
            ghost.settling && "opacity-0 transition-[top,left,opacity] duration-100 ease-out",
          )}
          style={{ top: ghost.y + 8, left: ghost.x + 12 }}
        >
          {ghost.count > 1
            ? uiText("Moving {count} nodes", { count: ghost.count })
            : ghost.label || " "}
        </div>
      ) : null}
    </>
  );
}
