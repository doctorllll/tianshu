import { assert, describe, it } from "@effect/vitest";

import { PARENT_PLAN_MAX_CHARS } from "./planHandoff.ts";
import {
  advancePlanState,
  PLAN_REFRESH_TURNS,
  PLAN_STALE_TURNS,
  planRequirement,
  planWritten,
} from "./planRequirement.ts";

describe("planRequirement", () => {
  it("makes the plan required and asks for one when there is none", () => {
    const text = planRequirement({ markdown: "", version: null, showPlan: true, quietTurns: 0 });
    assert.include(text, "Using it is required");
    assert.include(text, "plan_write");
    assert.include(text, "This thread has no plan yet: write it first.");
    assert.notInclude(text, "<current_plan");
  });

  it("presses harder once turns have passed without a plan", () => {
    const text = planRequirement({ markdown: "", version: null, showPlan: true, quietTurns: 2 });
    assert.include(text, "still has no plan after 3 turns: write it now, before anything else.");
  });

  it("carries the plan when it changed, with its version", () => {
    const text = planRequirement({
      markdown: "- [ ] ship it\n",
      version: 3,
      showPlan: true,
      quietTurns: 0,
    });
    assert.include(text, '<current_plan version="3">\n- [ ] ship it\n</current_plan>');
    assert.notInclude(text, "has not changed for");
  });

  it("only says the plan is unchanged when the agent has already seen it", () => {
    const text = planRequirement({
      markdown: "- [x] done",
      version: 4,
      showPlan: false,
      quietTurns: 1,
    });
    assert.include(text, "The plan is unchanged since you last saw it.");
    assert.notInclude(text, "<current_plan");
    assert.notInclude(text, "- [x] done");
    assert.notInclude(text, "has not changed for");
  });

  it("asks the agent to catch a quiet plan up", () => {
    const text = planRequirement({
      markdown: "- [ ] a",
      version: 2,
      showPlan: false,
      quietTurns: PLAN_STALE_TURNS,
    });
    assert.include(text, "The plan has not changed for 2 turns. Before you continue, bring it");
  });

  it("cuts a long plan and says how to read the rest", () => {
    const text = planRequirement({
      markdown: "x".repeat(PARENT_PLAN_MAX_CHARS + 50),
      version: 1,
      showPlan: true,
      quietTurns: 0,
    });
    assert.include(text, "cut short; plan_read reads all of it");
    assert.isBelow(text.length, PARENT_PLAN_MAX_CHARS + 1_500);
  });
});

describe("advancePlanState", () => {
  it("shows the plan on the first turn", () => {
    const { state, showPlan } = advancePlanState(undefined, 1);
    assert.isTrue(showPlan);
    assert.strictEqual(state.quiet, 0);
  });

  it("counts turns that begin with the plan unchanged, and resets when it moves", () => {
    let state = advancePlanState(undefined, 1).state;
    state = advancePlanState(state, 1).state;
    assert.strictEqual(state.quiet, 1);
    state = advancePlanState(state, 1).state;
    assert.strictEqual(state.quiet, 2);
    state = advancePlanState(state, 2).state;
    assert.strictEqual(state.quiet, 0);
  });

  it("counts turns without any plan", () => {
    let state = advancePlanState(undefined, null).state;
    state = advancePlanState(state, null).state;
    assert.strictEqual(state.quiet, 1);
  });

  it("does not show a version the agent wrote itself, but does one it has not seen", () => {
    const first = advancePlanState(undefined, 1).state;
    const wrote = planWritten(first, 2);
    assert.isFalse(advancePlanState(wrote, 2).showPlan);
    assert.isTrue(advancePlanState(first, 2).showPlan);
  });

  it("shows the plan again after a while, in case a compaction took it", () => {
    let state = advancePlanState(undefined, 1).state;
    let shown = 0;
    for (let turn = 1; turn <= PLAN_REFRESH_TURNS; turn += 1) {
      const next = advancePlanState(state, 1);
      state = next.state;
      if (next.showPlan) shown += 1;
    }
    assert.strictEqual(shown, 1);
    assert.strictEqual(state.sinceShown, 0);
  });

  it("ignores a write for a thread it has not met", () => {
    assert.isUndefined(planWritten(undefined, 3));
  });
});
