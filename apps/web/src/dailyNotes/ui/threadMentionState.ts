/**
 * What a mention of a thread shows. Status comes from the same signals as the sidebar row, so a
 * thread reads the same in both places; the notes derive nothing of their own.
 */
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "~/components/Sidebar.logic";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useAllEnvironmentShellsBootstrapped, useThreadShell } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { decodeThreadMentionId } from "../thread-mention";

/** The one leading icon a mention shows, in priority order. */
export type ThreadMentionStatus = "waiting" | "running" | "later" | "done" | "unread" | "idle";

export type ThreadMentionDisplay =
  | { state: "loading" }
  | { state: "missing" }
  | {
      state: "ok";
      title: string;
      status: ThreadMentionStatus;
      /** Has output not yet seen: the menu offers Mark as read. */
      unread: boolean;
      /** Snoozed or settled: the menu offers Move to Focus. */
      parked: boolean;
      /** When a snoozed thread wakes. */
      snoozedUntil: string | null;
    };

export function threadMentionRef(mentionId: string): ScopedThreadRef | null {
  const ref = decodeThreadMentionId(mentionId);
  return ref ? scopeThreadRef(ref.environmentId as EnvironmentId, ref.threadId as ThreadId) : null;
}

/**
 * Priority: waiting > running > later > done > unread > idle. A thread the shell store does not
 * hold is deleted or unreachable only once the stores have settled.
 */
export function threadMentionDisplay(input: {
  shell: EnvironmentThreadShell | null;
  shellsSettled: boolean;
  lastVisitedAt: string | undefined;
  now: string;
}): ThreadMentionDisplay {
  const { shell } = input;
  if (shell === null) return { state: input.shellsSettled ? "missing" : "loading" };
  const rowStatus = resolveSidebarRowStatus({ ...shell, lastVisitedAt: input.lastVisitedAt });
  const unread = hasUnseenCompletion({ ...shell, lastVisitedAt: input.lastVisitedAt });
  const snoozed = effectiveSnoozed(shell, { now: input.now });
  const settled = shell.settledOverride === "settled" || shell.archivedAt !== null;
  const status: ThreadMentionStatus =
    rowStatus === "approval" || rowStatus === "input" || rowStatus === "request"
      ? "waiting"
      : rowStatus === "preparing" || rowStatus === "working" || rowStatus === "waiting"
        ? "running"
        : snoozed
          ? "later"
          : settled
            ? "done"
            : unread
              ? "unread"
              : "idle";
  return {
    state: "ok",
    title: shell.title.trim(),
    status,
    unread,
    parked: snoozed || settled,
    snoozedUntil: snoozed ? shell.snoozedUntil : null,
  };
}

/** A thread mention's display, following the thread live. */
export function useThreadMentionDisplay(mentionId: string): ThreadMentionDisplay {
  const ref = threadMentionRef(mentionId);
  const shell = useThreadShell(ref);
  const localLastVisitedAt = useUiStateStore((state) =>
    ref ? state.threadLastVisitedAtById[scopedThreadKey(ref)] : undefined,
  );
  const shellsSettled = useAllEnvironmentShellsBootstrapped();
  const now = useNowMinute();
  return threadMentionDisplay({
    shell,
    shellsSettled,
    lastVisitedAt: resolveThreadLastVisitedAt(shell?.lastVisitedAt, localLastVisitedAt),
    now,
  });
}
