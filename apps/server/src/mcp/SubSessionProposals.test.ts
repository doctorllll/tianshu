import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type SubSessionProposal, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
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
      const started: Array<SubSessionProposals.SubSessionChoice> = [];
      const start: SubSessionProposals.StartSubSession = (choice) =>
        Effect.sync(() => {
          started.push(choice);
          return { childThreadId: ThreadId.make("thread-child") };
        });
      yield* service.propose(proposal("p1", "Summarize the logs"), start);
      // The agent asking again for the same task gets the waiting proposal back.
      const again = yield* service.propose(proposal("p2", "Summarize the logs"), start);
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
          target: { providerInstanceId: "codex", model: null, options: [] },
          title: null,
          task: "Summarize the last hour of logs",
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
      const failing: SubSessionProposals.StartSubSession = () =>
        Effect.fail({ message: "ZCode is not available." });
      yield* service.propose(proposal("p1", "Task one"), failing);
      yield* service.propose(proposal("p2", "Task two"), failing);

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
});
