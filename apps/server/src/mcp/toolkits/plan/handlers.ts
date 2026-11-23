import { OrchestratorMcpFailure, type ThreadPlanError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as ThreadPlans from "../../../plans/ThreadPlans.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PlanToolkit } from "./tools.ts";

const failure = (error: ThreadPlanError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const callerThread = (operation: string) =>
  McpInvocationContext.McpInvocationContext.pipe(
    Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, operation)),
    Effect.map((scope) => scope.thread.threadId),
  );

export const layer = McpToolAccess.toLayer(PlanToolkit, {
  plan_read: McpToolAccess.readsAsCaller(({ threadId }) =>
    Effect.gen(function* () {
      const own = yield* callerThread("plan_read");
      const plans = yield* ThreadPlans.ThreadPlans;
      return yield* plans.read(threadId ?? own).pipe(Effect.mapError(failure));
    }),
  ),
  plan_write: McpToolAccess.writesThreads(
    () => [undefined],
    ({ markdown, expectedVersion }) =>
      Effect.gen(function* () {
        const threadId = yield* callerThread("plan_write");
        const plans = yield* ThreadPlans.ThreadPlans;
        return yield* plans
          .write({ threadId, markdown, expectedVersion, updatedBy: "agent" })
          .pipe(Effect.mapError(failure));
      }),
  ),
  plan_edit: McpToolAccess.writesThreads(
    () => [undefined],
    ({ oldText, newText }) =>
      Effect.gen(function* () {
        const threadId = yield* callerThread("plan_edit");
        const plans = yield* ThreadPlans.ThreadPlans;
        const current = yield* plans.read(threadId).pipe(Effect.mapError(failure));
        if (!current.editable) {
          return yield* invalid(current.error ?? "This thread's plan is read-only here.");
        }
        const at = current.markdown.indexOf(oldText);
        if (at < 0) return yield* invalid("oldText is not in the plan. Read it with plan_read.");
        if (current.markdown.includes(oldText, at + 1)) {
          return yield* invalid("oldText occurs more than once; include more of the line.");
        }
        const markdown =
          current.markdown.slice(0, at) + newText + current.markdown.slice(at + oldText.length);
        return yield* plans
          .write({ threadId, markdown, expectedVersion: current.version, updatedBy: "agent" })
          .pipe(Effect.mapError(failure));
      }),
  ),
});
