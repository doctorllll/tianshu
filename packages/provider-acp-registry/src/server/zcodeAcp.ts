import type { ProviderOptionDescriptor, ServerProviderModel } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as EffectAcpSchema from "effect-acp/compat";

const ZCODE_ACP_EXECUTABLE = /^zcode-acp(?:-server)?(?:\.exe|\.cmd)?$/i;

/**
 * The ZCode ACP bridge (`zcode-acp-server`), launched directly or through a wrapper such as
 * `env ZCODE_BIN=<app engine> zcode-acp-server`.
 */
export function isZcodeAcpCommand(
  commandPath: string,
  commandArgs: ReadonlyArray<string>,
): boolean {
  return [commandPath, ...commandArgs].some((part) =>
    ZCODE_ACP_EXECUTABLE.test(part.split(/[\\/]/).pop() ?? ""),
  );
}

/** The bridge executable: the command itself, or the argument naming it after `env`. */
export function zcodeBridgePath(
  commandPath: string,
  commandArgs: ReadonlyArray<string>,
): string | undefined {
  return [commandPath, ...commandArgs].find((part) =>
    ZCODE_ACP_EXECUTABLE.test(part.split(/[\\/]/).pop() ?? ""),
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pairs = (value: unknown): Array<{ name: string; value: string }> =>
  isRecord(value)
    ? Object.entries(value).flatMap(([name, entry]) =>
        typeof entry === "string" ? [{ name, value: entry }] : [],
      )
    : [];

/** `mcp.servers` of ZCode's CLI config in ACP's shape. T3's own server name is never shadowed. */
export function parseZcodeMcpServers(text: string): ReadonlyArray<EffectAcpSchema.McpServer> {
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return [];
  }
  const servers = isRecord(config) && isRecord(config.mcp) ? config.mcp.servers : undefined;
  if (!isRecord(servers)) return [];
  return Object.entries(servers).flatMap(([name, server]): Array<EffectAcpSchema.McpServer> => {
    if (name === "t3-code" || !isRecord(server)) return [];
    if (server.enabled === false || server.disabled === true) return [];
    if ((server.type === "http" || server.type === "sse") && typeof server.url === "string") {
      return [{ type: server.type, name, url: server.url, headers: pairs(server.headers) }];
    }
    if (typeof server.command === "string") {
      const args = Array.isArray(server.args)
        ? server.args.filter((arg): arg is string => typeof arg === "string")
        : [];
      return [{ name, command: server.command, args, env: pairs(server.env) }];
    }
    return [];
  });
}

/**
 * ZCode uses `<ZCODE_HOME or ~/.zcode>/cli/config.json` `mcp.servers` only when session/new carries
 * no servers; T3's own server would otherwise replace them (zcode.cjs session create). Read per
 * session so edits made in ZCode or magpie apply.
 */
export const makeZcodeConfiguredMcpServers = Effect.fn("ZcodeAcp.configuredMcpServers")(function* (
  configuredHome: string | undefined,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath = path.join(
    configuredHome?.trim() || path.join(yield* HostProcess.HomeDirectory, ".zcode"),
    "cli",
    "config.json",
  );
  return fileSystem.readFileString(configPath).pipe(
    Effect.map(parseZcodeMcpServers),
    Effect.orElseSucceed((): ReadonlyArray<EffectAcpSchema.McpServer> => []),
  );
});

const ACCOUNT_PLAN = /^account:([a-z0-9]+)-(start-plan|(?:individual-|team-)?coding-plan)$/;
const CODING_PLAN = /^builtin:[a-z0-9]+-coding-plan$/;
const START_PLAN = /^builtin:[a-z0-9]+-start-plan$/;
/** The levels the bridge verified for Coding Plan models (zcode-acp-server utils). */
const CODING_PLAN_LEVELS = ["low", "high", "max"];

/** The bridge names an account plan by its legacy config id (`account-provider.ts`). */
export function zcodeConfigProviderId(providerId: string): string {
  const match = ACCOUNT_PLAN.exec(providerId);
  if (!match) return providerId;
  return `builtin:${match[1]}-${match[2] === "start-plan" ? "start-plan" : "coding-plan"}`;
}

export interface ZcodeModelPreferences {
  /** ZCode's own default, as the bridge's `provider\model` slug. */
  readonly defaultSlug: string | undefined;
  readonly defaultLevel: string | undefined;
  readonly levels: ReadonlyMap<string, ReadonlyArray<string>>;
}

/** The default model and per-model reasoning levels from ZCode's `v2/provider_config.json`. */
export function parseZcodeModelPreferences(text: string): ZcodeModelPreferences {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { defaultSlug: undefined, defaultLevel: undefined, levels: new Map() };
  }
  const config = isRecord(parsed) && isRecord(parsed.config) ? parsed.config : {};
  const selection = isRecord(config.defaultModelSelection) ? config.defaultModelSelection : {};
  const providerId = typeof selection.providerId === "string" ? selection.providerId : undefined;
  const modelId = typeof selection.modelId === "string" ? selection.modelId : undefined;
  const options = isRecord(selection.options) ? selection.options : {};
  const rules = isRecord(config.modelConfigRules) ? config.modelConfigRules : {};
  const levels = new Map<string, ReadonlyArray<string>>();
  for (const rule of [
    ...(Array.isArray(rules.providerModelRules) ? rules.providerModelRules : []),
    ...(Array.isArray(rules.manualProviderModelRules) ? rules.manualProviderModelRules : []),
  ]) {
    if (!isRecord(rule) || typeof rule.providerId !== "string" || typeof rule.modelId !== "string")
      continue;
    const specs =
      isRecord(rule.config) && isRecord(rule.config.optionSpecs) ? rule.config.optionSpecs : {};
    const reasoning = isRecord(specs.reasoningLevel) ? specs.reasoningLevel : {};
    const values = Array.isArray(reasoning.values)
      ? reasoning.values.filter((value): value is string => typeof value === "string")
      : [];
    if (values.length)
      levels.set(`${zcodeConfigProviderId(rule.providerId)}\\${rule.modelId}`, values);
  }
  return {
    defaultSlug:
      providerId && modelId ? `${zcodeConfigProviderId(providerId)}\\${modelId}` : undefined,
    defaultLevel: typeof options.reasoningLevel === "string" ? options.reasoningLevel : undefined,
    levels,
  };
}

function zcodeSubProvider(providerId: string): string {
  if (CODING_PLAN.test(providerId)) return "Coding Plan";
  if (START_PLAN.test(providerId)) return "Start Plan";
  if (providerId.startsWith("builtin:")) return "API Key";
  return providerId;
}

type SelectDescriptor = Extract<ProviderOptionDescriptor, { readonly type: "select" }>;
const isSelect = (descriptor: ProviderOptionDescriptor): descriptor is SelectDescriptor =>
  descriptor.type === "select";

/**
 * The bridge's dropdown as ZCode's own picker shows it: grouped by plan without the provider
 * prefix, ZCode's default first choice, and reasoning levels before a session reports them.
 * Slugs stay the bridge's, so what is sent to ZCode does not change.
 */
export function presentZcodeModels(
  bridgeModels: ReadonlyArray<ServerProviderModel>,
  preferences: ZcodeModelPreferences,
  planModels: ReadonlyMap<string, ReadonlyArray<string>> = new Map(),
): ReadonlyArray<ServerProviderModel> {
  const models = withPlanModels(bridgeModels, planModels);
  const template = models
    .flatMap((model) => model.capabilities?.optionDescriptors ?? [])
    .filter(isSelect)
    .find((descriptor) => descriptor.id === "thought");
  const ownDefault =
    preferences.defaultSlug !== undefined &&
    models.some((model) => model.slug === preferences.defaultSlug);
  return models.map((model) => {
    const split = model.slug.indexOf("\\");
    if (split < 0) return model;
    const providerId = model.slug.slice(0, split);
    const descriptors = model.capabilities?.optionDescriptors ?? [];
    let capabilities = model.capabilities;
    if (template && !descriptors.some((descriptor) => descriptor.id === "thought")) {
      const levels =
        preferences.levels.get(model.slug) ??
        (CODING_PLAN.test(providerId) ? CODING_PLAN_LEVELS : undefined);
      if (levels?.length) {
        const current =
          model.slug === preferences.defaultSlug &&
          preferences.defaultLevel &&
          levels.includes(preferences.defaultLevel)
            ? preferences.defaultLevel
            : levels.includes("max")
              ? "max"
              : levels.at(-1);
        capabilities = createModelCapabilities({
          optionDescriptors: [
            ...descriptors,
            {
              ...template,
              options: levels.map((id) => ({ id, label: id })),
              ...(current ? { currentValue: current } : {}),
            },
          ],
        });
      }
    }
    const { isDefault: _previousDefault, ...rest } = model;
    const isDefault = ownDefault
      ? model.slug === preferences.defaultSlug
      : model.isDefault === true;
    return {
      ...rest,
      name: model.slug.slice(split + 1),
      subProvider: zcodeSubProvider(providerId),
      ...(isDefault ? { isDefault: true } : {}),
      ...(capabilities ? { capabilities } : {}),
    };
  });
}

/**
 * Each plan the bridge offers, in the official table's order with the table's models it is missing
 * (the bridge lists plans from ZCode's legacy config.json, which no longer gains new models). A
 * plan the bridge does not offer is not entitled, so nothing is added for it.
 */
export function withPlanModels(
  models: ReadonlyArray<ServerProviderModel>,
  planModels: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<ServerProviderModel> {
  let out = models;
  for (const [providerId, ids] of planModels) {
    const prefix = `${providerId}\\`;
    const own = out.filter((model) => model.slug.startsWith(prefix));
    const template = own[0];
    if (template === undefined || ids.length === 0) continue;
    const { isDefault: _isDefault, ...base } = template;
    const listed = ids.map(
      (id): ServerProviderModel =>
        own.find((model) => model.slug === prefix + id) ?? { ...base, slug: prefix + id, name: id },
    );
    const block = [...listed, ...own.filter((model) => !listed.includes(model))];
    const first = out.indexOf(template);
    const rest = out.filter((model) => !own.includes(model));
    const at = out.slice(0, first).filter((model) => !own.includes(model)).length;
    out = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  }
  return out;
}

/** Re-reads `<ZCODE_HOME or ~/.zcode>/v2/provider_config.json` so ZCode's own changes apply. */
export const readZcodeModelPreferences = Effect.fn("ZcodeAcp.modelPreferences")(function* (
  configuredHome: string | undefined,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = configuredHome?.trim() || path.join(yield* HostProcess.HomeDirectory, ".zcode");
  return yield* fileSystem.readFileString(path.join(home, "v2", "provider_config.json")).pipe(
    Effect.map(parseZcodeModelPreferences),
    Effect.orElseSucceed((): ZcodeModelPreferences => ({
      defaultSlug: undefined,
      defaultLevel: undefined,
      levels: new Map(),
    })),
  );
});
