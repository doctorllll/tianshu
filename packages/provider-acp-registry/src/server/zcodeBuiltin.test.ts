import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  makeZcodeBuiltinTables,
  parseZcodeBuiltinTable,
  replaceZcodeEngine,
  zcodeEnginePath,
  zcodePlanModels,
  zcodePlatformKey,
} from "./zcodeBuiltin.ts";
import { ZCODE_ENGINE_SHIM_NAME, ZCODE_ENGINE_SHIM_SOURCE } from "./zcodeEngineShim.ts";

const table = (revision: number, models: ReadonlyArray<string>) =>
  JSON.stringify({
    schemaVersion: 1,
    revision,
    config: {
      providerConfigRules: {
        providerRules: [
          {
            providerId: "account:bigmodel-team-coding-plan",
            config: { builtinModelIds: [...models, "GLM-T"] },
          },
          {
            providerId: "account:bigmodel-individual-coding-plan",
            config: { builtinModelIds: models },
          },
          {
            providerId: "account:bigmodel-start-plan",
            config: { builtinModelIds: ["GLM-5-Turbo"] },
          },
          { providerId: "account:bigmodel-offpeak-idle-plan", config: { builtinModelIds: models } },
          { providerId: "bigmodel-api", config: { builtinModelIds: ["GLM-API"] } },
        ],
      },
      modelConfigRules: {},
    },
  });

describe("parseZcodeBuiltinTable", () => {
  it("reads the revision and each account plan's models", () => {
    const parsed = parseZcodeBuiltinTable(table(47, ["GLM-5.4", "GLM-5.3"]));
    expect(parsed?.revision).toBe(47);
    expect(parsed?.accountModels.get("account:bigmodel-individual-coding-plan")).toEqual([
      "GLM-5.4",
      "GLM-5.3",
    ]);
    expect(parsed?.accountModels.has("bigmodel-api")).toBe(false);
    expect(parseZcodeBuiltinTable("{}")).toBeUndefined();
    expect(parseZcodeBuiltinTable("not json")).toBeUndefined();
  });
});

describe("zcodePlanModels", () => {
  it("names plans the way the bridge does, individual plans first", () => {
    const parsed = parseZcodeBuiltinTable(table(47, ["GLM-5.4", "GLM-5.3"]))!;
    expect(Object.fromEntries(zcodePlanModels(parsed))).toEqual({
      "builtin:bigmodel-coding-plan": ["GLM-5.4", "GLM-5.3", "GLM-T"],
      "builtin:bigmodel-start-plan": ["GLM-5-Turbo"],
    });
  });
});

describe("engine path", () => {
  it("finds and replaces the engine in the env wrapper", () => {
    const engine = "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";
    const args = [`ZCODE_BIN=${engine}`, "/opt/homebrew/bin/zcode-acp-server"];
    expect(zcodeEnginePath(args, {})).toBe(engine);
    expect(zcodeEnginePath([], { ZCODE_BIN: "/x/zcode.cjs" })).toBe("/x/zcode.cjs");
    expect(replaceZcodeEngine(args, engine, "/m/zcode.cjs")).toEqual([
      "ZCODE_BIN=/m/zcode.cjs",
      "/opt/homebrew/bin/zcode-acp-server",
    ]);
    expect(zcodePlatformKey("darwin", "arm64")).toBe("darwin-aarch64");
  });
});

const PLIST = `<?xml version="1.0"?><plist><dict>
<key>CFBundleShortVersionString</key>
<string>3.19.1</string></dict></plist>`;

/** A fake ZCode.app bundling revision 44 and a ZCode home holding a synced revision 47. */
const makeFixture = Effect.fn("zcodeBuiltin.test.fixture")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-zcode-builtin-" });
  const resources = path.join(root, "ZCode.app", "Contents", "Resources");
  yield* fileSystem.makeDirectory(path.join(resources, "glm", "node-runtime"), { recursive: true });
  yield* fileSystem.makeDirectory(path.join(resources, "config", "provider"), { recursive: true });
  yield* fileSystem.writeFileString(path.join(resources, "..", "Info.plist"), PLIST);
  yield* fileSystem.writeFileString(path.join(resources, "glm", "zcode.cjs"), "// engine");
  yield* fileSystem.writeFileString(path.join(resources, "app.asar"), "asar");
  yield* fileSystem.writeFileString(
    path.join(resources, "config", "provider", "zcode-builtin.json"),
    table(44, ["GLM-5.3"]),
  );
  const zcodeHome = path.join(root, "zcode-home");
  const synced = path.join(
    zcodeHome,
    "v2",
    "runtime",
    "provider",
    "darwin-aarch64",
    "3.19.1",
    "endpoint-abc",
  );
  yield* fileSystem.makeDirectory(synced, { recursive: true });
  yield* fileSystem.writeFileString(
    path.join(synced, "zcode-builtin.json"),
    table(47, ["GLM-5.4", "GLM-5.3"]),
  );
  return { root, engine: path.join(resources, "glm", "zcode.cjs"), zcodeHome };
});

const offline = HttpClient.make(() => Effect.die("offline"));

describe("makeZcodeBuiltinTables", () => {
  it.effect("hands the bridge the shim in a mirror carrying ZCode's newer synced table", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, engine, zcodeHome } = yield* makeFixture();
      const tables = yield* makeZcodeBuiltinTables({
        directory: path.join(root, "state"),
        platformKey: "darwin-aarch64",
      }).pipe(Effect.provideService(HttpClient.HttpClient, offline));
      const choice = yield* tables.engineFor({ engine, zcodeHome });
      const mirrored = choice.engine;
      expect(choice.planModels).toEqual([
        "builtin:bigmodel-coding-plan\\GLM-5.4",
        "builtin:bigmodel-coding-plan\\GLM-5.3",
        "builtin:bigmodel-coding-plan\\GLM-T",
        "builtin:bigmodel-start-plan\\GLM-5-Turbo",
      ]);
      expect(mirrored).toBe(
        path.join(
          root,
          "state",
          "engines",
          "3.19.1-r47-3",
          "Resources",
          "glm",
          ZCODE_ENGINE_SHIM_NAME,
        ),
      );
      expect(yield* fileSystem.readFileString(mirrored)).toBe(ZCODE_ENGINE_SHIM_SOURCE);
      const glm = path.dirname(mirrored);
      expect(yield* fileSystem.realPath(path.join(glm, "zcode.cjs"))).toBe(
        yield* fileSystem.realPath(engine),
      );
      expect(
        yield* fileSystem.readFileString(path.join(glm, "provider", "zcode-builtin.json")),
      ).toBe(table(47, ["GLM-5.4", "GLM-5.3"]));
      expect(yield* fileSystem.exists(path.join(glm, "..", "app.asar"))).toBe(true);
      expect(yield* fileSystem.readFileString(path.join(glm, "..", "..", "Info.plist"))).toBe(
        PLIST,
      );
      // Reused, not rebuilt, on the next launch; an older shim is replaced.
      yield* fileSystem.writeFileString(mirrored, "// older shim");
      expect((yield* tables.engineFor({ engine, zcodeHome })).engine).toBe(mirrored);
      expect(yield* fileSystem.readFileString(mirrored)).toBe(ZCODE_ENGINE_SHIM_SOURCE);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fetches the official table and runs the bundled one when nothing is newer", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, engine, zcodeHome } = yield* makeFixture();
      yield* fileSystem.remove(path.join(zcodeHome, "v2"), { recursive: true });
      const requested: Array<string> = [];
      let published = table(44, ["GLM-5.3"]);
      const official = HttpClient.make((request) => {
        requested.push(request.url);
        const body = request.url.startsWith("https://zcode.z.ai/api/v1/client/configs")
          ? JSON.stringify({
              data: {
                configs: {
                  builtin_provider_config_json: `https://cdn-zcode.z.ai/zcode/config/t-${requested.length}.json`,
                },
              },
            })
          : published;
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body)));
      });
      const directory = path.join(root, "state");
      const tables = yield* makeZcodeBuiltinTables({
        directory,
        platformKey: "darwin-aarch64",
      }).pipe(Effect.provideService(HttpClient.HttpClient, official));
      const bundled = path.join(
        directory,
        "engines",
        "3.19.1-r44-3",
        "Resources",
        "glm",
        ZCODE_ENGINE_SHIM_NAME,
      );
      expect((yield* tables.engineFor({ engine, zcodeHome })).engine).toBe(bundled);
      expect(requested[0]).toBe(
        "https://zcode.z.ai/api/v1/client/configs?app_version=3.19.1&platform=darwin-aarch64",
      );
      expect(requested).toHaveLength(2);
      // Within the refresh interval the endpoint is not asked again.
      published = table(48, ["GLM-5.5"]);
      expect((yield* tables.engineFor({ engine, zcodeHome })).engine).toBe(bundled);
      expect(requested).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
