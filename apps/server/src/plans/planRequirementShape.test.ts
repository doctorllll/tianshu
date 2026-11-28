import { assert, describe, it } from "@effect/vitest";

import { planRequirement } from "./planRequirement.ts";

const show = (markdown: string, showPlan: boolean, quietTurns: number) =>
  planRequirement({ markdown, version: markdown === "" ? null : 1, showPlan, quietTurns });

describe("planRequirement leaves the shape of the plan to the agent", () => {
  it("asks for a plan to be written and read, but gives no template", () => {
    for (const text of [show("", true, 0), show("x", true, 0), show("x", false, 3)]) {
      assert.include(text, "up to you");
      for (const template of ["[ ]", "[x]", "decisions", "open questions"]) {
        assert.notInclude(text, template);
      }
    }
  });
});
