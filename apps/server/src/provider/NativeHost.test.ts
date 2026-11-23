import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { probeNativeHost } from "./NativeHost.ts";

describe("probeNativeHost", () => {
  it.effect("finds a process by its exact name", () =>
    Effect.gen(function* () {
      expect(yield* probeNativeHost({ label: "node", processName: "node" })).toBe(true);
      expect(
        yield* probeNativeHost({ label: "missing", processName: "t3-no-such-process-name" }),
      ).toBe(false);
    }),
  );

  it.effect("treats a refused connection as not running", () =>
    Effect.gen(function* () {
      expect(yield* probeNativeHost({ label: "closed", probeUrl: "http://127.0.0.1:9/" })).toBe(
        false,
      );
    }),
  );
});
