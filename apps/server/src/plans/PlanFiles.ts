// @effect-diagnostics nodeBuiltinImport:off -- sha256 of the plan, as DSH's living plan records it.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/**
 * A plan kept in DSH's living-plan layout: `plan.md`, `meta.json` with the version, sha256,
 * size and who wrote it, and every version under `history/vNNNN.md`. Tianshu keeps its own
 * plans this way, so a DSH plan and a Tianshu plan read and write the same.
 */
export interface PlanDocument {
  readonly markdown: string;
  readonly version: number | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export const EMPTY_PLAN: PlanDocument = {
  markdown: "",
  version: null,
  updatedAt: null,
  updatedBy: null,
};

const PlanMeta = Schema.Struct({
  version: Schema.Number,
  hash: Schema.String,
  bytes: Schema.Number,
  updatedAt: Schema.String,
  updatedBy: Schema.String,
});
type PlanMeta = typeof PlanMeta.Type;
const encodeMeta = Schema.encodeEffect(Schema.fromJsonString(PlanMeta));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseMeta = (text: string): Partial<PlanMeta> => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return {};
    return {
      ...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
      ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {}),
      ...(typeof parsed.updatedBy === "string" ? { updatedBy: parsed.updatedBy } : {}),
    };
  } catch {
    return {};
  }
};

/** Reads the plan in `dir`; a missing directory or file is an empty plan. */
export const readPlanDir = Effect.fn("PlanFiles.read")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const markdown = yield* fs
    .readFileString(path.join(dir, "plan.md"))
    .pipe(Effect.orElseSucceed(() => null));
  if (markdown === null) return EMPTY_PLAN;
  const meta = yield* fs.readFileString(path.join(dir, "meta.json")).pipe(
    Effect.map(parseMeta),
    Effect.orElseSucceed((): Partial<PlanMeta> => ({})),
  );
  return {
    markdown,
    version: meta.version ?? null,
    updatedAt: meta.updatedAt ?? null,
    updatedBy: meta.updatedBy ?? null,
  } satisfies PlanDocument;
});

export type PlanWriteResult =
  | { readonly result: "saved"; readonly plan: PlanDocument }
  | { readonly result: "conflict"; readonly plan: PlanDocument };

const writeAtomically = Effect.fn("PlanFiles.writeAtomically")(function* (
  file: string,
  text: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = `${file}.tmp-${NodeCrypto.randomUUID()}`;
  yield* fs.writeFileString(temporary, text);
  yield* fs.rename(temporary, file);
});

/**
 * Writes the next version when the plan is still at `expectedVersion`; otherwise returns the
 * current plan as a conflict. Callers serialize writes to one directory.
 */
export const writePlanDir = Effect.fn("PlanFiles.write")(function* (input: {
  readonly dir: string;
  readonly markdown: string;
  readonly expectedVersion: number | null;
  readonly updatedBy: string;
  readonly now: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const current = yield* readPlanDir(input.dir);
  if ((current.version ?? null) !== input.expectedVersion) {
    return { result: "conflict", plan: current } satisfies PlanWriteResult;
  }
  const version = (current.version ?? 0) + 1;
  const bytes = Buffer.byteLength(input.markdown, "utf8");
  const meta: PlanMeta = {
    version,
    hash: NodeCrypto.createHash("sha256").update(input.markdown, "utf8").digest("hex"),
    bytes,
    updatedAt: input.now,
    updatedBy: input.updatedBy,
  };
  yield* fs.makeDirectory(path.join(input.dir, "history"), { recursive: true });
  yield* fs.writeFileString(
    path.join(input.dir, "history", `v${String(version).padStart(4, "0")}.md`),
    input.markdown,
  );
  yield* writeAtomically(path.join(input.dir, "plan.md"), input.markdown);
  yield* writeAtomically(path.join(input.dir, "meta.json"), yield* encodeMeta(meta));
  return {
    result: "saved",
    plan: { markdown: input.markdown, version, updatedAt: input.now, updatedBy: input.updatedBy },
  } satisfies PlanWriteResult;
});
