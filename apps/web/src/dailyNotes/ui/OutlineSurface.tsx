/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-view.tsx.
 * Modified for Tianshu (Tailwind).
 */
import { useRef, type ReactNode } from "react";

import { useUiText } from "~/i18n/useUiText";
import { cn } from "~/lib/utils";

import { useTodayEditor } from "../editor/today-editor-context";
import type { TodayEditorController } from "../editor/today-editor-controller";
import { TodayMoreAtEndContext } from "./OutlineRow";

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
        "group/surface min-h-0 flex-1 overflow-y-auto pb-8 focus-visible:shadow-none focus-visible:outline-none",
        placement === "page" && "pe-6 ps-[41px]",
        placement === "pinned" && "pe-4 ps-[41px]",
        placement === "pinnedAtWindowEdge" && "pe-4 ps-[39px]",
      )}
      ref={(element) => {
        surfaceRef.current = element;
        controller?.attachSurface(element);
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

/** The drop line, the "can't move here" note, and the dragged card. */
function TodayDragLayer() {
  const uiText = useUiText();
  const controller = useTodayEditor();
  const indicator = controller?.getDropIndicator() ?? null;
  const ghost = controller?.getDragGhost() ?? null;
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
