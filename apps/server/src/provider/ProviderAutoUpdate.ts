/**
 * With `autoUpdateProviders` on, installs the updates the version checks find, through the same
 * runner as the Update button: only agents with a one-click update, and only while no run of that
 * agent is in progress.
 */
import type { ServerProvider } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import { forkParked } from "../serverActivation.ts";
import * as Settings from "../serverSettings.ts";
import * as ProviderMaintenanceRunner from "./providerMaintenanceRunner.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const FIRST_PASS_DELAY = Duration.minutes(3);
const PASS_INTERVAL = Duration.minutes(30);

/** Behind the latest release, with an update Tianshu can run, and not already updating. */
export function isAutoUpdateCandidate(provider: ServerProvider): boolean {
  const advisory = provider.versionAdvisory;
  const updating =
    provider.updateState?.status === "queued" || provider.updateState?.status === "running";
  return (
    provider.enabled &&
    provider.installed &&
    !updating &&
    advisory?.status === "behind_latest" &&
    advisory.canUpdate &&
    advisory.updateCommand !== null
  );
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const registry = yield* ProviderRegistry.ProviderRegistry;
    const runner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
    const sql = yield* SqlClient.SqlClient;

    const isBusy = (instanceId: string) =>
      sql<{ readonly active: number }>`
        SELECT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runs
          WHERE status IN ('preparing', 'starting', 'running')
            AND provider_instance_id = ${instanceId}
        ) AS active
      `.pipe(
        Effect.map((rows) => rows[0]?.active === 1),
        // An unreadable run table counts as busy: never update under a running agent.
        Effect.orElseSucceed(() => true),
      );

    const pass = Effect.fn("ProviderAutoUpdate.pass")(function* () {
      const current = yield* settings.getSettings;
      if (!current.autoUpdateProviders || !current.enableProviderUpdateChecks) return;
      const providers = yield* registry.getProviders;
      for (const provider of providers.filter(isAutoUpdateCandidate)) {
        if (yield* isBusy(provider.instanceId)) continue;
        yield* Effect.logInfo("Updating an agent automatically", {
          instanceId: provider.instanceId,
          from: provider.versionAdvisory?.currentVersion,
          to: provider.versionAdvisory?.latestVersion,
        });
        yield* runner
          .updateProvider({ provider: provider.driver, instanceId: provider.instanceId })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Automatic agent update failed", {
                instanceId: provider.instanceId,
                cause,
              }),
            ),
          );
      }
    });

    yield* forkParked(
      Effect.sleep(FIRST_PASS_DELAY).pipe(
        Effect.andThen(
          pass().pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Agent auto-update pass failed", { cause }),
            ),
            Effect.repeat(Schedule.spaced(PASS_INTERVAL)),
          ),
        ),
      ),
    );
  }),
).pipe(Layer.provide(ProviderMaintenanceRunner.layer));
