import type { ServerProvider } from "@t3tools/contracts";

export { subSessionPrompt, type SubSessionRequest } from "@t3tools/shared/subSessionPrompt";

/** Agents a sub-session can run on: enabled, installed, and not reporting an error. */
export function subSessionAgents(providers: ReadonlyArray<ServerProvider>) {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status !== "error" &&
      provider.status !== "disabled" &&
      provider.models.length > 0,
  );
}

export interface SubSessionAgentRank {
  readonly provider: ServerProvider;
  /** Left in the window the agent's one-line summary reads, or null without a reading. */
  readonly remaining: number | null;
  readonly resetsAt: string | null;
  readonly score: number;
  readonly recommended: boolean;
}

const MINUTE = 60_000;
const DEFAULT_WINDOW_MINS = { session: 300, weekly: 7 * 24 * 60, monthly: 30 * 24 * 60, other: 0 };

type UsageWindow = NonNullable<ServerProvider["usageLimits"]>["windows"][number];

function leftIn(window: UsageWindow, now: number): number {
  const reset = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  // A window whose reset has passed is full again even before the next reading.
  return Number.isFinite(reset) && reset <= now ? 100 : Math.max(0, 100 - window.usedPercent);
}

/**
 * Ranks agents for a new sub-session: plenty left and a reset coming soon first, since what is
 * left of a window that is about to reset is lost if unused; an agent nearly out of any window
 * drops, and agents with no quota reading come after those with one.
 */
export function rankSubSessionAgents(
  providers: ReadonlyArray<ServerProvider>,
  now: number,
): ReadonlyArray<SubSessionAgentRank> {
  const ranked = subSessionAgents(providers).map((provider) => {
    const windows = provider.usageLimits?.windows ?? [];
    const primary =
      windows.find((window) => window.primary) ??
      windows.find((window) => window.kind === "weekly") ??
      windows[0];
    if (primary === undefined) {
      return { provider, remaining: null, resetsAt: null, score: 0.1 };
    }
    const remaining = leftIn(primary, now);
    const tightest = Math.min(...windows.map((window) => leftIn(window, now)));
    const span =
      (primary.windowDurationMins || DEFAULT_WINDOW_MINS[primary.kind] || 7 * 24 * 60) * MINUTE;
    const reset = primary.resetsAt ? Date.parse(primary.resetsAt) : Number.NaN;
    const untilReset = Number.isFinite(reset) && reset > now ? reset - now : span;
    const urgency = 1 - Math.min(1, untilReset / span);
    const score = (remaining / 100) * (1 + urgency) * Math.min(1, tightest / 15);
    return { provider, remaining, resetsAt: primary.resetsAt ?? null, score };
  });
  const order = ranked.toSorted((a, b) => b.score - a.score);
  const best = order[0];
  return order.map((entry) => ({
    ...entry,
    recommended: entry === best && entry.remaining !== null && entry.score > 0.2,
  }));
}

export function defaultSubSessionModel(provider: ServerProvider | undefined): string | null {
  if (provider === undefined) return null;
  return (provider.models.find((model) => model.isDefault) ?? provider.models[0])?.slug ?? null;
}
