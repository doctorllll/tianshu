import { createSubSessionProposalAtoms } from "@t3tools/client-runtime/state/sub-session-proposals";

import { connectionAtomRuntime } from "../connection/runtime";

export const subSessionProposals = createSubSessionProposalAtoms(connectionAtomRuntime);
