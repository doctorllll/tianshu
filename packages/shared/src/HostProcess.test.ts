import { expect, it } from "vite-plus/test";

import { dropInheritedAgentIdentity } from "./HostProcess.ts";

it("drops a launching fastctx job's identity and keeps everything else", () => {
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    FASTCTX_RESIDENT: "claude-1@laptop",
    FASTCTX_JOB: "j-1",
    FASTCTX_JOB_TEMP: "/tmp/j-1.tmp",
    FASTCTX_SCRATCH: "/tmp/scratch",
    FASTCTX_TOWN: "workbench",
    FASTCTX_MACHINE: "laptop",
    FASTCTX_WEB_URL: "http://127.0.0.1:8765",
  };

  expect(dropInheritedAgentIdentity(env)).toEqual([
    "FASTCTX_RESIDENT",
    "FASTCTX_JOB",
    "FASTCTX_JOB_TEMP",
    "FASTCTX_SCRATCH",
    "FASTCTX_TOWN",
    "FASTCTX_MACHINE",
  ]);
  expect(env).toEqual({ PATH: "/usr/bin", FASTCTX_WEB_URL: "http://127.0.0.1:8765" });
});

it("leaves an environment without a launching job alone", () => {
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", T3CODE_THREAD_ID: "thread-1" };
  expect(dropInheritedAgentIdentity(env)).toEqual([]);
  expect(env).toEqual({ PATH: "/usr/bin", T3CODE_THREAD_ID: "thread-1" });
});
