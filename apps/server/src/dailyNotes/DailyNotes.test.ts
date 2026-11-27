import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Base64 from "effect/encoding/Base64";

import * as ServerConfig from "../config.ts";
import * as DailyNotes from "./DailyNotes.ts";

const layer = DailyNotes.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-daily-notes-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const bytes = (text: string) => Base64.encode(new TextEncoder().encode(text));
const save = (
  date: string,
  baseRevision: number,
  text: string,
  extra: { empty?: boolean; preview?: string } = {},
) => ({
  date,
  baseRevision,
  snapshot: bytes(text),
  empty: extra.empty ?? false,
  preview: extra.preview ?? text,
});

describe("DailyNotes", () => {
  it.effect("reads a day that was never saved as revision 0 with no snapshot", () =>
    Effect.gen(function* () {
      const notes = yield* DailyNotes.DailyNotes;
      assert.deepStrictEqual(yield* notes.get("2026-11-20"), {
        date: "2026-11-20",
        revision: 0,
        snapshot: null,
      });
      assert.deepStrictEqual((yield* notes.list).days, []);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("saves a day, bumps its revision, and lists newest first", () =>
    Effect.gen(function* () {
      const notes = yield* DailyNotes.DailyNotes;
      const first = yield* notes.save(save("2026-11-19", 0, "one", { preview: "one" }));
      assert.deepStrictEqual(first, { result: "saved", revision: 1, snapshot: null });
      const second = yield* notes.save(save("2026-11-19", 1, "two", { preview: "two" }));
      assert.strictEqual(second.revision, 2);
      yield* notes.save(save("2026-11-20", 0, "later", { empty: true, preview: "" }));

      const read = yield* notes.get("2026-11-19");
      assert.strictEqual(read.revision, 2);
      assert.strictEqual(read.snapshot, bytes("two"));

      const days = (yield* notes.list).days;
      assert.deepStrictEqual(
        days.map((day) => [day.date, day.revision, day.empty, day.preview]),
        [
          ["2026-11-20", 1, true, ""],
          ["2026-11-19", 2, false, "two"],
        ],
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a save made against an old revision and returns the current snapshot", () =>
    Effect.gen(function* () {
      const notes = yield* DailyNotes.DailyNotes;
      yield* notes.save(save("2026-11-18", 0, "mine"));
      yield* notes.save(save("2026-11-18", 1, "theirs"));
      const stale = yield* notes.save(save("2026-11-18", 1, "late"));
      assert.deepStrictEqual(stale, {
        result: "conflict",
        revision: 2,
        snapshot: bytes("theirs"),
      });
      assert.strictEqual((yield* notes.get("2026-11-18")).snapshot, bytes("theirs"));

      const newDayStale = yield* notes.save(save("2026-11-17", 3, "x"));
      assert.strictEqual(newDayStale.result, "conflict");
      assert.strictEqual(newDayStale.revision, 0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps the snapshot a save replaced as .prev", () =>
    Effect.gen(function* () {
      const notes = yield* DailyNotes.DailyNotes;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* notes.save(save("2026-11-16", 0, "before"));
      yield* notes.save(save("2026-11-16", 1, "after"));
      const prev = yield* fs.readFileString(
        path.join(config.stateDir, "daily-notes", "2026-11-16.loro.prev"),
      );
      assert.strictEqual(prev, "before");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a snapshot that is not base64", () =>
    Effect.gen(function* () {
      const notes = yield* DailyNotes.DailyNotes;
      const error = yield* Effect.flip(
        notes.save({
          date: "2026-11-15",
          baseRevision: 0,
          snapshot: "not base64 !!",
          empty: false,
          preview: "",
        }),
      );
      assert.strictEqual(error._tag, "DailyNoteError");
    }).pipe(Effect.provide(layer)),
  );
});
