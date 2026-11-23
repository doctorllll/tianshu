import { describe, expect, it } from "@effect/vitest";

import {
  isZcodeAcpCommand,
  parseZcodeMcpServers,
  parseZcodeModelPreferences,
  presentZcodeModels,
} from "./zcodeAcp.ts";

describe("isZcodeAcpCommand", () => {
  it("finds the bridge launched directly or through env", () => {
    expect(isZcodeAcpCommand("/opt/homebrew/bin/zcode-acp-server", [])).toBe(true);
    expect(
      isZcodeAcpCommand("/usr/bin/env", [
        "ZCODE_BIN=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs",
        "/opt/homebrew/bin/zcode-acp-server",
      ]),
    ).toBe(true);
    expect(isZcodeAcpCommand("zcode-acp", ["server"])).toBe(true);
    expect(isZcodeAcpCommand("/usr/bin/env", ["kimi", "acp"])).toBe(false);
  });
});

describe("parseZcodeMcpServers", () => {
  it("converts ZCode's configured servers to ACP's shape", () => {
    expect(
      parseZcodeMcpServers(
        JSON.stringify({
          mcp: {
            servers: {
              magpie: { type: "http", url: "http://127.0.0.1:3425/mcp/magpie/hub/zcode" },
              docs: { type: "sse", url: "https://example.test/sse", headers: { "X-Key": "k" } },
              repl: { command: "node", args: ["repl.js", 1], env: { DEBUG: "1", N: 2 } },
              off: { type: "http", url: "http://127.0.0.1:1/mcp", enabled: false },
              "t3-code": { type: "http", url: "http://127.0.0.1:2/mcp" },
              broken: { type: "http" },
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "http",
        name: "magpie",
        url: "http://127.0.0.1:3425/mcp/magpie/hub/zcode",
        headers: [],
      },
      {
        type: "sse",
        name: "docs",
        url: "https://example.test/sse",
        headers: [{ name: "X-Key", value: "k" }],
      },
      { name: "repl", command: "node", args: ["repl.js"], env: [{ name: "DEBUG", value: "1" }] },
    ]);
  });

  it("returns nothing for a config without servers or invalid JSON", () => {
    expect(parseZcodeMcpServers("{}")).toEqual([]);
    expect(parseZcodeMcpServers("not json")).toEqual([]);
  });
});

describe("presentZcodeModels", () => {
  const thought = {
    id: "thought",
    label: "Thought Level",
    type: "select" as const,
    options: [
      { id: "low", label: "low" },
      { id: "high", label: "high" },
      { id: "max", label: "max" },
    ],
    currentValue: "max",
  };
  const models = [
    {
      slug: "magpie\\auto/glm-5.3",
      name: "magpie › auto/glm-5.3",
      isCustom: false,
      isDefault: true,
      capabilities: { optionDescriptors: [thought] },
    },
    {
      slug: "magpie\\zcode/GLM-5.2",
      name: "magpie › zcode/GLM-5.2",
      isCustom: false,
      capabilities: null,
    },
    {
      slug: "builtin:bigmodel-coding-plan\\GLM-5.3",
      name: "GLM-5.3",
      isCustom: false,
      capabilities: null,
    },
  ];
  const preferences = parseZcodeModelPreferences(
    JSON.stringify({
      config: {
        defaultModelSelection: {
          providerId: "account:bigmodel-individual-coding-plan",
          modelId: "GLM-5.3",
          options: { reasoningLevel: "high" },
        },
        modelConfigRules: {
          providerModelRules: [
            {
              providerId: "magpie",
              modelId: "zcode/GLM-5.2",
              config: { optionSpecs: { reasoningLevel: { values: ["disabled", "high", "max"] } } },
            },
          ],
        },
      },
    }),
  );

  it("follows ZCode's default and groups by plan without the provider prefix", () => {
    expect(preferences.defaultSlug).toBe("builtin:bigmodel-coding-plan\\GLM-5.3");
    const shown = presentZcodeModels(models, preferences);
    expect(shown.map((m) => [m.name, m.subProvider, m.isDefault === true])).toEqual([
      ["auto/glm-5.3", "magpie", false],
      ["zcode/GLM-5.2", "magpie", false],
      ["GLM-5.3", "Coding Plan", true],
    ]);
  });

  it("fills in reasoning levels before a session reports them", () => {
    const shown = presentZcodeModels(models, preferences);
    const levels = (index: number) =>
      shown[index]?.capabilities?.optionDescriptors?.find((d) => d.id === "thought");
    expect(levels(1)).toMatchObject({
      currentValue: "max",
      options: [{ id: "disabled" }, { id: "high" }, { id: "max" }],
    });
    expect(levels(2)).toMatchObject({
      currentValue: "high",
      options: [{ id: "low" }, { id: "high" }, { id: "max" }],
    });
    expect(presentZcodeModels(shown, preferences)).toEqual(shown);
  });
});
