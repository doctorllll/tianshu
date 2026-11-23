import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { parseBundleVersion } from "./zcodeBuiltin.ts";

/**
 * An agent shipped inside a macOS app that updates itself (an Electron `app-update.yml` feed).
 * Its version is the app's, and new releases are announced only: the app, or whoever keeps
 * changes on top of it, does the update.
 */
export interface AppUpdateInstall {
  readonly app: string;
  readonly version: string;
  readonly feedUrl: string;
}

const BIN_ASSIGNMENT = /^[A-Z][A-Z0-9_]*_BIN=(\/.+)$/;

/** The app binary a local command names: a `*_BIN=/path` argument, else the command itself. */
export function appBinaryFromCommand(
  commandPath: string,
  commandArgs: ReadonlyArray<string>,
): string | undefined {
  for (const arg of commandArgs) {
    const match = BIN_ASSIGNMENT.exec(arg);
    if (match?.[1]) return match[1];
  }
  return commandPath.startsWith("/") ? commandPath : undefined;
}

/** The `.app` bundle holding `path`. */
export function appBundleOf(path: string): string | undefined {
  const index = path.indexOf(".app/");
  return index < 0 ? undefined : path.slice(0, index + ".app".length);
}

const yamlField = (yml: string, name: string) =>
  new RegExp(`^${name}:\\s*['"]?([^'"\\s]+)['"]?\\s*$`, "m").exec(yml)?.[1];

/** The macOS feed of a generic-provider `app-update.yml`. */
export function appUpdateFeedUrl(yml: string): string | undefined {
  if (yamlField(yml, "provider") !== "generic") return undefined;
  const url = yamlField(yml, "url");
  if (!url || !/^https:\/\//.test(url)) return undefined;
  const channel = yamlField(yml, "channel") ?? "latest";
  if (!/^[\w.-]+$/.test(channel)) return undefined;
  return `${url.replace(/\/+$/, "")}/${channel}-mac.yml`;
}

/** The release a feed announces. */
export function parseFeedVersion(yml: string): string | undefined {
  const version = yamlField(yml, "version");
  return version && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) ? version : undefined;
}

export const inspectAppUpdate = Effect.fn("inspectAppUpdate")(function* (binary: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const real = yield* fs.realPath(binary).pipe(Effect.orElseSucceed(() => binary));
  const app = appBundleOf(real);
  if (app === undefined) return undefined;
  const read = (file: string) =>
    fs.readFileString(path.join(app, "Contents", file)).pipe(Effect.orElseSucceed(() => ""));
  const version = parseBundleVersion(yield* read("Info.plist"));
  const feedUrl = appUpdateFeedUrl(yield* read(path.join("Resources", "app-update.yml")));
  if (!version || !feedUrl) return undefined;
  return { app, version, feedUrl } satisfies AppUpdateInstall;
});

export function appUpdateMaintenance(
  provider: ProviderDriverKind,
  install: AppUpdateInstall,
  client: Option.Option<HttpClient.HttpClient>,
): ProviderMaintenanceCapabilities {
  return {
    ...makeManualOnlyProviderMaintenanceCapabilities({
      provider,
      packageName: null,
      installPath: install.app,
      ...(Option.isSome(client)
        ? {
            lookupLatestVersion: client.value.get(install.feedUrl).pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.flatMap((response) => response.text),
              Effect.map((text) => parseFeedVersion(text) ?? null),
              Effect.timeoutOption("6 seconds"),
              Effect.map(Option.getOrNull),
              Effect.orElseSucceed(() => null),
            ),
          }
        : {}),
    }),
    latestVersionCacheKey: install.feedUrl,
  };
}
