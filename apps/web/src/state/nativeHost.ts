import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const nativeHostStatus = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:native-host:status",
  tag: WS_METHODS.providerNativeHostStatus,
});

export const nativeHostStart = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:native-host:start",
  tag: WS_METHODS.providerNativeHostStart,
});
