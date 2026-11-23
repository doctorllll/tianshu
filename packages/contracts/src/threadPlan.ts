/**
 * A thread's plan: one Markdown document the agent keeps current while it works, which the user
 * and other agents read to stay aligned. Agents with a plan of their own keep it there (fastctx's
 * conversation plan, DSH's living plan, Antigravity's task artifacts); every other agent gets one
 * kept by Tianshu, in the same versioned layout as DSH's.
 */
import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

export const ThreadPlanSource = Schema.Literals(["tianshu", "fastctx", "dsh", "antigravity"]);
export type ThreadPlanSource = typeof ThreadPlanSource.Type;

export const ThreadPlan = Schema.Struct({
  threadId: ThreadId,
  source: ThreadPlanSource,
  /** Empty when the thread has no plan yet. */
  markdown: Schema.String,
  /** Increments on every write; null before the first one. */
  version: Schema.NullOr(Schema.Number),
  updatedAt: Schema.NullOr(Schema.String),
  /** Who wrote the current version, such as "agent" or "user". */
  updatedBy: Schema.NullOr(Schema.String),
  /** Whether Tianshu can write it (Antigravity's artifacts are read-only here). */
  editable: Schema.Boolean,
  /** Why the plan could not be read, such as fastctx-web not running. */
  error: Schema.NullOr(Schema.String),
});
export type ThreadPlan = typeof ThreadPlan.Type;

export const SubscribeThreadPlanInput = Schema.Struct({ threadId: ThreadId });
export type SubscribeThreadPlanInput = typeof SubscribeThreadPlanInput.Type;

export const WriteThreadPlanInput = Schema.Struct({
  threadId: ThreadId,
  markdown: Schema.String,
  /** The version the edit started from; a different current version is a conflict. */
  expectedVersion: Schema.NullOr(Schema.Number),
});
export type WriteThreadPlanInput = typeof WriteThreadPlanInput.Type;

export const WriteThreadPlanResult = Schema.Struct({
  result: Schema.Literals(["saved", "conflict"]),
  plan: ThreadPlan,
});
export type WriteThreadPlanResult = typeof WriteThreadPlanResult.Type;

export class ThreadPlanError extends Schema.TaggedError<ThreadPlanError>()("ThreadPlanError", {
  message: Schema.String,
}) {}
