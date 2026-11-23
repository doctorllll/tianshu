import { createThreadPlanAtoms } from "@t3tools/client-runtime/state/thread-plans";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadPlans = createThreadPlanAtoms(connectionAtomRuntime);
