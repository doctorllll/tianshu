/**
 * A sub-session an agent asked for with `delegate_task`, held until the user confirms it. The
 * user may change its agent, model, options and task before it starts, or decline it.
 */
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelection } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const SubSessionProposalTarget = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  model: Schema.NullOr(TrimmedNonEmptyString),
  options: Schema.Array(ProviderOptionSelection),
});
export type SubSessionProposalTarget = typeof SubSessionProposalTarget.Type;

export const SubSessionProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  parentThreadId: ThreadId,
  /** The agent of the parent thread that asked for it. */
  proposedBy: ProviderInstanceId,
  createdAt: Schema.String,
  target: SubSessionProposalTarget,
  title: Schema.NullOr(TrimmedNonEmptyString),
  task: TrimmedNonEmptyString,
});
export type SubSessionProposal = typeof SubSessionProposal.Type;

export const SubSessionProposalList = Schema.Array(SubSessionProposal);
export type SubSessionProposalList = typeof SubSessionProposalList.Type;

export const RespondSubSessionProposalInput = Schema.Struct({
  proposalId: TrimmedNonEmptyString,
  decision: Schema.Literals(["dispatch", "decline"]),
  /** What the user changed before dispatching; absent fields keep the agent's proposal. */
  target: Schema.optional(SubSessionProposalTarget),
  title: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  task: Schema.optional(TrimmedNonEmptyString),
});
export type RespondSubSessionProposalInput = typeof RespondSubSessionProposalInput.Type;

export const RespondSubSessionProposalResult = Schema.Struct({
  childThreadId: Schema.NullOr(ThreadId),
});
export type RespondSubSessionProposalResult = typeof RespondSubSessionProposalResult.Type;

export class SubSessionProposalError extends Schema.TaggedError<SubSessionProposalError>()(
  "SubSessionProposalError",
  { message: Schema.String },
) {}
