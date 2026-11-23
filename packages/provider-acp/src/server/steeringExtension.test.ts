import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { acpAdvertisesSteeringExtension, sendSteeringExtension } from "./adapter.ts";

describe("ACP steering extension", () => {
  it("is used only when initialize advertises it", () => {
    assert.isTrue(acpAdvertisesSteeringExtension({ _meta: { steering: { supported: true } } }));
    assert.isFalse(acpAdvertisesSteeringExtension({ _meta: { steering: { supported: false } } }));
    assert.isFalse(acpAdvertisesSteeringExtension({ _meta: {} }));
    assert.isFalse(acpAdvertisesSteeringExtension(undefined));
  });

  it.effect("sends the text now and fails when the agent has no turn to take it", () =>
    Effect.gen(function* () {
      const calls: Array<[string, unknown]> = [];
      const runtime = (outcome: string) => ({
        request: (method: string, params: unknown) =>
          Effect.sync(() => {
            calls.push([method, params]);
            return { outcome };
          }),
      });
      yield* sendSteeringExtension(runtime("injected"), "session-1", "also check the logs");
      assert.deepEqual(calls, [
        [
          "_session/steering",
          {
            sessionId: "session-1",
            prompt: [{ type: "text", text: "also check the logs" }],
            _meta: { steering: { priority: "now" } },
          },
        ],
      ]);
      const idle = yield* Effect.exit(
        sendSteeringExtension(runtime("promptRequired"), "session-1", "too late"),
      );
      assert.isTrue(Exit.isFailure(idle));
    }),
  );
});
