/**
 * How a thread's plan travels: into a sub-session's first message, and across an agent switch,
 * when the plan's home changes (Tianshu's own, fastctx's, DSH's).
 */

/** The most of the parent's plan a sub-session's first message carries. */
export const PARENT_PLAN_MAX_CHARS = 4_000;

/** The sub-session's task with the parent's plan after it, when the parent keeps one. */
export function withParentPlan(
  task: string,
  parent: { readonly threadId: string; readonly markdown: string },
): string {
  const markdown = parent.markdown.trim();
  if (markdown === "") return task;
  const cut = markdown.length > PARENT_PLAN_MAX_CHARS;
  const shown = cut ? `${markdown.slice(0, PARENT_PLAN_MAX_CHARS)}\n…` : markdown;
  return [
    task,
    "",
    `<parent_plan thread="${parent.threadId}">`,
    shown,
    "</parent_plan>",
    cut
      ? `The parent session's plan, cut short; plan_read with threadId "${parent.threadId}" reads all of it. Align your work with it.`
      : "The parent session's plan. Align your work with it.",
  ].join("\n");
}

/** The last plan a thread had, and where it was kept. */
export interface CarriedPlan {
  readonly key: string;
  readonly markdown: string;
  readonly updatedAt: string | null;
}

const time = (iso: string | null) => (iso === null ? Number.NaN : Date.parse(iso));

/**
 * Whether the plan last seen elsewhere replaces the plan now read: after the thread moved to
 * another agent, when the new home is empty or older, and can be written.
 */
export function shouldCarry(
  carried: CarriedPlan | null,
  current: {
    readonly key: string;
    readonly markdown: string;
    readonly updatedAt: string | null;
    readonly editable: boolean;
  },
): carried is CarriedPlan {
  if (carried === null || carried.key === current.key || !current.editable) return false;
  if (carried.markdown.trim() === "" || carried.markdown === current.markdown) return false;
  if (current.markdown.trim() === "") return true;
  const carriedAt = time(carried.updatedAt);
  const currentAt = time(current.updatedAt);
  return Number.isFinite(carriedAt) && (!Number.isFinite(currentAt) || carriedAt > currentAt);
}
