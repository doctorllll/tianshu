/**
 * Sub-sessions agents asked for with delegate_task while `confirmSubSessionDispatch` is on, held
 * until the user starts them (with any changes to agent, model, options or task) or declines.
 * Kept in memory: a server restart drops them along with the agent sessions that asked.
 */
import {
  type RespondSubSessionProposalInput,
  type RespondSubSessionProposalResult,
  type SubSessionProposal,
  SubSessionProposalError,
  type SubSessionProposalTarget,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export interface SubSessionChoice {
  readonly target: SubSessionProposalTarget;
  readonly title: string | null;
  readonly task: string;
}

/** Starts the sub-session as the user chose it; fails with a message the user can act on. */
export type StartSubSession = (
  choice: SubSessionChoice,
) => Effect.Effect<RespondSubSessionProposalResult, { readonly message: string }>;

interface PendingProposal {
  readonly proposal: SubSessionProposal;
  readonly start: StartSubSession;
}

export class SubSessionProposals extends Context.Service<
  SubSessionProposals,
  {
    /** Holds a proposal; the same task already waiting in that thread is returned instead. */
    readonly propose: (
      proposal: SubSessionProposal,
      start: StartSubSession,
    ) => Effect.Effect<SubSessionProposal>;
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

export const make = Effect.gen(function* () {
  const pending = yield* SubscriptionRef.make<ReadonlyMap<string, PendingProposal>>(new Map());

  const propose = (proposal: SubSessionProposal, start: StartSubSession) =>
    SubscriptionRef.modify(pending, (current) => {
      const waiting = [...current.values()].find(
        (entry) =>
          entry.proposal.parentThreadId === proposal.parentThreadId &&
          entry.proposal.task === proposal.task,
      );
      if (waiting !== undefined) return [waiting.proposal, current] as const;
      return [proposal, new Map(current).set(proposal.id, { proposal, start })] as const;
    });

  const take = (id: string) =>
    SubscriptionRef.modify(pending, (current) => {
      const entry = current.get(id);
      if (entry === undefined) return [undefined, current] as const;
      const next = new Map(current);
      next.delete(id);
      return [entry, next] as const;
    });

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
    if (input.decision === "decline") return { childThreadId: null };
    const { proposal } = entry;
    return yield* entry
      .start({
        target: input.target ?? proposal.target,
        title: input.title === undefined ? proposal.title : input.title,
        task: input.task ?? proposal.task,
      })
      .pipe(
        // Kept, so the user can pick another agent or model and try again.
        Effect.tapError(() =>
          SubscriptionRef.update(pending, (current) => new Map(current).set(proposal.id, entry)),
        ),
        Effect.mapError((error) => new SubSessionProposalError({ message: error.message })),
      );
  });

  return SubSessionProposals.of({
    propose,
    changes: SubscriptionRef.changes(pending).pipe(Stream.map(listOf)),
    respond,
  });
});

export const layer = Layer.effect(SubSessionProposals, make);
