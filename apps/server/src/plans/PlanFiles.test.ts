// @effect-diagnostics nodeBuiltinImport:off -- checks the recorded sha256 against the file.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { EMPTY_PLAN, readPlanDir, writePlanDir } from "./PlanFiles.ts";

const now = "2026-11-24T01:00:00.000Z";

describe("PlanFiles", () => {
  it.effect("reads a missing plan as empty", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(yield* fs.makeTempDirectoryScoped(), "none");
      assert.deepStrictEqual(yield* readPlanDir(dir), EMPTY_PLAN);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("writes versions in DSH's layout and refuses a stale one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(yield* fs.makeTempDirectoryScoped(), "plans", "thread%3A1");

      const first = yield* writePlanDir({
        dir,
        markdown: "# Goal\n- [ ] one\n",
        expectedVersion: null,
        updatedBy: "agent",
        now,
      });
      assert.strictEqual(first.result, "saved");
      assert.strictEqual(first.plan.version, 1);

      const meta = JSON.parse(yield* fs.readFileString(path.join(dir, "meta.json")));
      assert.deepStrictEqual(meta, {
        version: 1,
        hash: NodeCrypto.createHash("sha256").update("# Goal\n- [ ] one\n").digest("hex"),
        bytes: 17,
        updatedAt: now,
        updatedBy: "agent",
      });
      assert.strictEqual(
        yield* fs.readFileString(path.join(dir, "history", "v0001.md")),
        "# Goal\n- [ ] one\n",
      );

      const stale = yield* writePlanDir({
        dir,
        markdown: "# Other\n",
        expectedVersion: null,
        updatedBy: "user",
        now,
      });
      assert.strictEqual(stale.result, "conflict");
      assert.strictEqual(stale.plan.markdown, "# Goal\n- [ ] one\n");

      const second = yield* writePlanDir({
        dir,
        markdown: "# Goal\n- [x] one\n",
        expectedVersion: 1,
        updatedBy: "user",
        now,
      });
      assert.strictEqual(second.result, "saved");
      assert.deepStrictEqual(yield* readPlanDir(dir), {
        markdown: "# Goal\n- [x] one\n",
        version: 2,
        updatedAt: now,
        updatedBy: "user",
      });
      assert.deepStrictEqual((yield* fs.readDirectory(path.join(dir, "history"))).toSorted(), [
        "v0001.md",
        "v0002.md",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("continues a plan DSH wrote", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(path.join(dir, "plan.md"), "from dsh");
      yield* fs.writeFileString(
        path.join(dir, "meta.json"),
        '{"version":7,"hash":"x","bytes":8,"updatedAt":"2026-11-22T16:08:24.044Z","updatedBy":"agent"}',
      );
      const plan = yield* readPlanDir(dir);
      assert.strictEqual(plan.version, 7);
      const next = yield* writePlanDir({
        dir,
        markdown: "from tianshu",
        expectedVersion: 7,
        updatedBy: "user",
        now,
      });
      assert.strictEqual(next.plan.version, 8);
      assert.strictEqual(
        yield* fs.readFileString(path.join(dir, "history", "v0008.md")),
        "from tianshu",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
