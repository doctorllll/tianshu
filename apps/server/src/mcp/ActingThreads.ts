/**
 * Finds the thread a `T3-Acting-For` header names (`actingFor.ts`), so a local `t3` command acts as
 * that thread's agent: `t3 thread start` then asks for a sub-session the user confirms, as
 * delegate_task does. Only a full-access client outside any thread may name one.
 */
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { fastctxOwner } from "../plans/ThreadPlans.ts";
import type { ActingFor } from "./actingFor.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import { isLiveCallerShell } from "./threadAccess.ts";

export interface ActingThread {
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
}

/** The session ids fastctx-acp may have given a thread that drives this fastctx conversation. */
const fastctxSessionIds = (
  resident: string,
  machine: string,
  sessions: unknown,
): ReadonlyArray<string> => [
  `${resident}@${machine}`,
  ...(typeof sessions === "object" && sessions !== null && !Array.isArray(sessions)
    ? Object.keys(sessions).filter((id) => {
        const owner = fastctxOwner(id, sessions);
        return owner?.resident === resident && owner.machine === machine;
      })
    : []),
];

/** The scope of the thread's own agent, for a client that named it. */
export const actAsThread = (
  invocation: McpInvocationContext.McpInvocationScope & {
    readonly client: McpInvocationContext.McpClientCaller;
  },
  thread: ActingThread,
): McpInvocationContext.McpThreadInvocationScope => ({
  ...invocation,
  thread: {
    threadId: thread.threadId,
    providerSessionId: `t3-cli:${invocation.client.sessionId}`,
    providerInstanceId: thread.providerInstanceId,
  },
  client: undefined,
});

export class ActingThreads extends Context.Service<
  ActingThreads,
  {
    /** The live thread it names, with the agent it runs now; undefined when there is none. */
    readonly resolve: (actingFor: ActingFor) => Effect.Effect<ActingThread | undefined>;
  }
>()("t3/mcp/ActingThreads") {}

interface ThreadRow {
  readonly thread_id: string;
  readonly provider_instance_id: string | null;
}

export const layer = Layer.effect(
  ActingThreads,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fastctxSessions = Effect.gen(function* () {
      const home = yield* HostProcess.HomeDirectory;
      return yield* fs.readFileString(path.join(home, ".fastctx-web", "acp-sessions.json")).pipe(
        Effect.map((text): unknown => {
          try {
            return JSON.parse(text);
          } catch {
            return undefined;
          }
        }),
        Effect.orElseSucceed((): unknown => undefined),
      );
    });

    // The thread's current agent must be the one with that session, not one it handed off from.
    const fastctxThread = (sessionIds: ReadonlyArray<string>) => sql<ThreadRow>`
      SELECT thread.thread_id, thread.provider_instance_id
      FROM orchestration_v2_projection_provider_threads AS provider
      JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = provider.thread_id
      WHERE provider.provider_instance_id = thread.provider_instance_id
        AND json_extract(provider.payload_json, '$.nativeThreadRef.nativeId') IN ${sql.in(sessionIds)}
        AND thread.deleted_at IS NULL
      ORDER BY thread.updated_at DESC
      LIMIT 1
    `;

    const resolve = Effect.fn("ActingThreads.resolve")(
      function* (actingFor: ActingFor) {
        const rows =
          actingFor.kind === "thread"
            ? yield* sql<ThreadRow>`
                SELECT thread_id, provider_instance_id
                FROM orchestration_v2_projection_threads
                WHERE thread_id = ${actingFor.threadId} AND deleted_at IS NULL
              `
            : yield* fastctxThread(
                fastctxSessionIds(actingFor.resident, actingFor.machine, yield* fastctxSessions),
              );
        const row = rows[0];
        if (row === undefined || row.provider_instance_id === null) return undefined;
        const thread = {
          threadId: ThreadId.make(row.thread_id),
          providerInstanceId: ProviderInstanceId.make(row.provider_instance_id),
        } satisfies ActingThread;
        // Its agent speaks for it only while it runs there, as delegate_task's caller check asks:
        // a command run after that, or in an archived thread, is an outside client's.
        const shell = yield* projections.getThreadShell(thread.threadId);
        return isLiveCallerShell(shell, thread.providerInstanceId) ? thread : undefined;
      },
      Effect.catch((error) =>
        Effect.logWarning("Could not find the thread a local client acts for", error).pipe(
          Effect.as(undefined),
        ),
      ),
    );
    return ActingThreads.of({ resolve });
  }),
);
