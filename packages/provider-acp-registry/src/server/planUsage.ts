import type {
  ServerProviderUsageLimits,
  ServerProviderUsageSection,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import type { AcpRegistrySettings } from "../settings.ts";
import {
  estimateFastctxLogin,
  FASTCTX_FOOTNOTE,
  fastctxLoginSection,
  fastctxMyAccounts,
  fastctxWindows,
  MY_SHARE_OF_PLATE,
  parseFastctxLogins,
  shownFastctxLogins,
} from "./fastctxUsage.ts";
import { isZcodeAcpCommand } from "./zcodeAcp.ts";

/** A plan reading for the provider snapshot; `planLabel` names the subscription it was read from. */
export interface AcpPlanUsage {
  readonly usageLimits: ServerProviderUsageLimits;
  readonly planLabel?: string;
}

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numberOf = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const stringOf = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function kindFor(mins: number): ServerProviderUsageWindow["kind"] {
  if (mins <= DAY) return "session";
  if (mins <= WEEK) return "weekly";
  return mins <= 31 * DAY ? "monthly" : "other";
}

function durationLabel(mins: number): string {
  if (mins < DAY && mins % HOUR === 0) return `${mins / HOUR} hours`;
  const kind = kindFor(mins);
  return kind === "session" ? "Session" : kind === "weekly" ? "Weekly" : "Monthly";
}

const isoFromMillis = (millis: number | undefined) =>
  millis === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(DateTime.make(millis), DateTime.formatIso));

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

// Units the monitor API reports: 3 = hours, 5 = months, 6 = weeks.
const ZCODE_UNIT_MINS: Readonly<Record<number, number>> = { 3: HOUR, 5: MONTH, 6: WEEK };

function zcodeWindowMins(unit: number | undefined, count: number | undefined) {
  const base = unit === undefined ? undefined : ZCODE_UNIT_MINS[unit];
  if (base !== undefined && count !== undefined && count > 0) return base * count;
  // Older replies carried only the count: 5 is the five-hour window, 7 the week.
  return count === 5 ? 5 * HOUR : count === 7 ? WEEK : undefined;
}

/** `data` of `GET /api/monitor/usage/quota/limit` as quota windows. */
export function zcodeQuotaWindows(data: unknown): ReadonlyArray<ServerProviderUsageWindow> {
  const limits = isRecord(data) && Array.isArray(data.limits) ? data.limits : [];
  return limits.flatMap((limit): Array<ServerProviderUsageWindow> => {
    if (!isRecord(limit)) return [];
    const mins = zcodeWindowMins(numberOf(limit.unit), numberOf(limit.number));
    const total = numberOf(limit.usage);
    const current = numberOf(limit.currentValue);
    const used =
      numberOf(limit.percentage) ??
      (total !== undefined && total > 0 && current !== undefined
        ? (current / total) * 100
        : undefined);
    if (mins === undefined || used === undefined) return [];
    const mcp = limit.type === "TIME_LIMIT" || limit.type === "MCP_LIMIT";
    const resetsAt = isoFromMillis(numberOf(limit.nextResetTime));
    return [
      {
        id: `${mcp ? "mcp" : "tokens"}-${mins}`,
        kind: kindFor(mins),
        label: mcp ? `MCP ${durationLabel(mins)}` : durationLabel(mins),
        usedPercent: clampPercent(used),
        windowDurationMins: mins,
        source: "official",
        ...(resetsAt ? { resetsAt } : {}),
      },
    ];
  });
}

const CODING_PLAN_ID = /^builtin:(zai|bigmodel)-coding-plan$/;

/** The Coding Plan key in ZCode's `v2/config.json`, as the ACP bridge and the app read it. */
export function zcodeCodingPlan(text: string): { apiKey: string; host: string } | undefined {
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return undefined;
  }
  const providers = isRecord(config) && isRecord(config.provider) ? config.provider : {};
  for (const [id, provider] of Object.entries(providers)) {
    const family = CODING_PLAN_ID.exec(id)?.[1];
    if (!family || !isRecord(provider) || provider.enabled !== true) continue;
    const options = isRecord(provider.options) ? provider.options : {};
    const apiKey = stringOf(options.apiKey);
    if (!apiKey) continue;
    const baseUrl = stringOf(options.baseURL) ?? "";
    const zai = family === "zai" || baseUrl.includes("api.z.ai");
    return { apiKey, host: zai ? "https://api.z.ai" : "https://open.bigmodel.cn" };
  }
  return undefined;
}

const readZcodePlanUsage = Effect.fn("AcpPlanUsage.zcode")(function* (
  zcodeHome: string | undefined,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = zcodeHome?.trim() || path.join(yield* HostProcess.HomeDirectory, ".zcode");
  const plan = zcodeCodingPlan(
    yield* fileSystem.readFileString(path.join(home, "v2", "config.json")),
  );
  const checkedAt = yield* nowIso;
  if (!plan) {
    return {
      usageLimits: makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: "ZCode has no Coding Plan signed in.",
      }),
    } satisfies AcpPlanUsage;
  }
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* client.execute(
    HttpClientRequest.get(`${plan.host}/api/monitor/usage/quota/limit`).pipe(
      HttpClientRequest.setHeaders({
        Accept: "application/json",
        Authorization: `Bearer ${plan.apiKey}`,
      }),
    ),
  );
  const body = yield* response.json;
  const data = isRecord(body) ? body.data : undefined;
  const windows = zcodeQuotaWindows(data);
  const level = isRecord(data) ? stringOf(data.level) : undefined;
  return {
    usageLimits: windows.length
      ? makeUsageLimits({ checkedAt, windows })
      : makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "ZCode returned no quota windows.",
        }),
    planLabel: level ? `Coding Plan ${level[0]!.toUpperCase()}${level.slice(1)}` : "Coding Plan",
  } satisfies AcpPlanUsage;
});

const FASTCTX_ACP_EXECUTABLE = /^fastctx-acp(?:\.py)?$/i;

export function isFastctxAcpCommand(
  commandPath: string,
  commandArgs: ReadonlyArray<string>,
): boolean {
  return [commandPath, ...commandArgs].some((part) =>
    FASTCTX_ACP_EXECUTABLE.test(part.split(/[\\/]/).pop() ?? ""),
  );
}

const fastctxCall = Effect.fn("AcpPlanUsage.fastctxCall")(function* (
  connection: { readonly url: string; readonly cookie: string },
  call: Record<string, unknown>,
  timeout: number,
) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  // The request fastctx-web's own page sends (static/app.js `post`).
  const response = yield* client.execute(
    HttpClientRequest.post(`${connection.url}/api/call`).pipe(
      HttpClientRequest.setHeaders({ "X-Fx": "1", Cookie: connection.cookie }),
      HttpClientRequest.bodyJsonUnsafe({ call, timeout }),
    ),
  );
  const body = yield* response.json;
  const reply = isRecord(body) ? body.reply : undefined;
  if (isRecord(reply) && "Err" in reply) {
    return yield* Effect.fail({ _tag: "FastctxCallRefused" as const, call: String(call.call) });
  }
  return isRecord(reply) && "Ok" in reply ? reply.Ok : reply;
});

const readFastctxPlanUsage = Effect.fn("AcpPlanUsage.fastctx")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const url = (environment.FASTCTX_WEB_URL?.trim() || "http://127.0.0.1:8765").replace(/\/+$/, "");
  const conf =
    environment.FASTCTX_WEB_CONF?.trim() ||
    path.join(yield* HostProcess.HomeDirectory, ".fastctx-web");
  const token = (yield* fileSystem.readFileString(path.join(conf, "token"))).trim();
  const port = /:(\d+)$/.exec(url)?.[1] ?? "80";
  const connection = { url, cookie: `fxk_${port}=${token}` };
  const now = yield* Clock.currentTimeMillis;
  const [loginsReply, world] = yield* Effect.all(
    [
      fastctxCall(connection, { call: "agent_logins", machine: null }, 90),
      fastctxCall(connection, { call: "world_now" }, 30).pipe(Effect.orElseSucceed(() => null)),
    ],
    { concurrency: 2 },
  );
  const shown = shownFastctxLogins(parseFastctxLogins(loginsReply, now));
  const mine = fastctxMyAccounts(world);
  const readable = shown.filter((login) => login.five ?? login.week);
  // The ledger behind the estimate, one report per login (fastctx-web loads the same).
  const reports = yield* Effect.forEach(
    readable,
    (login) =>
      fastctxCall(
        connection,
        { call: "agent_usage", machine: login.machine, agent: login.agent, dir: login.dir },
        100,
      ).pipe(
        Effect.map((report) => [login.id, estimateFastctxLogin(login, report, mine)] as const),
        Effect.option,
      ),
    { concurrency: 3 },
  );
  const estimates = new Map(
    reports.flatMap((entry) => (entry._tag === "Some" ? [entry.value] : [])),
  );
  const main = readable.find((login) => login.agent === "claude") ?? readable[0];
  const mainEstimate = main ? estimates.get(main.id) : undefined;
  const myBudget = mainEstimate?.hasUsd ? mainEstimate.basePlate * MY_SHARE_OF_PLATE : undefined;
  const mineWeek = myBudget
    ? [...estimates.values()].reduce((sum, estimate) => sum + estimate.mineWeek, 0)
    : undefined;
  const windows = fastctxWindows(main, mineWeek, myBudget);
  const checkedAt = yield* nowIso;
  const sections = shown.map((login) =>
    fastctxLoginSection(login, estimates.get(login.id), {
      myBudget: login === main ? myBudget : undefined,
    }),
  );
  return {
    usageLimits: windows.length
      ? { ...makeUsageLimits({ checkedAt, windows }), sections, footnote: FASTCTX_FOOTNOTE }
      : makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "fastctx has no limit readings yet.",
        }),
    ...(main
      ? { planLabel: `${main.agent === "codex" ? "Codex" : "Claude"} · ${main.machine}` }
      : {}),
  } satisfies AcpPlanUsage;
});

const ANTIGRAVITY_ACP_EXECUTABLE = /^antigravity-acp(?:\.py)?$/i;

export function isAntigravityAcpCommand(
  commandPath: string,
  commandArgs: ReadonlyArray<string>,
): boolean {
  return [commandPath, ...commandArgs].some((part) =>
    ANTIGRAVITY_ACP_EXECUTABLE.test(part.split(/[\\/]/).pop() ?? ""),
  );
}

/** The ports and CSRF token the App's language server writes to `daemon/hub_<port>.json`. */
export function antigravityHub(text: string): { port: number; csrfToken: string } | undefined {
  let hub: unknown;
  try {
    hub = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(hub)) return undefined;
  const port = numberOf(hub.httpPort);
  const csrfToken = stringOf(hub.csrfToken);
  return port !== undefined && csrfToken ? { port, csrfToken } : undefined;
}

const AG_WINDOW_MINS: Readonly<Record<string, number>> = { "5h": 5 * HOUR, weekly: WEEK };

/** What the App says under its quota panel, put shortly enough to translate. */
const ANTIGRAVITY_FOOTNOTE =
  "Models in a group share one 5-hour and one weekly limit; quota is spent in proportion to the cost of the tokens.";

function antigravityGroupName(name: string): string {
  if (/^gemini models$/i.test(name)) return "Gemini";
  if (/^claude and gpt models$/i.test(name)) return "Claude & GPT";
  return name.replace(/^Gemini \d+(?:\.\d+)? /, "");
}

/** `RetrieveUserQuotaSummary` as windows (Gemini's week first) and one section per model group. */
export function antigravityQuota(reply: unknown): {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly sections: ReadonlyArray<ServerProviderUsageSection>;
  readonly footnote?: string;
} {
  const response = isRecord(reply) && isRecord(reply.response) ? reply.response : {};
  const groups = Array.isArray(response.groups) ? response.groups.filter(isRecord) : [];
  const windows: Array<ServerProviderUsageWindow> = [];
  const sections: Array<ServerProviderUsageSection> = [];
  for (const group of groups) {
    const title = stringOf(group.displayName) ?? "Models";
    const short = antigravityGroupName(title);
    const gauges: Array<ServerProviderUsageSection["gauges"][number]> = [];
    for (const bucket of Array.isArray(group.buckets) ? group.buckets.filter(isRecord) : []) {
      const id = stringOf(bucket.bucketId);
      const mins = AG_WINDOW_MINS[stringOf(bucket.window) ?? ""];
      const remaining = numberOf(bucket.remainingFraction);
      if (!id || mins === undefined || remaining === undefined) continue;
      const usedPercent = clampPercent((1 - remaining) * 100);
      const resetsAt = stringOf(bucket.resetTime);
      const duration = mins === WEEK ? "7 days" : durationLabel(mins);
      windows.push({
        id,
        kind: kindFor(mins),
        label: `${short} · ${duration}`,
        usedPercent,
        windowDurationMins: mins,
        source: "official",
        ...(windows.length === 0 && mins === WEEK ? { primary: true } : {}),
        ...(resetsAt ? { resetsAt } : {}),
      });
      gauges.push({
        label: duration,
        usedPercent,
        source: "official",
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
    if (gauges.length === 0) continue;
    const subtitle = stringOf(group.description)?.replace(/^Models within this group:\s*/i, "");
    sections.push({
      title,
      ...(subtitle ? { subtitle } : {}),
      gauges,
      facts: [],
      breakdowns: [],
    });
  }
  // The App lists Gemini's week first; a week that is not first still leads the top bar.
  if (!windows.some((window) => window.primary)) {
    const week = windows.find((window) => window.kind === "weekly");
    if (week) windows[windows.indexOf(week)] = { ...week, primary: true };
  }
  return { windows, sections, ...(sections.length ? { footnote: ANTIGRAVITY_FOOTNOTE } : {}) };
}

const LS_SERVICE = "exa.language_server_pb.LanguageServerService";

const readAntigravityPlanUsage = Effect.fn("AcpPlanUsage.antigravity")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const daemon =
    environment.AG_DAEMON_DIR?.trim() ||
    path.join(yield* HostProcess.HomeDirectory, ".gemini", "antigravity", "daemon");
  const checkedAt = yield* nowIso;
  const names = (yield* fileSystem
    .readDirectory(daemon)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))).filter((name) =>
    /^hub_\d+\.json$/.test(name),
  );
  // The server writes a fresh hub file each time the App starts it; the newest is the live one.
  const dated = yield* Effect.forEach(names, (name) =>
    fileSystem.stat(path.join(daemon, name)).pipe(
      Effect.map((info) => ({
        name,
        at: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
      })),
      Effect.orElseSucceed(() => ({ name, at: 0 })),
    ),
  );
  const newest = dated.toSorted((a, b) => b.at - a.at)[0];
  const hub = newest
    ? antigravityHub(yield* fileSystem.readFileString(path.join(daemon, newest.name)))
    : undefined;
  if (!hub) {
    return {
      usageLimits: makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Antigravity is not running.",
      }),
    } satisfies AcpPlanUsage;
  }
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  // The same call the App's quota panel makes to its own language server.
  const call = (method: string) =>
    client
      .execute(
        HttpClientRequest.post(`http://127.0.0.1:${hub.port}/${LS_SERVICE}/${method}`).pipe(
          HttpClientRequest.setHeaders({
            "Connect-Protocol-Version": "1",
            "x-codeium-csrf-token": hub.csrfToken,
          }),
          HttpClientRequest.bodyJsonUnsafe({}),
        ),
      )
      .pipe(Effect.flatMap((response) => response.json));
  const [quota, status] = yield* Effect.all(
    [
      call("RetrieveUserQuotaSummary"),
      call("GetUserStatus").pipe(Effect.orElseSucceed(() => null)),
    ],
    { concurrency: 2 },
  );
  const { windows, sections, footnote } = antigravityQuota(quota);
  const user = isRecord(status) && isRecord(status.userStatus) ? status.userStatus : {};
  const tier = isRecord(user.userTier) ? stringOf(user.userTier.name) : undefined;
  return {
    usageLimits: windows.length
      ? {
          ...makeUsageLimits({ checkedAt, windows }),
          sections,
          ...(footnote ? { footnote } : {}),
        }
      : makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "Antigravity returned no quota groups.",
        }),
    ...(tier ? { planLabel: tier } : {}),
  } satisfies AcpPlanUsage;
});

const unreadable = (message: string) =>
  Effect.map(nowIso, (checkedAt): AcpPlanUsage => ({
    usageLimits: makeUnavailableUsageLimits({ checkedAt, reason: "probeFailed", message }),
  }));

/** The plan-usage reader for agents sold by subscription, or undefined for the rest. */
export function acpPlanUsageReader(
  settings: AcpRegistrySettings,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<AcpPlanUsage, never, FileSystem.FileSystem | Path.Path> | undefined {
  if (settings.source !== "local") return undefined;
  if (isZcodeAcpCommand(settings.commandPath, settings.commandArgs)) {
    return readZcodePlanUsage(environment.ZCODE_HOME).pipe(
      Effect.timeout("15 seconds"),
      Effect.provide(FetchHttpClient.layer),
      Effect.catch(() => unreadable("Could not read the ZCode Coding Plan quota.")),
    );
  }
  if (isFastctxAcpCommand(settings.commandPath, settings.commandArgs)) {
    return readFastctxPlanUsage(environment).pipe(
      Effect.timeout("20 seconds"),
      Effect.provide(FetchHttpClient.layer),
      Effect.catch(() => unreadable("Could not reach fastctx-web for limit readings.")),
    );
  }
  if (isAntigravityAcpCommand(settings.commandPath, settings.commandArgs)) {
    return readAntigravityPlanUsage(environment).pipe(
      Effect.timeout("15 seconds"),
      Effect.provide(FetchHttpClient.layer),
      Effect.catch(() => unreadable("Could not read Antigravity's quota from the App.")),
    );
  }
  return undefined;
}
