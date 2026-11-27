// @effect-diagnostics nodeBuiltinImport:off -- unique temporary file names for atomic writes.
import * as NodeCrypto from "node:crypto";

import {
  type DailyNoteEntry,
  DailyNoteError,
  type GetDailyNoteResult,
  type ListDailyNotesResult,
  type SaveDailyNoteInput,
  type SaveDailyNoteResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Base64 from "effect/encoding/Base64";

import * as ServerConfig from "../config.ts";

/**
 * Daily notes on disk: `<stateDir>/daily-notes/<date>.loro` is the page snapshot and
 * `<date>.json` its revision and list entry. The snapshot is opaque here: the client's CRDT
 * merges concurrent edits, this only orders saves by revision. The snapshot a save replaces is
 * kept once as `<date>.loro.prev`.
 */
export interface DailyNotesShape {
  readonly list: Effect.Effect<ListDailyNotesResult, DailyNoteError>;
  readonly get: (date: string) => Effect.Effect<GetDailyNoteResult, DailyNoteError>;
  readonly save: (input: SaveDailyNoteInput) => Effect.Effect<SaveDailyNoteResult, DailyNoteError>;
}

export class DailyNotes extends Context.Service<DailyNotes, DailyNotesShape>()(
  "t3/dailyNotes/DailyNotes",
) {}

const DailyNoteMeta = Schema.Struct({
  revision: Schema.Number,
  empty: Schema.Boolean,
  preview: Schema.String,
  updatedAt: Schema.String,
});
type DailyNoteMeta = typeof DailyNoteMeta.Type;
const decodeMeta = Schema.decodeUnknownOption(Schema.fromJsonString(DailyNoteMeta));
const encodeMeta = Schema.encodeEffect(Schema.fromJsonString(DailyNoteMeta));

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  const dir = path.join(config.stateDir, "daily-notes");

  const fail = (message: string) => (cause: unknown) =>
    new DailyNoteError({
      message: cause instanceof Error ? `${message}: ${cause.message}` : message,
    });

  const snapshotFile = (date: string) => path.join(dir, `${date}.loro`);
  const metaFile = (date: string) => path.join(dir, `${date}.json`);

  const readMeta = (date: string) =>
    fs.readFileString(metaFile(date)).pipe(
      Effect.map((text) => decodeMeta(text)),
      Effect.orElseSucceed(() => undefined),
      Effect.map((option) => (option?._tag === "Some" ? option.value : null)),
    );

  const writeAtomically = Effect.fn("DailyNotes.writeAtomically")(function* (
    file: string,
    data: Uint8Array | string,
  ) {
    const temporary = `${file}.tmp-${NodeCrypto.randomUUID()}`;
    yield* typeof data === "string"
      ? fs.writeFileString(temporary, data)
      : fs.writeFile(temporary, data);
    yield* fs.rename(temporary, file);
  });

  const get = Effect.fn("DailyNotes.get")(function* (date: string) {
    const meta = yield* readMeta(date);
    if (meta === null) return { date, revision: 0, snapshot: null } satisfies GetDailyNoteResult;
    const bytes = yield* fs
      .readFile(snapshotFile(date))
      .pipe(Effect.mapError(fail(`Could not read the note for ${date}`)));
    return {
      date,
      revision: meta.revision,
      snapshot: Base64.encode(bytes),
    } satisfies GetDailyNoteResult;
  });

  const list = Effect.fn("DailyNotes.list")(function* () {
    const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []));
    const days: DailyNoteEntry[] = [];
    for (const name of names) {
      const date = DATE_FILE.exec(name)?.[1];
      if (!date) continue;
      const meta = yield* readMeta(date);
      if (meta !== null) days.push({ date, ...meta });
    }
    return { days: days.toSorted((a, b) => (a.date < b.date ? 1 : -1)) };
  });

  const save = Effect.fn("DailyNotes.save")(
    function* (input: SaveDailyNoteInput) {
      const current = yield* readMeta(input.date);
      const revision = current?.revision ?? 0;
      if (revision !== input.baseRevision) {
        const latest = yield* get(input.date);
        return {
          result: "conflict",
          revision: latest.revision,
          snapshot: latest.snapshot,
        } satisfies SaveDailyNoteResult;
      }
      const decoded = Base64.decode(input.snapshot);
      if (Result.isFailure(decoded)) {
        return yield* new DailyNoteError({ message: "The note snapshot is not valid base64." });
      }
      const mapWriteError = Effect.mapError(fail(`Could not save the note for ${input.date}`));
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(mapWriteError);
      if (current !== null) {
        yield* fs
          .copyFile(snapshotFile(input.date), `${snapshotFile(input.date)}.prev`)
          .pipe(Effect.ignore);
      }
      const meta: DailyNoteMeta = {
        revision: revision + 1,
        empty: input.empty,
        preview: input.preview,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      const encodedMeta = yield* encodeMeta(meta).pipe(mapWriteError);
      yield* writeAtomically(snapshotFile(input.date), decoded.success).pipe(mapWriteError);
      yield* writeAtomically(metaFile(input.date), encodedMeta).pipe(mapWriteError);
      return { result: "saved", revision: meta.revision, snapshot: null } satisfies SaveDailyNoteResult;
    },
    lock.withPermits(1),
  );

  return DailyNotes.of({
    list: list(),
    get: Effect.fn("DailyNotes.getLocked")((date: string) => lock.withPermits(1)(get(date))),
    save,
  });
});

export const layer = Layer.effect(DailyNotes, make);

/** For servers built without daily notes, such as some tests: every call says so. */
export const unavailable: DailyNotesShape = {
  list: Effect.fail(new DailyNoteError({ message: "Daily notes are not available here." })),
  get: () => Effect.fail(new DailyNoteError({ message: "Daily notes are not available here." })),
  save: () => Effect.fail(new DailyNoteError({ message: "Daily notes are not available here." })),
};
