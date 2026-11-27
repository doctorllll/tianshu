import type { ReactNode } from "react";

import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

export type DailyNotesSurface = "page" | "pinned";

/**
 * The notes' top row. On the page it is the workspace header, so the window drags by it and it
 * clears the traffic lights; in the pinned column it is a drag strip of the same height.
 */
export function DailyNotesToolbar(props: {
  surface: DailyNotesSurface;
  title: ReactNode;
  /** The title holds controls (the focus view's breadcrumb): they must take clicks. */
  interactiveTitle?: boolean;
  children: ReactNode;
}) {
  const content = (
    <>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] text-muted-foreground",
          props.interactiveTitle && "[-webkit-app-region:no-drag]",
        )}
      >
        {props.title}
      </span>
      <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">{props.children}</div>
    </>
  );
  if (props.surface === "page") {
    return (
      <WorkspacePageHeader
        electron={isElectron}
        showQuota={false}
        data-testid="daily-notes-toolbar"
      >
        {content}
      </WorkspacePageHeader>
    );
  }
  return (
    <header
      className={cn(
        "flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center gap-1 px-4",
        isElectron && "drag-region",
      )}
      data-testid="daily-notes-toolbar"
    >
      {content}
    </header>
  );
}
