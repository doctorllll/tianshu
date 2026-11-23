import { describe, expect, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";

import { isAutoUpdateCandidate } from "./ProviderAutoUpdate.ts";

const advisory = {
  status: "behind_latest",
  currentVersion: "0.80.1",
  latestVersion: "0.90.1",
  updateCommand: "npm install -g zcode-acp-server@latest",
  canUpdate: true,
  canInstallVersion: false,
  checkedAt: "2026-11-23T09:00:00.000Z",
  message: null,
} as const;

const provider = (overrides: Partial<ServerProvider> = {}) =>
  ({ enabled: true, installed: true, versionAdvisory: advisory, ...overrides }) as ServerProvider;

describe("isAutoUpdateCandidate", () => {
  it("takes an enabled agent behind its latest release with a one-click update", () => {
    expect(isAutoUpdateCandidate(provider())).toBe(true);
  });

  it("leaves manual, current, disabled and already updating agents alone", () => {
    expect(
      isAutoUpdateCandidate(provider({ versionAdvisory: { ...advisory, canUpdate: false } })),
    ).toBe(false);
    expect(
      isAutoUpdateCandidate(provider({ versionAdvisory: { ...advisory, updateCommand: null } })),
    ).toBe(false);
    expect(
      isAutoUpdateCandidate(provider({ versionAdvisory: { ...advisory, status: "current" } })),
    ).toBe(false);
    expect(isAutoUpdateCandidate(provider({ enabled: false }))).toBe(false);
    expect(
      isAutoUpdateCandidate(
        provider({
          updateState: {
            status: "running",
            startedAt: null,
            finishedAt: null,
            message: null,
            output: null,
          },
        }),
      ),
    ).toBe(false);
  });
});
