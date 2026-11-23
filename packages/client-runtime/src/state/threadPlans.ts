import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** A thread's plan, live, and the user's edit to it. */
export function createThreadPlanAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    plan: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:thread-plan",
      tag: WS_METHODS.subscribeThreadPlan,
    }),
    write: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-plan:write",
      tag: WS_METHODS.writeThreadPlan,
    }),
  };
}
