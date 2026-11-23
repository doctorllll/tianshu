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

describe("ZCode engine shim", () => {
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
