/**
 * What an agent that keeps Tianshu's thread plan is told with each prompt: that using the plan is
 * required, what the plan says now, and a nudge when it has gone quiet. Agents with their own
 * plan (fastctx, DSH) are told by their own side, so they never get this.
 */
import { PARENT_PLAN_MAX_CHARS } from "./planHandoff.ts";

/** Turns in a row that begin with the plan unchanged before the agent is asked to catch it up. */
export const PLAN_STALE_TURNS = 2;

/** Turns after which the plan is shown in full again, in case a compaction swallowed it. */
export const PLAN_REFRESH_TURNS = 8;

const RULES = [
  "<plan_rules>",
  "This thread keeps a plan: Markdown the user and other agents follow and hand off from. Using it is required.",
  "- Before any work beyond a quick answer, write it with plan_write. How to write and arrange it is up to you; the one test is that someone who reads only the plan can carry on.",
  "- Keep it current as you work (plan_edit for a small change, plan_write to rewrite; pass the version you read), and bring it up to date before you end a turn.",
  '- The tools are plan_read, plan_write and plan_edit from t3-code; if they are not listed, search your tools for "plan_write".',
  "</plan_rules>",
];

/** What the server remembers about one thread's plan between turns. */
export interface PlanTurnState {
  /** The plan version at the start of the previous turn. */
  readonly startVersion: number | null;
  /** The version the agent last saw or wrote itself. */
  readonly seenVersion: number | null;
  /** Turns in a row that began with the plan unchanged. */
  readonly quiet: number;
  /** Turns since the plan was last shown in full. */
  readonly sinceShown: number;
}

/**
 * The state at the start of a turn, with whether the plan goes along in full. It does when the
 * agent has not seen this version or a while has passed; its own writes do not count as unseen.
 */
export function advancePlanState(
  previous: PlanTurnState | undefined,
  version: number | null,
): { readonly state: PlanTurnState; readonly showPlan: boolean } {
  if (previous === undefined) {
    return {
      state: { startVersion: version, seenVersion: version, quiet: 0, sinceShown: 0 },
      showPlan: true,
    };
  }
  const showPlan =
    previous.seenVersion !== version || previous.sinceShown + 1 >= PLAN_REFRESH_TURNS;
  return {
    state: {
      startVersion: version,
      seenVersion: version,
      quiet: version === previous.startVersion ? previous.quiet + 1 : 0,
      sinceShown: showPlan ? 0 : previous.sinceShown + 1,
    },
    showPlan,
  };
}

/** The plan as the agent just wrote it is already known to it. */
export function planWritten(
  previous: PlanTurnState | undefined,
  version: number | null,
): PlanTurnState | undefined {
  return previous === undefined ? undefined : { ...previous, seenVersion: version };
}

const turns = (count: number) => (count === 1 ? "1 turn" : `${count} turns`);

/**
 * The rules and the plan state for one turn. The plan itself rides along only when `showPlan`,
 * so a long thread does not repeat it in every message.
 */
export function planRequirement(input: {
  readonly markdown: string;
  readonly version: number | null;
  readonly showPlan: boolean;
  readonly quietTurns: number;
}): string {
  const markdown = input.markdown.trim();
  if (markdown === "") {
    return [
      ...RULES,
      input.quietTurns >= 1
        ? `This thread still has no plan after ${turns(input.quietTurns + 1)}: write it now, before anything else.`
        : "This thread has no plan yet: write it first.",
    ].join("\n");
  }
  const stale =
    input.quietTurns >= PLAN_STALE_TURNS
      ? `The plan has not changed for ${turns(input.quietTurns)}. Before you continue, bring it in line with what was done and what the user has asked since.`
      : "";
  const version = input.version === null ? "" : ` version="${input.version}"`;
  if (!input.showPlan) {
    return [...RULES, "The plan is unchanged since you last saw it.", stale]
      .filter((line) => line !== "")
      .join("\n");
  }
  const cut = markdown.length > PARENT_PLAN_MAX_CHARS;
  return [
    ...RULES,
    stale,
    `<current_plan${version}>`,
    cut ? `${markdown.slice(0, PARENT_PLAN_MAX_CHARS)}\n…` : markdown,
    "</current_plan>",
    cut ? "The plan above is cut short; plan_read reads all of it." : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
