import { assert, describe, it } from "vitest";

import { dshSessionId, fastctxOwner, nativePlanSource } from "./ThreadPlans.ts";

describe("ThreadPlans", () => {
  it("knows the agents that keep their own plan by their bridge", () => {
    assert.strictEqual(
      nativePlanSource({
        source: "local",
        commandPath: "/opt/homebrew/bin/python3",
        commandArgs: ["/x/fastctx-web/bin/fastctx-acp"],
      }),
      "fastctx",
    );
    assert.strictEqual(
      nativePlanSource({
        source: "local",
        commandPath: "/usr/bin/env",
        commandArgs: [
          "DSH_BIN=/opt/homebrew/bin/dsh",
          "/opt/homebrew/bin/python3",
          "/x/bridges/dsh-acp",
        ],
      }),
      "dsh",
    );
    assert.strictEqual(
      nativePlanSource({
        source: "local",
        commandPath: "/x/bridges/antigravity-acp",
        commandArgs: [],
      }),
      "antigravity",
    );
    assert.strictEqual(
      nativePlanSource({
        source: "local",
        commandPath: "/opt/homebrew/bin/zcode-acp-server",
        commandArgs: [],
      }),
      undefined,
    );
    assert.strictEqual(
      nativePlanSource({ source: "registry", commandArgs: ["fastctx-acp"] }),
      undefined,
    );
  });

  it("finds the fastctx conversation behind a session", () => {
    assert.deepStrictEqual(fastctxOwner("claude-572086e8@洛杉矶linux-38", undefined), {
      resident: "claude-572086e8",
      machine: "洛杉矶linux-38",
    });
    assert.deepStrictEqual(
      fastctxOwner("fx-new-1", { "fx-new-1": { resident: "claude-1", machine: "m" } }),
      { resident: "claude-1", machine: "m" },
    );
    assert.strictEqual(fastctxOwner("fx-new-2", {}), null);
  });

  it("finds DSH's session and refuses anything that is not one", () => {
    assert.strictEqual(dshSessionId("session-06c3a7b7-cdca", undefined), "session-06c3a7b7-cdca");
    assert.strictEqual(
      dshSessionId("dsh-new-1", { "dsh-new-1": { dsh: "session-abc", cwd: "/x" } }),
      "session-abc",
    );
    assert.strictEqual(dshSessionId("dsh-new-2", { "dsh-new-2": { dsh: null } }), null);
    assert.strictEqual(dshSessionId("session-../../etc", undefined), null);
  });
});
