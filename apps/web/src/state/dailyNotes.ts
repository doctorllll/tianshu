import { createDailyNotesAtoms } from "@t3tools/client-runtime/state/daily-notes";

import { connectionAtomRuntime } from "../connection/runtime";

export const dailyNotes = createDailyNotesAtoms(connectionAtomRuntime);
