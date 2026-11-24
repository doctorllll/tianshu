import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import type { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import type { UsageService } from "../usage/UsageService.ts";
import { suggestSidebarCategories } from "./SidebarCategorySuggestions.ts";

const instanceId = ProviderInstanceId.make("writer");
const provider = {
  instanceId,
  enabled: true,
  installed: true,
  status: "ready",
  auth: { status: "authenticated" },
  models: [{ slug: "small-model" }],
} as unknown as ServerProvider;

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-category-suggestions-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const fixture = (reply: unknown) => {
  const prompts: string[] = [];
  const cwds: string[] = [];
  const instances = {
    getInstance: () =>
      Effect.succeed({
        textGeneration: {
          generateTranscriptionPostProcessing: (input: {
            readonly prompt: string;
            readonly cwd: string;
          }) => {
            prompts.push(input.prompt);
            cwds.push(input.cwd);
            return Effect.succeed({ transcription: JSON.stringify(reply) });
          },
        },
      }),
  } as unknown as ProviderInstanceRegistry["Service"];
  const usage = {
    modelRates: () => Effect.succeed(new Map()),
  } as unknown as UsageService["Service"];
  return { prompts, cwds, instances, usage };
};

it.effect("files titles with their folder and agent, and keeps only sound new categories", () =>
  Effect.gen(function* () {
    const { prompts, cwds, instances, usage } = fixture({
      suggestions: [
        { titleIndex: 0, categoryIndex: 1, reason: "The folder is the media library" },
        { titleIndex: 0, categoryIndex: 0, reason: "Duplicate of title 0" },
        { titleIndex: 9, categoryIndex: 0, reason: "No such title" },
        { titleIndex: 1, categoryIndex: 0, reason: "x".repeat(500) },
        "not a row",
      ],
      proposals: [
        { label: "Media", description: "Same as an existing category", titleIndexes: [2, 3] },
        {
          label: "Travel",
          description: "Trips",
          keywords: ["trip", "trip", ""],
          titleIndexes: [2],
        },
        {
          label: "Debate",
          description: "Speeches and rebuttals",
          keywords: ["speech", "rebuttal"],
          titleIndexes: [2, 3, 3, 1, 42],
        },
      ],
    });
    const result = yield* suggestSidebarCategories(
      {
        titles: ["Commit the changes", "Fix the router", "Closing speech", "Rebuttal notes"],
        categories: ["Code", "Media"],
        descriptions: ["Programs and scripts", "Films, series and the library server"],
        contexts: [{ project: "media-library", agent: "claude" }, {}, {}, { agent: "zcode" }],
        modelSelection: null,
        language: "en",
        proposeNew: true,
      },
      [provider],
      instances,
      usage,
    );

    assert.deepStrictEqual(
      result.suggestions.map((row) => [row.titleIndex, row.categoryIndex, row.reason.length]),
      [
        [0, 1, 31],
        [1, 0, 240],
      ],
    );
    // Title 1 was filed, title 42 does not exist, and "Media" already is a category.
    assert.deepStrictEqual(result.proposals, [
      {
        label: "Debate",
        description: "Speeches and rebuttals",
        keywords: ["speech", "rebuttal"],
        titleIndexes: [2, 3],
      },
    ]);
    const prompt = prompts[0] ?? "";
    assert.include(prompt, '"folder":"media-library"');
    assert.include(prompt, '"agent":"zcode"');
    assert.include(prompt, '"about":"Films, series and the library server"');
    assert.include(prompt, "propose up to 3 new categories");
    // Every call runs from the same empty directory under the server's state.
    const { stateDir } = yield* ServerConfig.ServerConfig;
    assert.deepStrictEqual(cwds, [`${stateDir}/category-suggestions`]);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("asks for no new categories unless they are wanted", () =>
  Effect.gen(function* () {
    const { prompts, instances, usage } = fixture({
      suggestions: [],
      proposals: [{ label: "Debate", titleIndexes: [0, 1] }],
    });
    const result = yield* suggestSidebarCategories(
      {
        titles: ["Closing speech", "Rebuttal notes"],
        categories: ["Code"],
        modelSelection: null,
        language: "zh",
      },
      [provider],
      instances,
      usage,
    );
    assert.isUndefined(result.proposals);
    assert.notInclude(prompts[0] ?? "", "proposals");
    assert.include(prompts[0] ?? "", '"titles":[{"title":"Closing speech"}');
  }).pipe(Effect.provide(testLayer)),
);
