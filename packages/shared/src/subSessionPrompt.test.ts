import { describe, expect, it } from "vite-plus/test";

import {
  parseSubSessionPrompt,
  subSessionPrompt,
  subSessionPromptApproves,
} from "./subSessionPrompt.ts";

describe("sub-session prompt", () => {
  const text = subSessionPrompt({
    instanceId: "zcode",
    model: "GLM-5.4",
    options: [{ id: "effort", value: "high" }],
    title: "Check the logs",
    task: "Read the server log and list the errors.\nKeep it short.",
  });

  it("reads back the agent and task the form wrote", () => {
    expect(parseSubSessionPrompt(text)).toEqual({
      providerInstanceId: "zcode",
      task: "Read the server log and list the errors.\nKeep it short.",
    });
    expect(parseSubSessionPrompt("Please start a sub-session for the logs.")).toBeUndefined();
  });

  it("approves only the same task on the same agent", () => {
    const task = "Read the server log and list the errors.\nKeep it short.";
    expect(subSessionPromptApproves(text, { providerInstanceId: "zcode", task })).toBe(true);
    expect(subSessionPromptApproves(text, { providerInstanceId: "codex", task })).toBe(false);
    expect(
      subSessionPromptApproves(text, { providerInstanceId: "zcode", task: "Something else" }),
    ).toBe(false);
  });
});
