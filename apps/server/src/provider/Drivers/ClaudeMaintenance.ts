import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  makeProviderMaintenanceCapabilities,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
  type ProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilitiesResolver,
  type ProviderMaintenanceResolutionContext,
  type ProviderMaintenanceResolverServices,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { resolveClaudeHomePath } from "./ClaudeHome.ts";

const NATIVE_RELEASES = "https://downloads.claude.ai/claude-code-releases";
const UpdateChannelSettings = fromLenientJson(
  Schema.Struct({ autoUpdatesChannel: Schema.optional(Schema.Literals(["latest", "stable"])) }),
);
const NativeVersion = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/));

const PROVIDER = ProviderDriverKind.make("claudeAgent");
const NPM_PACKAGE = "@anthropic-ai/claude-code";

const packageManaged = makePackageManagedProviderMaintenanceResolver({
  provider: PROVIDER,
  npmPackageName: NPM_PACKAGE,
  mise: { tool: "claude" },
  nativeUpdate: {
    args: ["update"],
    // On Unix the native launcher links into ${XDG_DATA_HOME:-~/.local/share}/claude/versions; a
    // plain file at ~/.local/bin/claude is a wrapper whose owner `claude update` cannot see.
    isCommandPath: (commandPath) => {
      const normalized = normalizeCommandPath(commandPath);
      return (
        normalized.endsWith("/.local/bin/claude.exe") ||
        normalized.includes("/.local/share/claude/") ||
        normalized.includes("/claude/versions/")
      );
    },
    requiresCommandPath: true,
  },
});

const readUpdateChannel = Effect.fn("ClaudeMaintenance.readUpdateChannel")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const managedDirectory =
    platform === "darwin"
      ? "/Library/Application Support/ClaudeCode"
      : platform === "win32"
        ? path.join(environment.PROGRAMFILES || "C:\\Program Files", "ClaudeCode")
        : "/etc/claude-code";
  const dropInDirectory = path.join(managedDirectory, "managed-settings.d");
  const dropIns = yield* fs.readDirectory(dropInDirectory).pipe(Effect.orElseSucceed(() => []));
  // The updater inherits the server's config directory, not the instance's homePath.
  const configDirectory = yield* resolveClaudeHomePath({ homePath: "" }, environment);
  const settingsPaths = [
    path.join(configDirectory, "settings.json"),
    path.join(managedDirectory, "managed-settings.json"),
    ...dropIns
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .toSorted()
      .map((name) => path.join(dropInDirectory, name)),
  ];
  const channels = yield* Effect.forEach(settingsPaths, (settingsPath) =>
    fs.readFileString(settingsPath).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(UpdateChannelSettings)),
      Effect.map((settings) => settings.autoUpdatesChannel),
      Effect.orElseSucceed(() => undefined),
    ),
  );
  return channels.findLast((channel) => channel !== undefined) ?? "latest";
});

const LAUNCHER_MAX_BYTES = 4096;

/** A small shell launcher that runs a build from the native versions directory itself. */
function isVersionsDirectoryLauncher(source: string): boolean {
  return (
    source.length <= LAUNCHER_MAX_BYTES &&
    /^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba)?sh\b/.test(source) &&
    source.includes("share/claude/versions")
  );
}

/**
 * Installs the channel's release into the versions directory: download, check the manifest
 * checksum, run `--version`, then rename into place. Launchers and config stay untouched, so
 * every launcher that picks the newest build there moves to it together.
 * Arguments: versions directory, channel, and optionally the releases base URL.
 */
export const NATIVE_VERSIONS_INSTALL_SCRIPT = String.raw`set -eu
dir=$1
channel=$2
base=${NATIVE_RELEASES}
if [ $# -ge 3 ]; then base=$3; fi
case $(uname -s) in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "Unsupported OS" >&2; exit 1 ;; esac
case $(uname -m) in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo "Unsupported CPU" >&2; exit 1 ;; esac
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then arch=arm64; fi
platform=$os-$arch
if [ "$os" = linux ] && ls /lib/libc.musl-*.so.1 >/dev/null 2>&1; then platform=$platform-musl; fi
version=$(curl -fsSL --max-time 30 "$base/$channel")
case $version in ""|*[!0-9.]*) echo "Unexpected version: $version" >&2; exit 1 ;; esac
if [ -s "$dir/$version" ] && [ -x "$dir/$version" ]; then echo "Claude Code $version is already installed"; exit 0; fi
checksum=$(curl -fsSL --max-time 60 "$base/$version/manifest.json" | tr -d " \t\r\n" | sed -n "s/.*\"$platform\":{[^}]*\"checksum\":\"\([0-9a-f]\{64\}\)\".*/\1/p")
[ -n "$checksum" ] || { echo "No $platform build in the $version manifest" >&2; exit 1; }
mkdir -p "$dir"
tmp=$(mktemp "$dir/.claude-$version.XXXXXX")
trap "rm -f \"$tmp\"" EXIT
curl -fsSL --max-time 1500 -o "$tmp" "$base/$version/$platform/claude"
actual=$({ shasum -a 256 "$tmp" 2>/dev/null || sha256sum "$tmp"; } | cut -d " " -f 1)
[ "$actual" = "$checksum" ] || { echo "Checksum mismatch for Claude Code $version" >&2; exit 1; }
chmod 755 "$tmp"
"$tmp" --version
mv -f "$tmp" "$dir/$version"
trap - EXIT
echo "Installed Claude Code $version into $dir"`;

const versionsDirectoryUpdate = Effect.fn("ClaudeMaintenance.versionsDirectoryUpdate")(function* (
  context: ProviderMaintenanceResolutionContext | null,
) {
  if (context === null || (context.platform !== "darwin" && context.platform !== "linux")) {
    return null;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const size = yield* fs.stat(context.realCommandPath).pipe(
    Effect.map((info) => Number(info.size)),
    Effect.orElseSucceed(() => Number.POSITIVE_INFINITY),
  );
  if (size > LAUNCHER_MAX_BYTES) return null;
  const source = yield* fs
    .readFileString(context.realCommandPath)
    .pipe(Effect.orElseSucceed(() => ""));
  if (!isVersionsDirectoryLauncher(source)) return null;
  const environment = yield* HostProcess.Environment;
  const dataHome =
    environment.XDG_DATA_HOME ||
    (environment.HOME ? path.join(environment.HOME, ".local", "share") : null);
  if (!dataHome) return null;
  const versionsDirectory = path.join(dataHome, "claude", "versions");
  const exists = yield* fs.exists(versionsDirectory).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return null;
  const channel = yield* readUpdateChannel();
  return makeProviderMaintenanceCapabilities({
    provider: PROVIDER,
    packageName: NPM_PACKAGE,
    updateExecutable: "/bin/sh",
    updateArgs: [
      "-c",
      NATIVE_VERSIONS_INSTALL_SCRIPT,
      "claude-install",
      versionsDirectory,
      channel,
    ],
    updateLockKey: "claudeAgent-native",
    platform: context.platform,
  });
});

const update: ProviderMaintenanceCapabilitiesResolver = {
  resolve: (context) =>
    versionsDirectoryUpdate(context).pipe(
      Effect.filterOrElse(
        (capabilities): capabilities is ProviderMaintenanceCapabilities => capabilities !== null,
        () => packageManaged.resolve(context),
      ),
    ),
};

const resolveClaudeMaintenance = Effect.fn("ClaudeMaintenance.resolve")(function* (
  capabilities: ProviderMaintenanceCapabilities,
) {
  if (capabilities.update?.lockKey !== "claudeAgent-native") return capabilities;
  const channel = yield* readUpdateChannel();
  const client = yield* HttpClient.HttpClient;
  const url = `${NATIVE_RELEASES}/${channel}`;
  return {
    ...capabilities,
    latestVersion: null,
    latestVersionCacheKey: url,
    lookupLatestVersion: client.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.map((text) => text.trim()),
      Effect.flatMap(Schema.decodeUnknownEffect(NativeVersion)),
      Effect.timeoutOption("4 seconds"),
      Effect.map(Option.getOrNull),
      Effect.orElseSucceed(() => null),
    ),
  };
});

export const makeClaudeMaintenanceResolution = Effect.fn("ClaudeMaintenance.make")(function* (
  options: Parameters<typeof resolveProviderMaintenanceCapabilitiesEffect>[1],
) {
  const services = yield* Effect.context<
    ProviderMaintenanceResolverServices | HttpClient.HttpClient
  >();
  const resolveInstallation = yield* makeCachedProviderMaintenanceResolution(
    resolveProviderMaintenanceCapabilitiesEffect(update, options).pipe(
      Effect.provideContext(services),
    ),
  );
  const resolve: typeof resolveInstallation = (refreshOptions) =>
    resolveInstallation(refreshOptions).pipe(
      Effect.flatMap(resolveClaudeMaintenance),
      Effect.provideContext(services),
    );
  return resolve;
});
