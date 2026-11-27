import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";

import { useNavigateToMainApp } from "~/components/sidebar/mainAppLocation";
import { SidebarInset } from "~/components/ui/sidebar";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { buildThreadRouteParams } from "~/threadRoutes";

import { todayRouteOutcome } from "../model/dates";
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

/**
 * The daily notes as a page of the main area (route `/daily-notes`). With the experiment off the
 * route leaves; while the notes are pinned it hands its day to the column instead.
 */
export function DailyNotesPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_chat/daily-notes" });
  const openThread = useOpenThreadMention();
  const navigateToMainApp = useNavigateToMainApp();
  const enabled = useDailyNotesPrefs((prefs) => prefs.enabled);
  const pinned = useDailyNotesPrefs((prefs) => prefs.pinned);
  const setPinned = useDailyNotesPrefs((prefs) => prefs.setPinned);
  const setPinnedTarget = useDailyNotesPrefs((prefs) => prefs.setPinnedTarget);
  const compact = useIsMobile();
  const outcome = todayRouteOutcome({ enabled, pinned, compact });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a route that is not a page hands its day to the column and leaves
  useEffect(() => {
    if (outcome === "page") return;
    if (outcome === "to-column") setPinnedTarget(search);
    void navigateToMainApp();
  }, [navigateToMainApp, outcome, search, setPinnedTarget]);
  if (outcome !== "page") return null;
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
          onTogglePin={() => {
            setPinnedTarget(search);
            setPinned(true);
            void navigateToMainApp();
          }}
          onOpenThread={openThread}
        />
      </div>
    </SidebarInset>
  );
}
