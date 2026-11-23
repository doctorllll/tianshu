import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Sub-sessions agents asked for that wait for the user, and the user's answer to one. */
export function createSubSessionProposalAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:sub-session-proposals",
      tag: WS_METHODS.subscribeSubSessionProposals,
    }),
    respond: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sub-session-proposals:respond",
      tag: WS_METHODS.respondSubSessionProposal,
    }),
  };
}
