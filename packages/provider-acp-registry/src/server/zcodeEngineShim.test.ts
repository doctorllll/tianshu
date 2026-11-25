import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { ZCODE_ENGINE_SHIM_NAME, ZCODE_ENGINE_SHIM_SOURCE } from "./zcodeEngineShim.ts";

/** Asks what the app would answer, then reports what reached it once its input ends. */
const FAKE_ENGINE = `
const fs = require("node:fs");
const send = (message) => fs.writeSync(1, JSON.stringify(message) + "\\n");
send({ jsonrpc: "2.0", id: 8, method: "session/readReplyLanguage", params: { sessionId: "s" } });
send({ jsonrpc: "2.0", id: 7, method: "session/requestRuntimePreferences", params: { sessionId: "s" } });
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const received = input.trim().split("\\n").map((line) => JSON.parse(line));
  send({ received, language: process.env.ZCODE_CLIENT_LANGUAGE, args: process.argv.slice(2) });
});
`;

/** Reports usage with the projection's 200K default, before and after the bridge reads sessions. */
const CATALOG_ENGINE = `
const fs = require("node:fs");
const send = (message) => fs.writeSync(1, JSON.stringify(message) + "\\n");
const model = (current) => ({
  available: [
    { ref: { providerId: "account:plan", modelId: "GLM-5.4" }, label: "GLM-5.4", contextWindow: 1000000 },
    { ref: { providerId: "custom", modelId: "small" }, label: "small", contextWindow: 128000 },
  ],
  current,
});
const usage = (sessionId) => ({
  jsonrpc: "2.0",
  method: "session/event",
  params: { sessionId, seq: 3, type: "session.updated", payload: { usage: { inputTokens: 587000 }, contextWindow: 200000 } },
});
send({ jsonrpc: "2.0", method: "state.updated", params: { sessionId: "s", patch: { model: model({ providerId: "account:plan", modelId: "GLM-5.4" }) } } });
// The session's own entry for its model carries the engine's placeholder.
send({ jsonrpc: "2.0", method: "state.updated", params: { sessionId: "s", patch: { model: {
  available: [{ ref: { providerId: "account:plan", modelId: "GLM-5.4" }, label: "GLM-5.4", contextWindow: 200000 }],
  current: { providerId: "account:plan", modelId: "GLM-5.4" },
} } } });
send(usage("s"));
send(usage("t"));
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  for (const line of input.trim().split("\\n")) {
    const request = JSON.parse(line);
    const current = request.params.sessionId === "t"
      ? { providerId: "custom", modelId: "small" }
      : { providerId: "account:plan", modelId: "unlisted" };
    send({ jsonrpc: "2.0", id: request.id, result: { projection: { sessionId: "unknown", contextUsed: 9, contextWindow: 200000 }, settings: { model: model(current) } } });
  }
  send(usage("t"));
});
`;

const contextWindowsOf = (messages: ReadonlyArray<Record<string, any>>) =>
  messages.map((message) =>
    message.method === "session/event"
      ? [message.params.sessionId, message.params.payload.contextWindow]
      : message.result
        ? [message.id, message.result.projection.contextWindow]
        : [message.method],
  );

describe("ZCode engine shim", () => {
  it.live("gives the bridge each session's context window from the engine's catalog", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-zcode-shim-" });
      const shim = path.join(root, "glm", ZCODE_ENGINE_SHIM_NAME);
      yield* fileSystem.makeDirectory(path.join(root, "glm"));
      yield* fileSystem.writeFileString(shim, ZCODE_ENGINE_SHIM_SOURCE);
      yield* fileSystem.writeFileString(path.join(root, "glm", "zcode.cjs"), CATALOG_ENGINE);
      const reads = [
        { jsonrpc: "2.0", id: 20, method: "session/read", params: { sessionId: "t" } },
        { jsonrpc: "2.0", id: 21, method: "session/read", params: { sessionId: "u" } },
      ];
      const child = yield* spawner.spawn(
        ChildProcess.make(process.execPath, [shim, "app-server", "--stdio"], {
          env: { ZCODE_HOME: path.join(root, "zcode-home"), ZCODE_DATA_BASE_DIR: "" },
          extendEnv: true,
          stdin: Stream.make(reads.map((read) => JSON.stringify(read) + "\n").join("")).pipe(
            Stream.encodeText,
          ),
        }),
      );
      const lines = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runCollect,
      );
      const messages = Array.from(lines, (line) => JSON.parse(line) as Record<string, any>);

      expect(contextWindowsOf(messages)).toEqual([
        ["state.updated"],
        ["state.updated"],
        // The catalog says GLM-5.4 holds 1M; the projection's 200K default is replaced, and the
        // session's own placeholder entry does not undo that.
        ["s", 1_000_000],
        // No model known for this session yet: passed on as is.
        ["t", 200_000],
        // A read names its session; that session's model comes from the read's own settings.
        [20, 128_000],
        // A model missing from the catalog keeps what the engine said.
        [21, 200_000],
        ["t", 128_000],
      ]);
      // Usage and everything else in the event are untouched.
      expect(messages[2]?.params.payload.usage).toEqual({ inputTokens: 587000 });
      expect(yield* child.exitCode).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("answers the engine's questions from the app's settings", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-zcode-shim-" });
      const shim = path.join(root, "glm", ZCODE_ENGINE_SHIM_NAME);
      yield* fileSystem.makeDirectory(path.join(root, "glm"));
      yield* fileSystem.writeFileString(shim, ZCODE_ENGINE_SHIM_SOURCE);
      yield* fileSystem.writeFileString(path.join(root, "glm", "zcode.cjs"), FAKE_ENGINE);
      const zcodeHome = path.join(root, "zcode-home");
      yield* fileSystem.makeDirectory(path.join(zcodeHome, "v2"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(zcodeHome, "v2", "setting.json"),
        JSON.stringify({ locale: "zh-CN", toolSearchMode: "local", replyLanguage: "zh-CN" }),
      );

      const asked = yield* Deferred.make<void>();
      // The bridge's fixed reply, sent once the question has passed through the shim.
      const bridgeReply = Stream.fromEffect(Deferred.await(asked)).pipe(
        Stream.map(
          () =>
            JSON.stringify({
              jsonrpc: "2.0",
              id: 7,
              result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false },
            }) + "\n",
        ),
        Stream.encodeText,
      );
      const child = yield* spawner.spawn(
        ChildProcess.make(process.execPath, [shim, "app-server", "--stdio"], {
          env: { ZCODE_HOME: zcodeHome, ZCODE_DATA_BASE_DIR: "", ZCODE_CLIENT_LANGUAGE: "" },
          extendEnv: true,
          stdin: bridgeReply,
        }),
      );
      const lines = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.tap((line) =>
          line.includes("requestRuntimePreferences")
            ? Deferred.succeed(asked, undefined)
            : Effect.void,
        ),
        Stream.runCollect,
      );
      const messages = Array.from(lines, (line) => JSON.parse(line) as Record<string, unknown>);

      // The reply-language question never reaches the bridge; the preference question does.
      expect(messages.map((message) => message.method)).toEqual([
        "session/requestRuntimePreferences",
        undefined,
      ]);
      expect(messages[1]).toEqual({
        received: [
          { jsonrpc: "2.0", id: 8, result: { language: "zh-CN" } },
          {
            jsonrpc: "2.0",
            id: 7,
            result: {
              nativeSearchEnhancementsEnabled: true,
              toolSearchMode: "local",
              totalTokensReminderEnabled: false,
              agentAlwaysBackgroundEnabled: true,
              memoryEnabled: false,
            },
          },
        ],
        language: "zh-CN",
        args: ["app-server", "--stdio"],
      });
      expect(yield* child.exitCode).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
