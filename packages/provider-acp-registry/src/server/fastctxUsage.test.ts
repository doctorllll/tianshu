import { describe, expect, it } from "@effect/vitest";

import {
  estimateFastctxLogin,
  fastctxLoginSection,
  fastctxMyAccounts,
  fastctxWindows,
  MY_SHARE_OF_PLATE,
  parseFastctxLogins,
  shownFastctxLogins,
} from "./fastctxUsage.ts";

const NOW = Date.parse("2026-11-22T16:40:00Z");
const HUB = "w-fabc2274bc359abd";

const logins = {
  machines: [
    {
      kind: "answered",
      logins: {
        machine: "mac",
        claude: {
          listed: [
            {
              dir: "/Users/a/.claude",
              identity: { who: { kind: "known", value: { logged_in: true } } },
              limits: { kind: "unavailable", reason: "not read yet" },
            },
          ],
        },
      },
    },
    {
      kind: "answered",
      logins: {
        machine: "la",
        claude: {
          listed: [
            {
              dir: "/home/user/.claude-work",
              workbench: true,
              week: 3_300_000_000,
              identity: { who: { kind: "known", value: { logged_in: true, plan: "max" } } },
              limits: {
                kind: "known",
                value: {
                  observed_at: "2026-11-22T16:30:00Z",
                  windows: [
                    {
                      name: "five_hour",
                      minutes: 300,
                      used_tenths: 130,
                      resets_at: "2026-11-22T17:10:00Z",
                    },
                    {
                      name: "seven_day",
                      minutes: 10080,
                      used_tenths: 80,
                      resets_at: "2026-11-28T18:00:00Z",
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  ],
};

const report = {
  reckoning: { base: 3_300_000_000, week: 3_260_484_722 },
  people: [
    {
      account: { hub: HUB, account: "me-account" },
      counted: { week: 104_596_318, fable: 0 },
      week: { usd: 104_596_318, tokens: 301_486_666 },
      day: { usd: 122_815_066, tokens: 353_019_252 },
    },
    {
      account: { hub: HUB, account: "teammate" },
      counted: { week: 73_645_081, fable: 10_086_545 },
      week: { usd: 67_593_154 },
      fable: { usd: 4_034_618 },
    },
    {
      account: { hub: HUB, account: "friend" },
      counted: { week: 72_643_191, fable: 1_231_415 },
      week: { usd: 71_904_342 },
      fable: { usd: 492_566 },
    },
  ],
  hours: [
    { at: "2026-11-22T12:30:00Z", usd: 1_000_000 },
    { at: "2026-11-22T13:00:00Z", usd: 20_000_000, fable: 2_000_000 },
  ],
  week: {
    models: [
      { model: "claude-opus-5-5", usd: 97_448_933 },
      { model: "claude-sonnet-5-5", usd: 1_054_352 },
    ],
  },
};

describe("fastctx usage", () => {
  const all = parseFastctxLogins(logins, NOW);
  const shown = shownFastctxLogins(all);
  const mine = fastctxMyAccounts({ accounts: { hubs: [{ hub: HUB, logins: ["me-account"] }] } });

  it("lists the workbench logins, as fastctx-web does", () => {
    expect(all).toHaveLength(2);
    expect(shown.map((login) => login.machine)).toEqual(["la"]);
    expect(shown[0]).toMatchObject({ plan: "Max", plateUsd: 3300, five: { exact: 13 } });
  });

  it("estimates your week against a third of the set plate", () => {
    const estimate = estimateFastctxLogin(shown[0]!, report, mine);
    expect(estimate.mineWeek).toBeCloseTo(104.596, 2);
    expect(estimate.basePlate).toBe(3300);
    expect(estimate.plate).toBeCloseTo(3260.48, 1);
    expect(estimate.people.map((p) => p.name)).toEqual(["Me", "teammate", "friend"]);
    // Hours since the five-hour window opened (12:10): 1 + 20 + 2 × 1.5 for Fable.
    expect(estimate.fiveSpent).toBeCloseTo(24, 5);

    const budget = estimate.basePlate * MY_SHARE_OF_PLATE;
    const [primary, five, week] = fastctxWindows(shown[0], estimate.mineWeek, budget);
    expect(primary).toMatchObject({
      id: "mine-week",
      primary: true,
      source: "estimate",
      amount: "$105 / $1,100",
      resetsAt: "2026-11-28T18:00:00Z",
    });
    expect(primary!.usedPercent).toBeCloseTo(9.51, 1);
    expect(five).toMatchObject({ kind: "session", usedPercent: 13, source: "official" });
    expect(week).toMatchObject({ kind: "weekly", usedPercent: 8, source: "official" });
  });

  it("builds the module section like the web panel", () => {
    const estimate = estimateFastctxLogin(shown[0]!, report, mine);
    const section = fastctxLoginSection(shown[0]!, estimate, { myBudget: 1100 });
    expect(section.title).toBe("la");
    expect(section.gauges.map((g) => [g.label, g.source])).toEqual([
      ["5 hours", "official"],
      ["5 hours · ledger", "estimate"],
      ["7 days", "official"],
      ["7 days · ledger", "estimate"],
      ["My week", "estimate"],
      ["Fable", "estimate"],
    ]);
    expect(section.breakdowns.map((b) => b.title)).toEqual([
      "This week by person",
      "This week by model",
    ]);
    expect(section.facts.map((f) => f.label)).toEqual([
      "Official vs ledger",
      "Weekly plate (set · taken)",
      "Last 24 hours (API price)",
    ]);
  });
});
