import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { type OrchestrationV2ThreadShell, RunId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ActingThreads from "./ActingThreads.ts";
import { actingForFromEnvironment, parseActingFor } from "./actingFor.ts";

const instances = new Map<string, string>();
const idle = new Set(["t-idle"]);
const archived = new Set(["t-archived"]);
// Answers only what isLiveCallerShell reads: every thread runs now, except those named above.
const layerShells = Layer.mock(ProjectionStore.ProjectionStoreV2)({
  getThreadShell: (threadId) =>
    Effect.succeed({
      archivedAt: archived.has(threadId) ? "2026-11-24" : null,
      activeRunId: idle.has(threadId) ? null : RunId.make(`run-${threadId}`),
      providerInstanceId: instances.get(threadId),
      pendingBackgroundTasks: [],
    } as unknown as OrchestrationV2ThreadShell),
});

it.effect("finds the live thread whose agent runs a local command", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acting-threads-" });
    yield* fs.makeDirectory(path.join(home, ".fastctx-web"));
    yield* fs.writeFileString(
      path.join(home, ".fastctx-web", "acp-sessions.json"),
      JSON.stringify({ "fx-new-1": { resident: "claude-new", machine: "box" } }),
    );
    const thread = (id: string, instance: string, deletedAt: string | null = null) =>
      Effect.sync(() => instances.set(id, instance)).pipe(
        Effect.andThen(
          sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json, provider_instance_id, deleted_at)
            VALUES (${id}, 'p-1', ${id}, ${instance}, 'full-access', 'default', '2026-11-24', '2026-11-24', '{}', ${instance}, ${deletedAt})`,
        ),
      );
    const session = (threadId: string, instance: string, nativeId: string) =>
      sql`INSERT INTO orchestration_v2_projection_provider_threads (provider_thread_id, thread_id, provider, driver, provider_instance_id, status, updated_at, payload_json)
        VALUES (${`pt-${threadId}-${instance}`}, ${threadId}, 'acpRegistry', 'acpRegistry', ${instance}, 'idle', '2026-11-24', ${JSON.stringify(
          { nativeThreadRef: { driver: "acpRegistry", nativeId } },
        )})`;
    yield* thread("t-fastctx", "fastctx");
    yield* session("t-fastctx", "fastctx", "claude-1@box");
    yield* thread("t-new", "fastctx");
    yield* session("t-new", "fastctx", "fx-new-1");
    yield* thread("t-wide", "fastctx");
    yield* session("t-wide", "fastctx", "claude-4@实验室mac-1");
    // Handed off to ZCode: its fastctx session no longer speaks for it.
    yield* thread("t-moved", "zcode");
    yield* session("t-moved", "fastctx", "claude-2@box");
    yield* thread("t-gone", "fastctx", "2026-11-24");
    yield* session("t-gone", "fastctx", "claude-3@box");
    // Its turn ended: the conversation talks to the user directly now, not for the thread.
    yield* thread("t-idle", "fastctx");
    yield* session("t-idle", "fastctx", "claude-5@box");
    yield* thread("t-archived", "codex");

    const acting = yield* ActingThreads.ActingThreads;
    const actingFor = (env: Readonly<Record<string, string>>) => {
      const header = actingForFromEnvironment(env);
      const named = header === undefined ? undefined : parseActingFor(header);
      return named === undefined
        ? Effect.undefined
        : acting
            .resolve(named)
            .pipe(Effect.map((found) => found && `${found.threadId} ${found.providerInstanceId}`));
    };
    for (const [env, expected] of [
      [{ T3CODE_THREAD_ID: "t-fastctx", FASTCTX_RESIDENT: "claude-9@box" }, "t-fastctx fastctx"],
      [{ FASTCTX_RESIDENT: "claude-1@box" }, "t-fastctx fastctx"],
      [{ FASTCTX_RESIDENT: "claude-new@box" }, "t-new fastctx"],
      [{ FASTCTX_RESIDENT: "claude-4@实验室mac-1" }, "t-wide fastctx"],
      [{ FASTCTX_RESIDENT: "claude-2@box" }, undefined],
      [{ FASTCTX_RESIDENT: "claude-3@box" }, undefined],
      [{ T3CODE_THREAD_ID: "t-gone" }, undefined],
      [{ FASTCTX_RESIDENT: "claude-5@box" }, undefined],
      [{ T3CODE_THREAD_ID: "t-idle" }, undefined],
      [{ T3CODE_THREAD_ID: "t-archived" }, undefined],
      [{ FASTCTX_RESIDENT: "claude-1" }, undefined],
      [{}, undefined],
    ] as const) {
      assert.deepStrictEqual(
        yield* actingFor(env).pipe(Effect.provideService(HostProcess.HomeDirectory, home)),
        expected,
        JSON.stringify(env),
      );
    }
  }).pipe(
    Effect.scoped,
    Effect.provide(
      ActingThreads.layer.pipe(
        Layer.provide(layerShells),
        Layer.provideMerge(Sqlite.layerMemory),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
