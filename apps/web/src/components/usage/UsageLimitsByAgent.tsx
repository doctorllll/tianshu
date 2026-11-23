import type {
  EnvironmentId,
  ServerProvider,
  ServerProviderUsageBreakdown,
  ServerProviderUsageGauge,
  ServerProviderUsageSection,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { collectLimitAccounts } from "@t3tools/shared/usageLimits";
import type { ReactNode } from "react";

import { readUiLocale, uiText } from "~/i18n";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { quotaWindowLabel } from "./usageQuotaPresentation";

type Presentations = Parameters<typeof collectLimitAccounts>[0];

/** Subscription agents first, the order the quota bar pins them in. */
const PRIORITY = ["zcode", "fastctx", "antigravity", "grok", "codex", "claudeAgent"];

function rank(provider: ServerProvider) {
  const ranks = [provider.instanceId, provider.driver]
    .map((id) => PRIORITY.indexOf(String(id)))
    .filter((index) => index >= 0);
  return ranks.length ? Math.min(...ranks) : PRIORITY.length;
}

function label(text: string): string {
  const translated = uiText(text);
  return translated !== text ? translated : quotaWindowLabel(text, readUiLocale() === "zh-CN");
}

function resetText(resetsAt: string | undefined, now: number): string | null {
  const at = resetsAt ? Date.parse(resetsAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const left = at - now;
  if (left <= 0) return uiText("Already reset");
  if (left < 86_400_000) {
    const minutes = Math.round(left / 60_000);
    if (minutes < 60) return uiText("Resets in {minutes} m", { minutes });
    return uiText("Resets in {hours} h {minutes} m", {
      hours: Math.floor(minutes / 60),
      minutes: String(minutes % 60).padStart(2, "0"),
    });
  }
  const time = new Intl.DateTimeFormat(readUiLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return uiText("Resets {time}", { time });
}

function agoText(at: string | undefined, now: number): string | null {
  const time = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return null;
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return uiText("Read just now");
  if (minutes < 60) return uiText("Read {count} min ago", { count: minutes });
  if (minutes < 1440) return uiText("Read {count} h ago", { count: Math.round(minutes / 60) });
  return uiText("Read {date}", {
    date: new Intl.DateTimeFormat(readUiLocale(), { month: "short", day: "numeric" }).format(time),
  });
}

function levelClass(used: number) {
  if (used >= 90) return "bg-destructive";
  if (used >= 75) return "bg-warning";
  return "bg-foreground/70";
}

function Bar({ used, estimate }: { readonly used: number; readonly estimate?: boolean }) {
  const width = Math.max(0, Math.min(100, used));
  return (
    <span className="relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${levelClass(used)}${
          estimate ? " opacity-60" : ""
        }`}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

function SourceTag({ source }: { readonly source: "official" | "estimate" | undefined }) {
  if (source === undefined) return null;
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-px text-3xs leading-4 ${
        source === "official" ? "bg-success/15 text-success" : "bg-info/15 text-info"
      }`}
    >
      {source === "official" ? uiText("Official") : uiText("Ledger")}
    </span>
  );
}

function Reading(props: {
  readonly name: string;
  readonly used: number;
  readonly source: "official" | "estimate" | undefined;
  readonly amount: string | undefined;
  readonly resetsAt: string | undefined;
  readonly hint: string | undefined;
  readonly primary?: boolean;
  readonly now: number;
}) {
  const reset = resetText(props.resetsAt, props.now);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 text-xs">
        {props.hint ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="cursor-help text-muted-foreground underline decoration-dotted" />
              }
            >
              {label(props.name)}
            </TooltipTrigger>
            <TooltipPopup side="top" className="max-w-72 whitespace-pre-wrap">
              {label(props.hint)}
            </TooltipPopup>
          </Tooltip>
        ) : (
          <span className={props.primary ? "font-medium text-foreground" : "text-muted-foreground"}>
            {label(props.name)}
          </span>
        )}
        <SourceTag source={props.source} />
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{reset ?? ""}</span>
      </div>
      <div className="flex items-center gap-2">
        <Bar used={props.used} estimate={props.source === "estimate"} />
        <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
          {Math.round(props.used)}%
        </span>
      </div>
      {props.amount ? (
        <div className="text-right text-2xs text-muted-foreground tabular-nums">{props.amount}</div>
      ) : null}
    </div>
  );
}

function WindowReading({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  return (
    <Reading
      name={window.label}
      used={window.usedPercent}
      source={window.source}
      amount={window.amount}
      resetsAt={window.resetsAt}
      hint={undefined}
      {...(window.primary ? { primary: true } : {})}
      now={now}
    />
  );
}

function GaugeReading({
  gauge,
  now,
}: {
  readonly gauge: ServerProviderUsageGauge;
  readonly now: number;
}) {
  return (
    <Reading
      name={gauge.label}
      used={gauge.usedPercent}
      source={gauge.source}
      amount={gauge.amount}
      resetsAt={gauge.resetsAt}
      hint={gauge.hint}
      now={now}
    />
  );
}

function Breakdown({ breakdown }: { readonly breakdown: ServerProviderUsageBreakdown }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-2xs text-muted-foreground">{label(breakdown.title)}</div>
      {breakdown.items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate">{label(item.label)}</span>
          <Bar used={item.percent} estimate />
          <span className="w-16 shrink-0 text-right tabular-nums">{item.amount}</span>
        </div>
      ))}
    </div>
  );
}

function Section({
  section,
  now,
}: {
  readonly section: ServerProviderUsageSection;
  readonly now: number;
}) {
  const read = agoText(section.observedAt, now);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-medium whitespace-nowrap">{label(section.title)}</span>
        {section.subtitle ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{section.subtitle}</span>
        ) : null}
        {read ? (
          <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{read}</span>
        ) : null}
      </div>
      {section.gauges.map((gauge) => (
        <GaugeReading key={gauge.label} gauge={gauge} now={now} />
      ))}
      {section.note ? (
        <div className="text-xs text-muted-foreground">{label(section.note)}</div>
      ) : null}
      {section.facts.length ? (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          {section.facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{label(fact.label)}</span>
              <span className="tabular-nums">{label(fact.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {section.breakdowns.map((breakdown) => (
        <Breakdown key={breakdown.title} breakdown={breakdown} />
      ))}
    </section>
  );
}

function AgentModule({
  provider,
  environment,
  now,
}: {
  readonly provider: ServerProvider;
  readonly environment: string | null;
  readonly now: number;
}) {
  const limits = provider.usageLimits;
  const name = provider.displayName?.trim() || provider.instanceId;
  const read = agoText(limits?.checkedAt, now);
  // A breakdown repeats the windows with more beside them, so it replaces them.
  const sections = limits?.sections ?? [];
  const windows = sections.length ? [] : (limits?.windows ?? []);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <header className="flex items-center gap-2">
        <ProviderInstanceIcon
          driverKind={provider.driver}
          displayName={name}
          accentColor={provider.accentColor}
          className="size-6"
          iconClassName="size-4"
        />
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {[provider.auth.label, environment].filter(Boolean).join(" · ")}
          </span>
        </div>
        {read ? (
          <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{read}</span>
        ) : null}
      </header>
      {sections.length ? null : windows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {limits?.unavailable?.message
            ? label(limits.unavailable.message)
            : uiText("No limit readings for this agent.")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {windows.map((window) => (
            <WindowReading key={window.id} window={window} now={now} />
          ))}
        </div>
      )}
      {sections.map((section) => (
        <Section key={`${section.title}|${section.subtitle ?? ""}`} section={section} now={now} />
      ))}
      {limits?.footnote ? (
        <div className="text-2xs leading-relaxed text-muted-foreground">
          {label(limits.footnote)}
        </div>
      ) : null}
    </article>
  );
}

/** The limits page, one module per agent: every window it reports and, where given, its breakdown. */
export function UsageLimitsByAgent({
  presentations,
  now,
  refreshControl,
}: {
  readonly presentations: Presentations;
  readonly now: number;
  readonly refreshControl?: ReactNode;
}) {
  const several = presentations.size > 1;
  const modules = [...presentations].flatMap(([environmentId, presentation]) =>
    (presentation.serverConfig?.providers ?? [])
      .filter((provider) => provider.enabled && provider.installed && provider.usageLimits)
      .map((provider) => ({
        environmentId: environmentId as EnvironmentId,
        environment: several ? presentation.entry.target.label : null,
        provider,
      })),
  );
  modules.sort((a, b) => rank(a.provider) - rank(b.provider));
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <h2 className="text-base font-semibold">{uiText("Usage by agent")}</h2>
          <span className="text-xs text-muted-foreground">
            {uiText(
              "Official readings come from each agent's own service; ledger figures are estimates.",
            )}
          </span>
        </div>
        <div className="ml-auto">{refreshControl}</div>
      </div>
      {modules.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {uiText("No agent reports limits yet.")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {modules.map(({ environmentId, environment, provider }) => (
            <AgentModule
              key={`${environmentId}:${provider.instanceId}`}
              provider={provider}
              environment={environment}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}
