import {
  OrchestratorMcpFailure,
  ThreadId,
  ThreadPlan,
  WriteThreadPlanResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadPlans from "../../../plans/ThreadPlans.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const common = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    ThreadPlans.ThreadPlans,
    ThreadManagementService.ThreadManagementService,
    McpInvocationContext.McpInvocationContext,
  ],
};

const PlanRead = Tool.make("plan_read", {
  ...common,
  description:
    "Read this thread's plan, or another thread's (a parent or sub-session) by threadId to align with it.",
  parameters: Schema.Struct({ threadId: Schema.optional(ThreadId) }),
  success: ThreadPlan,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const PlanWrite = Tool.make("plan_write", {
  ...common,
  description:
    "Replace this thread's plan, the Markdown the user and other agents follow and hand off from. On multi-step work keep it current: goal, steps as [ ]/[x], decisions, open questions. Pass the version you read (null if none); a conflict returns the current plan.",
  parameters: Schema.Struct({
    markdown: Schema.String,
    expectedVersion: Schema.NullOr(Schema.Number),
  }),
  success: WriteThreadPlanResult,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const PlanEdit = Tool.make("plan_edit", {
  ...common,
  description: "Edit this thread's plan: replace oldText, which must occur once, with newText.",
  parameters: Schema.Struct({
    oldText: Schema.String.check(Schema.isMinLength(1)),
    newText: Schema.String,
  }),
  success: WriteThreadPlanResult,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const PlanToolkit = Toolkit.make(PlanRead, PlanWrite, PlanEdit);
