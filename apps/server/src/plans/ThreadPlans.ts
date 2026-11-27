import {
  type ProviderInstanceId,
  type ThreadId,
  type ThreadPlan,
  ThreadPlanError,
  type ThreadPlanSource,
  type WriteThreadPlanResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { EMPTY_PLAN, type PlanDocument, readPlanDir, writePlanDir } from "./PlanFiles.ts";
import {
  type CarriedPlan,
  type PlanHandoffKind,
  planHandoffNote,
  shouldCarry,
} from "./planHandoff.ts";
import { planRequirement } from "./planRequirement.ts";

/**
 * Where a thread's plan lives. Agents with a plan of their own keep it there: fastctx in its
 * conversation plan, DSH in its living plan, Antigravity in the task artifacts it writes. Every
 * other agent's plan is Tianshu's, in the state directory, in DSH's layout.
 */
export type PlanLocation =
  | { readonly source: "tianshu"; readonly dir: string }
  | { readonly source: "dsh"; readonly dir: string | null }
  | { readonly source: "antigravity"; readonly dir: string | null }
  | {
      readonly source: "fastctx";
      readonly owner: { readonly resident: string; readonly machine: string | null } | null;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const basename = (part: string) => part.split(/[\\/]/).pop() ?? "";

/** The agent behind a local ACP command when it keeps its own plan. */
export function nativePlanSource(
  config: unknown,
): Exclude<ThreadPlanSource, "tianshu"> | undefined {
  if (!isRecord(config) || config.source !== "local") return undefined;
  const parts = [
    config.commandPath,
    ...(Array.isArray(config.commandArgs) ? config.commandArgs : []),
  ]
    .filter((part): part is string => typeof part === "string")
    .map(basename);
  if (parts.some((part) => /^fastctx-acp(?:\.[\w-]+)?$/i.test(part))) return "fastctx";
  if (parts.some((part) => /^dsh-acp(?:\.py)?$/i.test(part))) return "dsh";
  if (parts.some((part) => /^antigravity-acp(?:\.py)?$/i.test(part))) return "antigravity";
  return undefined;
}

/** fastctx-acp names a session `<resident>@<machine>`, or keeps a new one in acp-sessions.json. */
export function fastctxOwner(
  nativeId: string,
  sessions: unknown,
): { readonly resident: string; readonly machine: string | null } | null {
  const at = nativeId.lastIndexOf("@");
  if (at > 0) return { resident: nativeId.slice(0, at), machine: nativeId.slice(at + 1) || null };
  const hit = isRecord(sessions) ? sessions[nativeId] : undefined;
  return isRecord(hit) && typeof hit.resident === "string"
    ? { resident: hit.resident, machine: typeof hit.machine === "string" ? hit.machine : null }
    : null;
}

/** dsh-acp's id is DSH's own (`session-…`), or a new one it maps in its sessions.json. */
export function dshSessionId(nativeId: string, sessions: unknown): string | null {
  const hit = isRecord(sessions) ? sessions[nativeId] : undefined;
  const id = nativeId.startsWith("session-")
    ? nativeId
    : isRecord(hit) && typeof hit.dsh === "string"
      ? hit.dsh
      : null;
  return id !== null && /^session-[\w-]+$/.test(id) ? id : null;
}

/** Where a plan lives, so a thread that moved to another agent can tell its plan moved too. */
function planLocationKey(location: PlanLocation): string | null {
  switch (location.source) {
    case "tianshu":
      return "tianshu";
    case "dsh":
    case "antigravity":
      return location.dir === null ? null : `${location.source}:${location.dir}`;
    case "fastctx":
      return location.owner === null
        ? null
        : `fastctx:${location.owner.resident}@${location.owner.machine ?? ""}`;
  }
}

const CarriedPlanJson = Schema.fromJsonString(
  Schema.Struct({
    key: Schema.String,
    markdown: Schema.String,
    updatedAt: Schema.NullOr(Schema.String),
  }),
);
const decodeCarried = Schema.decodeUnknownEffect(CarriedPlanJson);
const encodeCarried = Schema.encodeEffect(CarriedPlanJson);

const ANTIGRAVITY_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANTIGRAVITY_ARTIFACTS = ["task.md", "implementation_plan.md"] as const;
const FASTCTX_WEB_URL = "http://127.0.0.1:8765";
const POLL_INTERVAL = "3 seconds";

export interface ThreadPlansShape {
  readonly read: (threadId: ThreadId) => Effect.Effect<ThreadPlan, ThreadPlanError>;
  readonly write: (input: {
    readonly threadId: ThreadId;
    readonly markdown: string;
    readonly expectedVersion: number | null;
    readonly updatedBy: "agent" | "user";
  }) => Effect.Effect<WriteThreadPlanResult, ThreadPlanError>;
  /** The plan now, then again whenever it changes, by anyone. */
  readonly changes: (threadId: ThreadId) => Stream.Stream<ThreadPlan, ThreadPlanError>;
  /**
   * Brings the plan of the work a thread takes over into the plan of the agent now running it,
   * when that one is empty or older; returns what that agent should hear on its first turn.
   */
  readonly handOff: (input: PlanHandoffInput) => Effect.Effect<string, ThreadPlanError>;
  /**
   * What an agent that keeps Tianshu's plan is told with its prompt: the plan is required, and
   * what it says now. Empty for agents with a plan of their own.
   */
  readonly requirement: (input: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
  }) => Effect.Effect<string>;
}

export interface PlanHandoffInput {
  readonly kind: PlanHandoffKind;
  readonly threadId: ThreadId;
  readonly sourceThreadId: ThreadId;
  /** The agent that kept the plan before, for a switch within the thread. */
  readonly sourceProviderInstanceId: ProviderInstanceId | null;
  /** The agent now running the thread, and its session, which may not be recorded yet. */
  readonly targetProviderInstanceId: ProviderInstanceId;
  readonly targetNativeId: string | null;
}

export class ThreadPlans extends Context.Service<ThreadPlans, ThreadPlansShape>()(
  "t3/plans/ThreadPlans",
) {}

const samePlan = (left: ThreadPlan, right: ThreadPlan) =>
  left.source === right.source &&
  left.version === right.version &&
  left.markdown === right.markdown &&
  left.updatedAt === right.updatedAt &&
  left.error === right.error &&
  left.editable === right.editable;

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const written = yield* PubSub.unbounded<ThreadId>();
  const writeLock = yield* Semaphore.make(1);
  const files = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
  );

  const readJson = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.map((text): unknown => {
        try {
          return JSON.parse(text);
        } catch {
          return undefined;
        }
      }),
      Effect.orElseSucceed((): unknown => undefined),
    );

  const tianshuDir = (threadId: ThreadId) =>
    path.join(config.stateDir, "plans", encodeURIComponent(threadId));

  /**
   * Where the thread's plan lives with the agent running it, or with `agent` when given: one it
   * ran before, or one whose session the store has not recorded yet.
   */
  const locate = Effect.fn("ThreadPlans.locate")(function* (
    threadId: ThreadId,
    agent?: {
      readonly providerInstanceId: ProviderInstanceId;
      readonly nativeId?: string | null;
    },
  ) {
    const notFound = () => new ThreadPlanError({ message: `No thread ${threadId}.` });
    const { thread } = yield* projections
      .getThreadProviderContext(threadId)
      .pipe(Effect.mapError(notFound));
    const instanceId = agent?.providerInstanceId ?? thread.providerInstanceId;
    const tianshu: PlanLocation = { source: "tianshu", dir: tianshuDir(threadId) };
    const settings = yield* settingsService.getSettings.pipe(Effect.orElseSucceed(() => null));
    const instance = settings?.providerInstances[instanceId];
    const source =
      instance?.driver === "acpRegistry" ? nativePlanSource(instance.config) : undefined;
    if (source === undefined) return tianshu;
    let nativeId = agent?.nativeId ?? null;
    if (agent?.nativeId === undefined || agent.nativeId === null) {
      const { providerThreads } = yield* projections
        .getThreadProviderContext(threadId, instanceId)
        .pipe(Effect.mapError(notFound));
      const providerThread =
        (instanceId === thread.providerInstanceId
          ? providerThreads.find((candidate) => candidate.id === thread.activeProviderThreadId)
          : undefined) ??
        providerThreads.findLast((candidate) => candidate.providerInstanceId === instanceId);
      nativeId = providerThread?.nativeThreadRef?.nativeId ?? null;
    }
    const home = yield* HostProcess.HomeDirectory;
    switch (source) {
      case "fastctx": {
        const sessions =
          nativeId === null || nativeId.includes("@")
            ? undefined
            : yield* readJson(path.join(home, ".fastctx-web", "acp-sessions.json"));
        return {
          source,
          owner: nativeId === null ? null : fastctxOwner(nativeId, sessions),
        } satisfies PlanLocation;
      }
      case "dsh": {
        const sessions =
          nativeId === null || nativeId.startsWith("session-")
            ? undefined
            : yield* readJson(path.join(home, ".local", "state", "dsh-acp", "sessions.json"));
        const id = nativeId === null ? null : dshSessionId(nativeId, sessions);
        return {
          source,
          dir: id === null ? null : path.join(home, ".dsh", "living-plan", id),
        } satisfies PlanLocation;
      }
      case "antigravity":
        return {
          source,
          dir:
            nativeId !== null && ANTIGRAVITY_SESSION.test(nativeId)
              ? path.join(home, ".gemini", "antigravity", "brain", nativeId)
              : null,
        } satisfies PlanLocation;
    }
  });

  const fastctxCall = Effect.fn("ThreadPlans.fastctxCall")(
    function* (call: Record<string, unknown>) {
      const home = yield* HostProcess.HomeDirectory;
      const token = (yield* fs.readFileString(path.join(home, ".fastctx-web", "token"))).trim();
      const client = yield* HttpClient.HttpClient;
      // The request fastctx-web's own page sends; its cookie is named after the port.
      const response = yield* client.execute(
        HttpClientRequest.post(`${FASTCTX_WEB_URL}/api/call`).pipe(
          HttpClientRequest.setHeaders({ "X-Fx": "1", Cookie: `fxk_8765=${token}` }),
          HttpClientRequest.bodyJsonUnsafe({ call, timeout: 20 }),
        ),
      );
      const body = yield* response.json;
      const reply = isRecord(body) ? body.reply : undefined;
      if (isRecord(reply) && "Ok" in reply) return reply.Ok;
      const refused = isRecord(reply) && isRecord(reply.Err) ? reply.Err.message : undefined;
      const message = isRecord(body) ? body.message : undefined;
      return yield* Effect.fail(
        typeof refused === "string"
          ? refused
          : typeof message === "string"
            ? message
            : `fastctx-web answered ${response.status}.`,
      );
    },
    Effect.timeout("30 seconds"),
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((error) =>
      typeof error === "string" ? error : "Could not reach fastctx-web. Is it running?",
    ),
  );

  const fastctxPlan = (reply: unknown): PlanDocument => {
    const result = isRecord(reply) ? reply.result : undefined;
    const page = isRecord(result) ? result.page : undefined;
    if (!isRecord(page)) return EMPTY_PLAN;
    const metadata = isRecord(page.metadata) ? page.metadata : {};
    const body = isRecord(page.body) ? page.body : {};
    if (metadata.deleted === true) return EMPTY_PLAN;
    return {
      markdown: typeof body.markdown === "string" ? body.markdown : "",
      version: typeof metadata.version === "number" ? metadata.version : null,
      updatedAt: typeof metadata.at === "string" ? metadata.at : null,
      updatedBy: typeof metadata.by === "string" ? metadata.by : null,
    };
  };

  const readAntigravity = Effect.fn("ThreadPlans.readAntigravity")(function* (dir: string) {
    const parts: Array<{ readonly markdown: string; readonly mtime: Date | undefined }> = [];
    for (const name of ANTIGRAVITY_ARTIFACTS) {
      const file = path.join(dir, name);
      const markdown = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
      if (markdown === null || markdown.trim() === "") continue;
      const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => null));
      parts.push({
        markdown: markdown.trim(),
        mtime: info === null ? undefined : Option.getOrUndefined(info.mtime),
      });
    }
    const latest = parts
      .map((part) => part.mtime?.getTime())
      .filter((time): time is number => time !== undefined)
      .toSorted((left, right) => right - left)[0];
    return {
      markdown: parts.map((part) => part.markdown).join("\n\n---\n\n"),
      version: null,
      updatedAt: latest === undefined ? null : DateTime.formatIso(DateTime.makeUnsafe(latest)),
      updatedBy: parts.length === 0 ? null : "agent",
    } satisfies PlanDocument;
  });

  const toThreadPlan = (
    threadId: ThreadId,
    location: PlanLocation,
    document: PlanDocument,
    error: string | null,
  ): ThreadPlan => ({
    threadId,
    source: location.source,
    ...document,
    editable:
      error === null &&
      (location.source === "tianshu" ||
        (location.source === "dsh" && location.dir !== null) ||
        (location.source === "fastctx" && location.owner !== null)),
    error,
  });

  const readAt = (threadId: ThreadId, location: PlanLocation) => {
    switch (location.source) {
      case "tianshu":
        return readPlanDir(location.dir).pipe(
          Effect.provide(files),
          Effect.map((document) => toThreadPlan(threadId, location, document, null)),
        );
      case "dsh":
        return location.dir === null
          ? Effect.succeed(toThreadPlan(threadId, location, EMPTY_PLAN, null))
          : readPlanDir(location.dir).pipe(
              Effect.provide(files),
              Effect.map((document) => toThreadPlan(threadId, location, document, null)),
            );
      case "antigravity":
        return location.dir === null
          ? Effect.succeed(toThreadPlan(threadId, location, EMPTY_PLAN, null))
          : readAntigravity(location.dir).pipe(
              Effect.map((document) => toThreadPlan(threadId, location, document, null)),
            );
      case "fastctx":
        return location.owner === null
          ? Effect.succeed(toThreadPlan(threadId, location, EMPTY_PLAN, null))
          : fastctxCall({
              call: "plan_read",
              hub: null,
              account: null,
              owner: location.owner.resident,
              machine: location.owner.machine,
            }).pipe(
              Effect.map((reply) => toThreadPlan(threadId, location, fastctxPlan(reply), null)),
              Effect.catch((error) =>
                Effect.succeed(toThreadPlan(threadId, location, EMPTY_PLAN, error)),
              ),
            );
    }
  };

  const writeAt = Effect.fn("ThreadPlans.writeAt")(function* (
    threadId: ThreadId,
    location: PlanLocation,
    input: {
      readonly markdown: string;
      readonly expectedVersion: number | null;
      readonly updatedBy: string;
    },
  ) {
    const refused = (message: string) => new ThreadPlanError({ message });
    const now = DateTime.formatIso(yield* DateTime.now);
    const saved = (result: "saved" | "conflict") =>
      readAt(threadId, location).pipe(Effect.map((plan) => ({ result, plan })));
    switch (location.source) {
      case "tianshu":
      case "dsh": {
        if (location.dir === null) {
          return yield* refused("DSH has not started this session yet; send it a message first.");
        }
        const outcome = yield* writePlanDir({
          dir: location.dir,
          markdown: input.markdown,
          expectedVersion: input.expectedVersion,
          updatedBy: input.updatedBy,
          now,
        }).pipe(
          Effect.provide(files),
          Effect.mapError(() => refused("Could not write the plan file.")),
        );
        return yield* saved(outcome.result);
      }
      case "fastctx": {
        if (location.owner === null) {
          return yield* refused(
            "fastctx has not opened this session yet; send it a message first.",
          );
        }
        const reply = yield* fastctxCall({
          call: "plan_write",
          hub: null,
          account: null,
          owner: location.owner.resident,
          machine: location.owner.machine,
          expected: input.expectedVersion,
          markdown: input.markdown,
        }).pipe(Effect.mapError(refused));
        const result = isRecord(reply) && isRecord(reply.result) ? reply.result.result : undefined;
        return yield* saved(result === "conflict" ? "conflict" : "saved");
      }
      case "antigravity":
        return yield* refused(
          "Antigravity keeps its plan in its own task files; Tianshu only shows them.",
        );
    }
  });

  const carryFile = (threadId: ThreadId) => path.join(tianshuDir(threadId), "carry.json");

  const readCarried = (threadId: ThreadId) =>
    fs.readFileString(carryFile(threadId)).pipe(
      Effect.flatMap(decodeCarried),
      Effect.orElseSucceed((): CarriedPlan | null => null),
    );

  /** Notes where the thread's plan is now, so a later agent switch can bring it along. */
  const remember = Effect.fn("ThreadPlans.remember")(function* (
    threadId: ThreadId,
    key: string,
    plan: ThreadPlan,
    carried: CarriedPlan | null,
  ) {
    if (plan.markdown.trim() === "") return;
    if (carried !== null && carried.key === key && carried.markdown === plan.markdown) return;
    const text = yield* encodeCarried({ key, markdown: plan.markdown, updatedAt: plan.updatedAt });
    yield* fs.makeDirectory(tianshuDir(threadId), { recursive: true });
    yield* fs.writeFileString(carryFile(threadId), text);
  });

  /**
   * The plan read now, brought over from where it was kept before when the thread moved to an
   * agent whose own plan is empty or older.
   */
  const reconcile = Effect.fn("ThreadPlans.reconcile")(function* (
    threadId: ThreadId,
    location: PlanLocation,
    plan: ThreadPlan,
  ) {
    const key = planLocationKey(location);
    if (key === null || plan.error !== null) return plan;
    const carried = yield* readCarried(threadId);
    let current = plan;
    if (shouldCarry(carried, { key, ...plan })) {
      const moved = yield* writeAt(threadId, location, {
        markdown: carried.markdown,
        expectedVersion: plan.version,
        updatedBy: "handoff",
      }).pipe(writeLock.withPermits(1), Effect.option);
      if (Option.isSome(moved) && moved.value.result === "saved") current = moved.value.plan;
    }
    yield* remember(threadId, key, current, carried).pipe(Effect.ignore);
    return current;
  });

  const read: ThreadPlansShape["read"] = (threadId) =>
    locate(threadId).pipe(
      Effect.flatMap((location) =>
        readAt(threadId, location).pipe(
          Effect.flatMap((plan) => reconcile(threadId, location, plan)),
        ),
      ),
    );

  /** The plan version each thread's agent was last shown or wrote itself. */
  const lastSeen = new Map<ThreadId, number | null>();

  const write: ThreadPlansShape["write"] = Effect.fn("ThreadPlans.write")(
    function* (input: Parameters<ThreadPlansShape["write"]>[0]) {
      const location = yield* locate(input.threadId);
      const outcome = yield* writeAt(input.threadId, location, input);
      if (input.updatedBy === "agent" && outcome.result === "saved") {
        lastSeen.set(input.threadId, outcome.plan.version);
      }
      const key = planLocationKey(location);
      if (key !== null && outcome.result === "saved") {
        const carried = yield* readCarried(input.threadId);
        yield* remember(input.threadId, key, outcome.plan, carried).pipe(Effect.ignore);
      }
      return outcome;
    },
    (effect, input) =>
      effect.pipe(
        writeLock.withPermits(1),
        Effect.tap(() => PubSub.publish(written, input.threadId)),
      ),
  );

  const changes: ThreadPlansShape["changes"] = (threadId) =>
    Stream.merge(
      Stream.tick(POLL_INTERVAL),
      Stream.fromPubSub(written).pipe(Stream.filter((id) => id === threadId)),
    ).pipe(
      Stream.mapEffect(() => read(threadId)),
      Stream.changesWith(samePlan),
    );

  /** Reads the plan again until the plan a handoff left waiting has moved in, or gives up. */
  const settleCarried = Effect.fn("ThreadPlans.settleCarried")(function* (threadId: ThreadId) {
    for (const wait of ["10 seconds", "30 seconds", "2 minutes"] as const) {
      yield* Effect.sleep(wait);
      yield* read(threadId).pipe(Effect.ignore);
      const carried = yield* readCarried(threadId);
      if (carried === null || !carried.key.startsWith("handoff:")) return;
    }
  });

  const handOff: ThreadPlansShape["handOff"] = Effect.fn("ThreadPlans.handOff")(function* (
    input: PlanHandoffInput,
  ) {
    const sourceLocation =
      input.kind === "provider_handoff" && input.sourceProviderInstanceId !== null
        ? yield* locate(input.sourceThreadId, {
            providerInstanceId: input.sourceProviderInstanceId,
          })
        : yield* locate(input.sourceThreadId);
    const targetLocation = yield* locate(input.threadId, {
      providerInstanceId: input.targetProviderInstanceId,
      nativeId: input.targetNativeId,
    });
    const source = yield* readAt(input.sourceThreadId, sourceLocation);
    if (source.error !== null || source.markdown.trim() === "") return "";
    const sourceKey = planLocationKey(sourceLocation);
    const targetKey = planLocationKey(targetLocation);
    const note = (plan: ThreadPlan, saved: boolean) =>
      planHandoffNote({
        kind: input.kind,
        sourceThreadId: input.sourceThreadId,
        markdown: plan.markdown,
        version: plan.version,
        savedTo: saved && plan.source !== "antigravity" ? plan.source : null,
      });
    // Agents that keep Tianshu's plan share the thread's: a switch between them moves nothing.
    if (input.sourceThreadId === input.threadId && sourceKey !== null && sourceKey === targetKey) {
      return note(source, true);
    }
    const carried: CarriedPlan = {
      key: `handoff:${input.sourceThreadId}:${sourceKey ?? sourceLocation.source}`,
      markdown: source.markdown,
      updatedAt: source.updatedAt,
    };
    const target = yield* readAt(input.threadId, targetLocation);
    if (targetKey === null || !target.editable || target.error !== null) {
      // Not writable yet: fastctx and DSH start their session with the first message this
      // turn sends. The plan rides in that message, and moves once the session exists.
      if (target.source !== "antigravity") {
        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(tianshuDir(input.threadId), { recursive: true });
          yield* fs.writeFileString(carryFile(input.threadId), yield* encodeCarried(carried));
        }).pipe(Effect.ignore);
        yield* Effect.forkDetach(settleCarried(input.threadId));
      }
      return note(source, false);
    }
    if (!shouldCarry(carried, { key: targetKey, ...target })) {
      // Already there, or the new agent's own plan is newer: that one stands.
      return note(target, true);
    }
    const moved = yield* writeAt(input.threadId, targetLocation, {
      markdown: source.markdown,
      expectedVersion: target.version,
      updatedBy: "handoff",
    }).pipe(writeLock.withPermits(1), Effect.option);
    if (Option.isNone(moved) || moved.value.result !== "saved") return note(source, false);
    yield* remember(input.threadId, targetKey, moved.value.plan, null).pipe(Effect.ignore);
    yield* PubSub.publish(written, input.threadId);
    return note(moved.value.plan, true);
  });

  const requirement: ThreadPlansShape["requirement"] = Effect.fn("ThreadPlans.requirement")(
    function* (input: Parameters<ThreadPlansShape["requirement"]>[0]) {
      const location = yield* locate(input.threadId, {
        providerInstanceId: input.providerInstanceId,
      });
      if (location.source !== "tianshu") return "";
      const plan = yield* readAt(input.threadId, location);
      const showPlan =
        !lastSeen.has(input.threadId) || lastSeen.get(input.threadId) !== plan.version;
      lastSeen.set(input.threadId, plan.version);
      return planRequirement({ markdown: plan.markdown, version: plan.version, showPlan });
    },
    Effect.catch((error) =>
      Effect.logWarning("Could not read the plan for a turn", { error }).pipe(Effect.as("")),
    ),
  );

  return ThreadPlans.of({ read, write, changes, handOff, requirement });
});

export const layer = Layer.effect(ThreadPlans, make);

/** For servers built without plans, such as some tests: every call says so. */
export const unavailable: ThreadPlansShape = {
  read: () => Effect.fail(new ThreadPlanError({ message: "Plans are not available here." })),
  write: () => Effect.fail(new ThreadPlanError({ message: "Plans are not available here." })),
  changes: () => Stream.fail(new ThreadPlanError({ message: "Plans are not available here." })),
  handOff: () => Effect.succeed(""),
  requirement: () => Effect.succeed(""),
};
