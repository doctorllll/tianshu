/**
 * What an agent that keeps Tianshu's thread plan is told with each prompt: that using the plan is
 * required, and what the plan says now. Agents with their own plan (fastctx, DSH) are told by
 * their own side, so they never get this.
 */
import { PARENT_PLAN_MAX_CHARS } from "./planHandoff.ts";

const RULES = [
  "<plan_rules>",
  "This thread keeps a plan: Markdown the user and other agents follow and hand off from. Using it is required.",
  "- Before any work beyond a quick answer, write it with plan_write: goal, steps as [ ]/[x], decisions, open questions.",
  "- Keep it current as you work (plan_edit for a small change, plan_write to rewrite; pass the version you read), and bring it up to date before you end a turn.",
  '- The tools are plan_read, plan_write and plan_edit from t3-code; if they are not listed, search your tools for "plan_write".',
  "</plan_rules>",
];

/**
 * The rules and the plan state for one turn. The plan itself rides along only when it changed
 * since it was last shown (the agent's own writes do not count), so a long thread does not
 * repeat it in every message.
 */
export function planRequirement(input: {
  readonly markdown: string;
  readonly version: number | null;
  readonly showPlan: boolean;
}): string {
  const markdown = input.markdown.trim();
  if (markdown === "") {
    return [...RULES, "This thread has no plan yet: write it first."].join("\n");
  }
  const version = input.version === null ? "" : ` version="${input.version}"`;
  if (!input.showPlan) {
    return [...RULES, "The plan is unchanged since you last saw it."].join("\n");
  }
  const cut = markdown.length > PARENT_PLAN_MAX_CHARS;
  return [
    ...RULES,
    `<current_plan${version}>`,
    cut ? `${markdown.slice(0, PARENT_PLAN_MAX_CHARS)}\n…` : markdown,
    "</current_plan>",
    cut ? "The plan above is cut short; plan_read reads all of it." : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
