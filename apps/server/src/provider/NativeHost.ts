// @effect-diagnostics nodeBuiltinImport:off - one-shot pgrep and a detached launch need no spawner scope.
import * as NodeChildProcess from "node:child_process";

import type {
  ProviderInstanceId,
  ProviderNativeHostConfig,
  ProviderNativeHostStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { awaitDetachedSpawn } from "../process/windowsVerbatimSpawn.ts";
import * as ServerSettings from "../serverSettings.ts";

const START_WAIT_ATTEMPTS = 40;

const processRunning = (name: string) =>
  Effect.callback<boolean>((resume) => {
    const child = NodeChildProcess.execFile("pgrep", ["-x", name], { timeout: 3000 }, (error) =>
      resume(Effect.succeed(error === null)),
    );
    return Effect.sync(() => child.kill());
  });

const urlAnswers = Effect.fn("NativeHost.urlAnswers")(
  function* (url: string) {
    yield* (yield* HttpClient.HttpClient).execute(HttpClientRequest.get(url));
    return true;
  },
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
  Effect.timeout("1500 millis"),
  Effect.provide(FetchHttpClient.layer),
  Effect.orElseSucceed(() => false),
);

export const probeNativeHost = (host: ProviderNativeHostConfig): Effect.Effect<boolean> =>
  host.probeUrl !== undefined
    ? urlAnswers(host.probeUrl)
    : host.processName !== undefined
      ? processRunning(host.processName)
      : Effect.succeed(true);

const nativeHostConfig = Effect.fn("NativeHost.config")(function* (instanceId: ProviderInstanceId) {
  const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
  return settings.providerInstances[instanceId]?.nativeHost;
});

const statusOf = (host: ProviderNativeHostConfig, running: boolean): ProviderNativeHostStatus => ({
  label: host.label,
  running,
  canStart: (host.start?.length ?? 0) > 0,
});

export const nativeHostStatus = Effect.fn("NativeHost.status")(function* (
  instanceId: ProviderInstanceId,
) {
  const host = yield* nativeHostConfig(instanceId);
  if (host === undefined) return null;
  return statusOf(host, yield* probeNativeHost(host));
});

/** Runs the configured start command detached, then waits up to 20 s for the app to answer. */
export const startNativeHost = Effect.fn("NativeHost.start")(function* (
  instanceId: ProviderInstanceId,
) {
  const host = yield* nativeHostConfig(instanceId);
  if (host === undefined) return null;
  if (yield* probeNativeHost(host)) return statusOf(host, true);
  const [command, ...args] = host.start ?? [];
  if (command === undefined) return statusOf(host, false);
  yield* awaitDetachedSpawn(() =>
    NodeChildProcess.spawn(command, args, { detached: true, stdio: "ignore" }),
  ).pipe(Effect.ignoreCause({ log: true }));
  for (let attempt = 0; attempt < START_WAIT_ATTEMPTS; attempt++) {
    if (yield* probeNativeHost(host)) return statusOf(host, true);
    yield* Effect.sleep("500 millis");
  }
  return statusOf(host, false);
});
