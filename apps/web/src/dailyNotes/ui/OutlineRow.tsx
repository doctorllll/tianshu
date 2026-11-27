/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-day-section.tsx.
 * Modified for Tianshu (Tailwind, thread mentions).
 */
import { CheckIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { createContext, Fragment, memo, useContext, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useUiText } from "~/i18n/useUiText";

import { TodayEditorContext } from "../editor/today-editor-context";
import { TodayMentionDecorators } from "../editor/today-mention-decorators";
import { TODAY_INDENT_PX } from "../editor/today-editor-controller";
import type { TodayNodeView } from "../model/outline";
import type { TodayPageStore } from "../store/page-store";
import { TodayMention } from "./MentionChip";

/**
 * At the window's edge (pinned, sidebar hidden) a top row has no margin left of its fold toggle,
 * so the row's "⋯" button sits at the row's end instead.
 */
export const TodayMoreAtEndContext = createContext(false);

/** How far a row's fold toggle hangs left of the text column, in px. */
export const FOLD_OVERHANG_PX = 17;

const TEXT_CLASS =
  "min-w-0 flex-1 whitespace-pre-wrap py-1 text-sm leading-5 text-foreground [overflow-wrap:anywhere]";

export const TodayRow = memo(function TodayRow(props: {
  node: TodayNodeView | null;
  store: TodayPageStore;
  active: boolean;
  selected: boolean;
  joinsPrevious?: boolean;
  joinsNext?: boolean;
  /** The zoomed node's own row: its text as the view's title, without fold or bullet. */
  title?: boolean;
}) {
  const uiText = useUiText();
  const { node, store, active, selected, title = false } = props;
  const controller = useContext(TodayEditorContext);
  const moreAtEnd = useContext(TodayMoreAtEndContext);
  const done = node?.todo === "done";
  const blank = !!node && !node.text.trim() && !node.hasChildren && !node.todo;
  const quiet = blank && !active && !selected;
  return (
    <div
      className={cn(
        "group/row relative flex min-h-7 items-start gap-1 rounded-sm",
        title && "static",
        selected && "bg-info/14",
        selected && props.joinsPrevious && "rounded-t-none",
        selected && props.joinsNext && "rounded-b-none",
      )}
      style={{
        marginInlineStart: -FOLD_OVERHANG_PX,
        paddingInlineStart: (node?.depth ?? 0) * TODAY_INDENT_PX,
        paddingInlineEnd: moreAtEnd && !title ? 18 : undefined,
      }}
      role="treeitem"
      aria-selected={selected || undefined}
      aria-expanded={node?.hasChildren ? !node.collapsed : undefined}
      data-today-node={node?.id}
      onPointerDown={(event) => {
        // The gaps between controls are inert: they must not take focus from the editor.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      {title || !node ? null : (
        <button
          type="button"
          className="absolute top-0 inline-flex h-7 w-4 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground/60 opacity-0 transition-opacity duration-100 hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
          style={moreAtEnd ? { right: 0 } : { left: node.depth * TODAY_INDENT_PX - 16 }}
          aria-label={uiText("Node actions")}
          aria-haspopup="menu"
          tabIndex={-1}
          data-today-more=""
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => controller?.onNodeMenu?.(store, node.id, event.currentTarget)}
        >
          <MoreHorizontalIcon className="size-3.5" strokeWidth={2} />
        </button>
      )}
      {title ? null : (
        <button
          type="button"
          className={cn(
            "pointer-events-none relative -me-1 inline-flex h-7 w-3 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground/60 opacity-0 transition-opacity duration-100 before:pointer-events-auto before:absolute before:inset-y-0 before:-left-1.5 before:right-0.5 before:content-[''] focus-visible:opacity-100 group-hover/row:opacity-100",
            active && "opacity-100",
            !node?.hasChildren && "invisible",
          )}
          aria-label={node?.collapsed ? uiText("Expand") : uiText("Collapse")}
          tabIndex={-1}
          onClick={() => {
            if (!node) return;
            // Folding is not an undo step.
            store.outline.setCollapsed(node.id, !node.collapsed);
          }}
        >
          <ChevronRightIcon
            className={cn("size-3", node?.hasChildren && !node.collapsed && "rotate-90")}
          />
        </button>
      )}
      {title ? null : (
        <span
          className="pointer-events-none relative inline-flex h-7 w-4 shrink-0 cursor-pointer touch-none items-center justify-center before:pointer-events-auto before:absolute before:inset-y-0 before:left-px before:right-px before:content-['']"
          data-today-bullet=""
          onPointerDown={(event) => {
            if (!controller || !node || event.button !== 0) return;
            event.preventDefault();
            controller.beginNodeDrag(store, node.id, event.currentTarget, event);
          }}
          onContextMenu={(event) => {
            if (!controller?.onNodeMenu || !node) return;
            event.preventDefault();
            controller.onNodeMenu(store, node.id, { x: event.clientX, y: event.clientY });
          }}
        >
          <span className="pointer-events-auto relative inline-flex size-4 items-center justify-center rounded-full bg-transparent transition-colors duration-100 hover:bg-accent">
            <span
              className={cn(
                "size-1.5 rounded-full bg-muted-foreground",
                node?.collapsed && "ring-4 ring-accent",
                quiet && "opacity-0 transition-opacity duration-100 group-hover/row:opacity-100",
              )}
              data-today-dot={quiet ? "quiet" : undefined}
            />
          </span>
        </span>
      )}
      {node?.todo ? (
        <span
          className="inline-flex h-7 w-4 shrink-0 cursor-pointer items-center justify-center"
          role="checkbox"
          aria-checked={done}
          aria-label={uiText("Done")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => controller?.toggleDone(store, node.id)}
        >
          <span
            className={cn(
              "box-border inline-flex size-3.5 items-center justify-center rounded-sm border-2 border-solid border-muted-foreground/60 text-white hover:border-muted-foreground",
              done && "border-info bg-info hover:border-info",
            )}
          >
            {done ? <CheckIcon className="size-2.5" strokeWidth={3.5} /> : null}
          </span>
        </span>
      ) : null}
      {active && controller ? (
        <>
          <div
            key="editor"
            ref={(element) => controller.attachRoot(element)}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            aria-multiline
            className={cn(
              TEXT_CLASS,
              "cursor-text outline-none",
              title && "text-base font-semibold leading-6",
              done && "text-muted-foreground line-through",
            )}
            onPointerDown={(event) => {
              if (!node || event.button !== 0 || event.metaKey || event.ctrlKey) return;
              if (event.shiftKey || event.altKey || event.detail > 1) return;
              controller.pointerDownInEditor(store, node.id, event.currentTarget);
            }}
          />
          <TodayMentionDecorators controller={controller} />
        </>
      ) : (
        <div
          key="static"
          className={cn(
            TEXT_CLASS,
            title && "text-base font-semibold leading-6",
            (!node || !node.text) && "cursor-text text-muted-foreground/60",
            done && "text-muted-foreground line-through",
          )}
          onPointerDown={(event) => {
            if (!controller || event.button !== 0 || event.metaKey || event.ctrlKey) return;
            if (event.altKey) return;
            event.preventDefault();
            if (!node) controller.startPage(store);
            else controller.pointerDown(store, node.id, event.currentTarget, event);
          }}
        >
          {node ? <TodayStaticText node={node} /> : uiText("Write something…")}
          {node?.text.endsWith("\n") ? "\n" : null}
        </div>
      )}
    </div>
  );
});

/** A node's text as the editor would show it: text runs and mentions. */
function TodayStaticText(props: { node: TodayNodeView }) {
  const { text, mentions } = props.node;
  if (!text) return "​";
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start > cursor) {
      parts.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor, mention.start)}</Fragment>);
    }
    parts.push(<TodayMention key={`mention-${mention.start}`} mention={mention} />);
    cursor = mention.start + 1;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor)}</Fragment>);
  }
  return parts;
}
