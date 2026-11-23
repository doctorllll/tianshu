import { describe, expect, it } from "@effect/vitest";

import {
  antigravityHub,
  antigravityQuota,
  isAntigravityAcpCommand,
  isFastctxAcpCommand,
  zcodeCodingPlan,
  zcodeQuotaWindows,
} from "./planUsage.ts";

describe("zcodeQuotaWindows", () => {
  it("reads the five-hour, weekly and MCP windows of the monitor reply", () => {
    const windows = zcodeQuotaWindows({
      level: "pro",
      limits: [
        { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 1, nextResetTime: 1795374010141 },
        { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 66, nextResetTime: 1795540601984 },
        {
          type: "TIME_LIMIT",
          unit: 5,
          number: 1,
          usage: 1000,
          currentValue: 90,
          remaining: 910,
          percentage: 9,
          nextResetTime: 1796349697983,
        },
      ],
    });
    expect(
      windows.map(({ id, kind, label, usedPercent, windowDurationMins }) => ({
        id,
        kind,
        label,
        usedPercent,
        windowDurationMins,
      })),
    ).toEqual([
      {
        id: "tokens-300",
        kind: "session",
        label: "5 hours",
        usedPercent: 1,
        windowDurationMins: 300,
      },
      {
        id: "tokens-10080",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 66,
        windowDurationMins: 10080,
      },
      {
        id: "mcp-43200",
        kind: "monthly",
        label: "MCP Monthly",
        usedPercent: 9,
        windowDurationMins: 43200,
      },
    ]);
    expect(windows[0]?.resetsAt).toBe("2026-11-22T19:00:10.141Z");
  });

  it("falls back to the count alone and to usage over total", () => {
    const [window] = zcodeQuotaWindows({
      limits: [{ type: "TOKENS_LIMIT", number: 7, usage: 200, currentValue: 50 }],
    });
    expect(window).toMatchObject({ kind: "weekly", usedPercent: 25 });
  });
});

describe("zcodeCodingPlan", () => {
  it("takes the enabled Coding Plan provider that holds a key", () => {
    const config = JSON.stringify({
      provider: {
        magpie: { enabled: true, options: { apiKey: "m", baseURL: "http://127.0.0.1:3425" } },
        "builtin:zai-coding-plan": { enabled: false, options: { apiKey: "z" } },
        "builtin:bigmodel-start-plan": { enabled: true, options: { apiKey: "s" } },
        "builtin:bigmodel-coding-plan": { enabled: true, options: { apiKey: "b" } },
      },
    });
    expect(zcodeCodingPlan(config)).toEqual({ apiKey: "b", host: "https://open.bigmodel.cn" });
    expect(zcodeCodingPlan("{")).toBeUndefined();
  });
});

describe("isFastctxAcpCommand", () => {
  it("recognises the bridge behind an interpreter", () => {
    expect(
      isFastctxAcpCommand("/opt/homebrew/bin/python3", [
        "/Users/a/code/fastctx-web/bin/fastctx-acp",
      ]),
    ).toBe(true);
    expect(isFastctxAcpCommand("/opt/homebrew/bin/zcode-acp-server", [])).toBe(false);
  });
});

describe("antigravityQuota", () => {
  const reply = {
    response: {
      description: "Within each group, models share a weekly limit and a 5-hour limit.",
      groups: [
        {
          displayName: "Gemini Models",
          description: "Models within this group: Gemini 4 Neon, Gemini 3.8 Flash",
          buckets: [
            {
              bucketId: "gemini-weekly",
              window: "weekly",
              remainingFraction: 0.8075,
              resetTime: "2026-11-28T16:30:43Z",
              description: "You have used some of your weekly limit.",
            },
            { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.93 },
          ],
        },
        {
          displayName: "Claude and GPT models",
          buckets: [{ bucketId: "3p-weekly", window: "weekly", remainingFraction: 1 }],
        },
        { displayName: "Gemini 4 Argon", buckets: [{ bucketId: "odd", window: "daily" }] },
      ],
    },
  };

  it("reads each group's buckets as windows, Gemini's week leading", () => {
    const { windows } = antigravityQuota(reply);
    expect(windows.map((w) => [w.id, w.label, w.kind, Math.round(w.usedPercent)])).toEqual([
      ["gemini-weekly", "Gemini · 7 days", "weekly", 19],
      ["gemini-5h", "Gemini · 5 hours", "session", 7],
      ["3p-weekly", "Claude & GPT · 7 days", "weekly", 0],
    ]);
    expect(windows.filter((w) => w.primary).map((w) => w.id)).toEqual(["gemini-weekly"]);
    expect(windows[0]?.resetsAt).toBe("2026-11-28T16:30:43Z");
  });

  it("gives one section per group that has a reading", () => {
    const { sections, footnote } = antigravityQuota(reply);
    expect(sections.map((s) => [s.title, s.subtitle, s.gauges.map((g) => g.label)])).toEqual([
      ["Gemini Models", "Gemini 4 Neon, Gemini 3.8 Flash", ["7 days", "5 hours"]],
      ["Claude and GPT models", undefined, ["7 days"]],
    ]);
    expect(sections[0]?.gauges[0]?.resetsAt).toBe("2026-11-28T16:30:43Z");
    expect(footnote).toMatch(/^Models in a group share/);
    expect(antigravityQuota({}).windows).toEqual([]);
  });

  it("reads the hub file and recognises the bridge", () => {
    expect(antigravityHub('{"pid":1,"httpPort":62633,"csrfToken":"t"}')).toEqual({
      port: 62633,
      csrfToken: "t",
    });
    expect(antigravityHub('{"httpPort":1}')).toBeUndefined();
    expect(isAntigravityAcpCommand("/usr/bin/env", ["python3", "/x/bridges/antigravity-acp"])).toBe(
      true,
    );
  });
});
