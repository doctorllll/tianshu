import type {
  ServerProviderUsageBreakdown,
  ServerProviderUsageGauge,
  ServerProviderUsageSection,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { clampPercent } from "@t3tools/provider-core/server/usageLimits";

/**
 * fastctx-web's usage panel, ported: official readings from `agent_logins`, and the estimate its
 * ledger (`agent_usage`) gives, worked out the same way (static/usage.js `estimate`).
 */

/** Fable burns quota 2.5× faster than its price, and may use only half the weekly plate. */
const FABLE_TIMES = 2.5;
const FABLE_LINE = 50;
/** fastctx's plate when none was set. */
const DEFAULT_PLATE_USD = 3000;
/** This account's part of the subscription: a third of the weekly reckoning ($3,300 → $1,100). */
export const MY_SHARE_OF_PLATE = 1 / 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numberOf = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const stringOf = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const listOf = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);
const micros = (value: unknown) => (numberOf(value) ?? 0) / 1e6;

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

interface Reading {
  readonly exact: number;
  readonly resetsAt: string | undefined;
  readonly reset: boolean;
}

export interface FastctxLogin {
  readonly id: string;
  readonly machine: string;
  readonly agent: "claude" | "codex";
  readonly dir: string;
  readonly workbench: boolean;
  readonly who: string;
  readonly plan: string;
  readonly five: Reading | undefined;
  readonly week: Reading | undefined;
  readonly observedAt: string | undefined;
  readonly credits: string | undefined;
  readonly unread: string | undefined;
  readonly plateUsd: number | undefined;
}

function windowOf(limits: Record<string, unknown> | undefined, minutes: number, names: string[]) {
  const value = limits?.kind === "known" && isRecord(limits.value) ? limits.value : undefined;
  const windows = listOf(value?.windows).filter(isRecord);
  return (
    windows.find((w) => w.minutes === minutes) ??
    windows.find((w) => names.includes(String(w.name)))
  );
}

function reading(window: Record<string, unknown> | undefined, now: number): Reading | undefined {
  const tenths = numberOf(window?.used_tenths);
  if (window === undefined || tenths === undefined) return undefined;
  const resetsAt = stringOf(window.resets_at);
  const at = resetsAt ? Date.parse(resetsAt) : NaN;
  return { exact: tenths / 10, resetsAt, reset: Number.isFinite(at) && at <= now };
}

/** `agent_logins`, as fastctx-web's `parseLogins` reads it. */
export function parseFastctxLogins(result: unknown, now: number): ReadonlyArray<FastctxLogin> {
  const out: FastctxLogin[] = [];
  for (const machine of listOf(isRecord(result) ? result.machines : undefined)) {
    if (!isRecord(machine) || machine.kind !== "answered" || !isRecord(machine.logins)) continue;
    const report = machine.logins;
    const machineName = stringOf(report.machine) ?? "";
    for (const agent of ["claude", "codex"] as const) {
      const group = isRecord(report[agent]) ? report[agent] : {};
      for (const login of listOf(group.listed)) {
        if (!isRecord(login)) continue;
        const identity = isRecord(login.identity) ? login.identity : {};
        const whoEntry =
          isRecord(identity.who) && identity.who.kind === "known" ? identity.who : {};
        const who = isRecord(whoEntry.value) ? whoEntry.value : undefined;
        if (who?.logged_in === false) continue;
        const limits = isRecord(login.limits) ? login.limits : undefined;
        const value = limits?.kind === "known" && isRecord(limits.value) ? limits.value : undefined;
        const credits = isRecord(value?.credits) ? value.credits : undefined;
        const dir = stringOf(login.dir) ?? "";
        const plan = stringOf(who?.plan);
        out.push({
          id: `${machineName}|${agent}|${dir}`,
          machine: machineName,
          agent,
          dir,
          workbench: login.workbench === true,
          who:
            stringOf(who?.email) ??
            (dir
              .replace(/[\\/]+$/, "")
              .split(/[\\/]/)
              .pop() ||
              dir),
          plan: plan ? plan[0]!.toUpperCase() + plan.slice(1) : "",
          five: reading(windowOf(limits, 300, ["five_hour", "primary"]), now),
          week: reading(windowOf(limits, 10080, ["seven_day", "secondary"]), now),
          observedAt: stringOf(value?.observed_at),
          credits: credits
            ? credits.unlimited === true
              ? "unlimited"
              : stringOf(credits.balance)
            : undefined,
          unread:
            limits && limits.kind !== "known"
              ? (stringOf(limits.reason) ?? "no limit reading")
              : undefined,
          plateUsd: numberOf(login.week) === undefined ? undefined : micros(login.week),
        });
      }
    }
  }
  return out;
}

/** The logins the panel lists: those fastctx's workbench uses, or every one when none is marked. */
export function shownFastctxLogins(logins: ReadonlyArray<FastctxLogin>) {
  const marked = logins.filter((login) => login.workbench);
  const read = (login: FastctxLogin) => Number(Boolean(login.five ?? login.week));
  return (marked.length ? marked : logins).toSorted(
    (a, b) => read(b) - read(a) || (a.agent === b.agent ? 0 : a.agent === "claude" ? -1 : 1),
  );
}

/** The fastctx accounts this machine signs in as (`world_now` accounts → hub logins). */
export function fastctxMyAccounts(worldNow: unknown): ReadonlyArray<string> {
  const hubs = isRecord(worldNow) && isRecord(worldNow.accounts) ? worldNow.accounts.hubs : [];
  return listOf(hubs).flatMap((hub) =>
    isRecord(hub)
      ? listOf(hub.logins).flatMap((account) =>
          typeof account === "string" ? [`${String(hub.hub)}|${account}`] : [],
        )
      : [],
  );
}

interface Person {
  readonly name: string;
  readonly mine: boolean;
  week: number;
  fable: number;
  tokens: number;
  day: number;
  dayTokens: number;
}

export interface FastctxEstimate {
  readonly hasUsd: boolean;
  readonly people: ReadonlyArray<Person>;
  readonly plate: number;
  /** The plate as set, before fastctx's weekly reckoning adjusts it. */
  readonly basePlate: number;
  readonly week: number;
  readonly mineWeek: number;
  readonly fable: number;
  readonly fiveSpent: number | undefined;
  readonly fiveTotal: number | undefined;
  readonly models: ReadonlyArray<{
    readonly model: string;
    readonly quota: number;
    readonly tokens: number;
  }>;
  readonly weekPct: number;
  readonly fablePct: number;
  readonly elsewhere: number;
  readonly day: number;
  readonly dayTokens: number;
}

/** fastctx-web's `estimate`, plus this machine's own spend. */
export function estimateFastctxLogin(
  login: FastctxLogin,
  report: unknown,
  mine: ReadonlyArray<string>,
): FastctxEstimate {
  const r = isRecord(report) ? report : {};
  const people = new Map<string, Person>();
  let hasUsd = false;
  for (const entry of listOf(r.people)) {
    if (!isRecord(entry)) continue;
    const account = isRecord(entry.account) ? entry.account : undefined;
    const isMine = !account || mine.includes(`${String(account.hub)}|${String(account.account)}`);
    const name = isMine ? "Me" : (stringOf(account?.account) ?? "?");
    const week = isRecord(entry.week) ? entry.week : {};
    const fableEntry = isRecord(entry.fable) ? entry.fable : {};
    const counted = isRecord(entry.counted) ? entry.counted : {};
    const day = isRecord(entry.day) ? entry.day : {};
    if (numberOf(week.usd) !== undefined) hasUsd = true;
    const fableUsd = micros(fableEntry.usd);
    const weekQuota =
      numberOf(counted.week) !== undefined
        ? micros(counted.week)
        : micros(week.usd) + fableUsd * (FABLE_TIMES - 1);
    const fableQuota =
      numberOf(counted.fable) !== undefined ? micros(counted.fable) : fableUsd * FABLE_TIMES;
    const had = people.get(name) ?? {
      name,
      mine: isMine,
      week: 0,
      fable: 0,
      tokens: 0,
      day: 0,
      dayTokens: 0,
    };
    had.week += weekQuota;
    had.fable += fableQuota;
    had.tokens += numberOf(week.tokens) ?? 0;
    had.day += micros(day.usd);
    had.dayTokens += numberOf(day.tokens) ?? 0;
    people.set(name, had);
  }
  const sorted = [...people.values()].toSorted((a, b) => b.week - a.week || b.tokens - a.tokens);
  const reckoning = isRecord(r.reckoning) ? r.reckoning : undefined;
  const plate =
    numberOf(reckoning?.week) !== undefined
      ? micros(reckoning?.week)
      : (login.plateUsd ?? DEFAULT_PLATE_USD);
  const basePlate =
    numberOf(reckoning?.base) !== undefined ? micros(reckoning?.base) : (login.plateUsd ?? plate);
  const week = sorted.reduce((sum, p) => sum + p.week, 0);
  const fable = sorted.reduce((sum, p) => sum + p.fable, 0);
  let fiveSpent: number | undefined;
  const fiveReset = login.five?.resetsAt ? Date.parse(login.five.resetsAt) : NaN;
  if (hasUsd && login.five && !login.five.reset && Number.isFinite(fiveReset)) {
    const from = fiveReset - 5 * 3_600_000;
    fiveSpent = 0;
    for (const hour of listOf(r.hours)) {
      if (!isRecord(hour)) continue;
      const at = Date.parse(String(hour.at));
      if (at >= from) fiveSpent += micros(hour.usd) + micros(hour.fable) * (FABLE_TIMES - 1);
    }
  }
  const weekReport = isRecord(r.week) ? r.week : {};
  const models = listOf(weekReport.models)
    .filter(isRecord)
    .map((m) => {
      const model = stringOf(m.model) ?? "unknown";
      return {
        model,
        quota: micros(m.usd) * (/fable/i.test(model) ? FABLE_TIMES : 1),
        tokens: numberOf(m.tokens) ?? 0,
      };
    })
    .filter((m) => m.quota > 0 || m.tokens > 0)
    .toSorted((a, b) => b.quota - a.quota || b.tokens - a.tokens);
  const weekPct = plate ? (week / plate) * 100 : 0;
  const fiveUsed = login.five && !login.five.reset ? login.five.exact : 0;
  return {
    hasUsd,
    people: sorted,
    plate,
    basePlate,
    week,
    mineWeek: sorted.filter((p) => p.mine).reduce((sum, p) => sum + p.week, 0),
    fable,
    fiveSpent,
    fiveTotal: fiveSpent !== undefined && fiveUsed > 0 ? (fiveSpent * 100) / fiveUsed : undefined,
    models,
    weekPct,
    fablePct: plate ? (fable / ((plate * FABLE_LINE) / 100)) * 100 : 0,
    elsewhere: login.week && !login.week.reset ? Math.max(0, login.week.exact - weekPct) : 0,
    day: sorted.reduce((sum, p) => sum + p.day, 0),
    dayTokens: sorted.reduce((sum, p) => sum + p.dayTokens, 0),
  };
}

function officialGauge(label: string, read: Reading | undefined): ServerProviderUsageGauge[] {
  if (!read) return [];
  return [
    {
      label,
      usedPercent: read.reset ? 0 : clampPercent(read.exact),
      source: "official",
      ...(read.resetsAt && !read.reset ? { resetsAt: read.resetsAt } : {}),
    },
  ];
}

/** One login's module section: official gauges, the ledger's estimate, and its breakdowns. */
export function fastctxLoginSection(
  login: FastctxLogin,
  estimate: FastctxEstimate | undefined,
  options: { readonly myBudget: number | undefined },
): ServerProviderUsageSection {
  const gauges: ServerProviderUsageGauge[] = [];
  const facts: Array<{ label: string; value: string }> = [];
  const breakdowns: ServerProviderUsageBreakdown[] = [];
  gauges.push(...officialGauge("5 hours", login.five));
  if (estimate?.fiveSpent !== undefined) {
    gauges.push({
      label: "5 hours · ledger",
      usedPercent: estimate.fiveTotal
        ? clampPercent((estimate.fiveSpent / estimate.fiveTotal) * 100)
        : 0,
      source: "estimate",
      amount: estimate.fiveTotal
        ? `${usd(estimate.fiveSpent)} / ≈${usd(estimate.fiveTotal)}`
        : usd(estimate.fiveSpent),
      hint: "Ledger dollars in this five-hour window; the window total is spent ÷ the official percentage.",
    });
  }
  gauges.push(...officialGauge("7 days", login.week));
  if (estimate?.hasUsd) {
    gauges.push({
      label: "7 days · ledger",
      usedPercent: clampPercent(estimate.weekPct),
      source: "estimate",
      amount: `${usd(estimate.week)} / ${usd(estimate.plate)}`,
      hint: "Ledger dollars this week, Fable counted ×2.5, against the weekly plate fastctx takes.",
    });
    if (options.myBudget) {
      gauges.push({
        label: "My week",
        usedPercent: clampPercent((estimate.mineWeek / options.myBudget) * 100),
        source: "estimate",
        amount: `${usd(estimate.mineWeek)} / ${usd(options.myBudget)}`,
        hint: "Your accounts' ledger dollars against a third of the weekly plate as set.",
      });
    }
    if (login.agent === "claude" && (estimate.fable > 0 || estimate.fablePct > 0)) {
      gauges.push({
        label: "Fable",
        usedPercent: clampPercent(estimate.fablePct),
        source: "estimate",
        amount: `${usd(estimate.fable)} / ${usd((estimate.plate * FABLE_LINE) / 100)}`,
        hint: "Fable may use half the weekly plate; there is no official reading.",
      });
    }
  }
  if (estimate?.hasUsd) {
    if (login.week && !login.week.reset) {
      facts.push({
        label: "Official vs ledger",
        value: `${Math.round(login.week.exact)}% · ${Math.round(estimate.weekPct)}%`,
      });
      if (estimate.elsewhere >= 1) {
        facts.push({ label: "Outside the ledger", value: `≈${Math.round(estimate.elsewhere)}%` });
      }
    }
    facts.push({
      label: "Weekly plate (set · taken)",
      value: `${usd(estimate.basePlate)} · ${usd(estimate.plate)}`,
    });
    facts.push({ label: "Last 24 hours (API price)", value: usd(estimate.day) });
    if (estimate.people.length > 1) {
      breakdowns.push({
        title: "This week by person",
        items: estimate.people
          .filter((p) => p.week >= 0.5)
          .map((p) => ({
            label: p.name,
            percent: clampPercent(estimate.plate ? (p.week / estimate.plate) * 100 : 0),
            amount: usd(p.week),
          })),
      });
    }
    if (estimate.models.length) {
      const total = estimate.models.reduce((sum, m) => sum + m.quota, 0) || 1;
      breakdowns.push({
        title: "This week by model",
        items: estimate.models.slice(0, 5).map((m) => ({
          label: m.model.replace(/^claude-/, ""),
          percent: clampPercent((m.quota / total) * 100),
          amount: usd(m.quota),
        })),
      });
    }
  } else if (estimate && (estimate.dayTokens || estimate.people.length)) {
    facts.push({
      label: "Tokens this week",
      value: tokens(estimate.people.reduce((sum, p) => sum + p.tokens, 0)),
    });
    facts.push({ label: "Tokens in the last 24 hours", value: tokens(estimate.dayTokens) });
  }
  if (login.credits) facts.push({ label: "Credits past the limit", value: login.credits });
  return {
    title: login.machine,
    subtitle: [login.who, login.plan, login.agent === "codex" ? "Codex" : "Claude"]
      .filter(Boolean)
      .join(" · "),
    ...(login.observedAt ? { observedAt: login.observedAt } : {}),
    gauges,
    facts,
    breakdowns,
    ...(login.unread && !login.five && !login.week ? { note: login.unread } : {}),
  };
}

/** The windows the quota bar and picker read: your week first, then the official readings. */
export function fastctxWindows(
  main: FastctxLogin | undefined,
  mineWeek: number | undefined,
  myBudget: number | undefined,
): ReadonlyArray<ServerProviderUsageWindow> {
  const windows: ServerProviderUsageWindow[] = [];
  if (mineWeek !== undefined && myBudget) {
    windows.push({
      id: "mine-week",
      kind: "weekly",
      label: "My week",
      usedPercent: clampPercent((mineWeek / myBudget) * 100),
      windowDurationMins: 10080,
      primary: true,
      source: "estimate",
      amount: `${usd(mineWeek)} / ${usd(myBudget)}`,
      ...(main?.week?.resetsAt && !main.week.reset ? { resetsAt: main.week.resetsAt } : {}),
    });
  }
  const official = (id: string, label: string, mins: number, read: Reading | undefined) => {
    if (!read) return;
    windows.push({
      id,
      kind: mins === 300 ? "session" : "weekly",
      label,
      usedPercent: read.reset ? 0 : clampPercent(read.exact),
      windowDurationMins: mins,
      source: "official",
      ...(read.resetsAt && !read.reset ? { resetsAt: read.resetsAt } : {}),
    });
  };
  official("official-300", "5 hours", 300, main?.five);
  official("official-10080", "7 days", 10080, main?.week);
  return windows;
}

export const FASTCTX_FOOTNOTE =
  "Official: the percentages sessions read from Claude or Codex. Ledger: dollars fastctx's ledger counts (Fable ×2.5), not an official figure.";
