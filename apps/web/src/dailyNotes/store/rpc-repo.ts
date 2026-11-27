import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Base64 from "effect/encoding/Base64";
import * as Result from "effect/Result";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { dailyNotes } from "~/state/dailyNotes";

import { parseTodayDate } from "../model/dates";
import type { DailyNotesRepoPort } from "./repo-port";

function unwrap<A>(result: AtomCommandResult<A, unknown>, what: string): A {
  if (result._tag === "Success") return result.value;
  throw new Error(`${what}: ${thrownErrorMessage(squashAtomCommandFailure(result))}`);
}

const decodeSnapshot = (snapshot: string | null): Uint8Array | null => {
  if (snapshot === null) return null;
  const decoded = Base64.decode(snapshot);
  if (Result.isFailure(decoded)) throw new Error("The saved note is damaged.");
  return decoded.success;
};

/** Daily notes of one environment's server, over its RPC connection. */
export function createRpcDailyNotesRepo(environmentId: EnvironmentId): DailyNotesRepoPort {
  const options = { reportFailure: false, reportDefect: false } as const;
  return {
    list: async () => {
      const { days } = unwrap(
        await runAtomCommand(
          appAtomRegistry,
          dailyNotes.list,
          { environmentId, input: {} },
          options,
        ),
        "Could not list daily notes",
      );
      return days.flatMap((day) => {
        const date = parseTodayDate(day.date);
        return date ? [{ ...day, date }] : [];
      });
    },
    load: async (date) => {
      const result = unwrap(
        await runAtomCommand(
          appAtomRegistry,
          dailyNotes.get,
          { environmentId, input: { date } },
          options,
        ),
        `Could not read the note for ${date}`,
      );
      return { revision: result.revision, snapshot: decodeSnapshot(result.snapshot) };
    },
    save: async (input) => {
      const result = unwrap(
        await runAtomCommand(
          appAtomRegistry,
          dailyNotes.save,
          {
            environmentId,
            input: { ...input, snapshot: Base64.encode(input.snapshot) },
          },
          options,
        ),
        `Could not save the note for ${input.date}`,
      );
      if (result.result === "saved") return { status: "saved", revision: result.revision };
      const snapshot = decodeSnapshot(result.snapshot);
      if (!snapshot) throw new Error("The server reported a conflict without a note.");
      return { status: "conflict", revision: result.revision, snapshot };
    },
  };
}
