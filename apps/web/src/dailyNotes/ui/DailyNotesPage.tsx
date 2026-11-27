import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { SidebarInset } from "~/components/ui/sidebar";
import { buildThreadRouteParams } from "~/threadRoutes";

import { decodeThreadMentionId } from "../thread-mention";
import { useDailyNotesPrefs } from "../state/dailyNotesPrefs";
import { TodayView, type TodayViewTarget } from "./DailyNotesView";

/** Opens the thread a mention points at in the main area. */
export function useOpenThreadMention() {
  const navigate = useNavigate();
  return (mentionId: string) => {
    const ref = decodeThreadMentionId(mentionId);
    if (!ref) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(
        scopeThreadRef(ref.environmentId as EnvironmentId, ref.threadId as ThreadId),
      ),
    });
  };
}

/** The daily notes as a page of the main area (route `/daily-notes`). */
export function DailyNotesPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_chat/daily-notes" });
  const openThread = useOpenThreadMention();
  const setPinned = useDailyNotesPrefs((prefs) => prefs.setPinned);
  const onNavigate = (target: TodayViewTarget) => {
    void navigate({ to: "/daily-notes", search: target });
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <TodayView
          target={search}
          onNavigate={onNavigate}
          surface="page"
          onTogglePin={() => setPinned(true)}
          onOpenThread={openThread}
        />
      </div>
    </SidebarInset>
  );
}
