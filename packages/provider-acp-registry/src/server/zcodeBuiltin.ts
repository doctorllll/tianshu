/**
 * ZCode's official model table (`zcode-builtin.json`). zcode-acp-server reads only the bundled copy,
 * so the bridge runs Tianshu's engine directory: the newest table, and the app's engine behind
 * zcodeEngineShim.ts. Model API requests are unchanged.
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";

import { ZCODE_ENGINE_SHIM_NAME, ZCODE_ENGINE_SHIM_SOURCE } from "./zcodeEngineShim.ts";

const CLIENT_CONFIG_URL = "https://zcode.z.ai/api/v1/client/configs";
const TABLE_URL = /^https:\/\/[a-z0-9.-]+\.z\.ai\//i;
const MAX_TABLE_BYTES = 10_000_000;
const REQUEST_TIMEOUT = Duration.seconds(20);
/** ZCode asks for 120 s; Tianshu runs all day, so it checks less often. */
const MIN_REFRESH_MS = 10 * 60 * 1_000;
const ENGINE_ARG = /^ZCODE_BIN=(.+)$/;
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface ZcodeBuiltinTable {
  readonly path: string;
  readonly revision: number;
  /** `builtinModelIds` of each `account:*` plan, in ZCode's order. */
  readonly accountModels: ReadonlyMap<string, ReadonlyArray<string>>;
}

export function parseZcodeBuiltinTable(text: string): Omit<ZcodeBuiltinTable, "path"> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.revision !== "number" || !isRecord(parsed.config)) {
    return undefined;
  }
  const providerRules = isRecord(parsed.config.providerConfigRules)
    ? parsed.config.providerConfigRules.providerRules
    : undefined;
  if (!Array.isArray(providerRules)) return undefined;
  const accountModels = new Map<string, ReadonlyArray<string>>();
  for (const rule of providerRules) {
    if (!isRecord(rule) || typeof rule.providerId !== "string") continue;
    if (!rule.providerId.startsWith("account:") || !isRecord(rule.config)) continue;
    const ids = rule.config.builtinModelIds;
    if (!Array.isArray(ids)) continue;
    accountModels.set(
      rule.providerId,
      ids.filter((id): id is string => typeof id === "string" && id.length > 0),
    );
  }
  return { revision: parsed.revision, accountModels };
}

/** The engine a local ZCode agent runs: `env ZCODE_BIN=<engine> zcode-acp-server`, or the env's. */
export function zcodeEnginePath(
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  for (const arg of args) {
    const match = ENGINE_ARG.exec(arg);
    if (match?.[1]) return match[1];
  }
  return environment.ZCODE_BIN?.trim() || undefined;
}

export function replaceZcodeEngine(
  args: ReadonlyArray<string>,
  engine: string,
  replacement: string,
): ReadonlyArray<string> {
  return args.map((arg) => (arg === `ZCODE_BIN=${engine}` ? `ZCODE_BIN=${replacement}` : arg));
}

export function parseBundleVersion(plist: string): string | undefined {
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/
    .exec(plist)?.[1]
    ?.trim();
}

/** ZCode's platform key: `darwin-aarch64`, `darwin-x86_64`, … */
export function zcodePlatformKey(platform: string, arch: string): string {
  return `${platform}-${arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch}`;
}

/** Account plans as the bridge names them (`builtin:<family>-coding-plan` / `-start-plan`). */
const ACCOUNT_PLAN = /^account:([a-z0-9]+)-(start-plan|(?:individual-|team-)?coding-plan)$/;

/** Models per bridge provider id, individual plans before team plans. */
export function zcodePlanModels(
  table: Pick<ZcodeBuiltinTable, "accountModels">,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const entries = [...table.accountModels].toSorted(
    ([a], [b]) => Number(a.includes("-team-")) - Number(b.includes("-team-")),
  );
  const out = new Map<string, Array<string>>();
  for (const [accountId, models] of entries) {
    const match = ACCOUNT_PLAN.exec(accountId);
    if (!match) continue;
    const bridgeId = `builtin:${match[1]}-${match[2] === "start-plan" ? "start-plan" : "coding-plan"}`;
    const list = out.get(bridgeId) ?? [];
    for (const model of models) if (!list.includes(model)) list.push(model);
    out.set(bridgeId, list);
  }
  return out;
}

export interface ZcodeEngineInstall {
  /** `<App>.app/Contents/Resources` */
  readonly resources: string;
  readonly version: string;
  readonly bundled: ZcodeBuiltinTable | undefined;
  readonly newest: ZcodeBuiltinTable | undefined;
}

/** Where Tianshu keeps fetched tables and engine directories, under the server's state dir. */
export const zcodeStateDirectory = (path: Path.Path, stateDir: string) =>
  path.join(stateDir, "zcode");

export const zcodeTablesDirectory = (path: Path.Path, directory: string) =>
  path.join(directory, "tables");

const readTable = (fileSystem: FileSystem.FileSystem, file: string) =>
  fileSystem.readFileString(file).pipe(
    Effect.map((text): ZcodeBuiltinTable | undefined => {
      const parsed = parseZcodeBuiltinTable(text);
      return parsed ? { path: file, ...parsed } : undefined;
    }),
    Effect.orElseSucceed((): ZcodeBuiltinTable | undefined => undefined),
  );

const listDirectory = (fileSystem: FileSystem.FileSystem, directory: string) =>
  fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

/**
 * The app's bundled table and the newest one known: bundled, Tianshu's download, or a copy ZCode
 * synced for this app version. Reads only; a tie keeps the bundled copy.
 */
export const inspectZcodeEngine = Effect.fn("ZcodeBuiltin.inspect")(function* (input: {
  readonly engine: string;
  readonly zcodeHome: string;
  readonly directory: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (path.basename(input.engine) !== "zcode.cjs") return undefined;
  const glm = path.dirname(input.engine);
  if (path.basename(glm) !== "glm") return undefined;
  const resources = path.dirname(glm);
  const version = yield* fileSystem.readFileString(path.join(resources, "..", "Info.plist")).pipe(
    Effect.map(parseBundleVersion),
    Effect.orElseSucceed(() => undefined),
  );
  if (version === undefined) return undefined;
  const bundled = yield* readTable(
    fileSystem,
    path.join(resources, "config", "provider", "zcode-builtin.json"),
  );
  const candidates: Array<ZcodeBuiltinTable | undefined> = [
    bundled,
    yield* readTable(
      fileSystem,
      path.join(zcodeTablesDirectory(path, input.directory), `${version}.json`),
    ),
  ];
  const runtime = path.join(input.zcodeHome, "v2", "runtime", "provider");
  for (const platform of yield* listDirectory(fileSystem, runtime)) {
    const versionDir = path.join(runtime, platform, version);
    for (const endpoint of yield* listDirectory(fileSystem, versionDir)) {
      if (!endpoint.startsWith("endpoint-")) continue;
      candidates.push(
        yield* readTable(fileSystem, path.join(versionDir, endpoint, "zcode-builtin.json")),
      );
    }
  }
  let newest: ZcodeBuiltinTable | undefined;
  for (const table of candidates) {
    if (table && (newest === undefined || table.revision > newest.revision)) newest = table;
  }
  return { resources, version, bundled, newest } satisfies ZcodeEngineInstall;
});

export interface ZcodeEngineChoice {
  /** Tianshu's engine directory with the newest table, or the app's own engine if none can be made. */
  readonly engine: string;
  /** `provider\model` slugs of the plan models that engine's table offers. */
  readonly planModels: ReadonlyArray<string>;
}

export interface ZcodeBuiltinTables {
  readonly engineFor: (input: {
    readonly engine: string;
    readonly zcodeHome: string;
  }) => Effect.Effect<ZcodeEngineChoice>;
}

const zcodePlanModelSlugs = (table: Pick<ZcodeBuiltinTable, "accountModels">) =>
  [...zcodePlanModels(table)].flatMap(([providerId, models]) =>
    models.map((model) => `${providerId}\\${model}`),
  );

export const makeZcodeBuiltinTables = Effect.fn("ZcodeBuiltin.make")(function* (input: {
  readonly directory: string;
  readonly platformKey: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const tablesDir = zcodeTablesDirectory(path, input.directory);
  const enginesDir = path.join(input.directory, "engines");
  const nextCheck = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

  const getJson = (url: string) =>
    httpClient.execute(HttpClientRequest.get(url)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) =>
        collectUint8StreamText({ stream: response.stream, maxBytes: MAX_TABLE_BYTES }),
      ),
      Effect.timeout(REQUEST_TIMEOUT),
    );

  /** The engine's own client-config call (no credentials needed), then the table it names. */
  const refresh = Effect.fn("ZcodeBuiltin.refresh")(function* (version: string) {
    const now = yield* Clock.currentTimeMillis;
    const due = (yield* Ref.get(nextCheck)).get(version) ?? 0;
    if (now < due) return;
    yield* Ref.update(nextCheck, (map) => new Map(map).set(version, now + MIN_REFRESH_MS));
    const configUrl = new URL(CLIENT_CONFIG_URL);
    configUrl.searchParams.set("app_version", version);
    configUrl.searchParams.set("platform", input.platformKey);
    const config = Option.getOrUndefined(decodeJson((yield* getJson(configUrl.toString())).text));
    const configs = isRecord(config) && isRecord(config.data) ? config.data.configs : undefined;
    const tableUrl = isRecord(configs) ? configs.builtin_provider_config_json : undefined;
    if (typeof tableUrl !== "string" || !TABLE_URL.test(tableUrl)) return;
    const metaPath = path.join(tablesDir, `${version}.url`);
    const known = yield* fileSystem.readFileString(metaPath).pipe(Effect.orElseSucceed(() => ""));
    const target = path.join(tablesDir, `${version}.json`);
    if (known.trim() === tableUrl && (yield* fileSystem.exists(target))) return;
    const text = (yield* getJson(tableUrl)).text;
    if (parseZcodeBuiltinTable(text) === undefined) return;
    yield* fileSystem.makeDirectory(tablesDir, { recursive: true });
    const temp = `${target}.tmp-${now}`;
    yield* fileSystem.writeFileString(temp, text);
    yield* fileSystem.rename(temp, target);
    yield* fileSystem.writeFileString(metaPath, tableUrl);
  });

  /** Writes the shim unless the same script is already there; a running copy keeps its file. */
  const placeShim = Effect.fn("ZcodeBuiltin.placeShim")(function* (shim: string) {
    const current = yield* fileSystem.readFileString(shim).pipe(Effect.orElseSucceed(() => ""));
    if (current === ZCODE_ENGINE_SHIM_SOURCE) return;
    const temp = `${shim}.tmp-${yield* Clock.currentTimeMillis}`;
    yield* fileSystem.writeFileString(temp, ZCODE_ENGINE_SHIM_SOURCE);
    yield* fileSystem.rename(temp, shim);
  });

  /**
   * `<engines>/<version>-r<revision>-3/Resources`: the app's Resources linked, a real
   * `glm/provider`, and the shim the bridge launches.
   */
  const mirror = Effect.fn("ZcodeBuiltin.mirror")(function* (
    install: ZcodeEngineInstall,
    table: ZcodeBuiltinTable,
  ) {
    // `-2` added the app's Info.plist, where bridges from 0.91 read its version; `-3` the shim.
    const root = path.join(enginesDir, `${install.version}-r${table.revision}-3`);
    const shim = path.join(root, "Resources", "glm", ZCODE_ENGINE_SHIM_NAME);
    if (
      yield* fileSystem.exists(
        path.join(root, "Resources", "glm", "provider", "zcode-builtin.json"),
      )
    ) {
      yield* placeShim(shim);
      return shim;
    }
    const now = yield* Clock.currentTimeMillis;
    const staging = path.join(enginesDir, `.staging-${now}`);
    const resources = path.join(staging, "Resources");
    const glm = path.join(resources, "glm");
    yield* fileSystem.makeDirectory(path.join(glm, "provider"), { recursive: true });
    yield* fileSystem.symlink(
      path.join(install.resources, "..", "Info.plist"),
      path.join(staging, "Info.plist"),
    );
    for (const entry of yield* fileSystem.readDirectory(install.resources)) {
      if (entry === "glm") continue;
      yield* fileSystem.symlink(path.join(install.resources, entry), path.join(resources, entry));
    }
    for (const entry of yield* fileSystem.readDirectory(path.join(install.resources, "glm"))) {
      if (entry === "provider") continue;
      yield* fileSystem.symlink(path.join(install.resources, "glm", entry), path.join(glm, entry));
    }
    // A copy, not a link: the bridge re-reads the table before model requests and ZCode rewrites
    // its own copy in place.
    yield* fileSystem.copyFile(table.path, path.join(glm, "provider", "zcode-builtin.json"));
    yield* fileSystem.writeFileString(
      path.join(glm, ZCODE_ENGINE_SHIM_NAME),
      ZCODE_ENGINE_SHIM_SOURCE,
    );
    yield* fileSystem
      .rename(staging, root)
      .pipe(Effect.catch(() => fileSystem.remove(staging, { recursive: true })));
    yield* placeShim(shim);
    return shim;
  });

  const newestEngine = Effect.fn("ZcodeBuiltin.engineFor")(function* (request: {
    readonly engine: string;
    readonly zcodeHome: string;
  }) {
    const unchanged: ZcodeEngineChoice = { engine: request.engine, planModels: [] };
    const first = yield* inspectZcodeEngine({ ...request, directory: input.directory });
    if (first === undefined) return unchanged;
    yield* refresh(first.version).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not refresh ZCode's model table.", cause),
      ),
    );
    const install = yield* inspectZcodeEngine({ ...request, directory: input.directory });
    const newest = install?.newest;
    if (!install || !newest) return unchanged;
    return { engine: yield* mirror(install, newest), planModels: zcodePlanModelSlugs(newest) };
  });

  const engineFor: ZcodeBuiltinTables["engineFor"] = (request) =>
    newestEngine(request).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.catchCause((cause) =>
        Effect.logWarning("Using ZCode's bundled model table.", cause).pipe(
          Effect.as<ZcodeEngineChoice>({ engine: request.engine, planModels: [] }),
        ),
      ),
    );

  return { engineFor } satisfies ZcodeBuiltinTables;
});
