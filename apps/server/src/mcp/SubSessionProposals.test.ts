import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  type SubSessionProposal,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as SubSessionProposals from "./SubSessionProposals.ts";

const proposal = (id: string, task: string): SubSessionProposal => ({
  id,
  parentThreadId: ThreadId.make("thread-parent"),
  proposedBy: ProviderInstanceId.make("claudeAgent"),
  createdAt: "2026-11-24T00:00:00.000Z",
  target: { providerInstanceId: ProviderInstanceId.make("zcode"), model: "GLM-5.4", options: [] },
  title: null,
  task,
});

const request = (task: string): SubSessionProposals.SubSessionRequest => ({
  caller: {
    environmentId: EnvironmentId.make("environment-local"),
    capabilities: ["orchestration"],
    issuedAt: 1,
    requestNamespace: "thread:thread-parent",
    thread: {
      threadId: ThreadId.make("thread-parent"),
      providerSessionId: "session-1",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    },
  },
  input: {
    task,
    target: { providerInstanceId: ProviderInstanceId.make("zcode"), model: "GLM-5.4" },
  },
});

const current = (service: SubSessionProposals.SubSessionProposals["Service"]) =>
  service.changes.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map((all) => [...all][0] ?? []),
  );

describe("SubSessionProposals", () => {
  it.effect("holds a proposal once and starts it as the user changed it", () =>
    Effect.gen(function* () {
      const service = yield* SubSessionProposals.make;
      const started: Array<{ task: string; choice: SubSessionProposals.SubSessionChoice }> = [];
      yield* service.setStarter((asked, choice) =>
        Effect.sync(() => {
          started.push({ task: asked.input.task, choice });
          return { childThreadId: ThreadId.make("thread-child") };
        }),
      );
      yield* service.propose(proposal("p1", "Summarize the logs"), request("Summarize the logs"));
      // The agent asking again for the same task gets the waiting proposal back.
      const again = yield* service.propose(
        proposal("p2", "Summarize the logs"),
        request("Summarize the logs"),
      );
      expect(again.id).toBe("p1");
      expect((yield* current(service)).map((item) => item.id)).toEqual(["p1"]);

      const result = yield* service.respond({
        proposalId: "p1",
        decision: "dispatch",
        target: { providerInstanceId: ProviderInstanceId.make("codex"), model: null, options: [] },
        task: "Summarize the last hour of logs",
      });
      expect(result.childThreadId).toBe("thread-child");
      expect(started).toEqual([
        {
          task: "Summarize the logs",
          choice: {
            target: { providerInstanceId: "codex", model: null, options: [] },
            title: null,
            task: "Summarize the last hour of logs",
          },
        },
      ]);
      expect(yield* current(service)).toEqual([]);
      const gone = yield* Effect.flip(service.respond({ proposalId: "p1", decision: "dispatch" }));
      expect(gone._tag).toBe("SubSessionProposalError");
    }),
  );

  it.effect("drops a declined proposal and keeps one whose start failed", () =>
    Effect.gen(function* () {
      const service = yield* SubSessionProposals.make;
      yield* service.setStarter(() => Effect.fail({ message: "ZCode is not available." }));
      yield* service.propose(proposal("p1", "Task one"), request("Task one"));
      yield* service.propose(proposal("p2", "Task two"), request("Task two"));

      expect(yield* service.respond({ proposalId: "p1", decision: "decline" })).toEqual({
        childThreadId: null,
      });
      const failed = yield* Effect.flip(
        service.respond({ proposalId: "p2", decision: "dispatch" }),
      );
      expect(failed.message).toBe("ZCode is not available.");
      expect((yield* current(service)).map((item) => item.id)).toEqual(["p2"]);
    }),
  );

  it.effect("keeps waiting proposals through a restart and starts them afterwards", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(yield* fs.makeTempDirectoryScoped(), "state", "proposals.json");

      const before = yield* SubSessionProposals.makeWith(
        yield* SubSessionProposals.fileStore(file),
      );
      yield* before.propose(proposal("p1", "Task one"), request("Task one"));
      yield* before.propose(proposal("p2", "Task two"), request("Task two"));
      yield* before.respond({ proposalId: "p2", decision: "decline" });

      // A new server reads the file: p1 still waits, with what starting it needs.
      const after = yield* SubSessionProposals.makeWith(yield* SubSessionProposals.fileStore(file));
      expect((yield* current(after)).map((item) => item.id)).toEqual(["p1"]);
      const early = yield* Effect.flip(after.respond({ proposalId: "p1", decision: "dispatch" }));
      expect(early.message).toContain("still starting");
      expect((yield* current(after)).map((item) => item.id)).toEqual(["p1"]);

      const asked: Array<SubSessionProposals.SubSessionRequest> = [];
      yield* after.setStarter((request) =>
        Effect.sync(() => {
          asked.push(request);
          return { childThreadId: ThreadId.make("thread-child") };
        }),
      );
      yield* after.respond({ proposalId: "p1", decision: "dispatch" });
      expect(asked).toEqual([request("Task one")]);

      const empty = yield* SubSessionProposals.makeWith(yield* SubSessionProposals.fileStore(file));
      expect(yield* current(empty)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("starts empty from an unreadable file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(yield* fs.makeTempDirectoryScoped(), "proposals.json");
      yield* fs.writeFileString(file, "{not json");
      const service = yield* SubSessionProposals.makeWith(
        yield* SubSessionProposals.fileStore(file),
      );
      expect(yield* current(service)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
