/**
 * How a thread's plan travels, only along the work it belongs to: into a sub-session's first
 * message as the parent's plan to align with, and into the plan of the agent that takes the
 * work over, when the thread switches agents or is forked to continue elsewhere. Unrelated
 * threads, even in the same project, keep their own plans; plan_read reads another's.
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

/** The relationships a plan follows into another agent's hands: an agent switch, or a fork. */
export type PlanHandoffKind = "provider_handoff" | "fork";

/**
 * What the agent taking the work over hears about the plan on its first turn: where the plan is
 * now its own, or, when it could not be saved there yet, the plan itself.
 */
export function planHandoffNote(input: {
  readonly kind: PlanHandoffKind;
  readonly sourceThreadId: string;
  readonly markdown: string;
  readonly version: number | null;
  readonly savedTo: "tianshu" | "dsh" | "fastctx" | null;
}): string {
  const markdown = input.markdown.trim();
  if (markdown === "") return "";
  const from =
    input.kind === "fork"
      ? `This thread continues work forked from thread ${input.sourceThreadId}.`
      : "You are taking this thread over from another agent.";
  const plan = input.version === null ? "Its plan" : `Its plan (version ${input.version})`;
  switch (input.savedTo) {
    case "tianshu":
      return `${from} ${plan} is now this thread's plan: read it with plan_read before you continue, and keep it current with plan_edit or plan_write.`;
    case "dsh":
      return `${from} ${plan} is now your living plan. Read it before you continue, and keep it current.`;
    case "fastctx":
      return `${from} ${plan} is now your conversation plan. Read it before you continue, and keep it current.`;
    case null: {
      const cut = markdown.length > PARENT_PLAN_MAX_CHARS;
      return [
        "<thread_plan>",
        cut ? `${markdown.slice(0, PARENT_PLAN_MAX_CHARS)}\n…` : markdown,
        "</thread_plan>",
        `${from} This is its plan${cut ? ", cut short" : ""}. Continue from it, and keep your own plan in line with it.`,
      ].join("\n");
    }
  }
}
