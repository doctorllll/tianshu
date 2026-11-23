/**
 * Sub-sessions agents asked for with delegate_task while `confirmSubSessionDispatch` is on, held
 * until the user starts them (with any changes to agent, model, options or task) or declines.
 * The server keeps them in `<state>/sub-session-proposals.json`, so one still waits after Tianshu
 * restarts: the agent was told it waits, and starting it later wakes its thread as before.
 */
// @effect-diagnostics nodeBuiltinImport:off -- a unique temporary name for the atomic save.
import * as NodeCrypto from "node:crypto";

import {
  EnvironmentId,
  OrchestratorMcpDelegateTaskInput,
  ProviderInstanceId,
  type RespondSubSessionProposalInput,
  type RespondSubSessionProposalResult,
  SubSessionProposal,
  SubSessionProposalError,
  type SubSessionProposalTarget,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";

export interface SubSessionChoice {
  readonly target: SubSessionProposalTarget;
  readonly title: string | null;
  readonly task: string;
}

/** What starting the sub-session needs: the asking thread's MCP caller and its delegate_task input. */
export const SubSessionRequest = Schema.Struct({
  caller: Schema.Struct({
    environmentId: EnvironmentId,
    capabilities: Schema.Array(Schema.String),
    issuedAt: Schema.Number,
    requestNamespace: Schema.String,
    thread: Schema.Struct({
      threadId: ThreadId,
      providerSessionId: Schema.String,
      providerInstanceId: ProviderInstanceId,
      subagent: Schema.optional(Schema.Boolean),
    }),
  }),
  input: OrchestratorMcpDelegateTaskInput,
});
export type SubSessionRequest = typeof SubSessionRequest.Type;

/** Starts the sub-session as the user chose it; fails with a message the user can act on. */
export type StartSubSession = (
  request: SubSessionRequest,
  choice: SubSessionChoice,
) => Effect.Effect<RespondSubSessionProposalResult, { readonly message: string }>;

const PendingProposal = Schema.Struct({
  proposal: SubSessionProposal,
  request: SubSessionRequest,
});
type PendingProposal = typeof PendingProposal.Type;

const PendingProposalsJson = Schema.fromJsonString(Schema.Array(PendingProposal));
const decodePending = Schema.decodeUnknownEffect(PendingProposalsJson);
const encodePending = Schema.encodeEffect(PendingProposalsJson);

/** Where proposals outlive the server; absent, they live only in memory, as in tests. */
export interface SubSessionProposalStore {
  readonly load: Effect.Effect<ReadonlyArray<PendingProposal>>;
  readonly save: (pending: ReadonlyArray<PendingProposal>) => Effect.Effect<void>;
}

export class SubSessionProposals extends Context.Service<
  SubSessionProposals,
  {
    /** Holds a proposal; the same task already waiting in that thread is returned instead. */
    readonly propose: (
      proposal: SubSessionProposal,
      request: SubSessionRequest,
    ) => Effect.Effect<SubSessionProposal>;
    /** Set by the service that can start sub-sessions, once it is up. */
    readonly setStarter: (start: StartSubSession) => Effect.Effect<void>;
    readonly changes: Stream.Stream<ReadonlyArray<SubSessionProposal>>;
    readonly respond: (
      input: RespondSubSessionProposalInput,
    ) => Effect.Effect<RespondSubSessionProposalResult, SubSessionProposalError>;
  }
>()("t3/mcp/SubSessionProposals") {}

const listOf = (pending: ReadonlyMap<string, PendingProposal>) =>
  [...pending.values()]
    .map((entry) => entry.proposal)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));

export const makeWith = Effect.fn("SubSessionProposals.make")(function* (
  store: SubSessionProposalStore | undefined,
) {
  const loaded = store === undefined ? [] : yield* store.load;
  const pending = yield* SubscriptionRef.make<ReadonlyMap<string, PendingProposal>>(
    new Map(loaded.map((entry) => [entry.proposal.id, entry])),
  );
  const starter = yield* Ref.make<StartSubSession | undefined>(undefined);
  const saveLock = yield* Semaphore.make(1);

  // Saves whatever is pending when it runs, so the last save always holds the latest state.
  const persist =
    store === undefined
      ? Effect.void
      : saveLock.withPermits(1)(
          SubscriptionRef.get(pending).pipe(Effect.flatMap((all) => store.save([...all.values()]))),
        );

  const propose = (proposal: SubSessionProposal, request: SubSessionRequest) =>
    SubscriptionRef.modify(pending, (current) => {
      const waiting = [...current.values()].find(
        (entry) =>
          entry.proposal.parentThreadId === proposal.parentThreadId &&
          entry.proposal.task === proposal.task,
      );
      if (waiting !== undefined) return [waiting.proposal, current] as const;
      return [proposal, new Map(current).set(proposal.id, { proposal, request })] as const;
    }).pipe(Effect.tap(() => persist));

  const take = (id: string) =>
    SubscriptionRef.modify(pending, (current) => {
      const entry = current.get(id);
      if (entry === undefined) return [undefined, current] as const;
      const next = new Map(current);
      next.delete(id);
      return [entry, next] as const;
    });

  const putBack = (entry: PendingProposal) =>
    SubscriptionRef.update(pending, (current) =>
      new Map(current).set(entry.proposal.id, entry),
    ).pipe(Effect.andThen(persist));

  const respond = Effect.fn("SubSessionProposals.respond")(function* (
    input: RespondSubSessionProposalInput,
  ) {
    // Taken before starting, so a second click finds nothing to start twice.
    const entry = yield* take(input.proposalId);
    if (entry === undefined) {
      return yield* new SubSessionProposalError({
        message: "This sub-session request is no longer waiting.",
      });
    }
    yield* persist;
    if (input.decision === "decline") return { childThreadId: null };
    const start = yield* Ref.get(starter);
    if (start === undefined) {
      yield* putBack(entry);
      return yield* new SubSessionProposalError({
        message: "Tianshu is still starting up. Try again in a moment.",
      });
    }
    const { proposal } = entry;
    return yield* start(entry.request, {
      target: input.target ?? proposal.target,
      title: input.title === undefined ? proposal.title : input.title,
      task: input.task ?? proposal.task,
    }).pipe(
      // Kept, so the user can pick another agent or model and try again.
      Effect.tapError(() => putBack(entry)),
      Effect.mapError((error) => new SubSessionProposalError({ message: error.message })),
    );
  });

  return SubSessionProposals.of({
    propose,
    setStarter: Effect.fn("SubSessionProposals.setStarter")(function* (start: StartSubSession) {
      yield* Ref.set(starter, start);
    }),
    changes: SubscriptionRef.changes(pending).pipe(Stream.map(listOf)),
    respond,
  });
});

/** Held in memory only. */
export const make = makeWith(undefined);

/** Proposals in a JSON file, saved whole and atomically; an unreadable file starts empty. */
export const fileStore = Effect.fn("SubSessionProposals.fileStore")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const none: ReadonlyArray<PendingProposal> = [];
  const load = fs.readFileString(file).pipe(
    Effect.flatMap((text) => decodePending(text)),
    Effect.catch((error) =>
      PlatformError.isPlatformError(error) && error.reason._tag === "NotFound"
        ? Effect.succeed(none)
        : Effect.logWarning("Could not read the waiting sub-session requests", error).pipe(
            Effect.as(none),
          ),
    ),
  );
  const save = Effect.fn("SubSessionProposals.save")(
    function* (pending: ReadonlyArray<PendingProposal>) {
      const text = yield* encodePending(pending);
      const temporary = `${file}.tmp-${NodeCrypto.randomUUID()}`;
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(temporary, text);
      yield* fs.rename(temporary, file);
    },
    Effect.catch((error) =>
      Effect.logWarning("Could not save the waiting sub-session requests", error),
    ),
  );
  return { load, save } satisfies SubSessionProposalStore;
});

export const layer = Layer.effect(
  SubSessionProposals,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return yield* makeWith(
      yield* fileStore(path.join(config.stateDir, "sub-session-proposals.json")),
    );
  }),
);
