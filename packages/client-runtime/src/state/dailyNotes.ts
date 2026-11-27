import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

/** Daily notes: the saved days, one day's snapshot, and saving it back. */
export function createDailyNotesAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:daily-notes:list",
      tag: WS_METHODS.dailyNotesList,
    }),
    get: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:daily-notes:get",
      tag: WS_METHODS.dailyNotesGet,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:daily-notes:save",
      tag: WS_METHODS.dailyNotesSave,
    }),
  };
}
