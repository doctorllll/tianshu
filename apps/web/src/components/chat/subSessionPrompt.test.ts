import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  defaultSubSessionModel,
  rankSubSessionAgents,
  subSessionAgents,
  subSessionPrompt,
} from "./subSessionPrompt";

const provider = (id: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make("acpRegistry"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "2026-11-22T00:00:00.000Z",
  models: [
    { slug: "a", name: "A", isCustom: false, capabilities: null },
    { slug: "b", name: "B", isCustom: false, isDefault: true, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
  ...overrides,
});

describe("subSessionPrompt", () => {
  it("asks the thread's agent to delegate the task verbatim to the chosen agent and model", () => {
    const text = subSessionPrompt({
      instanceId: "zcode",
      model: "GLM-5.1",
      title: " Review ",
      task: "  Read the README.\n",
    });
    expect(text).toContain("delegate_task");
    expect(text).toContain('- target: {"providerInstanceId":"zcode","model":"GLM-5.1"}');
    expect(text).toContain("- title: Review");
    expect(text.endsWith("<task>\nRead the README.\n</task>")).toBe(true);
    expect(
      subSessionPrompt({ instanceId: "dsh", model: null, title: "", task: "x" }),
    ).not.toContain("title:");
  });

  it("offers only agents that can run and picks the default model", () => {
    const agents = subSessionAgents([
      provider("zcode"),
      provider("off", { enabled: false }),
      provider("broken", { status: "error" }),
      provider("empty", { models: [] }),
    ]);
    expect(agents.map((agent) => agent.instanceId)).toEqual(["zcode"]);
    expect(defaultSubSessionModel(agents[0])).toBe("b");
    expect(defaultSubSessionModel(undefined)).toBeNull();
  });
});

describe("rankSubSessionAgents", () => {
  const now = Date.parse("2026-11-23T00:00:00.000Z");
  const week = (used: number, resetsInHours: number) => ({
    checkedAt: "2026-11-23T00:00:00.000Z",
    windows: [
      {
        id: "week",
        kind: "weekly" as const,
        label: "Weekly",
        usedPercent: used,
        windowDurationMins: 7 * 24 * 60,
        resetsAt: new Date(now + resetsInHours * 3_600_000).toISOString(),
      },
    ],
  });

  it("puts plenty left with a reset coming soon first, and unread agents last", () => {
    const ranked = rankSubSessionAgents(
      [
        provider("unread"),
        provider("fresh-week", { usageLimits: week(10, 160) }),
        provider("expiring", { usageLimits: week(30, 6) }),
        provider("drained", { usageLimits: week(97, 2) }),
      ],
      now,
    );
    expect(ranked.map((entry) => entry.provider.instanceId)).toEqual([
      "expiring",
      "fresh-week",
      "unread",
      "drained",
    ]);
    expect(ranked.map((entry) => entry.recommended)).toEqual([true, false, false, false]);
    expect(ranked[0]?.remaining).toBe(70);
  });

  it("treats a window whose reset has passed as full", () => {
    const [entry] = rankSubSessionAgents([provider("reset", { usageLimits: week(99, -1) })], now);
    expect(entry?.remaining).toBe(100);
  });
});
