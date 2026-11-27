import { assert, describe, it } from "@effect/vitest";

import { PARENT_PLAN_MAX_CHARS } from "./planHandoff.ts";
import { planRequirement } from "./planRequirement.ts";

describe("planRequirement", () => {
  it("makes the plan required and asks for one when there is none", () => {
    const text = planRequirement({ markdown: "", version: null, showPlan: true });
    assert.include(text, "Using it is required");
    assert.include(text, "plan_write");
    assert.include(text, "This thread has no plan yet: write it first.");
    assert.notInclude(text, "<current_plan");
  });

  it("carries the plan when it changed, with its version", () => {
    const text = planRequirement({ markdown: "- [ ] ship it\n", version: 3, showPlan: true });
    assert.include(text, '<current_plan version="3">\n- [ ] ship it\n</current_plan>');
  });

  it("only says the plan is unchanged when the agent has already seen it", () => {
    const text = planRequirement({ markdown: "- [x] done", version: 4, showPlan: false });
    assert.include(text, "The plan is unchanged since you last saw it.");
    assert.notInclude(text, "<current_plan");
    assert.notInclude(text, "- [x] done");
  });

  it("cuts a long plan and says how to read the rest", () => {
    const text = planRequirement({
      markdown: "x".repeat(PARENT_PLAN_MAX_CHARS + 50),
      version: 1,
      showPlan: true,
    });
    assert.include(text, "cut short; plan_read reads all of it");
    assert.isBelow(text.length, PARENT_PLAN_MAX_CHARS + 1_500);
  });
});
